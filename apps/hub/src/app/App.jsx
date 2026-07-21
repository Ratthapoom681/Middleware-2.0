import { useCallback, useState, useEffect } from 'react';
import HubPage from '../features/hub/HubPage';
import UsersPage from '../features/users/UsersPage';
import ProfilePage from '../features/profile/ProfilePage';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';
const AUTH_NOTICE_KEY = 'middleware_auth_notice';

function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

function getAuthNotice() {
  try {
    const raw = sessionStorage.getItem(AUTH_NOTICE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getSafeProfileReturnTo(hash) {
  const [, queryString = ''] = String(hash || '').split('?');
  const candidate = new URLSearchParams(queryString).get('returnTo') || '/';
  if (candidate === '/') return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return ['/defectdojo/', '/docs/', '/wazuh/'].some(prefix => candidate.startsWith(prefix)) ? candidate : '/';
}

export default function App() {
  const [token, setToken] = useState(getStoredToken);
  const [user, setUser] = useState(getStoredUser);
  const [hash, setHash] = useState(window.location.hash);
  const [authNotice] = useState(getAuthNotice);

  /* Listen for hash changes (for #users navigation) */
  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const isHubRoute = !hash.startsWith('#profile') && hash !== '#users' && !hash.startsWith('#docs');
    if (authNotice && isHubRoute) sessionStorage.removeItem(AUTH_NOTICE_KEY);
  }, [authNotice, hash]);

  async function handleLogout() {
    if (token) {
      fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.replace('/login/?returnTo=%2F');
  }

  const handleUserUpdated = useCallback((nextUser) => {
    if (!nextUser) return;
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const handleSessionEnded = useCallback((reason) => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    const params = new URLSearchParams({ returnTo: '/#profile', notice: reason });
    window.location.replace(`/login/?${params.toString()}`);
  }, []);

  /* Authentication is served independently so Hub can fail without blocking login. */
  if (!token || !user) {
    const returnTo = hash.startsWith('#profile') ? `/${hash}` : '/';
    window.location.replace(`/login/?returnTo=${encodeURIComponent(returnTo)}`);
    return null;
  }

  /* Authenticated → route by hash */
  if (hash.startsWith('#docs')) {
    window.location.href = `/docs/${hash}`;
    return null;
  }

  if (hash === '#users' && user.role === 'admin') {
    return <UsersPage token={token} currentUser={user} onBack={() => { window.location.hash = ''; }} />;
  }

  if (hash.startsWith('#profile')) {
    const returnTo = getSafeProfileReturnTo(hash);
    return (
      <ProfilePage
        token={token}
        currentUser={user}
        returnTo={returnTo}
        onBack={() => { window.location.href = returnTo; }}
        onLogout={handleLogout}
        onUserUpdated={handleUserUpdated}
        onSessionEnded={handleSessionEnded}
      />
    );
  }

  return (
    <HubPage
      user={user}
      authNotice={authNotice}
      onOpenDocs={() => { window.location.href = '/docs/'; }}
      onOpenProfile={() => { window.location.hash = '#profile?returnTo=%2F'; }}
      onLogout={handleLogout}
    />
  );
}
