const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuntimeSecrets } = require('../backend/runtime-config.cjs');

test('runtime secrets allow development fallbacks', () => {
  const secrets = loadRuntimeSecrets({ NODE_ENV: 'development' });
  assert.match(secrets.jwtSecret, /^dev-/);
  assert.match(secrets.authServiceToken, /^dev-/);
});

test('runtime secrets reject missing or placeholder production values', () => {
  assert.throws(() => loadRuntimeSecrets({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(() => loadRuntimeSecrets({
    NODE_ENV: 'production',
    JWT_SECRET: 'change-this-jwt-secret',
    AUTH_SERVICE_TOKEN: 'safe-token'
  }), /JWT_SECRET/);
});

test('runtime secrets accept explicit production values', () => {
  assert.deepEqual(loadRuntimeSecrets({
    NODE_ENV: 'production',
    JWT_SECRET: 'production-jwt-value',
    AUTH_SERVICE_TOKEN: 'production-service-token'
  }), {
    jwtSecret: 'production-jwt-value',
    authServiceToken: 'production-service-token'
  });
});
