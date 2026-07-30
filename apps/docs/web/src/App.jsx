import { useState, useEffect, useCallback } from 'react';
import DocsPage from './features/docs/DocsPage';
import { hasPermission } from '../../../../packages/access-control/index.js';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';
const LOGIN_URL = '/login/?returnTo=%2Fdocs%2F';

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

  // Check URL query parameters for token (in case hub passes it in query parameter)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlUser = params.get('user');

    if (urlToken) {
      localStorage.setItem(TOKEN_KEY, urlToken);
      setToken(urlToken);

      if (urlUser) {
        try {
          const parsedUser = JSON.parse(decodeURIComponent(urlUser));
          localStorage.setItem(USER_KEY, JSON.stringify(parsedUser));
          setUser(parsedUser);
        } catch (e) {
          console.error('Error parsing user from URL:', e);
        }
      }

      // Clean up URL query parameters
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleLogout = useCallback(() => {
    if (token) {
      // Call Hub logout endpoint (since the auth session lives on Hub)
      fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    window.location.href = LOGIN_URL;
  }, [token]);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    window.location.href = LOGIN_URL;
  }, []);

  const handleBack = useCallback(() => {
    window.location.href = '/';
  }, []);

  if (!token || !user) {
    // If not authenticated, redirect to Hub home (login)
    // Wait for a tick to ensure state is settled before redirecting
    setTimeout(() => {
      window.location.href = LOGIN_URL;
    }, 100);
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#787f99' }}>
        Redirecting to login...
      </div>
    );
  }

  if (!hasPermission(user, 'docs.view')) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', color: '#c8ccdb', background: '#111522' }}>
        <section style={{ maxWidth: 520, textAlign: 'center' }}>
          <h1>Access denied</h1>
          <p>Your role does not include viewing or exporting documentation.</p>
          <button type="button" onClick={handleBack}>Back to Hub</button>
        </section>
      </main>
    );
  }

  return (
    <DocsPage
      token={token}
      user={user}
      routeHash={hash}
      onBack={handleBack}
      onLogout={handleLogout}
      onUnauthorized={handleUnauthorized}
    />
  );
}
