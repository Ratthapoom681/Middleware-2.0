const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const CONTAINER_FORMAT = [
  '{{.ID}}',
  '{{.Names}}',
  '{{.Label "com.docker.compose.project"}}',
  '{{.Status}}'
].join('\t');

function runDocker(args, { spawn = spawnSync, cwd = REPOSITORY_ROOT } = {}) {
  const result = spawn('docker', args, {
    cwd,
    shell: false,
    encoding: 'utf8'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    const error = new Error(
      `docker ${args.join(' ')} exited with status ${result.status}${detail ? `: ${detail}` : ''}`
    );
    error.exitCode = result.status || 1;
    throw error;
  }

  return String(result.stdout || '');
}

function resolveProjectName(options = {}) {
  const composeOutput = runDocker(
    [
      'compose',
      '--project-directory',
      REPOSITORY_ROOT,
      '-f',
      path.join(REPOSITORY_ROOT, 'docker-compose.yml'),
      'config',
      '--format',
      'json'
    ],
    options
  );

  let config;
  try {
    config = JSON.parse(composeOutput);
  } catch {
    throw new Error('Docker Compose returned invalid JSON while resolving this app project. Cleanup stopped.');
  }

  if (typeof config.name !== 'string' || !config.name.trim()) {
    throw new Error('Docker Compose did not return this app project name. Cleanup stopped.');
  }

  return config.name.trim();
}

function listContainers(options = {}) {
  const output = runDocker(
    ['ps', '--all', '--no-trunc', '--format', CONTAINER_FORMAT],
    options
  );

  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, name, project = '', status = ''] = line.split('\t');
      return { id, name, project, status };
    });
}

function parseArguments(argv) {
  const parsed = { execute: false, confirm: null };

  for (const argument of argv) {
    if (argument === '--execute') {
      parsed.execute = true;
    } else if (argument.startsWith('--confirm=')) {
      parsed.confirm = argument.slice('--confirm='.length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return parsed;
}

function printContainers(containers, logger = console) {
  for (const container of containers) {
    const owner = container.project || '(no Compose project)';
    logger.log(`- ${container.name} [${container.id.slice(0, 12)}] | ${owner} | ${container.status}`);
  }
}

function cleanupForeignContainers({
  argv = process.argv.slice(2),
  spawn = spawnSync,
  logger = console,
  cwd = REPOSITORY_ROOT
} = {}) {
  const arguments_ = parseArguments(argv);
  const dockerOptions = { spawn, cwd };
  const projectName = resolveProjectName(dockerOptions);
  const containers = listContainers(dockerOptions);
  const protectedContainers = containers.filter((container) => container.project === projectName);
  const foreignContainers = containers.filter((container) => container.project !== projectName);

  logger.log(`Protected app project: ${projectName}`);
  logger.log(`Protected containers: ${protectedContainers.length}`);

  if (foreignContainers.length === 0) {
    logger.log('No foreign containers found. Nothing to remove.');
    return { projectName, protectedContainers, foreignContainers, removed: false };
  }

  logger.log(`Foreign containers: ${foreignContainers.length}`);
  printContainers(foreignContainers, logger);
  logger.log('Named volumes, images, and networks are not removed by this script.');

  if (!arguments_.execute) {
    logger.log('Preview only; no containers were changed.');
    logger.log(
      `To stop and remove the listed containers, run: node scripts/cleanup-foreign-containers.cjs --execute --confirm=${projectName}`
    );
    return { projectName, protectedContainers, foreignContainers, removed: false };
  }

  if (arguments_.confirm !== projectName) {
    throw new Error(
      `Confirmation failed. Re-run with --confirm=${projectName} after reviewing the preview.`
    );
  }

  runDocker(['rm', '--force', ...foreignContainers.map((container) => container.id)], dockerOptions);
  logger.log(`Stopped and removed ${foreignContainers.length} foreign container(s).`);

  return { projectName, protectedContainers, foreignContainers, removed: true };
}

if (require.main === module) {
  try {
    cleanupForeignContainers();
  } catch (error) {
    console.error(error.message);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  }
}

module.exports = {
  CONTAINER_FORMAT,
  REPOSITORY_ROOT,
  cleanupForeignContainers,
  listContainers,
  parseArguments,
  resolveProjectName,
  runDocker
};
