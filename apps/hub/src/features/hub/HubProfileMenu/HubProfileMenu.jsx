import { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { getAccess } from '../../../../../../packages/access-control/index.js';
import './HubProfileMenu.css';

export default function HubProfileMenu({ user, onOpenProfile, onLogout }) {
  const access = getAccess(user);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activate = callback => {
    setOpen(false);
    callback();
  };

  return (
    <div className="hub-profile-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="hub-profile-trigger"
        onClick={() => setOpen(value => !value)}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="hub-profile-avatar" aria-hidden="true">{String(user?.username || 'U').slice(0, 1).toUpperCase()}</span>
        <span className="hub-profile-copy"><strong>{user?.username || 'User'}</strong><small>{access.role.name}</small></span>
      </button>
      {open && (
        <div className="hub-profile-popover" role="menu">
          <div className="hub-profile-identity">
            <strong>{user?.username || 'User'}</strong>
            <span>{user?.email || 'No email set'}</span>
          </div>
          <button type="button" role="menuitem" onClick={() => activate(onOpenProfile)}>
            <UserRound size={17} />Your profile
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => activate(onLogout)}>
            <LogOut size={17} />Sign out
          </button>
        </div>
      )}
    </div>
  );
}
