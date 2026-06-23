const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  getDocumentDefinitions,
  readDocuments,
  resolveDocumentPath,
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
