import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import '../auth/LoginPage.css';
import './AuthenticatorEnrollmentPage.css';

const SIGN_IN_PATH = '/login/';
const TERMINAL_INVITATION_STATUSES = new Set([404, 409, 410]);

function providerDetails(provider) {
  if (provider === 'google') {
    return {
      label: 'Google Authenticator',
      steps: [
        'Open Google Authenticator on your phone.',
        'Tap Add a code (+), then choose Scan a QR code.',
        'Scan the QR code below and enter the six-digit code it creates.',
      ],
    };
  }

  if (provider === 'microsoft') {
    return {
      label: 'Microsoft Authenticator',
      steps: [
        'Open Microsoft Authenticator on your phone.',
        'Tap Add account (+), choose Other account, then Scan a QR code.',
        'Scan the QR code below and enter the six-digit code it creates.',
      ],
    };
  }

  return {
    label: 'Other authenticator',
    steps: [
      'Open your authenticator app on your phone.',
      'Add a time-based (TOTP) account and choose its QR-code option.',
      'Scan the QR code below and enter the six-digit code it creates.',
    ],
  };
}

function safeSignInUrl(candidate) {
  try {
    const url = new URL(candidate || SIGN_IN_PATH, window.location.origin);
    if (url.origin !== window.location.origin || !/^\/login\/?$/.test(url.pathname)) return SIGN_IN_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return SIGN_IN_PATH;
  }
}

function formatExpiry(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function postEnrollment(path, body) {
  const response = await fetch(`/api/mfa/enrollment/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function copyTextFallback(value) {
  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  textArea.remove();
  if (!copied) throw new Error('Copy was not available');
}

function SecurityBackground() {
  return <div className="security-background" aria-hidden="true">
    <div className="security-halo" />
    <div className="edge-glow edge-glow-left" />
    <div className="edge-glow edge-glow-right" />
    <div className="security-grid" />
    <div className="security-vignette" />
  </div>;
}

function ShieldIcon({ success = false }) {
  return <svg className={success ? 'success-icon' : ''} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" />
    {success && <path d="m8.6 12.1 2.1 2.1 4.8-5" />}
  </svg>;
}

export default function AuthenticatorEnrollmentPage({ invitationToken }) {
  const [status, setStatus] = useState(invitationToken ? 'loading' : 'invalid');
  const [details, setDetails] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrUnavailable, setQrUnavailable] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [signInUrl, setSignInUrl] = useState(SIGN_IN_PATH);
  const errorRef = useRef(null);
  const statusHeadingRef = useRef(null);
  const startedRef = useRef(false);

  const loadEnrollment = useCallback(async () => {
    if (!invitationToken) {
      setStatus('invalid');
      return;
    }

    setStatus('loading');
    setError('');
    setQrDataUrl('');
    setQrUnavailable(false);

    try {
      const { response, data } = await postEnrollment('start', { invitationToken });
      if (!response.ok) {
        if ([400, 401, 403, ...TERMINAL_INVITATION_STATUSES].includes(response.status) || data.invitationInvalid) {
          setStatus('invalid');
          return;
        }
        throw new Error('The enrollment service is temporarily unavailable.');
      }

      if (!data.otpauthUri || !data.manualKey || !data.provider) {
        throw new Error('The enrollment details were incomplete.');
      }

      const nextDetails = {
        provider: ['google', 'microsoft', 'other'].includes(data.provider) ? data.provider : 'other',
        accountLabel: data.accountLabel || 'Your account',
        issuer: data.issuer || 'Internal Security Middleware',
        otpauthUri: data.otpauthUri,
        manualKey: data.manualKey,
        expiresAt: data.expiresAt,
      };
      setDetails(nextDetails);

      try {
        const image = await QRCode.toDataURL(nextDetails.otpauthUri, {
          width: 256,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0b0e17', light: '#ffffff' },
        });
        setQrDataUrl(image);
      } catch {
        setQrUnavailable(true);
      }
      setStatus('ready');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load authenticator setup.');
      setStatus('error');
    }
  }, [invitationToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    loadEnrollment();
  }, [loadEnrollment]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (['invalid', 'success'].includes(status) || (status === 'ready' && !error)) {
      statusHeadingRef.current?.focus();
    }
  }, [status, error]);

  async function copyManualKey() {
    const key = String(details?.manualKey || '').replace(/\s/g, '');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(key);
      else copyTextFallback(key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy is unavailable in this browser. Select the setup key and copy it manually.');
    }
  }

  async function confirmEnrollment(event) {
    event.preventDefault();
    if (status !== 'ready' || code.length !== 6) return;

    setStatus('confirming');
    setError('');
    try {
      const { response, data } = await postEnrollment('confirm', { invitationToken, code });
      if (!response.ok) {
        if (TERMINAL_INVITATION_STATUSES.has(response.status) || data.invitationInvalid || data.restartRequired) {
          setCode('');
          setDetails(null);
          setQrDataUrl('');
          setStatus('invalid');
          return;
        }
        setCode('');
        setError(response.status >= 500
          ? 'The enrollment service is temporarily unavailable. Try again.'
          : 'That code could not be verified. Check your device time and try again.');
        setStatus('ready');
        return;
      }

      localStorage.removeItem('middleware_token');
      localStorage.removeItem('middleware_user');
      setSignInUrl(safeSignInUrl(data.signInUrl));
      setDetails(null);
      setQrDataUrl('');
      setCode('');
      setStatus('success');
    } catch {
      setError('The enrollment service is temporarily unavailable. Try again.');
      setStatus('ready');
    }
  }

  const provider = providerDetails(details?.provider);
  const expiry = formatExpiry(details?.expiresAt);

  return <main className="login-page authenticator-enrollment-page">
    <SecurityBackground />
    <div className="enrollment-card-wrapper">
      <section className="enrollment-card" aria-labelledby="enrollment-title">
        <header className="enrollment-card-header">
          <span className="enrollment-shield"><ShieldIcon success={status === 'success'} /></span>
          <div>
            <span className="card-tagline">Internal Security Portal</span>
            <h1 className="card-title" id="enrollment-title">
              {status === 'success' ? 'Authenticator connected' : 'Connect your authenticator'}
            </h1>
          </div>
        </header>

        {status === 'loading' && <div className="enrollment-status" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2>Opening your secure invitation</h2>
          <p>This should only take a moment.</p>
        </div>}

        {status === 'error' && <div className="enrollment-status">
          <h2>Setup is temporarily unavailable</h2>
          <p ref={errorRef} role="alert" tabIndex="-1">{error}</p>
          <button type="button" className="btn-submit enrollment-single-action" onClick={loadEnrollment}>Try again</button>
        </div>}

        {status === 'invalid' && <div className="enrollment-status" role="alert">
          <h2 ref={statusHeadingRef} tabIndex="-1">This setup link has expired or is no longer available</h2>
          <p>The invitation may have expired, already been used, or been replaced. Ask your administrator to resend the authenticator setup email.</p>
          <a className="btn-submit enrollment-link-button" href={SIGN_IN_PATH}>Go to sign in</a>
        </div>}

        {status === 'success' && <div className="enrollment-status enrollment-success" role="status">
          <ShieldIcon success />
          <h2 ref={statusHeadingRef} tabIndex="-1">Setup complete</h2>
          <p>Your authenticator is ready. For your security, existing sessions were signed out. Use a six-digit code the next time you sign in.</p>
          <a className="btn-submit enrollment-link-button" href={signInUrl}>Go to sign in</a>
        </div>}

        {(status === 'ready' || status === 'confirming') && details && <form onSubmit={confirmEnrollment}>
          {error && <div ref={errorRef} className="login-error" role="alert" tabIndex="-1">{error}</div>}
          <div className="enrollment-intro">
            <div>
              <span className="enrollment-provider-label">Assigned app</span>
              <h2 ref={statusHeadingRef} tabIndex="-1">{provider.label}</h2>
              <p>Your administrator selected this authenticator for your account.</p>
            </div>
            {expiry && <span className="enrollment-expiry">Link expires {expiry}</span>}
          </div>

          <div className="enrollment-grid">
            <div className="enrollment-qr-column">
              <div className="enrollment-qr-box">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt={`QR code for connecting ${provider.label} to ${details.accountLabel}`} />
                  : <div className="enrollment-qr-fallback" role="status">{qrUnavailable ? 'QR code unavailable. Use the manual setup key.' : 'Preparing QR code…'}</div>}
              </div>
              <dl className="enrollment-labels">
                <div><dt>Issuer</dt><dd>{details.issuer}</dd></div>
                <div><dt>Account</dt><dd>{details.accountLabel}</dd></div>
              </dl>
            </div>

            <div className="enrollment-instructions">
              <h2>Set up the app</h2>
              <ol>{provider.steps.map(step => <li key={step}>{step}</li>)}</ol>

              <div className="enrollment-manual-key">
                <span>Manual setup key</span>
                <code>{details.manualKey}</code>
                <button type="button" onClick={copyManualKey}>{copied ? 'Copied' : 'Copy key'}</button>
                <span className="sr-only" aria-live="polite">{copied ? 'Setup key copied' : ''}</span>
              </div>

              <div className="form-group enrollment-code-group">
                <label className="form-label" htmlFor="enrollment-code">Six-digit code</label>
                <div className="input-wrapper">
                  <input
                    id="enrollment-code"
                    className="form-input verification-code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    aria-describedby="enrollment-code-help"
                    aria-invalid={Boolean(error)}
                    disabled={status === 'confirming'}
                    required
                  />
                </div>
                <small id="enrollment-code-help">Codes refresh every 30 seconds.</small>
              </div>

              <button type="submit" className="btn-submit" disabled={status === 'confirming' || code.length !== 6}>
                {status === 'confirming' && <span className="spinner" aria-hidden="true" />}
                <span>{status === 'confirming' ? 'Verifying…' : 'Verify and connect'}</span>
              </button>
            </div>
          </div>
        </form>}

        <footer className="card-footer">© 2026 Internal Security · Middleware Hub v2.0</footer>
      </section>
    </div>
  </main>;
}
