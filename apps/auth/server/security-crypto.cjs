const crypto = require('crypto');
const { parseEncryptionKey } = require('./mfa-service.cjs');

const deriveKey = (masterKey, label) => Buffer.from(crypto.hkdfSync(
  'sha256', masterKey, Buffer.alloc(0), Buffer.from(label), 32
));

const encryptWithKey = (key, value) => {
  if (!String(value || '')) return { ciphertext: '', iv: '', tag: '' };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
};

const decryptWithKey = (key, value = {}) => {
  const ciphertext = value.ciphertext || value.secretCiphertext || value.passwordCiphertext || '';
  if (!ciphertext) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(value.iv || value.secretIv || value.passwordIv || '', 'base64')
  );
  decipher.setAuthTag(Buffer.from(value.tag || value.secretTag || value.passwordTag || '', 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
};

function createSecurityCrypto({ encryptionKey }) {
  const masterKey = Buffer.isBuffer(encryptionKey) ? encryptionKey : parseEncryptionKey(encryptionKey);
  const settingsKey = deriveKey(masterKey, 'auth-smtp-settings-v1');
  const outboxKey = deriveKey(masterKey, 'auth-email-outbox-v1');
  return {
    encryptSetting: value => encryptWithKey(settingsKey, value),
    decryptSetting: value => decryptWithKey(settingsKey, value),
    encryptOutboxSecret: value => encryptWithKey(outboxKey, value),
    decryptOutboxSecret: value => decryptWithKey(outboxKey, value)
  };
}

module.exports = { createSecurityCrypto };
