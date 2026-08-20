const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuthStore } = require('../server/auth-store.cjs');

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex'),
  algorithm: 'pbkdf2-sha512:1000',
});

const verifyPassword = (password, user) => (
  crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex') === user.hash
);

const withEnvironment = async (values, callback) => {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('file-mode development storage initializes a usable default administrator', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createAuthStore({ dataDir, hashPassword });
  await store.initialize();
  const admin = await store.getUserByUsername('admin');
  assert.equal(admin.username, 'admin');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.userId, '1');
  await store.close();
});

test('empty production storage requires a bootstrap administrator password', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-production-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  await withEnvironment({
    NODE_ENV: 'production',
    AUTH_BOOTSTRAP_ADMIN_PASSWORD: undefined
  }, async () => {
    const store = createAuthStore({ dataDir, hashPassword });
    await assert.rejects(() => store.initialize(), /AUTH_BOOTSTRAP_ADMIN_PASSWORD/);
  });
});

test('production storage uses the configured bootstrap password', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-production-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  await withEnvironment({
    NODE_ENV: 'production',
    AUTH_BOOTSTRAP_ADMIN_PASSWORD: 'generated-production-password'
  }, async () => {
    const store = createAuthStore({ dataDir, hashPassword });
    await store.initialize();
    const admin = await store.getUserByUsername('admin');
    assert.equal(verifyPassword('generated-production-password', admin), true);
    assert.equal(verifyPassword('admin', admin), false);
    await store.close();
  });
});

test('existing production users do not require bootstrap credentials', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-existing-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{
    username: 'operator',
    role: 'admin',
    status: 'active',
    products: [],
    ...hashPassword('existing-password')
  }]));
  await withEnvironment({
    NODE_ENV: 'production',
    AUTH_BOOTSTRAP_ADMIN_PASSWORD: undefined
  }, async () => {
    const store = createAuthStore({ dataDir, hashPassword });
    await store.initialize();
    assert.equal((await store.getUserByUsername('operator')).username, 'operator');
    await store.close();
  });
});

test('file storage repairs missing, malformed, and duplicate public user IDs once', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-public-id-repair-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const usersPath = path.join(dataDir, 'users.json');
  fs.writeFileSync(usersPath, JSON.stringify([
    { username: 'alpha', userId: '000005', role: 'viewer', status: 'active', products: [], ...hashPassword('alpha-password') },
    { username: 'beta', userId: '000005', role: 'viewer', status: 'active', products: [], ...hashPassword('beta-password') },
    { username: 'gamma', userId: 'invalid', role: 'viewer', status: 'active', products: [], ...hashPassword('gamma-password') },
    { username: 'delta', role: 'viewer', status: 'active', products: [], ...hashPassword('delta-password') }
  ]));

  const firstStore = createAuthStore({ dataDir, hashPassword });
  await firstStore.initialize();
  const firstUsers = await firstStore.listUsers();
  const firstIds = Object.fromEntries(firstUsers.map(user => [user.username, user.userId]));
  assert.deepEqual(firstIds, {
    alpha: '5',
    beta: '6',
    gamma: '7',
    delta: '8'
  });
  assert.equal((await firstStore.getUserByUserId('000006')).username, 'beta');
  assert.equal(new Set(firstUsers.map(user => user.userId)).size, firstUsers.length);
  await firstStore.close();

  const restartedStore = createAuthStore({ dataDir, hashPassword });
  await restartedStore.initialize();
  const restartedIds = Object.fromEntries((await restartedStore.listUsers()).map(user => [user.username, user.userId]));
  assert.deepEqual(restartedIds, firstIds);
  await restartedStore.close();
});

test('file storage preserves public IDs on update and never reuses deleted IDs', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-public-id-sequence-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createAuthStore({ dataDir, hashPassword });
  await store.initialize();

  const created = await store.upsertUser({
    username: 'operator',
    email: 'operator@example.test',
    role: 'viewer',
    roleId: 'viewer',
    status: 'active',
    productScopeMode: 'none',
    products: [],
    ...hashPassword('operator-password')
  });
  assert.equal(created.userId, '2');

  const updated = await store.upsertUser({ ...created, email: 'updated@example.test' });
  assert.equal(updated.userId, created.userId);
  assert.equal(await store.deleteUser('operator'), true);
  await store.close();

  const restartedStore = createAuthStore({ dataDir, hashPassword });
  await restartedStore.initialize();
  const replacement = await restartedStore.upsertUser({
    username: 'replacement',
    email: '',
    role: 'viewer',
    roleId: 'viewer',
    status: 'active',
    productScopeMode: 'none',
    products: [],
    ...hashPassword('replacement-password')
  });
  assert.equal(replacement.userId, '3');
  assert.equal(await restartedStore.getUserByUserId(created.userId), null);
  await restartedStore.close();
});
