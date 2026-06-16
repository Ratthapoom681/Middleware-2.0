import { Database, RefreshCw } from 'lucide-react';

const BackupTab = ({
  configBackups,
  selectedConfigBackup,
  setSelectedConfigBackup,
  onBackupConfig,
  onExportConfig,
  onImportConfig,
  onDownloadConfigBackup,
  onRestoreConfigBackup,
  onClearData,
  handleRebuildRedmineStatus,
  rebuildingRedmine,
  configImportInputRef,
}) => {
  return (
    <div className="settings-tab-pane settings-backup-layout">
      <section className="config-section">
        <h2 className="section-title">Configuration Backup</h2>
        <div className="backup-toolbar">
          <div className="backup-row">
            <button type="button" className="btn-secondary" onClick={onBackupConfig}>
              Backup Now
            </button>
            <button type="button" className="btn-secondary" onClick={onExportConfig}>
              Export JSON
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => configImportInputRef.current?.click()}
            >
              Import JSON
            </button>
            <input
              ref={configImportInputRef}
              type="file"
              id="config-import"
              accept="application/json,.json"
              onChange={onImportConfig}
              className="sr-only"
            />
          </div>
          <div className="backup-selector-group">
            <select
              className="backup-select"
              aria-label="Saved configuration backups"
              value={selectedConfigBackup}
              onChange={(e) => setSelectedConfigBackup(e.target.value)}
            >
              <option value="">No saved backups</option>
              {configBackups.map((backup) => (
                <option key={backup.fileName} value={backup.fileName}>
                  {backup.fileName}
                </option>
              ))}
            </select>
            <div className="backup-row">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={onDownloadConfigBackup}
                disabled={!selectedConfigBackup}
              >
                Download Selected
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={onRestoreConfigBackup}
                disabled={!selectedConfigBackup}
              >
                Restore Selected
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="config-section side-section" style={{ marginTop: 'var(--space-xl)' }}>
        <h2 className="section-title">Data Actions</h2>
        <div className="side-action-buttons">
          <button
            type="button"
            className="btn-secondary rebuild-btn"
            onClick={handleRebuildRedmineStatus}
            disabled={rebuildingRedmine}
          >
            <RefreshCw size={16} className={rebuildingRedmine ? 'spin' : ''} />
            {rebuildingRedmine ? 'Rebuilding...' : 'Rebuild Redmine Status'}
          </button>
          <button type="button" className="btn-danger clear-btn" onClick={onClearData}>
            <Database size={16} />
            Clear All Data
          </button>
        </div>
        <p className="field-hint">
          Clear removes the local Redmine cache. Rebuild checks Redmine read-only against current DefectDojo findings.
        </p>
      </section>
    </div>
  );
};

export default BackupTab;
