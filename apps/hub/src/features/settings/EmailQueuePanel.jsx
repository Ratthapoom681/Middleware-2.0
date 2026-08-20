import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import {
  DataTable,
  DataTableCell,
  DataTablePagination,
  DataTableRow,
  DataTableSection,
} from '../../shared/ui/DataTable/DataTable.jsx';
import { createAuthenticatedRequest, isSessionExpiredError } from '../../shared/authenticatedRequest.js';
import { getEmailCapability, getEmailReasonCopy } from '../../shared/emailDeliveryStatus.js';
import { CredentialModal } from '../users/components/UserActionModals.jsx';
import { redirectAfterSelfSecurityChange } from '../users/userHelpers.js';

const PAGE_SIZES = [10, 25, 50, 100];
const COLUMNS = ['Created', 'Type', 'User', 'Recipient', 'Status', 'Attempts', 'Next / sent', 'Error', 'Actions'];

const formatDate = value => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

const formatType = type => type === 'mfa_setup' ? 'MFA setup' : 'Temporary password';

export default function EmailQueuePanel({ token, onUnauthorized, settings, refreshKey = 0 }) {
  const request = useMemo(
    () => createAuthenticatedRequest({ token, onUnauthorized }),
    [onUnauthorized, token],
  );
  const [deliveries, setDeliveries] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [credential, setCredential] = useState(null);

  const loadQueue = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (type) params.set('type', type);
      if (status) params.set('status', status);
      if (query.trim()) params.set('q', query.trim());
      const data = await request(`/settings/email/queue?${params}`);
      setDeliveries(Array.isArray(data.deliveries) ? data.deliveries : []);
      setTotal(Number(data.total || 0));
      setActiveCount(Number(data.activeCount || 0));
      setError('');
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || 'Unable to load email queue');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [page, pageSize, query, request, status, type]);

  useEffect(() => { loadQueue(); }, [loadQueue, refreshKey]);
  useEffect(() => {
    if (activeCount === 0) return undefined;
    const timer = window.setInterval(() => loadQueue({ quiet: true }), 3000);
    return () => window.clearInterval(timer);
  }, [activeCount, loadQueue]);
  useEffect(() => { setPage(1); }, [pageSize, query, status, type]);

  const runAction = async (delivery, action) => {
    setBusyId(delivery.id);
    setError('');
    try {
      const data = await request(`/settings/email/queue/${encodeURIComponent(delivery.id)}/${action}`, { method: 'POST' });
      if (data.temporaryPassword) {
        setCredential({
          username: delivery.targetUsername,
          password: data.temporaryPassword,
          expiresAt: data.expiresAt,
          deliveryMode: data.deliveryMode,
          deliveryReason: data.deliveryReason,
          sessionEnded: Boolean(data.sessionEnded),
        });
      }
      await loadQueue({ quiet: true });
    } catch (err) {
      if (!isSessionExpiredError(err)) setError(err.message || `Unable to ${action} email`);
    } finally {
      setBusyId('');
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return <section className="settings-panel email-queue-panel">
    <div className="settings-section-heading">
      <div><h2>Email queue</h2><p>Delivery activity and actions.</p></div>
      <button type="button" className="btn-secondary" onClick={() => loadQueue()} disabled={loading}><RefreshCw size={15} />Refresh</button>
    </div>
    {error && <div className="settings-notice error" role="alert">{error}</div>}
    <div className="email-queue-filters">
      <label><span>Search</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ID, user, or recipient" /></label>
      <label><span>Type</span><select value={type} onChange={event => setType(event.target.value)}><option value="">All</option><option value="mfa_setup">MFA setup</option><option value="temporary_password">Temporary password</option></select></label>
      <label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All</option>{['queued', 'sending', 'sent', 'failed', 'cancelled'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <DataTableSection ariaLabel="Email queue" panelClassName="email-queue-table-panel">
      <DataTable
        ariaLabel="Email deliveries"
        columns={COLUMNS}
        gridTemplate="150px 130px 130px minmax(190px,1fr) 100px 75px 160px minmax(170px,1fr) 150px"
        minWidth="1320px"
        loading={loading}
        empty={<div className="email-queue-empty">No email deliveries found.</div>}
        footer={total > 0 ? <DataTablePagination
          currentPage={page}
          firstResult={((page - 1) * pageSize) + 1}
          lastResult={Math.min(page * pageSize, total)}
          itemLabel="delivery"
          onNextPage={() => setPage(value => Math.min(pageCount, value + 1))}
          onPageSizeChange={setPageSize}
          onPreviousPage={() => setPage(value => Math.max(1, value - 1))}
          pageCount={pageCount}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZES}
          totalRows={total}
        /> : null}
      >
        {deliveries.map(delivery => {
          const capability = getEmailCapability(settings, delivery.type);
          const retryable = ['failed', 'cancelled'].includes(delivery.status);
          return <DataTableRow key={delivery.id}>
            <DataTableCell label="Created" title={delivery.id}>{formatDate(delivery.createdAt)}</DataTableCell>
            <DataTableCell label="Type">{formatType(delivery.type)}</DataTableCell>
            <DataTableCell label="User">{delivery.targetUsername || '—'}</DataTableCell>
            <DataTableCell label="Recipient" title={delivery.recipient}>{delivery.recipient || '—'}</DataTableCell>
            <DataTableCell label="Status"><span className={`email-status-chip ${delivery.status}`}>{delivery.status}</span></DataTableCell>
            <DataTableCell label="Attempts">{delivery.attemptCount}</DataTableCell>
            <DataTableCell label="Next / sent">{formatDate(delivery.status === 'sent' ? delivery.sentAt : delivery.availableAt)}</DataTableCell>
            <DataTableCell label="Error" title={delivery.lastError}>{delivery.lastError || '—'}</DataTableCell>
            <DataTableCell label="Actions">
              <div className="email-queue-actions">
                {delivery.status === 'queued' && <button type="button" className="btn-secondary" onClick={() => runAction(delivery, 'cancel')} disabled={busyId === delivery.id}><XCircle size={14} />Cancel</button>}
                {retryable && <button type="button" className="btn-secondary" onClick={() => runAction(delivery, 'retry')} disabled={busyId === delivery.id || !capability.available} title={capability.available ? 'Retry email' : getEmailReasonCopy(capability.reason)}><RotateCcw size={14} />Retry</button>}
              </div>
            </DataTableCell>
          </DataTableRow>;
        })}
      </DataTable>
    </DataTableSection>
    <CredentialModal credential={credential} onClose={() => {
      const sessionEnded = credential?.sessionEnded;
      setCredential(null);
      if (sessionEnded) redirectAfterSelfSecurityChange();
    }} />
  </section>;
}
