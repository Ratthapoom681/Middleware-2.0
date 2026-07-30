import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Bell,
  Flame,
  Monitor,
  Settings,
  ArrowLeft,
  Search,
  Activity,
  CheckCircle,
  AlertTriangle,
  X,
  Plus,
  ChevronRight,
  User,
  Shield,
  Clock,
  MessageSquare,
  Lock
} from 'lucide-react';

// Import Mock Data
import { MOCK_STATS } from '../mock/stats';
import { MOCK_ALERTS } from '../mock/alerts';
import { MOCK_INCIDENTS } from '../mock/incidents';
import { MOCK_AGENTS } from '../mock/agents';
import { formatBangkokDate, formatBangkokDateTime, formatBangkokTime } from '../shared/time';
import { getAccess, hasPermission } from '../../../../packages/access-control/index.js';

// ── AUTH CHECK ──
const TOKEN_KEY = 'middleware_token';
const USER_KEY = 'middleware_user';
const LOGIN_URL = '/login/?returnTo=%2Fwazuh%2F';

function decodeValidToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64));
    if (payload.iss !== 'middleware-hub' || payload.aud !== 'internal-security-middleware') return null;
    if (!payload.exp || Date.now() / 1000 >= payload.exp || !payload.sid || !payload.sub || !payload.username) return null;
    if (payload.status && payload.status !== 'active') return null;
    return payload;
  } catch {
    return null;
  }
}

export default function App() {
  const [token, setToken] = useState(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    return decodeValidToken(stored) ? stored : null;
  });
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  });

  const [currentHash, setCurrentHash] = useState(() => window.location.hash || '#dashboard');
  const [alerts, setAlerts] = useState(MOCK_ALERTS);
  const [incidents, setIncidents] = useState(MOCK_INCIDENTS);
  const [agents, setAgents] = useState(MOCK_AGENTS);

  // Modals state
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);
  const [showCreateIncident, setShowCreateIncident] = useState(false);
  const canViewWazuh = hasPermission(user, 'wazuh.view');
  const canManageIncidents = hasPermission(user, 'wazuh.incidents.manage');
  const canManageSettings = hasPermission(user, 'wazuh.settings.manage');
  const access = getAccess(user);

  // Sync hash routing
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#dashboard');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Wazuh is a static mockup; validate JWT claims/expiry before rendering.
  useEffect(() => {
    if (!token || !user || !decodeValidToken(token)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = LOGIN_URL;
    }
  }, [token, user]);

  if (!token || !user) {
    return (
      <div style={{ backgroundColor: '#0f1624', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9ca8bc', fontFamily: 'sans-serif' }}>Redirecting to sign in...</p>
      </div>
    );
  }

  if (!canViewWazuh) {
    return (
      <AccessDeniedPage
        message="Your role does not include viewing Wazuh alerts, incidents, or agents."
        onBack={() => { window.location.href = '/'; }}
      />
    );
  }

  const handleLogout = () => {
    fetch('/api/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    window.location.href = LOGIN_URL;
  };

  // ── ROUTING LOGIC ──
  const navigateTo = (hash) => {
    window.location.hash = hash;
  };

  const activePage = currentHash.split('/')[0];
  const detailParam = currentHash.split('/')[1];

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">
            <Shield size={20} />
          </span>
          <span>Wazuh Viewer</span>
        </div>

        <button type="button" className="sidebar-user" onClick={() => {
          const returnTo = `${window.location.pathname}${window.location.hash || '#dashboard'}`;
          window.location.href = `/#profile?returnTo=${encodeURIComponent(returnTo)}`;
        }} aria-label="Open your profile">
          <span>{user.username}</span>
          <small>{access.role.name}</small>
        </button>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-nav-item ${activePage === '#dashboard' ? 'active' : ''}`}
            onClick={() => navigateTo('#dashboard')}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </button>
          
          <button
            className={`sidebar-nav-item ${activePage === '#alerts' ? 'active' : ''}`}
            onClick={() => navigateTo('#alerts')}
          >
            <Bell size={18} />
            <span>Alerts</span>
          </button>

          <button
            className={`sidebar-nav-item ${activePage === '#incidents' ? 'active' : ''}`}
            onClick={() => navigateTo('#incidents')}
          >
            <Flame size={18} />
            <span>Incidents</span>
          </button>

          <button
            className={`sidebar-nav-item ${activePage === '#agents' ? 'active' : ''}`}
            onClick={() => navigateTo('#agents')}
          >
            <Monitor size={18} />
            <span>Agents</span>
          </button>

          {canManageSettings && (
            <button
              className={`sidebar-nav-item ${activePage === '#settings' ? 'active' : ''}`}
              onClick={() => navigateTo('#settings')}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-nav-item" onClick={() => { window.location.href = '/'; }}>
            <ArrowLeft size={18} />
            <span>Back to Hub</span>
          </button>
          <button className="sidebar-nav-item danger" onClick={handleLogout}>
            <LogOutIcon size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <main className="main-viewport">
        {activePage === '#dashboard' && (
          <DashboardPage 
            alerts={alerts} 
            incidents={incidents} 
            agents={agents}
            onSelectAlert={setSelectedAlert}
            onNavigate={navigateTo}
          />
        )}
        {activePage === '#alerts' && (
          <AlertsPage 
            alerts={alerts} 
            onSelectAlert={setSelectedAlert} 
          />
        )}
        {activePage === '#incidents' && !detailParam && (
          <IncidentsPage 
            incidents={incidents} 
            onSelectIncident={(id) => navigateTo(`#incidents/${id}`)}
            onOpenCreate={() => setShowCreateIncident(true)}
            canManage={canManageIncidents}
          />
        )}
        {activePage === '#incidents' && detailParam && (
          <IncidentDetailPage 
            incidentId={Number(detailParam)} 
            incidents={incidents}
            canManage={canManageIncidents}
            onBack={() => navigateTo('#incidents')}
            onAddTimelineNote={(id, noteText) => {
              setIncidents(prev => prev.map(inc => {
                if (inc.id === id) {
                  return {
                    ...inc,
                    timeline: [
                      ...inc.timeline,
                      { actor: user.username, action: 'note', time: new Date().toISOString(), message: noteText }
                    ]
                  };
                }
                return inc;
              }));
            }}
            onChangeStatus={(id, nextStatus) => {
              setIncidents(prev => prev.map(inc => {
                if (inc.id === id) {
                  return {
                    ...inc,
                    status: nextStatus,
                    timeline: [
                      ...inc.timeline,
                      { actor: user.username, action: 'status_change', time: new Date().toISOString(), message: `Changed status to ${nextStatus}` }
                    ]
                  };
                }
                return inc;
              }));
            }}
          />
        )}
        {activePage === '#agents' && (
          <AgentsPage agents={agents} />
        )}
        {activePage === '#settings' && (
          canManageSettings
            ? <SettingsPage />
            : <AccessDeniedPage message="Your role does not include managing Wazuh settings." onBack={() => navigateTo('#dashboard')} compact />
        )}
      </main>

      {/* Modals */}
      {selectedAlert && (
        <AlertDetailModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}

      {showCreateIncident && canManageIncidents && (
        <IncidentCreateModal 
          onClose={() => setShowCreateIncident(false)} 
          onSubmit={(title, desc, severity) => {
            const nextId = incidents.length + 1;
            const newIncident = {
              id: nextId,
              title,
              severity,
              status: 'open',
              assignee: user.username,
              linkedAlerts: 0,
              createdAt: new Date().toISOString(),
              description: desc,
              timeline: [
                { actor: 'system', action: 'created', time: new Date().toISOString(), message: `Incident logged manually by ${user.username}` }
              ]
            };
            setIncidents(prev => [newIncident, ...prev]);
            setShowCreateIncident(false);
          }}
        />
      )}
    </div>
  );
}

function AccessDeniedPage({ message, onBack, compact = false }) {
  return (
    <div className={compact ? 'page-frame' : 'app-shell'} style={{ minHeight: compact ? 'auto' : '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <section style={{ maxWidth: 520, textAlign: 'center' }}>
        <Lock size={38} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
        <h1 style={{ fontSize: '1.4rem' }}>Access denied</h1>
        <p style={{ color: 'var(--text-muted)', margin: '.65rem 0 1.25rem' }}>{message}</p>
        <button type="button" className="btn-secondary" onClick={onBack}><ArrowLeft size={16} />Back</button>
      </section>
    </div>
  );
}

// ── CUSTOM ICONS ──
function LogOutIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ── PAGE 1: DASHBOARD PAGE ──
function DashboardPage({ alerts, incidents, agents, onSelectAlert, onNavigate }) {
  const activeIncidents = incidents.filter(i => i.status !== 'closed' && i.status !== 'resolved').length;
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const highAlerts = alerts.filter(a => a.severity === 'high' || a.severity === 'critical').length;

  return (
    <div className="page-frame">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Dashboard Overview</h1>
          <p>Real-time security analytics and agent health metrics</p>
        </div>
      </header>

      {/* Stat Cards */}
      <div className="card-grid-4">
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' }}>
            <AlertTriangle size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Security Alerts</span>
            <span className="stat-value">{alerts.length}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}>
            <Flame size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Active Incidents</span>
            <span className="stat-value">{activeIncidents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' }}>
            <Monitor size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Active Agents</span>
            <span className="stat-value">{activeAgents} / {agents.length}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' }}>
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-label">Threat Level (High)</span>
            <span className="stat-value">{highAlerts}</span>
          </div>
        </div>
      </div>

      {/* Recent Alerts */}
      <div className="table-container">
        <div className="table-toolbar">
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent High-Severity Alerts</h2>
          <button className="btn-secondary" onClick={() => onNavigate('#alerts')}>
            <span>View All Alerts</span>
            <ChevronRight size={14} />
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Agent</th>
              <th>Rule Description</th>
              <th>Severity</th>
              <th>Source IP</th>
            </tr>
          </thead>
          <tbody>
            {alerts.slice(0, 5).map(alert => (
              <tr key={alert.id} className="clickable" onClick={() => onSelectAlert(alert)}>
                <td style={{ color: 'var(--text-muted)' }}>{formatBangkokTime(alert.timestamp)}</td>
                <td style={{ fontWeight: 500 }}>{alert.agent.name}</td>
                <td>{alert.rule.description}</td>
                <td>
                  <span className={`badge level-${alert.severity}`}>{alert.severity}</span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{alert.srcIp || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PAGE 2: ALERTS PAGE ──
function AlertsPage({ alerts, onSelectAlert }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');

  const filtered = alerts.filter(alert => {
    const matchesSearch = 
      alert.rule.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      alert.agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (alert.srcIp && alert.srcIp.includes(searchTerm));
    
    const matchesSeverity = severityFilter === 'all' || alert.severity === severityFilter;

    return matchesSearch && matchesSeverity;
  });

  return (
    <div className="page-frame">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Security Alerts</h1>
          <p>Real-time threat alerts from Wazuh agents</p>
        </div>
      </header>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {['all', 'low', 'medium', 'high', 'critical'].map(lvl => (
              <button 
                key={lvl} 
                className={`filter-tab ${severityFilter === lvl ? 'active' : ''}`}
                onClick={() => setSeverityFilter(lvl)}
              >
                {lvl.toUpperCase()}
              </button>
            ))}
          </div>
          <input 
            type="text" 
            placeholder="Search alerts, agents, IPs..." 
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Agent</th>
              <th>ID/Rule</th>
              <th>Rule Description</th>
              <th>Severity</th>
              <th>Source IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(alert => (
              <tr key={alert.id} className="clickable" onClick={() => onSelectAlert(alert)}>
                <td style={{ color: 'var(--text-muted)' }}>{formatBangkokDateTime(alert.timestamp)}</td>
                <td style={{ fontWeight: 500 }}>{alert.agent.name}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {alert.rule.id}
                </td>
                <td>{alert.rule.description}</td>
                <td>
                  <span className={`badge level-${alert.severity}`}>{alert.severity}</span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{alert.srcIp || 'N/A'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No alerts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PAGE 3: INCIDENTS PAGE ──
function IncidentsPage({ incidents, onSelectIncident, onOpenCreate, canManage }) {
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = incidents.filter(inc => {
    return statusFilter === 'all' || inc.status === statusFilter;
  });

  return (
    <div className="page-frame">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Incident Manager</h1>
          <p>Track, investigate, and mitigate ongoing security issues</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={onOpenCreate}>
            <Plus size={16} />
            <span>New Incident</span>
          </button>
        )}
      </header>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="filter-tabs">
            {['all', 'open', 'investigating', 'mitigating', 'resolved', 'closed'].map(st => (
              <button 
                key={st} 
                className={`filter-tab ${statusFilter === st ? 'active' : ''}`}
                onClick={() => setStatusFilter(st)}
              >
                {st.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Incident Title</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Linked Alerts</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(inc => (
              <tr key={inc.id} className="clickable" onClick={() => onSelectIncident(inc.id)}>
                <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>INC-{inc.id}</td>
                <td style={{ fontWeight: 500 }}>{inc.title}</td>
                <td>
                  <span className={`badge level-${inc.severity}`}>{inc.severity}</span>
                </td>
                <td>
                  <span className={`badge status-${inc.status}`}>{inc.status}</span>
                </td>
                <td style={{ color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <User size={12} />
                    <span>{inc.assignee}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{inc.linkedAlerts}</td>
                <td style={{ color: 'var(--text-muted)' }}>{formatBangkokDateTime(inc.createdAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No incidents logged under the selected status.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── PAGE 4: INCIDENT DETAIL PAGE ──
function IncidentDetailPage({ incidentId, incidents, onBack, onAddTimelineNote, onChangeStatus, canManage }) {
  const [noteText, setNoteText] = useState('');
  const incident = incidents.find(i => i.id === incidentId);

  if (!incident) {
    return (
      <div className="page-frame">
        <button className="btn-secondary" onClick={onBack} style={{ marginBottom: '1.5rem' }}>
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
        <p>Incident not found.</p>
      </div>
    );
  }

  const handlePostNote = (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    onAddTimelineNote(incidentId, noteText.trim());
    setNoteText('');
  };

  return (
    <div className="page-frame" style={{ maxWidth: '900px' }}>
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: '1.5rem' }}>
        <ArrowLeft size={16} />
        <span>Back to Incidents</span>
      </button>

      <header className="incident-detail-header" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>INCIDENT ID: INC-{incident.id}</span>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '0.25rem' }}>{incident.title}</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{incident.description}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span className={`badge level-${incident.severity}`}>{incident.severity}</span>
            <span className={`badge status-${incident.status}`}>{incident.status}</span>
          </div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
        {/* Timeline Log */}
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>Activity Timeline</h3>
          
          <div className="timeline-feed" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2rem' }}>
            {incident.timeline.map((event, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)'
                  }}>
                    {event.action === 'created' && <Plus size={14} />}
                    {event.action === 'status_change' && <Clock size={14} />}
                    {event.action === 'note' && <MessageSquare size={14} />}
                  </div>
                  {idx < incident.timeline.length - 1 && (
                    <div style={{ flex: 1, width: '1px', backgroundColor: 'var(--border-subtle)', marginTop: '0.25rem' }} />
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <strong style={{ color: 'var(--text-main)' }}>{event.actor}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{event.action.replace('_', ' ')}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>• {formatBangkokTime(event.time)}</span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '0.25rem' }}>{event.message}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Add timeline note */}
          {canManage && <form onSubmit={handlePostNote} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <textarea
              placeholder="Post an update or note to this timeline..."
              rows="3"
              style={{
                backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--rounded-md)',
                color: 'var(--text-main)', padding: '0.75rem', fontSize: '0.875rem', width: '100%', resize: 'none'
              }}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button type="submit" className="btn-primary" style={{ width: 'fit-content' }}>
              <span>Post Update</span>
            </button>
          </form>}
        </div>

        {/* Sidebar Controls */}
        <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', padding: '1.25rem', borderRadius: 'var(--rounded-md)', height: 'fit-content' }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>Controls</h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Assignee</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <User size={14} className="brand-logo-icon" />
                <span>{incident.assignee}</span>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Created</label>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {formatBangkokDate(incident.createdAt)}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Status Workflow</label>
              <select
                style={{
                  backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', color: 'var(--text-main)',
                  padding: '0.35rem 0.5rem', borderRadius: 'var(--rounded-sm)', fontSize: '0.85rem', width: '100%'
                }}
                value={incident.status}
                onChange={(e) => onChangeStatus(incidentId, e.target.value)}
                disabled={!canManage}
              >
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
              {!canManage && <small style={{ color: 'var(--text-muted)' }}>View only</small>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PAGE 5: AGENTS PAGE ──
function AgentsPage({ agents }) {
  return (
    <div className="page-frame">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Security Agents</h1>
          <p>Inventory of systems monitored by Wazuh</p>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.25rem' }}>
        {agents.map(agent => (
          <div key={agent.id} style={{
            backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--rounded-md)',
            padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>ID: {agent.id}</span>
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase',
                backgroundColor: agent.status === 'active' ? 'rgba(34,197,94,0.1)' : agent.status === 'disconnected' ? 'rgba(239,68,68,0.1)' : 'rgba(156,168,188,0.1)',
                color: agent.status === 'active' ? 'var(--success)' : agent.status === 'disconnected' ? 'var(--danger)' : 'var(--text-muted)'
              }}>
                {agent.status.replace('_', ' ')}
              </span>
            </div>

            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{agent.name}</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '0.125rem' }}>{agent.ip}</p>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <div>OS: <span style={{ color: 'var(--text-main)' }}>{agent.os}</span></div>
              <div>Version: <span style={{ color: 'var(--text-main)' }}>{agent.version}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PAGE 6: SETTINGS PAGE ──
function SettingsPage() {
  return (
    <div className="page-frame" style={{ maxWidth: '650px' }}>
      <header className="page-header">
        <div className="page-title-group">
          <h1>Wazuh Manager Settings</h1>
          <p>Configure SIEM connection parameters</p>
        </div>
      </header>

      <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--rounded-md)', padding: '2rem', position: 'relative', overflow: 'hidden' }}>
        {/* Overlay showing mockup lock */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 22, 36, 0.75)',
          backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', zindex: 20
        }}>
          <Lock size={32} style={{ color: 'var(--primary)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Mockup Preview Only</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Backend settings config will be active in next integration phase.</p>
        </div>

        <div style={{ opacity: 0.2 }}>
          <form style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} onSubmit={e => e.preventDefault()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Wazuh API Endpoint</label>
              <input type="text" value="https://wazuh-manager.local:55000" disabled style={{ backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>API Username</label>
              <input type="text" value="admin_readonly" disabled style={{ backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>API Password</label>
              <input type="password" value="••••••••••••••••" disabled style={{ backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: '4px' }} />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── MODAL: ALERT DETAIL MODAL ──
function AlertDetailModal({ alert, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Security Alert Details</h2>
          <X className="modal-close" onClick={onClose} size={18} />
        </header>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description</span>
            <p style={{ fontSize: '1rem', fontWeight: '500', color: 'var(--text-main)', marginTop: '0.125rem' }}>{alert.rule.description}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Agent Monitored</span>
              <p style={{ fontSize: '0.875rem', fontWeight: '500', marginTop: '0.125rem' }}>{alert.agent.name} (ID: {alert.agent.id})</p>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Severity Level</span>
              <p style={{ marginTop: '0.125rem' }}>
                <span className={`badge level-${alert.severity}`}>{alert.severity}</span>
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Rule ID</span>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', marginTop: '0.125rem' }}>{alert.rule.id}</p>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Source IP Address</span>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', marginTop: '0.125rem' }}>{alert.srcIp || 'Internal / Agent Log'}</p>
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Groups & Signatures</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
              {alert.groups.map(g => (
                <span key={g} style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{g}</span>
              ))}
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Raw Log Event</span>
            <pre style={{
              backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '4px',
              padding: '0.75rem', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', overflowX: 'auto', whiteSpace: 'pre-wrap', marginTop: '0.25rem'
            }}>{alert.rawLog}</pre>
          </div>
        </div>

        <footer className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}

// ── MODAL: INCIDENT CREATE MODAL ──
function IncidentCreateModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState('medium');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim() || !desc.trim()) return;
    onSubmit(title.trim(), desc.trim(), severity);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
        <header className="modal-header">
          <h2>Create Security Incident</h2>
          <X className="modal-close" onClick={onClose} size={18} />
        </header>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Incident Title</label>
              <input
                type="text"
                placeholder="e.g. Host portscan attack from internal subnet"
                required
                style={{ backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: '4px', color: 'var(--text-main)' }}
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Description / Context</label>
              <textarea
                placeholder="Describe what occurred, target hosts, impacted services..."
                rows="4"
                required
                style={{ backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: '4px', color: 'var(--text-main)', resize: 'none' }}
                value={desc}
                onChange={e => setDesc(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>Severity Level</label>
              <select
                style={{ backgroundColor: 'var(--bg-body)', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: '4px', color: 'var(--text-main)' }}
                value={severity}
                onChange={e => setSeverity(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <footer className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Create Incident</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
