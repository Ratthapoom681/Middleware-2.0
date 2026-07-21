const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAuthStore } = require('../server/auth-store.cjs');

const testHashPassword = () => ({ salt: 'test-salt', hash: 'test-hash', algorithm: 'scrypt' });

test('file MFA policy persists pending and enabled state without retaining recovery codes', async (t) => {
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

  const requestedAt = new Date().toISOString();
  await store.setMfaPolicy('admin', {
    mode: 'authenticator',
    requestedAt,
    requestedBy: 'security-admin',
    reason: 'User requested MFA',
    notificationStatus: 'sent',
    notificationAttemptedAt: requestedAt,
    notificationSentAt: requestedAt
  });
  const pending = await store.getMfaPolicy('admin');
  assert.equal(pending.status, 'pending');
  assert.equal((await store.getUserByUsername('admin')).mfaStatus, 'pending');

  await store.saveMfaConfig('admin', {
    provider: 'other',
    secretCiphertext: 'ciphertext',
    secretIv: 'iv',
    secretTag: 'tag'
  }, ['recovery-hash']);
  assert.equal((await store.getMfaPolicy('admin')).status, 'enabled');

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
  assert.equal(persisted.recoveryCodesRemaining, 0);
  const reopenedPolicy = await reopened.getMfaPolicy('admin');
  assert.equal(reopenedPolicy.status, 'enabled');
  assert.equal(reopenedPolicy.notificationStatus, 'sent');
  await reopened.resetMfaFailures('admin');
  assert.equal((await reopened.getMfaConfig('admin')).lockedUntil, '');

  const resetPolicy = await reopened.clearMfaEnrollment('admin', {
    mode: 'authenticator',
    requestedBy: 'security-admin',
    reason: 'Lost device'
  });
  assert.equal(resetPolicy.status, 'pending');
  assert.equal(await reopened.getMfaConfig('admin'), null);
  const protectedData = JSON.parse(fs.readFileSync(path.join(dataDir, 'mfa.json'), 'utf8'));
  assert.equal(protectedData.admin.policy.mode, 'authenticator');
  assert.equal('secretCiphertext' in protectedData.admin, false);
  assert.equal('recoveryCodes' in protectedData.admin, false);
  await reopened.close();
});

test('file migration backfills authenticator policy and invalidates legacy recovery hashes', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-mfa-migration-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{
    id: 'existing-user',
    username: 'existing',
    role: 'viewer',
    status: 'active',
    products: [],
    salt: 'test-salt',
    hash: 'test-hash',
    passwordAlgorithm: 'scrypt'
  }]));
  fs.writeFileSync(path.join(dataDir, 'mfa.json'), JSON.stringify({
    existing: {
      provider: 'google',
      secretCiphertext: 'ciphertext',
      secretIv: 'iv',
      secretTag: 'tag',
      enabledAt: '2026-01-02T03:04:05.000Z',
      recoveryCodes: [{ codeHash: 'legacy-recovery-hash', usedAt: '' }]
    }
  }));

  const store = createAuthStore({ dataDir, hashPassword: testHashPassword });
  await store.initialize();
  const policy = await store.getMfaPolicy('existing');
  const config = await store.getMfaConfig('existing');
  assert.equal(policy.mode, 'authenticator');
  assert.equal(policy.status, 'enabled');
  assert.equal(policy.enabledAt, '2026-01-02T03:04:05.000Z');
  assert.equal(config.provider, 'google');
  assert.equal(config.recoveryCodesRemaining, 0);
  const migrated = JSON.parse(fs.readFileSync(path.join(dataDir, 'mfa.json'), 'utf8'));
  assert.equal(migrated.existing.policy.mode, 'authenticator');
  assert.equal('recoveryCodes' in migrated.existing, false);
  await store.close();
});
