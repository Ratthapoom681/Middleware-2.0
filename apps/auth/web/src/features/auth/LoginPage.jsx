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
  const [verificationCode, setVerificationCode] = useState('');
  const [passwordChangeChallenge, setPasswordChangeChallenge] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmationPassword, setConfirmationPassword] = useState('');
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

      if (data.passwordChangeRequired && data.challengeToken) {
        setPasswordChangeChallenge(data.challengeToken);
        setPassword('');
        setFocusedField('password');
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
          mode: 'totp',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && data.restartRequired) {
        backToPassword();
        setError(data.error || 'Verification expired. Sign in again.');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Unable to verify code');
      if (data.passwordChangeRequired && data.challengeToken) {
        setMfaChallenge('');
        setVerificationCode('');
        setPasswordChangeChallenge(data.challengeToken);
        setFocusedField('password');
        return;
      }
      if (!data.token || !data.user) throw new Error('Verification response was missing session data');
      onLoginSuccess?.(data.user, data.token);
    } catch (err) {
      setError(err.message || 'Unable to verify code');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    if (loading) return;
    if (newPassword !== confirmationPassword) { setError('New passwords do not match'); return; }
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/login/password-change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: passwordChangeChallenge, newPassword })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && data.restartRequired) { backToPassword(); throw new Error(data.error || 'Sign in again'); }
      if (!response.ok) throw new Error(data.error || 'Unable to change password');
      if (!data.token || !data.user) throw new Error('Password change response was missing session data');
      onLoginSuccess?.(data.user, data.token);
    } catch (err) { setError(err.message || 'Unable to change password'); }
    finally { setLoading(false); }
  }

  function backToPassword() {
    setMfaChallenge('');
    setAuthenticatorApp('');
    setVerificationCode('');
    setPasswordChangeChallenge('');
    setNewPassword('');
    setConfirmationPassword('');
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
      <div className="security-background" aria-hidden="true">
        <div className="security-halo" />
        <div className="edge-glow edge-glow-left" />
        <div className="edge-glow edge-glow-right" />
        <div className="security-grid" />

        <svg
          className="security-network"
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <path
              id="login-network-route-outbound"
              d="M105 160L220 225L350 450H1090L1210 210L1325 135"
            />
            <path
              id="login-network-route-return"
              d="M1125 760L1230 600L1090 450H350L205 575L315 740"
            />
          </defs>

          <g className="network-lines" fill="none">
            <path d="M105 160L220 225" />
            <path d="M105 160L178 355" />
            <path d="M220 225L178 355" />
            <path d="M220 225L350 450" />
            <path d="M178 355L350 450" />
            <path d="M178 355L205 575" />
            <path d="M205 575L350 450" />
            <path d="M205 575L315 740" />

            <path className="network-bridge" d="M350 450H1090" />

            <path d="M1090 450L1210 210" />
            <path d="M1090 450L1260 380" />
            <path d="M1090 450L1230 600" />
            <path d="M1210 210L1325 135" />
            <path d="M1210 210L1260 380" />
            <path d="M1260 380L1230 600" />
            <path d="M1230 600L1125 760" />
          </g>

          <g className="network-nodes">
            <circle cx="105" cy="160" r="4" />
            <circle cx="220" cy="225" r="5" />
            <circle cx="178" cy="355" r="3.5" />
            <circle cx="205" cy="575" r="5" />
            <circle className="network-node-arrival network-node-arrival-return" cx="315" cy="740" r="3.5" />
            <circle cx="350" cy="450" r="4.5" />

            <circle cx="1090" cy="450" r="4.5" />
            <circle className="network-node-arrival network-node-arrival-outbound" cx="1325" cy="135" r="4" />
            <circle cx="1210" cy="210" r="5" />
            <circle cx="1260" cy="380" r="3.5" />
            <circle cx="1230" cy="600" r="5" />
            <circle cx="1125" cy="760" r="3.5" />
          </g>

          <g className="network-packets">
            <g className="network-packet network-packet-outbound">
              <circle className="network-packet-glow" r="8" />
              <circle className="network-packet-core" r="3" />
              <animateMotion dur="12s" begin="0s" repeatCount="indefinite">
                <mpath href="#login-network-route-outbound" />
              </animateMotion>
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.05;0.94;1"
                dur="12s"
                begin="0s"
                repeatCount="indefinite"
              />
            </g>

            <g className="network-packet network-packet-return">
              <circle className="network-packet-glow" r="8" />
              <circle className="network-packet-core" r="3" />
              <animateMotion dur="12s" begin="-5s" repeatCount="indefinite">
                <mpath href="#login-network-route-return" />
              </animateMotion>
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.05;0.94;1"
                dur="12s"
                begin="-5s"
                repeatCount="indefinite"
              />
            </g>
          </g>
        </svg>

        <div className="security-vignette" />
      </div>

      <div className="login-card-wrapper">
        <section className="login-card" aria-labelledby="login-title">
          <HuskyMascot
            focusedField={focusedField}
            showPassword={showPassword}
            caretPosition={caretPosition}
          />

          <span className="card-tagline">Internal Security Portal</span>
          <h1 className="card-title" id="login-title">{passwordChangeChallenge ? 'Create a new password' : mfaChallenge ? 'Verification required' : 'Sign In'}</h1>

          {loginNotice && !mfaChallenge && !passwordChangeChallenge && (
            <div className="login-notice" role="status">
              {loginNotice === 'password-changed'
                ? 'Password changed. Sign in again.'
                : loginNotice === 'mfa-disabled'
                  ? 'Authenticator turned off. Sign in again.'
                  : 'Your security settings were updated. Sign in again.'}
            </div>
          )}

          {passwordChangeChallenge ? (
            <form onSubmit={handlePasswordChange}>
              {error && <div className="login-error" role="alert">{error}</div>}
              <p className="verification-copy">Your temporary password must be replaced before a session can be created.</p>
              <div className="form-group"><label className="form-label" htmlFor="new-password">New password</label><div className="input-wrapper"><input type="password" id="new-password" className="form-input" minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required autoFocus disabled={loading} /></div></div>
              <div className="form-group"><label className="form-label" htmlFor="confirm-password">Confirm new password</label><div className="input-wrapper"><input type="password" id="confirm-password" className="form-input" minLength={12} maxLength={128} autoComplete="new-password" value={confirmationPassword} onChange={event => setConfirmationPassword(event.target.value)} required disabled={loading} /></div></div>
              <button type="submit" className="btn-submit" disabled={loading || newPassword.length < 12 || newPassword !== confirmationPassword}>{loading && <span className="spinner" aria-hidden="true" />}<span>{loading ? 'Changing…' : 'Change password and sign in'}</span></button>
              <div className="verification-actions"><button type="button" onClick={backToPassword} disabled={loading}>Back to sign in</button></div>
            </form>
          ) : mfaChallenge ? (
            <form onSubmit={handleMfaVerify}>
              {error && <div className="login-error" role="alert">{error}</div>}
              <p className="verification-copy">
                {`Enter the six-digit code from ${providerLabel}.`}
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="verification-code">
                  Authenticator code
                </label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    id="verification-code"
                    className="form-input verification-code-input"
                    placeholder="000000"
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    onFocus={() => setFocusedField('otp')}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
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
