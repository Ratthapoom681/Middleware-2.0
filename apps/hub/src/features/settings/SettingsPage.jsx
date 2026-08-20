import { useEffect, useMemo, useState } from 'react';
import { Mail, ShieldAlert } from 'lucide-react';
import { isSystemAdmin } from '../../../../../packages/access-control/index.js';
import {
  createAuthenticatedRequest,
  isSessionExpiredError,
} from '../../shared/authenticatedRequest.js';
import { EMPTY_EMAIL_SETTINGS, getEmailCapability, getEmailReasonCopy } from '../../shared/emailDeliveryStatus.js';
import EmailQueuePanel from './EmailQueuePanel.jsx';
import './SettingsPage.css';

const EMPTY = {
  ...EMPTY_EMAIL_SETTINGS,
  host: '',
  port: 25,
  security: 'plain',
  username: '',
  password: '',
  fromAddress: '',
  clearPassword: false,
};

function StatusChip({ capability }) {
  return <span className={`email-service-state ${capability.available ? 'on' : 'off'}`}>{capability.available ? 'On' : 'Off'}</span>;
}

export default function SettingsPage({ token, user, onUnauthorized }) {
  const [settings, setSettings] = useState(EMPTY);
  const [savedSettings, setSavedSettings] = useState(EMPTY);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [queueRefreshKey, setQueueRefreshKey] = useState(0);

  const request = useMemo(
    () => createAuthenticatedRequest({ token, onUnauthorized }),
    [onUnauthorized, token],
  );

  useEffect(() => {
    request('/settings/email')
      .then(data => {
        const next = { ...EMPTY, ...data, password: '' };
        setSettings(next);
        setSavedSettings(next);
      })
      .catch(err => {
        if (!isSessionExpiredError(err)) setError(err.message);
      });
  }, [request]);

  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const data = await request('/settings/email', { method: 'PATCH', body: JSON.stringify(settings) });
      setSettings(value => ({ ...value, ...data.settings, password: '', clearPassword: false }));
      setSavedSettings(value => ({ ...value, ...data.settings, password: '', clearPassword: false }));
      setMessage(data.message);
      setQueueRefreshKey(value => value + 1);
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message);
    } finally { setBusy(false); }
  };

  const mfaCapability = getEmailCapability(settings, 'mfa_setup');
  const temporaryPasswordCapability = getEmailCapability(settings, 'temporary_password');
  const serviceCapability = {
    available: Boolean(settings.enabled && settings.configured),
    reason: !settings.enabled ? 'service_disabled' : settings.configured ? 'ready' : 'not_configured',
  };
  const smtpRequired = settings.enabled && (settings.mfaSetupEnabled || settings.temporaryPasswordEnabled);

  return <div className="settings-page">
    <div className="settings-main">
      <div className="settings-heading"><span><Mail size={24} /></span><div><p>System settings</p><h1>Email delivery</h1><small>Configure Postfix or another SMTP relay without rebuilding the application.</small></div></div>
      {error && <div className="settings-notice error" role="alert">{error}</div>}
      {message && <div className="settings-notice success" role="status">{message}</div>}
      {settings.security === 'plain' && <div className="settings-warning" role="note"><ShieldAlert size={18} /><span>Plain SMTP does not encrypt messages in transit. Temporary passwords may be exposed between this application and the mail server.</span></div>}
      <section className="settings-panel">
        <div className="settings-section-heading"><div><h2>Delivery controls</h2><p>Choose which email the service can send.</p></div><StatusChip capability={serviceCapability} /></div>
        <form onSubmit={save} className="settings-form">
          <label className="settings-toggle-row">
            <span><strong>Email service</strong><small>{getEmailReasonCopy(serviceCapability.reason)}</small></span>
            <input type="checkbox" role="switch" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />
          </label>
          <label className="settings-toggle-row">
            <span><strong>MFA setup email</strong><small>{getEmailReasonCopy(mfaCapability.reason)}</small></span>
            <span className="settings-toggle-control"><StatusChip capability={mfaCapability} /><input type="checkbox" role="switch" checked={settings.mfaSetupEnabled} onChange={event => setSettings({ ...settings, mfaSetupEnabled: event.target.checked })} /></span>
          </label>
          <label className="settings-toggle-row">
            <span><strong>Temporary-password email</strong><small>{getEmailReasonCopy(temporaryPasswordCapability.reason)}</small></span>
            <span className="settings-toggle-control"><StatusChip capability={temporaryPasswordCapability} /><input type="checkbox" role="switch" checked={settings.temporaryPasswordEnabled} onChange={event => setSettings({ ...settings, temporaryPasswordEnabled: event.target.checked })} /></span>
          </label>
          <div className="settings-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save controls'}</button></div>
        </form>
      </section>
      <section className="settings-panel"><h2>SMTP connection</h2><p>Unauthenticated relays such as <code>tamarind.beenets.com:25</code> are supported.</p>
        <form onSubmit={save} className="settings-form">
          <div className="settings-grid"><label><span>SMTP host</span><input value={settings.host} onChange={e => setSettings({ ...settings, host: e.target.value })} placeholder="tamarind.beenets.com" required={smtpRequired} /></label><label><span>Port</span><input type="number" min="1" max="65535" value={settings.port} onChange={e => setSettings({ ...settings, port: Number(e.target.value) })} required={smtpRequired} /></label></div>
          <label><span>Connection security</span><select value={settings.security} onChange={e => setSettings({ ...settings, security: e.target.value })}><option value="plain">Plain SMTP</option><option value="starttls">STARTTLS</option><option value="tls">Implicit TLS</option></select></label>
          <div className="settings-grid"><label><span>Username <small>Optional</small></span><input autoComplete="off" value={settings.username} onChange={e => setSettings({ ...settings, username: e.target.value })} /></label><label><span>Password <small>{settings.hasPassword ? 'Saved; blank preserves it' : 'Optional'}</small></span><input type="password" autoComplete="new-password" value={settings.password} onChange={e => setSettings({ ...settings, password: e.target.value, clearPassword: false })} /></label></div>
          {settings.hasPassword && <label className="settings-check"><input type="checkbox" checked={settings.clearPassword} onChange={e => setSettings({ ...settings, clearPassword: e.target.checked, password: '' })} /><span>Clear the saved SMTP password</span></label>}
          <label><span>From address</span><input type="email" value={settings.fromAddress} onChange={e => setSettings({ ...settings, fromAddress: e.target.value })} placeholder="security@example.com" required={smtpRequired} /></label>
          <div className="settings-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
        </form>
      </section>
      {isSystemAdmin(user) && <EmailQueuePanel token={token} onUnauthorized={onUnauthorized} settings={savedSettings} refreshKey={queueRefreshKey} />}
    </div>
  </div>;
}
