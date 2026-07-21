const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cleanupForeignContainers,
  parseArguments
} = require('./cleanup-foreign-containers.cjs');

function createHarness() {
  const calls = [];
  const messages = [];
  const containers = [
    'app-id\tapp-gateway\tinternal-security-middleware\tUp 2 hours',
    'foreign-id\told-api\told-project\tUp 10 minutes',
    'standalone-id\tstandalone-db\t\tExited (0) 3 days ago'
  ].join('\n');

  return {
    calls,
    logger: { log: (message) => messages.push(message) },
    messages,
    spawn(command, args) {
      calls.push([command, ...args]);

      if (args[0] === 'compose') {
        return { status: 0, stdout: '{"name":"internal-security-middleware"}', stderr: '' };
      }
      if (args[0] === 'ps') {
        return { status: 0, stdout: containers, stderr: '' };
      }
      if (args[0] === 'rm') {
        return { status: 0, stdout: '', stderr: '' };
      }

      throw new Error(`Unexpected Docker call: ${args.join(' ')}`);
    }
  };
}

test('parseArguments rejects unknown options', () => {
  assert.throws(() => parseArguments(['--all']), /Unknown argument/);
});

test('preview protects this app and does not remove foreign containers', () => {
  const harness = createHarness();
  const result = cleanupForeignContainers({
    argv: [],
    spawn: harness.spawn,
    logger: harness.logger
  });

  assert.equal(result.removed, false);
  assert.deepEqual(result.protectedContainers.map(({ id }) => id), ['app-id']);
  assert.deepEqual(result.foreignContainers.map(({ id }) => id), ['foreign-id', 'standalone-id']);
  assert.equal(harness.calls.some((call) => call[1] === 'rm'), false);
  assert.match(harness.messages.join('\n'), /Preview only/);
});

test('execute requires the resolved project name as confirmation', () => {
  const harness = createHarness();

  assert.throws(
    () => cleanupForeignContainers({
      argv: ['--execute', '--confirm=wrong-project'],
      spawn: harness.spawn,
      logger: harness.logger
    }),
    /Confirmation failed/
  );
  assert.equal(harness.calls.some((call) => call[1] === 'rm'), false);
});

test('execute force-removes only containers outside this app project', () => {
  const harness = createHarness();
  const result = cleanupForeignContainers({
    argv: ['--execute', '--confirm=internal-security-middleware'],
    spawn: harness.spawn,
    logger: harness.logger
  });

  assert.equal(result.removed, true);
  const removeCall = harness.calls.find((call) => call[1] === 'rm');
  assert.deepEqual(removeCall, [
    'docker',
    'rm',
    '--force',
    'foreign-id',
    'standalone-id'
  ]);
});
