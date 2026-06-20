const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function slugifyHeading(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/&[a-z0-9#]+;/gi, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

export function createHeadingSlugger() {
  const counts = new Map();

  return value => {
    const base = slugifyHeading(value);
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

function getNodeText(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(getNodeText).join('');
}

function walkTree(node, visit) {
  if (!node) return;
  visit(node);
  if (Array.isArray(node.children)) {
    node.children.forEach(child => walkTree(child, visit));
  }
}

export function remarkHeadingIds() {
  return tree => {
    const nextSlug = createHeadingSlugger();

    walkTree(tree, node => {
      if (node.type !== 'heading') return;
      const id = nextSlug(getNodeText(node));
      node.data = node.data || {};
      node.data.hProperties = { ...(node.data.hProperties || {}), id };
    });
  };
}

export function stripMarkdown(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~>|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHeadingText(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildDocumentSections(document) {
  const lines = String(document?.content || '').split(/\r?\n/);
  const nextSlug = createHeadingSlugger();
  const sections = [];
  let current = null;
  let inCodeFence = false;

  function finishCurrent() {
    if (!current) return;
    const markdown = current.lines.join('\n').trim();
    const text = stripMarkdown(markdown);
    sections.push({
      documentId: document.id,
      documentTitle: document.title,
      documentGroup: document.group?.title || '',
      title: current.title,
      depth: current.depth,
      slug: current.slug,
      markdown,
      text,
      searchText: `${document.title} ${current.title} ${text}`.toLowerCase(),
    });
  }

  lines.forEach(line => {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      if (current) current.lines.push(line);
      return;
    }

    const match = inCodeFence ? null : line.match(MARKDOWN_HEADING);
    if (match) {
      finishCurrent();
      const title = cleanHeadingText(match[2]);
      current = {
        title,
        depth: match[1].length,
        slug: nextSlug(title),
        lines: [],
      };
      return;
    }

    if (!current) {
      current = {
        title: document.title,
        depth: 1,
        slug: nextSlug(document.title),
        lines: [],
      };
    }
    current.lines.push(line);
  });

  finishCurrent();
  return sections;
}

function createSnippet(text, tokens) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Section heading';

  const lower = normalized.toLowerCase();
  const firstMatch = tokens.reduce((best, token) => {
    const index = lower.indexOf(token);
    if (index < 0) return best;
    return best < 0 ? index : Math.min(best, index);
  }, -1);
  const start = Math.max(0, firstMatch - 70);
  const snippet = normalized.slice(start, start + 190);
  return `${start > 0 ? '...' : ''}${snippet}${start + 190 < normalized.length ? '...' : ''}`;
}

export function searchDocuments(documents, query) {
  const tokens = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return [];

  return documents
    .flatMap(buildDocumentSections)
    .filter(section => tokens.every(token => section.searchText.includes(token)))
    .map(section => {
      const heading = section.title.toLowerCase();
      const score = tokens.reduce((total, token) => (
        total + (heading === token ? 4 : heading.startsWith(token) ? 3 : heading.includes(token) ? 2 : 1)
      ), 0);
      return { ...section, score, snippet: createSnippet(section.text, tokens) };
    })
    .sort((a, b) => b.score - a.score || a.documentTitle.localeCompare(b.documentTitle) || a.title.localeCompare(b.title))
    .slice(0, 50);
}

export function parseDocsRoute(hash) {
  const queryIndex = String(hash || '').indexOf('?');
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : '');
  return {
    documentId: params.get('document') || '',
    section: params.get('section') || '',
  };
}

export function buildDocsHash(documentId, section = '') {
  const params = new URLSearchParams();
  if (documentId) params.set('document', documentId);
  if (section) params.set('section', section);
  const query = params.toString();
  return query ? `#docs?${query}` : '#docs';
}
