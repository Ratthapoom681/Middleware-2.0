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

  const savedSettings = await request('/api/settings/email', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ host: 'tamarind.beenets.com', port: 25, security: 'plain', username: '', fromAddress: 'security@example.test' })
  });
  assert.equal(savedSettings.response.status, 200);
  assert.equal(savedSettings.data.settings.warning.includes('without transport encryption'), true);
  assert.equal(savedSettings.data.settings.password, undefined);

  const enable = await request('/api/users/admin/mfa', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ mfaProvider: 'google' })
  });
  assert.equal(enable.response.status, 200);
  assert.equal(enable.data.mfa.status, 'pending');
  assert.equal(enable.data.mfa.provider, 'google');
  assert.equal(enable.data.delivery.status, 'queued');
  const setupDelivery = await securityStore.getEmailDelivery(enable.data.delivery.id);
  assert.equal(setupDelivery.metadata.setupUrl, `${baseUrl}/#mfa-setup`);
  assert.equal(setupDelivery.metadata.provider, 'google');
  assert.equal(JSON.stringify(setupDelivery.metadata).includes('setupToken'), false);
  assert.equal(JSON.stringify(setupDelivery.metadata).includes('otpauth'), false);

  const pendingLogin = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  assert.ok(pendingLogin.data.token, 'pending MFA must still allow password-only login');

  const setup = await request('/api/profile/mfa/enrollment/start', {
    token: adminToken, method: 'POST', body: JSON.stringify({ provider: 'microsoft', currentPassword: 'admin' })
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
      role: 'viewer', products: ['Product A'], status: 'active', mfaProvider: 'disabled'
    })
  });
  assert.equal(created.response.status, 200);
  assert.match(created.data.temporaryPassword, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(created.data.deliveryMode, 'queued');
  assert.equal(created.data.deliveries.some(delivery => delivery.type === 'temporary_password'), true);
  assert.equal(created.response.headers.get('cache-control'), 'no-store');

  const copyOnly = await request('/api/users', {
    token: adminToken, method: 'POST', body: JSON.stringify({
      username: 'copyonly', email: '', role: 'viewer', products: [], status: 'active', mfaProvider: 'disabled'
    })
  });
  assert.equal(copyOnly.response.status, 200);
  assert.equal(copyOnly.data.deliveryMode, 'manual_only');
  assert.equal(copyOnly.data.deliveries.length, 0);
  const legacyCopyOnlyUser = await authStore.getUserByUsername('copyonly');
  await authStore.upsertUser({ ...legacyCopyOnlyUser, email: 'legacy-invalid-address' });
  const legacyCopyOnlyReset = await request('/api/users/copyonly/password/reset', { token: adminToken, method: 'POST' });
  assert.equal(legacyCopyOnlyReset.response.status, 200);
  assert.equal(legacyCopyOnlyReset.data.deliveryMode, 'manual_only');

  const invalidEmail = await request('/api/users', {
    token: adminToken, method: 'POST', body: JSON.stringify({
      username: 'invalid-email', email: 'not-an-email', role: 'viewer', products: [], status: 'active', mfaProvider: 'disabled'
    })
  });
  assert.equal(invalidEmail.response.status, 400);

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

  const nonAdminSettings = await request('/api/settings/email', {
    token: analystToken, method: 'PATCH', body: JSON.stringify({ host: 'relay.example.test', port: 25, security: 'plain', fromAddress: 'security@example.test' })
  });
  assert.equal(nonAdminSettings.response.status, 403);

  const analystGoogle = await request('/api/users/analyst/mfa', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ mfaProvider: 'google' })
  });
  assert.equal(analystGoogle.data.mfa.provider, 'google');
  const analystMicrosoft = await request('/api/users/analyst/mfa', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ mfaProvider: 'microsoft' })
  });
  assert.equal(analystMicrosoft.data.mfa.status, 'pending');
  assert.equal(analystMicrosoft.data.mfa.provider, 'microsoft');
  assert.equal((await request('/api/profile', { token: analystToken })).response.status, 200, 'pending provider changes keep current sessions');
  const analystSetup = await request('/api/profile/mfa/enrollment/start', {
    token: analystToken, method: 'POST', body: JSON.stringify({ currentPassword: 'analyst-permanent-password', provider: 'google' })
  });
  assert.equal(analystSetup.data.provider, 'microsoft', 'the administrator-selected provider cannot be overridden by the user');
  const analystTotp = OTPAuth.URI.parse(analystSetup.data.otpauthUri);
  const analystConfirm = await request('/api/profile/mfa/enrollment/confirm', {
    token: analystToken, method: 'POST', body: JSON.stringify({ setupToken: analystSetup.data.setupToken, code: analystTotp.generate() })
  });
  assert.equal(analystConfirm.data.mfa.status, 'enabled');
  const analystOther = await request('/api/users/analyst/mfa', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ mfaProvider: 'other' })
  });
  assert.equal(analystOther.data.mfa.status, 'pending');
  assert.equal(analystOther.data.mfa.provider, 'other');
  assert.equal((await request('/api/profile', { token: analystToken })).response.status, 401, 'changing an enabled provider revokes target sessions');

  const reset = await request('/api/users/analyst/password/reset', {
    token: adminToken, method: 'POST'
  });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.data.deliveryMode, 'queued');
  assert.notEqual(reset.data.temporaryPassword, created.data.temporaryPassword);
  assert.equal((await request('/api/profile', { token: analystToken })).response.status, 401);
  await securityStore.setTemporaryCredential('analyst', { expiresAt: new Date(Date.now() - 1000), createdBy: 'admin' });
  const expiredOnce = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'analyst', password: reset.data.temporaryPassword }) });
  const expiredTwice = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: 'analyst', password: reset.data.temporaryPassword }) });
  assert.equal(expiredOnce.response.status, 401);
  assert.equal(expiredTwice.response.status, 401, 'expired temporary credentials must never become permanent');
});
