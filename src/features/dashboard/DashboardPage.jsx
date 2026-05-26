import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import DashboardOverviewCards from './DashboardOverviewCards';
import '../products/ProductsPage.css';

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
  uniqueProducts,
  user,
}) => (
  <>
    <header className="products-hero dashboard-hero">
      <div className="products-hero-inner dashboard-hero-inner">
        <div className="products-hero-icon-wrap">
          <span className="products-hero-ring" />
          <span className="products-hero-ring products-hero-ring--delay" />
          <AlertTriangle size={28} />
        </div>

        <div className="products-hero-copy">
          <p className="eyebrow">DefectDojo Viewer</p>
          <h1>Security Dashboard</h1>
          <p className="products-hero-sub">
            Unified vulnerability and ticket management overview.
          </p>
        </div>

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
            {bulkOpeningRedmine ? 'Syncing...' : `Sync All (${compactedFindingsForStats.length})`}
          </button>
          )}
        </div>
      </div>
    </header>

    <main className="main-content">
      <DashboardOverviewCards
        compactedFindings={compactedFindingsForStats}
        loading={dashboardLoading}
        redmineSummary={dashboardRedmineSummary}
        summary={dashboardSummary}
        productCount={uniqueProducts.length}
      />

      {findingsContent}
    </main>
  </>
);

export default DashboardPage;
