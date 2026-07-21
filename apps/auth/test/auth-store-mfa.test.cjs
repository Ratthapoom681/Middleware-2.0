const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuthStore } = require('../server/auth-store.cjs');

const testHashPassword = () => ({ salt: 'test-salt', hash: 'test-hash', algorithm: 'scrypt' });

test('file MFA state persists, challenges expire after five attempts, and accounts lock after ten failures', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-mfa-'));
  process.env.NODE_ENV = 'development';
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;

  const store = createAuthStore({ dataDir, hashPassword: testHashPassword });
  await store.initialize();
  t.after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await store.saveMfaConfig('admin', {
    provider: 'other',
    secretCiphertext: 'ciphertext',
    secretIv: 'iv',
    secretTag: 'tag'
  }, ['recovery-hash']);

  await store.createMfaChallenge({
    id: 'challenge-id',
    username: 'admin',
    purpose: 'login',
    tokenHash: 'challenge-hash',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await store.recordMfaChallengeFailure('challenge-hash');
    assert.equal(result.attemptCount, attempt);
    assert.equal(result.consumed, attempt === 5);
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await store.recordMfaFailure('admin');
    assert.equal(result.failedAttempts, attempt);
    if (attempt < 10) assert.equal(result.lockedUntil, '');
    if (attempt === 10) {
      const lockDuration = Date.parse(result.lockedUntil) - Date.now();
      assert.ok(lockDuration > 14 * 60_000 && lockDuration <= 15 * 60_000);
    }
  }

  const reopened = createAuthStore({ dataDir, hashPassword: testHashPassword });
  await reopened.initialize();
  const persisted = await reopened.getMfaConfig('admin');
  assert.equal(persisted.provider, 'other');
  assert.equal(persisted.failedAttempts, 10);
  assert.equal(persisted.recoveryCodesRemaining, 1);
  await reopened.resetMfaFailures('admin');
  assert.equal((await reopened.getMfaConfig('admin')).lockedUntil, '');
  await reopened.close();
});
