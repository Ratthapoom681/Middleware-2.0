import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  History,
  LogOut,
  Settings,
} from 'lucide-react';
import AppSidebar from '../shared/ui/AppSidebar/AppSidebar';
import './AppShell.css';

const AppShell = ({
  children,
  currentHash,
  mitigationReviewPendingCount = 0,
  onLogout,
  onNavigate,
  onOpenMitigationReview,
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
      label: 'Back to Hub',
      icon: ArrowLeft,
      onClick: () => { window.location.href = '/'; },
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
