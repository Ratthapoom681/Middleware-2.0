import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  KeyRound,
  MailCheck,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldOff,
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
import { formatBangkokIntl } from '../../shared/time.js';
import './UsersPage.css';

const EMPTY_USER = {
  username: '',
  fullName: '',
  email: '',
  company: '',
  department: '',
  password: '',
  role: 'viewer',
  products: '',
  status: 'active',
  mfaMode: 'disabled',
};

const PAGE_SIZE_OPTIONS = [10, 20, 30,40, 50];

const TABLE_COLUMNS = [
  { key: 'user', label: 'User', className: 'cell-name' },
  { key: 'email', label: 'Email', className: 'cell-email' },
  { key: 'role', label: 'Role', className: 'cell-role' },
  { key: 'presence', label: 'Presence', className: 'cell-presence' },
  { key: 'account', label: 'Account', className: 'cell-account' },
  { key: 'mfa', label: 'MFA', className: 'cell-mfa' },
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
  return formatBangkokIntl(date, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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

const getMfaStatus = (user) => {
  const status = normalize(user?.mfa?.status || user?.mfaStatus);
  if (['disabled', 'pending', 'enabled'].includes(status)) return status;
  if (user?.mfa?.enabled || user?.mfaEnabled) return 'enabled';
  return normalize(user?.mfa?.mode || user?.mfaMode) === 'authenticator' ? 'pending' : 'disabled';
};

const getMfaMode = (user) => getMfaStatus(user) === 'disabled' ? 'disabled' : 'authenticator';

const getNotificationStatus = user => normalize(user?.mfa?.notificationStatus || user?.mfa?.notification?.status || user?.mfaNotificationStatus || user?.mfaNotification?.status);

function useDialogFocus(open, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const root = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]'));
    const initial = root.querySelector('[autofocus]') || focusable()[0];
    initial?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      requestAnimationFrame(() => previous?.focus());
    };
  }, [open]);
  return dialogRef;
}

export default function UsersPage({ token, currentUser, onBack, onSessionEnded, onUserUpdated }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
  const [securityAction, setSecurityAction] = useState(null);
  const [securityDraft, setSecurityDraft] = useState({ adminPassword: '', reason: '', confirmation: '' });
  const [passwordResetUser, setPasswordResetUser] = useState(null);
  const [passwordDraft, setPasswordDraft] = useState({ newPassword: '', confirmationPassword: '', adminPassword: '', reason: '' });
  const editorDialogRef = useDialogFocus(editorOpen && !securityAction, () => setEditorOpen(false));
  const passwordDialogRef = useDialogFocus(Boolean(passwordResetUser), () => setPasswordResetUser(null));
  const securityDialogRef = useDialogFocus(Boolean(securityAction), () => setSecurityAction(null));

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
        user.fullName,
        user.email,
        user.company,
        user.department,
        role,
        presence,
        accountStatus,
        `mfa ${getMfaStatus(user)}`,
        getNotificationStatus(user),
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
      fullName: user.fullName || '',
      email: user.email || '',
      company: user.company || '',
      department: user.department || '',
      password: '',
      role: user.role || 'viewer',
      products: getUserProducts(user).join(', '),
      status: user.accountStatus || 'active',
      mfaMode: getMfaMode(user),
    });
    setEditorMode('edit');
    setEditorOpen(true);
  }

  function openReset(user) {
    setPasswordResetUser(user);
    setPasswordDraft({ newPassword: '', confirmationPassword: '', adminPassword: '', reason: '' });
    setError('');
  }

  const userPayload = (includeSecurity = false) => ({
    username: draftUser.username.trim(),
    fullName: draftUser.fullName.trim(),
    email: draftUser.email.trim(),
    company: draftUser.company.trim(),
    department: draftUser.department.trim(),
    ...(editorMode === 'create' ? {
      password: draftUser.password,
      mfaMode: draftUser.mfaMode,
    } : {}),
    role: draftUser.role,
    products: parseProducts(draftUser.products),
    status: draftUser.status,
    ...(includeSecurity ? {
      adminPassword: securityDraft.adminPassword,
      reason: securityDraft.reason.trim(),
    } : {}),
  });

  const openSecurityAction = (type, user, mfaMode = getMfaMode(user)) => {
    setSecurityAction({ type, user, mfaMode });
    setSecurityDraft({ adminPassword: '', reason: '', confirmation: '' });
    setError('');
    setNotice('');
  };

  async function saveUser(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (draftUser.mfaMode === 'authenticator' && !draftUser.email.trim()) {
      setError('A valid email address is required for Authenticator MFA.');
      return;
    }
    const existingUser = users.find(user => user.username === draftUser.username);
    if (editorMode === 'create' && draftUser.mfaMode === 'authenticator') {
      openSecurityAction('create', { username: draftUser.username.trim() }, 'authenticator');
      return;
    }
    if (editorMode === 'edit' && existingUser && getMfaMode(existingUser) !== draftUser.mfaMode) {
      openSecurityAction('change', existingUser, draftUser.mfaMode);
      return;
    }
    setSaving(true);
    try {
      const data = await request('/users', {
        method: 'POST',
        body: JSON.stringify(userPayload()),
      });
      if (data?.user?.username === currentUser?.username) onUserUpdated?.(data.user);
      setEditorOpen(false);
      setDraftUser({ ...EMPTY_USER });
      setNotice(editorMode === 'create' ? 'User created.' : 'User details updated.');
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

  async function submitPasswordReset(event) {
    event.preventDefault();
    if (!passwordResetUser) return;
    setError(''); setNotice('');
    if (passwordDraft.newPassword !== passwordDraft.confirmationPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (passwordDraft.newPassword.length < 12 || passwordDraft.newPassword.length > 128) {
      setError('New password must contain 12–128 characters.');
      return;
    }
    setSaving(true);
    try {
      const data = await request(`/users/${encodeURIComponent(passwordResetUser.username)}/password`, {
        method: 'PATCH',
        body: JSON.stringify({
          newPassword: passwordDraft.newPassword,
          adminPassword: passwordDraft.adminPassword,
          reason: passwordDraft.reason.trim(),
        }),
      });
      setPasswordResetUser(null);
      setPasswordDraft({ newPassword: '', confirmationPassword: '', adminPassword: '', reason: '' });
      if (data?.sessionEnded) {
        onSessionEnded?.('password-changed');
        return;
      }
      setNotice('Password reset. The user must sign in again.');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to reset password');
    } finally {
      setSaving(false);
    }
  }

  async function submitSecurityAction(event) {
    event.preventDefault();
    if (!securityAction) return;
    const { type, user, mfaMode } = securityAction;
    if (['reset', 'disable'].includes(type) && securityDraft.confirmation !== user.username) return;
    setSaving(true); setError(''); setNotice('');
    try {
      let data;
      if (type === 'create') {
        data = await request('/users', { method: 'POST', body: JSON.stringify(userPayload(true)) });
        setEditorOpen(false);
        setDraftUser({ ...EMPTY_USER });
      } else {
        if (type === 'change') {
          const identity = await request('/users', { method: 'POST', body: JSON.stringify(userPayload()) });
          if (identity?.user?.username === currentUser?.username) onUserUpdated?.(identity.user);
        }
        const username = encodeURIComponent(user.username);
        const path = type === 'reset'
          ? `/users/${username}/mfa/reset`
          : type === 'resend'
            ? `/users/${username}/mfa/resend`
            : `/users/${username}/mfa`;
        const method = ['reset', 'resend'].includes(type) ? 'POST' : 'PATCH';
        data = await request(path, {
          method,
          body: JSON.stringify({
            adminPassword: securityDraft.adminPassword,
            reason: securityDraft.reason.trim(),
            ...(type === 'change' || type === 'enable' || type === 'disable' ? { mode: mfaMode } : {}),
            ...(['reset', 'disable'].includes(type) ? { confirmation: securityDraft.confirmation } : {}),
          }),
        });
        if (type === 'change') setEditorOpen(false);
      }
      if (data?.user?.username === currentUser?.username) onUserUpdated?.(data.user);
      setSecurityAction(null);
      setSecurityDraft({ adminPassword: '', reason: '', confirmation: '' });
      if (data?.sessionEnded) {
        onSessionEnded?.(type === 'reset' ? 'mfa-reset' : 'mfa-disabled');
        return;
      }
      const notification = data?.notification || data?.mfa?.notification;
      const notificationFailed = normalize(notification?.status || notification) === 'failed';
      setNotice(notificationFailed
        ? 'Authenticator is pending, but the setup email could not be sent. Use Resend after mail is configured.'
        : type === 'resend' ? 'Setup email sent.'
          : type === 'disable' ? 'Authenticator MFA disabled.'
            : 'Authenticator MFA updated.');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to update Authenticator MFA');
    } finally {
      setSaving(false);
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
          {notice && <div className="users-notice" role="status">{notice}</div>}

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
                  placeholder="Search name, company, email, role, status, product"
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
              gridTemplate="minmax(180px, 1.2fr) minmax(190px, 1fr) 96px 118px 116px 122px minmax(190px, 1.1fr) 156px 156px"
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
                const mfaStatus = getMfaStatus(user);
                const notificationFailed = mfaStatus === 'pending' && getNotificationStatus(user) === 'failed';

                return (
                  <DataTableRow key={user.username} tone={getRowTone(user)} ariaLabel={`User ${user.username}`}>
                    <DataTableCell className="cell-name users-user-cell" label="User">
                      <strong className="cell-name-title">{user.fullName || user.username}</strong>
                      <span className="cell-name-subtitle">
                        {user.fullName ? user.username : user.username === currentUser?.username ? 'Current session' : 'Hub identity'}
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
                    <DataTableCell className="cell-mfa" label="MFA">
                      <span className={`mfa-badge ${mfaStatus}${notificationFailed ? ' mail-failed' : ''}`} title={notificationFailed ? 'Setup email failed' : undefined}>
                        {mfaStatus === 'enabled' ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
                        {notificationFailed ? 'Pending · email failed' : mfaStatus === 'pending' ? 'Pending setup' : mfaStatus === 'enabled' ? 'Authenticator' : 'Disabled'}
                      </span>
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
                        {mfaStatus === 'disabled' && <button type="button" className="icon-btn" onClick={() => openSecurityAction('enable', user, 'authenticator')} disabled={!user.email} title={user.email ? 'Enable Authenticator MFA' : 'Add an email before enabling MFA'} aria-label={`Enable Authenticator MFA for ${user.username}`}><ShieldCheck size={15} /></button>}
                        {mfaStatus === 'pending' && <button type="button" className="icon-btn" onClick={() => openSecurityAction('resend', user)} title="Resend setup email" aria-label={`Resend setup email to ${user.username}`}><MailCheck size={15} /></button>}
                        {mfaStatus === 'enabled' && <button type="button" className="icon-btn warning" onClick={() => openSecurityAction('reset', user, 'authenticator')} title="Reset authenticator" aria-label={`Reset authenticator for ${user.username}`}><RefreshCw size={15} /></button>}
                        {mfaStatus !== 'disabled' && <button type="button" className="icon-btn warning" onClick={() => openSecurityAction('disable', user, 'disabled')} title="Disable Authenticator MFA" aria-label={`Disable Authenticator MFA for ${user.username}`}><ShieldOff size={15} /></button>}
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
            <section ref={editorDialogRef} className="user-modal" role="dialog" aria-modal="true" aria-labelledby="user-editor-title" onMouseDown={event => event.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h2 id="user-editor-title">
                    {editorMode === 'create' ? 'Add User' : `Edit User: ${draftUser.username}`}
                  </h2>
                  <p>Manage identity, access, and the administrator-controlled MFA policy.</p>
                </div>
                <button type="button" className="icon-btn" onClick={() => setEditorOpen(false)} aria-label="Close user editor">
                  <X size={16} />
                </button>
              </div>

              <form className="user-form" onSubmit={saveUser}>
                {error && <div className="modal-error" role="alert">{error}</div>}
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
                  <span>Full name <small>Optional</small></span>
                  <input maxLength={120} value={draftUser.fullName} onChange={event => setDraftUser({ ...draftUser, fullName: event.target.value })} placeholder="Alex Morgan" />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    maxLength={254}
                    value={draftUser.email}
                    onChange={event => setDraftUser({ ...draftUser, email: event.target.value })}
                  />
                  {draftUser.mfaMode === 'authenticator' && <small>A valid email is required so the user can receive setup instructions.</small>}
                </label>
                {editorMode === 'create' && <label>
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={draftUser.password}
                    onChange={event => setDraftUser({ ...draftUser, password: event.target.value })}
                    required
                  />
                  <small>New passwords must contain 12–128 characters.</small>
                </label>}
                <div className="form-grid">
                  <label><span>Company <small>Optional</small></span><input maxLength={120} value={draftUser.company} onChange={event => setDraftUser({ ...draftUser, company: event.target.value })} /></label>
                  <label><span>Department <small>Optional</small></span><input maxLength={120} value={draftUser.department} onChange={event => setDraftUser({ ...draftUser, department: event.target.value })} /></label>
                </div>
                <div className="form-grid">
                  <label>
                    <span>Role</span>
                    <select
                      value={draftUser.role}
                      onChange={event => setDraftUser({ ...draftUser, role: event.target.value })}
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
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>Authenticator MFA</span>
                  <select value={draftUser.mfaMode} onChange={event => setDraftUser({ ...draftUser, mfaMode: event.target.value })}>
                    <option value="disabled">Disabled</option>
                    <option value="authenticator">Authenticator MFA</option>
                  </select>
                  <small>Changing this setting requires your administrator password and an audit reason.</small>
                </label>
                <label>
                  <span>Allowed Products</span>
                  <input
                    value={draftUser.products}
                    onChange={event => setDraftUser({ ...draftUser, products: event.target.value })}
                    disabled={draftUser.role === 'admin'}
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

        {passwordResetUser && (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setPasswordResetUser(null)}>
            <section ref={passwordDialogRef} className="user-modal" role="dialog" aria-modal="true" aria-labelledby="password-reset-title" onMouseDown={event => event.stopPropagation()}>
              <div className="modal-header">
                <div><h2 id="password-reset-title">Reset password: {passwordResetUser.username}</h2><p>All of this user’s sessions will be revoked.</p></div>
                <button type="button" className="icon-btn" onClick={() => setPasswordResetUser(null)} aria-label="Close password reset"><X size={16} /></button>
              </div>
              <form className="user-form" onSubmit={submitPasswordReset}>
                {error && <div className="modal-error" role="alert">{error}</div>}
                <label><span>New password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={passwordDraft.newPassword} onChange={event => setPasswordDraft(value => ({ ...value, newPassword: event.target.value }))} required /><small>Use 12–128 characters.</small></label>
                <label><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={passwordDraft.confirmationPassword} onChange={event => setPasswordDraft(value => ({ ...value, confirmationPassword: event.target.value }))} required /></label>
                <label><span>Your administrator password</span><input type="password" autoComplete="current-password" value={passwordDraft.adminPassword} onChange={event => setPasswordDraft(value => ({ ...value, adminPassword: event.target.value }))} required /></label>
                <label><span>Audit reason</span><textarea minLength={3} maxLength={500} value={passwordDraft.reason} onChange={event => setPasswordDraft(value => ({ ...value, reason: event.target.value }))} placeholder="Requested by account owner" required /></label>
                <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setPasswordResetUser(null)}>Cancel</button><button type="submit" className="btn-danger" disabled={saving}>{saving ? 'Resetting…' : 'Reset password'}</button></div>
              </form>
            </section>
          </div>
        )}

        {securityAction && (() => {
          const username = securityAction.user.username;
          const actionLabels = {
            create: ['Enable Authenticator MFA', 'Create the user, mark setup as pending, and email the setup link.'],
            change: [securityAction.mfaMode === 'authenticator' ? 'Enable Authenticator MFA' : 'Disable Authenticator MFA', securityAction.mfaMode === 'authenticator' ? 'Email the user a setup link after saving their details.' : 'Remove authenticator access and revoke the user’s sessions.'],
            enable: ['Enable Authenticator MFA', 'Mark setup as pending and email the user a setup link.'],
            reset: ['Reset Authenticator MFA', 'Remove the current authenticator, revoke sessions, and email a new setup link.'],
            resend: ['Resend setup email', 'Send the trusted setup link to the email on this account.'],
            disable: ['Disable Authenticator MFA', 'Remove authenticator access and revoke the user’s sessions.'],
          };
          const [title, description] = actionLabels[securityAction.type];
          const destructive = ['reset', 'disable'].includes(securityAction.type);
          return (
            <div className="modal-backdrop" role="presentation" onMouseDown={() => setSecurityAction(null)}>
              <section ref={securityDialogRef} className="user-modal" role="dialog" aria-modal="true" aria-labelledby="mfa-action-title" onMouseDown={event => event.stopPropagation()}>
                <div className="modal-header"><div><h2 id="mfa-action-title">{title}: {username}</h2><p>{description}</p></div><button type="button" className="icon-btn" onClick={() => setSecurityAction(null)} aria-label="Close authenticator action"><X size={16} /></button></div>
                <form className="user-form" onSubmit={submitSecurityAction}>
                  {error && <div className="modal-error" role="alert">{error}</div>}
                  <label><span>Your administrator password</span><input type="password" autoComplete="current-password" value={securityDraft.adminPassword} onChange={event => setSecurityDraft(value => ({ ...value, adminPassword: event.target.value }))} required autoFocus /></label>
                  <label><span>Audit reason</span><textarea minLength={3} maxLength={500} value={securityDraft.reason} onChange={event => setSecurityDraft(value => ({ ...value, reason: event.target.value }))} placeholder="Requested by account owner" required /></label>
                  {destructive && <label><span>Type {username} to confirm</span><input value={securityDraft.confirmation} onChange={event => setSecurityDraft(value => ({ ...value, confirmation: event.target.value }))} required /></label>}
                  <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setSecurityAction(null)}>Cancel</button><button type="submit" className={destructive ? 'btn-danger' : 'btn-primary'} disabled={saving || (destructive && securityDraft.confirmation !== username)}>{saving ? 'Saving…' : title}</button></div>
                </form>
              </section>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
