import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import DashboardOverviewCards from './components/DashboardOverviewCards';
import { PageMain } from '../../shared/ui/Page';
import Topbar from '../../shared/ui/Topbar/Topbar';
import './Dashboard.css';

const DashboardPage = ({
  bulkOpeningRedmine,
  compactedFindingsForStats,
  dashboardLoading,
  dashboardSummary,
  dashboardRedmineSummary,
  dashboardSync,
  dashboardSyncLabel,
  dashboardSyncTitle,
  onOpenSyncAllFilters,
  findingsContent,
  redmineSyncLabel,
  redmineSyncStatus,
  redmineSyncTitle,
  syncAllCount,
  uniqueProducts,
  user,
}) => (
  <>
    <Topbar
      icon={AlertTriangle}
      eyebrow="System Overview"
      title="Security Dashboard"
      actions={(
        <div className="dashboard-hero-actions" aria-label="Dashboard sync status">
          <span className="user-pill">
            User: {user.username} {user.role === 'admin' ? '(Admin)' : ''}
          </span>
          <span
            className={`dashboard-sync-pill ${dashboardSync.connected ? 'connected' : 'reconnecting'}`}
            title={dashboardSyncTitle}
          >
            <Database size={14} />
            {dashboardSyncLabel}
          </span>
          <span
            className={`redmine-sync-pill ${redmineSyncStatus.lastError ? 'error' : redmineSyncStatus.enabled ? 'enabled' : 'disabled'}`}
            title={redmineSyncTitle}
          >
            <RefreshCw size={14} className={redmineSyncStatus.running ? 'spin' : ''} />
            {redmineSyncLabel}
          </span>

          {user?.role === 'admin' && (
          <button
            type="button"
            className="btn-secondary sync-all-btn"
            onClick={onOpenSyncAllFilters}
            disabled={bulkOpeningRedmine}
            title="Choose DefectDojo pull filters, then sync every compacted ticket in Redmine"
          >
            <RefreshCw size={14} className={bulkOpeningRedmine ? 'spin' : ''} />
            {bulkOpeningRedmine ? 'Syncing...' : `Sync Findings (${syncAllCount ?? compactedFindingsForStats.length})`}
            </button>
          )}
        </div>
      )}
    />

    <PageMain>
      <DashboardOverviewCards
        compactedFindings={compactedFindingsForStats}
        loading={dashboardLoading}
        redmineSummary={dashboardRedmineSummary}
        summary={dashboardSummary}
        productCount={uniqueProducts.length}
      />

      {findingsContent}
    </PageMain>
  </>
);

export default DashboardPage;
