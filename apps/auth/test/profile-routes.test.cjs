const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OTPAuth = require('otpauth');

test('profile, authenticator enrollment, MFA login, recovery, and password revocation work end to end', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-profile-routes-'));
  process.env.NODE_ENV = 'development';
  process.env.DATA_DIR = dataDir;
  delete process.env.AUTH_DATABASE_URL;
  delete process.env.DATABASE_URL;

  const { authStore, start } = require('../server/server.cjs');
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

  const passwordLogin = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(passwordLogin.response.status, 200);
  assert.ok(passwordLogin.data.token);
  let token = passwordLogin.data.token;

  const profile = await request('/api/profile', { token });
  assert.equal(profile.data.user.username, 'admin');
  assert.equal(profile.data.mfa.enabled, false);

  const emailUpdate = await request('/api/profile', {
    token, method: 'PATCH', body: JSON.stringify({ email: 'admin@example.test' })
  });
  assert.equal(emailUpdate.response.status, 200);
  assert.equal(emailUpdate.data.user.email, 'admin@example.test');

  const setup = await request('/api/profile/mfa/setup', {
    token,
    method: 'POST',
    body: JSON.stringify({ provider: 'google', currentPassword: 'admin' })
  });
  assert.equal(setup.response.status, 200);
  assert.equal(setup.data.provider, 'google');
  assert.ok(setup.data.otpauthUri.startsWith('otpauth://totp/'));
  const totp = OTPAuth.URI.parse(setup.data.otpauthUri);

  const confirmation = await request('/api/profile/mfa/confirm', {
    token,
    method: 'POST',
    body: JSON.stringify({ setupToken: setup.data.setupToken, code: totp.generate() })
  });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.data.recoveryCodes.length, 10);
  const recoveryCodes = confirmation.data.recoveryCodes;

  await request('/api/logout', { token, method: 'POST' });
  const challengedLogin = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(challengedLogin.data.mfaRequired, true);
  assert.equal(challengedLogin.data.token, undefined);

  const verifiedLogin = await request('/api/login/mfa', {
    method: 'POST',
    body: JSON.stringify({
      challengeToken: challengedLogin.data.challengeToken,
      code: totp.generate({ timestamp: Date.now() + 30000 }),
      mode: 'totp'
    })
  });
  assert.equal(verifiedLogin.response.status, 200);
  assert.ok(verifiedLogin.data.token);
  token = verifiedLogin.data.token;

  await request('/api/logout', { token, method: 'POST' });
  const recoveryChallenge = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const recoveryLogin = await request('/api/login/mfa', {
    method: 'POST',
    body: JSON.stringify({
      challengeToken: recoveryChallenge.data.challengeToken,
      code: recoveryCodes[0],
      mode: 'recovery'
    })
  });
  assert.equal(recoveryLogin.response.status, 200);
  assert.equal(recoveryLogin.data.recoveryCodesRemaining, 9);
  token = recoveryLogin.data.token;

  const createdUser = await request('/api/users', {
    token,
    method: 'POST',
    body: JSON.stringify({
      username: 'analyst',
      password: 'analyst-password-123',
      role: 'viewer',
      products: ['hub'],
      status: 'active'
    })
  });
  assert.equal(createdUser.response.status, 200);

  const analystLogin = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'analyst', password: 'analyst-password-123' })
  });
  const analystToken = analystLogin.data.token;
  assert.ok(analystToken);

  const analystSetup = await request('/api/profile/mfa/setup', {
    token: analystToken,
    method: 'POST',
    body: JSON.stringify({ provider: 'microsoft', currentPassword: 'analyst-password-123' })
  });
  const analystTotp = OTPAuth.URI.parse(analystSetup.data.otpauthUri);
  const analystConfirmation = await request('/api/profile/mfa/confirm', {
    token: analystToken,
    method: 'POST',
    body: JSON.stringify({ setupToken: analystSetup.data.setupToken, code: analystTotp.generate() })
  });
  assert.equal(analystConfirmation.response.status, 200);

  const selfReset = await request('/api/users/admin/mfa/reset', {
    token,
    method: 'POST',
    body: JSON.stringify({ adminPassword: 'admin', reason: 'Self-service check', confirmation: 'admin' })
  });
  assert.equal(selfReset.response.status, 400);

  const adminReset = await request('/api/users/analyst/mfa/reset', {
    token,
    method: 'POST',
    body: JSON.stringify({ adminPassword: 'admin', reason: 'Lost authenticator', confirmation: 'analyst' })
  });
  assert.equal(adminReset.response.status, 200);
  assert.equal((await request('/api/profile', { token: analystToken })).response.status, 401);

  const analystAfterReset = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'analyst', password: 'analyst-password-123' })
  });
  assert.equal(analystAfterReset.response.status, 200);
  assert.ok(analystAfterReset.data.token);
  assert.equal(analystAfterReset.data.mfaRequired, undefined);

  const passwordChange = await request('/api/profile/password', {
    token,
    method: 'PATCH',
    body: JSON.stringify({
      currentPassword: 'admin',
      newPassword: 'a-new-password-123',
      code: recoveryCodes[1],
      mode: 'recovery'
    })
  });
  assert.equal(passwordChange.response.status, 200);
  assert.equal((await request('/api/profile', { token })).response.status, 401);

  const newPasswordLogin = await request('/api/login', {
    method: 'POST', body: JSON.stringify({ username: 'admin', password: 'a-new-password-123' })
  });
  assert.equal(newPasswordLogin.response.status, 200);
  assert.equal(newPasswordLogin.data.mfaRequired, true);
});
