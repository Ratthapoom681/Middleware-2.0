import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefectDojoPath } from './hubRouting.js';

const customUser = permissions => ({
  access: {
    role: { id: 'custom-role', name: 'Custom role', system: false },
    permissions,
  },
});

test('system administrators open DefectDojo on the dashboard', () => {
  const user = {
    access: {
      role: { id: 'system-administrator', name: 'System Administrator', system: true },
      permissions: [],
    },
  };

  assert.equal(getDefectDojoPath(user), '/defectdojo/#dashboard');
});

test('data managers and sync operators open DefectDojo on the dashboard', () => {
  assert.equal(
    getDefectDojoPath(customUser(['defectdojo.data.manage'])),
    '/defectdojo/#dashboard',
  );
  assert.equal(
    getDefectDojoPath(customUser(['defectdojo.sync.run'])),
    '/defectdojo/#dashboard',
  );
});

test('standard viewers open DefectDojo on the dashboard', () => {
  assert.equal(getDefectDojoPath({ role: 'viewer' }), '/defectdojo/#dashboard');
});

test('roles without dashboard access open their first permitted DefectDojo page', () => {
  assert.equal(
    getDefectDojoPath(customUser([
      'defectdojo.sync_history.view',
      'defectdojo.logs.view',
      'defectdojo.settings.manage',
    ])),
    '/defectdojo/#sync-history',
  );
  assert.equal(
    getDefectDojoPath(customUser(['defectdojo.logs.view'])),
    '/defectdojo/#log-monitor',
  );
  assert.equal(
    getDefectDojoPath(customUser(['defectdojo.settings.manage'])),
    '/defectdojo/#settings',
  );
});

test('users without an applicable permission retain the DefectDojo root fallback', () => {
  assert.equal(getDefectDojoPath(customUser(['docs.view'])), '/defectdojo/');
  assert.equal(getDefectDojoPath(null), '/defectdojo/');
});
