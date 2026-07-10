import { useState, useEffect } from 'react';
import HubPage from '../features/hub/HubPage';
import UsersPage from '../features/users/UsersPage';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';

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

export default function App() {
  const [token, setToken] = useState(getStoredToken);
  const [user, setUser] = useState(getStoredUser);
  const [hash, setHash] = useState(window.location.hash);

  /* Listen for hash changes (for #users navigation) */
  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function handleLogout() {
    if (token) {
      fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    window.location.hash = '';
  }

  /* Authentication is served independently so Hub can fail without blocking login. */
  if (!token || !user) {
    window.location.replace('/login/?returnTo=%2F');
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

  return (
    <HubPage
      user={user}
      onOpenDocs={() => { window.location.href = '/docs/'; }}
      onLogout={handleLogout}
    />
  );
}
