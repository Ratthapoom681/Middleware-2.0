const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuthStore } = require('../server/auth-store.cjs');
const {
  ALL_PERMISSION_KEYS,
  SYSTEM_ADMIN_ROLE_ID,
  VIEWER_PERMISSIONS,
} = require('../../../packages/access-control/index.cjs');

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex'),
  algorithm: 'pbkdf2-sha512:1000',
});

const createTestStore = async (t, prefix = 'auth-rbac-') => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createAuthStore({ dataDir, hashPassword });
  await store.initialize();
  t.after(() => store.close());
  return { dataDir, store };
};

test('legacy users migrate idempotently to one role and an explicit product scope', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-rbac-migration-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
    { username: 'legacy-admin', role: 'admin', products: [], status: 'active', ...hashPassword('admin-password') },
    { username: 'scoped-viewer', role: 'viewer', products: ['Mobile Banking'], status: 'active', ...hashPassword('viewer-password') },
    { username: 'empty-viewer', role: 'viewer', products: [], status: 'active', ...hashPassword('viewer-password') },
  ]));

  const first = createAuthStore({ dataDir, hashPassword });
  await first.initialize();
  await first.close();
  const second = createAuthStore({ dataDir, hashPassword });
  await second.initialize();
  t.after(() => second.close());

  const roles = await second.listRoles();
  assert.equal(roles.filter(role => role.id === SYSTEM_ADMIN_ROLE_ID).length, 1);
  assert.equal(roles.filter(role => role.id === 'viewer').length, 1);
  assert.deepEqual((await second.getRole(SYSTEM_ADMIN_ROLE_ID)).permissions, ALL_PERMISSION_KEYS);
  assert.deepEqual((await second.getRole('viewer')).permissions, VIEWER_PERMISSIONS);

  const admin = await second.getUserByUsername('legacy-admin');
  assert.equal(admin.access.role.id, SYSTEM_ADMIN_ROLE_ID);
  assert.equal(admin.access.productScope.mode, 'all');
  const scoped = await second.getUserByUsername('scoped-viewer');
  assert.equal(scoped.access.role.id, 'viewer');
  assert.deepEqual(scoped.access.productScope, { mode: 'selected', products: ['Mobile Banking'] });
  assert.equal((await second.getUserByUsername('empty-viewer')).access.productScope.mode, 'none');
});

test('custom roles validate names and permissions and expand dependencies', async (t) => {
  const { store } = await createTestStore(t);
  const reviewer = await store.createRole({
    name: 'Security Reviewer',
    description: 'Reviews product mitigations.',
    permissions: ['defectdojo.mitigations.review'],
    actorUsername: 'admin',
  });
  assert.deepEqual(reviewer.permissions, [
    'defectdojo.vulnerabilities.view',
    'defectdojo.mitigations.review',
  ]);

  await assert.rejects(
    () => store.createRole({ name: 'security reviewer', permissions: [] }),
    error => error.code === 'role_name_conflict',
  );
  await assert.rejects(
    () => store.createRole({ name: 'Unknown task', permissions: ['missing.permission'] }),
    error => error.code === 'unknown_permission',
  );
  await assert.rejects(
    () => store.createRole({ name: 'Identity manager', permissions: ['identity.users.manage'] }),
    error => error.code === 'system_permission',
  );
  await assert.rejects(
    () => store.updateRole(SYSTEM_ADMIN_ROLE_ID, { name: 'Changed', permissions: [] }),
    error => error.code === 'system_role_protected',
  );
  await assert.rejects(
    () => store.retireRole(SYSTEM_ADMIN_ROLE_ID),
    error => error.code === 'system_role_protected',
  );
});

test('role edits and retirement revoke affected sessions and persist audit history', async (t) => {
  const { store } = await createTestStore(t);
  const reviewer = await store.createRole({
    name: 'Security Reviewer',
    permissions: ['defectdojo.mitigations.review'],
    actorUsername: 'admin',
  });
  const user = await store.upsertUser({
    username: 'reviewer',
    roleId: reviewer.id,
    productScopeMode: 'selected',
    products: ['Mobile Banking'],
    status: 'active',
    ...hashPassword('temporary-password'),
  }, { assignedBy: 'admin' });

  await store.createSession({
    user,
    sid: 'role-edit-session',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.ok(await store.getActiveSession('role-edit-session'));
  await store.updateRole(reviewer.id, {
    name: reviewer.name,
    description: reviewer.description,
    permissions: ['defectdojo.vulnerabilities.view'],
    actorUsername: 'admin',
  });
  assert.equal(await store.getActiveSession('role-edit-session'), null);

  const updatedUser = await store.getUserByUsername('reviewer');
  await store.createSession({
    user: updatedUser,
    sid: 'role-retire-session',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await assert.rejects(
    () => store.retireRole(reviewer.id, { actorUsername: 'admin' }),
    error => error.code === 'role_in_use',
  );
  const result = await store.retireRole(reviewer.id, {
    replacementRoleId: 'viewer',
    actorUsername: 'admin',
  });
  assert.equal(result.affectedUserCount, 1);
  assert.equal(await store.getActiveSession('role-retire-session'), null);
  const reassigned = await store.getUserByUsername('reviewer');
  assert.equal(reassigned.access.role.id, 'viewer');
  assert.deepEqual(reassigned.access.productScope, { mode: 'selected', products: ['Mobile Banking'] });

  const audit = await store.listAuditEvents({ limit: 20 });
  assert.ok(audit.some(event => event.action === 'role.created'));
  assert.ok(audit.some(event => event.action === 'role.updated' && event.metadata.affectedUserCount === 1));
  assert.ok(audit.some(event => event.action === 'role.retired' && event.metadata.replacementRoleId === 'viewer'));
});
