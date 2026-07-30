import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  KeyRound,
  LoaderCircle,
  MailCheck,
  Pencil,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRound,
  UserX,
} from 'lucide-react';
import { getMfaDeliveryView, getMfaProvider, hasDeliverableEmail } from './mfaDeliveryStatus.js';
import {
  formatDate,
  formatLabel,
  getAccessStatus,
  getAccessSummary,
  getAccountStatus,
  getPresenceStatus,
  getUserProductScope,
  getUserProducts,
  getUserRoleId,
  getUserRoleName,
} from './userHelpers.js';
import useUserActions from './useUserActions.js';
import useUsers from './useUsers.js';
import UserEditorModal from './components/UserEditorModal.jsx';
import {
  CredentialModal,
  MfaDeliveryIcon,
  MfaDeliveryModal,
  PasswordResetModal,
  SecurityActionModal,
} from './components/UserActionModals.jsx';
import './UserDetailPage.css';

const navigateBack = () => { window.location.hash = '#users'; };

export default function UserDetailPage({
  username,
  token,
  currentUser,
  onUnauthorized,
  onUserUpdated,
}) {
  const { users, roles, loading, error, setError, reload } = useUsers(token, onUnauthorized);
  const user = useMemo(
    () => users.find(candidate => candidate.username === username) || null,
    [username, users],
  );
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
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  if (loading && users.length === 0) {
    return (
      <div className="user-detail-page">
        <div className="user-detail-container">
          <button type="button" className="btn-back" onClick={navigateBack}><ArrowLeft size={16} /><span>Back to Users</span></button>
          <div className="user-detail-loading" role="status"><LoaderCircle size={24} /><span>Loading user details…</span></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="user-detail-page">
        <div className="user-detail-container">
          <button type="button" className="btn-back" onClick={navigateBack}><ArrowLeft size={16} /><span>Back to Users</span></button>
          <div className={`user-detail-not-found ${error ? 'error' : ''}`}>
            {error ? <AlertTriangle size={40} /> : <UserX size={40} />}
            <h2>{error ? 'Unable to load this user' : 'User not found'}</h2>
            <p>{error || `The user "${username}" doesn't exist or you don't have access.`}</p>
            {error
              ? <button type="button" className="btn-primary" onClick={reload}>Try again</button>
              : <button type="button" className="btn-secondary" onClick={navigateBack}>Back to Users</button>}
          </div>
        </div>
      </div>
    );
  }

  const account = getAccountStatus(user);
  const presence = getPresenceStatus(user);
  const accessStatus = getAccessStatus(user);
  const accessSummary = getAccessSummary(user);
  const productScope = getUserProductScope(user);
  const products = getUserProducts(user);
  const permissions = Array.isArray(user?.access?.permissions) ? user.access.permissions : [];
  const role = roles.find(candidate => candidate.id === getUserRoleId(user));
  const mfaView = getMfaDeliveryView(user);
  const modalOpen = actions.editorOpen
    || actions.passwordResetUser
    || actions.securityAction
    || actions.oneTimeCredential
    || deliveryOpen;

  const deleteCurrentUser = async () => {
    if (await actions.deleteUser(user.username)) navigateBack();
  };
  const openSecurity = type => actions.openSecurityAction({
    type,
    provider: getMfaProvider(user) === 'disabled' ? 'google' : getMfaProvider(user),
    user,
  });

  return (
    <div className="user-detail-page">
      <div className="user-detail-container">
        <button type="button" className="btn-back" onClick={navigateBack}><ArrowLeft size={16} /><span>Back to Users</span></button>

        {error && !modalOpen && <div className="user-detail-error" role="alert">{error}</div>}

        <section className="user-detail-header">
          <div className="user-avatar">{(user.fullName || user.username).charAt(0)}</div>
          <div className="user-identity">
            <h1>{user.fullName || user.username}</h1>
            <span className="user-identity-username">@{user.username}</span>
            <span className="user-identity-email">{user.email || 'No email address'}</span>
          </div>
          <div className="user-header-actions">
            <button type="button" className="btn-secondary" onClick={() => actions.openEdit(user)}><Pencil size={15} />Edit</button>
            <button type="button" className="btn-danger" onClick={deleteCurrentUser} disabled={user.username === currentUser?.username} title={user.username === currentUser?.username ? 'You cannot delete your own account' : 'Delete user'}><Trash2 size={15} />Delete</button>
          </div>
        </section>

        <div className="user-detail-grid">
          <section className="detail-card">
            <div className="detail-card-header"><UserRound size={17} /><span>Identity &amp; status</span></div>
            <div className="detail-card-body">
              <dl className="detail-dl">
                <dt>Account</dt><dd><span className={`account-badge ${account}`}>{formatLabel(account)}</span></dd>
                <dt>Presence</dt><dd><span className={`presence-badge ${presence}`}>{formatLabel(presence)}</span></dd>
                <dt>Company</dt><dd>{user.company || 'Not provided'}</dd>
                <dt>Department</dt><dd>{user.department || 'Not provided'}</dd>
                <dt>Last login</dt><dd>{formatDate(user.lastLoginAt)}</dd>
              </dl>
            </div>
          </section>

          <section className="detail-card">
            <div className="detail-card-header"><ShieldCheck size={17} /><span>Security</span></div>
            <div className="detail-card-body">
              <dl className="detail-dl">
                <dt>MFA status</dt><dd><span className={`mfa-badge ${mfaView.tone}`}><MfaDeliveryIcon view={mfaView} />{mfaView.label}</span></dd>
                <dt>Assigned app</dt><dd>{mfaView.providerLabel}</dd>
                <dt>Password updated</dt><dd>{formatDate(user.passwordUpdatedAt)}</dd>
                {mfaView.pending && <><dt>Setup requested</dt><dd>{formatDate(user.mfaRequestedAt)}</dd></>}
              </dl>
              <div className="detail-card-actions">
                <button type="button" className="btn-secondary" onClick={() => actions.openPasswordReset(user)}><KeyRound size={15} />Reset password</button>
                {mfaView.mfaStatus === 'disabled' && <button type="button" className="btn-primary" disabled={!hasDeliverableEmail(user.email)} title={hasDeliverableEmail(user.email) ? 'Enable Authenticator MFA' : 'Add a valid email first'} onClick={() => openSecurity('enable')}><ShieldCheck size={15} />Enable MFA</button>}
                {mfaView.pending && <button type="button" className="btn-secondary" onClick={() => setDeliveryOpen(true)}><MailCheck size={15} />Email details</button>}
                {mfaView.pending && <button type="button" className="btn-primary" disabled={!mfaView.canResend} title={mfaView.canResend ? 'Resend setup email' : mfaView.resendDisabledReason} onClick={() => openSecurity('resend')}><MailCheck size={15} />Resend setup</button>}
                {mfaView.mfaStatus === 'enabled' && <button type="button" className="btn-secondary" onClick={() => openSecurity('change')}><RefreshCw size={15} />Change app</button>}
                {mfaView.mfaStatus === 'enabled' && <button type="button" className="btn-secondary" onClick={() => openSecurity('reset')}><RefreshCw size={15} />Reset MFA</button>}
                {mfaView.mfaStatus !== 'disabled' && <button type="button" className="btn-danger" onClick={() => openSecurity('disable')}><ShieldOff size={15} />Disable MFA</button>}
              </div>
            </div>
          </section>
        </div>

        <section className="detail-card">
          <div className="detail-card-header"><Building2 size={17} /><span>Access &amp; permissions</span></div>
          <div className="detail-card-body detail-access-body">
            <dl className="detail-dl">
              <dt>Role</dt><dd><span className={`role-chip ${user?.access?.role?.system ? 'admin' : 'custom'}`}>{getUserRoleName(user)}</span></dd>
              <dt>Role summary</dt><dd>{role?.description || (user?.access?.role?.system ? 'Full system administration access' : `${permissions.length} task permissions`)}</dd>
              <dt>Product scope</dt><dd><strong className={`access-value ${accessStatus}`}>{accessSummary.title}</strong><span className="access-description">{accessSummary.details}</span></dd>
            </dl>
            {productScope.mode === 'selected' && (
              <div className="detail-list-section"><span className="detail-section-label">Assigned products</span><div className="detail-chip-list">{products.map(product => <span key={product}>{product}</span>)}</div></div>
            )}
            <div className="detail-list-section">
              <span className="detail-section-label">Task permissions</span>
              {user?.access?.role?.system
                ? <p className="detail-unrestricted"><ShieldCheck size={16} />Every current and future task is allowed.</p>
                : permissions.length > 0
                  ? <div className="detail-chip-list permissions">{permissions.map(permission => <span key={permission}>{permission}</span>)}</div>
                  : <p className="detail-empty-copy">No workspace tasks are assigned to this role.</p>}
            </div>
          </div>
        </section>
      </div>

      {actions.editorOpen && <UserEditorModal mode={actions.editorMode} draftUser={actions.draftUser} onDraftChange={actions.setDraftUser} roles={roles} currentUser={currentUser} saving={actions.saving} error={error} onSave={actions.saveUser} onClose={actions.closeEditor} />}
      <PasswordResetModal user={actions.passwordResetUser} saving={actions.saving} error={error} onClose={actions.closePasswordReset} onSubmit={actions.resetPassword} />
      <SecurityActionModal securityAction={actions.securityAction} saving={actions.saving} error={error} onClose={actions.closeSecurityAction} onProviderChange={provider => actions.setSecurityAction(value => ({ ...value, provider }))} onSubmit={actions.submitSecurityAction} />
      <CredentialModal credential={actions.oneTimeCredential} onClose={actions.closeCredential} />
      <MfaDeliveryModal deliveryUser={deliveryOpen ? user : null} deliveryView={mfaView} onClose={() => setDeliveryOpen(false)} onResend={() => {
        setDeliveryOpen(false);
        openSecurity('resend');
      }} />
    </div>
  );
}
