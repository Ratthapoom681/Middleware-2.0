const test = require('node:test');
const assert = require('node:assert/strict');

const loaders = [
  require('../auth-service/backend/runtime-config.cjs').loadRuntimeSecrets,
  require('../docs-service/backend/runtime-config.cjs').loadRuntimeSecrets,
  require('../vulnerability-service/backend/lib/runtime-config.cjs').loadRuntimeSecrets
];

test('all protected services enforce the same production secret contract', () => {
  for (const loadRuntimeSecrets of loaders) {
    assert.throws(() => loadRuntimeSecrets({ NODE_ENV: 'production' }), /JWT_SECRET/);
    assert.throws(() => loadRuntimeSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'safe-jwt',
      AUTH_SERVICE_TOKEN: 'dev-internal-auth-service-token'
    }), /AUTH_SERVICE_TOKEN/);
    assert.deepEqual(loadRuntimeSecrets({
      NODE_ENV: 'production',
      JWT_SECRET: 'safe-jwt',
      AUTH_SERVICE_TOKEN: 'safe-service-token'
    }), {
      jwtSecret: 'safe-jwt',
      authServiceToken: 'safe-service-token'
    });
  }
});
