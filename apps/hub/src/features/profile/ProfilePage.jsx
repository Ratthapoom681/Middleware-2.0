import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  Clipboard,
  Mail,
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  UserRound,
} from 'lucide-react';
import './ProfilePage.css';

const formatDate = value => {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
  }).format(date);
};

const getMfaStatus = (user, mfa) => {
  const status = String(mfa?.status || user?.mfaStatus || '').toLowerCase();
  if (['disabled', 'pending', 'enabled'].includes(status)) return status;
  if (mfa?.enabled || user?.mfaEnabled) return 'enabled';
  if (mfa?.mode === 'authenticator' || user?.mfaMode === 'authenticator') return 'pending';
  return 'disabled';
};

const getMfaMode = (user, mfa) => (
  mfa?.mode || user?.mfaMode || (getMfaStatus(user, mfa) === 'disabled' ? 'disabled' : 'authenticator')
);

function publicProfile(data, fallbackUser) {
  const user = data?.user || data || fallbackUser || {};
  const mfa = data?.mfa || user.mfa || {};
  return {
    user,
    mfa: {
      ...mfa,
      mode: getMfaMode(user, mfa),
      status: getMfaStatus(user, mfa),
    },
  };
}

function useProfileRequest(token) {
  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  return useCallback(async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [headers]);
}

function PageChrome({ children, onBack, onLogout, backLabel = 'Back to Hub' }) {
  return (
    <div className="profile-page">
      <header className="profile-topbar">
        <div className="profile-brand"><Shield size={20} /><span>Internal Security Middleware Hub</span></div>
        <button type="button" className="profile-signout" onClick={onLogout}>Sign out</button>
      </header>
      <main className="profile-main">
        <button type="button" className="profile-back" onClick={onBack}><ArrowLeft size={17} />{backLabel}</button>
        {children}
      </main>
    </div>
  );
}

function MfaBadge({ status }) {
  const Icon = status === 'enabled' ? ShieldCheck : status === 'pending' ? Smartphone : ShieldOff;
  const label = status === 'enabled' ? 'MFA enabled' : status === 'pending' ? 'Setup pending' : 'MFA disabled';
  return <span className={`profile-mfa-badge ${status}`}><Icon size={15} />{label}</span>;
}

export default function ProfilePage({ token, currentUser, returnTo, onBack, onLogout, onUserUpdated }) {
  const request = useProfileRequest(token);
  const [profile, setProfile] = useState(() => publicProfile(null, currentUser));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    request('/profile')
      .then(data => {
        if (!active) return;
        const next = publicProfile(data, currentUser);
        setProfile(next);
        onUserUpdated?.({ ...currentUser, ...next.user, mfa: next.mfa, mfaMode: next.mfa.mode, mfaStatus: next.mfa.status, mfaEnabled: next.mfa.status === 'enabled' });
      })
      .catch(err => { if (active) setError(err.message || 'Unable to load your profile'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser?.username, onUserUpdated, request]);

  const user = profile.user || currentUser || {};
  const mfa = profile.mfa || {};
  const displayName = user.fullName || user.username || 'User';
  const workspaceLabels = user.role === 'admin'
    ? ['Hub administration', 'DefectDojo', 'Wazuh', 'Docs']
    : ['Hub', 'DefectDojo', 'Wazuh', 'Docs'];

  return (
    <PageChrome onBack={onBack} onLogout={onLogout} backLabel={returnTo === '/' ? 'Back to Hub' : 'Back to workspace'}>
      <section className="profile-hero">
        <div className="profile-avatar" aria-hidden="true">{String(displayName).slice(0, 1).toUpperCase()}</div>
        <div><span className="profile-eyebrow">Your account</span><h1>{displayName}</h1><p>View your identity, workspace access, and sign-in status.</p></div>
        <MfaBadge status={mfa.status} />
      </section>

      {error && <div className="profile-notice error" role="alert">{error}</div>}

      <section className="profile-panel profile-readonly-panel">
        <header><div><span className="profile-section-icon"><UserRound size={18} /></span><h2>Profile details</h2><p>Contact an administrator to change account information or security settings.</p></div></header>
        {loading ? <div className="profile-loading">Loading account…</div> : (
          <>
            <dl className="profile-facts profile-facts-wide">
              <div><dt>Full name</dt><dd>{user.fullName || 'Not provided'}</dd></div>
              <div><dt>Username</dt><dd>{user.username || 'Not available'}</dd></div>
              <div><dt>Email address</dt><dd>{user.email || 'Not provided'}</dd></div>
              <div><dt>Company</dt><dd>{user.company || 'Not provided'}</dd></div>
              <div><dt>Department</dt><dd>{user.department || 'Not provided'}</dd></div>
              <div><dt>Role</dt><dd><span className="profile-role">{user.role || 'viewer'}</span></dd></div>
              <div><dt>Account status</dt><dd>{user.accountStatus || user.status || 'active'}</dd></div>
              <div><dt>Last login</dt><dd>{formatDate(user.lastLoginAt)}</dd></div>
              <div><dt>Authenticator MFA</dt><dd>{mfa.status === 'enabled' ? `Enabled ${formatDate(mfa.enabledAt)}` : mfa.status === 'pending' ? `Setup requested ${formatDate(mfa.requestedAt)}` : 'Disabled'}</dd></div>
            </dl>
            <div className="profile-access">
              <strong>Workspace access</strong>
              <div>{workspaceLabels.map(label => <span key={label}>{label}</span>)}</div>
              {user.products?.length > 0 && <small>Products: {user.products.join(', ')}</small>}
            </div>
            <div className="profile-admin-note"><Mail size={17} /><span>Your administrator manages profile details, password resets, and authenticator access.</span></div>
          </>
        )}
      </section>
    </PageChrome>
  );
}

export function MfaEnrollmentPage({ token, currentUser, onBack, onLogout, onUserUpdated }) {
  const request = useProfileRequest(token);
  const [profile, setProfile] = useState(() => publicProfile(null, currentUser));
  const [step, setStep] = useState('loading');
  const [currentPassword, setCurrentPassword] = useState('');
  const [enrollment, setEnrollment] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const applyProfile = useCallback(data => {
    const next = publicProfile(data, currentUser);
    setProfile(next);
    onUserUpdated?.({ ...currentUser, ...next.user, mfa: next.mfa, mfaMode: next.mfa.mode, mfaStatus: next.mfa.status, mfaEnabled: next.mfa.status === 'enabled' });
    return next;
  }, [currentUser?.username, onUserUpdated]);

  useEffect(() => {
    let active = true;
    request('/profile')
      .then(data => {
        if (!active) return;
        const next = applyProfile(data);
        setStep(next.mfa.status === 'pending' ? 'verify' : next.mfa.status);
      })
      .catch(err => { if (active) { setError(err.message || 'Unable to load authenticator setup'); setStep('error'); } });
    return () => { active = false; };
  }, [applyProfile, request]);

  const startEnrollment = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await request('/profile/mfa/enrollment/start', {
        method: 'POST',
        body: JSON.stringify({ currentPassword }),
      });
      const uri = data.otpauthUri || data.qrUri;
      if (!uri || !data.setupToken || !data.manualKey) throw new Error('Authenticator setup details were incomplete. Try again.');
      setEnrollment(data);
      setQrDataUrl(await QRCode.toDataURL(uri, { width: 240, margin: 1, errorCorrectionLevel: 'M' }));
      setStep('scan');
    } catch (err) {
      setError(err.message || 'Unable to start authenticator setup');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnrollment = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await request('/profile/mfa/enrollment/confirm', {
        method: 'POST',
        body: JSON.stringify({ setupToken: enrollment.setupToken, code: confirmationCode }),
      });
      const next = await request('/profile').catch(() => ({
        ...profile.user,
        mfa: { ...profile.mfa, mode: 'authenticator', status: 'enabled', enabledAt: new Date().toISOString() },
      }));
      applyProfile(next);
      setStep('complete');
    } catch (err) {
      setError(err.message || 'That code could not be verified');
    } finally {
      setBusy(false);
    }
  };

  const copyManualKey = async () => {
    try {
      await navigator.clipboard.writeText(String(enrollment?.manualKey || '').replace(/\s/g, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Unable to copy the setup key. Select and copy it manually.');
    }
  };

  const accountLabel = enrollment?.accountLabel || enrollment?.label || profile.user?.email || profile.user?.username;

  return (
    <PageChrome onBack={onBack} onLogout={onLogout}>
      <section className="profile-hero enrollment-hero">
        <div className="profile-avatar"><Smartphone size={28} /></div>
        <div><span className="profile-eyebrow">Authenticator MFA</span><h1>Connect your authenticator</h1><p>Use Google Authenticator, Microsoft Authenticator, or another compatible app.</p></div>
        <MfaBadge status={step === 'complete' ? 'enabled' : profile.mfa.status} />
      </section>

      {error && <div className="profile-notice error" role="alert" tabIndex={-1}>{error}</div>}

      <section className="profile-panel enrollment-panel">
        {step === 'loading' && <div className="profile-loading">Checking your enrollment status…</div>}
        {step === 'error' && <div className="enrollment-state"><ShieldOff size={28} /><h2>Setup is unavailable</h2><p>Return to the Hub and try again, or contact an administrator.</p></div>}
        {step === 'disabled' && <div className="enrollment-state"><ShieldOff size={28} /><h2>Authenticator MFA is not enabled</h2><p>Ask an administrator to enable Authenticator MFA for your account. You’ll receive an email when setup is ready.</p><button type="button" className="profile-primary-button" onClick={onBack}>Return to Hub</button></div>}
        {step === 'enabled' && <div className="enrollment-state success"><ShieldCheck size={28} /><h2>Authenticator is already connected</h2><p>Your account already requires an authenticator code at sign-in. An administrator can reset it if your device changes.</p><button type="button" className="profile-primary-button" onClick={onBack}>Return to Hub</button></div>}
        {step === 'complete' && <div className="enrollment-state success"><Check size={28} /><h2>Authenticator connected</h2><p>Your next sign-in will require the six-digit code from your authenticator app.</p><button type="button" className="profile-primary-button" onClick={onBack}>Continue to Hub</button></div>}

        {step === 'verify' && (
          <form className="enrollment-form" onSubmit={startEnrollment}>
            <div className="enrollment-heading"><span>1</span><div><h2>Confirm your identity</h2><p>Enter your current password before the private setup key is shown.</p></div></div>
            <label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required autoFocus /></label>
            <div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={onBack}>Cancel</button><button type="submit" className="profile-primary-button" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button></div>
          </form>
        )}

        {step === 'scan' && (
          <form className="mfa-scan-layout enrollment-scan" onSubmit={confirmEnrollment}>
            <div className="mfa-qr-panel">
              {qrDataUrl && <img src={qrDataUrl} alt="QR code for authenticator enrollment" />}
              <span>{enrollment?.issuer || 'Internal Security Middleware'}</span>
            </div>
            <div className="mfa-scan-instructions">
              <div className="enrollment-heading"><span>2</span><div><h2>Scan and verify</h2><p>Add an “Other account” or time-based account in your authenticator app.</p></div></div>
              <ol><li>Scan the QR code with your authenticator app.</li><li>Confirm the account label is <strong>{accountLabel}</strong>.</li><li>Enter the current six-digit code below.</li></ol>
              <details><summary>Can’t scan the QR code?</summary><div className="manual-key"><code>{enrollment?.manualKey}</code><button type="button" onClick={copyManualKey}><Clipboard size={15} />{copied ? 'Copied' : 'Copy key'}</button></div></details>
              <label><span>Six-digit code</span><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={confirmationCode} onChange={event => setConfirmationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required autoFocus /></label>
              <div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={onBack}>Cancel</button><button type="submit" className="profile-primary-button" disabled={busy || confirmationCode.length !== 6}>{busy ? 'Verifying…' : 'Verify and enable'}</button></div>
            </div>
          </form>
        )}
      </section>
    </PageChrome>
  );
}
