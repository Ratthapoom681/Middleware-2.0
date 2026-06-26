const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DEFAULT_APP_KEY = 'defectdojo';
const HUB_APP_KEY = 'hub';
const ALL_APP_KEYS = [HUB_APP_KEY, DEFAULT_APP_KEY, 'wazuh'];
const LEGACY_USERS_TABLE = 'defectdojo_viewer_users';

const TABLES = {
  users: 'auth_users',
  credentials: 'auth_credentials',
  memberships: 'auth_app_memberships',
  sessions: 'auth_sessions',
  auditEvents: 'auth_audit_events'
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
  lastLoginAt: toIsoString(user.lastLoginAt || user.last_login_at),
  online: Boolean(user.online),
  presenceStatus: user.presenceStatus || user.presence_status || ''
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
    lastLoginAt: normalized.lastLoginAt
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

const createDefaultAdminUser = (hashPassword) => {
  const { salt, hash, algorithm } = hashPassword('admin');
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
  const authConnectionString = getAuthConnectionString();
  const dbConfigured = Boolean(authConnectionString || process.env.PGHOST || process.env.PGDATABASE);
  const legacyConnectionString = getLegacyConnectionString();
  let pool = null;
  const fileSessions = new Map();

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

  const initializeSchema = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.users} (
        id text PRIMARY KEY,
        username text UNIQUE NOT NULL CHECK (length(trim(username)) > 0),
        email text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'active',
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.credentials} (
        user_id text PRIMARY KEY REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
        salt text NOT NULL,
        password_hash text NOT NULL,
        password_algorithm text NOT NULL DEFAULT 'pbkdf2-sha512:310000',
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.memberships} (
        user_id text NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
        app_key text NOT NULL,
        role text NOT NULL DEFAULT 'viewer',
        products jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, app_key)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.sessions} (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
        issued_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        user_agent text NOT NULL DEFAULT '',
        ip_address text NOT NULL DEFAULT ''
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLES.auditEvents} (
        id bigserial PRIMARY KEY,
        actor_username text NOT NULL DEFAULT '',
        target_username text NOT NULL DEFAULT '',
        action text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
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
    lastLoginAt: row.last_login_at,
    online: row.online,
    presenceStatus: row.presence_status
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
      if (seedUsers.length === 0) seedUsers = [createDefaultAdminUser(hashPassword)];
      for (const user of seedUsers) {
        await upsertUserToDb(user);
      }
      console.log(`Auth Service: Seeded ${seedUsers.length} user(s) into auth storage`);
      return;
    }

    let users = readUsersFromDisk(usersPath);
    if (users.length === 0) {
      users = [createDefaultAdminUser(hashPassword)];
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
      console.log('Auth Service: Created default admin user (password: admin)');
    }
  };

  const listFileUsers = () => {
    const users = readUsersFromDisk(usersPath);
    const now = Date.now();
    return users.map(user => ({
      ...user,
      presenceStatus: Array.from(fileSessions.values()).some(session => (
        session.username === user.username
        && !session.revokedAt
        && Date.parse(session.expiresAt) > now
      )) ? 'online' : 'offline'
    }));
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
        await initializeSchema();
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
    getActiveSession,
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
