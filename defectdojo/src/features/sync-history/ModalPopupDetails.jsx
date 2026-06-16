import { X } from 'lucide-react';

const FINDING_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

const ModalPopupDetails = ({ row, onClose }) => {
  if (!row) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-content sync-history-finding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-history-finding-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <div>
              <h2 id="sync-history-finding-title">New Findings</h2>
              <p className="modal-subtitle">
                {row.company} / {row.scope} / {row.dateTime}
              </p>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close new finding details"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="sync-history-severity-list">
          {FINDING_SEVERITIES.map(severity => (
            <div key={severity} className={`sync-history-severity-row ${severity.toLowerCase()}`}>
              <span>{severity}</span>
              <strong>{row.severityDelta?.[severity] || 0}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModalPopupDetails;
