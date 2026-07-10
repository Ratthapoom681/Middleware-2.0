import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  CheckCircle,
  FileText,
  LoaderCircle,
  Upload,
  X,
} from 'lucide-react';

export default function DocsImport({ token, documents, onImportSuccess, onClose }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState('custom');
  const [adminOnly, setAdminOnly] = useState(false);
  const [overwriteDocId, setOverwriteDocId] = useState('');
  
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { id, title, markdown }

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    const name = selectedFile.name;
    const isDocx = name.toLowerCase().endsWith('.docx');
    const isMd = name.toLowerCase().endsWith('.md');

    if (!isDocx && !isMd) {
      setError('Only .md and .docx files are supported');
      setFile(null);
      return;
    }

    setError('');
    setFile(selectedFile);

    // Auto-fill title from filename if not already set
    if (!title) {
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.')) || name;
      // Convert hyphens/underscores to spaces and capitalize
      const friendlyName = nameWithoutExt
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
      setTitle(friendlyName);
    }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file to import');
      return;
    }
    if (!overwriteDocId && !title.trim()) {
      setError('Please enter a title for the new document');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      if (overwriteDocId) {
        formData.append('documentId', overwriteDocId);
      } else {
        formData.append('title', title);
        formData.append('groupId', groupId);
        formData.append('adminOnly', adminOnly);
      }

      const response = await fetch('/docs/api/docs/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to import document');
      }

      setResult(data);
      if (onImportSuccess) {
        onImportSuccess(data);
      }
    } catch (err) {
      setError(err.message || 'An error occurred during import.');
    } finally {
      setUploading(false);
    }
  };

  const isOverwrite = !!overwriteDocId;

  // Filter list of docs that can be overwritten
  // Technically any doc can be overwritten, but let's separate them
  return (
    <div className="docs-import-modal" onClick={onClose}>
      <div className="import-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-header">
          <div className="title-with-icon">
            <Upload size={18} />
            <h3>Import Document</h3>
          </div>
          <button type="button" onClick={onClose} className="close-btn" disabled={uploading}>
            <X size={18} />
          </button>
        </div>

        <div className="import-modal-body">
          {result ? (
            <div className="import-success-view">
              <div className="success-banner">
                <CheckCircle size={32} className="success-icon" />
                <h4>Import Complete!</h4>
                <p>
                  <strong>{result.title}</strong> has been successfully imported as a{' '}
                  {result.isCustom ? 'custom' : 'built-in'} document.
                </p>
              </div>

              <div className="conversion-preview-header">
                <span>Conversion Preview</span>
                <small>First few lines of converted markdown</small>
              </div>
              <div className="conversion-preview-body markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {result.markdown ? result.markdown.substring(0, 1000) + (result.markdown.length > 1000 ? '\n\n... (truncated)' : '') : '*No content preview*'}
                </ReactMarkdown>
              </div>

              <div className="success-footer">
                <button
                  type="button"
                  className="docs-editor-btn primary"
                  onClick={() => {
                    window.location.hash = `#docs/${result.id}`;
                    onClose();
                  }}
                >
                  <BookOpen size={16} />
                  <span>View Document</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleImport}>
              {error && <div className="import-error-banner">{error}</div>}

              <div className="form-group file-dropzone">
                <label className={`file-label ${file ? 'has-file' : ''}`}>
                  <input
                    type="file"
                    accept=".md,.docx"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <div className="dropzone-content">
                    <Upload size={28} className="upload-icon" />
                    {file ? (
                      <div className="selected-file-info">
                        <FileText size={16} />
                        <strong>{file.name}</strong>
                        <span>({(file.size / 1024).toFixed(1)} KB)</span>
                      </div>
                    ) : (
                      <>
                        <strong>Choose a file or drag it here</strong>
                        <span>Supports Markdown (.md) and Word (.docx)</span>
                      </>
                    )}
                  </div>
                </label>
              </div>

              <div className="form-group">
                <label>Import Mode</label>
                <select
                  value={overwriteDocId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOverwriteDocId(val);
                    if (val) {
                      const existingDoc = documents.find(d => d.id === val);
                      if (existingDoc) {
                        setTitle(existingDoc.title);
                      }
                    }
                  }}
                >
                  <option value="">Create new document</option>
                  <optgroup label="Overwrite existing document">
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        Overwrite: {doc.title} ({doc.isCustom ? 'Custom' : 'Built-in'})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {!isOverwrite && (
                <>
                  <div className="form-group">
                    <label htmlFor="import-doc-title">Document Title</label>
                    <input
                      id="import-doc-title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Disaster Recovery Guide"
                      required
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label htmlFor="import-doc-group">Sidebar Group</label>
                      <select
                        id="import-doc-group"
                        value={groupId}
                        onChange={(e) => setGroupId(e.target.value)}
                      >
                        <option value="custom">Custom Documents</option>
                        <option value="getting-started">Getting Started</option>
                        <option value="user-guide">User Guide</option>
                        <option value="technical-reference">Technical Reference (Admin Only)</option>
                      </select>
                    </div>

                    <div className="form-group flex-1 checkbox-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={adminOnly || groupId === 'technical-reference'}
                          onChange={(e) => setAdminOnly(e.target.checked)}
                          disabled={groupId === 'technical-reference'}
                        />
                        <span>Admin Only Visibility</span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              <div className="import-modal-footer">
                <button
                  type="button"
                  className="docs-editor-btn secondary"
                  onClick={onClose}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="docs-editor-btn primary"
                  disabled={uploading || !file}
                >
                  {uploading ? (
                    <>
                      <LoaderCircle size={16} className="spin" />
                      <span>Importing...</span>
                    </>
                  ) : (
                    <span>Import document</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
