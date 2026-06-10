import { useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Save, Shield, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../../shared/api/api';
import { DataTable, DataTableCell, DataTablePagination, DataTableRow, DataTableSection } from '../../../shared/ui/DataTable/DataTable';
import {
  SearchOptionsCommandBar,
  SearchOptionsPanel,
  SearchOptionsResultCount,
  SearchOptionsSearch,
} from '../../../shared/ui/SearchOptions/SearchOptions';
import './UserManagement.css';

const USER_PAGE_SIZE_OPTIONS = [10, 25, 50];
const USER_STATUS_OPTIONS = ['online', 'offline', 'suspended'];
const USER_ACCOUNT_STATUS_OPTIONS = ['active', 'suspended'];

const normalizeUserText = (value) => String(value || '').trim();

const getUserStatus = (user = {}) => normalizeUserText(user.status || user.presenceStatus || 'offline').toLowerCase() || 'offline';

const getUserEmail = (user = {}) => normalizeUserText(user.email);

const getUserLastLogin = (user = {}) => normalizeUserText(user.lastLoginAt);

const formatUserStatus = (status = '') => (
  normalizeUserText(status)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
);

const formatUserLastLogin = (value = '') => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

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
    user.accountStatus,
    getUserAccessType(user),
    formatUserLastLogin(getUserLastLogin(user)),
    ...(user.products || []),
  ].join(' ').toLowerCase();
  return tokens.every(token => haystack.includes(token));
};

const UserManagement = ({ user }) => {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', role: 'viewer', products: '', status: 'active' });
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accessFilter, setAccessFilter] = useState('all');
  const [userSort, setUserSort] = useState({ field: 'username', direction: 'asc' });
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);
  const [userEditorOpen, setUserEditorOpen] = useState(false);
  const [userEditorMode, setUserEditorMode] = useState('create');
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);

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
    if (user?.role === 'admin') {
      queueMicrotask(fetchUsers);
    }
  }, [user]);

  const toggleUserSort = (field) => {
    setUserSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortIndicator = (field) => (
    userSort.field === field ? (userSort.direction === 'asc' ? '↑' : '↓') : ''
  );

  const openCreateUserModal = () => {
    setNewUser({ username: '', email: '', password: '', role: 'viewer', products: '', status: 'active' });
    setUserEditorMode('create');
    setUserEditorOpen(true);
  };

  const handleEditUser = (targetUser) => {
    setNewUser({
      username: targetUser.username,
      email: getUserEmail(targetUser),
      password: '',
      role: targetUser.role || 'viewer',
      products: (targetUser.products || []).join(', '),
      status: targetUser.accountStatus || 'active',
    });
    setUserEditorMode('edit');
    setUserEditorOpen(true);
  };

  const handleResetPassword = (targetUser) => {
    setNewUser({
      username: targetUser.username,
      email: getUserEmail(targetUser),
      password: '',
      role: targetUser.role || 'viewer',
      products: (targetUser.products || []).join(', '),
      status: targetUser.accountStatus || 'active',
    });
    setUserEditorMode('reset');
    setUserEditorOpen(true);
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
        email: newUser.email,
        password: newUser.password,
        role: newUser.role,
        products: newUser.products.split(',').map(p => p.trim()).filter(Boolean),
        status: newUser.status,
      };
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setNewUser({ username: '', email: '', password: '', role: 'viewer', products: '', status: 'active' });
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

  const columns = [
    {
      key: 'username',
      label: (
        <button type="button" className="sortable-header" onClick={() => toggleUserSort('username')}>
          Name / User ID <span className="sort-indicator">{sortIndicator('username')}</span>
        </button>
      ),
    },
    'Email',
    {
      key: 'role',
      label: (
        <button type="button" className="sortable-header" onClick={() => toggleUserSort('role')}>
          Role <span className="sort-indicator">{sortIndicator('role')}</span>
        </button>
      ),
    },
    {
      key: 'status',
      label: (
        <button type="button" className="sortable-header" onClick={() => toggleUserSort('status')}>
          Status <span className="sort-indicator">{sortIndicator('status')}</span>
        </button>
      ),
    },
    {
      key: 'access',
      label: (
        <button type="button" className="sortable-header" onClick={() => toggleUserSort('access')}>
          Department / Access <span className="sort-indicator">{sortIndicator('access')}</span>
        </button>
      ),
    },
    {
      key: 'lastLogin',
      label: (
        <button type="button" className="sortable-header" onClick={() => toggleUserSort('lastLogin')}>
          Last Login <span className="sort-indicator">{sortIndicator('lastLogin')}</span>
        </button>
      ),
    },
    { label: 'Actions', className: 'user-actions-head' },
  ];

  const USER_TABLE_GRID = 'minmax(140px, 1.2fr) minmax(130px, 1fr) 96px 100px minmax(170px, 1.5fr) 130px 128px';

  const resultCountText = searchQuery || roleFilter !== 'all' || statusFilter !== 'all' || accessFilter !== 'all'
    ? `${filteredUsers.length} of ${users.length}`
    : `${filteredUsers.length}`;

  const firstResult = filteredUsers.length === 0 ? 0 : (safeUserPage - 1) * userPageSize + 1;
  const lastResult = Math.min(filteredUsers.length, safeUserPage * userPageSize);

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
    <div className="user-management-layout">
      <section className="config-section user-directory-panel">
        <div className="user-directory-header">
          <div>
            <h3>User Directory</h3>
          </div>
          <button type="button" className="btn-primary" onClick={openCreateUserModal}>
            <Plus size={16} /> Add User
          </button>
        </div>

        <SearchOptionsPanel
          bodyId="user-filter-body"
          open={filterPanelOpen}
          onToggle={() => setFilterPanelOpen(open => !open)}
        >
          <SearchOptionsCommandBar className="user-search-command-bar">
            <SearchOptionsSearch
              label="Search users"
              value={searchQuery}
              onChange={(value) => {
                setUserPage(1);
                setSearchQuery(value);
              }}
              onClear={() => {
                setUserPage(1);
                setSearchQuery('');
              }}
              placeholder="Search username, role, products..."
              showClear={Boolean(searchQuery)}
            />

            <label className="user-filter">
              <span>Role</span>
              <select value={roleFilter} onChange={(e) => { setUserPage(1); setRoleFilter(e.target.value); }}>
                <option value="all">All roles</option>
                {userRoles.map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </label>

            <label className="user-filter">
              <span>Status</span>
              <select value={statusFilter} onChange={(e) => { setUserPage(1); setStatusFilter(e.target.value); }}>
                <option value="all">All statuses</option>
                {USER_STATUS_OPTIONS.map(status => (
                  <option key={status} value={status}>{formatUserStatus(status)}</option>
                ))}
              </select>
            </label>

            <label className="user-filter">
              <span>Access</span>
              <select value={accessFilter} onChange={(e) => { setUserPage(1); setAccessFilter(e.target.value); }}>
                <option value="all">All access</option>
                <option value="unrestricted">Unrestricted</option>
                <option value="restricted">Restricted</option>
                <option value="none">No products</option>
              </select>
            </label>

            <SearchOptionsResultCount
              value={resultCountText}
              label={`user${filteredUsers.length !== 1 ? 's' : ''}`}
            />
          </SearchOptionsCommandBar>
        </SearchOptionsPanel>

        {loadingUsers ? (
          <p className="field-hint user-loading">Loading users...</p>
        ) : (
          <DataTableSection
            ariaLabel="User directory workspace"
            className="user-directory-container"
            panelClassName="user-list-panel"
          >
            <DataTable
              ariaLabel="User directory"
              className="user-data-table"
              columns={columns}
              gridTemplate={USER_TABLE_GRID}
              minWidth="960px"
              empty={
                <div className="user-empty-state" role="status">
                  No users match the current search and filters.
                </div>
              }
              footer={filteredUsers.length > 0 && (
                <DataTablePagination
                  ariaLabel="User pagination"
                  currentPage={safeUserPage}
                  firstResult={firstResult}
                  lastResult={lastResult}
                  itemLabel="user"
                  onNextPage={() => setUserPage(Math.min(userPageCount, safeUserPage + 1))}
                  onPageSizeChange={(nextPageSize) => {
                    setUserPageSize(nextPageSize);
                    setUserPage(1);
                  }}
                  onPreviousPage={() => setUserPage(Math.max(1, safeUserPage - 1))}
                  pageCount={userPageCount}
                  pageSize={userPageSize}
                  pageSizeOptions={USER_PAGE_SIZE_OPTIONS}
                  totalRows={filteredUsers.length}
                />
              )}
            >
              {pagedUsers.map(u => {
                const status = getUserStatus(u);
                const accessType = getUserAccessType(u);
                const lastLoginAt = getUserLastLogin(u);
                return (
                  <DataTableRow key={u.username} className="user-table-row">
                    <DataTableCell className="cell-name" label="Name / User ID">
                      <div className="user-identity-cell">
                        <strong>{u.username}</strong>
                        <span>User ID: {u.username}</span>
                      </div>
                    </DataTableCell>
                    <DataTableCell className="muted-cell cell-email" label="Email">
                      {getUserEmail(u) || 'No email'}
                    </DataTableCell>
                    <DataTableCell className="cell-role" label="Role">
                      <span className={`role-badge ${u.role}`}>{u.role}</span>
                    </DataTableCell>
                    <DataTableCell className="cell-status" label="Status">
                      <span className={`status-badge ${status}`}>{formatUserStatus(status)}</span>
                    </DataTableCell>
                    <DataTableCell className="cell-access" label="Department / Access">
                      <div className="user-access-cell">
                        <strong>{accessType === 'unrestricted' ? 'All products' : accessType === 'restricted' ? 'Restricted products' : 'No product access'}</strong>
                        <span>{u.role === 'viewer' ? ((u.products || []).join(', ') || 'None') : 'Full access'}</span>
                      </div>
                    </DataTableCell>
                    <DataTableCell className="muted-cell cell-last-login" label="Last Login">
                      {formatUserLastLogin(lastLoginAt)}
                    </DataTableCell>
                    <DataTableCell className="user-actions-cell" label="Actions">
                      <div className="user-row-actions">
                        <button
                          type="button"
                          className="icon-btn user-row-action"
                          onClick={() => handleEditUser(u)}
                          aria-label={`Edit ${u.username}`}
                          title="Edit user"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn user-row-action"
                          onClick={() => handleResetPassword(u)}
                          aria-label={`Reset password for ${u.username}`}
                          title="Reset password"
                        >
                          <KeyRound size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn user-row-action danger"
                          onClick={() => handleDeleteUser(u.username)}
                          aria-label={`Delete ${u.username}`}
                          title="Delete user"
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
        )}
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
                <label htmlFor="user-email">Email</label>
                <input
                  id="user-email"
                  type="email"
                  value={newUser.email}
                  onChange={e => setNewUser({...newUser, email: e.target.value})}
                  placeholder="name@example.com"
                  disabled={userEditorMode === 'reset'}
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
              <div className="form-group">
                <label htmlFor="user-status">Status</label>
                <select
                  id="user-status"
                  value={newUser.status}
                  onChange={e => setNewUser({...newUser, status: e.target.value})}
                  disabled={userEditorMode === 'reset'}
                >
                  {USER_ACCOUNT_STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{formatUserStatus(status)}</option>
                  ))}
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
  );
};

export default UserManagement;
