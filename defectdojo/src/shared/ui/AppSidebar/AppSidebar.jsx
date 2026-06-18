import './AppSidebar.css';

const joinClassNames = (...classes) => classes.filter(Boolean).join(' ');

const AppSidebarNavItem = ({ item }) => {
  const Icon = item.icon;

  return (
    <button
      type="button"
      className={joinClassNames(
        'sidebar-nav-item',
        item.className,
        item.active && 'active',
        item.notification && 'notification'
      )}
      onClick={item.onClick}
      disabled={item.disabled}
      aria-current={item.active ? 'page' : undefined}
      title={item.badge > 0 ? `${item.label}: ${item.badge} pending` : item.title || item.label}
    >
      {Icon && <Icon size={19} className={item.iconClassName} />}
      <span>{item.label}</span>
      {item.badge > 0 && (
        <strong className="sidebar-nav-badge" aria-label={item.badgeLabel || `${item.badge} pending`}>
          {item.badge > 99 ? '99+' : item.badge}
        </strong>
      )}
    </button>
  );
};

const AppSidebar = ({
  brandIcon: BrandIcon,
  brandLabel,
  footerItems = [],
  navItems = [],
  user,
}) => (
  <aside className="app-sidebar" aria-label="Primary navigation">
    <div className="sidebar-brand">
      <span className="sidebar-brand-mark">
        {BrandIcon && <BrandIcon size={21} />}
      </span>
      <span>
        <strong>{brandLabel}</strong>
      </span>
    </div>

    {user && (
      <div className="sidebar-user">
        <span>{user.username}</span>
        <small>{user.role === 'admin' ? 'Admin' : 'Viewer'}</small>
      </div>
    )}

    <nav className="sidebar-nav" aria-label="Dashboard sections">
      {navItems.map(item => (
        <AppSidebarNavItem key={item.label} item={item} />
      ))}
    </nav>

    <div className="sidebar-footer">
      {footerItems.map(item => (
        <AppSidebarNavItem key={item.label} item={item} />
      ))}
    </div>
  </aside>
);

export default AppSidebar;
