import { getEmailCapability, getEmailReasonCopy } from '../../shared/emailDeliveryStatus.js';

const normalize = value => String(value || '').trim().toLowerCase();

export const MFA_PROVIDER_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'google', label: 'Google Authenticator' },
  { value: 'microsoft', label: 'Microsoft Authenticator' },
  { value: 'other', label: 'Other authenticator' },
];

const DELIVERY_STATES = {
  queued: { label: 'Email queued', tone: 'queued' },
  sending: { label: 'Sending email', tone: 'sending' },
  sent: { label: 'Email sent', tone: 'sent' },
  failed: { label: 'Email failed', tone: 'failed' },
};

export const hasDeliverableEmail = value => (
  /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(value || '').trim())
);

export function getMfaStatus(user = {}) {
  const status = normalize(user.mfaStatus);
  if (['disabled', 'pending', 'enabled'].includes(status)) return status;
  return user.mfaEnabled ? 'enabled' : user.mfaMode === 'authenticator' ? 'pending' : 'disabled';
}

export function getMfaProvider(user = {}) {
  if (getMfaStatus(user) === 'disabled') return 'disabled';
  const provider = normalize(user.mfaProvider);
  return ['google', 'microsoft', 'other'].includes(provider) ? provider : 'other';
}

export const getMfaProviderLabel = provider => (
  MFA_PROVIDER_OPTIONS.find(option => option.value === provider)?.label || 'Other authenticator'
);

export function getSafeMfaNotificationError(value, deliveryStatus = 'failed') {
  const raw = String(value || '').trim();
  const code = raw.toUpperCase();
  if (code.includes('MAIL_NOT_CONFIGURED')) {
    return 'Email delivery is not configured. Review System Settings and resend the setup email.';
  }
  if (code.includes('INVITATION_EXPIRED')) {
    return 'The setup invitation expired before it could be sent. Resend to create a new invitation.';
  }
  if (code.includes('ETIMEDOUT') || code.includes('TIMEOUT') || code.includes('ESOCKET') || code.includes('ECONNECTION') || code.includes('ECONNREFUSED')) {
    return 'The SMTP server could not be reached in time. Check Email Delivery settings and try again.';
  }
  if (code.includes('EAUTH') || code.includes('AUTHENTICATION')) {
    return 'The SMTP server rejected its credentials. Review Email Delivery settings and try again.';
  }
  if (code.includes('AFTER THE ACCOUNT IS REACTIVATED')) {
    return 'Reactivate the account before resending its authenticator setup email.';
  }
  if (code.includes('AFTER THE EMAIL ADDRESS CHANGED')) {
    return 'The saved email address changed. Resend to create a link for the new address.';
  }
  if (deliveryStatus === 'none') {
    return 'No authenticator setup email is currently recorded. Resend to create a new invitation.';
  }
  return 'The authenticator setup email could not be sent. Review Email Delivery settings and try again.';
}

export function getMfaDeliveryView(user = {}, emailSettings) {
  const mfaStatus = getMfaStatus(user);
  const provider = getMfaProvider(user);
  const providerLabel = getMfaProviderLabel(provider);

  if (mfaStatus === 'disabled') {
    return { mfaStatus, provider, providerLabel, deliveryStatus: '', label: 'Disabled', tone: 'disabled', pending: false, canResend: false, resendDisabledReason: '' };
  }
  if (mfaStatus === 'enabled') {
    return { mfaStatus, provider, providerLabel, deliveryStatus: '', label: providerLabel, tone: 'enabled', pending: false, canResend: false, resendDisabledReason: '' };
  }

  const rawDeliveryStatus = normalize(user.mfaNotificationStatus);
  const deliveryStatus = DELIVERY_STATES[rawDeliveryStatus] ? rawDeliveryStatus : 'none';
  const state = DELIVERY_STATES[deliveryStatus] || { label: 'Email not sent', tone: 'failed' };
  const accountSuspended = normalize(user.accountStatus || user.status) === 'suspended';
  const validEmail = hasDeliverableEmail(user.email);
  const inProgress = ['queued', 'sending'].includes(deliveryStatus);
  const emailCapability = getEmailCapability(emailSettings, 'mfa_setup');
  const resendDisabledReason = accountSuspended
    ? 'Reactivate this account before resending the setup email.'
    : !validEmail
      ? 'Add a valid email address before resending the setup email.'
      : !emailCapability.available
        ? getEmailReasonCopy(emailCapability.reason)
        : deliveryStatus === 'queued'
          ? 'A setup email is already queued.'
          : deliveryStatus === 'sending'
            ? 'The setup email is currently being sent.'
            : '';

  return {
    mfaStatus,
    provider,
    providerLabel,
    deliveryStatus,
    label: state.label,
    tone: state.tone,
    pending: true,
    canResend: !accountSuspended && validEmail && emailCapability.available && !inProgress,
    emailCapability,
    resendDisabledReason,
    failureMessage: ['failed', 'none'].includes(deliveryStatus)
      ? getSafeMfaNotificationError(user.mfaNotificationError, deliveryStatus)
      : '',
  };
}
