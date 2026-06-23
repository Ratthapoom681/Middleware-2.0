const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const DOCUMENTS = Object.freeze([
  Object.freeze({
    id: 'quick-start',
    fileName: 'quick-start.md',
    title: 'Quick Start',
    description: 'Step-by-step guide to prepare DefectDojo, Redmine, configure the middleware, and run your first sync.',
    kind: 'user',
    groupId: 'getting-started',
    groupTitle: 'Getting Started',
    adminOnly: false,
  }),
  Object.freeze({
    id: 'hub-guide',
    fileName: 'user-guide/hub.md',
    title: 'Hub',
    description: 'Getting started, access roles, authentication, workspace selection, and user management.',
    kind: 'user',
    groupId: 'user-guide',
    groupTitle: 'User Guide',
    adminOnly: false,
  }),
  Object.freeze({
    id: 'vulnerability-guide',
    fileName: 'user-guide/vulnerability.md',
    title: 'Vulnerability',
    description: 'DefectDojo findings, synchronization, Redmine, mitigation review, and settings.',
    kind: 'user',
    groupId: 'user-guide',
    groupTitle: 'User Guide',
    adminOnly: false,
  }),
  Object.freeze({
    id: 'wazuh-guide',
    fileName: 'user-guide/wazuh.md',
    title: 'Wazuh',
    description: 'Wazuh dashboard, alerts, incidents, agents, and settings preview.',
    kind: 'user',
    groupId: 'user-guide',
    groupTitle: 'User Guide',
    adminOnly: false,
  }),
  Object.freeze({
    id: 'operations-guide',
    fileName: 'user-guide/operations.md',
    title: 'Operations',
    description: 'Common workflows, troubleshooting guidance, and quick reference.',
    kind: 'user',
    groupId: 'user-guide',
    groupTitle: 'User Guide',
    adminOnly: false,
  }),
  Object.freeze({
    id: 'project-guide',
    fileName: 'project-guide.md',
    title: 'Project Guide',
    description: 'Engineering guidance for the DefectDojo Viewer project and its workflows.',
    kind: 'technical',
    groupId: 'technical-reference',
    groupTitle: 'Technical Reference',
    adminOnly: true,
  }),
  Object.freeze({
    id: 'architecture-overview',
    fileName: '00-overview.md',
    title: 'Architecture Overview',
    description: 'Frontend features, architecture, data flow, and API reference.',
    kind: 'technical',
    groupId: 'technical-reference',
    groupTitle: 'Technical Reference',
    adminOnly: true,
  }),
]);

function resolveDocsDir({ env = process.env, backendDir = __dirname } = {}) {
  if (env.DOCS_DIR) return path.resolve(env.DOCS_DIR);

  const candidates = [
    path.resolve(backendDir, '..', 'docs'),
    path.resolve(backendDir, '..', '..', 'docs'),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function getDocumentDefinitions(role) {
  return DOCUMENTS.filter(document => !document.adminOnly || role === 'admin');
}

function resolveDocumentPath(docsDir, fileName) {
  const root = path.resolve(docsDir);
  const filePath = path.resolve(root, fileName);
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Documentation path is outside the configured directory');
  }

  return filePath;
}

async function readDocuments({ role, docsDir = resolveDocsDir() }) {
  const definitions = getDocumentDefinitions(role);

  return Promise.all(definitions.map(async document => {
    const filePath = resolveDocumentPath(docsDir, document.fileName);
    const [content, stats] = await Promise.all([
      fsPromises.readFile(filePath, 'utf8'),
      fsPromises.stat(filePath),
    ]);

    return {
      id: document.id,
      title: document.title,
      description: document.description,
      kind: document.kind,
      group: {
        id: document.groupId,
        title: document.groupTitle,
      },
      updatedAt: stats.mtime.toISOString(),
      content,
    };
  }));
}

module.exports = {
  DOCUMENTS,
  getDocumentDefinitions,
  readDocuments,
  resolveDocsDir,
  resolveDocumentPath,
};
