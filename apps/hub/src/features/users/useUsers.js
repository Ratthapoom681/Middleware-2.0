import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthenticatedRequest, isSessionExpiredError } from '../../shared/authenticatedRequest.js';
import { requireApiCollection } from '../../shared/apiCollections.js';
import { EMPTY_EMAIL_SETTINGS } from '../../shared/emailDeliveryStatus.js';
import { getMfaStatus } from './mfaDeliveryStatus.js';
import { normalize } from './userHelpers.js';

export default function useUsers(token, onUnauthorized) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailSettings, setEmailSettings] = useState(EMPTY_EMAIL_SETTINGS);

  const request = useMemo(
    () => createAuthenticatedRequest({ token, onUnauthorized }),
    [onUnauthorized, token],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userPayload, rolePayload, emailPayload] = await Promise.all([
        request('/users'),
        request('/roles'),
        request('/settings/email'),
      ]);
      setUsers(requireApiCollection(userPayload, { property: 'users', label: 'Users' }));
      setRoles(requireApiCollection(rolePayload, { property: 'roles', label: 'Roles' }));
      setEmailSettings(emailPayload);
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to load users');
    } finally {
      setLoading(false);
    }
  }, [request]);

  const refreshEmailSettings = useCallback(async () => {
    try {
      const payload = await request('/settings/email');
      setEmailSettings(payload);
      return payload;
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to load email status');
      return null;
    }
  }, [request]);

  useEffect(() => {
    if (token) reload();
  }, [reload, token]);

  useEffect(() => {
    const onFocus = () => { if (token) refreshEmailSettings(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshEmailSettings, token]);

  const hasActiveMfaDelivery = useMemo(
    () => users.some(user => getMfaStatus(user) === 'pending'
      && ['queued', 'sending'].includes(normalize(user.mfaNotificationStatus))),
    [users],
  );

  useEffect(() => {
    if (!hasActiveMfaDelivery) return undefined;
    const timer = window.setInterval(() => {
      request('/users')
        .then(payload => setUsers(requireApiCollection(payload, { property: 'users', label: 'Users' })))
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveMfaDelivery, request]);

  return { users, roles, emailSettings, refreshEmailSettings, loading, error, setError, reload };
}
