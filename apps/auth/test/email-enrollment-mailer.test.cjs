const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAdminSecurityStore } = require('../server/admin-security-store.cjs');
const { createSecurityCrypto } = require('../server/security-crypto.cjs');
const { createEmailWorker } = require('../server/mailer.cjs');

test('MFA setup mail carries the invitation only in the fragment and scrubs its queued ciphertext', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfa-invitation-mailer-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const securityCrypto = createSecurityCrypto({ encryptionKey: Buffer.alloc(32, 7).toString('base64') });
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  await store.saveEmailSettings({
    host: 'tamarind.beenets.com',
    port: 25,
    security: 'plain',
    username: '',
    fromAddress: 'security@example.test',
    updatedBy: 'admin'
  });

  const invitationToken = 'email-only-invitation-token';
  const encrypted = securityCrypto.encryptOutboxSecret(invitationToken);
  const job = await store.enqueueEmail({
    type: 'mfa_setup',
    targetUsername: 'analyst',
    recipient: 'analyst@example.test',
    subject: 'Set up Google Authenticator',
    metadata: {
      provider: 'google',
      setupBaseUrl: 'http://10.145.10.61/login/mfa-setup',
      invitationExpiresAt: new Date(Date.now() + 60_000).toISOString()
    },
    secretCiphertext: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretTag: encrypted.tag
  });

  const messages = [];
  const worker = createEmailWorker({
    store,
    securityCrypto,
    pollIntervalMs: 60_000,
    nodemailerClient: {
      createTransport: () => ({ sendMail: async message => messages.push(message) })
    }
  });
  worker.start();
  t.after(async () => {
    worker.stop();
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  assert.equal(await worker.processOne(), true);
  assert.match(messages[0].text, /http:\/\/10\.145\.10\.61\/login\/mfa-setup#invite=email-only-invitation-token/);
  assert.equal(messages[0].text.includes('?invite='), false);
  assert.equal(JSON.stringify(job.metadata).includes(invitationToken), false);
  const completed = await store.getEmailDelivery(job.id);
  assert.equal(completed.status, 'sent');
  assert.equal(completed.secretCiphertext, '');
});

test('expired MFA setup mail is permanently failed and its secret is scrubbed before SMTP', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expired-mfa-mailer-'));
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  const securityCrypto = createSecurityCrypto({ encryptionKey: Buffer.alloc(32, 8).toString('base64') });
  const store = createAdminSecurityStore({ dataDir });
  await store.initialize();
  await store.saveEmailSettings({
    host: 'tamarind.beenets.com',
    port: 25,
    security: 'plain',
    username: '',
    fromAddress: 'security@example.test',
    updatedBy: 'admin'
  });
  const encrypted = securityCrypto.encryptOutboxSecret('expired-invitation-token');
  const job = await store.enqueueEmail({
    type: 'mfa_setup',
    targetUsername: 'expired-user',
    recipient: 'expired@example.test',
    subject: 'Set up authenticator',
    metadata: {
      provider: 'other',
      setupBaseUrl: 'https://10.145.10.61/login/mfa-setup',
      invitationExpiresAt: new Date(Date.now() - 1_000).toISOString()
    },
    secretCiphertext: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretTag: encrypted.tag
  });
  let sendCount = 0;
  const worker = createEmailWorker({
    store,
    securityCrypto,
    pollIntervalMs: 60_000,
    nodemailerClient: {
      createTransport: () => ({ sendMail: async () => { sendCount += 1; } })
    }
  });
  worker.start();
  t.after(async () => {
    worker.stop();
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  assert.equal(await worker.processOne(), true);
  assert.equal(sendCount, 0);
  const completed = await store.getEmailDelivery(job.id);
  assert.equal(completed.status, 'failed');
  assert.equal(completed.lastError, 'INVITATION_EXPIRED');
  assert.equal(completed.secretCiphertext, '');
  assert.equal(completed.secretIv, '');
  assert.equal(completed.secretTag, '');
});
