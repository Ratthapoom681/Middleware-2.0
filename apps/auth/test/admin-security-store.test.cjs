const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAdminSecurityStore } = require('../server/admin-security-store.cjs');
const { createSecurityCrypto } = require('../server/security-crypto.cjs');
const { createEmailWorker, publicEmailSettings } = require('../server/mailer.cjs');

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
  await reopened.finishEmail(claimed, { error: 'MAIL_NOT_CONFIGURED', permanent: true });
  assert.equal((await reopened.getEmailDelivery(first.id)).status, 'failed');
  assert.equal((await reopened.getMfaPolicy('analyst')).notificationStatus, 'failed');
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
    fromAddress: 'security@example.test', updatedBy: 'admin'
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
