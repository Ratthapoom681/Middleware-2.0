import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from './features/auth/LoginPage';
import './styles.css';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';
const SERVICE_PREFIXES = ['/defectdojo/', '/docs/', '/wazuh/'];

function safeReturnTo() {
  const candidate = new URLSearchParams(window.location.search).get('returnTo') || '/';
  if (candidate === '/') return candidate;
  if (candidate.startsWith('//') || !candidate.startsWith('/')) return '/';
  if (candidate.startsWith('/#profile') || candidate.startsWith('/#mfa-setup')) return candidate;
  return SERVICE_PREFIXES.some(prefix => candidate.startsWith(prefix)) ? candidate : '/';
}

function App() {
  function handleLoginSuccess(user, token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.location.replace(safeReturnTo());
  }

  return <LoginPage onLoginSuccess={handleLoginSuccess} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
);
