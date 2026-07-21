import { useEffect, useState } from 'react';
import { Radar, ShieldAlert, Smartphone, Users } from 'lucide-react';
import HubTopbar from './HubTopbar/HubTopbar';
import './HubPage.css';

const APPS = [
  {
    id: 'defectdojo',
    name: 'DefectDojo Viewer',
    description: 'Vulnerability workflow — pull findings, sync with Redmine, manage mitigations',
    path: '/defectdojo/',
    icon: ShieldAlert,
    accentColor: '#f59e0b',  // amber
  },
  {
    id: 'wazuh',
    name: 'Wazuh Viewer',
    description: 'Incident & SIEM workflow — alerts, agents, incident management',
    path: '/wazuh/',
    icon: Radar,
    accentColor: '#22c55e',  // green
  },
];

const getMfaStatus = user => {
  const status = String(user?.mfa?.status || user?.mfaStatus || '').toLowerCase();
  if (['disabled', 'pending', 'enabled'].includes(status)) return status;
  if (user?.mfaEnabled) return 'enabled';
  return user?.mfa?.mode === 'authenticator' || user?.mfaMode === 'authenticator' ? 'pending' : 'disabled';
};

export default function HubPage({ user, onOpenDocs, onLogout, onOpenProfile, onOpenMfaSetup }) {
  const isAdmin = user?.role === 'admin';
  const [appStatuses, setAppStatuses] = useState({
    defectdojo: 'healthy',
    wazuh: 'healthy'
  });

  useEffect(() => {
    // Check DefectDojo Health
    fetch('/defectdojo/api/health')
      .then(res => res.ok ? 'healthy' : 'offline')
      .catch(() => 'offline')
      .then(status => {
        setAppStatuses(prev => ({ ...prev, defectdojo: status }));
      });

    // Check Wazuh Health (the static mockup site root)
    fetch('/wazuh/')
      .then(res => res.ok ? 'healthy' : 'offline')
      .catch(() => 'offline')
      .then(status => {
        setAppStatuses(prev => ({ ...prev, wazuh: status }));
      });
  }, []);

  const handleCardClick = (path) => {
    window.location.href = path;
  };


  return (
    <div className="hub-page">
      <HubTopbar
        user={user}
        onOpenDocs={onOpenDocs}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />

      {/* Main Content */}
      <main className="hub-content">
        {getMfaStatus(user) === 'pending' && (
          <div className="hub-auth-notice" role="status">
            <Smartphone size={18} />
            <span>An administrator enabled Authenticator MFA for your account. Connect your app to finish setup.</span>
            <button type="button" onClick={onOpenMfaSetup}>Set up authenticator</button>
          </div>
        )}
        <div className="welcome-section">
          <p className="welcome-back">Welcome back, {user?.username}</p>
          <h1 className="select-workspace-heading">Select a workspace</h1>
        </div>

        {/* App Grid */}
        <div className="app-grid">
          {APPS.map((app) => {
            const IconComponent = app.icon;
            return (
              <div
                key={app.id}
                className="app-card"
                onClick={() => handleCardClick(app.path)}
                style={{ '--accent-color': app.accentColor }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCardClick(app.path);
                  }
                }}
              >
                <div className="card-top">
                  <div
                    className="icon-container"
                    style={{
                      backgroundColor: `${app.accentColor}1f`,
                      color: app.accentColor,
                    }}
                  >
                    <IconComponent size={24} />
                  </div>
                  <h3 className="app-name">{app.name}</h3>
                </div>
                <p className="app-description">{app.description}</p>
                <div className="card-status">
                  <span className={`status-dot ${appStatuses[app.id] || 'offline'}`} />
                  <span className="status-text">
                    {(appStatuses[app.id] || 'offline') === 'healthy' ? 'Healthy' : 'Offline'}
                  </span>
                </div>

              </div>
            );
          })}
        </div>

        {/* Admin Section */}
        {isAdmin && (
          <section className="admin-section">
            <div className="admin-divider" />
            <span className="admin-label">Administration</span>
            <div className="admin-actions">
              <a
                href="#users"
                className="btn-admin-nav"
                role="button"
              >
                <Users size={16} />
                <span>User Management</span>
              </a>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
