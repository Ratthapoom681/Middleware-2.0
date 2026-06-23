import { Children, isValidElement, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Link as LinkIcon,
  List,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  X,
} from 'lucide-react';
import {
  buildDocsHash,
  buildDocumentSections,
  parseDocsRoute,
  remarkHeadingIds,
  searchDocuments,
} from './docsUtils.js';
import './DocsPage.css';

const DOC_FILE_IDS = {
  'quick-start.md': 'quick-start',
  'user-guide/hub.md': 'hub-guide',
  'hub.md': 'hub-guide',
  'user-guide/vulnerability.md': 'vulnerability-guide',
  'vulnerability.md': 'vulnerability-guide',
  'user-guide/wazuh.md': 'wazuh-guide',
  'wazuh.md': 'wazuh-guide',
  'user-guide/operations.md': 'operations-guide',
  'operations.md': 'operations-guide',
  'project-guide.md': 'project-guide',
  '00-overview.md': 'architecture-overview',
};

let mermaidModulePromise;
let mermaidInitialized = false;
let mermaidRenderSequence = 0;

function getMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(module => module.default || module);
  }
  return mermaidModulePromise;
}

function MermaidDiagram({ chart }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSvg('');
    setError('');

    getMermaid()
      .then(async mermaid => {
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'dark',
            themeVariables: {
              background: '#111827',
              primaryColor: '#1f2937',
              primaryTextColor: '#f3f4f6',
              primaryBorderColor: '#4b5563',
              lineColor: '#93c5fd',
              secondaryColor: '#172033',
              tertiaryColor: '#111827',
            },
          });
          mermaidInitialized = true;
        }

        const renderId = `documentation-mermaid-${++mermaidRenderSequence}`;
        const result = await mermaid.render(renderId, chart);
        if (active) setSvg(result.svg);
      })
      .catch(err => {
        console.error('Mermaid render error:', err);
        if (active) setError('Diagram preview unavailable. Source shown below.');
      });

    return () => {
      active = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="mermaid-fallback">
        <p>{error}</p>
        <pre><code className="language-mermaid">{chart}</code></pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-loading" role="status">
        <LoaderCircle size={18} className="spin" />
        <span>Rendering diagram</span>
      </div>
    );
  }

  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function ZoomableImage({ src, alt, ...props }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') setIsOpen(false);
      };
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
    return undefined;
  }, [isOpen]);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className="zoomable-image-trigger"
        onClick={() => setIsOpen(true)}
        {...props}
      />
      {isOpen && (
        <div className="zoomable-image-overlay" onClick={() => setIsOpen(false)}>
          <button
            type="button"
            className="zoomable-image-close"
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
            aria-label="Close image preview"
          >
            <X size={20} />
          </button>
          <div className="zoomable-image-wrapper" onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={alt} className="zoomable-image-expanded" />
            {alt && <p className="zoomable-image-caption">{alt}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function formatUpdatedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getSectionLabel(section) {
  return section?.depth === 1 ? 'Overview' : section?.title || 'Section';
}

function resolveMarkdownHref(href, documents, currentDocumentId) {
  const value = String(href || '');
  if (!value) return { href: value, external: false };
  if (/^https?:\/\//i.test(value)) return { href: value, external: true };
  if (value.startsWith('#docs')) return { href: value, external: false };
  if (value.startsWith('#')) return { href: buildDocsHash(currentDocumentId, value.slice(1)), external: false };

  const [fileName, section = ''] = value.split('#');
  const documentId = DOC_FILE_IDS[fileName.replace(/^\.\//, '')];
  if (documentId && documents.some(document => document.id === documentId)) {
    return { href: buildDocsHash(documentId, section), external: false };
  }

  return { href: value, external: false };
}

function SearchResults({ query, results, onOpen }) {
  return (
    <section className="docs-search-results" aria-labelledby="search-results-title">
      <div className="search-results-heading">
        <div>
          <p className="docs-eyebrow">Search</p>
          <h1 id="search-results-title">Results for “{query.trim()}”</h1>
        </div>
        <span className="result-count">{results.length} {results.length === 1 ? 'section' : 'sections'}</span>
      </div>

      {results.length === 0 ? (
        <div className="docs-empty-state">
          <Search size={28} />
          <h2>No matching sections</h2>
          <p>Try a different word or a shorter phrase.</p>
        </div>
      ) : (
        <div className="search-result-list">
          {results.map(result => (
            <a
              key={`${result.documentId}-${result.slug}`}
              href={buildDocsHash(result.documentId, result.slug)}
              className="search-result-item"
              onClick={onOpen}
            >
              <div className="search-result-meta">
                <span>{result.documentGroup ? `${result.documentGroup} / ${result.documentTitle}` : result.documentTitle}</span>
                <span>Section {result.depth > 1 ? result.depth - 1 : 1}</span>
              </div>
              <h2>{result.title}</h2>
              <p>{result.snippet}</p>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DocsPage({ token, user, routeHash, onBack, onLogout, onUnauthorized }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [openGroups, setOpenGroups] = useState({ 'getting-started': true, 'user-guide': true });
  const [retryKey, setRetryKey] = useState(0);
  const route = useMemo(() => parseDocsRoute(routeHash), [routeHash]);

  useEffect(() => {
    const cleanPaths = ['/docs/', '/docs'];
    if (!cleanPaths.includes(window.location.pathname)) {
      window.location.replace('/docs/' + window.location.hash);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');

    fetch('/docs/api/docs', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async response => {
        if (response.status === 401) {
          if (onUnauthorized) {
            onUnauthorized();
          } else if (onLogout) {
            onLogout();
          }
          return null;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load documentation');
        return data;
      })
      .then(data => {
        if (!active || !data) return;
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch(err => {
        if (!active || err.name === 'AbortError') return;
        setError(err.message || 'Unable to load documentation');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [retryKey, token, onLogout, onUnauthorized]);

  const selectedDocument = useMemo(() => (
    documents.find(document => document.id === route.documentId) || documents[0] || null
  ), [documents, route.documentId]);
  const documentGroups = useMemo(() => {
    const groups = new Map();
    documents.forEach(document => {
      const id = document.group?.id || document.kind || 'documentation';
      const title = document.group?.title || (document.kind === 'technical' ? 'Technical Reference' : 'Documentation');
      if (!groups.has(id)) groups.set(id, { id, title, documents: [] });
      groups.get(id).documents.push(document);
    });
    return Array.from(groups.values());
  }, [documents]);

  const sections = useMemo(() => (
    selectedDocument ? buildDocumentSections(selectedDocument) : []
  ), [selectedDocument]);
  const selectedSection = useMemo(() => (
    sections.find(section => section.slug === route.section) || sections[0] || null
  ), [route.section, sections]);
  const selectedSectionIndex = selectedSection
    ? sections.findIndex(section => section.slug === selectedSection.slug)
    : -1;
  const previousSection = selectedSectionIndex > 0 ? sections[selectedSectionIndex - 1] : null;
  const nextSection = selectedSectionIndex >= 0 && selectedSectionIndex < sections.length - 1
    ? sections[selectedSectionIndex + 1]
    : null;
  const searchResults = useMemo(() => (
    searchDocuments(documents, searchQuery)
  ), [documents, searchQuery]);

  useEffect(() => {
    const groupId = selectedDocument?.group?.id;
    if (!groupId) return;
    setOpenGroups(current => current[groupId] ? current : { ...current, [groupId]: true });
  }, [selectedDocument]);

  useEffect(() => {
    if (loading || !selectedDocument || !selectedSection) return;
    const documentIsValid = documents.some(document => document.id === route.documentId);
    const sectionIsValid = sections.some(section => section.slug === route.section);
    if (!documentIsValid || !sectionIsValid) {
      window.location.hash = buildDocsHash(selectedDocument.id, selectedSection.slug);
    }
  }, [documents, loading, route.documentId, route.section, sections, selectedDocument, selectedSection]);

  useEffect(() => {
    if (!selectedSection || searchQuery.trim()) return undefined;
    const timer = window.setTimeout(() => {
      if (selectedSectionIndex === 0) {
        window.scrollTo({ top: 0 });
      } else {
        document.getElementById(selectedSection.slug)?.scrollIntoView({ block: 'start' });
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [searchQuery, selectedSection, selectedSectionIndex]);

  const markdownComponents = useMemo(() => {
    if (!selectedDocument) return {};

    const makeHeading = Tag => function MarkdownHeading({ node: _node, id, children, ...props }) {
      const linked = Tag === 'h2' || Tag === 'h3';
      return (
        <Tag id={id} data-doc-heading="true" {...props}>
          {linked ? (
            <a href={buildDocsHash(selectedDocument.id, id)} className="heading-anchor">
              <span>{children}</span>
              <LinkIcon size={15} aria-hidden="true" />
            </a>
          ) : children}
        </Tag>
      );
    };

    return {
      h1({ node: _node, id }) {
        return <span id={id} className="docs-heading-target" aria-hidden="true" />;
      },
      h2: makeHeading('h2'),
      h3: makeHeading('h3'),
      h4: makeHeading('h4'),
      pre({ node: _node, children, ...props }) {
        const child = Children.count(children) === 1 ? Children.only(children) : null;
        if (isValidElement(child) && String(child.props.className || '').includes('language-mermaid')) {
          return child;
        }
        return <pre {...props}>{children}</pre>;
      },
      code({ node: _node, className = '', children, ...props }) {
        const content = String(children).replace(/\n$/, '');
        if (className.includes('language-mermaid')) return <MermaidDiagram chart={content} />;
        return <code className={className} {...props}>{children}</code>;
      },
      a({ node: _node, href, children, ...props }) {
        const resolved = resolveMarkdownHref(href, documents, selectedDocument.id);
        return (
          <a
            href={resolved.href}
            target={resolved.external ? '_blank' : undefined}
            rel={resolved.external ? 'noreferrer noopener' : undefined}
            {...props}
          >
            {children}
            {resolved.external && <ExternalLink size={13} className="external-link-icon" aria-hidden="true" />}
          </a>
        );
      },
      img({ node: _node, src, alt, ...props }) {
        return <ZoomableImage src={src} alt={alt} {...props} />;
      },
    };
  }, [documents, selectedDocument]);

  const currentSection = selectedSection?.slug || '';

  return (
    <div className="docs-page">
      <header className="docs-topbar">
        <div className="docs-topbar-left">
          <button type="button" className="docs-icon-command docs-back-command" onClick={onBack} title="Back to Hub">
            <ArrowLeft size={17} />
            <span>Back to Hub</span>
          </button>
          <div className="docs-brand">
            <Shield size={19} />
            <span>Documentation</span>
          </div>
        </div>
        <div className="docs-topbar-user">
          <span className="docs-user-name">{user?.username}</span>
          <span className={`docs-role-badge ${user?.role}`}>{user?.role}</span>
          <button type="button" className="docs-icon-command" onClick={onLogout} title="Sign Out">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <main className="docs-main">
        <div className="docs-page-heading">
          <div>
            <p className="docs-eyebrow">Internal Security Middleware Hub</p>
            <h1>Documentation center</h1>
          </div>
          <label className="docs-search-box">
            <span className="sr-only">Search documentation</span>
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search documentation"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} title="Clear search">
                <X size={16} />
              </button>
            )}
          </label>
        </div>

        {loading ? (
          <div className="docs-status-state" role="status">
            <LoaderCircle size={28} className="spin" />
            <h2>Loading documentation</h2>
          </div>
        ) : error ? (
          <div className="docs-status-state docs-error-state" role="alert">
            <AlertTriangle size={30} />
            <h2>Documentation unavailable</h2>
            <p>{error}</p>
            <button type="button" onClick={() => setRetryKey(key => key + 1)}>
              <RefreshCw size={16} />
              <span>Try again</span>
            </button>
          </div>
        ) : documents.length === 0 ? (
          <div className="docs-status-state">
            <BookOpen size={30} />
            <h2>No documentation available</h2>
          </div>
        ) : (
          <>
            {!searchQuery.trim() && selectedDocument && (
              <div className="docs-mobile-controls">
                <label>
                  <span>Document</span>
                  <select
                    value={selectedDocument.id}
                    onChange={event => { window.location.hash = buildDocsHash(event.target.value); }}
                  >
                    {documentGroups.map(group => (
                      <optgroup key={group.id} label={group.title}>
                        {group.documents.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Section</span>
                  <select
                    value={currentSection}
                    onChange={event => { window.location.hash = buildDocsHash(selectedDocument.id, event.target.value); }}
                  >
                    {sections.map(section => (
                      <option key={section.slug} value={section.slug}>
                        {section.depth === 3 ? `- ${getSectionLabel(section)}` : getSectionLabel(section)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className={`docs-layout ${searchQuery.trim() ? 'search-mode' : ''}`}>
              <aside className="docs-document-nav" aria-label="Documents">
                <div className="docs-aside-heading">
                  <FileText size={16} />
                  <span>Documents</span>
                </div>
                <nav>
                  {documentGroups.map(group => {
                    const isOpen = Boolean(openGroups[group.id]);
                    return (
                      <div key={group.id} className="docs-document-group">
                        <button
                          type="button"
                          className="docs-document-group-toggle"
                          onClick={() => setOpenGroups(current => ({ ...current, [group.id]: !isOpen }))}
                          aria-expanded={isOpen}
                        >
                          <ChevronDown size={15} className={isOpen ? 'open' : ''} />
                          <FolderOpen size={15} />
                          <span>{group.title}</span>
                          <small>{group.documents.length}</small>
                        </button>
                        {isOpen && (
                          <div className="docs-document-group-items">
                            {group.documents.map(document => (
                              <a
                                key={document.id}
                                href={buildDocsHash(document.id)}
                                className={selectedDocument?.id === document.id && !searchQuery.trim() ? 'active' : ''}
                                aria-current={selectedDocument?.id === document.id && !searchQuery.trim() ? 'page' : undefined}
                              >
                                <span>{document.title}</span>
                                {document.kind === 'technical' && <small>Admin</small>}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </nav>
              </aside>

              {searchQuery.trim() ? (
                <SearchResults query={searchQuery} results={searchResults} onOpen={() => setSearchQuery('')} />
              ) : (
                <article className="docs-article">
                  <nav className="docs-breadcrumb" aria-label="Breadcrumb">
                    <span>{selectedDocument.group?.title || 'Documentation'}</span>
                    <ChevronRight size={14} />
                    <span>{selectedDocument.title}</span>
                    <ChevronRight size={14} />
                    <strong>{getSectionLabel(selectedSection)}</strong>
                  </nav>
                  <header className="docs-document-header">
                    <div className="document-kind"><BookOpen size={15} /> {selectedDocument.kind === 'technical' ? 'Technical reference' : 'User documentation'}</div>
                    <h1>{selectedDocument.title}</h1>
                    <p>{selectedDocument.description}</p>
                    <span>Updated {formatUpdatedAt(selectedDocument.updatedAt)}</span>
                  </header>
                  <section id={selectedSection.slug} className="docs-section-reader">
                    <header className="docs-section-reader-header">
                      <p>Section {selectedSectionIndex + 1} of {sections.length}</p>
                      <h2>{getSectionLabel(selectedSection)}</h2>
                    </header>
                    {selectedSection.markdown && (
                      <div className="markdown-body">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkHeadingIds]}
                          components={markdownComponents}
                        >
                          {selectedSection.markdown}
                        </ReactMarkdown>
                      </div>
                    )}
                  </section>
                  <nav className="docs-section-pagination" aria-label="Section navigation">
                    {previousSection ? (
                      <a href={buildDocsHash(selectedDocument.id, previousSection.slug)} className="previous">
                        <ChevronLeft size={18} />
                        <span><small>Previous</small><strong>{getSectionLabel(previousSection)}</strong></span>
                      </a>
                    ) : <span />}
                    {nextSection ? (
                      <a href={buildDocsHash(selectedDocument.id, nextSection.slug)} className="next">
                        <span><small>Next</small><strong>{getSectionLabel(nextSection)}</strong></span>
                        <ChevronRight size={18} />
                      </a>
                    ) : <span />}
                  </nav>
                </article>
              )}

              {!searchQuery.trim() && (
                <aside className="docs-section-nav" aria-label="On this page">
                  <div className="docs-aside-heading">
                    <List size={16} />
                    <span>Sections</span>
                  </div>
                  <nav>
                    {sections.map(section => (
                      <a
                        key={section.slug}
                        href={buildDocsHash(selectedDocument.id, section.slug)}
                        className={`${section.depth === 3 ? 'nested' : ''} ${selectedSection.slug === section.slug ? 'active' : ''}`.trim()}
                        aria-current={selectedSection.slug === section.slug ? 'location' : undefined}
                      >
                        {getSectionLabel(section)}
                      </a>
                    ))}
                  </nav>
                </aside>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
