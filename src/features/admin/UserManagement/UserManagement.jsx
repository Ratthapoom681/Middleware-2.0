import { useEffect, useRef, useState } from 'react';
import { KeyRound, MoreVertical, Pencil, Plus, Save, Search, Shield, Trash2, UserX, X } from 'lucide-react';
import { apiFetch } from '../../../shared/api/api';
import './UserManagement.css';

const USER_PAGE_SIZE_OPTIONS = [10, 25, 50];
const USER_STATUS_OPTIONS = ['active', 'suspended', 'pending'];

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
    ...(user.products || []),
  ].join(' ').toLowerCase();
  return tokens.every(token => haystack.includes(token));
};

const UserManagement = ({ user }) => {
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
    if (user?.role === 'admin') {
      queueMicrotask(fetchUsers);
    }
  }, [user]);

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
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
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
      products: (targetUser.products || []).join(', '),
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
      products: (targetUser.products || []).join(', '),
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
        products: newUser.products.split(',').map(p => p.trim()).filter(Boolean),
      };
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(payload),
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
  );
};

export default UserManagement;
