import { useEffect, useState } from 'react';
import { CheckCircle2, History, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../shared/api/api';
import MitigationHistory from './MitigationHistory';
import MitigationQueue from './MitigationQueue';
import './MitigationReview.css';

const MitigationReview = ({ onBack, config = {} }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState('queue');
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/admin/mitigation-queue');
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await apiFetch('/admin/mitigation-actions?limit=200');
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(Array.isArray(data) ? data : []);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      fetchQueue();
      fetchHistory();
    });
  }, []);

  const handleActionSuccess = async () => {
    await Promise.all([fetchQueue(), fetchHistory()]);
  };

  const isBusy = loading || historyLoading;

  return (
    <div className="review-view">
      <div className="review-view-tabs" role="tablist" aria-label="Mitigation review pages">
        <button
          type="button"
          className={activeView === 'queue' ? 'active' : ''}
          onClick={() => setActiveView('queue')}
          role="tab"
          aria-selected={activeView === 'queue'}
        >
          <CheckCircle2 size={16} />
          Queue
          <span>{items.length}</span>
        </button>
        <button
          type="button"
          className={activeView === 'history' ? 'active' : ''}
          onClick={() => setActiveView('history')}
          role="tab"
          aria-selected={activeView === 'history'}
        >
          <History size={16} />
          History & Logs
          <span>{historyItems.length}</span>
        </button>
      </div>

      {activeView === 'history' ? (
        <MitigationHistory
          historyItems={historyItems}
          loading={historyLoading}
          fetchHistory={fetchHistory}
          config={config}
        />
      ) : (
        <MitigationQueue
          items={items}
          loading={loading}
          fetchQueue={fetchQueue}
          onActionSuccess={handleActionSuccess}
          config={config}
        />
      )}
    </div>
  );
};

export default MitigationReview;
