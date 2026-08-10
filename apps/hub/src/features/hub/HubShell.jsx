import HubTopbar from './HubTopbar/HubTopbar';
import './HubShell.css';

export default function HubShell({
  user,
  onBack,
  backLabel,
  onOpenDocs,
  onOpenProfile,
  onLogout,
  children,
}) {
  return (
    <div className="hub-shell">
      <HubTopbar
        user={user}
        onBack={onBack}
        backLabel={backLabel}
        onOpenDocs={onOpenDocs}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
      <main className="hub-shell-content">{children}</main>
    </div>
  );
}
