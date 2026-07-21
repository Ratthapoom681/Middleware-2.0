const DEVELOPMENT_JWT_SECRET = 'dev-secret-key-change-me-in-production';
const DEVELOPMENT_SERVICE_TOKEN = 'dev-internal-auth-service-token';
const DEVELOPMENT_MFA_KEY = Buffer.from(
  'development-mfa-encryption-key-change-me',
  'utf8'
).subarray(0, 32).toString('base64');

const UNSAFE_PRODUCTION_VALUES = new Set([
  'change-me',
  'change-this-jwt-secret',
  'change-this-internal-service-token',
  DEVELOPMENT_JWT_SECRET,
  DEVELOPMENT_SERVICE_TOKEN,
  DEVELOPMENT_MFA_KEY
]);

const readSecret = (env, name, developmentFallback) => {
  const value = String(env[name] || '').trim();
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (!production) return value || developmentFallback;
  if (!value || UNSAFE_PRODUCTION_VALUES.has(value)) {
    throw new Error(`${name} must be set to a non-placeholder value in production`);
  }
  return value;
};

const loadRuntimeSecrets = (env = process.env) => ({
  jwtSecret: readSecret(env, 'JWT_SECRET', DEVELOPMENT_JWT_SECRET),
  authServiceToken: readSecret(env, 'AUTH_SERVICE_TOKEN', DEVELOPMENT_SERVICE_TOKEN),
  mfaEncryptionKey: readSecret(env, 'MFA_ENCRYPTION_KEY', DEVELOPMENT_MFA_KEY)
});

module.exports = { loadRuntimeSecrets, UNSAFE_PRODUCTION_VALUES };
