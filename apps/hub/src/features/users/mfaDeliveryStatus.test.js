import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMfaDeliveryView,
  getSafeMfaNotificationError,
} from './mfaDeliveryStatus.js';

const pendingUser = overrides => ({
  username: 'analyst',
  email: 'analyst@example.test',
  status: 'active',
  mfaStatus: 'pending',
  mfaProvider: 'microsoft',
  ...overrides,
});

test('disabled and enabled MFA hide setup-email history', () => {
  assert.deepEqual(getMfaDeliveryView({ mfaStatus: 'disabled', mfaProvider: 'disabled' }).label, 'Disabled');
  const enabled = getMfaDeliveryView({
    mfaStatus: 'enabled', mfaProvider: 'google', mfaNotificationStatus: 'failed'
  });
  assert.equal(enabled.label, 'Google Authenticator');
  assert.equal(enabled.deliveryStatus, '');
});

test('pending MFA shows the current setup-email state until enrollment', () => {
  const expected = {
    queued: 'Email queued',
    sending: 'Sending email',
    sent: 'Email sent',
    failed: 'Email failed',
    unknown: 'Email not sent',
  };
  for (const [status, label] of Object.entries(expected)) {
    assert.equal(getMfaDeliveryView(pendingUser({ mfaNotificationStatus: status })).label, label);
  }
});

test('resend is unavailable in progress, without email, and while suspended', () => {
  assert.equal(getMfaDeliveryView(pendingUser({ mfaNotificationStatus: 'queued' })).canResend, false);
  assert.equal(getMfaDeliveryView(pendingUser({ mfaNotificationStatus: 'sending' })).canResend, false);
  assert.match(getMfaDeliveryView(pendingUser({ email: '', mfaNotificationStatus: 'failed' })).resendDisabledReason, /valid email/i);
  assert.match(getMfaDeliveryView(pendingUser({ status: 'suspended', mfaNotificationStatus: 'failed' })).resendDisabledReason, /reactivate/i);
  assert.equal(getMfaDeliveryView(pendingUser({ mfaNotificationStatus: 'sent' })).canResend, true);
});

test('technical mail failures are converted to safe administrator guidance', () => {
  assert.match(getSafeMfaNotificationError('MAIL_NOT_CONFIGURED'), /System Settings/);
  assert.match(getSafeMfaNotificationError('ETIMEDOUT: private relay details'), /could not be reached/i);
  assert.match(getSafeMfaNotificationError('INVITATION_EXPIRED'), /expired/i);
  assert.equal(getSafeMfaNotificationError('password=do-not-display'), 'The authenticator setup email could not be sent. Review Email Delivery settings and try again.');
});
