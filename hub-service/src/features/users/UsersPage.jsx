import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  KeyRound,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  DataTable,
  DataTableCell,
  DataTablePagination,
  DataTableRow,
  DataTableSection,
} from '../../shared/ui/DataTable/DataTable.jsx';
import {
  Filter as FilterIcon,
  SearchOptionsCommandBar,
  SearchOptionsPanel,
  SearchOptionsResultCount,
  SearchOptionsSearch,
} from '../../shared/ui/SearchOptions/SearchOptions.jsx';
import './UsersPage.css';

const EMPTY_USER = {
  username: '',
  email: '',
  password: '',
  role: 'viewer',
  products: '',
  status: 'active',
};

const PAGE_SIZE_OPTIONS = [10, 20, 30,40, 50];

const TABLE_COLUMNS = [
  { key: 'user', label: 'User', className: 'cell-name' },
  { key: 'email', label: 'Email', className: 'cell-email' },
  { key: 'role', label: 'Role', className: 'cell-role' },
  { key: 'presence', label: 'Presence', className: 'cell-presence' },
  { key: 'account', label: 'Account', className: 'cell-account' },
  { key: 'access', label: 'Access', className: 'cell-access' },
  { key: 'lastLogin', label: 'Last Login', className: 'cell-date' },
  { key: 'actions', label: 'Actions', className: 'cell-actions' },
];

const ROLE_OPTIONS = [
  { value: 'all', label: 'All roles' },
  { value: 'admin', label: 'Admin' },
  { value: 'viewer', label: 'Viewer' },
];

const PRESENCE_OPTIONS = [
  { value: 'all', label: 'All presence' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'suspended', label: 'Suspended' },
];

const ACCOUNT_OPTIONS = [
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const ACCESS_OPTIONS = [
  { value: 'all', label: 'All access' },
  { value: 'unrestricted', label: 'All products' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'none', label: 'No products' },
];

const normalize = (value) => String(value || '').trim().toLowerCase();

const parseProducts = (value) => (
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
);

const formatDate = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatLabel = (value) => {
  const text = String(value || '').replace(/[-_]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const getAccountStatus = (user) => normalize(user.accountStatus || user.status || 'active') || 'active';

const getPresenceStatus = (user) => {
  const accountStatus = getAccountStatus(user);
  if (accountStatus === 'suspended') return 'suspended';

  const presenceStatus = normalize(user.presenceStatus || user.status || 'offline');
  if (presenceStatus === 'online' || presenceStatus === 'offline') return presenceStatus;
  return 'offline';
};

const getUserProducts = (user) => Array.isArray(user.products) ? user.products : [];

const getAccessStatus = (user) => {
  if (normalize(user.role) === 'admin') return 'unrestricted';
  return getUserProducts(user).length > 0 ? 'restricted' : 'none';
};

const getAccessSummary = (user) => {
  const products = getUserProducts(user);
  const accessStatus = getAccessStatus(user);

  if (accessStatus === 'unrestricted') {
    return {
      title: 'All products',
      details: 'Admin access',
    };
  }

  if (accessStatus === 'restricted') {
    const visibleProducts = products.slice(0, 3).join(', ');
    const extraCount = products.length > 3 ? ` +${products.length - 3}` : '';
    return {
      title: `${products.length} product${products.length === 1 ? '' : 's'}`,
      details: `${visibleProducts}${extraCount}`,
    };
  }

  return {
    title: 'No products',
    details: 'No app access',
  };
};

const getRowTone = (user) => {
  const presence = getPresenceStatus(user);
  if (presence === 'suspended') return 'critical';
  if (presence === 'online') return 'low';
  return 'mapped';
};

export default function UsersPage({ token, currentUser, onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState('create');
  const [draftUser, setDraftUser] = useState(EMPTY_USER);
  const [searchOpen, setSearchOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [presenceFilter, setPresenceFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...authHeaders,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }, [authHeaders]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await request('/users'));
    } catch (err) {
      setError(err.message || 'Unable to load users');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (token) loadUsers();
  }, [loadUsers, token]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, roleFilter, presenceFilter, accountFilter, accessFilter, pageSize]);

  const filteredUsers = useMemo(() => {
    const query = normalize(searchTerm);

    return users.filter((user) => {
      const role = normalize(user.role || 'viewer');
      const presence = getPresenceStatus(user);
      const accountStatus = getAccountStatus(user);
      const accessStatus = getAccessStatus(user);
      const products = getUserProducts(user);
      const accessSummary = getAccessSummary(user);
      const searchableText = [
        user.username,
        user.email,
        role,
        presence,
        accountStatus,
        accessStatus,
        accessSummary.title,
        accessSummary.details,
        products.join(' '),
        formatDate(user.lastLoginAt),
      ].join(' ').toLowerCase();

      if (query && !searchableText.includes(query)) return false;
      if (roleFilter !== 'all' && role !== roleFilter) return false;
      if (presenceFilter !== 'all' && presence !== presenceFilter) return false;
      if (accountFilter !== 'all' && accountStatus !== accountFilter) return false;
      if (accessFilter !== 'all' && accessStatus !== accessFilter) return false;
      return true;
    });
  }, [accessFilter, accountFilter, presenceFilter, roleFilter, searchTerm, users]);

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize));

  useEffect(() => {
    setCurrentPage(page => Math.min(page, pageCount));
  }, [pageCount]);

  const pagedUsers = useMemo(() => {
    const firstIndex = (currentPage - 1) * pageSize;
    return filteredUsers.slice(firstIndex, firstIndex + pageSize);
  }, [currentPage, filteredUsers, pageSize]);

  const firstResult = filteredUsers.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1;
  const lastResult = Math.min(currentPage * pageSize, filteredUsers.length);

  function openCreate() {
    setDraftUser({ ...EMPTY_USER });
    setEditorMode('create');
    setEditorOpen(true);
  }

  function openEdit(user) {
    setDraftUser({
      username: user.username,
      email: user.email || '',
      password: '',
      role: user.role || 'viewer',
      products: getUserProducts(user).join(', '),
      status: user.accountStatus || 'active',
    });
    setEditorMode('edit');
    setEditorOpen(true);
  }

  function openReset(user) {
    openEdit(user);
    setEditorMode('reset');
  }

  async function saveUser(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await request('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: draftUser.username.trim(),
          email: draftUser.email.trim(),
          password: draftUser.password,
          role: draftUser.role,
          products: parseProducts(draftUser.products),
          status: draftUser.status,
        }),
      });
      setEditorOpen(false);
      setDraftUser({ ...EMPTY_USER });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to save user');
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(username) {
    if (!confirm(`Delete user ${username}?`)) return;
    setError('');
    try {
      await request(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to delete user');
    }
  }

  return (
    <div className="users-page">
      <div className="users-container">
        <button className="btn-back" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Back to Hub</span>
        </button>

        <section className="users-card">
          <div className="users-header">
            <div>
              <div className="users-title-row">
                <Users size={22} />
                <h1 className="users-heading">User Management</h1>
              </div>
              <p className="users-subtitle">Hub identities, role scope, and product access.</p>
            </div>
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus size={16} />
              <span>Add User</span>
            </button>
          </div>

          {error && <div className="users-error" role="alert">{error}</div>}

          <div className="users-tools">
            <SearchOptionsPanel
              bodyId="users-search-options"
              icon={FilterIcon}
              open={searchOpen}
              onToggle={() => setSearchOpen(open => !open)}
              title="Search Options"
            >
              <SearchOptionsCommandBar>
                <SearchOptionsSearch
                  kbd="/"
                  label="Search users"
                  onChange={setSearchTerm}
                  onClear={() => setSearchTerm('')}
                  placeholder="Search username, email, role, status, product"
                  showClear={Boolean(searchTerm)}
                  value={searchTerm}
                />
                <label className="users-role-filter">
                  <span className="sr-only">Role filter</span>
                  <select
                    value={roleFilter}
                    onChange={event => setRoleFilter(event.target.value)}
                    aria-label="Role filter"
                  >
                    {ROLE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="users-filter-select">
                  <span className="sr-only">Presence filter</span>
                  <select
                    value={presenceFilter}
                    onChange={event => setPresenceFilter(event.target.value)}
                    aria-label="Presence filter"
                  >
                    {PRESENCE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="users-filter-select">
                  <span className="sr-only">Account filter</span>
                  <select
                    value={accountFilter}
                    onChange={event => setAccountFilter(event.target.value)}
                    aria-label="Account filter"
                  >
                    {ACCOUNT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="users-filter-select">
                  <span className="sr-only">Access filter</span>
                  <select
                    value={accessFilter}
                    onChange={event => setAccessFilter(event.target.value)}
                    aria-label="Access filter"
                  >
                    {ACCESS_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <SearchOptionsResultCount icon={Users} value={filteredUsers.length} label="users" />
              </SearchOptionsCommandBar>
            </SearchOptionsPanel>
          </div>

          <DataTableSection ariaLabel="Hub users" className="users-table-section" panelClassName="users-table-panel">
            <DataTable
              ariaLabel="Hub users"
              className="users-data-table"
              columns={TABLE_COLUMNS}
              empty={(
                <div className="users-empty-row" role="row">
                  <div className="users-empty-cell" role="cell">
                    {users.length === 0 ? 'No users found.' : 'No users match the current filters.'}
                  </div>
                </div>
              )}
              footer={(
                <DataTablePagination
                  currentPage={currentPage}
                  firstResult={firstResult}
                  itemLabel="user"
                  lastResult={lastResult}
                  onNextPage={() => setCurrentPage(page => Math.min(page + 1, pageCount))}
                  onPageSizeChange={setPageSize}
                  onPreviousPage={() => setCurrentPage(page => Math.max(page - 1, 1))}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  totalRows={filteredUsers.length}
                />
              )}
              gridTemplate="minmax(180px, 1.2fr) minmax(190px, 1fr) 96px 118px 116px minmax(190px, 1.1fr) 156px 124px"
              loading={loading}
              minWidth="1180px"
            >
              {pagedUsers.map((user) => {
                const role = normalize(user.role || 'viewer');
                const presence = getPresenceStatus(user);
                const accountStatus = getAccountStatus(user);
                const accessStatus = getAccessStatus(user);
                const accessSummary = getAccessSummary(user);
                const email = user.email || 'No email';

                return (
                  <DataTableRow key={user.username} tone={getRowTone(user)} ariaLabel={`User ${user.username}`}>
                    <DataTableCell className="cell-name users-user-cell" label="User">
                      <strong className="cell-name-title">{user.username}</strong>
                      <span className="cell-name-subtitle">
                        {user.username === currentUser?.username ? 'Current session' : 'Hub identity'}
                      </span>
                    </DataTableCell>
                    <DataTableCell className="cell-email users-muted-cell" label="Email" title={email}>
                      {email}
                    </DataTableCell>
                    <DataTableCell className="cell-role" label="Role">
                      <span className={`role-chip ${role}`}>{formatLabel(role)}</span>
                    </DataTableCell>
                    <DataTableCell className="cell-presence" label="Presence">
                      <span className={`presence-badge ${presence}`}>{formatLabel(presence)}</span>
                    </DataTableCell>
                    <DataTableCell className="cell-account" label="Account">
                      <span className={`account-badge ${accountStatus}`}>{formatLabel(accountStatus)}</span>
                    </DataTableCell>
                    <DataTableCell className="cell-access users-access-cell" label="Access" title={accessSummary.details}>
                      <strong>{accessSummary.title}</strong>
                      <span className={`access-detail ${accessStatus}`}>{accessSummary.details}</span>
                    </DataTableCell>
                    <DataTableCell className="cell-date users-muted-cell" label="Last Login" title={formatDate(user.lastLoginAt)}>
                      {formatDate(user.lastLoginAt)}
                    </DataTableCell>
                    <DataTableCell className="cell-actions users-actions-cell" label="Actions">
                      <div className="row-actions">
                        <button type="button" className="icon-btn" onClick={() => openEdit(user)} title="Edit user" aria-label={`Edit ${user.username}`}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => openReset(user)} title="Reset password" aria-label={`Reset password for ${user.username}`}>
                          <KeyRound size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => deleteUser(user.username)}
                          disabled={user.username === currentUser?.username}
                          title="Delete user"
                          aria-label={`Delete ${user.username}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTable>
          </DataTableSection>
        </section>

        {editorOpen && (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditorOpen(false)}>
            <section className="user-modal" role="dialog" aria-modal="true" aria-labelledby="user-editor-title" onMouseDown={event => event.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2 id="user-editor-title">
                    {editorMode === 'create' ? 'Add User' : editorMode === 'reset' ? `Reset Password: ${draftUser.username}` : `Edit User: ${draftUser.username}`}
                  </h2>
                  <p>{editorMode === 'reset' ? 'Set a new password without changing app access.' : 'Manage Hub identity and DefectDojo access.'}</p>
                </div>
                <button type="button" className="icon-btn" onClick={() => setEditorOpen(false)} aria-label="Close user editor">
                  <X size={16} />
                </button>
              </div>

              <form className="user-form" onSubmit={saveUser}>
                <label>
                  <span>Username</span>
                  <input
                    value={draftUser.username}
                    onChange={event => setDraftUser({ ...draftUser, username: event.target.value })}
                    disabled={editorMode !== 'create'}
                    required
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={draftUser.email}
                    onChange={event => setDraftUser({ ...draftUser, email: event.target.value })}
                    disabled={editorMode === 'reset'}
                  />
                </label>
                <label>
                  <span>{editorMode === 'create' ? 'Password' : editorMode === 'reset' ? 'New password' : 'Password (leave blank to keep)'}</span>
                  <input
                    type="password"
                    value={draftUser.password}
                    onChange={event => setDraftUser({ ...draftUser, password: event.target.value })}
                    required={editorMode === 'create' || editorMode === 'reset'}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    <span>Role</span>
                    <select
                      value={draftUser.role}
                      onChange={event => setDraftUser({ ...draftUser, role: event.target.value })}
                      disabled={editorMode === 'reset'}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  <label>
                    <span>Status</span>
                    <select
                      value={draftUser.status}
                      onChange={event => setDraftUser({ ...draftUser, status: event.target.value })}
                      disabled={editorMode === 'reset'}
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>Allowed Products</span>
                  <input
                    value={draftUser.products}
                    onChange={event => setDraftUser({ ...draftUser, products: event.target.value })}
                    disabled={editorMode === 'reset' || draftUser.role === 'admin'}
                    placeholder="Product A, Product B"
                  />
                </label>
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setEditorOpen(false)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    <Save size={16} />
                    <span>{saving ? 'Saving...' : 'Save User'}</span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
