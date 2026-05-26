import {
  AlertTriangle,
  Bell,
  History,
  LogOut,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react';
import ThemeToggle from '../shared/ui/ThemeToggle';

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
  const isDashboard = !currentHash;
  const navItems = [
    {
      label: 'Dashboard',
      icon: AlertTriangle,
      active: isDashboard,
      onClick: () => onNavigate(''),
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
        label: 'Users',
        icon: Users,
        active: currentHash === '#users',
        onClick: () => onNavigate('#users'),
      },
      {
        label: 'Settings',
        icon: Settings,
        active: currentHash === '#settings',
        onClick: () => onNavigate('#settings'),
      },
    ] : []),
  ];

  return (
    <div className="app-shell">
      <aside
        className="app-sidebar"
        aria-label="Primary navigation"
      >
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">
            <AlertTriangle size={20} />
          </span>
          <span>
            <strong>DefectDojo</strong>
            <small>Viewer</small>
          </span>
        </div>

        <div className="sidebar-user">
          <span>{user.username}</span>
          <small>{user.role === 'admin' ? 'Admin' : 'Viewer'}</small>
        </div>

        <nav className="sidebar-nav" aria-label="Dashboard sections">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                className={`sidebar-nav-item ${item.active ? 'active' : ''} ${item.notification ? 'notification' : ''}`}
                onClick={item.onClick}
                aria-current={item.active ? 'page' : undefined}
                title={item.badge > 0 ? `${item.label}: ${item.badge} pending` : item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.badge > 0 && (
                  <strong className="sidebar-nav-badge" aria-label={`${item.badge} pending mitigation reviews`}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </strong>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-theme-row">
            <span>Theme</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            className="sidebar-nav-item utility"
            onClick={onRefresh}
            disabled={loading || dashboardLoading}
            title="Refresh findings"
          >
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="sidebar-nav-item danger"
            onClick={onLogout}
            title="Logout"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {children}
    </div>
  );
};

export default AppShell;
