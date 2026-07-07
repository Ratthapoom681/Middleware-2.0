const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const mammoth = require('mammoth');
const { formatBangkokDate } = require('./lib/time.cjs');

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

async function readRegistry(docsDir) {
  const registryPath = path.join(docsDir, 'registry.json');
  try {
    const data = await fsPromises.readFile(registryPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {
      customDocuments: [],
      hiddenDocumentIds: []
    };
  }
}

async function writeRegistry(docsDir, registry) {
  const registryPath = path.join(docsDir, 'registry.json');
  await fsPromises.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

function getDocumentDefinitions(role, registry = { customDocuments: [], hiddenDocumentIds: [] }) {
  const hiddenDocumentIds = registry.hiddenDocumentIds || [];
  const customDocs = registry.customDocuments || [];

  const staticDocs = DOCUMENTS.map(doc => {
    const isHidden = hiddenDocumentIds.includes(doc.id);
    return {
      ...doc,
      hidden: isHidden,
      isCustom: false
    };
  });

  const mappedCustomDocs = customDocs.map(doc => {
    const isHidden = hiddenDocumentIds.includes(doc.id);
    return {
      ...doc,
      hidden: isHidden,
      isCustom: true
    };
  });

  const merged = [...staticDocs, ...mappedCustomDocs];

  return merged.filter(doc => {
    if (role === 'admin') {
      return true;
    } else {
      return !doc.adminOnly && !doc.hidden;
    }
  });
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
  const registry = await readRegistry(docsDir);
  const definitions = getDocumentDefinitions(role, registry);

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
      adminOnly: document.adminOnly || false,
      hidden: document.hidden || false,
      isCustom: document.isCustom || false,
    };
  }));
}

async function writeDocument({ id, content, role, docsDir = resolveDocsDir() }) {
  if (role !== 'admin') {
    const err = new Error('Forbidden: Only admins can edit documents');
    err.status = 403;
    throw err;
  }
  if (typeof content !== 'string') {
    const err = new Error('Invalid content: Content must be a string');
    err.status = 400;
    throw err;
  }
  if (content.length > 500 * 1024) {
    const err = new Error('Content too large: Maximum size is 500 KB');
    err.status = 413;
    throw err;
  }

  const registry = await readRegistry(docsDir);
  const definitions = getDocumentDefinitions('admin', registry);
  const document = definitions.find(d => d.id === id);
  if (!document) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const filePath = resolveDocumentPath(docsDir, document.fileName);

  // Backup existing file
  try {
    if (fs.existsSync(filePath)) {
      const existingContent = await fsPromises.readFile(filePath, 'utf8');
      const backupsDir = path.join(docsDir, '.backups');
      await fsPromises.mkdir(backupsDir, { recursive: true });
      const backupPath = path.join(backupsDir, `${id}_${Date.now()}.md`);
      await fsPromises.writeFile(backupPath, existingContent, 'utf8');
    }
  } catch (backupErr) {
    console.error('Failed to create backup:', backupErr);
  }

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, content, 'utf8');

  const stats = await fsPromises.stat(filePath);
  return { ok: true, updatedAt: stats.mtime.toISOString() };
}

async function getHistory({ id, role, docsDir = resolveDocsDir() }) {
  if (role !== 'admin') {
    const err = new Error('Forbidden: Only admins can view document history');
    err.status = 403;
    throw err;
  }

  const registry = await readRegistry(docsDir);
  const definitions = getDocumentDefinitions('admin', registry);
  const document = definitions.find(d => d.id === id);
  if (!document) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const backupsDir = path.join(docsDir, '.backups');
  try {
    const files = await fsPromises.readdir(backupsDir);
    const prefix = `${id}_`;
    return files
      .filter(file => file.startsWith(prefix) && file.endsWith('.md'))
      .map(file => {
        const tsPart = file.slice(prefix.length, -3);
        const timestamp = parseInt(tsPart, 10);
        return {
          filename: file,
          timestamp,
          date: new Date(timestamp).toISOString()
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    return [];
  }
}

async function revertDocument({ id, timestamp, role, docsDir = resolveDocsDir() }) {
  if (role !== 'admin') {
    const err = new Error('Forbidden: Only admins can revert documents');
    err.status = 403;
    throw err;
  }

  const registry = await readRegistry(docsDir);
  const definitions = getDocumentDefinitions('admin', registry);
  const document = definitions.find(d => d.id === id);
  if (!document) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const filePath = resolveDocumentPath(docsDir, document.fileName);
  const backupPath = path.join(docsDir, '.backups', `${id}_${timestamp}.md`);

  if (!fs.existsSync(backupPath)) {
    const err = new Error('Backup version not found');
    err.status = 404;
    throw err;
  }

  // Create safety backup of current state
  try {
    if (fs.existsSync(filePath)) {
      const existingContent = await fsPromises.readFile(filePath, 'utf8');
      const backupsDir = path.join(docsDir, '.backups');
      const safetyBackupPath = path.join(backupsDir, `${id}_${Date.now()}.md`);
      await fsPromises.writeFile(safetyBackupPath, existingContent, 'utf8');
    }
  } catch (err) {
    console.error('Failed to create safety backup:', err);
  }

  await fsPromises.copyFile(backupPath, filePath);
  const stats = await fsPromises.stat(filePath);
  return { ok: true, updatedAt: stats.mtime.toISOString() };
}

async function setDocumentHidden({ id, hidden, role, docsDir = resolveDocsDir() }) {
  if (role !== 'admin') {
    const err = new Error('Forbidden: Only admins can manage document visibility');
    err.status = 403;
    throw err;
  }

  const registry = await readRegistry(docsDir);
  const definitions = getDocumentDefinitions('admin', registry);
  const document = definitions.find(d => d.id === id);
  if (!document) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const hiddenIds = registry.hiddenDocumentIds || [];
  if (hidden) {
    if (!hiddenIds.includes(id)) {
      hiddenIds.push(id);
    }
  } else {
    const idx = hiddenIds.indexOf(id);
    if (idx !== -1) {
      hiddenIds.splice(idx, 1);
    }
  }

  registry.hiddenDocumentIds = hiddenIds;
  await writeRegistry(docsDir, registry);

  return { ok: true, hidden };
}

async function deleteCustomDocument({ id, role, docsDir = resolveDocsDir() }) {
  if (role !== 'admin') {
    const err = new Error('Forbidden: Only admins can delete documents');
    err.status = 403;
    throw err;
  }

  const registry = await readRegistry(docsDir);
  const customDocs = registry.customDocuments || [];
  const docIdx = customDocs.findIndex(d => d.id === id);
  if (docIdx === -1) {
    const err = new Error('Document not found or is a built-in document (built-in docs cannot be deleted)');
    err.status = 404;
    throw err;
  }

  const document = customDocs[docIdx];
  const filePath = resolveDocumentPath(docsDir, document.fileName);

  customDocs.splice(docIdx, 1);
  registry.customDocuments = customDocs;

  const hiddenIds = registry.hiddenDocumentIds || [];
  const hiddenIdx = hiddenIds.indexOf(id);
  if (hiddenIdx !== -1) {
    hiddenIds.splice(hiddenIdx, 1);
    registry.hiddenDocumentIds = hiddenIds;
  }

  await writeRegistry(docsDir, registry);

  if (fs.existsSync(filePath)) {
    await fsPromises.unlink(filePath);
  }

  const backupsDir = path.join(docsDir, '.backups');
  try {
    if (fs.existsSync(backupsDir)) {
      const files = await fsPromises.readdir(backupsDir);
      const prefix = `${id}_`;
      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith('.md')) {
          await fsPromises.unlink(path.join(backupsDir, file));
        }
      }
    }
  } catch (err) {
    console.error('Failed to clean up backups on delete:', err);
  }

  return { ok: true };
}

async function importDocument({
  title,
  groupId,
  adminOnly,
  fileBuffer,
  fileName: originalName,
  documentId,
  role,
  docsDir = resolveDocsDir()
}) {
  if (role !== 'admin') {
    const err = new Error('Forbidden: Only admins can import documents');
    err.status = 403;
    throw err;
  }

  const isDocx = originalName.toLowerCase().endsWith('.docx');
  const isMd = originalName.toLowerCase().endsWith('.md');
  if (!isDocx && !isMd) {
    const err = new Error('Invalid file type: Only .md and .docx files are supported');
    err.status = 400;
    throw err;
  }

  let markdown = '';
  if (isDocx) {
    const convertImage = mammoth.images.imgElement(async (image) => {
      const imageBuffer = await image.read();
      const contentType = image.contentType || 'image/png';
      const ext = contentType.split('/')[1] || 'png';
      const imageFileName = `media__${Date.now()}__${Math.floor(Math.random() * 10000)}.${ext}`;
      
      const mediaDir = path.join(docsDir, 'media');
      await fsPromises.mkdir(mediaDir, { recursive: true });
      await fsPromises.writeFile(path.join(mediaDir, imageFileName), imageBuffer);
      
      return {
        src: `/docs/media/${imageFileName}`
      };
    });

    const result = await mammoth.convertToMarkdown({ buffer: fileBuffer }, { convertImage });
    markdown = result.value;
    markdown = markdown.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  } else {
    markdown = fileBuffer.toString('utf8');
  }

  const registry = await readRegistry(docsDir);

  let id = documentId;
  let targetFileName = '';
  let docTitle = title || 'Imported Document';
  let isNew = !id;

  if (isNew) {
    let slug = docTitle.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (!slug) slug = 'imported-document';
    
    let finalId = slug;
    let counter = 1;
    const definitions = getDocumentDefinitions('admin', registry);
    while (definitions.some(d => d.id === finalId)) {
      finalId = `${slug}-${counter}`;
      counter++;
    }
    id = finalId;
    targetFileName = `custom/${id}.md`;
  } else {
    const definitions = getDocumentDefinitions('admin', registry);
    const existing = definitions.find(d => d.id === id);
    if (!existing) {
      const err = new Error('Document to overwrite not found');
      err.status = 404;
      throw err;
    }
    targetFileName = existing.fileName;
    if (!docTitle && existing.title) docTitle = existing.title;
    if (!groupId && existing.groupId) groupId = existing.groupId;
    if (adminOnly === undefined && existing.adminOnly !== undefined) adminOnly = existing.adminOnly;
  }

  const targetPath = resolveDocumentPath(docsDir, targetFileName);

  if (!isNew && fs.existsSync(targetPath)) {
    try {
      const existingContent = await fsPromises.readFile(targetPath, 'utf8');
      const backupsDir = path.join(docsDir, '.backups');
      await fsPromises.mkdir(backupsDir, { recursive: true });
      const backupPath = path.join(backupsDir, `${id}_${Date.now()}.md`);
      await fsPromises.writeFile(backupPath, existingContent, 'utf8');
    } catch (err) {
      console.error('Backup failed during import overwrite:', err);
    }
  }

  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
  await fsPromises.writeFile(targetPath, markdown, 'utf8');

  const isCustom = isNew || registry.customDocuments.some(d => d.id === id);
  if (isCustom) {
    const customDocs = registry.customDocuments || [];
    const existingIdx = customDocs.findIndex(d => d.id === id);

    let kind = adminOnly ? 'technical' : 'user';
    let groupTitle = 'Custom Documents';
    let finalGroupId = groupId || 'custom';
    if (finalGroupId === 'getting-started') groupTitle = 'Getting Started';
    else if (finalGroupId === 'user-guide') groupTitle = 'User Guide';
    else if (finalGroupId === 'technical-reference') groupTitle = 'Technical Reference';

    const docMetadata = {
      id,
      fileName: targetFileName,
      title: docTitle,
      description: `Imported from ${originalName} on ${formatBangkokDate()}`,
      kind,
      groupId: finalGroupId,
      groupTitle,
      adminOnly: !!adminOnly,
      createdAt: new Date().toISOString()
    };

    if (existingIdx !== -1) {
      customDocs[existingIdx] = docMetadata;
    } else {
      customDocs.push(docMetadata);
    }

    registry.customDocuments = customDocs;
    await writeRegistry(docsDir, registry);
  }

  const stats = await fsPromises.stat(targetPath);
  return {
    id,
    title: docTitle,
    fileName: targetFileName,
    updatedAt: stats.mtime.toISOString(),
    isCustom,
    markdown
  };
}

async function exportDocument({ id, role, docsDir = resolveDocsDir() }) {
  const registry = await readRegistry(docsDir);
  const definitions = getDocumentDefinitions(role, registry);
  const document = definitions.find(d => d.id === id);
  if (!document) {
    const err = new Error('Document not found or access denied');
    err.status = 404;
    throw err;
  }

  const filePath = resolveDocumentPath(docsDir, document.fileName);
  const content = await fsPromises.readFile(filePath, 'utf8');
  return {
    fileName: path.basename(document.fileName),
    content
  };
}

module.exports = {
  DOCUMENTS,
  getDocumentDefinitions,
  readDocuments,
  resolveDocsDir,
  resolveDocumentPath,
  readRegistry,
  writeRegistry,
  writeDocument,
  getHistory,
  revertDocument,
  setDocumentHidden,
  deleteCustomDocument,
  importDocument,
  exportDocument,
};
