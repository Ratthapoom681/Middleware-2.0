export function isEnrollmentPath(pathname = '') {
  return String(pathname).replace(/\/+$/, '') === '/login/mfa-setup';
}

export function takeInvitationFromLocation(location, history) {
  const fragment = String(location?.hash || '').startsWith('#')
    ? String(location.hash).slice(1)
    : '';
  const invitationToken = new URLSearchParams(fragment).get('invite') || '';
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  return invitationToken;
}
