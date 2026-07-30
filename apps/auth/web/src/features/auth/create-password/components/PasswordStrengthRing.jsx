const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STRENGTH_META = [
  { label: '', color: 'transparent' },
  { label: 'Weak', color: 'var(--strength-weak)' },
  { label: 'Fair', color: 'var(--strength-fair)' },
  { label: 'Good', color: 'var(--strength-good)' },
  { label: 'Strong', color: 'var(--strength-strong)' },
];

export function getStrengthMeta(strength) {
  const normalizedStrength = Math.min(4, Math.max(0, Number(strength) || 0));
  return {
    ...STRENGTH_META[normalizedStrength],
    strength: normalizedStrength,
    percentage: normalizedStrength * 25,
  };
}

export default function PasswordStrengthRing({ strength }) {
  const meta = getStrengthMeta(strength);
  const dashOffset = CIRCUMFERENCE * (1 - meta.strength / 4);

  return (
    <div
      className={`strength-ring-wrapper strength-${meta.strength}`}
      role="progressbar"
      aria-label={meta.label ? `Password strength: ${meta.label}` : 'Password strength'}
      aria-valuemin="0"
      aria-valuemax="4"
      aria-valuenow={meta.strength}
      aria-valuetext={meta.label || 'Empty'}
    >
      <svg className="strength-ring" viewBox="0 0 48 48" aria-hidden="true">
        <circle className="strength-ring-track" cx="24" cy="24" r={RADIUS} />
        <circle
          className="strength-ring-value"
          cx="24"
          cy="24"
          r={RADIUS}
          style={{
            stroke: meta.color,
            strokeDasharray: CIRCUMFERENCE,
            strokeDashoffset: dashOffset,
          }}
        />
      </svg>
      <span className="strength-percentage">{meta.percentage}%</span>
    </div>
  );
}
