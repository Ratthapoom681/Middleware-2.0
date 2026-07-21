const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createMfaService } = require('../server/mfa-service.cjs');

const createService = (fill = 7) => createMfaService({
  encryptionKey: Buffer.alloc(32, fill).toString('base64')
});

test('TOTP validation matches the RFC 6238 SHA-1 vector at 59 seconds', () => {
  const service = createService();
  const counter = service.validateTotp({
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    token: '287082',
    timestamp: 59000
  });
  assert.equal(counter, 1);
  assert.equal(service.validateTotp({
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    token: '000000',
    timestamp: 59000
  }), null);
});

test('enrollment uses interoperable 6 digit, SHA-1, 30 second TOTP parameters', () => {
  const service = createService();
  const enrollment = service.generateEnrollment({ username: 'analyst', provider: 'microsoft' });
  const uri = new URL(enrollment.otpauthUri);
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
  assert.equal(enrollment.provider, 'microsoft');
  assert.equal(enrollment.secret.replace(/\s/g, '').length >= 32, true);
});

test('MFA secrets round-trip through AES-GCM and reject the wrong key', () => {
  const service = createService(3);
  const encrypted = service.encryptSecret('JBSWY3DPEHPK3PXP');
  assert.equal(service.decryptSecret(encrypted), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => createService(4).decryptSecret(encrypted));
  assert.equal(JSON.stringify(encrypted).includes('JBSWY3DPEHPK3PXP'), false);
});

test('opaque challenge tokens are random and stored through a stable SHA-256 hash', () => {
  const service = createService();
  const first = service.createOpaqueToken();
  const second = service.createOpaqueToken();
  assert.notEqual(first, second);
  assert.equal(service.tokenHash(first), crypto.createHash('sha256').update(first).digest('hex'));
});
