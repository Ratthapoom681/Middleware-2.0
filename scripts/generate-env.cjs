const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GENERATED_VALUES = {
  PG_PASSWORD: () => crypto.randomBytes(24).toString('hex'),
  AUTH_PG_PASSWORD: () => crypto.randomBytes(24).toString('hex'),
  JWT_SECRET: () => crypto.randomBytes(48).toString('base64url'),
  AUTH_SERVICE_TOKEN: () => crypto.randomBytes(48).toString('base64url'),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: () => crypto.randomBytes(24).toString('base64url')
};

const generateEnvironment = ({
  templatePath = path.resolve('.env.example'),
  outputPath = path.resolve('.env'),
  overwrite = false
} = {}) => {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Environment template not found: ${templatePath}`);
  }
  if (fs.existsSync(outputPath) && !overwrite) {
    throw new Error(`Refusing to overwrite existing environment file: ${outputPath}`);
  }

  const generated = Object.fromEntries(
    Object.entries(GENERATED_VALUES).map(([key, factory]) => [key, factory()])
  );
  const content = fs.readFileSync(templatePath, 'utf8')
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
      if (!match || !generated[match[1]]) return line;
      return `${match[1]}=${generated[match[1]]}`;
    })
    .join('\n');

  fs.writeFileSync(outputPath, content, { encoding: 'utf8', mode: 0o600 });
  return { outputPath, generatedKeys: Object.keys(generated) };
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
    console.log(`Created ${result.outputPath} with generated values for ${result.generatedKeys.join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { generateEnvironment };
