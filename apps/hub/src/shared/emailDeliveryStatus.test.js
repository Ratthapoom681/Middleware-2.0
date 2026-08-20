import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmailCapability, getEmailReasonCopy } from './emailDeliveryStatus.js';

test('email capabilities require configuration, the master switch, and the type switch', () => {
  const configured = { configured: true, enabled: true, mfaSetupEnabled: true, temporaryPasswordEnabled: false };
  assert.deepEqual(getEmailCapability(configured, 'mfa_setup'), { available: true, reason: 'ready' });
  assert.deepEqual(getEmailCapability(configured, 'temporary_password'), { available: false, reason: 'type_disabled' });
  assert.deepEqual(getEmailCapability({ ...configured, enabled: false }, 'mfa_setup'), { available: false, reason: 'service_disabled' });
  assert.deepEqual(getEmailCapability({ ...configured, configured: false }, 'mfa_setup'), { available: false, reason: 'not_configured' });
  assert.match(getEmailReasonCopy('type_disabled'), /off/i);
});
