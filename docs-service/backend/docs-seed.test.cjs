const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { seedDocsDirectory } = require('./docs-seed.cjs');

const createFixture = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-seed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'defaults');
  const targetDir = path.join(root, 'data');
  await fs.mkdir(sourceDir, { recursive: true });
  return { sourceDir, targetDir };
};

test('seeding copies defaults into an empty data directory', async t => {
  const { sourceDir, targetDir } = await createFixture(t);
  await fs.writeFile(path.join(sourceDir, 'guide.md'), '# Version 1');
  const result = await seedDocsDirectory({ sourceDir, targetDir });
  assert.deepEqual(result.copied, ['guide.md']);
  assert.equal(await fs.readFile(path.join(targetDir, 'guide.md'), 'utf8'), '# Version 1');
});

test('seeding updates an unchanged shipped document', async t => {
  const { sourceDir, targetDir } = await createFixture(t);
  const sourcePath = path.join(sourceDir, 'guide.md');
  await fs.writeFile(sourcePath, '# Version 1');
  await seedDocsDirectory({ sourceDir, targetDir });
  await fs.writeFile(sourcePath, '# Version 2');
  const result = await seedDocsDirectory({ sourceDir, targetDir });
  assert.deepEqual(result.updated, ['guide.md']);
  assert.equal(await fs.readFile(path.join(targetDir, 'guide.md'), 'utf8'), '# Version 2');
});

test('seeding preserves administrator edits and still adds new defaults', async t => {
  const { sourceDir, targetDir } = await createFixture(t);
  const sourcePath = path.join(sourceDir, 'guide.md');
  await fs.writeFile(sourcePath, '# Version 1');
  await seedDocsDirectory({ sourceDir, targetDir });
  await fs.writeFile(path.join(targetDir, 'guide.md'), '# Administrator edit');
  await fs.writeFile(sourcePath, '# Version 2');
  await fs.writeFile(path.join(sourceDir, 'new.md'), '# New');

  const result = await seedDocsDirectory({ sourceDir, targetDir });
  assert.deepEqual(result.preserved, ['guide.md']);
  assert.deepEqual(result.copied, ['new.md']);
  assert.equal(
    await fs.readFile(path.join(targetDir, 'guide.md'), 'utf8'),
    '# Administrator edit'
  );
});
