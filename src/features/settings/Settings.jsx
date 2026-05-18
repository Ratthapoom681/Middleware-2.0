import { useState, useEffect, useRef } from 'react';
import { Database, Shield, Trash2, Save } from 'lucide-react';
import { apiFetch } from '../../services/api';

const DEFAULT_REDMINE_STATUS_POLL_SECONDS = 60;
const REDMINE_PRIORITY_FIELDS = [
  { severity: 'Critical', field: 'redminePriorityCriticalId', label: 'Priority ID: Critical' },
  { severity: 'High', field: 'redminePriorityHighId', label: 'Priority ID: High' },
  { severity: 'Medium', field: 'redminePriorityMediumId', label: 'Priority ID: Medium' },
  { severity: 'Low', field: 'redminePriorityLowId', label: 'Priority ID: Low' },
  { severity: 'Info', field: 'redminePriorityInfoId', label: 'Priority ID: Info' },
];

const normalizeRedmineStatusPollInterval = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 0) return 0;
  if (Number.isInteger(parsed) && parsed > 0) {
    return Math.max(DEFAULT_REDMINE_STATUS_POLL_SECONDS, parsed);
  }
  return DEFAULT_REDMINE_STATUS_POLL_SECONDS;
};

const normalizeIntervalDraftValue = (value) => String(value || '').replace(/\D+/g, '');

const Settings = ({ 
  config, 
  onSaveConfig, 
  onClearData, 
  configBackups, 
  selectedConfigBackup, 
  setSelectedConfigBackup, 
  onBackupConfig, 
  onExportConfig, 
  onImportConfig, 
  onDownloadConfigBackup,
  onRestoreConfigBackup,
  user
}) => {
  const [activeTab, setActiveTab] = useState('data');
  const [tempConfig, setTempConfig] = useState(config);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaveMessage, setConfigSaveMessage] = useState('');
  const configImportInputRef = useRef(null);
  
  // User Management State
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer', products: '' });

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await apiFetch('/users');
      if (res.ok) setUsers(await res.json());
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => setTempConfig(config));
  }, [config]);

  useEffect(() => {
    if (activeTab === 'users' && user?.role === 'admin') {
      queueMicrotask(fetchUsers);
    }
  }, [activeTab, user]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        username: newUser.username,
        password: newUser.password,
        role: newUser.role,
        products: newUser.products.split(',').map(p => p.trim()).filter(Boolean)
      };
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setNewUser({ username: '', password: '', role: 'viewer', products: '' });
        fetchUsers();
        alert('User saved successfully');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to save user');
      }
    } catch {
      alert('Error saving user');
    }
  };

  const handleDeleteUser = async (username) => {
    if (!confirm(`Delete user ${username}?`)) return;
    try {
      const res = await apiFetch(`/users/${username}`, { method: 'DELETE' });
      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
      }
    } catch {
      alert('Error deleting user');
    }
  };

  const updateRedmineStatusPollInterval = (value) => {
    setConfigSaveMessage('');
    setTempConfig(prev => ({
      ...prev,
      redmineStatusPollIntervalSeconds: normalizeIntervalDraftValue(value),
    }));
  };

  const normalizeRedmineStatusPollIntervalDraft = () => {
    setTempConfig(prev => ({
      ...prev,
      redmineStatusPollIntervalSeconds: normalizeRedmineStatusPollInterval(prev.redmineStatusPollIntervalSeconds),
    }));
  };

  const handleSaveConfig = async () => {
    const normalizedConfig = {
      ...tempConfig,
      redmineStatusPollIntervalSeconds: normalizeRedmineStatusPollInterval(tempConfig.redmineStatusPollIntervalSeconds),
    };

    setTempConfig(normalizedConfig);
    setSavingConfig(true);
    try {
      const savedConfig = await onSaveConfig(normalizedConfig);
      setTempConfig(savedConfig || normalizedConfig);
      setConfigSaveMessage('Configuration saved.');
    } catch (err) {
      setConfigSaveMessage('');
      alert(err.message || 'Failed to save configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="empty-state">
        <Shield size={48} className="empty-state-icon" />
        <h2>Access Denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="settings-view">
      <div className="tabs" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'data' ? 'active' : ''}`}
          onClick={() => setActiveTab('data')}
          role="tab"
          aria-selected={activeTab === 'data'}
        >
          Data & Config
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
          role="tab"
          aria-selected={activeTab === 'users'}
        >
          User Management
        </button>
      </div>

      {activeTab === 'data' && (
        <>
          <section className="config-section config-section-spaced">
            <h2 className="section-title">Data Actions</h2>
            <div className="action-row">
              <button type="button" className="btn-danger" onClick={onClearData}>
                <Database size={16} />
                Clear All Data
              </button>
            </div>
          </section>

          <section className="config-section config-section-spaced">
            <h2 className="section-title">Backup Config</h2>
            <div className="action-row">
              <button type="button" className="btn-secondary" onClick={onBackupConfig}>
                Backup Now
              </button>
              <button type="button" className="btn-secondary" onClick={onExportConfig}>
                Export JSON
              </button>
              <button type="button" className="btn-secondary" onClick={() => configImportInputRef.current?.click()}>
                Import JSON
              </button>
              <input
                ref={configImportInputRef}
                type="file"
                id="config-import"
                accept="application/json,.json"
                onChange={onImportConfig}
                className="sr-only"
              />
              <select
                className="backup-select"
                aria-label="Saved configuration backups"
                value={selectedConfigBackup}
                onChange={(e) => setSelectedConfigBackup(e.target.value)}
              >
                <option value="">No saved backups</option>
                {configBackups.map(backup => (
                  <option key={backup.fileName} value={backup.fileName}>
                    {backup.fileName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-secondary"
                onClick={onDownloadConfigBackup}
                disabled={!selectedConfigBackup}
              >
                Download Selected
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={onRestoreConfigBackup}
                disabled={!selectedConfigBackup}
              >
                Restore Selected
              </button>
            </div>
          </section>

          <div className="config-grid">
            <section className="config-section">
              <h2 className="section-title">Connection</h2>
              <div className="form-group">
                <label htmlFor="defectdojo-url">DefectDojo URL</label>
                <input 
                  id="defectdojo-url"
                  type="text" 
                  value={tempConfig.defectDojoUrl} 
                  onChange={(e) => setTempConfig({...tempConfig, defectDojoUrl: e.target.value})}
                  placeholder="https://defectdojo.example.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="defectdojo-api-key">API Key</label>
                <input 
                  id="defectdojo-api-key"
                  type="password" 
                  value={tempConfig.defectDojoApiKey} 
                  onChange={(e) => setTempConfig({...tempConfig, defectDojoApiKey: e.target.value})}
                  placeholder="API Token"
                />
              </div>
              <div className="form-group">
                <label htmlFor="scan-path">Scan Path</label>
                <input 
                  id="scan-path"
                  type="text" 
                  value={tempConfig.scanPath} 
                  onChange={(e) => setTempConfig({...tempConfig, scanPath: e.target.value})}
                />
              </div>
            </section>

            <section className="config-section redmine-config-section">
              <h2 className="section-title">Redmine</h2>
              <div className="redmine-settings-grid">
                <div className="settings-subsection">
                  <h3>Connection</h3>
                  <div className="form-group">
                    <label htmlFor="redmine-url">Redmine URL</label>
                    <input
                      id="redmine-url"
                      type="text"
                      value={tempConfig.redmineUrl}
                      onChange={(e) => setTempConfig({ ...tempConfig, redmineUrl: e.target.value })}
                      placeholder="https://redmine.example.com"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="redmine-api-key">API Key</label>
                    <input
                      id="redmine-api-key"
                      type="password"
                      value={tempConfig.redmineApiKey}
                      onChange={(e) => setTempConfig({ ...tempConfig, redmineApiKey: e.target.value })}
                      placeholder="Redmine API Key"
                    />
                  </div>
                </div>

                <div className="settings-subsection">
                  <h3>Routing</h3>
                  <div className="form-group">
                    <label htmlFor="redmine-project-id">Project Identifier Override</label>
                    <input
                      id="redmine-project-id"
                      type="text"
                      value={tempConfig.redmineProjectId}
                      onChange={(e) => setTempConfig({ ...tempConfig, redmineProjectId: e.target.value })}
                      placeholder="leave empty for auto-routing"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="redmine-tracker-id">Tracker ID</label>
                    <input
                      id="redmine-tracker-id"
                      type="text"
                      value={tempConfig.redmineTrackerId || ''}
                      onChange={(e) => setTempConfig({ ...tempConfig, redmineTrackerId: e.target.value })}
                      placeholder="optional"
                    />
                  </div>
                </div>

                <div className="settings-subsection">
                  <h3>Priorities</h3>
                  <div className="form-group">
                    <label htmlFor="redmine-priority-default">Default Priority ID</label>
                    <input
                      id="redmine-priority-default"
                      type="text"
                      value={tempConfig.redminePriorityId || ''}
                      onChange={(e) => setTempConfig({ ...tempConfig, redminePriorityId: e.target.value })}
                      placeholder="used only when severity is missing"
                    />
                    <p className="field-hint">Set the per-severity IDs below so High, Medium, Low, and Info do not inherit a Critical default.</p>
                  </div>
                  {REDMINE_PRIORITY_FIELDS.map(({ severity, field, label }) => (
                    <div className="form-group" key={field}>
                      <label htmlFor={`redmine-priority-${severity.toLowerCase()}`}>{label}</label>
                      <input
                        id={`redmine-priority-${severity.toLowerCase()}`}
                        type="text"
                        value={tempConfig[field] || ''}
                        onChange={(e) => setTempConfig({ ...tempConfig, [field]: e.target.value })}
                        placeholder={`Redmine priority ID for ${severity}`}
                      />
                    </div>
                  ))}
                </div>

                <div className="settings-subsection">
                  <h3>Status Sync</h3>
                  <div className="form-group">
                    <label htmlFor="redmine-sync-interval">Status Sync Interval (seconds)</label>
                    <input
                      id="redmine-sync-interval"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={tempConfig.redmineStatusPollIntervalSeconds}
                      onChange={(e) => updateRedmineStatusPollInterval(e.target.value)}
                      onBlur={normalizeRedmineStatusPollIntervalDraft}
                      placeholder="60"
                    />
                    <p className="field-hint">Use 0 to disable. Minimum enabled interval is 60 seconds. The saved value stays visible here.</p>
                  </div>
                </div>

                <div className="settings-subsection redmine-status-subsection">
                  <h3>Status IDs</h3>
                  <div className="redmine-status-grid">
                    <div className="form-group">
                      <label htmlFor="redmine-status-new">New</label>
                      <input
                        id="redmine-status-new"
                        type="text"
                        value={tempConfig.redmineStatusNewId || ''}
                        onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusNewId: e.target.value })}
                        placeholder="name lookup fallback"
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="redmine-status-feedback">Feedback</label>
                      <input
                        id="redmine-status-feedback"
                        type="text"
                        value={tempConfig.redmineStatusFeedbackId || ''}
                        onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusFeedbackId: e.target.value })}
                        placeholder="preferred for auto-reopen"
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="redmine-status-progress">In Progress</label>
                      <input
                        id="redmine-status-progress"
                        type="text"
                        value={tempConfig.redmineStatusInProgressId || ''}
                        onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusInProgressId: e.target.value })}
                        placeholder="fallback for auto-reopen"
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="redmine-status-resolve">Resolve</label>
                      <input
                        id="redmine-status-resolve"
                        type="text"
                        value={tempConfig.redmineStatusResolveId || ''}
                        onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusResolveId: e.target.value })}
                        placeholder="Resolve/Resolved fallback"
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="redmine-status-closed">Closed</label>
                      <input
                        id="redmine-status-closed"
                        type="text"
                        value={tempConfig.redmineStatusClosedId || ''}
                        onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusClosedId: e.target.value })}
                        placeholder="required for manual close"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          
          <div className="settings-footer">
            {configSaveMessage && <span className="field-hint" role="status">{configSaveMessage}</span>}
            <button className="btn-primary" onClick={handleSaveConfig} disabled={savingConfig}>
              <Save size={16} /> {savingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </>
      )}

      {activeTab === 'users' && (
        <div className="config-grid">
          <section className="config-section">
            <h2 className="section-title">Add / Update User</h2>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label htmlFor="user-username">Username</label>
                <input 
                  id="user-username"
                  type="text" 
                  value={newUser.username}
                  onChange={e => setNewUser({...newUser, username: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="user-password">Password (leave blank to keep existing if updating)</label>
                <input 
                  id="user-password"
                  type="password" 
                  value={newUser.password}
                  onChange={e => setNewUser({...newUser, password: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label htmlFor="user-role">Role</label>
                <select 
                  id="user-role"
                  value={newUser.role} 
                  onChange={e => setNewUser({...newUser, role: e.target.value})}
                >
                  <option value="viewer">Viewer (Restricted)</option>
                  <option value="admin">Admin (Full Access)</option>
                </select>
              </div>
              {newUser.role === 'viewer' && (
                <div className="form-group">
                  <label htmlFor="user-products">Allowed Products (Comma-separated exact names)</label>
                  <input 
                    id="user-products"
                    type="text" 
                    value={newUser.products}
                    onChange={e => setNewUser({...newUser, products: e.target.value})}
                    placeholder="e.g. Product A, Application B"
                  />
                </div>
              )}
              <button type="submit" className="btn-primary form-submit">
                <Save size={16} /> Save User
              </button>
            </form>
          </section>

          <section className="config-section">
            <h2 className="section-title">Existing Users</h2>
            {loadingUsers ? <p>Loading...</p> : (
              <div className="user-list">
                {users.map(u => (
                  <div key={u.username} className="user-row">
                    <div>
                      <strong>{u.username}</strong>
                      <span className={`role-badge ${u.role}`}>
                        {u.role.toUpperCase()}
                      </span>
                      {u.role === 'viewer' && u.products && (
                        <div className="user-products">
                          Products: {u.products.length > 0 ? u.products.join(', ') : 'None (sees nothing)'}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-btn danger-icon"
                      onClick={() => handleDeleteUser(u.username)}
                      aria-label={`Delete ${u.username}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default Settings;
