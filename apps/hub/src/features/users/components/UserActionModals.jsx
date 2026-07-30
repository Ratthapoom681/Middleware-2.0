import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Clipboard,
  Clock3,
  KeyRound,
  LoaderCircle,
  MailCheck,
  MailX,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import {
  getMfaProvider,
  getMfaProviderLabel,
  hasDeliverableEmail,
  MFA_PROVIDER_OPTIONS,
} from '../mfaDeliveryStatus.js';
import { formatDate, formatLabel } from '../userHelpers.js';
import './UserActionModals.css';

export function useDialogFocus(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const root = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(root.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
    ));
    (root.querySelector('[autofocus]') || focusable()[0])?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const [first] = items;
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      requestAnimationFrame(() => {
        if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body)) {
          previous.focus();
        }
      });
    };
  }, [open]);
  return ref;
}

export function MfaDeliveryIcon({ view }) {
  if (view.mfaStatus === 'enabled') return <ShieldCheck size={13} aria-hidden="true" />;
  if (view.mfaStatus === 'disabled') return <ShieldOff size={13} aria-hidden="true" />;
  if (view.deliveryStatus === 'queued') return <Clock3 size={13} aria-hidden="true" />;
  if (view.deliveryStatus === 'sending') {
    return <LoaderCircle className="mfa-delivery-spinner" size={13} aria-hidden="true" />;
  }
  if (view.deliveryStatus === 'sent') return <MailCheck size={13} aria-hidden="true" />;
  return <MailX size={13} aria-hidden="true" />;
}

function ModalHeader({ icon: Icon, id, title, description, onClose }) {
  return (
    <div className="modal-header">
      <div className="modal-heading">
        {Icon && <span className="modal-heading-icon"><Icon size={19} aria-hidden="true" /></span>}
        <div><h2 id={id}>{title}</h2><p>{description}</p></div>
      </div>
      {onClose && (
        <button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function PasswordResetModal({ user, saving, error, onClose, onSubmit }) {
  const ref = useDialogFocus(Boolean(user), onClose);
  if (!user) return null;
  const deliveryCopy = hasDeliverableEmail(user.email)
    ? `The new password will be emailed to ${user.email} and displayed once for copying.`
    : 'No deliverable email is saved. The new password will only be displayed once for manual copying.';
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={ref} className="user-modal password-reset-modal modal-accent-danger" role="dialog" aria-modal="true" aria-labelledby="password-reset-title" onMouseDown={event => event.stopPropagation()}>
        <ModalHeader icon={ShieldAlert} id="password-reset-title" title={`Generate temporary password: ${user.username}`} description="This replaces the current password, expires in 24 hours, and revokes every active session." onClose={onClose} />
        <form className="user-form" onSubmit={onSubmit}>
          {error && <div className="modal-error" role="alert">{error}</div>}
          <p className="modal-copy">{deliveryCopy}</p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={saving} autoFocus>
              {saving ? 'Generating…' : 'Generate and revoke sessions'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SecurityActionModal({
  securityAction,
  saving,
  error,
  onClose,
  onProviderChange,
  onSubmit,
}) {
  const ref = useDialogFocus(Boolean(securityAction), onClose);
  if (!securityAction) return null;
  const { type, user } = securityAction;
  const descriptions = {
    enable: 'Select an authenticator app, mark setup as pending, and queue the setup email.',
    change: 'Assign a different app. Existing enrollment is cleared and active sessions may be revoked.',
    resend: `Queue the ${getMfaProviderLabel(getMfaProvider(user))} setup link again.`,
    reset: `Clear ${getMfaProviderLabel(getMfaProvider(user))}, revoke sessions, and queue a new setup.`,
    disable: 'Clear authenticator access and revoke all active sessions.',
  };
  const dangerous = ['reset', 'disable'].includes(type);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={ref} className={`user-modal security-action-modal ${dangerous ? 'modal-accent-warning' : 'modal-accent-primary'}`} role="dialog" aria-modal="true" aria-labelledby="security-action-title" onMouseDown={event => event.stopPropagation()}>
        <ModalHeader icon={dangerous ? AlertTriangle : ShieldCheck} id="security-action-title" title={`${formatLabel(type)} Authenticator MFA: ${user.username}`} description={descriptions[type]} onClose={onClose} />
        <form className="user-form" onSubmit={onSubmit}>
          {error && <div className="modal-error" role="alert">{error}</div>}
          {['enable', 'change'].includes(type) && (
            <div className="modal-section">
              <span className="modal-section-label">Authenticator assignment</span>
              <label>
                <span>Authenticator app</span>
                <select value={securityAction.provider || 'google'} onChange={event => onProviderChange(event.target.value)} autoFocus>
                  {MFA_PROVIDER_OPTIONS.filter(option => option.value !== 'disabled').map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className={dangerous ? 'btn-danger' : 'btn-primary'} disabled={saving} autoFocus={!['enable', 'change'].includes(type)}>
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function CredentialModal({ credential, onClose }) {
  const ref = useDialogFocus(Boolean(credential), () => {});
  if (!credential) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={ref} className="user-modal credential-modal modal-accent-warning" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title">
        <ModalHeader icon={KeyRound} id="temporary-password-title" title={`Temporary password for ${credential.username}`} description="This credential is displayed once and expires in 24 hours." />
        <div className="user-form">
          <div className="credential-warning"><AlertTriangle size={17} aria-hidden="true" /><span>Save this password now. It cannot be shown again after you close this dialog.</span></div>
          <div className="credential-display">
            <code>{credential.password}</code>
            <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(credential.password)}><Clipboard size={15} />Copy</button>
          </div>
          <small>{credential.deliveryMode === 'queued' ? 'The email was queued automatically. Plain SMTP may expose this password in transit.' : 'No deliverable email was available. Provide this password to the user manually.'}</small>
          <div className="modal-actions"><button type="button" className="btn-primary" onClick={onClose}>I saved it</button></div>
        </div>
      </section>
    </div>
  );
}

export function MfaDeliveryModal({ deliveryUser, deliveryView, onClose, onResend }) {
  const open = Boolean(deliveryUser && deliveryView?.pending);
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;
  const statusCopy = deliveryView.deliveryStatus === 'sent'
    ? 'SMTP accepted the message. The user must still complete enrollment.'
    : deliveryView.deliveryStatus === 'sending'
      ? 'The email worker is contacting the configured SMTP server.'
      : deliveryView.deliveryStatus === 'queued'
        ? 'The message is waiting for the email worker.'
        : 'The user has not received a usable setup email from this attempt.';
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={ref} className={`user-modal mfa-delivery-modal modal-accent-${deliveryView.tone === 'failed' ? 'danger' : deliveryView.tone === 'queued' ? 'warning' : 'info'}`} role="dialog" aria-modal="true" aria-labelledby="mfa-delivery-title" onMouseDown={event => event.stopPropagation()}>
        <ModalHeader icon={MailCheck} id="mfa-delivery-title" title={`Authenticator email: ${deliveryUser.username}`} description={`Current setup-email status for ${deliveryView.providerLabel}.`} onClose={onClose} />
        <div className="user-form">
          <div className={`mfa-delivery-summary ${deliveryView.tone}`} role="status" aria-live="polite"><MfaDeliveryIcon view={deliveryView} /><div><strong>{deliveryView.label}</strong><span>{statusCopy}</span></div></div>
          <dl className="mfa-delivery-details">
            <div><dt>Recipient</dt><dd>{deliveryUser.email || 'No valid email saved'}</dd></div>
            <div><dt>Assigned app</dt><dd>{deliveryView.providerLabel}</dd></div>
            <div><dt>Setup requested</dt><dd>{deliveryUser.mfaRequestedAt ? formatDate(deliveryUser.mfaRequestedAt) : 'Not recorded'}</dd></div>
            <div><dt>Last attempt</dt><dd>{deliveryUser.mfaNotificationAttemptedAt ? formatDate(deliveryUser.mfaNotificationAttemptedAt) : 'Not attempted yet'}</dd></div>
            <div><dt>Email sent</dt><dd>{deliveryUser.mfaNotificationSentAt ? formatDate(deliveryUser.mfaNotificationSentAt) : 'Not sent yet'}</dd></div>
          </dl>
          {deliveryView.failureMessage && <div className="mfa-delivery-guidance" role="alert"><MailX size={16} aria-hidden="true" /><span>{deliveryView.failureMessage}</span></div>}
          {!deliveryView.canResend && deliveryView.resendDisabledReason && <p className="mfa-delivery-disabled-reason">{deliveryView.resendDisabledReason}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="btn-primary" disabled={!deliveryView.canResend} onClick={onResend}><MailCheck size={15} />Resend setup email</button>
          </div>
        </div>
      </section>
    </div>
  );
}
