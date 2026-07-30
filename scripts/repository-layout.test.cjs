const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { verifyJwt } = require('../packages/auth-client/index.cjs');
const { withEnvironment } = require('../packages/test-utils/index.cjs');

const ROOT = path.resolve(__dirname, '..');

test('canonical repository boundaries and single Compose model exist', () => {
  [
    'apps/gateway',
    'apps/auth/web',
    'apps/auth/server',
    'apps/hub',
    'apps/vulnerability/web',
    'apps/vulnerability/server',
    'apps/vulnerability/workers',
    'apps/vulnerability/collectors',
    'apps/wazuh',
    'apps/docs/web',
    'apps/docs/server',
    'apps/docs/content',
    'packages/ui',
    'packages/auth-client',
    'packages/time',
    'packages/test-utils',
    'docker-compose.yml'
  ].forEach(relativePath => {
    assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, relativePath);
  });
});

test('gateway forwards RBAC administration APIs to Auth', () => {
  const gatewayConfig = fs.readFileSync(path.join(ROOT, 'apps/gateway/nginx.conf'), 'utf8');
  assert.match(gatewayConfig, /location \^~ \/api\/roles\s*\{/);
  assert.match(gatewayConfig, /location \^~ \/api\/access\/\s*\{/);
});

test('Hub caching keeps entry HTML fresh and never serves it for missing assets', () => {
  const hubConfig = fs.readFileSync(path.join(ROOT, 'apps/hub/nginx.conf'), 'utf8');
  assert.match(hubConfig, /location \^~ \/assets\/\s*\{[\s\S]*?try_files \$uri =404;/);
  assert.match(hubConfig, /Cache-Control "public, max-age=31536000, immutable"/);
  assert.match(hubConfig, /Cache-Control "no-store, no-cache, must-revalidate"/);
});

test('shared auth client validates compatible HS256 tokens', () => {
  const secret = 'repository-layout-test-secret';
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 60 });
  const signature = crypto.createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  assert.equal(verifyJwt(`${header}.${payload}.${signature}`, secret).sub, 'admin');
  assert.equal(verifyJwt(`${header}.${payload}.${signature}`, 'wrong-secret'), null);
});

test('shared test utility restores environment mutations', async () => {
  const original = process.env.REPOSITORY_LAYOUT_TEST;
  await withEnvironment({ REPOSITORY_LAYOUT_TEST: 'temporary' }, async () => {
    assert.equal(process.env.REPOSITORY_LAYOUT_TEST, 'temporary');
  });
  assert.equal(process.env.REPOSITORY_LAYOUT_TEST, original);
});

test('shared browser time package preserves fallback behavior', async () => {
  const { formatBangkokDate, formatBangkokIntl } = await import('../packages/time/index.js');
  assert.equal(formatBangkokDate('not-a-date', 'fallback'), 'fallback');
  assert.equal(formatBangkokIntl('', {}, 'missing'), 'missing');
});
