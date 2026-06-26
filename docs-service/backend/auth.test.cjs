const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const SECRET = 'docs-auth-test-secret';

function sign(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'middleware-hub', aud: 'internal-security-middleware', sub: 'u1', sid: 's1',
    username: 'reader', status: 'active', role: 'viewer', apps: ['docs'],
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...overrides,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('docs verifier accepts authorized tokens and rejects expired or unauthorized tokens', () => {
  process.env.JWT_SECRET = SECRET;
  process.env.AUTH_REQUIRED_APP = 'docs';
  const path = require.resolve('./auth.cjs');
  delete require.cache[path];
  const { verifyJwt, isExpectedPayload } = require(path);
  assert.equal(isExpectedPayload(verifyJwt(sign())), true);
  assert.equal(verifyJwt(sign({ exp: 1 })), null);
  assert.equal(isExpectedPayload(verifyJwt(sign({ apps: ['wazuh'] }))), false);
});
