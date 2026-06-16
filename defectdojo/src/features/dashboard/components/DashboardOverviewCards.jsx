import {
  Archive,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Flame,
  Gauge,
  Info,
  Inbox,
  MessageSquareWarning,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import './DashboardOverviewCards.css';

const severityItems = [
  { key: 'Critical', label: 'Critical', className: 'critical', Icon: CircleAlert },
  { key: 'High', label: 'High', className: 'high', Icon: Flame },
  { key: 'Medium', label: 'Medium', className: 'medium', Icon: Gauge },
  { key: 'Low', label: 'Low', className: 'low', Icon: ShieldCheck },
  { key: 'Info', label: 'Info', className: 'info', Icon: Info },
];

const workflowItems = [
  { key: 'ticketNew', label: 'New', className: 'new', Icon: Inbox },
  { key: 'ticketInProgress', label: 'In Progress', className: 'progress', Icon: Timer },
  { key: 'ticketFeedback', label: 'Feedback', className: 'feedback', Icon: MessageSquareWarning },
  { key: 'ticketResolve', label: 'Resolved', className: 'resolved', Icon: CheckCircle2 },
  { key: 'ticketClosed', label: 'Closed', className: 'closed', Icon: Archive },
];

const formatCount = (value, loading) => {
  if (loading) return '...';
  const numericValue = Number(value || 0);
  return numericValue.toLocaleString();
};

const buildSeverityCounts = (findings = []) => {
  const counts = Object.fromEntries(severityItems.map(item => [item.key, 0]));

  findings.forEach((finding) => {
    const rawSeverity = String(finding?.severity || '').toLowerCase();
    const severity = severityItems.find(item => item.key.toLowerCase() === rawSeverity)?.key || 'Info';
    counts[severity] += 1;
  });

  return counts;
};

const DashboardOverviewCards = ({
  compactedFindings = [],
  loading = false,
  redmineSummary,
  summary,
}) => {
  const defectDojo = summary?.defectDojo || {};
  const redmine = redmineSummary || summary?.redmine || {};
  const severityCounts = buildSeverityCounts(compactedFindings);

  return (
    <section className="dashboard-soc-overview" aria-label="Dashboard summary">
      <article className="soc-card soc-card-vulnerability">
        <div className="soc-card-header">
          <div className="soc-card-title-row">
            <ShieldAlert size={26} aria-hidden="true" />
            <div>
              <h2>Vulnerability Status</h2>
            </div>
          </div>
        </div>

        <div className="vulnerability-flow" aria-label="Active and mitigated findings">
          <div className="vulnerability-count-box active">
            <strong>{formatCount(defectDojo.activeFindings, loading)}</strong>
            <span>Active Findings</span>
          </div>
          <div className="vulnerability-flow-arrow" aria-hidden="true">
            <span />
            <ArrowRight size={28} />
          </div>
          <div className="vulnerability-count-box mitigated">
            <strong>{formatCount(defectDojo.mitigatedFindings, loading)}</strong>
            <span>Mitigated Findings</span>
          </div>
        </div>
      </article>

      <article className="soc-card soc-card-workflow">
        <div className="soc-card-header">
          <div className="soc-card-title-row">
            <CheckCircle2 size={26} aria-hidden="true" />
            <div>
              <h2>Ticket Workflow</h2>
            </div>
          </div>
        </div>

        <div className="ticket-workflow-grid">
          {workflowItems.map(({ key, label, className, Icon }) => (
            <div key={key} className={`workflow-tile ${className}`}>
              <strong>{formatCount(redmine[key], loading)}</strong>
              <Icon size={24} aria-hidden="true" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="soc-card soc-card-severity">
        <div className="soc-card-header">
          <div className="soc-card-title-row">
            <Gauge size={26} aria-hidden="true" />
            <div>
              <h2>Severity &amp; Risk Distribution</h2>
            </div>
          </div>
        </div>

        <div className="severity-distribution-grid">
          {severityItems.map(({ key, label, className, Icon }) => (
            <div key={key} className={`severity-distribution-block ${className}`}>
              <Icon size={26} aria-hidden="true" />
              <strong>{formatCount(severityCounts[key], loading)}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
};

export default DashboardOverviewCards;
