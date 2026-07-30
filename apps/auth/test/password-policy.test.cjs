const test = require('node:test');
const assert = require('node:assert/strict');

async function loadPasswordPolicy() {
  return import('../web/src/features/auth/create-password/password-policy.js');
}

test('password policy exposes the four intended requirements', async () => {
  const { PASSWORD_REQUIREMENTS } = await loadPasswordPolicy();

  assert.deepEqual(
    PASSWORD_REQUIREMENTS.map(requirement => requirement.id),
    ['length', 'uppercase', 'lowercase', 'special'],
  );
});

test('password strength counts only satisfied policy requirements', async () => {
  const { getPasswordStrength } = await loadPasswordPolicy();

  assert.equal(getPasswordStrength(''), 0);
  assert.equal(getPasswordStrength('abcdefghijkl'), 2);
  assert.equal(getPasswordStrength('ABCDEFGHIJK!'), 3);
  assert.equal(getPasswordStrength('LongPassword!'), 4);
});

test('numbers are optional and do not increase password strength', async () => {
  const { getPasswordStrength } = await loadPasswordPolicy();

  assert.equal(getPasswordStrength('LongPassword!'), 4);
  assert.equal(getPasswordStrength('lowercase12345'), 2);
});

test('supported bracket characters satisfy the special-character rule', async () => {
  const { getPasswordStrength } = await loadPasswordPolicy();

  assert.equal(getPasswordStrength('LongPassword[]'), 4);
});
