import './Topbar.css';

const joinClassNames = (...classes) => classes.filter(Boolean).join(' ');

const Topbar = ({
  actions,
  className = '',
  description,
  eyebrow,
  icon: Icon,
  metrics = [],
  title,
}) => (
  <header className={joinClassNames('topbar', className)}>
    <div className="topbar-inner">
      {Icon && (
        <div className="topbar-icon" aria-hidden="true">
          <Icon size={23} />
        </div>
      )}

      <div className="topbar-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="topbar-description">{description}</p>}
      </div>

      {metrics.length > 0 && (
        <div className="topbar-metrics" aria-label={`${title} summary`}>
          {metrics.map(metric => (
            <div
              key={`${metric.label}-${metric.value}`}
              className={joinClassNames('topbar-metric', metric.tone && `topbar-metric-${metric.tone}`)}
            >
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
      )}

      {actions && (
        <div className="topbar-actions">
          {actions}
        </div>
      )}
    </div>
  </header>
);

export default Topbar;
