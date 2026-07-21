import { BookOpen, Shield } from 'lucide-react';
import HubProfileMenu from '../HubProfileMenu/HubProfileMenu';
import './HubTopbar.css';

export default function HubTopbar({ user, onOpenDocs, onOpenProfile, onLogout }) {
  return (
    <header className="hub-topbar">
      <div className="topbar-brand">
        <Shield className="brand-logo-icon" size={20} />
        <span className="brand-text">Internal Security Middleware Hub</span>
      </div>
      <div className="topbar-user">
        <button type="button" className="btn-docs" onClick={onOpenDocs} title="Documentation">
          <BookOpen size={16} />
          <span>Documentation</span>
        </button>
        <HubProfileMenu user={user} onOpenProfile={onOpenProfile} onLogout={onLogout} />
      </div>
    </header>
  );
}
