import { useCallback, useRef, useState } from 'react';
import HuskyMascot from './HuskyMascot';
import './LoginPage.css';

function EyeOpenIcon() {
  return (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  );
}

function EyeClosedIcon() {
  return (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </>
  );
}

export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focusedField, setFocusedField] = useState(null);
  const [caretPosition, setCaretPosition] = useState(0.5);
  const [mfaChallenge, setMfaChallenge] = useState('');
  const [authenticatorApp, setAuthenticatorApp] = useState('');
  const [verificationMode, setVerificationMode] = useState('totp');
  const [verificationCode, setVerificationCode] = useState('');
  const passwordRef = useRef(null);
  const textMeasureRef = useRef(null);

  const updateCaretPosition = useCallback((input) => {
    const caretIndex = input.selectionStart ?? input.value.length;

    if (!input.value || caretIndex === 0) {
      setCaretPosition(input.value ? 0 : 0.5);
      return;
    }

    if (!textMeasureRef.current) {
      textMeasureRef.current = document.createElement('canvas');
    }

    const context = textMeasureRef.current.getContext('2d');
    const styles = window.getComputedStyle(input);
    const availableWidth = Math.max(1, input.clientWidth - 32);

    if (context) {
      context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
      const caretOffset = context.measureText(input.value.slice(0, caretIndex)).width;
      setCaretPosition(Math.min(1, Math.max(0, caretOffset / availableWidth)));
    }
  }, []);

  const handleInputInteraction = useCallback((event) => {
    updateCaretPosition(event.currentTarget);
  }, [updateCaretPosition]);

  const handlePasswordVisibility = useCallback(() => {
    setShowPassword((visible) => !visible);
    setFocusedField('password');
    requestAnimationFrame(() => {
      const input = passwordRef.current;
      input?.focus({ preventScroll: true });
      if (input) updateCaretPosition(input);
    });
  }, [updateCaretPosition]);

  async function handleSignIn(event) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Unable to sign in');
      }

      if (data.mfaRequired && data.challengeToken) {
        setMfaChallenge(data.challengeToken);
        setAuthenticatorApp(data.authenticatorApp || 'other');
        setPassword('');
        setFocusedField('otp');
        return;
      }

      if (!data.token || !data.user) {
        throw new Error('Login response was missing session data');
      }

      onLoginSuccess?.(data.user, data.token);
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: mfaChallenge,
          code: verificationCode,
          mode: verificationMode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && data.restartRequired) {
        backToPassword();
        setError(data.error || 'Verification expired. Sign in again.');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Unable to verify code');
      if (!data.token || !data.user) throw new Error('Verification response was missing session data');
      onLoginSuccess?.(data.user, data.token, {
        usedRecoveryCode: verificationMode === 'recovery',
        recoveryCodesRemaining: data.recoveryCodesRemaining,
      });
    } catch (err) {
      setError(err.message || 'Unable to verify code');
    } finally {
      setLoading(false);
    }
  }

  function backToPassword() {
    setMfaChallenge('');
    setAuthenticatorApp('');
    setVerificationCode('');
    setVerificationMode('totp');
    setError('');
    setFocusedField('username');
  }

  const providerLabel = authenticatorApp === 'google'
    ? 'Google Authenticator'
    : authenticatorApp === 'microsoft'
      ? 'Microsoft Authenticator'
      : 'your authenticator app';

  const loginNotice = new URLSearchParams(window.location.search).get('notice');

  return (
    <main className="login-page">
      <div className="bg-blob bg-blob-1" aria-hidden="true" />
      <div className="bg-blob bg-blob-2" aria-hidden="true" />
      <div className="bg-blob bg-blob-3" aria-hidden="true" />

      <div className="login-card-wrapper">
        <section className="login-card" aria-labelledby="login-title">
          <HuskyMascot
            focusedField={focusedField}
            showPassword={showPassword}
            caretPosition={caretPosition}
          />

          <span className="card-tagline">Internal Security Portal</span>
          <h1 className="card-title" id="login-title">{mfaChallenge ? 'Verification required' : 'Sign In'}</h1>

          {loginNotice && !mfaChallenge && (
            <div className="login-notice" role="status">
              {loginNotice === 'password-changed'
                ? 'Password changed. Sign in again.'
                : loginNotice === 'mfa-disabled'
                  ? 'Authenticator turned off. Sign in again.'
                  : 'Your security settings were updated. Sign in again.'}
            </div>
          )}

          {mfaChallenge ? (
            <form onSubmit={handleMfaVerify}>
              {error && <div className="login-error" role="alert">{error}</div>}
              <p className="verification-copy">
                {verificationMode === 'recovery'
                  ? 'Enter one of the recovery codes you saved during setup.'
                  : `Enter the six-digit code from ${providerLabel}.`}
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="verification-code">
                  {verificationMode === 'recovery' ? 'Recovery code' : 'Authenticator code'}
                </label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    id="verification-code"
                    className={`form-input verification-code-input ${verificationMode === 'recovery' ? 'recovery' : ''}`}
                    placeholder={verificationMode === 'recovery' ? 'XXXXX-XXXXX-XXXXX' : '000000'}
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(
                      verificationMode === 'recovery'
                        ? event.target.value.toUpperCase().slice(0, 17)
                        : event.target.value.replace(/\D/g, '').slice(0, 6)
                    )}
                    onFocus={() => setFocusedField('otp')}
                    inputMode={verificationMode === 'recovery' ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    maxLength={verificationMode === 'recovery' ? 17 : 6}
                    pattern={verificationMode === 'recovery' ? undefined : '[0-9]{6}'}
                    required
                    autoFocus
                    disabled={loading}
                    aria-invalid={Boolean(error)}
                  />
                </div>
              </div>
              <button type="submit" className="btn-submit" disabled={loading || !verificationCode}>
                {loading && <span className="spinner" aria-hidden="true" />}
                <span>{loading ? 'Verifying…' : 'Verify and sign in'}</span>
              </button>
              <div className="verification-actions">
                <button type="button" onClick={() => { setVerificationMode(mode => mode === 'recovery' ? 'totp' : 'recovery'); setVerificationCode(''); setError(''); }} disabled={loading}>
                  {verificationMode === 'recovery' ? 'Use authenticator code' : 'Use a recovery code'}
                </button>
                <button type="button" onClick={backToPassword} disabled={loading}>Back to sign in</button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignIn}>
              {error && <div className="login-error" role="alert">{error}</div>}
              <div className="form-group">
                <label className="form-label" htmlFor="username">Username</label>
                <div className="input-wrapper">
                  <input type="text" id="username" className="form-input" placeholder="Enter your username" value={username} onChange={(event) => { setUsername(event.target.value); handleInputInteraction(event); }} onFocus={(event) => { setFocusedField('username'); handleInputInteraction(event); }} onBlur={() => setFocusedField(null)} onKeyUp={handleInputInteraction} onClick={handleInputInteraction} required autoComplete="username" disabled={loading} aria-invalid={Boolean(error)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <input ref={passwordRef} type={showPassword ? 'text' : 'password'} id="password" className="form-input password-input" placeholder="Enter your password" value={password} onChange={(event) => { setPassword(event.target.value); handleInputInteraction(event); }} onFocus={(event) => { setFocusedField('password'); handleInputInteraction(event); }} onBlur={() => setFocusedField(null)} onKeyUp={handleInputInteraction} onClick={handleInputInteraction} onSelect={handleInputInteraction} required autoComplete="current-password" disabled={loading} aria-invalid={Boolean(error)} />
                  <button type="button" className="toggle-password" onClick={handlePasswordVisibility} disabled={loading} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}</svg>
                  </button>
                </div>
              </div>
              <button type="submit" className="btn-submit" disabled={loading}>{loading && <span className="spinner" aria-hidden="true" />}<span>{loading ? 'Authenticating…' : 'Sign In'}</span></button>
            </form>
          )}

          <footer className="card-footer">
            © 2026 Internal Security · Middleware Hub v2.0
          </footer>
        </section>
      </div>
    </main>
  );
}
