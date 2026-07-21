import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Radar, Shield, ShieldAlert, Users } from 'lucide-react';
import HubTopbar from './HubTopbar/HubTopbar';
import './HubPage.css';

const APPS = [
  {
    id: 'defectdojo',
    name: 'DefectDojo Viewer',
    category: 'Vulnerability management',
    description: 'Vulnerability workflow — pull findings, sync with Redmine, manage mitigations',
    path: '/defectdojo/',
    icon: ShieldAlert,
    accentColor: '#f59e0b',  // amber
  },
  {
    id: 'wazuh',
    name: 'Wazuh Viewer',
    category: 'Security monitoring',
    description: 'Incident & SIEM workflow — alerts, agents, incident management',
    path: '/wazuh/',
    icon: Radar,
    accentColor: '#22c55e',  // green
  },
];

const STATUS_LABELS = {
  checking: 'Checking',
  healthy: 'Operational',
  offline: 'Unavailable',
};

export default function HubPage({ user, authNotice, onOpenDocs, onLogout, onOpenProfile }) {
  const isAdmin = user?.role === 'admin';
  const [appStatuses, setAppStatuses] = useState({
    defectdojo: 'checking',
    wazuh: 'checking'
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

  const statuses = APPS.map(app => appStatuses[app.id] || 'checking');
  const checkingCount = statuses.filter(status => status === 'checking').length;
  const healthyCount = statuses.filter(status => status === 'healthy').length;
  const readinessMessage = checkingCount > 0
    ? `Checking ${checkingCount} workspace${checkingCount === 1 ? '' : 's'}`
    : `${healthyCount} of ${APPS.length} operational`;

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
        {authNotice?.type === 'recovery-code-used' && (
          <aside className="hub-auth-notice" role="status">
            <span className="hub-auth-notice-icon" aria-hidden="true">
              <Shield size={18} />
            </span>
            <div className="hub-auth-notice-copy">
              <strong>Recovery code used</strong>
              <span>You signed in with a recovery code. {authNotice.recoveryCodesRemaining} codes remain.</span>
            </div>
            <button className="hub-auth-notice-action" type="button" onClick={onOpenProfile}>
              Review security
            </button>
          </aside>
        )}

        <section className="hub-hero" aria-labelledby="hub-page-title">
          <div className="hub-hero-copy">
            <span className="hub-eyebrow">Welcome back, {user?.username || 'User'}</span>
            <h1 className="hub-hero-title" id="hub-page-title">Choose your security workspace</h1>
            <p className="hub-hero-description">
              Launch vulnerability management or incident monitoring from one secure hub.
            </p>
          </div>

          <div className="hub-readiness" aria-live="polite">
            <div className="hub-readiness-summary">
              <span>Workspace availability</span>
              <strong>{readinessMessage}</strong>
            </div>
            <ul className="hub-readiness-list">
              {APPS.map((app) => {
                const status = appStatuses[app.id] || 'checking';
                return (
                  <li className="hub-readiness-item" key={app.id}>
                    <span className="hub-readiness-workspace">
                      <span className={`hub-status-dot ${status}`} aria-hidden="true" />
                      <span>{app.name}</span>
                    </span>
                    <span className={`hub-readiness-status ${status}`}>{STATUS_LABELS[status]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="hub-workspaces" aria-labelledby="hub-workspaces-heading">
          <header className="hub-section-heading">
            <div>
              <span className="hub-section-kicker">Active environments</span>
              <h2 id="hub-workspaces-heading">Workspaces</h2>
            </div>
            <span className="hub-workspace-count">{APPS.length} secure workspaces</span>
          </header>

          <div className="hub-workspace-grid">
            {APPS.map((app) => {
              const IconComponent = app.icon;
              const status = appStatuses[app.id] || 'checking';

              return (
                <a
                  key={app.id}
                  className="hub-workspace-card"
                  href={app.path}
                  style={{ '--accent-color': app.accentColor }}
                  aria-label={`Open ${app.name}`}
                >
                  <div className="hub-workspace-card-header">
                    <span className="hub-workspace-icon" aria-hidden="true">
                      <IconComponent size={26} />
                    </span>
                    <span className="hub-workspace-category">{app.category}</span>
                  </div>
                  <h3 className="hub-workspace-name">{app.name}</h3>
                  <p className="hub-workspace-description">{app.description}</p>
                  <footer className="hub-workspace-footer">
                    <span className={`hub-status-pill ${status}`}>
                      <span className="hub-status-dot" aria-hidden="true" />
                      {STATUS_LABELS[status]}
                    </span>
                    <span className="hub-launch-label">
                      Open workspace
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </span>
                  </footer>
                </a>
              );
            })}
          </div>
        </section>

        {isAdmin && (
          <section className="hub-admin-panel" aria-labelledby="hub-admin-heading">
            <span className="hub-admin-icon" aria-hidden="true">
              <Users size={20} />
            </span>
            <div className="hub-admin-copy">
              <span className="hub-admin-eyebrow">Administration</span>
              <h2 id="hub-admin-heading">User management</h2>
              <p>Manage Hub identities, roles, and product access.</p>
            </div>
            <a href="#users" className="hub-admin-action">
              <span>Manage users</span>
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </section>
        )}
      </main>
    </div>
  );
}
