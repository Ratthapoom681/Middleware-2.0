import { Save, X } from 'lucide-react';
import { hasDeliverableEmail, MFA_PROVIDER_OPTIONS } from '../mfaDeliveryStatus.js';
import { parseProducts } from '../userHelpers.js';
import { useDialogFocus } from './UserActionModals.jsx';
import './UserEditorModal.css';

const SCOPE_OPTIONS = [
  ['all', 'All products', 'Can use permitted DefectDojo tasks across every product.'],
  ['selected', 'Selected products', 'Limit permitted tasks to the product names entered below.'],
  ['none', 'No products', 'No product data is available, even when the role has DefectDojo tasks.'],
];

export default function UserEditorModal({
  mode,
  draftUser,
  onDraftChange,
  roles,
  currentUser,
  saving,
  error,
  onSave,
  onClose,
}) {
  const ref = useDialogFocus(true, onClose);
  const selectedRole = roles.find(role => role.id === draftUser.roleId);
  const editingSelf = mode === 'edit' && draftUser.username === currentUser?.username;
  const update = changes => onDraftChange({ ...draftUser, ...changes });

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={ref} className="user-modal user-editor-modal modal-accent-primary" role="dialog" aria-modal="true" aria-labelledby="user-editor-title" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="user-editor-title">{mode === 'create' ? 'Add User' : `Edit User: ${draftUser.username}`}</h2>
            <p>Manage identity, access, and administrator-controlled security.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close user editor"><X size={16} /></button>
        </div>

        <form className="user-form" onSubmit={onSave}>
          {error && <div className="modal-error" role="alert">{error}</div>}

          <div className="modal-section">
            <span className="modal-section-label">Identity</span>
            <label><span>Username</span><input value={draftUser.username} onChange={event => update({ username: event.target.value })} disabled={mode !== 'create'} required /></label>
            <label><span>Full name <small>Optional</small></span><input maxLength={120} value={draftUser.fullName} onChange={event => update({ fullName: event.target.value })} /></label>
            <label><span>Email</span><input type="email" value={draftUser.email} onChange={event => update({ email: event.target.value })} maxLength={254} required={draftUser.mfaProvider !== 'disabled'} /></label>
          </div>
          <div className="modal-divider" />

          <div className="modal-section">
            <span className="modal-section-label">Organization</span>
            <div className="form-grid">
              <label><span>Company <small>Optional</small></span><input maxLength={120} value={draftUser.company} onChange={event => update({ company: event.target.value })} /></label>
              <label><span>Department <small>Optional</small></span><input maxLength={120} value={draftUser.department} onChange={event => update({ department: event.target.value })} /></label>
            </div>
          </div>
          <div className="modal-divider" />

          <div className="modal-section">
            <span className="modal-section-label">Role &amp; status</span>
            <div className="form-grid">
              <label>
                <span>Role</span>
                <select value={draftUser.roleId} onChange={event => {
                  const nextRole = roles.find(role => role.id === event.target.value);
                  update({
                    roleId: event.target.value,
                    ...(nextRole?.system ? { productScopeMode: 'all', products: '' } : {}),
                  });
                }} disabled={editingSelf} required>
                  <option value="" disabled>Select a role</option>
                  {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
                {draftUser.roleId && <small>{selectedRole?.description || 'Custom task-based access'}</small>}
                {editingSelf && <small>Your own role cannot be changed.</small>}
              </label>
              <label>
                <span>Status</span>
                <select value={draftUser.status} onChange={event => update({ status: event.target.value })}>
                  <option value="active">Active</option>
                  <option value="suspended" disabled={editingSelf}>Suspended</option>
                </select>
              </label>
            </div>
          </div>
          <div className="modal-divider" />

          <div className="modal-section">
            <span className="modal-section-label">DefectDojo product scope</span>
            <fieldset className="product-scope-fieldset">
              <legend className="sr-only">DefectDojo product scope</legend>
              {SCOPE_OPTIONS.map(([value, label, description]) => (
                <label className="product-scope-option" key={value}>
                  <input type="radio" name="product-scope" value={value} checked={draftUser.productScopeMode === value} onChange={() => update({ productScopeMode: value })} disabled={selectedRole?.system} required />
                  <span><strong>{label}</strong><small>{description}</small></span>
                </label>
              ))}
              {draftUser.productScopeMode === 'selected' && (
                <label><span>Selected product names</span><input value={draftUser.products} onChange={event => update({ products: event.target.value })} placeholder="Mobile Banking, Customer Portal" required /><small>Use the exact DefectDojo product names, separated by commas.</small></label>
              )}
              {selectedRole?.system && <small>System Administrator is always fixed to All products.</small>}
            </fieldset>
            {draftUser.roleId && (
              <div className="effective-access-preview">
                <strong>Effective access preview</strong>
                <span>
                  {selectedRole?.system ? 'All current and future tasks' : `${selectedRole?.permissions?.length || 0} task permissions`}
                  {' · '}
                  {draftUser.productScopeMode === 'all' ? 'All DefectDojo products' : draftUser.productScopeMode === 'selected' ? `${parseProducts(draftUser.products).length} selected product(s)` : draftUser.productScopeMode === 'none' ? 'No DefectDojo products' : 'Choose a product scope'}
                </span>
              </div>
            )}
          </div>
          <div className="modal-divider" />

          <div className="modal-section">
            <span className="modal-section-label">Security</span>
            <label><span>Authenticator MFA</span><select value={draftUser.mfaProvider} onChange={event => update({ mfaProvider: event.target.value })}>{MFA_PROVIDER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>An authenticator requires a valid email. {mode === 'edit' ? 'Changing an enabled app resets enrollment and revokes the user’s sessions.' : 'The user remains password-only while setup is pending.'}</small></label>
            {mode === 'create' && <small>{hasDeliverableEmail(draftUser.email) ? `The temporary password will be emailed automatically to ${draftUser.email.trim()} and displayed once.` : 'The temporary password will be displayed once for manual copying. Add a valid email to send it automatically.'}</small>}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}><Save size={16} /><span>{saving ? 'Saving...' : 'Save User'}</span></button>
          </div>
        </form>
      </section>
    </div>
  );
}
