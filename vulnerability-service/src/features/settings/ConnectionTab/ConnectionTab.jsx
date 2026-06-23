import './ConnectionTab.css';

const ConnectionTab = ({ tempConfig, setTempConfig }) => {
  return (
    <div className="settings-tab-pane connection-tab">
      <section className="connection-section">
        <h2 className="connection-section-title">DefectDojo Integration</h2>
        <div className="form-group">
          <label htmlFor="defectdojo-url">DefectDojo URL</label>
          <input
            id="defectdojo-url"
            type="text"
            value={tempConfig.defectDojoUrl || ''}
            onChange={(e) => setTempConfig({ ...tempConfig, defectDojoUrl: e.target.value })}
            placeholder="https://defectdojo.example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="defectdojo-api-key">API Key</label>
          <input
            id="defectdojo-api-key"
            type="password"
            value={tempConfig.defectDojoApiKey || ''}
            onChange={(e) => setTempConfig({ ...tempConfig, defectDojoApiKey: e.target.value })}
            placeholder="API Token"
          />
        </div>
      </section>

      <section className="connection-section">
        <h2 className="connection-section-title">Redmine Integration Connection</h2>
        <div className="form-group">
          <label htmlFor="redmine-url">Redmine URL</label>
          <input
            id="redmine-url"
            type="text"
            value={tempConfig.redmineUrl || ''}
            onChange={(e) => setTempConfig({ ...tempConfig, redmineUrl: e.target.value })}
            placeholder="https://redmine.example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="redmine-api-key">API Key</label>
          <input
            id="redmine-api-key"
            type="password"
            value={tempConfig.redmineApiKey || ''}
            onChange={(e) => setTempConfig({ ...tempConfig, redmineApiKey: e.target.value })}
            placeholder="Redmine API Key"
          />
        </div>
      </section>
    </div>
  );
};

export default ConnectionTab;
