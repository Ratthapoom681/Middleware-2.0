import { ArrowLeft, BookOpen, Shield } from 'lucide-react';
import HubProfileMenu from '../HubProfileMenu/HubProfileMenu';
import { hasPermission } from '../../../../../../packages/access-control/index.js';
import './HubTopbar.css';

export default function HubTopbar({ user, onBack, backLabel = 'Back to Hub', onOpenDocs, onOpenProfile, onLogout }) {
  return (
    <header className="hub-topbar">
      <div className="topbar-leading">
        {onBack && (
          <button
            type="button"
            className="topbar-back"
            onClick={onBack}
            aria-label={backLabel}
            title={backLabel}
          >
            <ArrowLeft size={17} />
            <span>{backLabel}</span>
          </button>
        )}
        <div className="topbar-brand">
          <Shield className="brand-logo-icon" size={20} />
          <span className="brand-text">Internal Security Middleware Hub</span>
        </div>
      </div>
      <div className="topbar-user">
        {hasPermission(user, 'docs.view') && <button type="button" className="btn-docs" onClick={onOpenDocs} title="Documentation">
          <BookOpen size={16} />
          <span>Documentation</span>
        </button>}
        <HubProfileMenu user={user} onOpenProfile={onOpenProfile} onLogout={onLogout} />
      </div>
    </header>
  );
}
