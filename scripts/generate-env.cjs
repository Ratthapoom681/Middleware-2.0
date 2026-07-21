const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TEMPLATE_PATH = path.join(REPOSITORY_ROOT, '.env.example');
const DEFAULT_OUTPUT_PATH = path.join(REPOSITORY_ROOT, '.env');
const DEVELOPMENT_MFA_KEY = Buffer.from(
  'development-mfa-encryption-key-change-me',
  'utf8'
).subarray(0, 32).toString('base64');

const GENERATED_VALUES = {
  PG_PASSWORD: () => crypto.randomBytes(24).toString('hex'),
  AUTH_PG_PASSWORD: () => crypto.randomBytes(24).toString('hex'),
  JWT_SECRET: () => crypto.randomBytes(48).toString('base64url'),
  AUTH_SERVICE_TOKEN: () => crypto.randomBytes(48).toString('base64url'),
  MFA_ENCRYPTION_KEY: () => crypto.randomBytes(32).toString('base64'),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: () => crypto.randomBytes(24).toString('base64url')
};

const UNSAFE_AUTH_PLACEHOLDERS = new Set([
  'change-me',
  'change-this-jwt-secret',
  'change-this-internal-service-token',
  'dev-secret-key-change-me-in-production',
  'dev-internal-auth-service-token',
  DEVELOPMENT_MFA_KEY
]);

const AUTH_SECRET_KEYS = new Set([
  'JWT_SECRET',
  'AUTH_SERVICE_TOKEN',
  'MFA_ENCRYPTION_KEY',
  'AUTH_BOOTSTRAP_ADMIN_PASSWORD'
]);

const APPENDED_TEMPLATE_KEYS = new Set([
  'APP_PUBLIC_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM'
]);

const parseEnvLine = (line) => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) return null;
  return { key: match[1], value: match[2] };
};

const normalizeEnvValue = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '');

const shouldGenerateValue = (key, value, { fillOnly }) => {
  if (!fillOnly) return true;
  const normalized = normalizeEnvValue(value);
  if (!normalized) return true;
  return AUTH_SECRET_KEYS.has(key) && UNSAFE_AUTH_PLACEHOLDERS.has(normalized);
};

const replaceManagedValues = (content, { fillOnly = false } = {}) => {
  const generated = {};
  const seenKeys = new Set();
  const lines = content.split(/\r?\n/).map(line => {
    const parsed = parseEnvLine(line);
    if (!parsed || !GENERATED_VALUES[parsed.key]) return line;
    seenKeys.add(parsed.key);
    if (!shouldGenerateValue(parsed.key, parsed.value, { fillOnly })) return line;
    generated[parsed.key] = GENERATED_VALUES[parsed.key]();
    return `${parsed.key}=${generated[parsed.key]}`;
  });

  if (fillOnly) {
    const missingKeys = Object.keys(GENERATED_VALUES).filter(key => !seenKeys.has(key));
    if (missingKeys.length) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push('# Generated required local secrets');
      for (const key of missingKeys) {
        generated[key] = GENERATED_VALUES[key]();
        lines.push(`${key}=${generated[key]}`);
      }
    }
  }

  return {
    content: lines.join('\n'),
    generatedKeys: Object.keys(generated)
  };
};

const appendMissingTemplateValues = (content, template) => {
  const existingKeys = new Set(
    content.split(/\r?\n/).map(parseEnvLine).filter(Boolean).map(({ key }) => key)
  );
  const additions = template
    .split(/\r?\n/)
    .map(parseEnvLine)
    .filter(parsed => parsed && APPENDED_TEMPLATE_KEYS.has(parsed.key) && !existingKeys.has(parsed.key));

  if (!additions.length) return { content, addedKeys: [] };

  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  lines.push('# Added application URL and SMTP settings');
  for (const { key, value } of additions) lines.push(`${key}=${value}`);
  return { content: lines.join('\n'), addedKeys: additions.map(({ key }) => key) };
};

const generateEnvironment = ({
  templatePath = DEFAULT_TEMPLATE_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  overwrite = false
} = {}) => {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Environment template not found: ${templatePath}`);
  }

  const outputExists = fs.existsSync(outputPath);
  const sourcePath = outputExists && !overwrite ? outputPath : templatePath;
  const source = fs.readFileSync(sourcePath, 'utf8');
  const template = fs.readFileSync(templatePath, 'utf8');
  const replaced = replaceManagedValues(source, { fillOnly: outputExists && !overwrite });
  const completed = outputExists && !overwrite
    ? appendMissingTemplateValues(replaced.content, template)
    : { content: replaced.content, addedKeys: [] };

  fs.writeFileSync(outputPath, completed.content, { encoding: 'utf8', mode: 0o600 });
  return {
    outputPath,
    generatedKeys: replaced.generatedKeys,
    addedKeys: completed.addedKeys,
    created: !outputExists || overwrite
  };
};

const parseArguments = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--force') options.overwrite = true;
    if (argv[index] === '--template') options.templatePath = path.resolve(argv[++index]);
    if (argv[index] === '--output') options.outputPath = path.resolve(argv[++index]);
  }
  return options;
};

if (require.main === module) {
  try {
    const result = generateEnvironment(parseArguments(process.argv.slice(2)));
    if (result.generatedKeys.length || result.addedKeys.length) {
      const action = result.created ? 'Created' : 'Updated';
      const changes = [];
      if (result.generatedKeys.length) changes.push(`generated values for ${result.generatedKeys.join(', ')}`);
      if (result.addedKeys.length) changes.push(`added settings for ${result.addedKeys.join(', ')}`);
      console.log(`${action} ${result.outputPath} with ${changes.join('; ')}`);
    } else {
      console.log(`No missing generated values found in ${result.outputPath}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_TEMPLATE_PATH,
  appendMissingTemplateValues,
  generateEnvironment,
  replaceManagedValues
};
