const crypto = require('crypto');
const OTPAuth = require('otpauth');

const MFA_ISSUER = 'Internal Security Middleware';
const MFA_PROVIDERS = new Set(['google', 'microsoft', 'other']);
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

const normalizeProvider = (value) => (
  MFA_PROVIDERS.has(String(value || '').trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : 'other'
);

const normalizeOtp = (value) => String(value || '').replace(/\s+/g, '');
const normalizeRecoveryCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function parseEncryptionKey(value) {
  const key = Buffer.from(String(value || ''), 'base64');
  if (key.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

function createMfaService({ encryptionKey }) {
  const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : parseEncryptionKey(encryptionKey);
  const recoveryKey = crypto.hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from('auth-mfa-recovery-codes'), 32);

  const encryptSecret = (secret) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
    return {
      secretCiphertext: ciphertext.toString('base64'),
      secretIv: iv.toString('base64'),
      secretTag: cipher.getAuthTag().toString('base64')
    };
  };

  const decryptSecret = (record = {}) => {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(record.secretIv || record.secret_iv || '', 'base64')
    );
    decipher.setAuthTag(Buffer.from(record.secretTag || record.secret_tag || '', 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.secretCiphertext || record.secret_ciphertext || '', 'base64')),
      decipher.final()
    ]).toString('utf8');
  };

  const createTotp = ({ username, secret }) => new OTPAuth.TOTP({
    issuer: MFA_ISSUER,
    label: String(username || 'user'),
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret)
  });

  const generateEnrollment = ({ username, provider }) => {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const totp = createTotp({ username, secret });
    return {
      provider: normalizeProvider(provider),
      secret,
      otpauthUri: totp.toString(),
      manualKey: secret.match(/.{1,4}/g).join(' ')
    };
  };

  const validateTotp = ({ secret, token, timestamp = Date.now() }) => {
    const cleanToken = normalizeOtp(token);
    if (!/^\d{6}$/.test(cleanToken)) return null;
    const delta = createTotp({ username: 'verification', secret }).validate({
      token: cleanToken,
      timestamp,
      window: TOTP_WINDOW
    });
    if (delta === null) return null;
    return Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS) + delta;
  };

  const recoveryCodeHash = (code) => crypto
    .createHmac('sha256', recoveryKey)
    .update(normalizeRecoveryCode(code))
    .digest('hex');

  const generateRecoveryCodes = (count = 10) => Array.from({ length: count }, () => {
    let raw = '';
    while (raw.length < 15) {
      const byte = crypto.randomBytes(1)[0];
      if (byte < 224) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
    return raw.match(/.{1,5}/g).join('-');
  });

  const createOpaqueToken = () => crypto.randomBytes(32).toString('base64url');
  const tokenHash = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

  return {
    createOpaqueToken,
    decryptSecret,
    encryptSecret,
    generateEnrollment,
    generateRecoveryCodes,
    normalizeProvider,
    normalizeRecoveryCode,
    recoveryCodeHash,
    tokenHash,
    validateTotp
  };
}

module.exports = {
  MFA_ISSUER,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW,
  createMfaService,
  normalizeProvider,
  normalizeRecoveryCode,
  parseEncryptionKey
};
