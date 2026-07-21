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

test('file identity updates are limited to optional identity fields', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-identity-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createAuthStore({ dataDir, hashPassword });
  await store.initialize();

  const updated = await store.updateIdentity('admin', {
    email: ' admin@example.test ',
    fullName: ' Admin Operator ',
    company: ' Example Security ',
    department: ' SOC ',
    role: 'viewer',
    products: ['forbidden-change'],
    status: 'suspended'
  });

  assert.equal(updated.email, 'admin@example.test');
  assert.equal(updated.fullName, 'Admin Operator');
  assert.equal(updated.company, 'Example Security');
  assert.equal(updated.department, 'SOC');
  assert.equal(updated.role, 'admin');
  assert.equal(updated.accountStatus, 'active');
  assert.deepEqual(updated.products, []);
  await store.close();
});

test('admin-controlled MFA migration is additive, backfills policy, and invalidates recovery codes', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../server/migrations/002_admin_controlled_mfa.sql'),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS full_name/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_mfa_policy/);
  assert.match(migration, /CASE WHEN mf\.user_id IS NULL THEN 'disabled' ELSE 'authenticator' END/);
  assert.match(migration, /DELETE FROM auth_mfa_recovery_codes/);
});
