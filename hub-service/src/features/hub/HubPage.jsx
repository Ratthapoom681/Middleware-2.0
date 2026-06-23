import { useState, useEffect } from 'react';
import { BookOpen, ShieldAlert, Radar, Users, LogOut, Shield } from 'lucide-react';
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

export default function HubPage({ user, onOpenDocs, onLogout }) {
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
      {/* Top Bar */}
      <header className="hub-topbar">
        <div className="topbar-brand">
          <Shield className="brand-logo-icon" size={20} />
          <span className="brand-text">Internal Security Middleware Hub</span>
        </div>
        <div className="topbar-user">
          <button className="btn-docs" onClick={onOpenDocs} title="Documentation">
            <BookOpen size={16} />
            <span>Documentation</span>
          </button>
          <span className="user-name">{user?.username}</span>
          <span className={`role-badge ${user?.role}`}>{user?.role}</span>
          <button className="btn-logout" onClick={onLogout} title="Sign Out">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="hub-content">
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
