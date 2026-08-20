import { useEffect, useState } from 'react';
import { KeyRound, MailWarning, Radar, Settings, ShieldAlert, Users } from 'lucide-react';
import { hasPermission, hasWorkspaceAccess, isSystemAdmin } from '../../../../../packages/access-control/index.js';
import HubTopbar from './HubTopbar/HubTopbar';
import { getDefectDojoPath } from './hubRouting.js';
import './HubPage.css';

const APPS = [
  {
    id: 'defectdojo',
    name: 'DefectDojo Viewer',
    description: 'Vulnerability workflow — pull findings, sync with Redmine, manage mitigations',
    path: '/defectdojo/',
    icon: ShieldAlert,
    accentColor: '#f59e0b',  // amber
    workspace: 'DefectDojo',
  },
  {
    id: 'wazuh',
    name: 'Wazuh Viewer',
    description: 'Incident & SIEM workflow — alerts, agents, incident management',
    path: '/wazuh/',
    icon: Radar,
    accentColor: '#22c55e',  // green
    workspace: 'Wazuh',
  },
];

export default function HubPage({ user, onOpenDocs, onLogout, onOpenProfile, onOpenSettings, onOpenRoles }) {
  const isAdmin = isSystemAdmin(user);
  const canManageSettings = hasPermission(user, 'hub.settings.manage');
  const visibleApps = APPS.filter(app => hasWorkspaceAccess(user, app.workspace));
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
        {user?.mfaStatus === 'pending' && <div className="hub-auth-notice" role="status"><MailWarning size={18} /><span>Authenticator setup is pending. Check your email for the secure setup link, or contact an administrator to resend it.</span></div>}
        <div className="welcome-section">
          <p className="welcome-back">Welcome back, {user?.username}</p>
          <h1 className="select-workspace-heading">Select a workspace</h1>
        </div>

        {/* App Grid */}
        <div className="app-grid">
          {visibleApps.map((app) => {
            const IconComponent = app.icon;
            return (
              <div
                key={app.id}
                className="app-card"
                onClick={() => handleCardClick(app.id === 'defectdojo' ? getDefectDojoPath(user) : app.path)}
                style={{ '--accent-color': app.accentColor }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleCardClick(app.id === 'defectdojo' ? getDefectDojoPath(user) : app.path);
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
          {visibleApps.length === 0 && (
            <div className="hub-auth-notice" role="status">
              <ShieldAlert size={18} />
              <span>No workspaces are assigned to your role. Your profile remains available.</span>
            </div>
          )}
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
              <button type="button" className="btn-admin-nav" onClick={onOpenRoles}><KeyRound size={16} /><span>Roles &amp; Access</span></button>
              {canManageSettings && <button type="button" className="btn-admin-nav" onClick={onOpenSettings}><Settings size={16} /><span>System Settings</span></button>}
            </div>
          </section>
        )}
        {!isAdmin && canManageSettings && (
          <section className="admin-section">
            <div className="admin-divider" />
            <span className="admin-label">Administration</span>
            <div className="admin-actions">
              <button type="button" className="btn-admin-nav" onClick={onOpenSettings}><Settings size={16} /><span>System Settings</span></button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
