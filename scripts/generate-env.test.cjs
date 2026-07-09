const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateEnvironment } = require('./generate-env.cjs');

test('environment generator creates strong values and never overwrites by default', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleware-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const templatePath = path.join(dir, '.env.example');
  const outputPath = path.join(dir, '.env');
  fs.writeFileSync(templatePath, [
    'PG_PASSWORD=',
    'AUTH_PG_PASSWORD=',
    'JWT_SECRET=',
    'AUTH_SERVICE_TOKEN=',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD=',
    'GATEWAY_PORT=80'
  ].join('\n'));

  generateEnvironment({ templatePath, outputPath });
  const content = fs.readFileSync(outputPath, 'utf8');
  for (const key of [
    'PG_PASSWORD',
    'AUTH_PG_PASSWORD',
    'JWT_SECRET',
    'AUTH_SERVICE_TOKEN',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD'
  ]) {
    assert.match(content, new RegExp(`^${key}=.{32,}$`, 'm'));
  }
  assert.match(content, /^GATEWAY_PORT=80$/m);
  assert.throws(
    () => generateEnvironment({ templatePath, outputPath }),
    /Refusing to overwrite/
  );
});
