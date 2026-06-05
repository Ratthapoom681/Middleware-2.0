import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { cleanText, getScopeOptionValue, highestSeverity, routeValueMatches } from '../../shared/lib/dashboardUtils';
import { endpointHost, endpointLabel, getEndpointParts, parseEndpointText } from '../../domain/findings/endpointUtils';
import { getCompactedFindingCount } from '../../domain/findings/compactionUtils';
import {
  getDefectDojoRoute,
  getEntityRouteKey,
  normalizeNotifyIpMappings,
} from '../../domain/findings/findingUtils';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import './NotifyManagementPage.css';

const normalizeHostKey = (value) => cleanText(value).toLowerCase();
const normalizeHeaderKey = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const IMPORT_PREVIEW_LIMIT = 5;
const HEADER_ALIASES = {
  company: ['company', 'companyname', 'product', 'productname', 'productid', 'productvalue'],
  domainName: ['domain', 'domainname', 'fqdn', 'dns', 'dnsname'],
  host: ['host', 'hostname', 'ip', 'ipaddress', 'asset', 'endpoint'],
  label: ['label', 'name', 'displayname', 'assetname', 'servername', 'server'],
};

const findMatchingProduct = (products = [], value = '') => {
  const productText = cleanText(value);
  if (!productText) return null;
  return products.find(product => routeValueMatches(
    productText,
    product.value,
    product.id,
    product.key,
    product.name
  )) || null;
};

const getProductValueFromFinding = (finding = {}) => {
  const route = getDefectDojoRoute(finding);
  return getScopeOptionValue({
    id: route.projectId || finding.defectDojoProjectId,
    key: route.productKey || getEntityRouteKey('product', route.projectId, route.projectName),
    name: route.projectName || finding.defectDojoProjectName,
  });
};

const getEndpointDetailHost = (detail) => (
  cleanText(detail?.host)
  || endpointHost(detail?.endpoint || detail)
);

const getEndpointDetailPort = (detail) => {
  const endpointParts = getEndpointParts(detail?.endpoint || detail);
  if (endpointParts.port) return endpointParts.port;
  return parseEndpointText(detail?.label || endpointLabel(detail?.endpoint || detail)).port || '';
};

const buildProductHostStats = (compactedFindings = []) => {
  const productStats = new Map();

  compactedFindings.forEach(finding => {
    const productValue = getProductValueFromFinding(finding);
    if (!productValue) return;

    if (!productStats.has(productValue)) productStats.set(productValue, new Map());
    const hostStats = productStats.get(productValue);
    const findingKey = cleanText(finding.compactedSyncKey || finding.compactGroupId || finding.id || finding.title);
    const details = Array.isArray(finding.endpointDetails) && finding.endpointDetails.length > 0
      ? finding.endpointDetails
      : (finding.allEndpoints || []).map(endpoint => ({ endpoint }));

    details.forEach(detail => {
      const host = getEndpointDetailHost(detail);
      if (!host || host === 'Unknown host') return;
      const hostKey = normalizeHostKey(host);
      if (!hostStats.has(hostKey)) {
        hostStats.set(hostKey, {
          host,
          ports: new Set(),
          severity: '',
          findingKeys: new Set(),
          findingCount: 0,
        });
      }

      const stat = hostStats.get(hostKey);
      const port = getEndpointDetailPort(detail);
      if (port) stat.ports.add(port);
      stat.severity = highestSeverity(stat.severity || 'Info', detail.severity || finding.severity || 'Info');
      if (findingKey) stat.findingKeys.add(findingKey);
      stat.findingCount += getCompactedFindingCount({ findingIds: detail.findingIds }) || 1;
    });
  });

  return productStats;
};

const recordHasContent = (cells = []) => cells.some(cell => cleanText(cell));

const parseDelimitedRecords = (text = '', delimiter = ',') => {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let sourceRow = 1;
  let recordSourceRow = 1;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };

  const pushRecord = () => {
    pushCell();
    if (recordHasContent(row)) {
      records.push({ cells: row, sourceRow: recordSourceRow });
    }
    row = [];
    recordSourceRow = sourceRow + 1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      pushCell();
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      pushRecord();
      if (char === '\r' && next === '\n') index += 1;
      sourceRow += 1;
      recordSourceRow = sourceRow;
      continue;
    }

    if (char === '\n' || char === '\r') {
      cell += ' ';
      if (char === '\r' && next === '\n') index += 1;
      sourceRow += 1;
      continue;
    }

    cell += char;
  }

  if (quoted) {
    return { records, error: 'Import has an unclosed quoted cell.' };
  }

  if (cell || row.length > 0) pushRecord();
  return { records, error: '' };
};

const parseSpreadsheetText = (text = '') => {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const parsed = parseDelimitedRecords(input, delimiter);
  if (parsed.error) return { rows: [], error: parsed.error };
  const records = parsed.records;
  if (records.length === 0) return { rows: [], error: 'No rows found.' };
  const headers = records[0].cells.map(normalizeHeaderKey);
  const findColumn = (aliases) => aliases.map(alias => headers.indexOf(alias)).find(index => index >= 0) ?? -1;
  const companyIndex = findColumn(HEADER_ALIASES.company);
  const domainNameIndex = findColumn(HEADER_ALIASES.domainName);
  const hostIndex = findColumn(HEADER_ALIASES.host);
  const labelIndex = findColumn(HEADER_ALIASES.label);

  if (companyIndex < 0 || hostIndex < 0 || labelIndex < 0) {
    return {
      rows: [],
      error: 'Import needs company, host, and label columns.',
    };
  }

  return {
    rows: records.slice(1).map(record => {
      const cells = record.cells;
      const company = cleanText(cells[companyIndex]);
      return {
        sourceRow: record.sourceRow,
        company,
        product: company,
        domainName: domainNameIndex >= 0 ? cleanText(cells[domainNameIndex]) : '',
        host: cleanText(cells[hostIndex]),
        label: cleanText(cells[labelIndex]),
      };
    }).filter(row => row.host || row.label || row.company || row.domainName),
    error: '',
  };
};

const NotifyManagementPage = ({
  compactedFindings,
  config,
  onRefresh,
  onSaveConfig,
  products,
}) => {
  const normalizedProducts = useMemo(() => products || [], [products]);
  const [selectedProductValue, setSelectedProductValue] = useState('');
  const [draftHost, setDraftHost] = useState('');
  const [draftDomainName, setDraftDomainName] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const [editingLabel, setEditingLabel] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Redesign state additions
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverityFilter, setSelectedSeverityFilter] = useState('ALL');
  const [configTab, setConfigTab] = useState('manual'); // 'manual' | 'import'
  const [isModalOpen, setIsModalOpen] = useState(false);

  const mappings = useMemo(() => normalizeNotifyIpMappings(config?.notifyIpMappings), [config?.notifyIpMappings]);
  const productStats = useMemo(() => buildProductHostStats(compactedFindings), [compactedFindings]);
  const productOptions = useMemo(() => {
    const options = [...normalizedProducts];
    mappings.forEach(mapping => {
      const productValue = cleanText(mapping.productValue || mapping.productName);
      const productName = cleanText(mapping.productName || mapping.productValue);
      if (!productValue || findMatchingProduct(options, productValue) || findMatchingProduct(options, productName)) return;
      options.push({
        value: productValue,
        name: productName || productValue,
        pending: true,
      });
    });
    return options;
  }, [mappings, normalizedProducts]);

  const selectedProduct = productOptions.find(product => routeValueMatches(
    selectedProductValue,
    product.value,
    product.id,
    product.key,
    product.name
  )) || productOptions[0] || null;
  const selectedResolvedProduct = selectedProduct
    ? findMatchingProduct(normalizedProducts, selectedProduct.value) || findMatchingProduct(normalizedProducts, selectedProduct.name)
    : null;
  const effectiveSelectedProductValue = selectedProduct?.value || selectedProductValue || '';
  const selectedProductName = selectedProduct?.name || effectiveSelectedProductValue;
  const selectedStatsProductValue = selectedResolvedProduct?.value || effectiveSelectedProductValue;

  const selectedHostStats = useMemo(() => {
    return productStats.get(selectedStatsProductValue) || new Map();
  }, [productStats, selectedStatsProductValue]);

  const discoveredHosts = useMemo(() => {
    return Array.from(selectedHostStats.values())
      .map(stat => stat.host)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }, [selectedHostStats]);

  const productMappings = useMemo(() => {
    return effectiveSelectedProductValue
      ? mappings.filter(mapping => (
        routeValueMatches(effectiveSelectedProductValue, mapping.productValue, mapping.productName)
        || routeValueMatches(selectedProductName, mapping.productValue, mapping.productName)
      ))
      : [];
  }, [effectiveSelectedProductValue, mappings, selectedProductName]);

  const mappedRows = useMemo(() => {
    return productMappings.map(mapping => {
      const stat = selectedHostStats.get(normalizeHostKey(mapping.host));
      const productMatched = Boolean(
        findMatchingProduct(normalizedProducts, mapping.productValue)
        || findMatchingProduct(normalizedProducts, mapping.productName)
      );
      const findingCount = stat?.findingKeys?.size || 0;
      const ports = stat ? Array.from(stat.ports).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
      return {
        ...mapping,
        key: `${mapping.productValue}::${mapping.host}`,
        findingCount,
        productMatched,
        ports,
        severity: stat?.severity || '',
      };
    }).sort((left, right) => (
      left.label.localeCompare(right.label, undefined, { numeric: true })
      || left.host.localeCompare(right.host, undefined, { numeric: true })
    ));
  }, [normalizedProducts, productMappings, selectedHostStats]);

  // Compute severity counts for filtering badges
  const severityCounts = useMemo(() => {
    const counts = { ALL: mappedRows.length, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0, MAPPED: 0 };
    mappedRows.forEach(row => {
      if (!row.severity) {
        counts.MAPPED += 1;
      } else {
        const sev = row.severity.toUpperCase();
        if (counts[sev] !== undefined) {
          counts[sev] += 1;
        }
      }
    });
    return counts;
  }, [mappedRows]);

  // Dynamically filter rows based on search input & severity filter state
  const filteredRows = useMemo(() => {
    return mappedRows.filter(row => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = !query ||
        row.productName.toLowerCase().includes(query) ||
        row.label.toLowerCase().includes(query) ||
        (row.domainName || '').toLowerCase().includes(query) ||
        row.host.toLowerCase().includes(query) ||
        (row.severity || 'mapped').toLowerCase().includes(query) ||
        row.ports.some(port => port.toLowerCase().includes(query));

      const rowSeverityUpper = (row.severity || '').toUpperCase();
      const matchesSeverity = selectedSeverityFilter === 'ALL' ||
        (selectedSeverityFilter === 'MAPPED' && !row.severity) ||
        (row.severity && rowSeverityUpper === selectedSeverityFilter);

      return matchesSearch && matchesSeverity;
    });
  }, [mappedRows, searchQuery, selectedSeverityFilter]);

  const renderPortChips = (ports = []) => {
    if (ports.length === 0) {
      return <span className="ports-empty">-</span>;
    }

    const visiblePorts = ports.slice(0, 3);
    const hiddenPorts = ports.slice(3);

    return (
      <div className="notify-port-chips" aria-label={`Ports ${ports.join(', ')}`}>
        {visiblePorts.map(port => (
          <span key={port} className="port-tag">{port}</span>
        ))}
        {hiddenPorts.length > 0 && (
          <span className="port-overflow">
            <button
              type="button"
              className="port-overflow-trigger"
              aria-label={`${hiddenPorts.length} more ports: ${hiddenPorts.join(', ')}`}
            >
              +{hiddenPorts.length}
            </button>
            <span className="port-overflow-popover" role="tooltip">
              <strong>Ports</strong>
              {ports.map(port => (
                <span key={port}>{port}</span>
              ))}
            </span>
          </span>
        )}
      </div>
    );
  };

  // Escape key event listener to close modal
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
      }
    };
    if (isModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const handleProductChange = (value) => {
    setSelectedProductValue(value);
    setDraftHost('');
    setDraftDomainName('');
    setDraftLabel('');
    setImportRows([]);
    setImportMessage('');
    setSaveMessage('');
    setSearchQuery('');
    setSelectedSeverityFilter('ALL');
  };

  const refreshNotifyData = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    setSaveMessage('');
    try {
      await onRefresh();
      setSaveMessage('Notify data refreshed.');
    } catch (err) {
      alert(err.message || 'Failed to refresh notify data.');
    } finally {
      setRefreshing(false);
    }
  };

  const saveMappings = async (nextMappings, message = 'Notify mapping saved.') => {
    setSaving(true);
    setSaveMessage('');
    try {
      await onSaveConfig({
        ...config,
        notifyIpMappings: normalizeNotifyIpMappings(nextMappings),
      });
      setSaveMessage(message);
    } catch (err) {
      alert(err.message || 'Failed to save notify mapping.');
    } finally {
      setSaving(false);
    }
  };

  const addMapping = async (event) => {
    event.preventDefault();
    const host = cleanText(draftHost);
    const domainName = cleanText(draftDomainName);
    const label = cleanText(draftLabel);
    if (!effectiveSelectedProductValue || !host || !label) return;

    const nextMapping = {
      productValue: effectiveSelectedProductValue,
      productName: selectedProductName,
      domainName,
      host,
      label,
    };
    const filtered = mappings.filter(mapping => !(
      routeValueMatches(effectiveSelectedProductValue, mapping.productValue, mapping.productName)
      && normalizeHostKey(mapping.host) === normalizeHostKey(host)
    ));

    await saveMappings([...filtered, nextMapping], 'Notify asset saved.');
    setDraftHost('');
    setDraftDomainName('');
    setDraftLabel('');
    setIsModalOpen(false); // Close Modal on Success
  };

  const startEdit = (row) => {
    setEditingKey(row.key);
    setEditingLabel(row.label);
    setSaveMessage('');
  };

  const saveEdit = async (row) => {
    const label = cleanText(editingLabel);
    if (!label) return;

    const nextMappings = mappings.map(mapping => (
      mapping.productValue === row.productValue && normalizeHostKey(mapping.host) === normalizeHostKey(row.host)
        ? { ...mapping, label }
        : mapping
    ));
    await saveMappings(nextMappings, 'Notify asset renamed.');
    setEditingKey('');
    setEditingLabel('');
  };

  const deleteMapping = async (row) => {
    const nextMappings = mappings.filter(mapping => !(
      mapping.productValue === row.productValue && normalizeHostKey(mapping.host) === normalizeHostKey(row.host)
    ));
    await saveMappings(nextMappings, 'Notify asset removed.');
  };

  const resolveImportProduct = (productText) => {
    if (!cleanText(productText)) {
      return selectedProduct;
    }
    const matchedProduct = findMatchingProduct(normalizedProducts, productText);
    if (matchedProduct) return matchedProduct;
    return {
      value: cleanText(productText),
      name: cleanText(productText),
      pending: true,
    };
  };

  const normalizedImportRows = importRows.map(row => {
    const product = resolveImportProduct(row.company || row.product);
    const host = cleanText(row.host);
    const domainName = cleanText(row.domainName);
    const label = cleanText(row.label);
    return {
      ...row,
      productValue: product?.value || '',
      productName: product?.name || row.company || row.product || selectedProductName,
      domainName,
      host,
      label,
      pendingProduct: Boolean(product?.pending),
      valid: Boolean((product?.value || product?.name) && host && label),
    };
  });
  const validImportRows = normalizedImportRows.filter(row => row.valid);

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      setImportRows([]);
      setImportMessage('Save the Excel sheet as CSV or TSV, then import it here.');
      return;
    }

    const text = await file.text();
    const parsed = parseSpreadsheetText(text);
    setImportRows(parsed.rows);
    setImportMessage(parsed.error || `${parsed.rows.length} row${parsed.rows.length !== 1 ? 's' : ''} ready for review.`);
  };

  const applyImportRows = async () => {
    if (validImportRows.length === 0) return;
    const importedMappings = validImportRows.map(row => ({
      productValue: row.productValue,
      productName: row.productName,
      domainName: row.domainName,
      host: row.host,
      label: row.label,
    }));
    const importedKeys = new Set(importedMappings.map(mapping => (
      `${mapping.productValue.toLowerCase()}::${normalizeHostKey(mapping.host)}`
    )));
    const retainedMappings = mappings.filter(mapping => !importedKeys.has(
      `${mapping.productValue.toLowerCase()}::${normalizeHostKey(mapping.host)}`
    ));

    await saveMappings([...retainedMappings, ...importedMappings], `${validImportRows.length} notify asset${validImportRows.length !== 1 ? 's' : ''} imported.`);
    if (onRefresh) {
      await onRefresh();
    }
    setImportRows([]);
    setImportMessage('');
    setIsModalOpen(false); // Close Modal on Success
  };

  return (
    <>
      <PageHeader
        icon={BellRing}
        eyebrow="Administration"
        title="Notify Management"
        actions={(
          <div className="notify-actions">
            {onRefresh && (
              <button
                type="button"
                className="notify-refresh-btn"
                onClick={refreshNotifyData}
                disabled={refreshing || saving}
                title="Refresh notify data"
              >
                <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
                <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            )}
            <button
              type="button"
              className="notify-add-mapping-btn"
              onClick={() => {
                setIsModalOpen(true);
                setSaveMessage('');
              }}
              title="Add new asset mapping"
            >
              <Plus size={16} />
              <span>Add Mapping</span>
            </button>
          </div>
        )}
      />

      <PageMain className="notify-main">
        <section className="notify-assets" aria-labelledby="notify-assets-title">
          <div className="notify-section-header">
            <div>
              <h2 id="notify-assets-title">Mapped assets</h2>
            </div>
          </div>

          {mappedRows.length > 0 && (
            <div className="notify-search-filter-wrapper">
              <div className="notify-search-box">
                <Search className="search-icon" size={16} />
                <input
                  type="text"
                  className="notify-search-input"
                  placeholder="Search label, domain, host IP, or port..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="clear-search-btn"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="notify-filter-tags">
                {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'MAPPED'].map((sev) => {
                  const count = severityCounts[sev];
                  if (sev !== 'ALL' && count === 0) return null;
                  return (
                    <button
                      key={sev}
                      type="button"
                      className={`notify-filter-pill ${selectedSeverityFilter === sev ? 'active' : ''} ${sev.toLowerCase()}`}
                      onClick={() => setSelectedSeverityFilter(sev)}
                    >
                      {sev === 'ALL' ? 'All Mappings' : sev === 'MAPPED' ? 'Mapped' : sev}
                      <span className="pill-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {filteredRows.length > 0 ? (
            <div className="notify-asset-table" role="table" aria-label="Notify asset mappings">
              <div className="notify-asset-table-header" role="row">
                <div role="columnheader">Company</div>
                <div role="columnheader">Name</div>
                <div role="columnheader">Domain Name</div>
                <div role="columnheader">Host</div>
                <div role="columnheader">Port</div>
                <div role="columnheader">Severity</div>
                <div role="columnheader">Actions</div>
              </div>
              {filteredRows.map(row => (
                <article key={row.key} className={`notify-asset-table-row ${row.severity ? row.severity.toLowerCase() : 'mapped'}`} role="row">
                  <div className="notify-table-cell notify-cell-company" role="cell" data-label="Company">
                    <span>{row.productName}</span>
                    {!row.productMatched && <span className="notify-pending-product">Pending</span>}
                  </div>
                  <div className="notify-table-cell notify-cell-name" role="cell" data-label="Name">
                    {editingKey === row.key ? (
                      <div className="notify-edit-inline-wrapper">
                        <input
                          className="notify-inline-input"
                          value={editingLabel}
                          onChange={(event) => setEditingLabel(event.target.value)}
                          aria-label={`Display name for ${row.host}`}
                          autoFocus
                        />
                        <div className="notify-edit-actions">
                          <button
                            type="button"
                            className="icon-btn-confirm"
                            onClick={() => saveEdit(row)}
                            disabled={saving || !cleanText(editingLabel)}
                            title="Save"
                            aria-label={`Save display name for ${row.host}`}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn-cancel"
                            onClick={() => {
                              setEditingKey('');
                              setEditingLabel('');
                            }}
                            disabled={saving}
                            title="Cancel"
                            aria-label={`Cancel editing ${row.host}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <strong className="notify-label-text">{row.label}</strong>
                    )}
                  </div>
                  <div className="notify-table-cell notify-cell-domain" role="cell" data-label="Domain Name">
                    {row.domainName || <span className="notify-empty-value">-</span>}
                  </div>
                  <div className="notify-table-cell notify-cell-host" role="cell" data-label="Host">
                    {row.host}
                  </div>
                  <div className="notify-table-cell notify-cell-port" role="cell" data-label="Port">
                    {renderPortChips(row.ports)}
                  </div>
                  <div className="notify-table-cell notify-cell-severity" role="cell" data-label="Severity">
                    <span className={`notify-badge severity-badge ${row.severity ? row.severity.toLowerCase() : 'mapped'}`}>
                      <span className="badge-dot" />
                      {row.severity || 'Mapped'}
                    </span>
                  </div>
                  <div className="notify-table-cell notify-cell-actions" role="cell" data-label="Actions">
                    {editingKey !== row.key && (
                      <button
                        type="button"
                        className="notify-table-action"
                        onClick={() => startEdit(row)}
                        disabled={saving}
                        title="Rename asset"
                        aria-label={`Rename ${row.label}`}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {editingKey !== row.key && (
                      <button
                        type="button"
                        className="notify-table-action danger"
                        onClick={() => deleteMapping(row)}
                        disabled={saving}
                        title="Delete mapping"
                        aria-label={`Delete mapping for ${row.label}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="notify-empty-state" role="status">
              <div className="empty-icon-container">
                <BellRing size={32} />
              </div>
              <h3>{mappedRows.length > 0 ? 'No matching assets' : 'No mapped assets'}</h3>
              <p>
                {mappedRows.length > 0
                  ? 'Adjust your search query or filter tags to find what you are looking for.'
                  : 'Add a host mapping for this product to monitor its assets.'}
              </p>
              {mappedRows.length > 0 ? (
                <button
                  type="button"
                  className="btn-secondary clear-filters-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedSeverityFilter('ALL');
                  }}
                >
                  Clear Filters
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary-redesign clear-filters-btn"
                  onClick={() => setIsModalOpen(true)}
                >
                  <Plus size={16} />
                  <span>Add First Mapping</span>
                </button>
              )}
            </div>
          )}
        </section>
      </PageMain>

      {/* Configuration Popup Modal Dialog */}
      {isModalOpen && (
        <div 
          className="notify-modal-overlay" 
          onClick={() => setIsModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="notify-modal-container" 
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="notify-modal-close-btn"
              onClick={() => setIsModalOpen(false)}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>

            <div className="notify-sidebar-tabs">
              <button
                type="button"
                className={`notify-sidebar-tab-btn ${configTab === 'manual' ? 'active' : ''}`}
                onClick={() => setConfigTab('manual')}
              >
                <Plus size={16} />
                <span>Add Asset</span>
              </button>
              <button
                type="button"
                className={`notify-sidebar-tab-btn ${configTab === 'import' ? 'active' : ''}`}
                onClick={() => setConfigTab('import')}
              >
                <Upload size={16} />
                <span>Bulk Import</span>
              </button>
            </div>

            <div className="notify-tab-content">
              {configTab === 'manual' ? (
                <div className="tab-pane-manual">
                  <div className="notify-pane-header">
                    <h3 id="notify-config-title">Map Single Asset</h3>
                    <p>{discoveredHosts.length} discovered host{discoveredHosts.length !== 1 ? 's' : ''} available</p>
                  </div>

                  <form onSubmit={addMapping} className="notify-form-redesign">
                    <div className="form-group-redesign">
                      <label htmlFor="notify-host">Host or IP Address</label>
                      <div className="input-with-datalist">
                        <input
                          id="notify-host"
                          list="notify-known-hosts"
                          value={draftHost}
                          onChange={(event) => setDraftHost(event.target.value)}
                          placeholder="e.g. 10.149.10.128"
                          autoComplete="off"
                        />
                        <datalist id="notify-known-hosts">
                          {discoveredHosts.map(host => (
                            <option key={host} value={host} />
                          ))}
                        </datalist>
                      </div>
                    </div>

                    <div className="form-group-redesign">
                      <label htmlFor="notify-label">Display Name / Asset Label</label>
                      <input
                        id="notify-label"
                        value={draftLabel}
                        onChange={(event) => setDraftLabel(event.target.value)}
                        placeholder="e.g. Mail Server01"
                      />
                    </div>

                    <div className="form-group-redesign">
                      <label htmlFor="notify-domain-name">Domain Name</label>
                      <input
                        id="notify-domain-name"
                        value={draftDomainName}
                        onChange={(event) => setDraftDomainName(event.target.value)}
                        placeholder="e.g. gateway.example.com"
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn-primary-redesign"
                      disabled={saving || !effectiveSelectedProductValue || !cleanText(draftHost) || !cleanText(draftLabel)}
                    >
                      {saving ? <Save size={16} className="spinning" /> : <Plus size={16} />}
                      <span>{saving ? 'Saving...' : 'Add Mapping'}</span>
                    </button>
                    {saveMessage && <div className="notify-toast-hint" role="status">{saveMessage}</div>}
                  </form>
                </div>
              ) : (
                <div className="tab-pane-import">
                  <div className="notify-pane-header">
                    <h3>Bulk CSV/TSV Import</h3>
                    <p>Upload a file to map multiple assets at once.</p>
                  </div>

                  <section className="notify-import-redesign" aria-labelledby="notify-import-title">
                    <div className="import-format-guide">
                      <span className="guide-title">Columns:</span>
                      <div className="header-tags">
                        <code>company</code>
                        <code>domain name</code>
                        <code>host</code>
                        <code>label</code>
                      </div>
                    </div>

                    <label className="btn-upload-area">
                      <Upload size={24} className="upload-icon" />
                      <span className="upload-title">Choose CSV or TSV File</span>
                      <span className="upload-subtitle">Drag & drop or browse your files</span>
                      <input
                        type="file"
                        accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/tab-separated-values"
                        onChange={handleImportFile}
                      />
                    </label>

                    {importMessage && <p className="import-status-message" role="status">{importMessage}</p>}

                    {normalizedImportRows.length > 0 && (
                      <div className="notify-import-preview-box">
                        <span className="preview-label">Preview (first {IMPORT_PREVIEW_LIMIT} rows):</span>
                        <div className="preview-list">
                          {normalizedImportRows.slice(0, IMPORT_PREVIEW_LIMIT).map((row, idx) => (
                            <div key={`${row.sourceRow}-${row.domainName}-${row.host}-${row.label}-${idx}`} className={`import-preview-item ${row.valid ? 'valid' : 'invalid'} ${row.pendingProduct ? 'pending' : ''}`}>
                              <div className="item-header">
                                <span className="item-product">{row.productName}</span>
                                <span className={`status-badge ${row.valid ? row.pendingProduct ? 'pending' : 'success' : 'error'}`}>
                                  {row.valid ? row.pendingProduct ? 'Pending product' : 'Valid' : 'Invalid'}
                                </span>
                              </div>
                              <div className="item-body">
                                <strong>{row.host || 'Missing host'}</strong>
                                <span>{row.domainName || 'No domain'}</span>
                                <span>{row.label || 'Missing label'}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {normalizedImportRows.length > IMPORT_PREVIEW_LIMIT && (
                          <div className="import-preview-more">
                            +{normalizedImportRows.length - IMPORT_PREVIEW_LIMIT} more rows
                          </div>
                        )}

                        <button
                          type="button"
                          className="btn-primary-redesign import-submit-btn"
                          onClick={applyImportRows}
                          disabled={saving || validImportRows.length === 0}
                        >
                          <Save size={16} />
                          <span>Import {validImportRows.length} Assets</span>
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default NotifyManagementPage;
