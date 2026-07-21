const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DEFAULT_COMPOSE_ARGS, REPOSITORY_ROOT, runComposeUp } = require('./compose-up.cjs');

test('compose wrapper prepares the environment before starting the stack', () => {
  const calls = [];
  const messages = [];
  const result = runComposeUp({
    extraArgs: ['auth', 'hub'],
    generate: () => {
      calls.push('generate');
      return {
        outputPath: path.join(REPOSITORY_ROOT, '.env'),
        generatedKeys: ['MFA_ENCRYPTION_KEY'],
        addedKeys: [],
        created: false
      };
    },
    spawn: (command, args, options) => {
      calls.push('compose');
      assert.equal(command, 'docker');
      assert.deepEqual(args, [...DEFAULT_COMPOSE_ARGS, 'auth', 'hub']);
      assert.equal(options.cwd, REPOSITORY_ROOT);
      assert.equal(options.shell, false);
      return { status: 0 };
    },
    logger: { log: message => messages.push(message) }
  });

  assert.deepEqual(calls, ['generate', 'compose']);
  assert.match(messages[0], /MFA_ENCRYPTION_KEY/);
  assert.deepEqual(result.command, ['docker', ...DEFAULT_COMPOSE_ARGS, 'auth', 'hub']);
});

test('compose wrapper does not rotate a complete environment', () => {
  let composeStarted = false;
  runComposeUp({
    generate: () => ({ outputPath: '.env', generatedKeys: [], addedKeys: [], created: false }),
    spawn: () => {
      composeStarted = true;
      return { status: 0 };
    },
    logger: { log: () => {} }
  });
  assert.equal(composeStarted, true);
});

test('compose wrapper returns the Docker Compose exit status', () => {
  assert.throws(() => runComposeUp({
    generate: () => ({ outputPath: '.env', generatedKeys: [], addedKeys: [], created: false }),
    spawn: () => ({ status: 17 }),
    logger: { log: () => {} }
  }), error => error.exitCode === 17);
});
