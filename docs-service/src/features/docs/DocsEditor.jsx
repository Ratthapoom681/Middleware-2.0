import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  History,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  LoaderCircle,
  Quote,
  Save,
  Table,
  X,
} from 'lucide-react';

export default function DocsEditor({
  token,
  documentId,
  initialContent,
  title,
  onSave,
  onCancel,
}) {
  const [content, setContent] = useState(initialContent || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const textareaRef = useRef(null);

  // Load version history
  useEffect(() => {
    if (!documentId) return;
    setLoadingHistory(true);
    fetch(`/docs/api/docs/${documentId}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load version history');
        return res.json();
      })
      .then((data) => {
        setHistory(data.history || []);
      })
      .catch((err) => {
        console.error('History load error:', err);
      })
      .finally(() => {
        setLoadingHistory(false);
      });
  }, [documentId, token]);

  const insertText = (before, after = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const selectedText = text.substring(start, end);
    const replacement = before + selectedText + after;

    setContent(text.substring(0, start) + replacement + text.substring(end));

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + before.length,
        start + before.length + selectedText.length
      );
    }, 0);
  };

  const handleSave = async () => {
    if (!content.trim()) {
      setError('Content cannot be empty');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`/docs/api/docs/${documentId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save changes');
      }

      onSave(content, data.updatedAt);
    } catch (err) {
      setError(err.message || 'An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = async (timestamp, dateStr) => {
    if (!window.confirm(`Are you sure you want to revert this document to the version from ${new Date(dateStr).toLocaleString()}? This will overwrite the current content on the server.`)) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`/docs/api/docs/${documentId}/revert`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestamp }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to revert to this backup');
      }

      // Fetch the reverted document contents from server or reload page
      onSave('', data.updatedAt, true); // true forces a reload
    } catch (err) {
      setError(err.message || 'An error occurred while reverting.');
    } finally {
      setSaving(false);
      setShowHistory(false);
    }
  };

  const hasChanges = content !== initialContent;

  const handleCancelClick = () => {
    if (hasChanges) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to discard them?')) {
        return;
      }
    }
    onCancel();
  };

  return (
    <div className="docs-editor-container">
      <div className="docs-editor-header">
        <div className="docs-editor-title-area">
          <h2>Editing: {title}</h2>
          {hasChanges && <span className="dirty-indicator">Unsaved changes</span>}
        </div>
        <div className="docs-editor-actions">
          <button
            type="button"
            className="docs-editor-btn secondary"
            onClick={() => setShowHistory(!showHistory)}
            title="Version History"
          >
            <History size={16} />
            <span>History ({history.length})</span>
          </button>
          <button
            type="button"
            className="docs-editor-btn secondary"
            onClick={handleCancelClick}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="docs-editor-btn primary"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? (
              <>
                <LoaderCircle size={16} className="spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Save changes</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && <div className="docs-editor-error">{error}</div>}

      <div className="docs-editor-toolbar">
        <button type="button" onClick={() => insertText('**', '**')} title="Bold">
          <Bold size={15} />
        </button>
        <button type="button" onClick={() => insertText('*', '*')} title="Italic">
          <Italic size={15} />
        </button>
        <button type="button" onClick={() => insertText('# ')} title="Heading 1">
          <Heading1 size={15} />
        </button>
        <button type="button" onClick={() => insertText('## ')} title="Heading 2">
          <Heading2 size={15} />
        </button>
        <button type="button" onClick={() => insertText('### ')} title="Heading 3">
          <Heading3 size={15} />
        </button>
        <div className="toolbar-divider" />
        <button type="button" onClick={() => insertText('- ')} title="Bullet List">
          <List size={15} />
        </button>
        <button type="button" onClick={() => insertText('1. ')} title="Numbered List">
          <ListOrdered size={15} />
        </button>
        <button type="button" onClick={() => insertText('> ')} title="Blockquote">
          <Quote size={15} />
        </button>
        <div className="toolbar-divider" />
        <button type="button" onClick={() => insertText('`', '`')} title="Inline Code">
          <Code size={15} />
        </button>
        <button type="button" onClick={() => insertText('```\n', '\n```')} title="Code Block">
          <Code size={15} style={{ strokeWidth: 3 }} />
        </button>
        <button type="button" onClick={() => insertText('[', '](url)')} title="Insert Link">
          <LinkIcon size={15} />
        </button>
        <button type="button" onClick={() => insertText('![alt text](', ')')} title="Insert Image">
          <ImageIcon size={15} />
        </button>
        <button
          type="button"
          onClick={() =>
            insertText(
              '\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n'
            )
          }
          title="Insert Table"
        >
          <Table size={15} />
        </button>
      </div>

      <div className="docs-editor-workspace">
        <div className="docs-editor-pane editor">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write markdown here..."
            spellCheck="false"
          />
        </div>
        <div className="docs-editor-pane preview markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content || '*No content to preview*'}
          </ReactMarkdown>
        </div>
      </div>

      {showHistory && (
        <div className="docs-editor-history-modal" onClick={() => setShowHistory(false)}>
          <div className="history-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="history-modal-header">
              <h3>Version History</h3>
              <button type="button" onClick={() => setShowHistory(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="history-modal-body">
              {loadingHistory ? (
                <div className="history-loading">
                  <LoaderCircle size={20} className="spin" />
                  <span>Loading history...</span>
                </div>
              ) : history.length === 0 ? (
                <p className="no-history">No older versions backed up for this document yet.</p>
              ) : (
                <div className="history-list">
                  {history.map((version) => (
                    <div key={version.timestamp} className="history-item">
                      <div className="version-info">
                        <strong>{new Date(version.date).toLocaleString()}</strong>
                        <span className="version-id">ID: {version.timestamp}</span>
                      </div>
                      <button
                        type="button"
                        className="docs-editor-btn secondary sm"
                        onClick={() => handleRevert(version.timestamp, version.date)}
                      >
                        Restore this version
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
