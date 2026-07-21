const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { runMigrations } = require('./migration-runner.cjs');

const DEFAULT_APP_KEY = 'defectdojo';
const HUB_APP_KEY = 'hub';
const ALL_APP_KEYS = [HUB_APP_KEY, DEFAULT_APP_KEY, 'wazuh'];
const LEGACY_USERS_TABLE = 'defectdojo_viewer_users';

const TABLES = {
  users: 'auth_users',
  credentials: 'auth_credentials',
  memberships: 'auth_app_memberships',
  sessions: 'auth_sessions',
  auditEvents: 'auth_audit_events',
  mfaConfig: 'auth_mfa_config',
  recoveryCodes: 'auth_mfa_recovery_codes',
  mfaChallenges: 'auth_mfa_challenges'
};

const normalizeText = (value) => String(value || '').trim();

const normalizeStatus = (status = '') => (
  normalizeText(status).toLowerCase() === 'suspended' ? 'suspended' : 'active'
);

const normalizeProducts = (products) => {
  const list = Array.isArray(products) ? products : [];
  return Array.from(new Set(list.map(item => normalizeText(item)).filter(Boolean)));
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return normalizeProducts(value);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeProducts(parsed) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const toIsoString = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const getAuthConnectionString = () => process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL || '';

const getLegacyConnectionString = () => {
  if (process.env.LEGACY_DATABASE_URL) return process.env.LEGACY_DATABASE_URL;
  const authUrl = process.env.AUTH_DATABASE_URL || '';
  const legacyUrl = process.env.DATABASE_URL || '';
  if (authUrl && legacyUrl && authUrl !== legacyUrl) return legacyUrl;
  return '';
};

const buildPoolConfig = (connectionString) => {
  const config = {};
  if (connectionString) config.connectionString = connectionString;
  const sslMode = normalizeText(process.env.PGSSLMODE).toLowerCase();
  if (sslMode && sslMode !== 'disable') {
    config.ssl = sslMode === 'no-verify' ? { rejectUnauthorized: false } : true;
  }
  return Object.keys(config).length > 0 ? config : undefined;
};

const normalizeUserRecord = (user = {}) => ({
  id: normalizeText(user.id) || crypto.randomUUID(),
  username: normalizeText(user.username),
  email: normalizeText(user.email),
  status: normalizeStatus(user.status || user.accountStatus),
  role: normalizeText(user.role) || 'viewer',
  products: normalizeProducts(user.products),
  salt: user.salt || '',
  hash: user.hash || user.password_hash || '',
  passwordAlgorithm: user.passwordAlgorithm || user.password_algorithm || 'pbkdf2-sha512:1000',
  passwordUpdatedAt: toIsoString(user.passwordUpdatedAt || user.password_updated_at),
  lastLoginAt: toIsoString(user.lastLoginAt || user.last_login_at),
  online: Boolean(user.online),
  presenceStatus: user.presenceStatus || user.presence_status || '',
  mfaEnabled: Boolean(user.mfaEnabled || user.mfa_enabled),
  mfaProvider: normalizeText(user.mfaProvider || user.mfa_provider),
  mfaEnabledAt: toIsoString(user.mfaEnabledAt || user.mfa_enabled_at),
  recoveryCodesRemaining: Number(user.recoveryCodesRemaining ?? user.recovery_codes_remaining ?? 0)
});

const buildPublicUser = (user = {}) => {
  const normalized = normalizeUserRecord(user);
  const accountStatus = normalizeStatus(normalized.status);
  const presenceStatus = accountStatus === 'suspended'
    ? 'offline'
    : (user.presenceStatus || (user.online ? 'online' : 'offline'));
  return {
    id: normalized.id,
    username: normalized.username,
    email: normalized.email,
    role: normalized.role,
    products: normalized.products,
    status: accountStatus === 'suspended' ? 'suspended' : presenceStatus,
    accountStatus,
    presenceStatus,
    lastLoginAt: normalized.lastLoginAt,
    passwordUpdatedAt: normalized.passwordUpdatedAt,
    mfaEnabled: normalized.mfaEnabled,
    mfaProvider: normalized.mfaProvider,
    mfaEnabledAt: normalized.mfaEnabledAt,
    recoveryCodesRemaining: normalized.recoveryCodesRemaining
  };
};

const readUsersFromDisk = (usersPath) => {
  if (!fs.existsSync(usersPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    return Array.isArray(data)
      ? data.map(normalizeUserRecord).filter(user => user.username)
      : [];
  } catch (err) {
      console.error('Auth Service: Error reading users from disk:', err);
    return [];
  }
};

const createDefaultAdminUser = (hashPassword, password = 'admin') => {
  const { salt, hash, algorithm } = hashPassword(password);
  return {
    username: 'admin',
    salt,
    hash,
    passwordAlgorithm: algorithm,
    email: '',
    role: 'admin',
    products: [],
    status: 'active',
    lastLoginAt: ''
  };
};

function createAuthStore({ dataDir, hashPassword }) {
  const usersPath = path.join(dataDir, 'users.json');
  const mfaPath = path.join(dataDir, 'mfa.json');
  const authConnectionString = getAuthConnectionString();
  const dbConfigured = Boolean(authConnectionString || process.env.PGHOST || process.env.PGDATABASE);
  const legacyConnectionString = getLegacyConnectionString();
  let pool = null;
  const fileSessions = new Map();
  const fileChallenges = new Map();
  const production = normalizeText(process.env.NODE_ENV).toLowerCase() === 'production';

  const createBootstrapAdminUser = () => {
    const configuredPassword = String(process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD || '');
    if (production && !configuredPassword) {
      throw new Error(
        'AUTH_BOOTSTRAP_ADMIN_PASSWORD is required when production auth storage has no users'
      );
    }
    const password = configuredPassword || 'admin';
    if (production) {
      console.log('Auth Service: Creating the initial administrator from AUTH_BOOTSTRAP_ADMIN_PASSWORD');
    }
    return createDefaultAdminUser(hashPassword, password);
  };

  const isDbEnabled = () => Boolean(pool);

  const withTransaction = async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  const mapUserRows = (rows) => rows.map(row => normalizeUserRecord({
    id: row.id,
    username: row.username,
    email: row.email,
    status: row.status,
    role: row.role,
    products: parseJsonArray(row.products),
    salt: row.salt,
    hash: row.password_hash,
    passwordAlgorithm: row.password_algorithm,
    passwordUpdatedAt: row.password_updated_at,
    lastLoginAt: row.last_login_at,
    online: row.online,
    presenceStatus: row.presence_status,
    mfaEnabled: row.mfa_enabled,
    mfaProvider: row.mfa_provider,
    mfaEnabledAt: row.mfa_enabled_at,
    recoveryCodesRemaining: row.recovery_codes_remaining
  }));

  const listUsersFromDb = async (appKey = DEFAULT_APP_KEY) => {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.status,
        u.last_login_at,
        c.salt,
        c.password_hash,
        c.password_algorithm,
        c.updated_at AS password_updated_at,
        (mf.user_id IS NOT NULL) AS mfa_enabled,
        mf.provider AS mfa_provider,
        mf.enabled_at AS mfa_enabled_at,
        COALESCE((
          SELECT count(*)::int FROM ${TABLES.recoveryCodes} rc
          WHERE rc.user_id = u.id AND rc.used_at IS NULL
        ), 0) AS recovery_codes_remaining,
        COALESCE(m.role, hub_m.role, 'viewer') AS role,
        COALESCE(m.products, hub_m.products, '[]'::jsonb) AS products,
        EXISTS (
          SELECT 1 FROM ${TABLES.sessions} s
          WHERE s.user_id = u.id
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
        ) AS online
      FROM ${TABLES.users} u
      LEFT JOIN ${TABLES.credentials} c ON c.user_id = u.id
      LEFT JOIN ${TABLES.mfaConfig} mf ON mf.user_id = u.id
      LEFT JOIN ${TABLES.memberships} m ON m.user_id = u.id AND m.app_key = $1
      LEFT JOIN ${TABLES.memberships} hub_m ON hub_m.user_id = u.id AND hub_m.app_key = $2
      ORDER BY u.username
    `, [appKey, HUB_APP_KEY]);
    return mapUserRows(rows);
  };

  const getUserByUsernameFromDb = async (username, appKey = DEFAULT_APP_KEY) => {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.status,
        u.last_login_at,
        c.salt,
        c.password_hash,
        c.password_algorithm,
        c.updated_at AS password_updated_at,
        (mf.user_id IS NOT NULL) AS mfa_enabled,
        mf.provider AS mfa_provider,
        mf.enabled_at AS mfa_enabled_at,
        COALESCE((
          SELECT count(*)::int FROM ${TABLES.recoveryCodes} rc
          WHERE rc.user_id = u.id AND rc.used_at IS NULL
        ), 0) AS recovery_codes_remaining,
        COALESCE(m.role, hub_m.role, 'viewer') AS role,
        COALESCE(m.products, hub_m.products, '[]'::jsonb) AS products,
        EXISTS (
          SELECT 1 FROM ${TABLES.sessions} s
          WHERE s.user_id = u.id
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
        ) AS online
      FROM ${TABLES.users} u
      LEFT JOIN ${TABLES.credentials} c ON c.user_id = u.id
      LEFT JOIN ${TABLES.mfaConfig} mf ON mf.user_id = u.id
      LEFT JOIN ${TABLES.memberships} m ON m.user_id = u.id AND m.app_key = $2
      LEFT JOIN ${TABLES.memberships} hub_m ON hub_m.user_id = u.id AND hub_m.app_key = $3
      WHERE u.username = $1
      LIMIT 1
    `, [username, appKey, HUB_APP_KEY]);
    return rows[0] ? mapUserRows(rows)[0] : null;
  };

  const upsertUserToDb = async (input = {}, options = {}) => {
    const user = normalizeUserRecord(input);
    if (!user.username) throw new Error('Username is required');
    const apps = Array.isArray(options.appKeys) && options.appKeys.length > 0 ? options.appKeys : ALL_APP_KEYS;
    await withTransaction(async (client) => {
      const existing = await client.query('SELECT id FROM auth_users WHERE username = $1', [user.username]);
      const userId = existing.rows[0]?.id || user.id || crypto.randomUUID();
      await client.query(`
        INSERT INTO ${TABLES.users} (id, username, email, status, last_login_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (username)
        DO UPDATE SET
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          last_login_at = COALESCE(EXCLUDED.last_login_at, ${TABLES.users}.last_login_at),
          updated_at = now()
      `, [
        userId,
        user.username,
        user.email,
        user.status,
        user.lastLoginAt ? new Date(user.lastLoginAt) : null
      ]);

      if (user.hash && user.salt) {
        await client.query(`
          INSERT INTO ${TABLES.credentials} (user_id, salt, password_hash, password_algorithm)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id)
          DO UPDATE SET
            salt = EXCLUDED.salt,
            password_hash = EXCLUDED.password_hash,
            password_algorithm = EXCLUDED.password_algorithm,
            updated_at = now()
        `, [userId, user.salt, user.hash, user.passwordAlgorithm || 'pbkdf2-sha512:1000']);
      }

      for (const appKey of apps) {
        await client.query(`
          INSERT INTO ${TABLES.memberships} (user_id, app_key, role, products)
          VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (user_id, app_key)
          DO UPDATE SET
            role = EXCLUDED.role,
            products = EXCLUDED.products,
            updated_at = now()
        `, [userId, appKey, user.role, JSON.stringify(user.products)]);
      }
    });
    return getUserByUsernameFromDb(user.username);
  };

  const deleteUserFromDb = async (username) => {
    const result = await pool.query(`DELETE FROM ${TABLES.users} WHERE username = $1`, [username]);
    return result.rowCount > 0;
  };

  const recordLoginInDb = async (username, lastLoginAt) => {
    await pool.query(`
      UPDATE ${TABLES.users}
      SET last_login_at = $2, updated_at = now()
      WHERE username = $1
    `, [username, new Date(lastLoginAt)]);
  };

  const createSessionInDb = async ({ userId, sid, expiresAt, userAgent = '', ipAddress = '' }) => {
    await pool.query(`
      INSERT INTO ${TABLES.sessions} (id, user_id, expires_at, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5)
    `, [sid, userId, new Date(expiresAt), userAgent, ipAddress]);
  };

  const revokeSessionInDb = async (sid) => {
    if (!sid) return false;
    const result = await pool.query(`
      UPDATE ${TABLES.sessions}
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = $1
    `, [sid]);
    return result.rowCount > 0;
  };

  const getActiveSessionFromDb = async (sid) => {
    if (!sid) return null;
    const { rows } = await pool.query(`
      SELECT
        s.id,
        s.user_id,
        s.expires_at,
        s.revoked_at,
        u.username,
        u.email,
        u.status
      FROM ${TABLES.sessions} s
      JOIN ${TABLES.users} u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'
      LIMIT 1
    `, [sid]);
    return rows[0] || null;
  };

  const readLegacyUsersFromPool = async (sourcePool) => {
    try {
      const { rows } = await sourcePool.query(`
        SELECT username, salt, password_hash, email, role, products, status, last_login_at
        FROM ${LEGACY_USERS_TABLE}
        ORDER BY username
      `);
      return rows.map(row => normalizeUserRecord({
        username: row.username,
        salt: row.salt,
        hash: row.password_hash,
        email: row.email,
        role: row.role,
        products: parseJsonArray(row.products),
        status: row.status,
        lastLoginAt: row.last_login_at,
        passwordAlgorithm: 'pbkdf2-sha512:1000'
      })).filter(user => user.username);
    } catch {
      return [];
    }
  };

  const readLegacyUsersFromDatabase = async () => {
    if (pool) {
      const sameDatabaseUsers = await readLegacyUsersFromPool(pool);
      if (sameDatabaseUsers.length > 0) return sameDatabaseUsers;
    }
    if (!legacyConnectionString) return [];
    const legacyPool = new Pool(buildPoolConfig(legacyConnectionString));
    try {
      return await readLegacyUsersFromPool(legacyPool);
    } finally {
      await legacyPool.end();
    }
  };

  const ensureSeedUsers = async () => {
    if (pool) {
      const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${TABLES.users}`);
      if (rows[0]?.count > 0) return;
      let seedUsers = await readLegacyUsersFromDatabase();
      if (seedUsers.length === 0) seedUsers = readUsersFromDisk(usersPath);
      if (seedUsers.length === 0) seedUsers = [createBootstrapAdminUser()];
      for (const user of seedUsers) {
        await upsertUserToDb(user);
      }
      console.log(`Auth Service: Seeded ${seedUsers.length} user(s) into auth storage`);
      return;
    }

    let users = readUsersFromDisk(usersPath);
    if (users.length === 0) {
      users = [createBootstrapAdminUser()];
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
      console.log(production
        ? 'Auth Service: Created initial administrator'
        : 'Auth Service: Created default admin user (password: admin)');
    }
  };

  const readMfaFile = () => {
    if (!fs.existsSync(mfaPath)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(mfaPath, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      console.error('Auth Service: Error reading MFA data from disk:', err);
      return {};
    }
  };

  const writeMfaFile = (data) => {
    fs.writeFileSync(mfaPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  };

  const getFileMfaEntry = (username) => readMfaFile()[normalizeText(username)] || null;

  const listFileUsers = () => {
    const users = readUsersFromDisk(usersPath);
    const mfaData = readMfaFile();
    const now = Date.now();
    return users.map(user => {
      const mfa = mfaData[user.username] || null;
      return {
        ...user,
        passwordUpdatedAt: user.passwordUpdatedAt || '',
        mfaEnabled: Boolean(mfa?.secretCiphertext),
        mfaProvider: mfa?.provider || '',
        mfaEnabledAt: mfa?.enabledAt || '',
        recoveryCodesRemaining: (mfa?.recoveryCodes || []).filter(code => !code.usedAt).length,
        presenceStatus: Array.from(fileSessions.values()).some(session => (
        session.username === user.username
        && !session.revokedAt
        && Date.parse(session.expiresAt) > now
      )) ? 'online' : 'offline'
      };
    });
  };

  const writeFileUsers = (users) => {
    fs.writeFileSync(usersPath, JSON.stringify(users.map(normalizeUserRecord), null, 2), 'utf8');
  };

  const getFileUserIndex = (username) => {
    const users = listFileUsers();
    return {
      users,
      index: users.findIndex(user => user.username === username)
    };
  };

  const upsertFileUser = async (input = {}) => {
    const user = normalizeUserRecord(input);
    const { users, index } = getFileUserIndex(user.username);
    if (index >= 0) {
      users[index] = {
        ...users[index],
        email: user.email,
        role: user.role,
        products: user.products,
        status: user.status,
        lastLoginAt: user.lastLoginAt || users[index].lastLoginAt
      };
      if (user.hash && user.salt) {
        users[index].salt = user.salt;
        users[index].hash = user.hash;
        users[index].passwordAlgorithm = user.passwordAlgorithm;
      }
    } else {
      users.push(user);
    }
    writeFileUsers(users);
    return listFileUsers().find(item => item.username === user.username) || null;
  };

  const initialize = async () => {
    if (dbConfigured) {
      pool = new Pool(buildPoolConfig(authConnectionString));
      await pool.query('SELECT 1');
      const lockClient = await pool.connect();
      try {
        await lockClient.query('SELECT pg_advisory_lock($1)', [732024061]);
        await runMigrations({ pool });
        await ensureSeedUsers();
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [732024061]).catch(() => {});
        lockClient.release();
      }
      console.log('Auth Service: Auth database connection initialized');
    } else {
      console.log('Auth Service: Running in file-storage mode');
      await ensureSeedUsers();
    }
  };

  const checkHealth = async () => {
    if (!pool) return { ok: true, storage: 'json' };
    await pool.query('SELECT 1');
    return { ok: true, storage: 'auth-postgresql' };
  };

  const listUsers = async (appKey = DEFAULT_APP_KEY) => (
    pool ? listUsersFromDb(appKey) : listFileUsers()
  );

  const getUserByUsername = async (username, appKey = DEFAULT_APP_KEY) => {
    const normalizedUsername = normalizeText(username);
    if (!normalizedUsername) return null;
    if (pool) return getUserByUsernameFromDb(normalizedUsername, appKey);
    return listFileUsers().find(user => user.username === normalizedUsername) || null;
  };

  const upsertUser = async (input = {}, options = {}) => (
    pool ? upsertUserToDb(input, options) : upsertFileUser(input)
  );

  const deleteUser = async (username) => {
    const normalizedUsername = normalizeText(username);
    if (!normalizedUsername) return false;
    if (pool) return deleteUserFromDb(normalizedUsername);
    const { users, index } = getFileUserIndex(normalizedUsername);
    if (index < 0) return false;
    users.splice(index, 1);
    writeFileUsers(users);
    const mfaData = readMfaFile();
    delete mfaData[normalizedUsername];
    writeMfaFile(mfaData);
    for (const [sid, session] of fileSessions.entries()) {
      if (session.username === normalizedUsername) fileSessions.delete(sid);
    }
    return true;
  };

  const recordLogin = async (username, lastLoginAt) => {
    if (pool) return recordLoginInDb(username, lastLoginAt);
    const { users, index } = getFileUserIndex(username);
    if (index >= 0) {
      users[index].lastLoginAt = lastLoginAt;
      writeFileUsers(users);
    }
  };

  const createSession = async ({ user, sid, expiresAt, userAgent = '', ipAddress = '' }) => {
    if (pool) {
      await createSessionInDb({ userId: user.id, sid, expiresAt, userAgent, ipAddress });
      return;
    }
    fileSessions.set(sid, {
      sid,
      userId: user.id,
      username: user.username,
      expiresAt,
      revokedAt: null,
      userAgent,
      ipAddress
    });
  };

  const revokeSession = async (sid) => {
    if (pool) return revokeSessionInDb(sid);
    const session = fileSessions.get(sid);
    if (!session) return false;
    session.revokedAt = new Date().toISOString();
    fileSessions.set(sid, session);
    return true;
  };

  const getActiveSession = async (sid) => {
    if (pool) return getActiveSessionFromDb(sid);
    const session = fileSessions.get(sid);
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = await getUserByUsername(session.username);
    if (!user || user.status === 'suspended') return null;
    return {
      id: sid,
      user_id: user.id,
      username: user.username,
      email: user.email,
      status: user.status
    };
  };

  const updateEmail = async (username, email) => {
    const normalizedUsername = normalizeText(username);
    const normalizedEmail = normalizeText(email);
    if (pool) {
      await pool.query(`
        UPDATE ${TABLES.users}
        SET email = $2, updated_at = now()
        WHERE username = $1
      `, [normalizedUsername, normalizedEmail]);
      return getUserByUsernameFromDb(normalizedUsername);
    }
    const { users, index } = getFileUserIndex(normalizedUsername);
    if (index < 0) return null;
    users[index].email = normalizedEmail;
    writeFileUsers(users);
    return getUserByUsername(normalizedUsername);
  };

  const updatePassword = async (username, { salt, hash, passwordAlgorithm }) => {
    const normalizedUsername = normalizeText(username);
    const updatedAt = new Date().toISOString();
    if (pool) {
      const result = await pool.query(`
        UPDATE ${TABLES.credentials} c
        SET salt = $2, password_hash = $3, password_algorithm = $4, updated_at = now()
        FROM ${TABLES.users} u
        WHERE c.user_id = u.id AND u.username = $1
      `, [normalizedUsername, salt, hash, passwordAlgorithm]);
      return result.rowCount > 0;
    }
    const { users, index } = getFileUserIndex(normalizedUsername);
    if (index < 0) return false;
    users[index] = { ...users[index], salt, hash, passwordAlgorithm, passwordUpdatedAt: updatedAt };
    writeFileUsers(users);
    return true;
  };

  const revokeUserSessions = async (username, { exceptSid = '' } = {}) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      const result = await pool.query(`
        UPDATE ${TABLES.sessions} s
        SET revoked_at = COALESCE(s.revoked_at, now())
        FROM ${TABLES.users} u
        WHERE s.user_id = u.id
          AND u.username = $1
          AND s.revoked_at IS NULL
          AND ($2 = '' OR s.id <> $2)
      `, [normalizedUsername, exceptSid]);
      return result.rowCount;
    }
    let count = 0;
    for (const [sid, session] of fileSessions.entries()) {
      if (session.username !== normalizedUsername || session.revokedAt || (exceptSid && sid === exceptSid)) continue;
      session.revokedAt = new Date().toISOString();
      fileSessions.set(sid, session);
      count += 1;
    }
    return count;
  };

  const getMfaConfig = async (username) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      const { rows } = await pool.query(`
        SELECT
          u.id AS user_id,
          mf.provider,
          mf.secret_ciphertext,
          mf.secret_iv,
          mf.secret_tag,
          mf.enabled_at,
          mf.last_used_counter,
          mf.failed_attempts,
          mf.locked_until,
          COALESCE((
            SELECT count(*)::int FROM ${TABLES.recoveryCodes} rc
            WHERE rc.user_id = u.id AND rc.used_at IS NULL
          ), 0) AS recovery_codes_remaining
        FROM ${TABLES.users} u
        JOIN ${TABLES.mfaConfig} mf ON mf.user_id = u.id
        WHERE u.username = $1
        LIMIT 1
      `, [normalizedUsername]);
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        userId: row.user_id,
        provider: row.provider,
        secretCiphertext: row.secret_ciphertext,
        secretIv: row.secret_iv,
        secretTag: row.secret_tag,
        enabledAt: toIsoString(row.enabled_at),
        lastUsedCounter: row.last_used_counter === null ? null : Number(row.last_used_counter),
        failedAttempts: Number(row.failed_attempts || 0),
        lockedUntil: toIsoString(row.locked_until),
        recoveryCodesRemaining: Number(row.recovery_codes_remaining || 0)
      };
    }
    const entry = getFileMfaEntry(normalizedUsername);
    if (!entry?.secretCiphertext) return null;
    const user = await getUserByUsername(normalizedUsername);
    return {
      userId: user?.id || '',
      ...entry,
      recoveryCodesRemaining: (entry.recoveryCodes || []).filter(code => !code.usedAt).length
    };
  };

  const saveMfaConfig = async (username, config = {}, recoveryCodeHashes = []) => {
    const normalizedUsername = normalizeText(username);
    const enabledAt = config.enabledAt || new Date().toISOString();
    if (pool) {
      await withTransaction(async (client) => {
        const userResult = await client.query(`SELECT id FROM ${TABLES.users} WHERE username = $1`, [normalizedUsername]);
        const userId = userResult.rows[0]?.id;
        if (!userId) throw new Error('User not found');
        await client.query(`
          INSERT INTO ${TABLES.mfaConfig} (
            user_id, provider, secret_ciphertext, secret_iv, secret_tag,
            enabled_at, last_used_counter, failed_attempts, locked_until
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL)
          ON CONFLICT (user_id) DO UPDATE SET
            provider = EXCLUDED.provider,
            secret_ciphertext = EXCLUDED.secret_ciphertext,
            secret_iv = EXCLUDED.secret_iv,
            secret_tag = EXCLUDED.secret_tag,
            enabled_at = EXCLUDED.enabled_at,
            last_used_counter = EXCLUDED.last_used_counter,
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        `, [
          userId,
          config.provider,
          config.secretCiphertext,
          config.secretIv,
          config.secretTag,
          new Date(enabledAt),
          config.lastUsedCounter ?? null
        ]);
        await client.query(`DELETE FROM ${TABLES.recoveryCodes} WHERE user_id = $1`, [userId]);
        for (const codeHash of recoveryCodeHashes) {
          await client.query(`
            INSERT INTO ${TABLES.recoveryCodes} (user_id, code_hash)
            VALUES ($1, $2)
          `, [userId, codeHash]);
        }
      });
      return getMfaConfig(normalizedUsername);
    }
    const data = readMfaFile();
    data[normalizedUsername] = {
      provider: config.provider,
      secretCiphertext: config.secretCiphertext,
      secretIv: config.secretIv,
      secretTag: config.secretTag,
      enabledAt,
      lastUsedCounter: config.lastUsedCounter ?? null,
      failedAttempts: 0,
      lockedUntil: '',
      recoveryCodes: recoveryCodeHashes.map(codeHash => ({ codeHash, usedAt: '' }))
    };
    writeMfaFile(data);
    return getMfaConfig(normalizedUsername);
  };

  const clearMfa = async (username) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      return withTransaction(async (client) => {
        const userResult = await client.query(`SELECT id FROM ${TABLES.users} WHERE username = $1`, [normalizedUsername]);
        const userId = userResult.rows[0]?.id;
        if (!userId) return false;
        await client.query(`DELETE FROM ${TABLES.recoveryCodes} WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM ${TABLES.mfaChallenges} WHERE user_id = $1`, [userId]);
        const result = await client.query(`DELETE FROM ${TABLES.mfaConfig} WHERE user_id = $1`, [userId]);
        return result.rowCount > 0;
      });
    }
    const data = readMfaFile();
    const existed = Boolean(data[normalizedUsername]);
    delete data[normalizedUsername];
    writeMfaFile(data);
    for (const [hash, challenge] of fileChallenges.entries()) {
      if (challenge.username === normalizedUsername) fileChallenges.delete(hash);
    }
    return existed;
  };

  const markTotpUsed = async (username, counter) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      const result = await pool.query(`
        UPDATE ${TABLES.mfaConfig} mf
        SET last_used_counter = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()
        FROM ${TABLES.users} u
        WHERE mf.user_id = u.id
          AND u.username = $1
          AND (mf.last_used_counter IS NULL OR mf.last_used_counter < $2)
        RETURNING mf.user_id
      `, [normalizedUsername, counter]);
      return result.rowCount > 0;
    }
    const data = readMfaFile();
    const entry = data[normalizedUsername];
    if (!entry || (entry.lastUsedCounter !== null && Number(entry.lastUsedCounter) >= Number(counter))) return false;
    entry.lastUsedCounter = counter;
    entry.failedAttempts = 0;
    entry.lockedUntil = '';
    writeMfaFile(data);
    return true;
  };

  const recordMfaFailure = async (username) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      const { rows } = await pool.query(`
        UPDATE ${TABLES.mfaConfig} mf
        SET
          failed_attempts = mf.failed_attempts + 1,
          locked_until = CASE
            WHEN mf.failed_attempts + 1 >= 10 THEN now() + interval '15 minutes'
            ELSE mf.locked_until
          END,
          updated_at = now()
        FROM ${TABLES.users} u
        WHERE mf.user_id = u.id AND u.username = $1
        RETURNING mf.failed_attempts, mf.locked_until
      `, [normalizedUsername]);
      return rows[0] ? {
        failedAttempts: Number(rows[0].failed_attempts || 0),
        lockedUntil: toIsoString(rows[0].locked_until)
      } : null;
    }
    const data = readMfaFile();
    const entry = data[normalizedUsername];
    if (!entry) return null;
    entry.failedAttempts = Number(entry.failedAttempts || 0) + 1;
    if (entry.failedAttempts >= 10) entry.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    writeMfaFile(data);
    return { failedAttempts: entry.failedAttempts, lockedUntil: entry.lockedUntil || '' };
  };

  const resetMfaFailures = async (username) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      await pool.query(`
        UPDATE ${TABLES.mfaConfig} mf
        SET failed_attempts = 0, locked_until = NULL, updated_at = now()
        FROM ${TABLES.users} u
        WHERE mf.user_id = u.id AND u.username = $1
      `, [normalizedUsername]);
      return;
    }
    const data = readMfaFile();
    if (!data[normalizedUsername]) return;
    data[normalizedUsername].failedAttempts = 0;
    data[normalizedUsername].lockedUntil = '';
    writeMfaFile(data);
  };

  const consumeRecoveryCode = async (username, codeHash) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      return withTransaction(async (client) => {
        const result = await client.query(`
          UPDATE ${TABLES.recoveryCodes} rc
          SET used_at = now()
          FROM ${TABLES.users} u
          WHERE rc.user_id = u.id
            AND u.username = $1
            AND rc.code_hash = $2
            AND rc.used_at IS NULL
          RETURNING rc.user_id
        `, [normalizedUsername, codeHash]);
        if (result.rowCount === 0) return null;
        const remaining = await client.query(`
          SELECT count(*)::int AS count FROM ${TABLES.recoveryCodes}
          WHERE user_id = $1 AND used_at IS NULL
        `, [result.rows[0].user_id]);
        return Number(remaining.rows[0]?.count || 0);
      });
    }
    const data = readMfaFile();
    const entry = data[normalizedUsername];
    const code = entry?.recoveryCodes?.find(item => item.codeHash === codeHash && !item.usedAt);
    if (!code) return null;
    code.usedAt = new Date().toISOString();
    writeMfaFile(data);
    return entry.recoveryCodes.filter(item => !item.usedAt).length;
  };

  const createMfaChallenge = async ({ id, username, purpose, tokenHash, payload = {}, expiresAt }) => {
    const normalizedUsername = normalizeText(username);
    if (pool) {
      const result = await pool.query(`
        INSERT INTO ${TABLES.mfaChallenges} (id, user_id, purpose, token_hash, payload, expires_at)
        SELECT $1, u.id, $3, $4, $5::jsonb, $6
        FROM ${TABLES.users} u
        WHERE u.username = $2
        RETURNING id
      `, [id, normalizedUsername, purpose, tokenHash, JSON.stringify(payload), new Date(expiresAt)]);
      return result.rowCount > 0;
    }
    fileChallenges.set(tokenHash, {
      id,
      username: normalizedUsername,
      purpose,
      payload,
      attemptCount: 0,
      expiresAt,
      consumedAt: ''
    });
    return true;
  };

  const getMfaChallenge = async (tokenHash, purpose) => {
    if (pool) {
      const { rows } = await pool.query(`
        SELECT c.id, u.username, c.purpose, c.payload, c.attempt_count, c.expires_at, c.consumed_at
        FROM ${TABLES.mfaChallenges} c
        JOIN ${TABLES.users} u ON u.id = c.user_id
        WHERE c.token_hash = $1 AND c.purpose = $2
          AND c.consumed_at IS NULL AND c.expires_at > now()
        LIMIT 1
      `, [tokenHash, purpose]);
      if (!rows[0]) return null;
      return {
        id: rows[0].id,
        username: rows[0].username,
        purpose: rows[0].purpose,
        payload: rows[0].payload || {},
        attemptCount: Number(rows[0].attempt_count || 0),
        expiresAt: toIsoString(rows[0].expires_at),
        consumedAt: toIsoString(rows[0].consumed_at)
      };
    }
    const challenge = fileChallenges.get(tokenHash);
    if (!challenge || challenge.purpose !== purpose || challenge.consumedAt || Date.parse(challenge.expiresAt) <= Date.now()) return null;
    return { ...challenge };
  };

  const recordMfaChallengeFailure = async (tokenHash) => {
    if (pool) {
      const { rows } = await pool.query(`
        UPDATE ${TABLES.mfaChallenges}
        SET attempt_count = attempt_count + 1,
            consumed_at = CASE WHEN attempt_count + 1 >= 5 THEN now() ELSE consumed_at END
        WHERE token_hash = $1 AND consumed_at IS NULL
        RETURNING attempt_count, consumed_at
      `, [tokenHash]);
      return rows[0] ? {
        attemptCount: Number(rows[0].attempt_count || 0),
        consumed: Boolean(rows[0].consumed_at)
      } : null;
    }
    const challenge = fileChallenges.get(tokenHash);
    if (!challenge || challenge.consumedAt) return null;
    challenge.attemptCount += 1;
    if (challenge.attemptCount >= 5) challenge.consumedAt = new Date().toISOString();
    fileChallenges.set(tokenHash, challenge);
    return { attemptCount: challenge.attemptCount, consumed: Boolean(challenge.consumedAt) };
  };

  const consumeMfaChallenge = async (tokenHash) => {
    if (pool) {
      const result = await pool.query(`
        UPDATE ${TABLES.mfaChallenges}
        SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
      `, [tokenHash]);
      return result.rowCount > 0;
    }
    const challenge = fileChallenges.get(tokenHash);
    if (!challenge || challenge.consumedAt || Date.parse(challenge.expiresAt) <= Date.now()) return false;
    challenge.consumedAt = new Date().toISOString();
    fileChallenges.set(tokenHash, challenge);
    return true;
  };

  const saveAuditEvent = async ({ actorUsername = '', targetUsername = '', action, metadata = {} }) => {
    if (!action) return;
    if (pool) {
      await pool.query(`
        INSERT INTO ${TABLES.auditEvents} (actor_username, target_username, action, metadata)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [actorUsername, targetUsername, action, JSON.stringify(metadata)]);
    }
  };

  const close = async () => {
    if (!pool) return;
    await pool.end();
    pool = null;
  };

  return {
    initialize,
    close,
    isDbEnabled,
    checkHealth,
    listUsers,
    getUserByUsername,
    upsertUser,
    deleteUser,
    recordLogin,
    createSession,
    revokeSession,
    revokeUserSessions,
    getActiveSession,
    updateEmail,
    updatePassword,
    getMfaConfig,
    saveMfaConfig,
    clearMfa,
    markTotpUsed,
    recordMfaFailure,
    resetMfaFailures,
    consumeRecoveryCode,
    createMfaChallenge,
    getMfaChallenge,
    recordMfaChallengeFailure,
    consumeMfaChallenge,
    saveAuditEvent,
    buildPublicUser,
    normalizeUserRecord,
    normalizeStatus
  };
}

module.exports = {
  createAuthStore,
  buildPublicUser,
  normalizeUserRecord,
  normalizeStatus,
  DEFAULT_APP_KEY,
  HUB_APP_KEY,
  ALL_APP_KEYS
};
