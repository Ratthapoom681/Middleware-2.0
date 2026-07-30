import HubTopbar from './HubTopbar/HubTopbar';
import './HubShell.css';

export default function HubShell({
  user,
  onOpenDocs,
  onOpenProfile,
  onLogout,
  children,
}) {
  return (
    <div className="hub-shell">
      <HubTopbar
        user={user}
        onOpenDocs={onOpenDocs}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
      <main className="hub-shell-content">{children}</main>
    </div>
  );
}
