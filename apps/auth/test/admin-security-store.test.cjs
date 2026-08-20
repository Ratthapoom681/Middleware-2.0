const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAdminSecurityStore } = require('../server/admin-security-store.cjs');
const { createSecurityCrypto } = require('../server/security-crypto.cjs');
const { createEmailWorker, getEmailDeliveryCapability, publicEmailSettings } = require('../server/mailer.cjs');

test('protected file storage persists identity, policy, temporary credentials, settings, and durable outbox state', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-security-store-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  await store.setIdentity('analyst', { fullName: ' Test Analyst ', company: 'Beenets', department: 'SOC' });
  await store.setMfaPolicy('analyst', { mode: 'authenticator', provider: 'microsoft', requestedAt: new Date().toISOString(), notificationStatus: 'queued' });
  await store.setTemporaryCredential('analyst', { expiresAt: new Date(Date.now() + 60_000), createdBy: 'admin' });
  await store.saveEmailSettings({ host: 'tamarind.beenets.com', port: 25, security: 'plain', username: '', fromAddress: 'security@example.test', updatedBy: 'admin' });
  const defaultControls = publicEmailSettings(await store.getEmailSettings());
  assert.equal(defaultControls.enabled, true);
  assert.equal(defaultControls.mfaSetupEnabled, true);
  assert.equal(defaultControls.temporaryPasswordEnabled, false);
  assert.equal(getEmailDeliveryCapability(await store.getEmailSettings(), 'temporary_password').reason, 'type_disabled');
  const first = await store.enqueueEmail({ type: 'mfa_setup', targetUsername: 'analyst', recipient: 'analyst@example.test', subject: 'Setup', metadata: { setupUrl: 'http://10.0.0.5/#mfa-setup' } });
  const duplicate = await store.enqueueEmail({ type: 'mfa_setup', targetUsername: 'analyst', recipient: 'analyst@example.test', subject: 'Setup', metadata: {} });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.deduplicated, true);

  const reopened = createAdminSecurityStore({ dataDir });
  await reopened.initialize();
  assert.equal((await reopened.getIdentity('analyst')).fullName, 'Test Analyst');
  assert.equal((await reopened.getMfaPolicy('analyst')).mode, 'authenticator');
  assert.equal((await reopened.getMfaPolicy('analyst')).provider, 'microsoft');
  assert.equal((await reopened.getTemporaryCredential('analyst')).createdBy, 'admin');
  assert.equal((await reopened.getEmailSettings()).host, 'tamarind.beenets.com');
  const claimed = await reopened.claimNextEmail();
  assert.equal(claimed.id, first.id);
  assert.equal((await reopened.getMfaPolicy('analyst')).notificationStatus, 'sending');
  await reopened.finishEmail(claimed, { error: 'MAIL_NOT_CONFIGURED', permanent: true });
  assert.equal((await reopened.getEmailDelivery(first.id)).status, 'failed');
  assert.equal((await reopened.getMfaPolicy('analyst')).notificationStatus, 'failed');
  const sentSetup = await reopened.enqueueEmail({
    type: 'mfa_setup', targetUsername: 'analyst', recipient: 'analyst@example.test', subject: 'Replacement setup', metadata: {}
  });
  assert.equal((await reopened.getMfaPolicy('analyst')).notificationStatus, 'queued');
  const sentClaim = await reopened.claimNextEmail();
  assert.equal(sentClaim.id, sentSetup.id);
  await reopened.finishEmail(sentClaim);
  const sentPolicy = await reopened.getMfaPolicy('analyst');
  assert.equal(sentPolicy.notificationStatus, 'sent');
  assert.equal(sentPolicy.mode, 'authenticator', 'email status changes must not change the pending MFA policy');
  const retryJob = await reopened.enqueueEmail({ type: 'temporary_password', recipient: 'admin@example.test', subject: 'Retry', metadata: {} });
  const retryClaim = await reopened.claimNextEmail();
  await reopened.finishEmail(retryClaim, { error: 'ETIMEDOUT' });
  const retryState = await reopened.getEmailDelivery(retryJob.id);
  assert.equal(retryState.status, 'queued');
  assert.ok(Date.parse(retryState.availableAt) - Date.now() > 55_000);
  await reopened.close();
});

test('email worker uses encrypted runtime credentials and scrubs temporary passwords after delivery', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-worker-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const encryptionKey = Buffer.alloc(32, 9).toString('base64');
  const securityCrypto = createSecurityCrypto({ encryptionKey });
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  const smtpPassword = securityCrypto.encryptSetting('smtp-password');
  await store.saveEmailSettings({
    host: 'tamarind.beenets.com', port: 25, security: 'plain', username: 'relay-user',
    passwordCiphertext: smtpPassword.ciphertext, passwordIv: smtpPassword.iv, passwordTag: smtpPassword.tag,
    fromAddress: 'security@example.test', temporaryPasswordEnabled: true, updatedBy: 'admin'
  });
  const temporary = securityCrypto.encryptOutboxSecret('temporary-password-value');
  const job = await store.enqueueEmail({
    type: 'temporary_password', targetUsername: 'analyst', recipient: 'analyst@example.test', subject: 'Temporary password',
    metadata: { loginUrl: 'http://10.0.0.5/login/', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    secretCiphertext: temporary.ciphertext, secretIv: temporary.iv, secretTag: temporary.tag
  });
  assert.equal(fs.readFileSync(path.join(dataDir, 'admin-security.json'), 'utf8').includes('temporary-password-value'), false);
  assert.equal(fs.readFileSync(path.join(dataDir, 'admin-security.json'), 'utf8').includes('smtp-password'), false);
  const sent = [];
  let transportConfig = null;
  const worker = createEmailWorker({
    store, securityCrypto, pollIntervalMs: 60_000,
    nodemailerClient: { createTransport(config) { transportConfig = config; return { sendMail: async message => sent.push(message) }; } }
  });
  worker.start();
  t.after(async () => { worker.stop(); await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  assert.equal(await worker.processOne(), true);
  assert.equal(transportConfig.auth.pass, 'smtp-password');
  assert.match(sent[0].text, /temporary-password-value/);
  const completed = await store.getEmailDelivery(job.id);
  assert.equal(completed.status, 'sent');
  assert.equal(completed.secretCiphertext, '');
  assert.equal(JSON.stringify(publicEmailSettings(await store.getEmailSettings())).includes('smtp-password'), false);
  assert.throws(() => createSecurityCrypto({ encryptionKey: Buffer.alloc(32, 8).toString('base64') }).decryptSetting({ ciphertext: smtpPassword.ciphertext, iv: smtpPassword.iv, tag: smtpPassword.tag }));
});

test('email worker cancels a claimed job when its email type is off', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-worker-disabled-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const securityCrypto = createSecurityCrypto({ encryptionKey: Buffer.alloc(32, 7).toString('base64') });
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  await store.saveEmailSettings({
    host: 'tamarind.beenets.com', port: 25, security: 'plain',
    fromAddress: 'security@example.test', updatedBy: 'admin'
  });
  const temporary = securityCrypto.encryptOutboxSecret('cancelled-password-value');
  const job = await store.enqueueEmail({
    type: 'temporary_password', targetUsername: 'analyst', recipient: 'analyst@example.test', subject: 'Temporary password',
    metadata: { loginUrl: 'http://10.0.0.5/login/', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    secretCiphertext: temporary.ciphertext, secretIv: temporary.iv, secretTag: temporary.tag
  });
  let sendCount = 0;
  const worker = createEmailWorker({
    store, securityCrypto, pollIntervalMs: 60_000,
    nodemailerClient: { createTransport() { return { sendMail: async () => { sendCount += 1; } }; } }
  });
  worker.start();
  t.after(async () => { worker.stop(); await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  assert.equal(await worker.processOne(), true);
  assert.equal(sendCount, 0);
  const cancelled = await store.getEmailDelivery(job.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.secretCiphertext, '');
});

test('legacy protected file data cancels in-app setup mail and requires an email invitation resend', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-security-migration-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const legacyPath = path.join(dataDir, 'admin-security.json');
  fs.writeFileSync(legacyPath, JSON.stringify({
    version: 1,
    identities: {},
    temporaryCredentials: {},
    emailSettings: {},
    mfaInvitations: {},
    policies: {
      analyst: { mode: 'authenticator', provider: 'google', notificationStatus: 'sent' }
    },
    outbox: {
      legacy: {
        id: 'legacy', type: 'mfa_setup', targetUsername: 'analyst', recipient: 'analyst@example.test',
        subject: 'Legacy setup', metadata: { setupUrl: 'http://10.0.0.5/#mfa-setup' },
        status: 'queued', secretCiphertext: 'legacy', secretIv: 'legacy', secretTag: 'legacy',
        attemptCount: 0, availableAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
    }
  }));

  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const policy = await store.getMfaPolicy('analyst');
  assert.equal(policy.notificationStatus, 'failed');
  assert.match(policy.notificationError, /resent/i);
  const legacy = await store.getEmailDelivery('legacy');
  assert.equal(legacy.status, 'cancelled');
  assert.equal(legacy.secretCiphertext, '');
  assert.equal(JSON.parse(fs.readFileSync(legacyPath, 'utf8')).version, 2);
});

test('an obsolete claimed setup job cannot overwrite the current invitation delivery status', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfa-stale-delivery-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  await store.setMfaPolicy('analyst', {
    mode: 'authenticator', provider: 'google', enrollmentGeneration: 'old-generation', notificationStatus: 'queued'
  });
  await store.enqueueEmail({
    type: 'mfa_setup', targetUsername: 'analyst', recipient: 'analyst@example.test', subject: 'Old setup',
    metadata: { enrollmentGeneration: 'old-generation' }
  });
  const claimed = await store.claimNextEmail();
  await store.setMfaPolicy('analyst', {
    mode: 'authenticator', provider: 'microsoft', enrollmentGeneration: 'new-generation', notificationStatus: 'queued'
  });
  await store.finishEmail(claimed);
  const current = await store.getMfaPolicy('analyst');
  assert.equal(current.enrollmentGeneration, 'new-generation');
  assert.equal(current.notificationStatus, 'queued');
});

test('file storage persists, invalidates, rate limits, and completes email-only MFA invitations', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfa-invitation-store-'));
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
    { username: 'analyst', status: 'active' },
    { username: 'blocked', status: 'suspended' }
  ]), 'utf8');
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
  const generation = crypto.randomUUID();
  await store.setMfaPolicy('analyst', { mode: 'authenticator', provider: 'google', enrollmentGeneration: generation });
  const first = await store.createMfaInvitation({
    username: 'analyst',
    tokenHash: tokenHash('first-invitation'),
    provider: 'google',
    generation,
    secretCiphertext: 'encrypted-one',
    secretIv: 'iv-one',
    secretTag: 'tag-one'
  });
  assert.equal(first.status, 'active');
  assert.equal(first.generation, generation);
  assert.equal((await store.getActiveMfaInvitation('analyst')).id, first.id);

  const replacement = await store.createMfaInvitation({
    username: 'analyst',
    tokenHash: tokenHash('replacement-invitation'),
    provider: 'google',
    generation,
    secretCiphertext: 'encrypted-two',
    secretIv: 'iv-two',
    secretTag: 'tag-two'
  });
  const cancelled = await store.getMfaInvitation(tokenHash('first-invitation'));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.secretCiphertext, '');

  const reopened = createAdminSecurityStore({ dataDir });
  await reopened.initialize();
  assert.equal((await reopened.getMfaInvitation(tokenHash('replacement-invitation'))).status, 'active');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failed = await reopened.recordMfaInvitationFailure(tokenHash('replacement-invitation'));
    assert.equal(failed.attemptCount, attempt);
  }
  const exhausted = await reopened.getMfaInvitation(tokenHash('replacement-invitation'));
  assert.equal(exhausted.status, 'consumed');
  assert.equal(exhausted.secretCiphertext, '');

  const expiryGeneration = crypto.randomUUID();
  const expiryHash = tokenHash('expired-invitation');
  await reopened.setMfaPolicy('analyst', {
    mode: 'authenticator', provider: 'other', enrollmentGeneration: expiryGeneration
  });
  await reopened.createMfaInvitation({
    username: 'analyst', tokenHash: expiryHash, provider: 'other', generation: expiryGeneration,
    secretCiphertext: 'encrypted-expired', secretIv: 'iv-expired', secretTag: 'tag-expired',
    expiresAt: new Date(Date.now() + 25).toISOString()
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  const expired = await reopened.getMfaInvitation(expiryHash);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.secretCiphertext, '');
  assert.equal(expired.secretIv, '');
  assert.equal(expired.secretTag, '');

  const completionGeneration = crypto.randomUUID();
  await reopened.setMfaPolicy('analyst', {
    mode: 'authenticator',
    provider: 'microsoft',
    enrollmentGeneration: completionGeneration
  });
  const completionHash = tokenHash('completion-invitation');
  await reopened.createMfaInvitation({
    username: 'analyst',
    tokenHash: completionHash,
    provider: 'microsoft',
    generation: completionGeneration,
    secretCiphertext: 'encrypted-complete',
    secretIv: 'iv-complete',
    secretTag: 'tag-complete'
  });
  const completed = await reopened.completeMfaInvitation({ tokenHash: completionHash, lastUsedCounter: 12345 });
  assert.equal(completed.status, 'consumed');
  assert.equal(completed.secretCiphertext, '');
  assert.equal((await reopened.getMfaPolicy('analyst')).enrollmentGeneration, '');
  const mfaData = JSON.parse(fs.readFileSync(path.join(dataDir, 'mfa.json'), 'utf8'));
  assert.equal(mfaData.analyst.provider, 'microsoft');
  assert.equal(mfaData.analyst.lastUsedCounter, 12345);
  assert.equal(mfaData.analyst.secretCiphertext, 'encrypted-complete');
  assert.equal(await reopened.completeMfaInvitation({ tokenHash: completionHash, lastUsedCounter: 12345 }), null);

  const blockedGeneration = crypto.randomUUID();
  const blockedHash = tokenHash('blocked-invitation');
  await reopened.setMfaPolicy('blocked', { mode: 'authenticator', provider: 'other', enrollmentGeneration: blockedGeneration });
  await reopened.createMfaInvitation({
    username: 'blocked', tokenHash: blockedHash, provider: 'other', generation: blockedGeneration,
    secretCiphertext: 'encrypted-blocked', secretIv: 'iv-blocked', secretTag: 'tag-blocked'
  });
  assert.equal(await reopened.completeMfaInvitation({ tokenHash: blockedHash, lastUsedCounter: 99 }), null);
  assert.equal(await reopened.invalidateMfaInvitations('blocked'), 1);
  assert.equal((await reopened.getMfaInvitation(blockedHash)).status, 'cancelled');
  assert.equal((await reopened.getMfaPolicy('blocked')).enrollmentGeneration, '');
  await reopened.close();
});
