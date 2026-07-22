import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mail, ShieldAlert } from 'lucide-react';
import './SettingsPage.css';

const EMPTY = { host: '', port: 25, security: 'plain', username: '', password: '', fromAddress: '', clearPassword: false };

export default function SettingsPage({ token, onBack }) {
  const [settings, setSettings] = useState(EMPTY);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, [token]);

  useEffect(() => {
    request('/settings/email').then(data => setSettings({ ...EMPTY, ...data, password: '' })).catch(err => setError(err.message));
  }, [request]);

  const save = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const data = await request('/settings/email', { method: 'PATCH', body: JSON.stringify(settings) });
      setSettings(value => ({ ...value, ...data.settings, password: '', clearPassword: false }));
      setMessage(data.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return <div className="settings-page">
    <header className="settings-topbar"><strong>System Settings</strong><button type="button" onClick={onBack}><ArrowLeft size={16} />Back to Hub</button></header>
    <main className="settings-main">
      <div className="settings-heading"><span><Mail size={24} /></span><div><p>System settings</p><h1>Email delivery</h1><small>Configure Postfix or another SMTP relay without rebuilding the application.</small></div></div>
      {error && <div className="settings-notice error" role="alert">{error}</div>}
      {message && <div className="settings-notice success" role="status">{message}</div>}
      {settings.security === 'plain' && <div className="settings-warning" role="note"><ShieldAlert size={18} /><span>Plain SMTP does not encrypt messages in transit. Temporary passwords may be exposed between this application and the mail server.</span></div>}
      <section className="settings-panel"><h2>SMTP connection</h2><p>Unauthenticated relays such as <code>tamarind.beenets.com:25</code> are supported.</p>
        <form onSubmit={save} className="settings-form">
          <div className="settings-grid"><label><span>SMTP host</span><input value={settings.host} onChange={e => setSettings({ ...settings, host: e.target.value })} placeholder="tamarind.beenets.com" required /></label><label><span>Port</span><input type="number" min="1" max="65535" value={settings.port} onChange={e => setSettings({ ...settings, port: Number(e.target.value) })} required /></label></div>
          <label><span>Connection security</span><select value={settings.security} onChange={e => setSettings({ ...settings, security: e.target.value })}><option value="plain">Plain SMTP</option><option value="starttls">STARTTLS</option><option value="tls">Implicit TLS</option></select></label>
          <div className="settings-grid"><label><span>Username <small>Optional</small></span><input autoComplete="off" value={settings.username} onChange={e => setSettings({ ...settings, username: e.target.value })} /></label><label><span>Password <small>{settings.hasPassword ? 'Saved; blank preserves it' : 'Optional'}</small></span><input type="password" autoComplete="new-password" value={settings.password} onChange={e => setSettings({ ...settings, password: e.target.value, clearPassword: false })} /></label></div>
          {settings.hasPassword && <label className="settings-check"><input type="checkbox" checked={settings.clearPassword} onChange={e => setSettings({ ...settings, clearPassword: e.target.checked, password: '' })} /><span>Clear the saved SMTP password</span></label>}
          <label><span>From address</span><input type="email" value={settings.fromAddress} onChange={e => setSettings({ ...settings, fromAddress: e.target.value })} placeholder="security@example.com" required /></label>
          <div className="settings-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
        </form>
      </section>
    </main>
  </div>;
}
