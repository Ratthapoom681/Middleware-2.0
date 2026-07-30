const test = require('node:test');
const assert = require('node:assert/strict');

async function loadNavigation() {
  return import('../web/src/features/auth/login-navigation.js');
}

test('Login preserves known Hub and service return destinations', async () => {
  const { getSafeLoginReturnTo } = await loadNavigation();

  assert.equal(getSafeLoginReturnTo('?returnTo=%2F'), '/');
  assert.equal(getSafeLoginReturnTo('?returnTo=%2F%23users'), '/#users');
  assert.equal(getSafeLoginReturnTo('?returnTo=%2F%23settings'), '/#settings');
  assert.equal(
    getSafeLoginReturnTo('?returnTo=%2F%23profile%3FreturnTo%3D%252Fdocs%252F'),
    '/#profile?returnTo=%2Fdocs%2F',
  );
  assert.equal(getSafeLoginReturnTo('?returnTo=%2Fdocs%2F%23guide'), '/docs/#guide');
});

test('Login rejects external, scheme-relative, and unknown return destinations', async () => {
  const { getSafeLoginReturnTo } = await loadNavigation();

  assert.equal(getSafeLoginReturnTo('?returnTo=https%3A%2F%2Fevil.example'), '/');
  assert.equal(getSafeLoginReturnTo('?returnTo=%2F%2Fevil.example'), '/');
  assert.equal(getSafeLoginReturnTo('?returnTo=%2F%23unknown'), '/');
  assert.equal(getSafeLoginReturnTo('?returnTo=%2F%23profile-unknown'), '/');
});

test('Login provides a specific notice for an expired session', async () => {
  const { getLoginNoticeMessage } = await loadNavigation();

  assert.equal(
    getLoginNoticeMessage('session-expired'),
    'Your session expired. Sign in again.',
  );
  assert.equal(
    getLoginNoticeMessage('security-updated'),
    'Your security settings were updated. Sign in again.',
  );
});
