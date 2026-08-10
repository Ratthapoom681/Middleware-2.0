import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  expandPermissionDependencies,
  normalizePermissionKeys,
} from '../../../../../packages/access-control/index.js';
import {
  createAuthenticatedRequest,
  isSessionExpiredError,
} from '../../shared/authenticatedRequest.js';
import { requireApiCollection } from '../../shared/apiCollections.js';
import './RolesAccessPage.css';

const EMPTY_DRAFT = {
  id: '',
  name: '',
  description: '',
  permissions: [],
  assignedUserCount: 0,
};

const formatDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
};

const describeAuditAction = event => {
  const labels = {
    'role.created': 'Created role',
    'role.updated': 'Updated role',
    'role.retired': 'Retired role',
    'user.created': 'Created user',
    'user.updated': 'Updated user access',
    'user.identity_updated': 'Updated user access',
    'user.deleted': 'Deleted user',
  };
  return labels[event.action] || event.action.replaceAll('.', ' ');
};

function RoleSummary({ role, catalog }) {
  const labels = role.system
    ? ['Every current and future permission']
    : role.permissions.map(key => catalog.find(permission => permission.key === key)?.label || key);
  return (
    <div className="role-summary">
      {labels.slice(0, 3).map(label => <span key={label}>{label}</span>)}
      {labels.length > 3 && <span>+{labels.length - 3} more</span>}
      {labels.length === 0 && <span className="muted">No workspace tasks</span>}
    </div>
  );
}

function RoleEditor({
  catalog,
  draft,
  onCancel,
  onSave,
  saving,
}) {
  const [form, setForm] = useState(draft);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(catalog.map(permission => permission.workspace)));
  const assignable = catalog.filter(permission => !permission.systemOnly);
  const workspaces = Array.from(new Set(assignable.map(permission => permission.workspace)));

  useEffect(() => setForm(draft), [draft]);

  const selected = new Set(form.permissions);
  const normalizedSearch = search.trim().toLowerCase();
  const visiblePermissions = assignable.filter(permission => (
    !normalizedSearch
    || `${permission.label} ${permission.description} ${permission.workspace}`.toLowerCase().includes(normalizedSearch)
  ));

  const setPermissions = permissions => setForm(value => ({
    ...value,
    permissions: normalizePermissionKeys(permissions),
  }));

  const togglePermission = key => {
    const next = new Set(form.permissions);
    if (next.has(key)) {
      next.delete(key);
      for (const permission of assignable) {
        if (permission.requires?.includes(key)) next.delete(permission.key);
      }
    } else {
      for (const permission of expandPermissionDependencies([key])) next.add(permission);
    }
    setPermissions(Array.from(next));
  };

  const toggleWorkspace = workspace => {
    const keys = assignable.filter(permission => permission.workspace === workspace).map(permission => permission.key);
    const allSelected = keys.every(key => selected.has(key));
    const next = new Set(form.permissions);
    for (const key of keys) {
      if (allSelected) next.delete(key);
      else expandPermissionDependencies([key]).forEach(permission => next.add(permission));
    }
    setPermissions(Array.from(next));
  };

  const toggleExpanded = workspace => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(workspace)) next.delete(workspace);
      else next.add(workspace);
      return next;
    });
  };

  const sensitiveCount = form.permissions.filter(key => catalog.find(permission => permission.key === key)?.sensitive).length;

  return (
    <div className="role-editor-overlay" role="presentation">
      <section className="role-editor" role="dialog" aria-modal="true" aria-labelledby="role-editor-title">
        <header className="role-editor-header">
          <div>
            <span className="roles-eyebrow">{form.id ? 'Edit custom role' : 'Create custom role'}</span>
            <h2 id="role-editor-title">{form.id ? form.name : 'New role'}</h2>
            <p>Choose tasks in plain language. Required viewing permissions are selected automatically.</p>
          </div>
          <button type="button" className="roles-icon-button" onClick={onCancel} aria-label="Close role editor"><X size={20} /></button>
        </header>

        <div className="role-editor-body">
          <div className="role-fields">
            <label>
              <span>Role name</span>
              <input
                value={form.name}
                maxLength={80}
                placeholder="Example: Security Reviewer"
                onChange={event => setForm({ ...form, name: event.target.value })}
                autoFocus
              />
            </label>
            <label>
              <span>Description</span>
              <textarea
                value={form.description}
                maxLength={240}
                placeholder="Explain who should receive this role and what work it supports."
                onChange={event => setForm({ ...form, description: event.target.value })}
              />
            </label>
          </div>

          <div className="role-permission-toolbar">
            <label className="role-search">
              <Search size={17} />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tasks" />
            </label>
            <span>{form.permissions.length} selected</span>
          </div>

          <div className="role-workspaces">
            {workspaces.map(workspace => {
              const permissions = visiblePermissions.filter(permission => permission.workspace === workspace);
              if (permissions.length === 0) return null;
              const workspaceKeys = assignable.filter(permission => permission.workspace === workspace).map(permission => permission.key);
              const allSelected = workspaceKeys.every(key => selected.has(key));
              const isExpanded = expanded.has(workspace);
              return (
                <section className="role-workspace" key={workspace}>
                  <header>
                    <button type="button" className="role-workspace-title" onClick={() => toggleExpanded(workspace)}>
                      <ChevronDown size={17} className={isExpanded ? 'expanded' : ''} />
                      <strong>{workspace}</strong>
                      <span>{workspaceKeys.filter(key => selected.has(key)).length}/{workspaceKeys.length}</span>
                    </button>
                    <button type="button" className="role-select-all" onClick={() => toggleWorkspace(workspace)}>
                      {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  </header>
                  {isExpanded && (
                    <div className="role-permission-list">
                      {permissions.map(permission => {
                        const checked = selected.has(permission.key);
                        const requiredBy = assignable.filter(item => selected.has(item.key) && item.requires?.includes(permission.key));
                        return (
                          <label className={`role-permission ${checked ? 'selected' : ''}`} key={permission.key}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(permission.key)}
                            />
                            <span className="role-check">{checked && <Check size={14} />}</span>
                            <span className="role-permission-copy">
                              <strong>{permission.label}{permission.sensitive && <em>Sensitive</em>}</strong>
                              <small>{permission.description}</small>
                              {requiredBy.length > 0 && <small className="role-required">Required by {requiredBy.map(item => item.label).join(', ')}</small>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <aside className="role-effective-summary">
            <ShieldCheck size={20} />
            <div>
              <strong>This role can perform {form.permissions.length} task{form.permissions.length === 1 ? '' : 's'}</strong>
              <p>
                {form.permissions.length === 0
                  ? 'Users can sign in and view their profile, but cannot open a workspace.'
                  : form.permissions.slice(0, 4).map(key => catalog.find(permission => permission.key === key)?.label || key).join(', ')}
                {form.permissions.length > 4 ? `, and ${form.permissions.length - 4} more.` : '.'}
              </p>
            </div>
          </aside>

          {sensitiveCount > 0 && (
            <div className="roles-warning"><AlertTriangle size={18} /><span>This role includes {sensitiveCount} sensitive task{sensitiveCount === 1 ? '' : 's'}. Review them before saving.</span></div>
          )}
          {form.id && form.assignedUserCount > 0 && (
            <div className="roles-warning"><Users size={18} /><span>Saving will end sessions for {form.assignedUserCount} assigned user{form.assignedUserCount === 1 ? '' : 's'}.</span></div>
          )}
        </div>

        <footer className="role-editor-footer">
          <button type="button" className="roles-button secondary" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="roles-button primary"
            disabled={saving || form.name.trim().length < 2}
            onClick={() => onSave(form)}
          >
            {saving ? 'Saving…' : form.id ? 'Save role' : 'Create role'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function RolesAccessPage({ token, onUnauthorized }) {
  const request = useMemo(
    () => createAuthenticatedRequest({ token, onUnauthorized }),
    [onUnauthorized, token],
  );
  const [tab, setTab] = useState('roles');
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState(null);
  const [retiringRole, setRetiringRole] = useState(null);
  const [replacementRoleId, setReplacementRoleId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextRoles, nextCatalog, nextAudit] = await Promise.all([
        request('/roles'),
        request('/access/permissions'),
        request('/access/audit?limit=150'),
      ]);
      setRoles(requireApiCollection(nextRoles, { property: 'roles', label: 'Roles' }));
      setCatalog(requireApiCollection(nextCatalog, { property: 'permissions', label: 'Permissions' }));
      setAudit(requireApiCollection(nextAudit, { property: 'events', label: 'Access activity' }));
    } catch (loadError) {
      if (!isSessionExpiredError(loadError)) setError(loadError.message || 'Unable to load roles and access');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  const saveRole = async form => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await request(form.id ? `/roles/${encodeURIComponent(form.id)}` : '/roles', {
        method: form.id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          permissions: form.permissions,
        }),
      });
      setDraft(null);
      setMessage(form.id ? 'Role updated. Assigned users must sign in again.' : 'Role created.');
      await load();
    } catch (saveError) {
      if (!isSessionExpiredError(saveError)) setError(saveError.message || 'Unable to save role');
    } finally {
      setSaving(false);
    }
  };

  const retireRole = async () => {
    if (!retiringRole) return;
    setSaving(true);
    setError('');
    try {
      await request(`/roles/${encodeURIComponent(retiringRole.id)}/retire`, {
        method: 'POST',
        body: JSON.stringify({ replacementRoleId }),
      });
      setRetiringRole(null);
      setReplacementRoleId('');
      setMessage('Role retired and assigned users moved to the replacement role.');
      await load();
    } catch (retireError) {
      if (!isSessionExpiredError(retireError)) setError(retireError.message || 'Unable to retire role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="roles-page">
      <div className="roles-content">
        <section className="roles-hero">
          <div>
            <span className="roles-eyebrow">Administration</span>
            <h1>Make access easy to understand</h1>
            <p>Each user receives one role. The role controls tasks; product scope is selected separately on the user.</p>
          </div>
          <button type="button" className="roles-button primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}><Plus size={17} />Create role</button>
        </section>

        <nav className="roles-tabs" aria-label="Roles and access sections">
          <button type="button" className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}><ShieldCheck size={17} />Roles</button>
          <button type="button" className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><Activity size={17} />Activity</button>
        </nav>

        {error && <div className="roles-notice error" role="alert">{error}</div>}
        {message && <div className="roles-notice success" role="status">{message}</div>}

        {loading ? <div className="roles-loading">Loading access configuration…</div> : tab === 'roles' ? (
          <div className="roles-grid">
            {roles.map(role => (
              <article className={`role-card ${role.system ? 'system' : ''}`} key={role.id}>
                <header>
                  <div className="role-card-icon">{role.system ? <LockKeyhole size={20} /> : <KeyRound size={20} />}</div>
                  <div>
                    <div className="role-card-title">
                      <h2>{role.name}</h2>
                      {role.system && <span>Protected</span>}
                    </div>
                    <p>{role.description || 'No description provided.'}</p>
                  </div>
                </header>
                <RoleSummary role={role} catalog={catalog} />
                <footer>
                  <span><Users size={15} />{role.assignedUserCount} user{role.assignedUserCount === 1 ? '' : 's'}</span>
                  <div>
                    {!role.system && <button type="button" title="Duplicate role" onClick={() => setDraft({
                      ...EMPTY_DRAFT,
                      name: `${role.name} copy`,
                      description: role.description,
                      permissions: [...role.permissions],
                    })}><Copy size={16} /></button>}
                    <button
                      type="button"
                      title={role.system ? 'View protected role' : 'Edit role'}
                      onClick={() => role.system ? setDraft(null) : setDraft({ ...role, permissions: [...role.permissions] })}
                      disabled={role.system}
                    ><Pencil size={16} /></button>
                    {!role.system && <button type="button" className="danger" title="Retire role" onClick={() => {
                      setRetiringRole(role);
                      setReplacementRoleId('');
                    }}><Trash2 size={16} /></button>}
                  </div>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <section className="access-activity">
            <header><div><h2>Access activity</h2><p>Role and user-access changes from the central audit log.</p></div></header>
            {audit.length === 0 ? <div className="roles-empty">No access changes have been recorded.</div> : (
              <div className="activity-list">
                {audit.map(event => (
                  <article key={event.id}>
                    <span className="activity-icon"><Activity size={16} /></span>
                    <div>
                      <strong>{describeAuditAction(event)}</strong>
                      <p><b>{event.actorUsername || 'System'}</b>{event.targetUsername ? ` changed ${event.targetUsername}` : ''}</p>
                      {event.metadata?.before && event.metadata?.after && (
                        <small>
                          {event.metadata.before.roleName || event.metadata.before.name || 'Previous access'}
                          {' → '}
                          {event.metadata.after.roleName || event.metadata.after.name || event.metadata.roleName || 'Updated access'}
                        </small>
                      )}
                    </div>
                    <time>{formatDate(event.createdAt)}</time>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {draft && <RoleEditor catalog={catalog} draft={draft} onCancel={() => setDraft(null)} onSave={saveRole} saving={saving} />}

      {retiringRole && (
        <div className="role-editor-overlay" role="presentation">
          <section className="retire-dialog" role="alertdialog" aria-modal="true" aria-labelledby="retire-title">
            <div className="role-card-icon danger"><Trash2 size={20} /></div>
            <h2 id="retire-title">Retire {retiringRole.name}?</h2>
            <p>{retiringRole.assignedUserCount > 0
              ? `${retiringRole.assignedUserCount} assigned user${retiringRole.assignedUserCount === 1 ? '' : 's'} must move to another role. Their sessions will end immediately.`
              : 'This role has no assigned users and can be safely retired.'}</p>
            {retiringRole.assignedUserCount > 0 && (
              <label>
                <span>Replacement role</span>
                <select value={replacementRoleId} onChange={event => setReplacementRoleId(event.target.value)}>
                  <option value="">Choose a role</option>
                  {roles.filter(role => role.id !== retiringRole.id).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}
                </select>
              </label>
            )}
            <footer>
              <button type="button" className="roles-button secondary" onClick={() => setRetiringRole(null)}>Cancel</button>
              <button
                type="button"
                className="roles-button danger"
                disabled={saving || (retiringRole.assignedUserCount > 0 && !replacementRoleId)}
                onClick={retireRole}
              >{saving ? 'Retiring…' : 'Retire role'}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
