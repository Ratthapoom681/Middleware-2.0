const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OTPAuth = require('otpauth');

test('admin-controlled identity, pending enrollment, TOTP login, reset, and password revocation work end to end', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-admin-mfa-routes-'));
  process.env.NODE_ENV = 'development';
  process.env.DATA_DIR = dataDir;
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SMTP_HOST;

  const { authStore, getRequestApplicationUrl, start } = require('../server/server.cjs');
  assert.equal(getRequestApplicationUrl({ headers: {
    origin: 'http://10.20.30.40:8080',
    host: '10.20.30.40:8080'
  } }), 'http://10.20.30.40:8080');
  assert.equal(getRequestApplicationUrl({ headers: {
    origin: 'https://untrusted.example.test',
    host: '10.20.30.40:8080',
    'x-forwarded-proto': 'http'
  } }), 'http://10.20.30.40:8080');
  const server = await start(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await authStore.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const request = async (route, { token, ...options } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  const login = async (username, password) => request('/api/login', {
    method: 'POST', body: JSON.stringify({ username, password })
  });

  const adminLogin = await login('admin', 'admin');
  assert.equal(adminLogin.response.status, 200);
  let adminToken = adminLogin.data.token;

  const profile = await request('/api/profile', { token: adminToken });
  assert.equal(profile.data.user.username, 'admin');
  assert.equal(profile.data.mfa.status, 'disabled');
  assert.equal((await request('/api/profile', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ email: 'bypass@example.test' })
  })).response.status, 403);
  assert.equal((await request('/api/profile/password', {
    token: adminToken, method: 'PATCH', body: JSON.stringify({ currentPassword: 'admin', newPassword: 'bypass-password-123' })
  })).response.status, 403);

  const created = await request('/api/users', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({
      username: 'analyst',
      email: 'analyst@example.test',
      fullName: 'Security Analyst',
      company: 'Example Security',
      department: 'SOC',
      password: 'analyst-password-123',
      role: 'viewer',
      products: ['hub'],
      status: 'active',
      mfaMode: 'disabled'
    })
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.user.fullName, 'Security Analyst');
  assert.equal(created.data.user.mfaStatus, 'disabled');

  const enabled = await request('/api/users/analyst/mfa', {
    token: adminToken,
    method: 'PATCH',
    body: JSON.stringify({ mode: 'authenticator', adminPassword: 'admin', reason: 'User requested Google Authenticator' })
  });
  assert.equal(enabled.response.status, 200);
  assert.equal(enabled.data.mfa.status, 'pending');
  assert.equal(enabled.data.notification.status, 'failed');

  const pendingLogin = await login('analyst', 'analyst-password-123');
  assert.equal(pendingLogin.response.status, 200);
  assert.ok(pendingLogin.data.token);
  assert.equal(pendingLogin.data.mfaRequired, undefined);
  let analystToken = pendingLogin.data.token;

  const pendingProfile = await request('/api/profile', { token: analystToken });
  assert.equal(pendingProfile.data.mfa.status, 'pending');
  const setup = await request('/api/profile/mfa/enrollment/start', {
    token: analystToken,
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'analyst-password-123' })
  });
  assert.equal(setup.response.status, 200);
  assert.ok(setup.data.otpauthUri.startsWith('otpauth://totp/'));
  assert.ok(setup.data.manualKey);
  const totp = OTPAuth.URI.parse(setup.data.otpauthUri);

  const confirmation = await request('/api/profile/mfa/enrollment/confirm', {
    token: analystToken,
    method: 'POST',
    body: JSON.stringify({ setupToken: setup.data.setupToken, code: totp.generate() })
  });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.data.mfa.status, 'enabled');
  assert.equal(confirmation.data.recoveryCodes, undefined);

  await request('/api/logout', { token: analystToken, method: 'POST' });
  const challenged = await login('analyst', 'analyst-password-123');
  assert.equal(challenged.data.mfaRequired, true);
  assert.equal(challenged.data.token, undefined);

  const recoveryRejected = await request('/api/login/mfa', {
    method: 'POST',
    body: JSON.stringify({ challengeToken: challenged.data.challengeToken, code: 'AAAAA-BBBBB-CCCCC', mode: 'recovery' })
  });
  assert.equal(recoveryRejected.response.status, 400);
  assert.match(recoveryRejected.data.error, /Recovery codes are not supported/);

  const verified = await request('/api/login/mfa', {
    method: 'POST',
    body: JSON.stringify({
      challengeToken: challenged.data.challengeToken,
      code: totp.generate({ timestamp: Date.now() + 30000 })
    })
  });
  assert.equal(verified.response.status, 200);
  analystToken = verified.data.token;

  const passwordReset = await request('/api/users/analyst/password', {
    token: adminToken,
    method: 'PATCH',
    body: JSON.stringify({
      adminPassword: 'admin',
      newPassword: 'analyst-password-456',
      reason: 'Scheduled credential rotation'
    })
  });
  assert.equal(passwordReset.response.status, 200);
  assert.equal((await request('/api/profile', { token: analystToken })).response.status, 401);
  assert.equal((await login('analyst', 'analyst-password-456')).data.mfaRequired, true);

  const reset = await request('/api/users/analyst/mfa/reset', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({ adminPassword: 'admin', reason: 'Lost authenticator device' })
  });
  assert.equal(reset.response.status, 200);
  assert.equal(reset.data.mfa.status, 'pending');
  const afterReset = await login('analyst', 'analyst-password-456');
  assert.ok(afterReset.data.token);
  assert.equal(afterReset.data.user.mfaStatus, 'pending');

  const disabled = await request('/api/users/analyst/mfa', {
    token: adminToken,
    method: 'PATCH',
    body: JSON.stringify({ mode: 'disabled', adminPassword: 'admin', reason: 'User no longer requires MFA' })
  });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.data.mfa.status, 'disabled');

  const selfPasswordReset = await request('/api/users/admin/password', {
    token: adminToken,
    method: 'PATCH',
    body: JSON.stringify({
      adminPassword: 'admin',
      newPassword: 'new-admin-password-123',
      reason: 'Administrator credential rotation'
    })
  });
  assert.equal(selfPasswordReset.response.status, 200);
  assert.equal(selfPasswordReset.data.sessionEnded, true);
  assert.equal((await request('/api/profile', { token: adminToken })).response.status, 401);
  const newAdminLogin = await login('admin', 'new-admin-password-123');
  assert.ok(newAdminLogin.data.token);
  adminToken = newAdminLogin.data.token;
  assert.ok(adminToken);
});
