import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocsHash,
  buildDocumentSections,
  createHeadingSlugger,
  parseDocsRoute,
  remarkHeadingIds,
  searchDocuments,
  slugifyHeading,
} from './docsUtils.js';

test('heading slugs are stable and duplicate-safe', () => {
  const nextSlug = createHeadingSlugger();
  assert.equal(slugifyHeading('Sync Findings & Redmine'), 'sync-findings-redmine');
  assert.equal(nextSlug('Settings'), 'settings');
  assert.equal(nextSlug('Settings'), 'settings-2');
  assert.equal(nextSlug('Settings'), 'settings-3');
});

test('section extraction ignores headings inside code fences', () => {
  const document = {
    id: 'guide',
    title: 'Guide',
    content: [
      '# Guide',
      'Welcome text.',
      '## Setup',
      'First setup section.',
      '```text',
      '## Not a heading',
      '```',
      '## Setup',
      'Second setup section.',
    ].join('\n'),
  };

  const sections = buildDocumentSections(document);
  assert.deepEqual(sections.map(section => section.slug), ['guide', 'setup', 'setup-2']);
  assert.match(sections[1].text, /Not a heading/);
  assert.match(sections[1].markdown, /```text\n## Not a heading\n```/);
  assert.doesNotMatch(sections[1].markdown, /Second setup section/);
});

test('numbered heading titles and slugs stay aligned with rendered Markdown', () => {
  const sections = buildDocumentSections({
    id: 'architecture',
    title: 'Architecture',
    content: '# Architecture\n\n## 3. Authentication & Auth Flow\n\nDetails.',
  });

  assert.equal(sections[1].title, '3. Authentication & Auth Flow');
  assert.equal(sections[1].slug, '3-authentication-auth-flow');
});

test('search is case-insensitive, token-based, and section-aware', () => {
  const documents = [{
    id: 'user-guide',
    title: 'User Guide',
    content: '# User Guide\n\n## Sync Findings\n\nPull current vulnerabilities from DefectDojo.\n\n## Users\n\nManage accounts.',
  }];

  const results = searchDocuments(documents, 'DEFECTDOJO vulnerabilities');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Sync Findings');
  assert.equal(searchDocuments(documents, 'missing phrase').length, 0);
});

test('remark heading IDs use the same duplicate-safe slugs', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Settings' }] },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Settings' }] },
    ],
  };

  remarkHeadingIds()(tree);
  assert.equal(tree.children[0].data.hProperties.id, 'settings');
  assert.equal(tree.children[1].data.hProperties.id, 'settings-2');
});

test('documentation hashes round-trip document and section identifiers', () => {
  const hash = buildDocsHash('user-guide', 'sync findings');
  assert.deepEqual(parseDocsRoute(hash), {
    documentId: 'user-guide',
    section: 'sync findings',
  });
});
