import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clipboard,
  KeyRound,
  MailCheck,
  Pencil,
  Plus,
  Save,
  RefreshCw,
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
  email: '',
  fullName: '',
  company: '',
  department: '',
  role: 'viewer',
  products: '',
  status: 'active',
  mfaProvider: 'disabled',
};

const MFA_PROVIDER_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'google', label: 'Google Authenticator' },
  { value: 'microsoft', label: 'Microsoft Authenticator' },
  { value: 'other', label: 'Other authenticator' },
];

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

const getMfaStatus = user => {
  const status = normalize(user.mfaStatus);
  if (['disabled', 'pending', 'enabled'].includes(status)) return status;
  return user.mfaEnabled ? 'enabled' : user.mfaMode === 'authenticator' ? 'pending' : 'disabled';
};

const getMfaProvider = user => {
  if (getMfaStatus(user) === 'disabled') return 'disabled';
  const provider = normalize(user.mfaProvider);
  return ['google', 'microsoft', 'other'].includes(provider) ? provider : 'other';
};

const getMfaProviderLabel = provider => MFA_PROVIDER_OPTIONS.find(option => option.value === provider)?.label || 'Other authenticator';
const hasDeliverableEmail = value => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(value || '').trim());

const redirectAfterSelfSecurityChange = () => {
  localStorage.removeItem('middleware_token');
  localStorage.removeItem('middleware_user');
  window.location.replace('/login/?returnTo=%2F&notice=security-updated');
};

function useDialogFocus(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const root = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
    (root.querySelector('[autofocus]') || focusable()[0])?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable(); if (!items.length) return;
      const [first] = items; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); requestAnimationFrame(() => previous?.focus()); };
  }, [open]);
  return ref;
}

export default function UsersPage({ token, currentUser, onBack, onUserUpdated }) {
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
  const [passwordResetUser, setPasswordResetUser] = useState(null);
  const [securityAction, setSecurityAction] = useState(null);
  const [oneTimeCredential, setOneTimeCredential] = useState(null);
  const editorDialogRef = useDialogFocus(editorOpen, () => setEditorOpen(false));
  const passwordDialogRef = useDialogFocus(Boolean(passwordResetUser), () => setPasswordResetUser(null));
  const securityDialogRef = useDialogFocus(Boolean(securityAction), () => setSecurityAction(null));
  const credentialDialogRef = useDialogFocus(Boolean(oneTimeCredential), () => {});

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
    if (!users.some(user => ['queued', 'sending'].includes(normalize(user.mfaNotificationStatus)))) return undefined;
    const timer = window.setInterval(() => {
      request('/users').then(setUsers).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [request, users]);

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
        user.company,
        user.department,
        user.email,
        role,
        presence,
        accountStatus,
        `mfa ${getMfaStatus(user)}`,
        user.mfaProvider,
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
      fullName: user.fullName || '',
      company: user.company || '',
      department: user.department || '',
      role: user.role || 'viewer',
      products: getUserProducts(user).join(', '),
      status: user.accountStatus || 'active',
      mfaProvider: getMfaProvider(user),
    });
    setEditorMode('edit');
    setEditorOpen(true);
  }

  function openReset(user) {
    setPasswordResetUser(user);
  }

  async function saveUser(event) {
    event.preventDefault();
    const originalUser = users.find(user => user.username === draftUser.username);
    const mfaProviderChanged = editorMode === 'edit' && originalUser
      && getMfaProvider(originalUser) !== draftUser.mfaProvider;
    setSaving(true);
    setError('');
    try {
      const data = await request(editorMode === 'create' ? '/users' : `/users/${encodeURIComponent(draftUser.username)}`, {
        method: editorMode === 'create' ? 'POST' : 'PATCH',
        body: JSON.stringify({
          username: draftUser.username.trim(),
          email: draftUser.email.trim(),
          fullName: draftUser.fullName.trim(),
          company: draftUser.company.trim(),
          department: draftUser.department.trim(),
          role: draftUser.role,
          products: parseProducts(draftUser.products),
          status: draftUser.status,
          mfaProvider: draftUser.mfaProvider,
        }),
      });
      setEditorOpen(false);
      if (data.user?.username === currentUser?.username) onUserUpdated?.(data.user);
      if (mfaProviderChanged) {
        setSecurityAction({
          type: draftUser.mfaProvider === 'disabled' ? 'disable' : getMfaStatus(originalUser) === 'disabled' ? 'enable' : 'change',
          provider: draftUser.mfaProvider,
          user: data.user || originalUser
        });
      }
      if (data.temporaryPassword) setOneTimeCredential({
        username: draftUser.username.trim(), password: data.temporaryPassword, expiresAt: data.expiresAt,
        deliveryMode: data.deliveryMode || 'manual_only'
      });
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

  async function resetPassword(event) {
    event.preventDefault();
    if (!passwordResetUser) return;
    setSaving(true);
    setError('');
    try {
      const data = await request(`/users/${encodeURIComponent(passwordResetUser.username)}/password/reset`, {
        method: 'POST',
      });
      setPasswordResetUser(null);
      setOneTimeCredential({
        username: passwordResetUser.username, password: data.temporaryPassword, expiresAt: data.expiresAt,
        deliveryMode: data.deliveryMode || 'manual_only', sessionEnded: Boolean(data.sessionEnded)
      });
      if (!data.sessionEnded) await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to reset password');
    } finally {
      setSaving(false);
    }
  }

  async function submitSecurityAction(event) {
    event.preventDefault();
    if (!securityAction) return;
    setSaving(true); setError('');
    try {
      const username = encodeURIComponent(securityAction.user.username);
      const path = securityAction.type === 'reset' ? `/users/${username}/mfa/reset`
        : securityAction.type === 'resend' ? `/users/${username}/mfa/resend` : `/users/${username}/mfa`;
      const method = ['reset', 'resend'].includes(securityAction.type) ? 'POST' : 'PATCH';
      const body = ['enable', 'change', 'disable'].includes(securityAction.type)
        ? { mfaProvider: securityAction.type === 'disable' ? 'disabled' : securityAction.provider }
        : {};
      const data = await request(path, { method, body: JSON.stringify(body) });
      setSecurityAction(null);
      if (data.user?.username === currentUser?.username) onUserUpdated?.(data.user);
      if (data.sessionEnded) { redirectAfterSelfSecurityChange(); return; }
      await loadUsers();
    } catch (err) { setError(err.message || 'Unable to update authenticator'); }
    finally { setSaving(false); }
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
                const mfaProvider = getMfaProvider(user);
                const mailStatus = normalize(user.mfaNotificationStatus);

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
                      <span className={`mfa-badge ${mfaStatus}`} title={mailStatus === 'failed' ? user.mfaNotificationError || 'Setup email failed' : undefined}>
                        {mfaStatus === 'enabled' ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
                        {mfaStatus === 'enabled'
                          ? getMfaProviderLabel(mfaProvider)
                          : mfaStatus === 'pending' ? `${getMfaProviderLabel(mfaProvider)} · ${mailStatus || 'queued'}` : 'Disabled'}
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
                        {mfaStatus === 'disabled' && <button type="button" className="icon-btn" onClick={() => setSecurityAction({ type: 'enable', provider: 'google', user })} disabled={!hasDeliverableEmail(user.email)} title={hasDeliverableEmail(user.email) ? 'Enable Authenticator MFA' : 'Add a valid email first'} aria-label={`Enable Authenticator MFA for ${user.username}`}><ShieldCheck size={15} /></button>}
                        {mfaStatus === 'pending' && <button type="button" className="icon-btn" onClick={() => setSecurityAction({ type: 'resend', user })} title="Resend setup email" aria-label={`Resend setup email to ${user.username}`}><MailCheck size={15} /></button>}
                        {mfaStatus === 'enabled' && <button type="button" className="icon-btn warning" onClick={() => setSecurityAction({ type: 'reset', user })} title="Reset authenticator" aria-label={`Reset authenticator for ${user.username}`}><RefreshCw size={15} /></button>}
                        {mfaStatus !== 'disabled' && <button type="button" className="icon-btn warning" onClick={() => setSecurityAction({ type: 'disable', user })} title="Disable Authenticator MFA" aria-label={`Disable Authenticator MFA for ${user.username}`}><ShieldOff size={15} /></button>}
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
                  <p>Manage identity, access, and administrator-controlled security.</p>
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
                <label><span>Full name <small>Optional</small></span><input maxLength={120} value={draftUser.fullName} onChange={event => setDraftUser({ ...draftUser, fullName: event.target.value })} /></label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={draftUser.email}
                    onChange={event => setDraftUser({ ...draftUser, email: event.target.value })}
                    maxLength={254}
                    required={draftUser.mfaProvider !== 'disabled'}
                  />
                </label>
                <div className="form-grid"><label><span>Company <small>Optional</small></span><input maxLength={120} value={draftUser.company} onChange={event => setDraftUser({ ...draftUser, company: event.target.value })} /></label><label><span>Department <small>Optional</small></span><input maxLength={120} value={draftUser.department} onChange={event => setDraftUser({ ...draftUser, department: event.target.value })} /></label></div>
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
                  <span>Allowed Products</span>
                  <input
                    value={draftUser.products}
                    onChange={event => setDraftUser({ ...draftUser, products: event.target.value })}
                    disabled={draftUser.role === 'admin'}
                    placeholder="Product A, Product B"
                  />
                </label>
                <label><span>Authenticator MFA</span><select value={draftUser.mfaProvider} onChange={event => setDraftUser({ ...draftUser, mfaProvider: event.target.value })}>{MFA_PROVIDER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>An authenticator requires a valid email. {editorMode === 'edit' ? 'Changing an enabled app resets enrollment and revokes the user’s sessions.' : 'The user remains password-only while setup is pending.'}</small></label>
                {editorMode === 'create' && <small>{hasDeliverableEmail(draftUser.email) ? `The temporary password will be emailed automatically to ${draftUser.email.trim()} and displayed once.` : 'The temporary password will be displayed once for manual copying. Add a valid email to send it automatically.'}</small>}
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

        {passwordResetUser && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPasswordResetUser(null)}><section ref={passwordDialogRef} className="user-modal" role="dialog" aria-modal="true" aria-labelledby="password-reset-title" onMouseDown={event => event.stopPropagation()}>
          <div className="modal-header"><div><h2 id="password-reset-title">Generate temporary password: {passwordResetUser.username}</h2><p>The password expires in 24 hours. All current sessions will be revoked.</p></div><button type="button" className="icon-btn" onClick={() => setPasswordResetUser(null)} aria-label="Close password reset"><X size={16} /></button></div>
          <form className="user-form" onSubmit={resetPassword}>{error && <div className="modal-error" role="alert">{error}</div>}
            <p>{hasDeliverableEmail(passwordResetUser.email) ? `The new password will be emailed automatically to ${passwordResetUser.email} and displayed once for copying.` : 'No deliverable email is saved. The new password will only be displayed once for manual copying.'}</p>
            <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setPasswordResetUser(null)}>Cancel</button><button type="submit" className="btn-danger" disabled={saving} autoFocus>{saving ? 'Generating…' : 'Generate and revoke sessions'}</button></div>
          </form>
        </section></div>}

        {securityAction && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSecurityAction(null)}><section ref={securityDialogRef} className="user-modal" role="dialog" aria-modal="true" aria-labelledby="security-action-title" onMouseDown={event => event.stopPropagation()}>
          <div className="modal-header"><div><h2 id="security-action-title">{formatLabel(securityAction.type)} Authenticator MFA: {securityAction.user.username}</h2><p>{securityAction.type === 'enable' ? 'Select the app, mark setup pending, and queue its setup email.' : securityAction.type === 'change' ? 'Assign the selected app. Existing enrollment will be cleared and sessions revoked when necessary.' : securityAction.type === 'resend' ? `Queue the ${getMfaProviderLabel(getMfaProvider(securityAction.user))} setup link again.` : securityAction.type === 'reset' ? `Clear ${getMfaProviderLabel(getMfaProvider(securityAction.user))}, revoke sessions, and queue a new setup.` : 'Clear authenticator access and revoke sessions.'}</p></div><button type="button" className="icon-btn" onClick={() => setSecurityAction(null)} aria-label="Close authenticator action"><X size={16} /></button></div>
          <form className="user-form" onSubmit={submitSecurityAction}>
            {['enable', 'change'].includes(securityAction.type) && <label><span>Authenticator app</span><select value={securityAction.provider || 'google'} onChange={event => setSecurityAction(value => ({ ...value, provider: event.target.value }))} autoFocus>{MFA_PROVIDER_OPTIONS.filter(option => option.value !== 'disabled').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
            <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setSecurityAction(null)}>Cancel</button><button type="submit" className={['reset', 'disable'].includes(securityAction.type) ? 'btn-danger' : 'btn-primary'} disabled={saving} autoFocus={!['enable', 'change'].includes(securityAction.type)}>{saving ? 'Saving…' : 'Confirm'}</button></div>
          </form>
        </section></div>}

        {oneTimeCredential && <div className="modal-backdrop" role="presentation"><section ref={credentialDialogRef} className="user-modal" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title">
          <div className="modal-header"><div><h2 id="temporary-password-title">Temporary password for {oneTimeCredential.username}</h2><p>This is displayed once and expires in 24 hours.</p></div></div>
          <div className="user-form"><div className="temporary-password-value"><code>{oneTimeCredential.password}</code><button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(oneTimeCredential.password)}><Clipboard size={15} />Copy</button></div>{oneTimeCredential.deliveryMode === 'queued' ? <small>The email was queued automatically. Plain SMTP may expose this password in transit.</small> : <small>No deliverable email was available. Copy this password and provide it to the user manually.</small>}<div className="modal-actions"><button type="button" className="btn-primary" onClick={() => { if (oneTimeCredential.sessionEnded) redirectAfterSelfSecurityChange(); else setOneTimeCredential(null); }}>I saved it</button></div></div>
        </section></div>}
      </div>
    </div>
  );
}
