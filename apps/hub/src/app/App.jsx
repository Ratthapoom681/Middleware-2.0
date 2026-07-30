import { useCallback, useEffect, useMemo, useState } from 'react';
import HubPage from '../features/hub/HubPage';
import HubShell from '../features/hub/HubShell';
import UserListPage from '../features/users/UserListPage';
import UserDetailPage from '../features/users/UserDetailPage';
import ProfilePage from '../features/profile/ProfilePage';
import SettingsPage from '../features/settings/SettingsPage';
import RolesAccessPage from '../features/roles/RolesAccessPage';
import { hasPermission, isSystemAdmin } from '../../../../packages/access-control/index.js';
import {
  createSessionExpiryHandler,
  getSafeHubReturnTo,
} from '../shared/authenticatedRequest.js';

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
  const [sessionExpiryRedirecting, setSessionExpiryRedirecting] = useState(false);
  const handleUnauthorized = useMemo(() => createSessionExpiryHandler({
    onSessionCleared: () => {
      setSessionExpiryRedirecting(true);
      setToken(null);
      setUser(null);
    },
  }), []);

  /* Listen for hash changes (for #users navigation) */
  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const isHubRoute = !hash.startsWith('#profile') && !hash.startsWith('#users') && hash !== '#settings' && hash !== '#roles' && !hash.startsWith('#docs');
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

  /* Authentication is served independently so Hub can fail without blocking login. */
  if (!token || !user) {
    if (sessionExpiryRedirecting) return null;
    const returnTo = getSafeHubReturnTo(window.location);
    window.location.replace(`/login/?returnTo=${encodeURIComponent(returnTo)}`);
    return null;
  }

  /* Authenticated → route by hash */
  if (hash.startsWith('#docs')) {
    if (!hasPermission(user, 'docs.view')) {
      window.location.hash = '';
      return null;
    }
    window.location.href = `/docs/${hash}`;
    return null;
  }

  if ((hash === '#users' || hash.startsWith('#users/')) && isSystemAdmin(user)) {
    const detailMatch = hash.match(/^#users\/(.+)$/);
    let detailUsername = '';
    if (detailMatch) {
      try {
        detailUsername = decodeURIComponent(detailMatch[1]);
      } catch {
        detailUsername = detailMatch[1];
      }
    }
    return (
      <HubShell
        user={user}
        onOpenDocs={() => { window.location.href = '/docs/'; }}
        onOpenProfile={() => { window.location.hash = '#profile?returnTo=%2F'; }}
        onLogout={handleLogout}
      >
        {detailMatch
          ? (
            <UserDetailPage
              username={detailUsername}
              token={token}
              currentUser={user}
              onUnauthorized={handleUnauthorized}
              onUserUpdated={handleUserUpdated}
            />
          )
          : (
            <UserListPage
              token={token}
              currentUser={user}
              onUnauthorized={handleUnauthorized}
              onUserUpdated={handleUserUpdated}
            />
          )}
      </HubShell>
    );
  }

  if (hash === '#settings' && hasPermission(user, 'hub.settings.manage')) {
    return <SettingsPage token={token} currentUser={user} onUnauthorized={handleUnauthorized} onBack={() => { window.location.hash = ''; }} />;
  }

  if (hash === '#roles' && isSystemAdmin(user)) {
    return <RolesAccessPage token={token} onUnauthorized={handleUnauthorized} onBack={() => { window.location.hash = ''; }} />;
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
        onUnauthorized={handleUnauthorized}
        onUserUpdated={handleUserUpdated}
      />
    );
  }

  return (
    <HubPage
      user={user}
      authNotice={authNotice}
      onOpenDocs={() => { window.location.href = '/docs/'; }}
      onOpenProfile={() => { window.location.hash = '#profile?returnTo=%2F'; }}
      onOpenSettings={() => { window.location.hash = '#settings'; }}
      onOpenRoles={() => { window.location.hash = '#roles'; }}
      onLogout={handleLogout}
    />
  );
}
