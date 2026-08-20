import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUserAdminPath,
  getUserDetailHash,
  parseUserDetailHash,
} from './userRouting.js';

test('public user IDs produce canonical administration paths and hashes', () => {
  const user = { userId: '123', username: 'analyst' };
  assert.equal(getUserAdminPath(user), '/users/id/123');
  assert.equal(getUserDetailHash(user), '#users/id/123');
  assert.deepEqual(parseUserDetailHash('#users/id/123'), {
    detail: true,
    userId: '123',
    username: '',
    canonicalHash: '',
  });
});

test('padded public user IDs remain compatible and canonicalize without changing identity', () => {
  assert.equal(getUserAdminPath({ userId: '000123', username: 'analyst' }), '/users/id/123');
  assert.equal(getUserDetailHash({ userId: '000123', username: 'analyst' }), '#users/id/123');
  assert.deepEqual(parseUserDetailHash('#users/id/000123'), {
    detail: true,
    userId: '123',
    username: '',
    canonicalHash: '#users/id/123',
  });
});

test('legacy and numeric usernames remain compatibility paths without colliding with ID paths', () => {
  assert.equal(getUserAdminPath({ username: 'first last' }), '/users/first%20last');
  assert.equal(getUserDetailHash({ username: 'first last' }), '#users/first%20last');
  assert.deepEqual(parseUserDetailHash('#users/000123'), {
    detail: true,
    userId: '',
    username: '000123',
    canonicalHash: '',
  });
  assert.deepEqual(parseUserDetailHash('#users/first%20last'), {
    detail: true,
    userId: '',
    username: 'first last',
    canonicalHash: '',
  });
});
