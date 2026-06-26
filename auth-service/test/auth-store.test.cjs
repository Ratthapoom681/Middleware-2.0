const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuthStore } = require('../backend/auth-store.cjs');

test('file-mode auth storage initializes a usable default administrator', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
    salt,
    hash: crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex'),
    algorithm: 'pbkdf2-sha512:1000',
  });
  const store = createAuthStore({ dataDir, hashPassword });
  await store.initialize();
  const admin = await store.getUserByUsername('admin');
  assert.equal(admin.username, 'admin');
  assert.equal(admin.role, 'admin');
  await store.close();
});
