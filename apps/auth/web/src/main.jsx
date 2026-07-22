import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LoginPage from './features/auth/LoginPage';
import AuthenticatorEnrollmentPage from './features/enrollment/AuthenticatorEnrollmentPage';
import { isEnrollmentPath, takeInvitationFromLocation } from './features/enrollment/enrollment-route';
import './styles.css';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';
const SERVICE_PREFIXES = ['/defectdojo/', '/docs/', '/wazuh/'];

function safeReturnTo() {
  const candidate = new URLSearchParams(window.location.search).get('returnTo') || '/';
  if (candidate === '/') return candidate;
  if (candidate.startsWith('//') || !candidate.startsWith('/')) return '/';
  if (candidate.startsWith('/#profile')) return candidate;
  return SERVICE_PREFIXES.some(prefix => candidate.startsWith(prefix)) ? candidate : '/';
}

const enrollmentRoute = isEnrollmentPath(window.location.pathname);
const invitationToken = enrollmentRoute ? takeInvitationFromLocation(window.location, window.history) : '';
if (enrollmentRoute) document.title = 'Connect Authenticator | Internal Security Portal';

function App() {
  function handleLoginSuccess(user, token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.location.replace(safeReturnTo());
  }

  return enrollmentRoute
    ? <AuthenticatorEnrollmentPage invitationToken={invitationToken} />
    : <LoginPage onLoginSuccess={handleLoginSuccess} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
);
