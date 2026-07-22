const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OTPAuth = require('otpauth');

test('admin-controlled identity, pending enrollment, TOTP-only login, and temporary passwords work end to end', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-admin-flow-'));
  process.env.NODE_ENV = 'development';
  process.env.DATA_DIR = dataDir;
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;

  const { authStore, securityStore, emailWorker, start } = require('../server/server.cjs');
  const server = await start(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    emailWorker.stop();
    await new Promise(resolve => server.close(resolve));
    await Promise.all([authStore.close(), securityStore.close()]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const request = async (route, { token, ...options } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
    });
    return { response, data: await response.json().catch(() => ({})) };
  };

  const firstLogin = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  assert.ok(firstLogin.data.token);
  let adminToken = firstLogin.data.token;

  const profilePatch = await request('/api/profile', { token: adminToken, method: 'PATCH', body: JSON.stringify({ email: 'ignored@example.test' }) });
  assert.equal(profilePatch.response.status, 403);

  const identity = await request('/api/users/admin', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({
      email: 'admin@example.test', fullName: 'Security Admin', company: 'Beenets', department: 'Security',
      role: 'admin', status: 'active', products: []
    })
  });
  assert.equal(identity.response.status, 200);
  assert.equal(identity.data.user.fullName, 'Security Admin');

  const wrongSettingsPassword = await request('/api/settings/email', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ host: 'tamarind.beenets.com', port: 25, security: 'plain', fromAddress: 'security@example.test', adminPassword: 'wrong' })
  });
  assert.equal(wrongSettingsPassword.response.status, 400);
  const savedSettings = await request('/api/settings/email', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ host: 'tamarind.beenets.com', port: 25, security: 'plain', username: '', fromAddress: 'security@example.test', adminPassword: 'admin' })
  });
  assert.equal(savedSettings.response.status, 200);
  assert.equal(savedSettings.data.settings.warning.includes('without transport encryption'), true);
  assert.equal(savedSettings.data.settings.password, undefined);

  const enable = await request('/api/users/admin/mfa', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ mode: 'authenticator', adminPassword: 'admin' })
  });
  assert.equal(enable.response.status, 200);
  assert.equal(enable.data.mfa.status, 'pending');
  assert.equal(enable.data.delivery.status, 'queued');
  const setupDelivery = await securityStore.getEmailDelivery(enable.data.delivery.id);
  assert.equal(setupDelivery.metadata.setupUrl, `${baseUrl}/#mfa-setup`);
  assert.equal(JSON.stringify(setupDelivery.metadata).includes('setupToken'), false);
  assert.equal(JSON.stringify(setupDelivery.metadata).includes('otpauth'), false);

  const pendingLogin = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  assert.ok(pendingLogin.data.token, 'pending MFA must still allow password-only login');

  const setup = await request('/api/profile/mfa/enrollment/start', {
    token: adminToken, method: 'POST', body: JSON.stringify({ provider: 'google', currentPassword: 'admin' })
  });
  assert.equal(setup.response.status, 200);
  assert.equal(setup.data.provider, 'google');
  const totp = OTPAuth.URI.parse(setup.data.otpauthUri);
  const confirm = await request('/api/profile/mfa/enrollment/confirm', {
    token: adminToken, method: 'POST', body: JSON.stringify({ setupToken: setup.data.setupToken, code: totp.generate() })
  });
  assert.equal(confirm.response.status, 200);
  assert.equal(confirm.data.mfa.status, 'enabled');
  assert.equal(confirm.data.recoveryCodes, undefined);

  await request('/api/logout', { token: adminToken, method: 'POST' });
  const challenged = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  assert.equal(challenged.data.mfaRequired, true);
  assert.equal(challenged.data.token, undefined);
  const recoveryRejected = await request('/api/login/mfa', {
    method: 'POST', body: JSON.stringify({ challengeToken: challenged.data.challengeToken, code: 'AAAAA-AAAAA-AAAAA', mode: 'recovery' })
  });
  assert.equal(recoveryRejected.response.status, 400);

  const challengedAgain = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  const verified = await request('/api/login/mfa', {
    method: 'POST', body: JSON.stringify({ challengeToken: challengedAgain.data.challengeToken, code: totp.generate({ timestamp: Date.now() + 30_000 }), mode: 'totp' })
  });
  assert.ok(verified.data.token);
  adminToken = verified.data.token;

  const created = await request('/api/users', {
    token: adminToken, method: 'POST', body: JSON.stringify({
      username: 'analyst', email: 'analyst@example.test', fullName: 'Test Analyst', company: 'Beenets', department: 'SOC',
      role: 'viewer', products: ['Product A'], status: 'active', mfaMode: 'disabled',
      adminPassword: 'admin', emailTemporaryPassword: false
    })
  });
  assert.equal(created.response.status, 200);
  assert.match(created.data.temporaryPassword, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(created.response.headers.get('cache-control'), 'no-store');

  const temporaryLogin = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'analyst', password: created.data.temporaryPassword })
  });
  assert.equal(temporaryLogin.data.passwordChangeRequired, true);
  assert.equal(temporaryLogin.data.token, undefined);
  const changed = await request('/api/login/password-change', {
    method: 'POST', body: JSON.stringify({ challengeToken: temporaryLogin.data.challengeToken, newPassword: 'analyst-permanent-password' })
  });
  assert.ok(changed.data.token);
  const analystToken = changed.data.token;

  const reset = await request('/api/users/analyst/password/reset', {
    token: adminToken, method: 'POST', body: JSON.stringify({ adminPassword: 'admin', emailTemporaryPassword: false })
  });
  assert.equal(reset.response.status, 200);
  assert.notEqual(reset.data.temporaryPassword, created.data.temporaryPassword);
  assert.equal((await request('/api/profile', { token: analystToken })).response.status, 401);
  await securityStore.setTemporaryCredential('analyst', { expiresAt: new Date(Date.now() - 1000), createdBy: 'admin' });
  const expiredOnce = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'analyst', password: reset.data.temporaryPassword }) });
  const expiredTwice = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'analyst', password: reset.data.temporaryPassword }) });
  assert.equal(expiredOnce.response.status, 401);
  assert.equal(expiredTwice.response.status, 401, 'expired temporary credentials must never become permanent');
});
