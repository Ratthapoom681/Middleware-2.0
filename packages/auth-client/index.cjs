const crypto = require('crypto');

const base64UrlDecode = (value) => {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
};

const verifyJwt = (token, secret) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || !secret) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const expected = crypto.createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.exp || Date.now() / 1000 >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

module.exports = { base64UrlDecode, verifyJwt };
