import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Mail, Shield, ShieldCheck, ShieldOff, Smartphone, UserRound } from 'lucide-react';
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

const providerLabel = provider => provider === 'google'
  ? 'Google Authenticator'
  : provider === 'microsoft' ? 'Microsoft Authenticator' : 'Other authenticator';

function publicProfile(data, fallbackUser) {
  const user = data?.user || data || fallbackUser || {};
  const mfa = data?.mfa || user.mfa || {};
  return { user, mfa: { ...mfa, mode: mfa.mode || user.mfaMode || 'disabled', status: getMfaStatus(user, mfa), provider: mfa.provider || user.mfaProvider || '' } };
}

function useProfileRequest(token) {
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);
  return useCallback(async (path, options = {}) => {
    const response = await fetch(`/api${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [headers]);
}

function PageChrome({ children, onBack, onLogout, backLabel = 'Back to Hub' }) {
  return <div className="profile-page">
    <header className="profile-topbar"><div className="profile-brand"><Shield size={20} /><span>Internal Security Middleware Hub</span></div><button type="button" className="profile-signout" onClick={onLogout}>Sign out</button></header>
    <main className="profile-main"><button type="button" className="profile-back" onClick={onBack}><ArrowLeft size={17} />{backLabel}</button>{children}</main>
  </div>;
}

function MfaBadge({ status }) {
  const Icon = status === 'enabled' ? ShieldCheck : status === 'pending' ? Smartphone : ShieldOff;
  return <span className={`profile-mfa-badge ${status}`}><Icon size={15} />{status === 'enabled' ? 'MFA enabled' : status === 'pending' ? 'Setup pending' : 'MFA disabled'}</span>;
}

export default function ProfilePage({ token, currentUser, returnTo, onBack, onLogout, onUserUpdated }) {
  const request = useProfileRequest(token);
  const [profile, setProfile] = useState(() => publicProfile(null, currentUser));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    request('/profile').then(data => {
      if (!active) return;
      const next = publicProfile(data, currentUser);
      setProfile(next);
      onUserUpdated?.({ ...currentUser, ...next.user, mfaMode: next.mfa.mode, mfaStatus: next.mfa.status, mfaEnabled: next.mfa.status === 'enabled', mfaProvider: next.mfa.provider || '' });
    }).catch(err => active && setError(err.message || 'Unable to load your profile')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [currentUser?.username, onUserUpdated, request]);

  const user = profile.user || currentUser || {};
  const mfa = profile.mfa || {};
  const displayName = user.fullName || user.username || 'User';
  const workspaceLabels = user.role === 'admin' ? ['Hub administration', 'DefectDojo', 'Wazuh', 'Docs'] : ['Hub', 'DefectDojo', 'Wazuh', 'Docs'];
  return <PageChrome onBack={onBack} onLogout={onLogout} backLabel={returnTo === '/' ? 'Back to Hub' : 'Back to workspace'}>
    <section className="profile-hero"><div className="profile-avatar" aria-hidden="true">{String(displayName).slice(0, 1).toUpperCase()}</div><div><span className="profile-eyebrow">Your account</span><h1>{displayName}</h1><p>View your identity, workspace access, and sign-in status.</p></div><MfaBadge status={mfa.status} /></section>
    {error && <div className="profile-notice error" role="alert">{error}</div>}
    <section className="profile-panel profile-readonly-panel">
      <header><div><span className="profile-section-icon"><UserRound size={18} /></span><h2>Profile details</h2><p>Contact an administrator to change account information or security settings.</p></div></header>
      {loading ? <div className="profile-loading">Loading account…</div> : <>
        <dl className="profile-facts profile-facts-wide">
          <div><dt>Full name</dt><dd>{user.fullName || 'Not provided'}</dd></div><div><dt>Username</dt><dd>{user.username || 'Not available'}</dd></div><div><dt>Email address</dt><dd>{user.email || 'Not provided'}</dd></div>
          <div><dt>Company</dt><dd>{user.company || 'Not provided'}</dd></div><div><dt>Department</dt><dd>{user.department || 'Not provided'}</dd></div><div><dt>Role</dt><dd><span className="profile-role">{user.role || 'viewer'}</span></dd></div>
          <div><dt>Account status</dt><dd>{user.accountStatus || user.status || 'active'}</dd></div><div><dt>Last login</dt><dd>{formatDate(user.lastLoginAt)}</dd></div><div><dt>Authenticator MFA</dt><dd>{mfa.status === 'enabled' ? `${providerLabel(mfa.provider)} · enabled ${formatDate(mfa.enabledAt)}` : mfa.status === 'pending' ? `${providerLabel(mfa.provider)} · setup requested ${formatDate(mfa.requestedAt)}` : 'Disabled'}</dd></div>
        </dl>
        <div className="profile-access"><strong>Workspace access</strong><div>{workspaceLabels.map(label => <span key={label}>{label}</span>)}</div>{user.products?.length > 0 && <small>Products: {user.products.join(', ')}</small>}</div>
        <div className="profile-admin-note"><Mail size={17} /><span>Your administrator manages profile details, password resets, and authenticator access.</span></div>
      </>}
    </section>
  </PageChrome>;
}
