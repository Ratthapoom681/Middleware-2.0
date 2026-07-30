import { useEffect, useState } from 'react';

export default function SuccessOverlay({ onComplete }) {
  const [phase, setPhase] = useState('success');

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setPhase('signing');
      const completionTimer = window.setTimeout(onComplete, 250);
      return () => window.clearTimeout(completionTimer);
    }

    const signingTimer = window.setTimeout(() => setPhase('signing'), 2500);
    const completionTimer = window.setTimeout(onComplete, 3500);

    return () => {
      window.clearTimeout(signingTimer);
      window.clearTimeout(completionTimer);
    };
  }, [onComplete]);

  return (
    <div className="success-overlay" data-phase={phase} role="status" aria-live="polite">
      {phase === 'success' ? (
        <div className="success-confirmation">
          <svg className="success-mark" viewBox="0 0 72 72" aria-hidden="true">
            <circle className="success-circle" cx="36" cy="36" r="31" />
            <path className="success-check" d="m21 37 10 10 21-23" />
          </svg>
          <div className="success-text">Password changed!</div>
          <div className="success-subtext">Your account is now protected.</div>
        </div>
      ) : (
        <div className="success-signing">
          <span className="spinner" aria-hidden="true" />
          <div className="success-text">Signing you in…</div>
        </div>
      )}
    </div>
  );
}
