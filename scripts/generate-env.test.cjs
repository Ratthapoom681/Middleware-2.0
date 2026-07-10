const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateEnvironment } = require('./generate-env.cjs');

test('environment generator creates strong values and preserves completed files by default', t => {
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

  const result = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(result.generatedKeys.sort(), [
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
    'AUTH_PG_PASSWORD',
    'AUTH_SERVICE_TOKEN',
    'JWT_SECRET',
    'PG_PASSWORD'
  ]);

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

  const secondResult = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(secondResult.generatedKeys, []);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), content);
});

test('environment generator fills only blank or missing managed values in existing files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleware-env-existing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const templatePath = path.join(dir, '.env.example');
  const outputPath = path.join(dir, '.env');

  fs.writeFileSync(templatePath, [
    'PG_PASSWORD=',
    'AUTH_PG_PASSWORD=',
    'JWT_SECRET=',
    'AUTH_SERVICE_TOKEN=',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD='
  ].join('\n'));

  fs.writeFileSync(outputPath, [
    'PG_PASSWORD=keep-app-password',
    'AUTH_PG_PASSWORD=',
    'JWT_SECRET=keep-jwt-secret',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD=',
    'GATEWAY_PORT=80'
  ].join('\n'));

  const result = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(result.generatedKeys.sort(), [
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
    'AUTH_PG_PASSWORD',
    'AUTH_SERVICE_TOKEN'
  ]);

  const content = fs.readFileSync(outputPath, 'utf8');
  assert.match(content, /^PG_PASSWORD=keep-app-password$/m);
  assert.match(content, /^JWT_SECRET=keep-jwt-secret$/m);
  assert.match(content, /^AUTH_PG_PASSWORD=.{32,}$/m);
  assert.match(content, /^AUTH_BOOTSTRAP_ADMIN_PASSWORD=.{32,}$/m);
  assert.match(content, /^AUTH_SERVICE_TOKEN=.{32,}$/m);
  assert.match(content, /^GATEWAY_PORT=80$/m);
});
