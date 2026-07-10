const test = require('node:test');
const assert = require('node:assert/strict');

const loaders = [
  require('../apps/auth/server/runtime-config.cjs').loadRuntimeSecrets,
  require('../apps/docs/server/runtime-config.cjs').loadRuntimeSecrets,
  require('../apps/vulnerability/server/lib/runtime-config.cjs').loadRuntimeSecrets
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
