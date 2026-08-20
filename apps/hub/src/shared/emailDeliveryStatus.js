export const EMPTY_EMAIL_SETTINGS = Object.freeze({
  configured: false,
  enabled: true,
  mfaSetupEnabled: true,
  temporaryPasswordEnabled: false,
  capabilities: {
    service: { available: false, reason: 'not_configured' },
    mfaSetup: { available: false, reason: 'not_configured' },
    temporaryPassword: { available: false, reason: 'type_disabled' },
  },
});

export const EMAIL_REASON_COPY = Object.freeze({
  ready: 'Email service is on.',
  service_disabled: 'Email service is off.',
  type_disabled: 'This email type is off.',
  not_configured: 'SMTP is not configured.',
  missing_email: 'No valid email address is saved.',
  queued: 'Email queued.',
});

export function getEmailCapability(settings = EMPTY_EMAIL_SETTINGS, type) {
  const typeEnabled = type === 'mfa_setup'
    ? settings?.mfaSetupEnabled !== false
    : settings?.temporaryPasswordEnabled === true;
  const reason = settings?.enabled === false
    ? 'service_disabled'
    : !typeEnabled
      ? 'type_disabled'
      : settings?.configured ? 'ready' : 'not_configured';
  return { available: reason === 'ready', reason };
}

export const getEmailReasonCopy = reason => EMAIL_REASON_COPY[reason] || 'Email service is off.';
