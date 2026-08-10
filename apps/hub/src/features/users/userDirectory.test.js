import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleUserSearchText, USER_TABLE_COLUMNS } from './userDirectory.js';

test('the user directory exposes exactly the requested columns in order', () => {
  assert.deepEqual(
    USER_TABLE_COLUMNS.map(column => column.label),
    ['ID', 'Username', 'Full Name', 'Email', 'Company', 'Department', 'Role'],
  );
});

test('user search text contains only visible directory fields', () => {
  const searchText = getVisibleUserSearchText({
    userId: '000042',
    username: 'analyst',
    fullName: 'Test Analyst',
    email: 'analyst@example.test',
    company: 'Beenets',
    department: 'SOC',
    roleName: 'Viewer',
    accountStatus: 'hidden-suspended',
    mfaStatus: 'hidden-enabled',
    lastLoginAt: 'hidden-last-login',
  });
  for (const visibleValue of ['000042', 'analyst', 'test analyst', 'analyst@example.test', 'beenets', 'soc', 'viewer']) {
    assert.equal(searchText.includes(visibleValue), true);
  }
  for (const hiddenValue of ['hidden-suspended', 'hidden-enabled', 'hidden-last-login']) {
    assert.equal(searchText.includes(hiddenValue), false);
  }
});
