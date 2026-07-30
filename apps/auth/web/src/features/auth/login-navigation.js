const SERVICE_PREFIXES = ['/defectdojo/', '/docs/', '/wazuh/'];

export function getSafeLoginReturnTo(search = '') {
  const candidate = new URLSearchParams(search).get('returnTo') || '/';
  if (candidate === '/') return candidate;
  if (candidate.startsWith('//') || !candidate.startsWith('/')) return '/';
  if (candidate === '/#users' || candidate === '/#settings') return candidate;
  if (candidate === '/#profile' || candidate.startsWith('/#profile?')) return candidate;
  return SERVICE_PREFIXES.some(prefix => candidate.startsWith(prefix)) ? candidate : '/';
}

export function getLoginNoticeMessage(notice) {
  if (!notice) return '';
  if (notice === 'password-changed') return 'Password changed. Sign in again.';
  if (notice === 'password-change-expired') return 'Password-change session expired. Sign in again.';
  if (notice === 'mfa-disabled') return 'Authenticator turned off. Sign in again.';
  if (notice === 'session-expired') return 'Your session expired. Sign in again.';
  return 'Your security settings were updated. Sign in again.';
}
