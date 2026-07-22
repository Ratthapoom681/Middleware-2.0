const test = require('node:test');
const assert = require('node:assert/strict');

test('the standalone enrollment route matches only the Auth setup path', async () => {
  const { isEnrollmentPath } = await import('../web/src/features/enrollment/enrollment-route.js');
  assert.equal(isEnrollmentPath('/login/mfa-setup'), true);
  assert.equal(isEnrollmentPath('/login/mfa-setup/'), true);
  assert.equal(isEnrollmentPath('/login/'), false);
  assert.equal(isEnrollmentPath('/#mfa-setup'), false);
});

test('the invitation is read from the fragment and removed from browser history immediately', async () => {
  const { takeInvitationFromLocation } = await import('../web/src/features/enrollment/enrollment-route.js');
  const calls = [];
  const history = {
    state: { navigation: 1 },
    replaceState(...values) { calls.push(values); }
  };
  const token = takeInvitationFromLocation({
    pathname: '/login/mfa-setup',
    search: '?language=en',
    hash: '#invite=single-use_token-123'
  }, history);
  assert.equal(token, 'single-use_token-123');
  assert.deepEqual(calls, [[history.state, '', '/login/mfa-setup?language=en']]);
  assert.equal(calls[0][2].includes('invite'), false);
});
