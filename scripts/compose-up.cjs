const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { generateEnvironment } = require('./generate-env.cjs');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_COMPOSE_ARGS = ['compose', 'up', '-d', '--build'];

function runComposeUp({
  extraArgs = [],
  generate = generateEnvironment,
  spawn = spawnSync,
  logger = console,
  cwd = REPOSITORY_ROOT
} = {}) {
  const environment = generate();
  if (environment.generatedKeys.length) {
    const action = environment.created ? 'Created' : 'Updated';
    logger.log(`${action} ${environment.outputPath}; generated ${environment.generatedKeys.join(', ')}`);
  } else {
    logger.log(`Environment ready: ${environment.outputPath}`);
  }

  const args = [...DEFAULT_COMPOSE_ARGS, ...extraArgs];
  const result = spawn('docker', args, {
    cwd,
    shell: false,
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`docker ${args.join(' ')} exited with status ${result.status}`);
    error.exitCode = result.status;
    throw error;
  }

  return { environment, command: ['docker', ...args] };
}

if (require.main === module) {
  try {
    runComposeUp({ extraArgs: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  }
}

module.exports = {
  DEFAULT_COMPOSE_ARGS,
  REPOSITORY_ROOT,
  runComposeUp
};
