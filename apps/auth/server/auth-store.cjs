const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { runMigrations } = require('./migration-runner.cjs');
const {
  SYSTEM_ADMIN_ROLE_ID,
  VIEWER_ROLE_ID,
  ALL_PERMISSION_KEYS,
  VIEWER_PERMISSIONS,
  PERMISSION_BY_KEY,
  buildAccess,
  normalizePermissionKeys,
  normalizeProductScope
} = require('../../../packages/access-control/index.cjs');

const DEFAULT_APP_KEY = 'defectdojo';
const HUB_APP_KEY = 'hub';
const ALL_APP_KEYS = [HUB_APP_KEY, DEFAULT_APP_KEY, 'wazuh'];
const LEGACY_USERS_TABLE = 'defectdojo_viewer_users';
const PUBLIC_USER_ID_PATTERN = /^[0-9]+$/;

const TABLES = {
  users: 'auth_users',
  credentials: 'auth_credentials',
  memberships: 'auth_app_memberships',
  roles: 'auth_roles',
  rolePermissions: 'auth_role_permissions',
  userRoles: 'auth_user_role_assignments',
  sessions: 'auth_sessions',
  auditEvents: 'auth_audit_events',
  mfaConfig: 'auth_mfa_config',
  recoveryCodes: 'auth_mfa_recovery_codes',
  mfaChallenges: 'auth_mfa_challenges'
};

const normalizeText = (value) => String(value || '').trim();

const normalizePublicUserId = (value) => {
  const normalized = normalizeText(value);
  if (!PUBLIC_USER_ID_PATTERN.test(normalized)) return '';
  try {
    const numericId = BigInt(normalized);
    return numericId > 0n ? numericId.toString() : '';
  } catch {
    return '';
  }
};

const formatPublicUserId = value => BigInt(value).toString();

const normalizeStatus = (status = '') => (
  normalizeText(status).toLowerCase() === 'suspended' ? 'suspended' : 'active'
);

const normalizeProducts = (products) => {
  const list = Array.isArray(products) ? products : [];
  return Array.from(new Set(list.map(item => normalizeText(item)).filter(Boolean)));
};

const normalizeProductScopeMode = (mode, role, products) => (
  normalizeProductScope({ mode, products }, products, role).mode
);

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
  userId: normalizePublicUserId(user.userId || user.publicId || user.public_id),
  username: normalizeText(user.username),
  email: normalizeText(user.email),
  status: normalizeStatus(user.status || user.accountStatus),
  role: normalizeText(user.role) || 'viewer',
  roleId: normalizeText(user.roleId || user.role_id)
    || (normalizeText(user.role) === 'admin' ? SYSTEM_ADMIN_ROLE_ID : VIEWER_ROLE_ID),
  roleName: normalizeText(user.roleName || user.role_name)
    || (normalizeText(user.role) === 'admin' ? 'System Administrator' : 'Viewer'),
  roleSystem: Boolean(user.roleSystem ?? user.role_system ?? normalizeText(user.role) === 'admin'),
  permissions: normalizePermissionKeys(
    user.permissions || user.access?.permissions || (normalizeText(user.role) === 'viewer' ? VIEWER_PERMISSIONS : []),
    { allowSystemOnly: Boolean(user.roleSystem ?? user.role_system ?? normalizeText(user.role) === 'admin') }
  ),
  products: normalizeProducts(user.products),
  productScopeMode: normalizeProductScopeMode(
    user.productScopeMode || user.product_scope_mode || user.productScope?.mode || user.access?.productScope?.mode,
    normalizeText(user.role),
    normalizeProducts(user.productScope?.products || user.access?.productScope?.products || user.products)
  ),
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
  const access = user.access || buildAccess({
    role: {
      id: normalized.roleId,
      name: normalized.roleName,
      system: normalized.roleSystem
    },
    permissions: normalized.permissions,
    productScope: {
      mode: normalized.productScopeMode,
      products: normalized.products
    },
    legacyRole: normalized.role
  });
  return {
    id: normalized.id,
    userId: normalized.userId,
    username: normalized.username,
    email: normalized.email,
    role: normalized.role,
    products: normalized.products,
    roleId: access.role.id,
    roleName: access.role.name,
    productScopeMode: access.productScope.mode,
    access,
    status: accountStatus === 'suspended' ? 'suspended' : presenceStatus,
    accountStatus,
    presenceStatus,
    lastLoginAt: normalized.lastLoginAt,
    passwordUpdatedAt: normalized.passwordUpdatedAt,
    mfaEnabled: normalized.mfaEnabled,
    mfaProvider: normalized.mfaProvider,
    mfaEnabledAt: normalized.mfaEnabledAt
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
  const userIdSequencePath = path.join(dataDir, 'user-id-sequence.json');
  const mfaPath = path.join(dataDir, 'mfa.json');
  const rolesPath = path.join(dataDir, 'roles.json');
  const auditPath = path.join(dataDir, 'access-audit.json');
  const authConnectionString = getAuthConnectionString();
  const dbConfigured = Boolean(authConnectionString || process.env.PGHOST || process.env.PGDATABASE);
  const legacyConnectionString = getLegacyConnectionString();
  let pool = null;
  const fileSessions = new Map();
  const fileChallenges = new Map();
  const production = normalizeText(process.env.NODE_ENV).toLowerCase() === 'production';

  const readFileUserIdSequence = () => {
    if (!fs.existsSync(userIdSequencePath)) return 0n;
    try {
      const data = JSON.parse(fs.readFileSync(userIdSequencePath, 'utf8'));
      const value = normalizeText(data?.lastAllocated);
      if (!PUBLIC_USER_ID_PATTERN.test(value)) return 0n;
      const numericValue = BigInt(value);
      return numericValue > 0n ? numericValue : 0n;
    } catch {
      return 0n;
    }
  };

  const writeFileUserIdSequence = (lastAllocated) => {
    fs.writeFileSync(
      userIdSequencePath,
      JSON.stringify({ lastAllocated: BigInt(lastAllocated).toString() }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
  };

  const getMaxFileUserId = (users = []) => users.reduce((maximum, user) => {
    const userId = normalizePublicUserId(user?.userId ?? user?.publicId ?? user?.public_id);
    if (!userId) return maximum;
    const numericId = BigInt(userId);
    return numericId > maximum ? numericId : maximum;
  }, 0n);

  const allocateFileUserId = (users = []) => {
    const storedMaximum = readFileUserIdSequence();
    const userMaximum = getMaxFileUserId(users);
    const next = (storedMaximum > userMaximum ? storedMaximum : userMaximum) + 1n;
    writeFileUserIdSequence(next);
    return formatPublicUserId(next);
  };

  const ensureFileUserIds = () => {
    if (!fs.existsSync(usersPath)) return;
    let rawUsers;
    try {
      rawUsers = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(rawUsers)) return;

    const validUsers = rawUsers.filter(user => normalizeText(user?.username));
    const normalizedUsers = [];
    const seenPublicIds = new Set();
    const seenInternalIds = new Set();
    const storedMaximum = readFileUserIdSequence();
    const userMaximum = getMaxFileUserId(validUsers);
    let lastAllocated = storedMaximum > userMaximum ? storedMaximum : userMaximum;
    let changed = validUsers.length !== rawUsers.length;

    for (const rawUser of validUsers) {
      const user = normalizeUserRecord(rawUser);
      const rawInternalId = normalizeText(rawUser.id);
      if (!rawInternalId || seenInternalIds.has(rawInternalId)) {
        user.id = crypto.randomUUID();
        changed = true;
      } else {
        user.id = rawInternalId;
      }
      seenInternalIds.add(user.id);

      const rawPublicIdValue = rawUser.userId ?? rawUser.publicId ?? rawUser.public_id;
      const rawPublicId = normalizePublicUserId(rawPublicIdValue);
      if (!rawPublicId || seenPublicIds.has(rawPublicId)) {
        lastAllocated += 1n;
        user.userId = formatPublicUserId(lastAllocated);
        changed = true;
      } else {
        user.userId = rawPublicId;
        if (normalizeText(rawPublicIdValue) !== rawPublicId) changed = true;
      }
      seenPublicIds.add(user.userId);
      normalizedUsers.push(user);
    }

    if (changed) fs.writeFileSync(usersPath, JSON.stringify(normalizedUsers, null, 2), 'utf8');
    if (readFileUserIdSequence() !== lastAllocated) writeFileUserIdSequence(lastAllocated);
  };

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

  const createStoreError = (message, status = 400, code = 'invalid_request', details = {}) => {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    error.details = details;
    return error;
  };

  const normalizeRoleRecord = (role = {}) => {
    const system = Boolean(role.system ?? role.isSystem ?? role.is_system) || role.id === SYSTEM_ADMIN_ROLE_ID;
    return {
      id: normalizeText(role.id) || crypto.randomUUID(),
      name: normalizeText(role.name),
      description: normalizeText(role.description),
      system,
      permissions: system
        ? [...ALL_PERMISSION_KEYS]
        : normalizePermissionKeys(role.permissions),
      assignedUserCount: Number(role.assignedUserCount ?? role.assigned_user_count ?? 0),
      createdBy: normalizeText(role.createdBy || role.created_by),
      updatedBy: normalizeText(role.updatedBy || role.updated_by),
      createdAt: toIsoString(role.createdAt || role.created_at),
      updatedAt: toIsoString(role.updatedAt || role.updated_at)
    };
  };

  const validateCustomRole = ({ name, description = '', permissions = [] }, { currentRoleId = '' } = {}) => {
    const normalizedName = normalizeText(name);
    const normalizedDescription = normalizeText(description);
    if (normalizedName.length < 2 || normalizedName.length > 80) {
      throw createStoreError('Role name must be between 2 and 80 characters', 400, 'invalid_role_name');
    }
    if (normalizedDescription.length > 240) {
      throw createStoreError('Role description must be 240 characters or fewer', 400, 'invalid_role_description');
    }
    const requested = Array.isArray(permissions) ? permissions.map(normalizeText).filter(Boolean) : [];
    const unknown = requested.filter(key => !PERMISSION_BY_KEY.has(key));
    if (unknown.length > 0) {
      throw createStoreError('One or more permissions are not recognized', 400, 'unknown_permission', { permissions: unknown });
    }
    const systemOnly = requested.filter(key => PERMISSION_BY_KEY.get(key)?.systemOnly);
    if (systemOnly.length > 0) {
      throw createStoreError('Identity-management permissions are reserved for System Administrator', 400, 'system_permission', { permissions: systemOnly });
    }
    return {
      id: currentRoleId,
      name: normalizedName,
      description: normalizedDescription,
      permissions: normalizePermissionKeys(requested)
    };
  };

  const readFileRoles = () => {
    if (!fs.existsSync(rolesPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
      return Array.isArray(parsed) ? parsed.map(normalizeRoleRecord).filter(role => role.id && role.name) : [];
    } catch (error) {
      console.error('Auth Service: Error reading role data from disk:', error);
      return [];
    }
  };

  const writeFileRoles = roles => {
    fs.writeFileSync(rolesPath, JSON.stringify(roles.map(normalizeRoleRecord), null, 2), 'utf8');
  };

  const readFileAudit = () => {
    if (!fs.existsSync(auditPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeFileAudit = events => {
    fs.writeFileSync(auditPath, JSON.stringify(events.slice(-1000), null, 2), 'utf8');
  };

  const ensureRbacRolesInDb = async () => {
    await withTransaction(async client => {
      await client.query(`
        INSERT INTO ${TABLES.roles} (id, name, description, is_system, created_by, updated_by)
        VALUES ($1, 'System Administrator', 'Protected role with complete access to every workspace.', true, 'system', 'system')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          is_system = true,
          updated_at = now()
      `, [SYSTEM_ADMIN_ROLE_ID]);
      const viewer = await client.query(`SELECT id FROM ${TABLES.roles} WHERE id = $1`, [VIEWER_ROLE_ID]);
      if (viewer.rows.length === 0) {
        await client.query(`
          INSERT INTO ${TABLES.roles} (id, name, description, is_system, created_by, updated_by)
          VALUES ($1, 'Viewer', 'Read-only access matching the previous Viewer role.', false, 'migration', 'migration')
        `, [VIEWER_ROLE_ID]);
        for (const permission of VIEWER_PERMISSIONS) {
          await client.query(`
            INSERT INTO ${TABLES.rolePermissions} (role_id, permission_key)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [VIEWER_ROLE_ID, permission]);
        }
      }
      await client.query(`DELETE FROM ${TABLES.rolePermissions} WHERE role_id = $1`, [SYSTEM_ADMIN_ROLE_ID]);
      for (const permission of ALL_PERMISSION_KEYS) {
        await client.query(`
          INSERT INTO ${TABLES.rolePermissions} (role_id, permission_key)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [SYSTEM_ADMIN_ROLE_ID, permission]);
      }
    });
  };

  const ensureLegacyRoleAssignmentsInDb = async () => {
    await pool.query(`
      INSERT INTO ${TABLES.userRoles} (user_id, role_id, assigned_by)
      SELECT
        u.id,
        CASE WHEN bool_or(m.role = 'admin') THEN $1 ELSE $2 END,
        'migration'
      FROM ${TABLES.users} u
      LEFT JOIN ${TABLES.memberships} m ON m.user_id = u.id
      GROUP BY u.id
      ON CONFLICT (user_id) DO NOTHING
    `, [SYSTEM_ADMIN_ROLE_ID, VIEWER_ROLE_ID]);
  };

  const ensureFileRbac = () => {
    const now = new Date().toISOString();
    const roles = readFileRoles();
    const byId = new Map(roles.map(role => [role.id, role]));
    byId.set(SYSTEM_ADMIN_ROLE_ID, normalizeRoleRecord({
      ...(byId.get(SYSTEM_ADMIN_ROLE_ID) || {}),
      id: SYSTEM_ADMIN_ROLE_ID,
      name: 'System Administrator',
      description: 'Protected role with complete access to every workspace.',
      system: true,
      permissions: ALL_PERMISSION_KEYS,
      createdBy: byId.get(SYSTEM_ADMIN_ROLE_ID)?.createdBy || 'system',
      updatedBy: 'system',
      createdAt: byId.get(SYSTEM_ADMIN_ROLE_ID)?.createdAt || now,
      updatedAt: now
    }));
    if (!byId.has(VIEWER_ROLE_ID)) {
      byId.set(VIEWER_ROLE_ID, normalizeRoleRecord({
        id: VIEWER_ROLE_ID,
        name: 'Viewer',
        description: 'Read-only access matching the previous Viewer role.',
        permissions: VIEWER_PERMISSIONS,
        createdBy: 'migration',
        updatedBy: 'migration',
        createdAt: now,
        updatedAt: now
      }));
    }
    writeFileRoles(Array.from(byId.values()));

    const users = readUsersFromDisk(usersPath);
    let changed = false;
    for (const user of users) {
      const expectedRoleId = user.roleId || (user.role === 'admin' ? SYSTEM_ADMIN_ROLE_ID : VIEWER_ROLE_ID);
      const expectedScope = normalizeProductScopeMode(user.productScopeMode, user.role, user.products);
      if (user.roleId !== expectedRoleId || user.productScopeMode !== expectedScope) changed = true;
      user.roleId = expectedRoleId;
      user.productScopeMode = expectedScope;
    }
    if (changed) fs.writeFileSync(usersPath, JSON.stringify(users.map(normalizeUserRecord), null, 2), 'utf8');
  };

  const mapUserRows = (rows) => rows.map(row => normalizeUserRecord({
    id: row.id,
    userId: row.public_id,
    username: row.username,
    email: row.email,
    status: row.status,
    role: row.role,
    products: parseJsonArray(row.products),
    productScopeMode: row.product_scope_mode,
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
        u.public_id,
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
        COALESCE(m.product_scope_mode, hub_m.product_scope_mode, 'none') AS product_scope_mode,
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
    return Promise.all(mapUserRows(rows).map(attachDbAccess));
  };

  const getUserByIdentityFromDb = async ({ username = '', userId = '' }, appKey = DEFAULT_APP_KEY) => {
    const lookupColumn = userId ? 'u.public_id' : 'u.username';
    const lookupValue = userId || username;
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.public_id,
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
        COALESCE(m.product_scope_mode, hub_m.product_scope_mode, 'none') AS product_scope_mode,
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
      WHERE ${lookupColumn} = $1
      LIMIT 1
    `, [lookupValue, appKey, HUB_APP_KEY]);
    return rows[0] ? attachDbAccess(mapUserRows(rows)[0]) : null;
  };

  const getUserByUsernameFromDb = (username, appKey = DEFAULT_APP_KEY) => (
    getUserByIdentityFromDb({ username }, appKey)
  );

  const getUserByUserIdFromDb = (userId, appKey = DEFAULT_APP_KEY) => (
    getUserByIdentityFromDb({ userId }, appKey)
  );

  const getRoleFromDb = async (roleId, client = pool) => {
    const { rows } = await client.query(`
      SELECT
        r.id,
        r.name,
        r.description,
        r.is_system,
        r.created_by,
        r.updated_by,
        r.created_at,
        r.updated_at,
        COALESCE((
          SELECT jsonb_agg(rp.permission_key ORDER BY rp.permission_key)
          FROM ${TABLES.rolePermissions} rp
          WHERE rp.role_id = r.id
        ), '[]'::jsonb) AS permissions,
        COALESCE((
          SELECT count(*)::int
          FROM ${TABLES.userRoles} ur
          WHERE ur.role_id = r.id
        ), 0) AS assigned_user_count
      FROM ${TABLES.roles} r
      WHERE r.id = $1
      LIMIT 1
    `, [roleId]);
    if (!rows[0]) return null;
    return normalizeRoleRecord({
      ...rows[0],
      permissions: parseJsonArray(rows[0].permissions)
    });
  };

  const attachDbAccess = async user => {
    if (!user) return null;
    const { rows } = await pool.query(`
      SELECT ur.role_id
      FROM ${TABLES.userRoles} ur
      WHERE ur.user_id = $1
      LIMIT 1
    `, [user.id]);
    const fallbackRoleId = user.role === 'admin' ? SYSTEM_ADMIN_ROLE_ID : VIEWER_ROLE_ID;
    const role = await getRoleFromDb(rows[0]?.role_id || fallbackRoleId);
    const access = buildAccess({
      role: role || {
        id: fallbackRoleId,
        name: fallbackRoleId === SYSTEM_ADMIN_ROLE_ID ? 'System Administrator' : 'Viewer',
        system: fallbackRoleId === SYSTEM_ADMIN_ROLE_ID
      },
      permissions: role?.permissions || (fallbackRoleId === VIEWER_ROLE_ID ? VIEWER_PERMISSIONS : ALL_PERMISSION_KEYS),
      productScope: {
        mode: role?.system ? 'all' : user.productScopeMode,
        products: user.products
      },
      legacyRole: role?.system ? 'admin' : 'viewer'
    });
    return {
      ...user,
      role: access.role.system ? 'admin' : 'viewer',
      roleId: access.role.id,
      roleName: access.role.name,
      roleSystem: access.role.system,
      permissions: access.permissions,
      productScopeMode: access.productScope.mode,
      products: access.productScope.products,
      access
    };
  };

  const attachFileAccess = user => {
    if (!user) return null;
    const roles = readFileRoles();
    const fallbackRoleId = user.role === 'admin' ? SYSTEM_ADMIN_ROLE_ID : VIEWER_ROLE_ID;
    const role = roles.find(item => item.id === (user.roleId || fallbackRoleId))
      || roles.find(item => item.id === fallbackRoleId);
    const access = buildAccess({
      role,
      permissions: role?.permissions || (fallbackRoleId === VIEWER_ROLE_ID ? VIEWER_PERMISSIONS : ALL_PERMISSION_KEYS),
      productScope: {
        mode: role?.system ? 'all' : user.productScopeMode,
        products: user.products
      },
      legacyRole: role?.system ? 'admin' : 'viewer'
    });
    return {
      ...user,
      role: access.role.system ? 'admin' : 'viewer',
      roleId: access.role.id,
      roleName: access.role.name,
      roleSystem: access.role.system,
      permissions: access.permissions,
      productScopeMode: access.productScope.mode,
      products: access.productScope.products,
      access
    };
  };

  const upsertUserToDb = async (input = {}, options = {}) => {
    const user = normalizeUserRecord(input);
    if (!user.username) throw new Error('Username is required');
    const apps = Array.isArray(options.appKeys) && options.appKeys.length > 0 ? options.appKeys : ALL_APP_KEYS;
    await withTransaction(async (client) => {
      const role = await getRoleFromDb(user.roleId, client);
      if (!role) throw createStoreError('Selected role was not found', 400, 'role_not_found');
      const existing = await client.query('SELECT id, public_id FROM auth_users WHERE username = $1', [user.username]);
      let internalUserId = existing.rows[0]?.id || user.id || crypto.randomUUID();
      const existingPublicId = existing.rows[0]?.public_id || '';
      const savedIdentity = await client.query(`
        INSERT INTO ${TABLES.users} (id, public_id, username, email, status, last_login_at)
        VALUES ($1, COALESCE(NULLIF($2, ''), format_auth_user_public_id(nextval('auth_user_public_id_seq'))), $3, $4, $5, $6)
        ON CONFLICT (username)
        DO UPDATE SET
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          last_login_at = COALESCE(EXCLUDED.last_login_at, ${TABLES.users}.last_login_at),
          updated_at = now()
        RETURNING id
      `, [
        internalUserId,
        existingPublicId,
        user.username,
        user.email,
        user.status,
        user.lastLoginAt ? new Date(user.lastLoginAt) : null
      ]);
      internalUserId = savedIdentity.rows[0].id;

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
        `, [internalUserId, user.salt, user.hash, user.passwordAlgorithm || 'pbkdf2-sha512:1000']);
      }

      for (const appKey of apps) {
        await client.query(`
          INSERT INTO ${TABLES.memberships} (user_id, app_key, role, products, product_scope_mode)
          VALUES ($1, $2, $3, $4::jsonb, $5)
          ON CONFLICT (user_id, app_key)
          DO UPDATE SET
            role = EXCLUDED.role,
            products = EXCLUDED.products,
            product_scope_mode = EXCLUDED.product_scope_mode,
            updated_at = now()
        `, [
          internalUserId,
          appKey,
          role.system ? 'admin' : 'viewer',
          JSON.stringify(role.system || user.productScopeMode !== 'selected' ? [] : user.products),
          role.system ? 'all' : user.productScopeMode
        ]);
      }
      await client.query(`
        INSERT INTO ${TABLES.userRoles} (user_id, role_id, assigned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET
          role_id = EXCLUDED.role_id,
          assigned_by = EXCLUDED.assigned_by,
          assigned_at = now()
      `, [internalUserId, role.id, normalizeText(options.assignedBy)]);
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
      return attachFileAccess({
        ...user,
        passwordUpdatedAt: user.passwordUpdatedAt || '',
        mfaEnabled: Boolean(mfa?.secretCiphertext),
        mfaProvider: mfa?.provider || '',
        mfaEnabledAt: mfa?.enabledAt || '',
        recoveryCodesRemaining: 0,
        presenceStatus: Array.from(fileSessions.values()).some(session => (
        session.username === user.username
        && !session.revokedAt
        && Date.parse(session.expiresAt) > now
      )) ? 'online' : 'offline'
      });
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
    const role = readFileRoles().find(item => item.id === user.roleId);
    if (!role) throw createStoreError('Selected role was not found', 400, 'role_not_found');
    const storedUser = {
      ...user,
      role: role.system ? 'admin' : 'viewer',
      roleId: role.id,
      roleName: role.name,
      roleSystem: role.system,
      productScopeMode: role.system ? 'all' : user.productScopeMode,
      products: role.system || user.productScopeMode !== 'selected' ? [] : user.products
    };
    const { users, index } = getFileUserIndex(user.username);
    if (index >= 0) {
      users[index] = {
        ...users[index],
        email: storedUser.email,
        role: storedUser.role,
        roleId: storedUser.roleId,
        products: storedUser.products,
        productScopeMode: storedUser.productScopeMode,
        status: storedUser.status,
        lastLoginAt: storedUser.lastLoginAt || users[index].lastLoginAt
      };
      if (storedUser.hash && storedUser.salt) {
        users[index].salt = storedUser.salt;
        users[index].hash = storedUser.hash;
        users[index].passwordAlgorithm = storedUser.passwordAlgorithm;
      }
    } else {
      users.push({ ...storedUser, userId: allocateFileUserId(users) });
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
        await ensureRbacRolesInDb();
        await ensureSeedUsers();
        await ensureLegacyRoleAssignmentsInDb();
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [732024061]).catch(() => {});
        lockClient.release();
      }
      console.log('Auth Service: Auth database connection initialized');
    } else {
      console.log('Auth Service: Running in file-storage mode');
      await ensureSeedUsers();
      ensureFileUserIds();
      ensureFileRbac();
      const mfaData = readMfaFile();
      let changed = false;
      for (const entry of Object.values(mfaData)) {
        if (entry && Object.prototype.hasOwnProperty.call(entry, 'recoveryCodes')) {
          delete entry.recoveryCodes;
          changed = true;
        }
      }
      if (changed) writeMfaFile(mfaData);
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

  const getUserByUserId = async (userId, appKey = DEFAULT_APP_KEY) => {
    const normalizedUserId = normalizePublicUserId(userId);
    if (!normalizedUserId) return null;
    if (pool) return getUserByUserIdFromDb(normalizedUserId, appKey);
    return listFileUsers().find(user => user.userId === normalizedUserId) || null;
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

  const listRoles = async () => {
    if (pool) {
      const { rows } = await pool.query(`SELECT id FROM ${TABLES.roles} ORDER BY is_system DESC, lower(name), id`);
      return Promise.all(rows.map(row => getRoleFromDb(row.id)));
    }
    const users = readUsersFromDisk(usersPath);
    return readFileRoles()
      .map(role => ({
        ...role,
        permissions: role.system ? [...ALL_PERMISSION_KEYS] : role.permissions,
        assignedUserCount: users.filter(user => user.roleId === role.id
          || (!user.roleId && role.id === (user.role === 'admin' ? SYSTEM_ADMIN_ROLE_ID : VIEWER_ROLE_ID))).length
      }))
      .sort((left, right) => Number(right.system) - Number(left.system) || left.name.localeCompare(right.name));
  };

  const getRole = async roleId => {
    const normalizedRoleId = normalizeText(roleId);
    if (!normalizedRoleId) return null;
    if (pool) return getRoleFromDb(normalizedRoleId);
    const roles = await listRoles();
    return roles.find(role => role.id === normalizedRoleId) || null;
  };

  const createRole = async ({ name, description = '', permissions = [], actorUsername = '' }) => {
    const valid = validateCustomRole({ name, description, permissions });
    const now = new Date().toISOString();
    const role = normalizeRoleRecord({
      id: crypto.randomUUID(),
      ...valid,
      system: false,
      createdBy: actorUsername,
      updatedBy: actorUsername,
      createdAt: now,
      updatedAt: now
    });
    if (pool) {
      try {
        await withTransaction(async client => {
          await client.query(`
            INSERT INTO ${TABLES.roles} (id, name, description, is_system, created_by, updated_by)
            VALUES ($1, $2, $3, false, $4, $4)
          `, [role.id, role.name, role.description, actorUsername]);
          for (const permission of role.permissions) {
            await client.query(`
              INSERT INTO ${TABLES.rolePermissions} (role_id, permission_key)
              VALUES ($1, $2)
            `, [role.id, permission]);
          }
        });
      } catch (error) {
        if (error.code === '23505') throw createStoreError('A role with this name already exists', 409, 'role_name_conflict');
        throw error;
      }
    } else {
      const roles = readFileRoles();
      if (roles.some(item => item.name.toLowerCase() === role.name.toLowerCase())) {
        throw createStoreError('A role with this name already exists', 409, 'role_name_conflict');
      }
      roles.push(role);
      writeFileRoles(roles);
    }
    await saveAuditEvent({
      actorUsername,
      targetUsername: role.name,
      action: 'role.created',
      metadata: { roleId: role.id, after: { name: role.name, description: role.description, permissions: role.permissions } }
    });
    return getRole(role.id);
  };

  const updateRole = async (roleId, { name, description = '', permissions = [], actorUsername = '' }) => {
    const existing = await getRole(roleId);
    if (!existing) throw createStoreError('Role not found', 404, 'role_not_found');
    if (existing.system) throw createStoreError('System Administrator is protected and cannot be edited', 409, 'system_role_protected');
    const valid = validateCustomRole({ name, description, permissions }, { currentRoleId: roleId });
    let affectedUsernames = [];
    if (pool) {
      try {
        await withTransaction(async client => {
          const users = await client.query(`
            SELECT u.username
            FROM ${TABLES.userRoles} ur
            JOIN ${TABLES.users} u ON u.id = ur.user_id
            WHERE ur.role_id = $1
          `, [roleId]);
          affectedUsernames = users.rows.map(row => row.username);
          await client.query(`
            UPDATE ${TABLES.roles}
            SET name = $2, description = $3, updated_by = $4, updated_at = now()
            WHERE id = $1
          `, [roleId, valid.name, valid.description, actorUsername]);
          await client.query(`DELETE FROM ${TABLES.rolePermissions} WHERE role_id = $1`, [roleId]);
          for (const permission of valid.permissions) {
            await client.query(`
              INSERT INTO ${TABLES.rolePermissions} (role_id, permission_key)
              VALUES ($1, $2)
            `, [roleId, permission]);
          }
          await client.query(`
            UPDATE ${TABLES.sessions} s
            SET revoked_at = COALESCE(s.revoked_at, now())
            FROM ${TABLES.userRoles} ur
            WHERE s.user_id = ur.user_id
              AND ur.role_id = $1
              AND s.revoked_at IS NULL
          `, [roleId]);
          await client.query(`
            INSERT INTO ${TABLES.auditEvents} (actor_username, target_username, action, metadata)
            VALUES ($1, $2, 'role.updated', $3::jsonb)
          `, [
            actorUsername,
            valid.name,
            JSON.stringify({
              roleId,
              affectedUserCount: affectedUsernames.length,
              before: { name: existing.name, description: existing.description, permissions: existing.permissions },
              after: { name: valid.name, description: valid.description, permissions: valid.permissions }
            })
          ]);
        });
      } catch (error) {
        if (error.code === '23505') throw createStoreError('A role with this name already exists', 409, 'role_name_conflict');
        throw error;
      }
    } else {
      const roles = readFileRoles();
      const index = roles.findIndex(role => role.id === roleId);
      if (roles.some((role, roleIndex) => roleIndex !== index && role.name.toLowerCase() === valid.name.toLowerCase())) {
        throw createStoreError('A role with this name already exists', 409, 'role_name_conflict');
      }
      roles[index] = normalizeRoleRecord({
        ...roles[index],
        ...valid,
        id: roleId,
        updatedBy: actorUsername,
        updatedAt: new Date().toISOString()
      });
      writeFileRoles(roles);
      affectedUsernames = readUsersFromDisk(usersPath)
        .filter(user => user.roleId === roleId)
        .map(user => user.username);
    }
    if (!pool) {
      await Promise.all(affectedUsernames.map(username => revokeUserSessions(username)));
      await saveAuditEvent({
        actorUsername,
        targetUsername: valid.name,
        action: 'role.updated',
        metadata: {
          roleId,
          affectedUserCount: affectedUsernames.length,
          before: { name: existing.name, description: existing.description, permissions: existing.permissions },
          after: { name: valid.name, description: valid.description, permissions: valid.permissions }
        }
      });
    }
    return getRole(roleId);
  };

  const retireRole = async (roleId, { replacementRoleId = '', actorUsername = '' } = {}) => {
    const existing = await getRole(roleId);
    if (!existing) throw createStoreError('Role not found', 404, 'role_not_found');
    if (existing.system) throw createStoreError('System Administrator cannot be retired', 409, 'system_role_protected');
    if (replacementRoleId === roleId) throw createStoreError('Replacement role must be different', 400, 'invalid_replacement_role');
    const replacement = replacementRoleId ? await getRole(replacementRoleId) : null;
    if (replacementRoleId && !replacement) throw createStoreError('Replacement role not found', 404, 'replacement_role_not_found');
    let affectedUsernames = [];
    if (pool) {
      await withTransaction(async client => {
        const users = await client.query(`
          SELECT u.id, u.username
          FROM ${TABLES.userRoles} ur
          JOIN ${TABLES.users} u ON u.id = ur.user_id
          WHERE ur.role_id = $1
          FOR UPDATE
        `, [roleId]);
        affectedUsernames = users.rows.map(row => row.username);
        if (affectedUsernames.length > 0 && !replacement) {
          throw createStoreError('Choose a replacement role before retiring an assigned role', 409, 'role_in_use', { assignedUserCount: affectedUsernames.length });
        }
        await client.query(`
          UPDATE ${TABLES.sessions} s
          SET revoked_at = COALESCE(s.revoked_at, now())
          FROM ${TABLES.userRoles} ur
          WHERE s.user_id = ur.user_id
            AND ur.role_id = $1
            AND s.revoked_at IS NULL
        `, [roleId]);
        if (replacement) {
          await client.query(`
            UPDATE ${TABLES.memberships} m
            SET
              role = $2,
              product_scope_mode = CASE WHEN $2 = 'admin' THEN 'all' ELSE m.product_scope_mode END,
              products = CASE WHEN $2 = 'admin' THEN '[]'::jsonb ELSE m.products END,
              updated_at = now()
            WHERE m.user_id IN (
              SELECT ur.user_id
              FROM ${TABLES.userRoles} ur
              WHERE ur.role_id = $1
            )
          `, [roleId, replacement.system ? 'admin' : 'viewer']);
          await client.query(`
            UPDATE ${TABLES.userRoles}
            SET role_id = $2, assigned_by = $3, assigned_at = now()
            WHERE role_id = $1
          `, [roleId, replacement.id, actorUsername]);
        }
        await client.query(`
          INSERT INTO ${TABLES.auditEvents} (actor_username, target_username, action, metadata)
          VALUES ($1, $2, 'role.retired', $3::jsonb)
        `, [
          actorUsername,
          existing.name,
          JSON.stringify({
            roleId,
            replacementRoleId: replacement?.id || '',
            replacementRoleName: replacement?.name || '',
            affectedUserCount: affectedUsernames.length,
            before: { name: existing.name, description: existing.description, permissions: existing.permissions }
          })
        ]);
        await client.query(`DELETE FROM ${TABLES.roles} WHERE id = $1`, [roleId]);
      });
    } else {
      const users = readUsersFromDisk(usersPath);
      affectedUsernames = users.filter(user => user.roleId === roleId).map(user => user.username);
      if (affectedUsernames.length > 0 && !replacement) {
        throw createStoreError('Choose a replacement role before retiring an assigned role', 409, 'role_in_use', { assignedUserCount: affectedUsernames.length });
      }
      for (const user of users) {
        if (user.roleId !== roleId) continue;
        user.roleId = replacement.id;
        user.role = replacement.system ? 'admin' : 'viewer';
        if (replacement.system) {
          user.productScopeMode = 'all';
          user.products = [];
        }
      }
      writeFileUsers(users);
      writeFileRoles(readFileRoles().filter(role => role.id !== roleId));
    }
    if (!pool) {
      await Promise.all(affectedUsernames.map(username => revokeUserSessions(username)));
      await saveAuditEvent({
        actorUsername,
        targetUsername: existing.name,
        action: 'role.retired',
        metadata: {
          roleId,
          replacementRoleId: replacement?.id || '',
          replacementRoleName: replacement?.name || '',
          affectedUserCount: affectedUsernames.length,
          before: { name: existing.name, description: existing.description, permissions: existing.permissions }
        }
      });
    }
    return { retiredRole: existing, replacementRole: replacement, affectedUserCount: affectedUsernames.length };
  };

  const countActiveSystemAdministrators = async () => {
    const users = await listUsers();
    return users.filter(user => user.roleId === SYSTEM_ADMIN_ROLE_ID && user.status !== 'suspended').length;
  };

  const listAuditEvents = async ({ limit = 100, before = '' } = {}) => {
    const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
    if (pool) {
      const params = [safeLimit];
      const beforeClause = before ? 'WHERE created_at < $2' : '';
      if (before) params.push(new Date(before));
      const { rows } = await pool.query(`
        SELECT id, actor_username, target_username, action, metadata, created_at
        FROM ${TABLES.auditEvents}
        ${beforeClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `, params);
      return rows.map(row => ({
        id: String(row.id),
        actorUsername: row.actor_username,
        targetUsername: row.target_username,
        action: row.action,
        metadata: row.metadata || {},
        createdAt: toIsoString(row.created_at)
      }));
    }
    return readFileAudit()
      .filter(event => !before || Date.parse(event.createdAt) < Date.parse(before))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, safeLimit);
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
      return;
    }
    const events = readFileAudit();
    events.push({
      id: crypto.randomUUID(),
      actorUsername,
      targetUsername,
      action,
      metadata,
      createdAt: new Date().toISOString()
    });
    writeFileAudit(events);
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
    getUserByUserId,
    upsertUser,
    deleteUser,
    recordLogin,
    createSession,
    revokeSession,
    revokeUserSessions,
    listRoles,
    getRole,
    createRole,
    updateRole,
    retireRole,
    countActiveSystemAdministrators,
    listAuditEvents,
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
