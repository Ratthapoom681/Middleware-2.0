const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_TEMPLATE_PATH,
  generateEnvironment
} = require('./generate-env.cjs');

test('environment generator defaults resolve from the repository root', () => {
  const repoRoot = path.resolve(__dirname, '..');
  assert.equal(DEFAULT_TEMPLATE_PATH, path.join(repoRoot, '.env.example'));
  assert.equal(DEFAULT_OUTPUT_PATH, path.join(repoRoot, '.env'));
});

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
    'MFA_ENCRYPTION_KEY=',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD=',
    'GATEWAY_PORT=80'
  ].join('\n'));

  const result = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(result.generatedKeys.sort(), [
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
    'AUTH_PG_PASSWORD',
    'AUTH_SERVICE_TOKEN',
    'JWT_SECRET',
    'MFA_ENCRYPTION_KEY',
    'PG_PASSWORD'
  ]);

  const content = fs.readFileSync(outputPath, 'utf8');
  for (const key of [
    'PG_PASSWORD',
    'AUTH_PG_PASSWORD',
    'JWT_SECRET',
    'AUTH_SERVICE_TOKEN',
    'MFA_ENCRYPTION_KEY',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD'
  ]) {
    assert.match(content, new RegExp(`^${key}=.{32,}$`, 'm'));
  }
  const mfaKey = content.match(/^MFA_ENCRYPTION_KEY=(.+)$/m)?.[1];
  assert.equal(Buffer.from(mfaKey, 'base64').length, 32);
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
    'MFA_ENCRYPTION_KEY=',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD='
  ].join('\n'));

  fs.writeFileSync(outputPath, [
    'PG_PASSWORD=keep-app-password',
    'AUTH_PG_PASSWORD=',
    'JWT_SECRET=keep-jwt-secret',
    'MFA_ENCRYPTION_KEY=',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD=',
    'GATEWAY_PORT=80'
  ].join('\n'));

  const result = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(result.generatedKeys.sort(), [
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
    'AUTH_PG_PASSWORD',
    'AUTH_SERVICE_TOKEN',
    'MFA_ENCRYPTION_KEY'
  ]);

  const content = fs.readFileSync(outputPath, 'utf8');
  assert.match(content, /^PG_PASSWORD=keep-app-password$/m);
  assert.match(content, /^JWT_SECRET=keep-jwt-secret$/m);
  assert.match(content, /^AUTH_PG_PASSWORD=.{32,}$/m);
  assert.match(content, /^AUTH_BOOTSTRAP_ADMIN_PASSWORD=.{32,}$/m);
  assert.match(content, /^AUTH_SERVICE_TOKEN=.{32,}$/m);
  assert.equal(Buffer.from(content.match(/^MFA_ENCRYPTION_KEY=(.+)$/m)?.[1], 'base64').length, 32);
  assert.match(content, /^GATEWAY_PORT=80$/m);
});

test('environment generator replaces unsafe auth placeholders without rotating database passwords', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleware-env-placeholder-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const templatePath = path.join(dir, '.env.example');
  const outputPath = path.join(dir, '.env');

  fs.writeFileSync(templatePath, [
    'PG_PASSWORD=',
    'AUTH_PG_PASSWORD=',
    'JWT_SECRET=',
    'AUTH_SERVICE_TOKEN=',
    'MFA_ENCRYPTION_KEY=',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD='
  ].join('\n'));

  fs.writeFileSync(outputPath, [
    'PG_PASSWORD=change-me',
    'AUTH_PG_PASSWORD=change-me',
    'JWT_SECRET=dev-secret-key-change-me-in-production',
    'AUTH_SERVICE_TOKEN=dev-internal-auth-service-token',
    `MFA_ENCRYPTION_KEY=${Buffer.from('development-mfa-encryption-key-change-me', 'utf8').subarray(0, 32).toString('base64')}`,
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD=change-me'
  ].join('\n'));

  const result = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(result.generatedKeys.sort(), [
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD',
    'AUTH_SERVICE_TOKEN',
    'JWT_SECRET',
    'MFA_ENCRYPTION_KEY'
  ]);

  const content = fs.readFileSync(outputPath, 'utf8');
  assert.match(content, /^PG_PASSWORD=change-me$/m);
  assert.match(content, /^AUTH_PG_PASSWORD=change-me$/m);
  assert.doesNotMatch(content, /^JWT_SECRET=dev-secret-key-change-me-in-production$/m);
  assert.doesNotMatch(content, /^AUTH_SERVICE_TOKEN=dev-internal-auth-service-token$/m);
  assert.equal(Buffer.from(content.match(/^MFA_ENCRYPTION_KEY=(.+)$/m)?.[1], 'base64').length, 32);
  assert.doesNotMatch(content, /^AUTH_BOOTSTRAP_ADMIN_PASSWORD=change-me$/m);
});

test('environment generator appends missing mail settings without overwriting operator values', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleware-env-mail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const templatePath = path.join(dir, '.env.example');
  const outputPath = path.join(dir, '.env');

  fs.writeFileSync(templatePath, [
    'APP_PUBLIC_URL=http://localhost',
    'SMTP_HOST=',
    'SMTP_PORT=587',
    'SMTP_SECURE=false',
    'SMTP_USER=',
    'SMTP_PASSWORD=',
    'SMTP_FROM='
  ].join('\n'));
  fs.writeFileSync(outputPath, [
    'PG_PASSWORD=keep-app-password',
    'AUTH_PG_PASSWORD=keep-auth-password',
    'JWT_SECRET=keep-jwt-secret',
    'AUTH_SERVICE_TOKEN=keep-service-token',
    'MFA_ENCRYPTION_KEY=keep-mfa-key',
    'AUTH_BOOTSTRAP_ADMIN_PASSWORD=keep-admin-password',
    'APP_PUBLIC_URL=https://security.example.test',
    'SMTP_HOST=smtp.operator.example',
    'SMTP_PASSWORD=keep-smtp-password'
  ].join('\n'));

  const result = generateEnvironment({ templatePath, outputPath });
  assert.deepEqual(result.generatedKeys, []);
  assert.deepEqual(result.addedKeys, [
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_FROM'
  ]);

  const content = fs.readFileSync(outputPath, 'utf8');
  assert.match(content, /^APP_PUBLIC_URL=https:\/\/security\.example\.test$/m);
  assert.match(content, /^SMTP_HOST=smtp\.operator\.example$/m);
  assert.match(content, /^SMTP_PASSWORD=keep-smtp-password$/m);
  assert.match(content, /^SMTP_PORT=587$/m);
  assert.match(content, /^SMTP_SECURE=false$/m);
  assert.match(content, /^SMTP_USER=$/m);
  assert.match(content, /^SMTP_FROM=$/m);
});

test('environment generator CLI works when launched from the scripts directory', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'middleware-env-cwd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const outputPath = path.join(dir, '.env');

  const stdout = execFileSync(process.execPath, [
    'generate-env.cjs',
    '--output',
    outputPath
  ], {
    cwd: __dirname,
    encoding: 'utf8'
  });

  assert.match(stdout, /^Created .* with generated values for /);
  const content = fs.readFileSync(outputPath, 'utf8');
  assert.match(content, /^PG_PASSWORD=.{32,}$/m);
  assert.match(content, /^AUTH_PG_PASSWORD=.{32,}$/m);
  assert.match(content, /^JWT_SECRET=.{32,}$/m);
  assert.match(content, /^AUTH_SERVICE_TOKEN=.{32,}$/m);
  assert.equal(Buffer.from(content.match(/^MFA_ENCRYPTION_KEY=(.+)$/m)?.[1], 'base64').length, 32);
  assert.match(content, /^AUTH_BOOTSTRAP_ADMIN_PASSWORD=.{32,}$/m);
});
