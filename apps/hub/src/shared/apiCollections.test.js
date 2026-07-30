import test from 'node:test';
import assert from 'node:assert/strict';
import { requireApiCollection } from './apiCollections.js';

test('accepts a bare API collection', () => {
  const roles = [{ id: 'reviewer' }];
  assert.equal(requireApiCollection(roles, { property: 'roles', label: 'Roles' }), roles);
});

test('accepts a named API collection for rolling-release compatibility', () => {
  const roles = [{ id: 'reviewer' }];
  assert.equal(
    requireApiCollection({ roles }, { property: 'roles', label: 'Roles' }),
    roles,
  );
});

test('rejects an unexpected successful response before rendering', () => {
  assert.throws(
    () => requireApiCollection({}, { property: 'roles', label: 'Roles' }),
    /Roles could not be loaded because the server returned an unexpected response/,
  );
});
