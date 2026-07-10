const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MANIFEST_FILE = '.seed-manifest.json';

const hashBuffer = value => crypto.createHash('sha256').update(value).digest('hex');

const pathExists = async filePath => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const listFiles = async (rootDir, relativeDir = '') => {
  const currentDir = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.backups' || entry.name === MANIFEST_FILE) continue;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(rootDir, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const readManifest = async manifestPath => {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    return parsed?.version === 1 && parsed.files && typeof parsed.files === 'object'
      ? parsed
      : { version: 1, files: {} };
  } catch {
    return { version: 1, files: {} };
  }
};

const seedDocsDirectory = async ({
  sourceDir = process.env.DOCS_DEFAULT_DIR,
  targetDir = process.env.DOCS_DIR
} = {}) => {
  if (!sourceDir || !targetDir || !await pathExists(sourceDir)) {
    return { copied: [], updated: [], preserved: [], skipped: true };
  }

  await fs.mkdir(targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, MANIFEST_FILE);
  const previousManifest = await readManifest(manifestPath);
  const nextManifest = { version: 1, files: {} };
  const result = { copied: [], updated: [], preserved: [], skipped: false };

  for (const relativePath of await listFiles(sourceDir)) {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    const sourceContent = await fs.readFile(sourcePath);
    const sourceHash = hashBuffer(sourceContent);
    const previousSourceHash = previousManifest.files[relativePath]?.sourceHash || '';
    nextManifest.files[relativePath] = { sourceHash };

    if (!await pathExists(targetPath)) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, sourceContent);
      result.copied.push(relativePath);
      continue;
    }

    const targetHash = hashBuffer(await fs.readFile(targetPath));
    if (targetHash === sourceHash) continue;
    if (previousSourceHash && targetHash === previousSourceHash) {
      await fs.writeFile(targetPath, sourceContent);
      result.updated.push(relativePath);
      continue;
    }
    result.preserved.push(relativePath);
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  return result;
};

module.exports = {
  MANIFEST_FILE,
  seedDocsDirectory
};
