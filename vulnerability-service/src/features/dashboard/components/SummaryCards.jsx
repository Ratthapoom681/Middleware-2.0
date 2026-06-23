import './SummaryCards.css';

const SummaryCards = ({ summary }) => {
  const defectDojo = summary?.defectDojo || {};
  const redmine = summary?.redmine || {};
  const cards = [
    { section: 'DefectDojo', label: 'Active findings', value: defectDojo.activeFindings || 0, tone: 'danger' },
    { section: 'DefectDojo', label: 'Mitigated findings', value: defectDojo.mitigatedFindings || 0, tone: 'success' },
    { section: 'Redmine', label: 'Ticket New', value: redmine.ticketNew || 0, tone: 'primary' },
    { section: 'Redmine', label: 'Ticket In Progress', value: redmine.ticketInProgress || 0, tone: 'warning' },
    { section: 'Redmine', label: 'Ticket Feedback', value: redmine.ticketFeedback || 0, tone: 'danger' },
    { section: 'Redmine', label: 'Ticket Resolve', value: redmine.ticketResolve || 0, tone: 'info' },
    { section: 'Redmine', label: 'Ticket Closed', value: redmine.ticketClosed || 0, tone: 'success' },
  ];

  return (
    <section className="stats-grid summary-grid" aria-label="Dashboard summary">
      {cards.map(card => (
        <div key={`${card.section}-${card.label}`} className={`stat-card stat-${card.tone}`}>
          <span className="stat-section">{card.section}</span>
          <span className="stat-value">{card.value}</span>
          <span className="stat-label">{card.label}</span>
        </div>
      ))}
    </section>
  );
};

export default SummaryCards;
