import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthenticatedRequest, isSessionExpiredError } from '../../shared/authenticatedRequest.js';
import { requireApiCollection } from '../../shared/apiCollections.js';
import { getMfaStatus } from './mfaDeliveryStatus.js';
import { normalize } from './userHelpers.js';

export default function useUsers(token, onUnauthorized) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const request = useMemo(
    () => createAuthenticatedRequest({ token, onUnauthorized }),
    [onUnauthorized, token],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userPayload, rolePayload] = await Promise.all([
        request('/users'),
        request('/roles'),
      ]);
      setUsers(requireApiCollection(userPayload, { property: 'users', label: 'Users' }));
      setRoles(requireApiCollection(rolePayload, { property: 'roles', label: 'Roles' }));
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to load users');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (token) reload();
  }, [reload, token]);

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

  return { users, roles, loading, error, setError, reload };
}
