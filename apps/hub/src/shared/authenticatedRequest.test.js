import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SessionExpiredError,
  createAuthenticatedRequest,
  createSessionExpiryHandler,
  getSafeHubReturnTo,
} from './authenticatedRequest.js';

function storageWithCredentials() {
  const values = new Map([
    ['middleware_token', 'expired-token'],
    ['middleware_user', '{"username":"admin"}'],
  ]);
  return {
    values,
    removeItem(key) {
      values.delete(key);
    },
  };
}

function response(status, data) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return data;
    },
  };
}

test('safe Hub return paths preserve only known routes', () => {
  assert.equal(getSafeHubReturnTo({ pathname: '/', hash: '' }), '/');
  assert.equal(getSafeHubReturnTo({ pathname: '/', hash: '#users' }), '/#users');
  assert.equal(getSafeHubReturnTo({ pathname: '/', hash: '#users/alice%40example.com' }), '/#users/alice%40example.com');
  assert.equal(getSafeHubReturnTo({ pathname: '/', hash: '#settings' }), '/#settings');
  assert.equal(getSafeHubReturnTo({ pathname: '/', hash: '#roles' }), '/#roles');
  assert.equal(
    getSafeHubReturnTo({ pathname: '/', hash: '#profile?returnTo=%2Fdocs%2F' }),
    '/#profile?returnTo=%2Fdocs%2F',
  );
  assert.equal(getSafeHubReturnTo({ pathname: '/', hash: '#profile-unknown' }), '/');
  assert.equal(getSafeHubReturnTo({ pathname: '//outside.example', hash: '#users' }), '/');
});

test('a 401 clears credentials and redirects to Login with the current safe route', async () => {
  const storage = storageWithCredentials();
  const redirects = [];
  let cleared = 0;
  const location = {
    pathname: '/',
    hash: '#users',
    replace(value) {
      redirects.push(value);
    },
  };
  const onUnauthorized = createSessionExpiryHandler({
    storage,
    location,
    onSessionCleared: () => { cleared += 1; },
  });
  const request = createAuthenticatedRequest({
    token: 'expired-token',
    onUnauthorized,
    fetchImpl: async () => response(401, { error: 'Unauthorized: Invalid or expired token' }),
  });

  await assert.rejects(request('/users'), SessionExpiredError);
  assert.equal(storage.values.has('middleware_token'), false);
  assert.equal(storage.values.has('middleware_user'), false);
  assert.equal(cleared, 1);
  assert.deepEqual(redirects, [
    '/login/?notice=session-expired&returnTo=%2F%23users',
  ]);
});

test('concurrent unauthorized responses start only one redirect', async () => {
  const storage = storageWithCredentials();
  const redirects = [];
  let cleared = 0;
  const onUnauthorized = createSessionExpiryHandler({
    storage,
    location: {
      pathname: '/',
      hash: '#settings',
      replace(value) {
        redirects.push(value);
      },
    },
    onSessionCleared: () => { cleared += 1; },
  });
  const request = createAuthenticatedRequest({
    token: 'expired-token',
    onUnauthorized,
    fetchImpl: async () => response(401, {}),
  });

  await Promise.allSettled([request('/users'), request('/settings/email')]);
  assert.equal(cleared, 1);
  assert.equal(redirects.length, 1);
});

test('a 403 remains a page error and preserves the session', async () => {
  const storage = storageWithCredentials();
  const redirects = [];
  const onUnauthorized = createSessionExpiryHandler({
    storage,
    location: {
      pathname: '/',
      hash: '#settings',
      replace(value) {
        redirects.push(value);
      },
    },
  });
  const request = createAuthenticatedRequest({
    token: 'valid-token',
    onUnauthorized,
    fetchImpl: async () => response(403, { error: 'Administrator access required' }),
  });

  await assert.rejects(request('/settings/email'), /Administrator access required/);
  assert.equal(storage.values.get('middleware_token'), 'expired-token');
  assert.equal(storage.values.has('middleware_user'), true);
  assert.deepEqual(redirects, []);
});

test('authenticated requests attach the token and return parsed JSON', async () => {
  let received;
  const request = createAuthenticatedRequest({
    token: 'valid-token',
    fetchImpl: async (path, options) => {
      received = { path, options };
      return response(200, { ok: true });
    },
  });

  assert.deepEqual(await request('/profile'), { ok: true });
  assert.equal(received.path, '/api/profile');
  assert.equal(received.options.headers.Authorization, 'Bearer valid-token');
});
