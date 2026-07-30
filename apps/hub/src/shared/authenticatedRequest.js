const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';

export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error) {
  return error instanceof SessionExpiredError;
}

export function getSafeHubReturnTo(location = globalThis.location) {
  if (!location || String(location.pathname || '/') !== '/') return '/';

  const hash = String(location.hash || '');
  if (hash === '#users' || hash.startsWith('#users/') || hash === '#settings' || hash === '#roles') {
    return `/${hash}`;
  }
  if (hash === '#profile' || hash.startsWith('#profile?')) return `/${hash}`;
  return '/';
}

export function createSessionExpiryHandler({
  storage = globalThis.localStorage,
  location = globalThis.location,
  onSessionCleared = () => {},
} = {}) {
  let redirectStarted = false;

  return function endExpiredSession() {
    if (redirectStarted) return false;
    redirectStarted = true;

    storage?.removeItem(TOKEN_KEY);
    storage?.removeItem(USER_KEY);
    onSessionCleared();

    const params = new URLSearchParams({
      notice: 'session-expired',
      returnTo: getSafeHubReturnTo(location),
    });
    location?.replace(`/login/?${params.toString()}`);
    return true;
  };
}

export function createAuthenticatedRequest({
  token,
  onUnauthorized,
  fetchImpl = globalThis.fetch,
}) {
  return async function authenticatedRequest(path, options = {}) {
    const response = await fetchImpl(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      onUnauthorized?.();
      throw new SessionExpiredError();
    }
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  };
}
