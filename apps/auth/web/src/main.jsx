import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from './features/auth/LoginPage';
import './styles.css';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';
const AUTH_NOTICE_KEY = 'middleware_auth_notice';
const SERVICE_PREFIXES = ['/defectdojo/', '/docs/', '/wazuh/'];

function safeReturnTo() {
  const candidate = new URLSearchParams(window.location.search).get('returnTo') || '/';
  if (candidate === '/') return candidate;
  if (candidate.startsWith('//') || !candidate.startsWith('/')) return '/';
  if (candidate.startsWith('/#profile')) return candidate;
  return SERVICE_PREFIXES.some(prefix => candidate.startsWith(prefix)) ? candidate : '/';
}

function App() {
  function handleLoginSuccess(user, token, meta = {}) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (meta.usedRecoveryCode) {
      sessionStorage.setItem(AUTH_NOTICE_KEY, JSON.stringify({
        type: 'recovery-code-used',
        recoveryCodesRemaining: Number(meta.recoveryCodesRemaining || 0),
      }));
    }
    window.location.replace(safeReturnTo());
  }

  return <LoginPage onLoginSuccess={handleLoginSuccess} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
);
