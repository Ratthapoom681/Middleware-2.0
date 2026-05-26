import { useEffect, useRef, useState } from 'react';
import { Database, RefreshCw, Save, Shield } from 'lucide-react';

const DEFAULT_REDMINE_STATUS_POLL_SECONDS = 60;
const REDMINE_PRIORITY_FIELDS = [
  { severity: 'Critical', field: 'redminePriorityCriticalId', label: 'Priority ID: Critical' },
  { severity: 'High', field: 'redminePriorityHighId', label: 'Priority ID: High' },
  { severity: 'Medium', field: 'redminePriorityMediumId', label: 'Priority ID: Medium' },
  { severity: 'Low', field: 'redminePriorityLowId', label: 'Priority ID: Low' },
  { severity: 'Info', field: 'redminePriorityInfoId', label: 'Priority ID: Info' },
];

const normalizeRedmineStatusPollInterval = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 0) return 0;
  if (Number.isInteger(parsed) && parsed > 0) {
    return Math.max(DEFAULT_REDMINE_STATUS_POLL_SECONDS, parsed);
  }
  return DEFAULT_REDMINE_STATUS_POLL_SECONDS;
};

const Settings = ({
  config,
  onSaveConfig,
  onClearData,
  onRebuildRedmineStatus,
  configBackups,
  selectedConfigBackup,
  setSelectedConfigBackup,
  onBackupConfig,
  onExportConfig,
  onImportConfig,
  onDownloadConfigBackup,
  onRestoreConfigBackup,
  user,
}) => {
  const [tempConfig, setTempConfig] = useState(config);
  const [savingConfig, setSavingConfig] = useState(false);
  const [rebuildingRedmine, setRebuildingRedmine] = useState(false);
  const [configSaveMessage, setConfigSaveMessage] = useState('');
  const configImportInputRef = useRef(null);

  useEffect(() => {
    queueMicrotask(() => setTempConfig(config));
  }, [config]);

  const updateRedmineStatusPollInterval = (value) => {
    setConfigSaveMessage('');
    setTempConfig(prev => ({
      ...prev,
      redmineStatusPollIntervalSeconds: String(value || '').replace(/\D+/g, ''),
    }));
  };

  const normalizeRedmineStatusPollIntervalDraft = () => {
    setTempConfig(prev => ({
      ...prev,
      redmineStatusPollIntervalSeconds: normalizeRedmineStatusPollInterval(prev.redmineStatusPollIntervalSeconds),
    }));
  };

  const handleSaveConfig = async () => {
    const normalizedConfig = {
      ...tempConfig,
      redmineStatusPollIntervalSeconds: normalizeRedmineStatusPollInterval(tempConfig.redmineStatusPollIntervalSeconds),
    };

    setTempConfig(normalizedConfig);
    setSavingConfig(true);
    try {
      const savedConfig = await onSaveConfig(normalizedConfig);
      setTempConfig(savedConfig || normalizedConfig);
      setConfigSaveMessage('Configuration saved.');
    } catch (err) {
      setConfigSaveMessage('');
      alert(err.message || 'Failed to save configuration.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRebuildRedmineStatus = async () => {
    if (!onRebuildRedmineStatus || rebuildingRedmine) return;
    setRebuildingRedmine(true);
    try {
      await onRebuildRedmineStatus();
    } finally {
      setRebuildingRedmine(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="empty-state">
        <Shield size={48} className="empty-state-icon" />
        <h2>Access Denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="settings-view">
      <section className="config-section config-section-spaced">
        <h2 className="section-title">Data Actions</h2>
        <div className="action-row">
          <button type="button" className="btn-danger" onClick={onClearData}>
            <Database size={16} />
            Clear All Data
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRebuildRedmineStatus}
            disabled={rebuildingRedmine}
          >
            <RefreshCw size={16} className={rebuildingRedmine ? 'spin' : ''} />
            {rebuildingRedmine ? 'Rebuilding...' : 'Rebuild Redmine Status'}
          </button>
        </div>
        <p className="field-hint">
          Clear removes the local Redmine cache. Rebuild checks Redmine read-only against current DefectDojo findings.
        </p>
      </section>

      <section className="config-section config-section-spaced">
        <h2 className="section-title">Backup Config</h2>
        <div className="action-row">
          <button type="button" className="btn-secondary" onClick={onBackupConfig}>
            Backup Now
          </button>
          <button type="button" className="btn-secondary" onClick={onExportConfig}>
            Export JSON
          </button>
          <button type="button" className="btn-secondary" onClick={() => configImportInputRef.current?.click()}>
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
          <select
            className="backup-select"
            aria-label="Saved configuration backups"
            value={selectedConfigBackup}
            onChange={(e) => setSelectedConfigBackup(e.target.value)}
          >
            <option value="">No saved backups</option>
            {configBackups.map(backup => (
              <option key={backup.fileName} value={backup.fileName}>
                {backup.fileName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary"
            onClick={onDownloadConfigBackup}
            disabled={!selectedConfigBackup}
          >
            Download Selected
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onRestoreConfigBackup}
            disabled={!selectedConfigBackup}
          >
            Restore Selected
          </button>
        </div>
      </section>

      <div className="config-grid">
        <section className="config-section">
          <h2 className="section-title">Connection</h2>
          <div className="form-group">
            <label htmlFor="defectdojo-url">DefectDojo URL</label>
            <input
              id="defectdojo-url"
              type="text"
              value={tempConfig.defectDojoUrl}
              onChange={(e) => setTempConfig({...tempConfig, defectDojoUrl: e.target.value})}
              placeholder="https://defectdojo.example.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="defectdojo-api-key">API Key</label>
            <input
              id="defectdojo-api-key"
              type="password"
              value={tempConfig.defectDojoApiKey}
              onChange={(e) => setTempConfig({...tempConfig, defectDojoApiKey: e.target.value})}
              placeholder="API Token"
            />
          </div>
          <div className="form-group">
            <label htmlFor="scan-path">Scan Path</label>
            <input
              id="scan-path"
              type="text"
              value={tempConfig.scanPath}
              onChange={(e) => setTempConfig({...tempConfig, scanPath: e.target.value})}
            />
          </div>
        </section>

        <section className="config-section redmine-config-section">
          <h2 className="section-title">Redmine</h2>
          <div className="redmine-settings-grid">
            <div className="settings-subsection">
              <h3>Connection</h3>
              <div className="form-group">
                <label htmlFor="redmine-url">Redmine URL</label>
                <input
                  id="redmine-url"
                  type="text"
                  value={tempConfig.redmineUrl}
                  onChange={(e) => setTempConfig({ ...tempConfig, redmineUrl: e.target.value })}
                  placeholder="https://redmine.example.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="redmine-api-key">API Key</label>
                <input
                  id="redmine-api-key"
                  type="password"
                  value={tempConfig.redmineApiKey}
                  onChange={(e) => setTempConfig({ ...tempConfig, redmineApiKey: e.target.value })}
                  placeholder="Redmine API Key"
                />
              </div>
              <div className="form-group">
                <label htmlFor="redmine-status-poll">Status poll interval</label>
                <input
                  id="redmine-status-poll"
                  type="text"
                  inputMode="numeric"
                  value={tempConfig.redmineStatusPollIntervalSeconds ?? DEFAULT_REDMINE_STATUS_POLL_SECONDS}
                  onChange={(e) => updateRedmineStatusPollInterval(e.target.value)}
                  onBlur={normalizeRedmineStatusPollIntervalDraft}
                  placeholder={`${DEFAULT_REDMINE_STATUS_POLL_SECONDS} seconds minimum`}
                />
                <p className="field-hint">Set to 0 to disable automatic Redmine status polling.</p>
              </div>
            </div>

            <div className="settings-subsection">
              <h3>Priorities</h3>
              <div className="form-group">
                <label htmlFor="redmine-priority-default">Default Priority ID</label>
                <input
                  id="redmine-priority-default"
                  type="text"
                  value={tempConfig.redminePriorityId || ''}
                  onChange={(e) => setTempConfig({ ...tempConfig, redminePriorityId: e.target.value })}
                  placeholder="used only when severity is missing"
                />
                <p className="field-hint">Set the per-severity IDs below so High, Medium, Low, and Info do not inherit a Critical default.</p>
              </div>
              {REDMINE_PRIORITY_FIELDS.map(({ severity, field, label }) => (
                <div className="form-group" key={field}>
                  <label htmlFor={`redmine-priority-${severity.toLowerCase()}`}>{label}</label>
                  <input
                    id={`redmine-priority-${severity.toLowerCase()}`}
                    type="text"
                    value={tempConfig[field] || ''}
                    onChange={(e) => setTempConfig({ ...tempConfig, [field]: e.target.value })}
                    placeholder={`Redmine priority ID for ${severity}`}
                  />
                </div>
              ))}
            </div>

            <div className="settings-subsection redmine-status-subsection">
              <h3>Status IDs</h3>
              <div className="redmine-status-grid">
                <div className="form-group">
                  <label htmlFor="redmine-status-new">New</label>
                  <input
                    id="redmine-status-new"
                    type="text"
                    value={tempConfig.redmineStatusNewId || ''}
                    onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusNewId: e.target.value })}
                    placeholder="name lookup fallback"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="redmine-status-feedback">Feedback</label>
                  <input
                    id="redmine-status-feedback"
                    type="text"
                    value={tempConfig.redmineStatusFeedbackId || ''}
                    onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusFeedbackId: e.target.value })}
                    placeholder="preferred for auto-reopen"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="redmine-status-progress">In Progress</label>
                  <input
                    id="redmine-status-progress"
                    type="text"
                    value={tempConfig.redmineStatusInProgressId || ''}
                    onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusInProgressId: e.target.value })}
                    placeholder="fallback for auto-reopen"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="redmine-status-resolve">Resolve</label>
                  <input
                    id="redmine-status-resolve"
                    type="text"
                    value={tempConfig.redmineStatusResolveId || ''}
                    onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusResolveId: e.target.value })}
                    placeholder="Resolve/Resolved fallback"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="redmine-status-closed">Closed</label>
                  <input
                    id="redmine-status-closed"
                    type="text"
                    value={tempConfig.redmineStatusClosedId || ''}
                    onChange={(e) => setTempConfig({ ...tempConfig, redmineStatusClosedId: e.target.value })}
                    placeholder="required for manual close"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        {configSaveMessage && <span className="field-hint" role="status">{configSaveMessage}</span>}
        <button className="btn-primary" onClick={handleSaveConfig} disabled={savingConfig}>
          <Save size={16} /> {savingConfig ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};

export default Settings;
