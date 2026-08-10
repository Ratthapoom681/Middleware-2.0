import { useMemo, useState } from 'react';
import { createAuthenticatedRequest, isSessionExpiredError } from '../../shared/authenticatedRequest.js';
import { getMfaProvider, getMfaStatus } from './mfaDeliveryStatus.js';
import {
  createUserDraft,
  EMPTY_USER,
  parseProducts,
  redirectAfterSelfSecurityChange,
} from './userHelpers.js';
import { getUserAdminPath } from './userRouting.js';

export default function useUserActions({
  token,
  onUnauthorized,
  users,
  currentUser,
  onUserUpdated,
  reload,
  error,
  setError,
}) {
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState('create');
  const [draftUser, setDraftUser] = useState({ ...EMPTY_USER });
  const [passwordResetUser, setPasswordResetUser] = useState(null);
  const [securityAction, setSecurityAction] = useState(null);
  const [oneTimeCredential, setOneTimeCredential] = useState(null);
  const request = useMemo(
    () => createAuthenticatedRequest({ token, onUnauthorized }),
    [onUnauthorized, token],
  );

  const clearError = () => setError('');

  const openCreate = () => {
    clearError();
    setDraftUser({ ...EMPTY_USER });
    setEditorMode('create');
    setEditorOpen(true);
  };

  const openEdit = user => {
    clearError();
    setDraftUser(createUserDraft(user));
    setEditorMode('edit');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    clearError();
  };

  const openPasswordReset = user => {
    clearError();
    setPasswordResetUser(user);
  };

  const closePasswordReset = () => {
    setPasswordResetUser(null);
    clearError();
  };

  const openSecurityAction = action => {
    clearError();
    setSecurityAction(action);
  };

  const closeSecurityAction = () => {
    setSecurityAction(null);
    clearError();
  };

  const saveUser = async event => {
    event.preventDefault();
    const originalUser = users.find(user => user.username === draftUser.username);
    const providerChanged = editorMode === 'edit'
      && originalUser
      && getMfaProvider(originalUser) !== draftUser.mfaProvider;
    setSaving(true);
    clearError();
    try {
      const data = await request(
        editorMode === 'create' ? '/users' : getUserAdminPath(originalUser),
        {
          method: editorMode === 'create' ? 'POST' : 'PATCH',
          body: JSON.stringify({
            username: draftUser.username.trim(),
            email: draftUser.email.trim(),
            fullName: draftUser.fullName.trim(),
            company: draftUser.company.trim(),
            department: draftUser.department.trim(),
            roleId: draftUser.roleId,
            productScope: {
              mode: draftUser.productScopeMode,
              products: draftUser.productScopeMode === 'selected'
                ? parseProducts(draftUser.products)
                : [],
            },
            status: draftUser.status,
            mfaProvider: draftUser.mfaProvider,
          }),
        },
      );
      setEditorOpen(false);
      if (data.user?.username === currentUser?.username) onUserUpdated?.(data.user);
      const followUpSecurityAction = providerChanged
        ? {
          type: draftUser.mfaProvider === 'disabled'
            ? 'disable'
            : getMfaStatus(originalUser) === 'disabled' ? 'enable' : 'change',
          provider: draftUser.mfaProvider,
          user: data.user || originalUser,
        }
        : null;
      if (data.temporaryPassword) {
        setOneTimeCredential({
          username: draftUser.username.trim(),
          password: data.temporaryPassword,
          expiresAt: data.expiresAt,
          deliveryMode: data.deliveryMode || 'manual_only',
          afterSecurityAction: followUpSecurityAction,
        });
      } else if (followUpSecurityAction) {
        setSecurityAction(followUpSecurityAction);
      }
      setDraftUser({ ...EMPTY_USER });
      await reload();
      return data.user || null;
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to save user');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async user => {
    if (!confirm(`Delete user ${user.username}?`)) return false;
    clearError();
    try {
      await request(getUserAdminPath(user), { method: 'DELETE' });
      await reload();
      return true;
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to delete user');
      return false;
    }
  };

  const resetPassword = async event => {
    event.preventDefault();
    if (!passwordResetUser) return;
    setSaving(true);
    clearError();
    try {
      const data = await request(`${getUserAdminPath(passwordResetUser)}/password/reset`, {
        method: 'POST',
      });
      setPasswordResetUser(null);
      setOneTimeCredential({
        username: passwordResetUser.username,
        password: data.temporaryPassword,
        expiresAt: data.expiresAt,
        deliveryMode: data.deliveryMode || 'manual_only',
        sessionEnded: Boolean(data.sessionEnded),
      });
      if (!data.sessionEnded) await reload();
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to reset password');
    } finally {
      setSaving(false);
    }
  };

  const submitSecurityAction = async event => {
    event.preventDefault();
    if (!securityAction) return;
    setSaving(true);
    clearError();
    try {
      const userPath = getUserAdminPath(securityAction.user);
      const path = securityAction.type === 'reset'
        ? `${userPath}/mfa/reset`
        : securityAction.type === 'resend'
          ? `${userPath}/mfa/resend`
          : `${userPath}/mfa`;
      const method = ['reset', 'resend'].includes(securityAction.type) ? 'POST' : 'PATCH';
      const body = ['enable', 'change', 'disable'].includes(securityAction.type)
        ? { mfaProvider: securityAction.type === 'disable' ? 'disabled' : securityAction.provider }
        : {};
      const data = await request(path, { method, body: JSON.stringify(body) });
      setSecurityAction(null);
      if (data.user?.username === currentUser?.username) onUserUpdated?.(data.user);
      if (data.sessionEnded) {
        redirectAfterSelfSecurityChange();
        return;
      }
      await reload();
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to update authenticator');
    } finally {
      setSaving(false);
    }
  };

  const closeCredential = () => {
    if (oneTimeCredential?.sessionEnded) {
      redirectAfterSelfSecurityChange();
      return;
    }
    const followUp = oneTimeCredential?.afterSecurityAction;
    setOneTimeCredential(null);
    if (followUp) setSecurityAction(followUp);
  };

  return {
    saving,
    error,
    editorOpen,
    editorMode,
    draftUser,
    setDraftUser,
    openCreate,
    openEdit,
    closeEditor,
    saveUser,
    deleteUser,
    passwordResetUser,
    openPasswordReset,
    closePasswordReset,
    resetPassword,
    securityAction,
    setSecurityAction,
    openSecurityAction,
    closeSecurityAction,
    submitSecurityAction,
    oneTimeCredential,
    closeCredential,
  };
}
