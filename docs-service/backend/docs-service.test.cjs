const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  getDocumentDefinitions,
  readDocuments,
  resolveDocumentPath,
  writeDocument,
  getHistory,
  revertDocument,
  setDocumentHidden,
  deleteCustomDocument,
  importDocument,
  exportDocument,
} = require('./docs-service.cjs');

async function createDocsDirectory() {
  const docsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-docs-'));
  await fs.mkdir(path.join(docsDir, 'user-guide'));
  await Promise.all([
    fs.writeFile(path.join(docsDir, 'quick-start.md'), '# Quick Start\n\nGet started.'),
    fs.writeFile(path.join(docsDir, 'user-guide', 'hub.md'), '# Hub Guide\n\nWelcome.'),
    fs.writeFile(path.join(docsDir, 'user-guide', 'vulnerability.md'), '# Vulnerability Guide\n\nFindings.'),
    fs.writeFile(path.join(docsDir, 'user-guide', 'wazuh.md'), '# Wazuh Guide\n\nAlerts.'),
    fs.writeFile(path.join(docsDir, 'user-guide', 'operations.md'), '# Operations Guide\n\nWorkflows.'),
    fs.writeFile(path.join(docsDir, 'project-guide.md'), '# Project Guide\n\nEngineering.'),
    fs.writeFile(path.join(docsDir, '00-overview.md'), '# Architecture\n\nSystem.'),
  ]);
  return docsDir;
}

test('viewer definitions include the five user guide documents', () => {
  assert.deepEqual(
    getDocumentDefinitions('viewer').map(document => document.id),
    ['quick-start', 'hub-guide', 'vulnerability-guide', 'wazuh-guide', 'operations-guide'],
  );
});

test('admin definitions include user and technical documents', () => {
  assert.deepEqual(
    getDocumentDefinitions('admin').map(document => document.id),
    ['quick-start', 'hub-guide', 'vulnerability-guide', 'wazuh-guide', 'operations-guide', 'project-guide', 'architecture-overview'],
  );
});

test('readDocuments returns current content and metadata for the role', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  const viewerDocuments = await readDocuments({ role: 'viewer', docsDir });
  assert.equal(viewerDocuments.length, 5);
  const hubDoc = viewerDocuments.find(d => d.id === 'hub-guide');
  assert.ok(hubDoc);
  assert.match(hubDoc.content, /Welcome/);
  assert.equal(hubDoc.kind, 'user');
  assert.deepEqual(hubDoc.group, { id: 'user-guide', title: 'User Guide' });
  assert.ok(Date.parse(hubDoc.updatedAt));

  await fs.writeFile(path.join(docsDir, 'user-guide', 'hub.md'), '# Hub Guide\n\nUpdated content.');
  const refreshedDocuments = await readDocuments({ role: 'viewer', docsDir });
  const refreshedHubDoc = refreshedDocuments.find(d => d.id === 'hub-guide');
  assert.match(refreshedHubDoc.content, /Updated content/);
});

test('missing authorized documents reject the request', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));
  await fs.rm(path.join(docsDir, 'project-guide.md'));

  await assert.rejects(
    readDocuments({ role: 'admin', docsDir }),
    error => error?.code === 'ENOENT',
  );
});

test('document paths cannot escape the configured docs directory', () => {
  const docsDir = path.join(os.tmpdir(), 'hub-docs-root');
  assert.throws(
    () => resolveDocumentPath(docsDir, '../outside.md'),
    /outside the configured directory/,
  );
});

test('writeDocument saves changes, enforces permissions, and creates backup', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  // Non-admin edit should be forbidden
  await assert.rejects(
    writeDocument({ id: 'quick-start', content: '# New content', role: 'viewer', docsDir }),
    /Forbidden/
  );

  // Admin edit should succeed
  const result = await writeDocument({ id: 'quick-start', content: '# New content', role: 'admin', docsDir });
  assert.ok(result.ok);
  assert.ok(result.updatedAt);

  // File should have new content
  const updatedContent = await fs.readFile(path.join(docsDir, 'quick-start.md'), 'utf8');
  assert.equal(updatedContent, '# New content');

  // Backup file should exist in .backups/
  const backups = await fs.readdir(path.join(docsDir, '.backups'));
  assert.equal(backups.length, 1);
  assert.ok(backups[0].startsWith('quick-start_'));
  assert.ok(backups[0].endsWith('.md'));

  // Backup content should be the old content
  const backupContent = await fs.readFile(path.join(docsDir, '.backups', backups[0]), 'utf8');
  assert.equal(backupContent, '# Quick Start\n\nGet started.');
});

test('getHistory and revertDocument restore older versions', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  // Edit twice to create two backups
  await writeDocument({ id: 'quick-start', content: '# Version 2', role: 'admin', docsDir });
  await writeDocument({ id: 'quick-start', content: '# Version 3', role: 'admin', docsDir });

  const history = await getHistory({ id: 'quick-start', role: 'admin', docsDir });
  assert.equal(history.length, 2);

  // Revert to original content (which is history[1], sorted newest first)
  const originalBackup = history[1];
  
  const revertResult = await revertDocument({
    id: 'quick-start',
    timestamp: originalBackup.timestamp,
    role: 'admin',
    docsDir
  });
  assert.ok(revertResult.ok);

  const revertedContent = await fs.readFile(path.join(docsDir, 'quick-start.md'), 'utf8');
  assert.equal(revertedContent, '# Quick Start\n\nGet started.');
});

test('setDocumentHidden updates visibility status', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  // Hide quick-start
  await setDocumentHidden({ id: 'quick-start', hidden: true, role: 'admin', docsDir });

  // Read registry and verify hidden list
  const registryPath = path.join(docsDir, 'registry.json');
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  assert.deepEqual(registry.hiddenDocumentIds, ['quick-start']);

  // Viewer definitions should NOT have quick-start now
  const viewerDocs = await readDocuments({ role: 'viewer', docsDir });
  assert.ok(!viewerDocs.some(d => d.id === 'quick-start'));

  // Admin definitions should still have it but flagged as hidden
  const adminDocs = await readDocuments({ role: 'admin', docsDir });
  const hiddenDoc = adminDocs.find(d => d.id === 'quick-start');
  assert.ok(hiddenDoc);
  assert.equal(hiddenDoc.hidden, true);
});

test('importDocument handles md and mock docx formats', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  // Import .md
  const mdBuffer = Buffer.from('# Imported MD\n\nBody content.', 'utf8');
  const importResult = await importDocument({
    title: 'Imported MD Title',
    groupId: 'custom',
    adminOnly: false,
    fileBuffer: mdBuffer,
    fileName: 'imported-file.md',
    role: 'admin',
    docsDir
  });

  assert.equal(importResult.id, 'imported-md-title');
  assert.equal(importResult.title, 'Imported MD Title');
  assert.equal(importResult.isCustom, true);

  // File should exist on disk
  const mdContent = await fs.readFile(path.join(docsDir, 'custom', 'imported-md-title.md'), 'utf8');
  assert.equal(mdContent, '# Imported MD\n\nBody content.');

  // Mock docx conversion
  const originalMammoth = require('mammoth');
  t.after(() => {
    require('mammoth').convertToMarkdown = originalMammoth.convertToMarkdown;
  });
  require('mammoth').convertToMarkdown = async () => ({
    value: '# Converted Docx\n\nWord conversion succeeds.',
    messages: []
  });

  const docxBuffer = Buffer.from('mock-docx-bytes');
  const docxImportResult = await importDocument({
    title: 'Imported Word Title',
    groupId: 'user-guide',
    adminOnly: true,
    fileBuffer: docxBuffer,
    fileName: 'document.docx',
    role: 'admin',
    docsDir
  });

  assert.equal(docxImportResult.id, 'imported-word-title');
  assert.equal(docxImportResult.title, 'Imported Word Title');
  assert.match(docxImportResult.markdown, /Converted Docx/);

  // Read documents list to verify registry merge
  const adminDocs = await readDocuments({ role: 'admin', docsDir });
  const customWordDoc = adminDocs.find(d => d.id === 'imported-word-title');
  assert.ok(customWordDoc);
  assert.equal(customWordDoc.group.id, 'user-guide');
  assert.equal(customWordDoc.adminOnly, true);
  assert.equal(customWordDoc.isCustom, true);
});

test('deleteCustomDocument removes custom file and registry entry', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  // Import custom file first
  const mdBuffer = Buffer.from('# Custom Doc', 'utf8');
  await importDocument({
    title: 'Deletable Doc',
    groupId: 'custom',
    fileBuffer: mdBuffer,
    fileName: 'deletable.md',
    role: 'admin',
    docsDir
  });

  const customFilePath = path.join(docsDir, 'custom', 'deletable-doc.md');
  assert.ok(await fs.stat(customFilePath).then(() => true).catch(() => false));

  // Try to delete a built-in document (should fail)
  await assert.rejects(
    deleteCustomDocument({ id: 'quick-start', role: 'admin', docsDir }),
    /built-in docs cannot be deleted/
  );

  // Delete custom document
  const deleteResult = await deleteCustomDocument({
    id: 'deletable-doc',
    role: 'admin',
    docsDir
  });
  assert.ok(deleteResult.ok);

  // File should be deleted
  assert.ok(!(await fs.stat(customFilePath).then(() => true).catch(() => false)));

  // Registry should not contain it
  const adminDocs = await readDocuments({ role: 'admin', docsDir });
  assert.ok(!adminDocs.some(d => d.id === 'deletable-doc'));
});

test('exportDocument retrieves raw document content', async t => {
  const docsDir = await createDocsDirectory();
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));

  const result = await exportDocument({ id: 'quick-start', role: 'viewer', docsDir });
  assert.equal(result.fileName, 'quick-start.md');
  assert.equal(result.content, '# Quick Start\n\nGet started.');
});
