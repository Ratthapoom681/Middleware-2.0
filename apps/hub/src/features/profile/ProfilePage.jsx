import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  KeyRound,
  LockKeyhole,
  Mail,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  X,
} from 'lucide-react';
import './ProfilePage.css';

const PROVIDERS = [
  { id: 'google', name: 'Google Authenticator', hint: 'Open the app, tap +, then choose Scan a QR code.' },
  { id: 'microsoft', name: 'Microsoft Authenticator', hint: 'Tap +, choose Other account, then scan the QR code.' },
  { id: 'other', name: 'Other authenticator', hint: 'Use any RFC 6238 compatible app and scan the QR code.' },
];

const formatDate = value => {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok'
  }).format(date);
};

const providerName = value => PROVIDERS.find(provider => provider.id === value)?.name || 'Authenticator app';

function useDialogFocus(onClose, closeDisabled = false) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href]'));
    focusable()[0]?.focus();
    const handleKey = event => {
      if (event.key === 'Escape' && !closeDisabledRef.current) onCloseRef.current();
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, []);
  return dialogRef;
}

function Dialog({ children, onClose, titleId, closeDisabled = false, wide = false }) {
  const ref = useDialogFocus(onClose, closeDisabled);
  return (
    <div className="profile-dialog-backdrop" role="presentation" onMouseDown={() => { if (!closeDisabled) onClose(); }}>
      <section ref={ref} className={`profile-dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={event => event.stopPropagation()}>
        {children}
      </section>
    </div>
  );
}

function DialogHeader({ icon: Icon, title, description, titleId, onClose, closeDisabled = false }) {
  return (
    <header className="profile-dialog-header">
      <div className="profile-dialog-heading"><span><Icon size={20} /></span><div><h2 id={titleId}>{title}</h2><p>{description}</p></div></div>
      <button type="button" className="profile-icon-button" onClick={onClose} disabled={closeDisabled} aria-label="Close dialog"><X size={18} /></button>
    </header>
  );
}

function FactorFields({ code, mode, onCodeChange, onModeChange }) {
  return (
    <div className="profile-factor-fields">
      <label>
        <span>{mode === 'recovery' ? 'Recovery code' : 'Authenticator code'}</span>
        <input
          value={code}
          onChange={event => onCodeChange(event.target.value)}
          inputMode={mode === 'recovery' ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={mode === 'recovery' ? 'XXXXX-XXXXX-XXXXX' : '000000'}
          required
        />
      </label>
      <button type="button" className="profile-link-button" onClick={() => onModeChange(mode === 'recovery' ? 'totp' : 'recovery')}>
        {mode === 'recovery' ? 'Use authenticator code' : 'Use a recovery code'}
      </button>
    </div>
  );
}

function RecoveryCodes({ codes, username, saved, onSavedChange, onDone }) {
  const copyCodes = async () => navigator.clipboard.writeText(codes.join('\n'));
  const downloadCodes = () => {
    const content = [
      'Internal Security Middleware recovery codes',
      `Account: ${username}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      ...codes,
      '',
      'Each code can be used once. Store this file somewhere private.'
    ].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `middleware-recovery-codes-${username}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="recovery-codes-step">
      <div className="profile-success-callout"><ShieldCheck size={20} /><div><strong>Authenticator is ready</strong><span>Save these recovery codes now. They will not be shown again.</span></div></div>
      <div className="recovery-code-grid" aria-label="Recovery codes">{codes.map(code => <code key={code}>{code}</code>)}</div>
      <div className="recovery-code-actions">
        <button type="button" className="profile-secondary-button" onClick={copyCodes}><Clipboard size={16} />Copy all</button>
        <button type="button" className="profile-secondary-button" onClick={downloadCodes}><Download size={16} />Download</button>
      </div>
      <label className="profile-confirm-check"><input type="checkbox" checked={saved} onChange={event => onSavedChange(event.target.checked)} /><span>I saved these codes somewhere private.</span></label>
      <div className="profile-dialog-actions"><button type="button" className="profile-primary-button" disabled={!saved} onClick={onDone}><Check size={16} />Finish</button></div>
    </div>
  );
}

function PasswordDialog({ mfaEnabled, onClose, onSubmit }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('totp');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmation) return setError('New passwords do not match');
    if (newPassword.length < 12 || newPassword.length > 128) return setError('Password must be 12–128 characters');
    setSaving(true);
    try {
      await onSubmit({ currentPassword, newPassword, code, mode });
    } catch (err) {
      setError(err.message || 'Unable to change password');
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={onClose} titleId="password-dialog-title">
      <DialogHeader icon={KeyRound} title="Change password" description="All sessions will be signed out after this change." titleId="password-dialog-title" onClose={onClose} />
      <form className="profile-dialog-body" onSubmit={submit}>
        {error && <div className="profile-error" role="alert">{error}</div>}
        <label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
        <label><span>New password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /><small>Use 12–128 characters.</small></label>
        <label><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
        {mfaEnabled && <FactorFields code={code} mode={mode} onCodeChange={setCode} onModeChange={setMode} />}
        <div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="profile-primary-button" disabled={saving}>{saving ? 'Changing…' : 'Change password'}</button></div>
      </form>
    </Dialog>
  );
}

function MfaSetupDialog({ request, username, replacing, onClose, onEnabled }) {
  const [step, setStep] = useState('provider');
  const [provider, setProvider] = useState('google');
  const [currentPassword, setCurrentPassword] = useState('');
  const [factorCode, setFactorCode] = useState('');
  const [factorMode, setFactorMode] = useState('totp');
  const [enrollment, setEnrollment] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const beginVerification = () => setStep('verify');
  const startSetup = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await request('/profile/mfa/setup', {
        method: 'POST',
        body: JSON.stringify({ provider, currentPassword, code: factorCode, mode: factorMode })
      });
      setEnrollment(data);
      setQrDataUrl(await QRCode.toDataURL(data.otpauthUri, { width: 240, margin: 1, errorCorrectionLevel: 'M' }));
      setStep('scan');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const confirm = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await request('/profile/mfa/confirm', {
        method: 'POST', body: JSON.stringify({ setupToken: enrollment.setupToken, code: confirmationCode })
      });
      setRecoveryCodes(data.recoveryCodes || []);
      setStep('recovery');
      onEnabled(data);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const selected = PROVIDERS.find(item => item.id === provider) || PROVIDERS[2];
  return (
    <Dialog onClose={onClose} closeDisabled={step === 'recovery' && !saved} titleId="mfa-setup-title" wide>
      <DialogHeader icon={Smartphone} title={replacing ? 'Change authenticator app' : 'Set up an authenticator'} description="Use a time-based code as a second sign-in factor." titleId="mfa-setup-title" onClose={onClose} closeDisabled={step === 'recovery' && !saved} />
      <div className="profile-stepper" aria-label="Setup progress"><span className={step === 'provider' ? 'active' : 'complete'}>1 App</span><span className={step === 'verify' ? 'active' : ['scan', 'recovery'].includes(step) ? 'complete' : ''}>2 Verify</span><span className={step === 'scan' ? 'active' : step === 'recovery' ? 'complete' : ''}>3 Connect</span><span className={step === 'recovery' ? 'active' : ''}>4 Save</span></div>
      <div className="profile-dialog-body">
        {error && <div className="profile-error" role="alert">{error}</div>}
        {step === 'provider' && <><div className="provider-grid">{PROVIDERS.map(item => <button key={item.id} type="button" className={provider === item.id ? 'selected' : ''} onClick={() => setProvider(item.id)}><Smartphone size={22} /><strong>{item.name}</strong><span>{item.hint}</span></button>)}</div><div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={onClose}>Cancel</button><button type="button" className="profile-primary-button" onClick={beginVerification}>Continue</button></div></>}
        {step === 'verify' && <form onSubmit={startSetup}><p className="profile-dialog-copy">Confirm that it is really you before the setup key is shown.</p><label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>{replacing && <FactorFields code={factorCode} mode={factorMode} onCodeChange={setFactorCode} onModeChange={setFactorMode} />}<div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={() => setStep('provider')}>Back</button><button type="submit" className="profile-primary-button" disabled={busy}>{busy ? 'Checking…' : 'Show setup key'}</button></div></form>}
        {step === 'scan' && <form className="mfa-scan-layout" onSubmit={confirm}><div className="mfa-qr-panel">{qrDataUrl && <img src={qrDataUrl} alt={`QR code for ${selected.name}`} />}<span>{selected.name}</span></div><div className="mfa-scan-instructions"><h3>Connect your app</h3><ol><li>{selected.hint}</li><li>Confirm the account label is <strong>{username}</strong>.</li><li>Enter the current six-digit code below.</li></ol><details><summary>Can’t scan the QR code?</summary><div className="manual-key"><code>{enrollment?.manualKey}</code><button type="button" onClick={() => navigator.clipboard.writeText(enrollment?.manualKey?.replace(/\s/g, '') || '')}><Clipboard size={15} />Copy key</button></div></details><label><span>Six-digit code</span><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={confirmationCode} onChange={event => setConfirmationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /></label><div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="profile-primary-button" disabled={busy || confirmationCode.length !== 6}>{busy ? 'Verifying…' : 'Verify and enable'}</button></div></div></form>}
        {step === 'recovery' && <RecoveryCodes codes={recoveryCodes} username={username} saved={saved} onSavedChange={setSaved} onDone={onClose} />}
      </div>
    </Dialog>
  );
}

function MfaActionDialog({ action, request, username, onClose, onRegenerated, onDisabled }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('totp');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const regenerating = action === 'regenerate';

  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const path = regenerating ? '/profile/mfa/recovery-codes/regenerate' : '/profile/mfa/disable';
      const data = await request(path, { method: 'POST', body: JSON.stringify({ currentPassword, code, mode }) });
      if (regenerating) { setRecoveryCodes(data.recoveryCodes || []); onRegenerated(data); }
      else onDisabled();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  if (recoveryCodes.length) {
    return <Dialog onClose={onClose} closeDisabled={!saved} titleId="recovery-regenerated-title"><DialogHeader icon={RefreshCw} title="New recovery codes" description="Your previous recovery codes are no longer valid." titleId="recovery-regenerated-title" onClose={onClose} closeDisabled={!saved} /><div className="profile-dialog-body"><RecoveryCodes codes={recoveryCodes} username={username} saved={saved} onSavedChange={setSaved} onDone={onClose} /></div></Dialog>;
  }

  return (
    <Dialog onClose={onClose} titleId="mfa-action-title">
      <DialogHeader icon={regenerating ? RefreshCw : ShieldOff} title={regenerating ? 'Regenerate recovery codes' : 'Turn off authenticator'} description={regenerating ? 'All existing recovery codes will stop working.' : 'All sessions will be signed out and future logins will use only your password.'} titleId="mfa-action-title" onClose={onClose} />
      <form className="profile-dialog-body" onSubmit={submit}>{error && <div className="profile-error" role="alert">{error}</div>}<label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label><FactorFields code={code} mode={mode} onCodeChange={setCode} onModeChange={setMode} /><div className="profile-dialog-actions"><button type="button" className="profile-secondary-button" onClick={onClose}>Cancel</button><button type="submit" className={regenerating ? 'profile-primary-button' : 'profile-danger-button'} disabled={busy}>{busy ? 'Verifying…' : regenerating ? 'Generate new codes' : 'Turn off and sign out'}</button></div></form>
    </Dialog>
  );
}

export default function ProfilePage({ token, currentUser, returnTo, onBack, onLogout, onUserUpdated, onSessionEnded }) {
  const [profile, setProfile] = useState({ user: currentUser, mfa: { enabled: Boolean(currentUser?.mfaEnabled) } });
  const [email, setEmail] = useState(currentUser?.email || '');
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [notice, setNotice] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [mfaAction, setMfaAction] = useState(null);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [token]);

  const loadProfile = useCallback(async () => {
    try {
      const data = await request('/profile');
      setProfile(data);
      setEmail(data.user?.email || '');
      onUserUpdated(data.user);
    } catch (err) { setNotice({ type: 'error', text: err.message }); }
    finally { setLoading(false); }
  }, [onUserUpdated, request]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveEmail = async event => {
    event.preventDefault(); setSavingEmail(true); setNotice(null);
    try {
      const data = await request('/profile', { method: 'PATCH', body: JSON.stringify({ email }) });
      setProfile(value => ({ ...value, user: data.user }));
      onUserUpdated(data.user);
      setNotice({ type: 'success', text: 'Email updated.' });
    } catch (err) { setNotice({ type: 'error', text: err.message }); }
    finally { setSavingEmail(false); }
  };

  const changePassword = async payload => {
    await request('/profile/password', { method: 'PATCH', body: JSON.stringify(payload) });
    onSessionEnded('password-changed');
  };

  const user = profile.user || currentUser || {};
  const mfa = profile.mfa || { enabled: false };
  const workspaceLabels = useMemo(() => ['Hub', 'DefectDojo Viewer', 'Wazuh Viewer', 'Documentation'], []);

  return (
    <div className="profile-page">
      <header className="profile-topbar"><div className="profile-brand"><Shield size={20} /><span>Internal Security Middleware Hub</span></div><button type="button" className="profile-signout" onClick={onLogout}>Sign out</button></header>
      <main className="profile-main">
        <button type="button" className="profile-back" onClick={onBack}><ArrowLeft size={17} />{returnTo === '/' ? 'Back to Hub' : 'Back to workspace'}</button>
        <section className="profile-hero"><div className="profile-avatar">{String(user.username || 'U').slice(0, 1).toUpperCase()}</div><div><span className="profile-eyebrow">Your account</span><h1>Your profile</h1><p>Manage your contact information and account security.</p></div><span className={`profile-mfa-badge ${mfa.enabled ? 'enabled' : ''}`}>{mfa.enabled ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}{mfa.enabled ? 'MFA enabled' : 'MFA not enabled'}</span></section>
        {notice && <div className={`profile-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
        <div className="profile-layout">
          <section className="profile-panel account-panel"><header><div><span className="profile-section-icon"><Mail size={18} /></span><h2>Account</h2><p>Your identity and workspace access.</p></div></header>{loading ? <div className="profile-loading">Loading account…</div> : <><dl className="profile-facts"><div><dt>Username</dt><dd>{user.username}</dd></div><div><dt>Role</dt><dd><span className="profile-role">{user.role}</span></dd></div><div><dt>Account status</dt><dd>{user.accountStatus || 'active'}</dd></div><div><dt>Last login</dt><dd>{formatDate(user.lastLoginAt)}</dd></div></dl><form className="profile-email-form" onSubmit={saveEmail}><label><span>Email address <small>Optional</small></span><input type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></label><button type="submit" className="profile-primary-button" disabled={savingEmail || email === (user.email || '')}><Save size={16} />{savingEmail ? 'Saving…' : 'Save email'}</button></form><div className="profile-access"><strong>Workspace access</strong><div>{workspaceLabels.map(label => <span key={label}>{label}</span>)}</div>{user.products?.length > 0 && <small>Products: {user.products.join(', ')}</small>}</div></>}</section>
          <section className="profile-panel security-panel"><header><div><span className="profile-section-icon"><LockKeyhole size={18} /></span><h2>Security</h2><p>Password and sign-in verification.</p></div></header><div className="security-row"><div><strong>Password</strong><span>{user.passwordUpdatedAt ? `Last changed ${formatDate(user.passwordUpdatedAt)}` : 'Use at least 12 characters.'}</span></div><button type="button" className="profile-secondary-button" onClick={() => setPasswordOpen(true)}>Change password</button></div><div className="security-divider" /><div className="security-row authenticator-row"><div><strong>Authenticator app</strong><span>{mfa.enabled ? `${providerName(mfa.provider)} · Enabled ${formatDate(mfa.enabledAt)}` : 'Add a second verification step to your sign-in.'}</span>{mfa.enabled && <small>{mfa.recoveryCodesRemaining} recovery codes remaining</small>}</div>{mfa.enabled ? <div className="security-actions"><button type="button" className="profile-secondary-button" onClick={() => setSetupOpen(true)}>Change app</button><button type="button" className="profile-secondary-button" onClick={() => setMfaAction('regenerate')}>Regenerate codes</button><button type="button" className="profile-danger-text-button" onClick={() => setMfaAction('disable')}>Turn off</button></div> : <button type="button" className="profile-primary-button" onClick={() => setSetupOpen(true)}><Smartphone size={16} />Set up authenticator</button>}</div></section>
        </div>
      </main>
      {passwordOpen && <PasswordDialog mfaEnabled={mfa.enabled} onClose={() => setPasswordOpen(false)} onSubmit={changePassword} />}
      {setupOpen && <MfaSetupDialog request={request} username={user.username} replacing={mfa.enabled} onClose={() => setSetupOpen(false)} onEnabled={() => loadProfile()} />}
      {mfaAction && <MfaActionDialog action={mfaAction} request={request} username={user.username} onClose={() => setMfaAction(null)} onRegenerated={() => loadProfile()} onDisabled={() => onSessionEnded('mfa-disabled')} />}
    </div>
  );
}
