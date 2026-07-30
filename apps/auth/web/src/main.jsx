import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './features/auth/login/LoginPage';
import CreatePasswordPage from './features/auth/create-password/CreatePasswordPage';
import AuthenticatorEnrollmentPage from './features/enrollment/AuthenticatorEnrollmentPage';
import { isEnrollmentPath, takeInvitationFromLocation } from './features/enrollment/enrollment-route';
import { getSafeLoginReturnTo } from './features/auth/login-navigation';
import './styles.css';

const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';

const enrollmentRoute = isEnrollmentPath(window.location.pathname);
const invitationToken = enrollmentRoute ? takeInvitationFromLocation(window.location, window.history) : '';
if (enrollmentRoute) document.title = 'Connect Authenticator | Internal Security Portal';

function App() {
  function handleLoginSuccess(user, token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.location.replace(getSafeLoginReturnTo(window.location.search));
  }

  if (enrollmentRoute) {
    return <AuthenticatorEnrollmentPage invitationToken={invitationToken} />;
  }

  return (
    <BrowserRouter basename="/login">
      <Routes>
        <Route path="/" element={<LoginPage onLoginSuccess={handleLoginSuccess} />} />
        <Route
          path="/create-password"
          element={<CreatePasswordPage onLoginSuccess={handleLoginSuccess} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
);
