import { useEffect, useMemo, useState } from 'react';
import { Plus, SearchX, Users } from 'lucide-react';
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
import {
  getUserRoleId,
  getUserRoleName,
  normalize,
  PAGE_SIZE_OPTIONS,
} from './userHelpers.js';
import useUserActions from './useUserActions.js';
import useUsers from './useUsers.js';
import { getVisibleUserSearchText, USER_TABLE_COLUMNS } from './userDirectory.js';
import { getUserDetailHash } from './userRouting.js';
import UserEditorModal from './components/UserEditorModal.jsx';
import { CredentialModal } from './components/UserActionModals.jsx';
import './UserListPage.css';

export default function UserListPage({ token, currentUser, onUnauthorized, onUserUpdated }) {
  const { users, roles, loading, error, setError, reload } = useUsers(token, onUnauthorized);
  const actions = useUserActions({
    token,
    onUnauthorized,
    users,
    currentUser,
    onUserUpdated,
    reload,
    error,
    setError,
  });
  const [searchOpen, setSearchOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const filteredUsers = useMemo(() => {
    const query = normalize(searchTerm);
    return users.filter(user => {
      const roleId = getUserRoleId(user);
      const searchable = getVisibleUserSearchText(user);
      if (query && !searchable.includes(query)) return false;
      if (roleFilter !== 'all' && roleId !== roleFilter) return false;
      return true;
    });
  }, [roleFilter, searchTerm, users]);

  useEffect(() => setCurrentPage(1), [searchTerm, roleFilter, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  useEffect(() => setCurrentPage(page => Math.min(page, pageCount)), [pageCount]);
  const pagedUsers = useMemo(() => {
    const firstIndex = (currentPage - 1) * pageSize;
    return filteredUsers.slice(firstIndex, firstIndex + pageSize);
  }, [currentPage, filteredUsers, pageSize]);

  const clearAllFilters = () => {
    setSearchTerm('');
    setRoleFilter('all');
  };
  const navigateToUser = user => {
    window.location.hash = getUserDetailHash(user);
  };
  const emptyState = users.length === 0 ? (
    <div className="user-list-empty" role="row">
      <div className="user-list-empty-icon"><Users size={40} /></div>
      <h3 className="user-list-empty-title">No users yet</h3>
      <p className="user-list-empty-subtitle">Create your first user to get started.</p>
      <button type="button" className="btn-primary" onClick={actions.openCreate}><Plus size={16} /><span>Add User</span></button>
    </div>
  ) : (
    <div className="user-list-empty" role="row">
      <div className="user-list-empty-icon muted"><SearchX size={40} /></div>
      <h3 className="user-list-empty-title">No users match your filters</h3>
      <p className="user-list-empty-subtitle">Try adjusting your search or filter criteria.</p>
      <button type="button" className="btn-secondary" onClick={clearAllFilters}>Clear all filters</button>
    </div>
  );

  return (
    <div className="user-list-page">
      <div className="user-list-container">
        <section className="user-list-card">
          <div className="user-list-header">
            <div>
              <div className="user-list-title-row"><Users size={22} /><h1>User Management</h1></div>
              <p>Hub identities, role scope, and product access.</p>
            </div>
            <button type="button" className="btn-primary" onClick={actions.openCreate}><Plus size={16} /><span>Add User</span></button>
          </div>

          {error && !actions.editorOpen && !actions.oneTimeCredential && <div className="user-list-error" role="alert">{error}</div>}

          <div className="user-list-tools">
            <SearchOptionsPanel bodyId="users-search-options" icon={FilterIcon} open={searchOpen} onToggle={() => setSearchOpen(open => !open)} title="Search Options">
              <SearchOptionsCommandBar>
                <SearchOptionsSearch kbd="/" label="Search users" onChange={setSearchTerm} onClear={() => setSearchTerm('')} placeholder="Search ID, username, name, email, company, department, or role" showClear={Boolean(searchTerm)} value={searchTerm} />
                <label className="user-list-filter"><span className="sr-only">Role filter</span><select value={roleFilter} onChange={event => setRoleFilter(event.target.value)} aria-label="Role filter"><option value="all">All roles</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
                <SearchOptionsResultCount icon={Users} value={filteredUsers.length} label="users" />
              </SearchOptionsCommandBar>
            </SearchOptionsPanel>
          </div>

          <DataTableSection ariaLabel="Hub users" className="user-list-table-section" panelClassName="user-list-table-panel">
            <DataTable
              ariaLabel="Hub users"
              className="user-list-data-table"
              columns={USER_TABLE_COLUMNS}
              empty={emptyState}
              footer={filteredUsers.length > 0 ? (
                <DataTablePagination
                  currentPage={currentPage}
                  firstResult={((currentPage - 1) * pageSize) + 1}
                  itemLabel="user"
                  lastResult={Math.min(currentPage * pageSize, filteredUsers.length)}
                  onNextPage={() => setCurrentPage(page => Math.min(page + 1, pageCount))}
                  onPageSizeChange={setPageSize}
                  onPreviousPage={() => setCurrentPage(page => Math.max(page - 1, 1))}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  totalRows={filteredUsers.length}
                />
              ) : null}
              gridTemplate="96px minmax(150px, 1fr) minmax(180px, 1.2fr) minmax(210px, 1.35fr) minmax(150px, 1fr) minmax(150px, 1fr) minmax(140px, .9fr)"
              loading={loading}
              minWidth="1076px"
            >
              {pagedUsers.map(user => {
                const roleId = getUserRoleId(user);
                const fullName = user.fullName || '—';
                const email = user.email || '—';
                const company = user.company || '—';
                const department = user.department || '—';
                const activate = () => navigateToUser(user);
                return (
                  <DataTableRow key={user.userId || user.username} interactive ariaLabel={`View user ${user.username}`} onClick={activate} onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      activate();
                    }
                  }}>
                    <DataTableCell className="cell-user-id user-list-id-cell" label="ID" title={user.userId || 'ID unavailable'}>{user.userId || '—'}</DataTableCell>
                    <DataTableCell className="cell-username user-list-primary-cell" label="Username" title={user.username}><strong>{user.username}</strong></DataTableCell>
                    <DataTableCell className="cell-full-name user-list-muted-cell" label="Full Name" title={fullName}>{fullName}</DataTableCell>
                    <DataTableCell className="cell-email user-list-muted-cell" label="Email" title={email}>{email}</DataTableCell>
                    <DataTableCell className="cell-company user-list-muted-cell" label="Company" title={company}>{company}</DataTableCell>
                    <DataTableCell className="cell-department user-list-muted-cell" label="Department" title={department}>{department}</DataTableCell>
                    <DataTableCell className="cell-role" label="Role"><span className={`role-chip ${user?.access?.role?.system ? 'admin' : 'custom'}`} title={roleId}>{getUserRoleName(user)}</span></DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTable>
          </DataTableSection>
        </section>
      </div>

      {actions.editorOpen && <UserEditorModal mode={actions.editorMode} draftUser={actions.draftUser} onDraftChange={actions.setDraftUser} roles={roles} currentUser={currentUser} saving={actions.saving} error={error} onSave={actions.saveUser} onClose={actions.closeEditor} />}
      <CredentialModal credential={actions.oneTimeCredential} onClose={actions.closeCredential} />
    </div>
  );
}
