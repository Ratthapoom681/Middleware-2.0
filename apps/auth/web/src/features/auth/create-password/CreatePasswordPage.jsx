import { useCallback, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthBackground from '../shared/AuthBackground';
import HuskyMascot from '../shared/HuskyMascot';
import PasswordChecklist from './components/PasswordChecklist';
import PasswordStrengthRing, { getStrengthMeta } from './components/PasswordStrengthRing';
import SuccessOverlay from './components/SuccessOverlay';
import { getPasswordStrength } from './password-policy';
import '../shared/AuthPage.css';
import './CreatePasswordPage.css';

function noticeSearch(search) {
  const params = new URLSearchParams(search);
  params.set('notice', 'password-change-expired');
  return `?${params.toString()}`;
}

export default function CreatePasswordPage({ onLoginSuccess }) {
  const location = useLocation();
  const navigate = useNavigate();
  const challengeToken = typeof location.state?.challengeToken === 'string'
    ? location.state.challengeToken
    : '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmationPassword, setConfirmationPassword] = useState('');
  const [focusedField, setFocusedField] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [completedLogin, setCompletedLogin] = useState(null);
  const strength = getPasswordStrength(newPassword);
  const strengthMeta = getStrengthMeta(strength);

  const handleSuccessComplete = useCallback(() => {
    if (completedLogin) {
      onLoginSuccess?.(completedLogin.user, completedLogin.token);
    }
  }, [completedLogin, onLoginSuccess]);

  if (!challengeToken) {
    return (
      <Navigate
        to={{ pathname: '/', search: location.search }}
        replace
      />
    );
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    if (loading || completedLogin) return;

    if (strength !== 4) {
      setError('Your password must meet all four security requirements.');
      return;
    }

    if (newPassword !== confirmationPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/login/password-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, newPassword }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok && data.restartRequired) {
        navigate(
          { pathname: '/', search: noticeSearch(location.search) },
          { replace: true },
        );
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Unable to change password');
      }

      if (!data.token || !data.user) {
        throw new Error('Password change response was missing session data');
      }

      setFocusedField(null);
      setCompletedLogin({ user: data.user, token: data.token });
    } catch (err) {
      setError(err.message || 'Unable to change password');
    } finally {
      setLoading(false);
    }
  }

  function backToSignIn() {
    navigate(
      { pathname: '/', search: location.search },
      { replace: true },
    );
  }

  return (
    <main className="auth-page create-password-page">
      <AuthBackground idPrefix="create-password" />

      <div className="create-password-card-wrapper">
        <section className="create-password-card" aria-labelledby="create-password-title">
          {!completedLogin && (
            <HuskyMascot
              focusedField={focusedField}
              showPassword={false}
              caretPosition={0.5}
            />
          )}

          <span className="card-tagline">Security Policy</span>
          <h1 className="card-title" id="create-password-title">
            Create a strong password
          </h1>
          <p className="card-subtitle">
            Your temporary password must be replaced before your session can begin.
          </p>

          <form onSubmit={handlePasswordChange} noValidate>
            {error && <div className="login-error" role="alert">{error}</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="new-password">New password</label>
              <div className="input-ring-row">
                <div className="input-wrapper">
                  <input
                    type="password"
                    id="new-password"
                    className="form-input"
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      if (error) setError('');
                    }}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoFocus
                    disabled={loading || Boolean(completedLogin)}
                    aria-describedby="password-strength-label password-requirements"
                    aria-invalid={Boolean(error)}
                  />
                </div>
                <PasswordStrengthRing strength={strength} />
              </div>
              <div
                className={`strength-label strength-${strength}`}
                id="password-strength-label"
                style={{ color: strengthMeta.color }}
              >
                {strengthMeta.label || '—'}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirm-password">
                Confirm new password
              </label>
              <div className="input-wrapper">
                <input
                  type="password"
                  id="confirm-password"
                  className="form-input"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmationPassword}
                  onChange={(event) => {
                    setConfirmationPassword(event.target.value);
                    if (error) setError('');
                  }}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  required
                  disabled={loading || Boolean(completedLogin)}
                  aria-invalid={Boolean(error)}
                />
              </div>
            </div>

            <div id="password-requirements">
              <PasswordChecklist password={newPassword} />
            </div>

            <button
              type="submit"
              className="btn-submit"
              disabled={loading || Boolean(completedLogin) || strength !== 4 || !confirmationPassword}
            >
              {loading && <span className="spinner" aria-hidden="true" />}
              <span>{loading ? 'Changing password…' : 'Change password & sign in'}</span>
            </button>

            <div className="verification-actions">
              <button
                type="button"
                onClick={backToSignIn}
                disabled={loading || Boolean(completedLogin)}
              >
                Back to sign in
              </button>
            </div>
          </form>

          <footer className="card-footer">
            © 2026 Internal Security · Middleware Hub v2.0
          </footer>

          {completedLogin && <SuccessOverlay onComplete={handleSuccessComplete} />}
        </section>
      </div>
    </main>
  );
}
