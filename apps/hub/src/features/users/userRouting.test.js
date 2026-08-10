import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUserAdminPath,
  getUserDetailHash,
  parseUserDetailHash,
} from './userRouting.js';

test('public user IDs produce canonical administration paths and hashes', () => {
  const user = { userId: '000123', username: 'analyst' };
  assert.equal(getUserAdminPath(user), '/users/id/000123');
  assert.equal(getUserDetailHash(user), '#users/id/000123');
  assert.deepEqual(parseUserDetailHash('#users/id/000123'), {
    detail: true,
    userId: '000123',
    username: '',
  });
});

test('legacy and numeric usernames remain compatibility paths without colliding with ID paths', () => {
  assert.equal(getUserAdminPath({ username: 'first last' }), '/users/first%20last');
  assert.equal(getUserDetailHash({ username: 'first last' }), '#users/first%20last');
  assert.deepEqual(parseUserDetailHash('#users/000123'), {
    detail: true,
    userId: '',
    username: '000123',
  });
  assert.deepEqual(parseUserDetailHash('#users/first%20last'), {
    detail: true,
    userId: '',
    username: 'first last',
  });
});
