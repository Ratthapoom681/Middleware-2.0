import { useState, useEffect, useRef } from 'react';
import { Database, Shield, Trash2, Save, Search, MoreVertical, Pencil, KeyRound, UserX, Plus, X } from 'lucide-react';
import { apiFetch } from '../../services/api';

const DEFAULT_REDMINE_STATUS_POLL_SECONDS = 60;
const USER_PAGE_SIZE_OPTIONS = [10, 25, 50];
const USER_STATUS_OPTIONS = ['active', 'suspended', 'pending'];
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

const normalizeUserText = (value) => String(value || '').trim();

const getUserStatus = () => 'active';

const getUserEmail = () => '';

const getUserLastLogin = () => '';

const getUserAccessType = (user = {}) => (
  user.role === 'viewer'
    ? ((user.products || []).length > 0 ? 'restricted' : 'none')
    : 'unrestricted'
);

const fuzzyUserMatches = (user = {}, query = '') => {
  const tokens = normalizeUserText(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    user.username,
    getUserEmail(user),
    user.role,
    getUserStatus(user),
    getUserAccessType(user),
    ...(user.products || [])
  ].join(' ').toLowerCase();
  return tokens.every(token => haystack.includes(token));
};

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
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [userSort, setUserSort] = useState({ field: 'username', direction: 'asc' });
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);
  const [openUserMenu, setOpenUserMenu] = useState('');
  const [userEditorOpen, setUserEditorOpen] = useState(false);
  const [userEditorMode, setUserEditorMode] = useState('create');
  const userMenuRef = useRef(null);

  const userRoles = Array.from(new Set(users.map(item => item.role).filter(Boolean))).sort();
  const filteredUsers = users
    .filter(item => fuzzyUserMatches(item, searchQuery))
    .filter(item => roleFilter === 'all' || item.role === roleFilter)
    .filter(item => statusFilter === 'all' || getUserStatus(item) === statusFilter)
    .filter(item => accessFilter === 'all' || getUserAccessType(item) === accessFilter)
    .sort((left, right) => {
      const direction = userSort.direction === 'desc' ? -1 : 1;
      const getValue = (item) => {
        if (userSort.field === 'status') return getUserStatus(item);
        if (userSort.field === 'access') return getUserAccessType(item);
        if (userSort.field === 'lastLogin') return getUserLastLogin(item);
        return item[userSort.field] || '';
      };
      return String(getValue(left)).localeCompare(String(getValue(right)), undefined, { numeric: true }) * direction;
    });
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const safeUserPage = Math.min(userPage, userPageCount);
  const pagedUsers = filteredUsers.slice((safeUserPage - 1) * userPageSize, safeUserPage * userPageSize);

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

  useEffect(() => {
    if (!openUserMenu) return undefined;

    const handlePointerDown = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setOpenUserMenu('');
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpenUserMenu('');
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openUserMenu]);

  const toggleUserSort = (field) => {
    setUserSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const sortIndicator = (field) => (
    userSort.field === field ? (userSort.direction === 'asc' ? '↑' : '↓') : ''
  );

  const openCreateUserModal = () => {
    setNewUser({ username: '', password: '', role: 'viewer', products: '' });
    setUserEditorMode('create');
    setUserEditorOpen(true);
  };

  const handleEditUser = (targetUser) => {
    setNewUser({
      username: targetUser.username,
      password: '',
      role: targetUser.role || 'viewer',
      products: (targetUser.products || []).join(', ')
    });
    setUserEditorMode('edit');
    setUserEditorOpen(true);
    setOpenUserMenu('');
  };

  const handleResetPassword = (targetUser) => {
    setNewUser({
      username: targetUser.username,
      password: '',
      role: targetUser.role || 'viewer',
      products: (targetUser.products || []).join(', ')
    });
    setUserEditorMode('reset');
    setUserEditorOpen(true);
    setOpenUserMenu('');
    setTimeout(() => document.getElementById('user-password')?.focus(), 0);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (userEditorMode === 'reset' && !newUser.password.trim()) {
      alert('Enter a new password before saving.');
      return;
    }
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
        setUserEditorOpen(false);
        setUserEditorMode('create');
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
        <div className="user-management-layout">
          <section className="config-section user-directory-panel">
            <div className="user-directory-header">
              <div>
                <h2 className="section-title">User Directory</h2>
                <p className="field-hint">{filteredUsers.length} of {users.length} users shown</p>
              </div>
              <button type="button" className="btn-primary" onClick={openCreateUserModal}>
                <Plus size={16} /> Add User
              </button>
            </div>

            <div className="user-tools">
              <label className="user-search">
                <span className="sr-only">Search users</span>
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Search name, email, role, user ID, product..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
              <label className="user-filter">
                <span>Role</span>
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option value="all">All roles</option>
                  {userRoles.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="user-filter">
                <span>Status</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  {USER_STATUS_OPTIONS.map(status => (
                    <option key={status} value={status} disabled={status !== 'active'}>{status}</option>
                  ))}
                </select>
              </label>
              <label className="user-filter">
                <span>Access</span>
                <select value={accessFilter} onChange={(e) => setAccessFilter(e.target.value)}>
                  <option value="all">All access</option>
                  <option value="unrestricted">Unrestricted</option>
                  <option value="restricted">Restricted</option>
                  <option value="none">No products</option>
                </select>
              </label>
            </div>

            {loadingUsers ? <p className="field-hint user-loading">Loading users...</p> : (
              <div className="user-table-wrap">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="sortable-header" onClick={() => toggleUserSort('username')}>
                          Name / User ID <span className="sort-indicator">{sortIndicator('username')}</span>
                        </button>
                      </th>
                      <th>Email</th>
                      <th>
                        <button type="button" className="sortable-header" onClick={() => toggleUserSort('role')}>
                          Role <span className="sort-indicator">{sortIndicator('role')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sortable-header" onClick={() => toggleUserSort('status')}>
                          Status <span className="sort-indicator">{sortIndicator('status')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sortable-header" onClick={() => toggleUserSort('access')}>
                          Department / Access <span className="sort-indicator">{sortIndicator('access')}</span>
                        </button>
                      </th>
                      <th>
                        <button type="button" className="sortable-header" onClick={() => toggleUserSort('lastLogin')}>
                          Last Login <span className="sort-indicator">{sortIndicator('lastLogin')}</span>
                        </button>
                      </th>
                      <th className="user-actions-head">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedUsers.length === 0 ? (
                      <tr>
                        <td colSpan="7">
                          <div className="user-empty-state">No users match the current search and filters.</div>
                        </td>
                      </tr>
                    ) : (
                      pagedUsers.map(u => {
                        const status = getUserStatus(u);
                        const accessType = getUserAccessType(u);
                        return (
                          <tr key={u.username}>
                            <td>
                              <div className="user-identity-cell">
                                <strong>{u.username}</strong>
                                <span>User ID: {u.username}</span>
                              </div>
                            </td>
                            <td className="muted-cell">{getUserEmail(u) || 'Not tracked'}</td>
                            <td>
                              <span className={`role-badge ${u.role}`}>{u.role}</span>
                            </td>
                            <td>
                              <span className={`status-badge ${status}`}>{status}</span>
                            </td>
                            <td>
                              <div className="user-access-cell">
                                <strong>{accessType === 'unrestricted' ? 'All products' : accessType === 'restricted' ? 'Restricted products' : 'No product access'}</strong>
                                <span>{u.role === 'viewer' ? ((u.products || []).join(', ') || 'None') : 'Full access'}</span>
                              </div>
                            </td>
                            <td className="muted-cell">{getUserLastLogin(u) || 'Not tracked'}</td>
                            <td className="user-actions-cell">
                              <div className="user-action-menu" ref={openUserMenu === u.username ? userMenuRef : null}>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => setOpenUserMenu(openUserMenu === u.username ? '' : u.username)}
                                  aria-label={`Open actions for ${u.username}`}
                                  aria-haspopup="menu"
                                  aria-expanded={openUserMenu === u.username}
                                >
                                  <MoreVertical size={16} />
                                </button>
                                {openUserMenu === u.username && (
                                  <div className="user-action-popover" role="menu">
                                    <button type="button" role="menuitem" onClick={() => handleEditUser(u)}>
                                      <Pencil size={15} /> Edit
                                    </button>
                                    <button type="button" role="menuitem" onClick={() => handleResetPassword(u)}>
                                      <KeyRound size={15} /> Reset password
                                    </button>
                                    <button type="button" role="menuitem" disabled title="No suspend API is available yet">
                                      <UserX size={15} /> Deactivate
                                    </button>
                                    <button type="button" role="menuitem" className="danger-menu-item" onClick={() => { setOpenUserMenu(''); handleDeleteUser(u.username); }}>
                                      <Trash2 size={15} /> Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="user-pagination">
              <span>
                Page {safeUserPage} of {userPageCount}
              </span>
              <div className="user-page-controls">
                <label className="user-filter user-page-size">
                  <span>Rows</span>
                  <select value={userPageSize} onChange={(e) => setUserPageSize(Number(e.target.value))}>
                    {USER_PAGE_SIZE_OPTIONS.map(size => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn-secondary" onClick={() => setUserPage(page => Math.max(1, page - 1))} disabled={safeUserPage <= 1}>
                  Previous
                </button>
                <button type="button" className="btn-secondary" onClick={() => setUserPage(page => Math.min(userPageCount, page + 1))} disabled={safeUserPage >= userPageCount}>
                  Next
                </button>
              </div>
            </div>
          </section>

          {userEditorOpen && (
            <div className="modal-overlay" onClick={() => setUserEditorOpen(false)}>
              <div
                className="modal-content user-editor-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="user-editor-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <div className="modal-title-row">
                    <div>
                      <h2 id="user-editor-title">
                        {userEditorMode === 'create' ? 'Add User' : userEditorMode === 'reset' ? `Reset Password: ${newUser.username}` : `Edit User: ${newUser.username}`}
                      </h2>
                      <p className="modal-subtitle">
                        {userEditorMode === 'create'
                          ? 'Create a dashboard account and assign its access scope.'
                          : userEditorMode === 'reset'
                            ? 'Set a new password without changing the user access scope.'
                            : 'Update the role and product access for this account.'}
                      </p>
                    </div>
                    <button type="button" className="icon-btn" onClick={() => setUserEditorOpen(false)} aria-label="Close user editor">
                      <X size={18} />
                    </button>
                  </div>
                </div>

                <form className="user-editor-form" onSubmit={handleCreateUser}>
                  <div className="form-group">
                    <label htmlFor="user-username">Username</label>
                    <input
                      id="user-username"
                      type="text"
                      value={newUser.username}
                      onChange={e => setNewUser({...newUser, username: e.target.value})}
                      disabled={userEditorMode !== 'create'}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="user-password">
                      {userEditorMode === 'create' ? 'Password' : userEditorMode === 'reset' ? 'New password' : 'Password (leave blank to keep existing)'}
                    </label>
                    <input
                      id="user-password"
                      type="password"
                      value={newUser.password}
                      onChange={e => setNewUser({...newUser, password: e.target.value})}
                      required={userEditorMode === 'create' || userEditorMode === 'reset'}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="user-role">Role</label>
                    <select
                      id="user-role"
                      value={newUser.role}
                      onChange={e => setNewUser({...newUser, role: e.target.value})}
                      disabled={userEditorMode === 'reset'}
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
                        disabled={userEditorMode === 'reset'}
                      />
                    </div>
                  )}
                  <div className="modal-actions user-modal-actions">
                    <button type="button" className="btn-secondary" onClick={() => setUserEditorOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary">
                      <Save size={16} /> {userEditorMode === 'reset' ? 'Save Password' : 'Save User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Settings;
