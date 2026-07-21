const test = require('node:test');
const assert = require('node:assert/strict');

const loaders = [
  require('../apps/auth/server/runtime-config.cjs').loadRuntimeSecrets,
  require('../apps/docs/server/runtime-config.cjs').loadRuntimeSecrets,
  require('../apps/vulnerability/server/lib/runtime-config.cjs').loadRuntimeSecrets
];
const productionMfaKey = Buffer.alloc(32, 7).toString('base64');

test('all protected services enforce the same production secret contract', () => {
  for (const loadRuntimeSecrets of loaders) {
    assert.throws(() => loadRuntimeSecrets({ NODE_ENV: 'production' }), /JWT_SECRET/);
    assert.throws(() => loadRuntimeSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'safe-jwt',
      AUTH_SERVICE_TOKEN: 'dev-internal-auth-service-token'
    }), /AUTH_SERVICE_TOKEN/);
    const secrets = loadRuntimeSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'safe-jwt',
      AUTH_SERVICE_TOKEN: 'safe-service-token',
      MFA_ENCRYPTION_KEY: productionMfaKey
    });
    assert.equal(secrets.jwtSecret, 'safe-jwt');
    assert.equal(secrets.authServiceToken, 'safe-service-token');
  }

  assert.throws(() => loaders[0]({
    NODE_ENV: 'production',
    JWT_SECRET: 'safe-jwt',
    AUTH_SERVICE_TOKEN: 'safe-service-token'
  }), /MFA_ENCRYPTION_KEY/);
  assert.equal(loaders[0]({
    NODE_ENV: 'production',
    JWT_SECRET: 'safe-jwt',
    AUTH_SERVICE_TOKEN: 'safe-service-token',
    MFA_ENCRYPTION_KEY: productionMfaKey
  }).mfaEncryptionKey, productionMfaKey);
});
