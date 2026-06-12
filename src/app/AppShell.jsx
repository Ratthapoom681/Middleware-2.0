import {
  AlertTriangle,
  Bell,
  History,
  LogOut,
  RefreshCw,
  Settings,
} from 'lucide-react';
import AppSidebar from '../shared/ui/AppSidebar/AppSidebar';
import './AppShell.css';

const AppShell = ({
  children,
  currentHash,
  dashboardLoading,
  loading,
  mitigationReviewPendingCount = 0,
  onLogout,
  onNavigate,
  onOpenMitigationReview,
  onRefresh,
  user,
}) => {
  const isDashboard = !currentHash || currentHash === '#dashboard';
  const navItems = [
    {
      label: 'Dashboard',
      icon: AlertTriangle,
      active: isDashboard,
      onClick: () => onNavigate('#dashboard'),
    },
    ...(user?.role === 'admin' ? [
      {
        label: 'Sync History',
        icon: History,
        active: currentHash === '#sync-history',
        onClick: () => onNavigate('#sync-history'),
      },
      {
        label: 'Mitigation Review',
        icon: Bell,
        active: currentHash === '#mitigation-review',
        badge: mitigationReviewPendingCount,
        notification: mitigationReviewPendingCount > 0,
        onClick: onOpenMitigationReview,
      },
      {
        label: 'Settings',
        icon: Settings,
        active: currentHash.startsWith('#settings'),
        onClick: () => onNavigate('#settings'),
      },
    ] : []),
  ];
  const footerItems = [
    {
      label: 'Refresh',
      icon: RefreshCw,
      iconClassName: loading ? 'spin' : '',
      className: 'utility',
      disabled: loading || dashboardLoading,
      onClick: onRefresh,
      title: 'Refresh findings',
    },
    {
      label: 'Logout',
      icon: LogOut,
      className: 'danger',
      onClick: onLogout,
      title: 'Logout',
    },
  ];

  return (
    <div className="app-shell">
      <AppSidebar
        brandIcon={AlertTriangle}
        brandLabel="ทดสอบ"
        footerItems={footerItems}
        navItems={navItems}
        user={user}
      />

      {children}
    </div>
  );
};

export default AppShell;
