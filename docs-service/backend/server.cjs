const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const Busboy = require('busboy');
const archiver = require('archiver');
const {
  readDocuments,
  writeDocument,
  getHistory,
  revertDocument,
  setDocumentHidden,
  deleteCustomDocument,
  importDocument,
  exportDocument,
  getDocumentDefinitions,
  readRegistry,
  resolveDocsDir,
  resolveDocumentPath
} = require('./docs-service.cjs');
const { seedDocsDirectory } = require('./docs-seed.cjs');
const { authenticateJwt } = require('./auth.cjs');

const PORT = process.env.PORT || 3003;
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : path.resolve(__dirname, '..', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

// API Routes

// Get all documents
app.get('/api/docs', authenticateJwt, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    const documents = await readDocuments({ role: req.user.role });
    res.json({ documents });
  } catch (err) {
    console.error('Documentation read error:', err);
    res.status(500).json({ error: 'Documentation is temporarily unavailable' });
  }
});

// Save edited document content
app.put('/api/docs/:id', authenticateJwt, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const result = await writeDocument({
      id: req.params.id,
      content: req.body.content,
      role: req.user.role
    });
    res.json(result);
  } catch (err) {
    console.error('Document edit error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to save changes' });
  }
});

// Download single document as markdown file
app.get('/api/docs/:id/export', authenticateJwt, async (req, res) => {
  try {
    const result = await exportDocument({ id: req.params.id, role: req.user.role });
    res.set('Content-Type', 'text/markdown');
    res.set('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.send(result.content);
  } catch (err) {
    console.error('Export error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to export document' });
  }
});

// Export all documents (ZIP bundle)
app.get('/api/docs/export', authenticateJwt, async (req, res) => {
  try {
    const docsDir = resolveDocsDir();
    const registry = await readRegistry(docsDir);
    const definitions = getDocumentDefinitions(req.user.role, registry);

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="documentation-export.zip"');

    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(res);

    // Add document files
    for (const doc of definitions) {
      const filePath = resolveDocumentPath(docsDir, doc.fileName);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: doc.fileName });
      }
    }

    // Add registry.json
    const registryPath = path.join(docsDir, 'registry.json');
    if (fs.existsSync(registryPath)) {
      archive.file(registryPath, { name: 'registry.json' });
    }

    // Add custom media
    const mediaDir = path.join(docsDir, 'media');
    if (fs.existsSync(mediaDir)) {
      const mediaFiles = await fsPromises.readdir(mediaDir);
      for (const file of mediaFiles) {
        const filePath = path.join(mediaDir, file);
        const stat = await fsPromises.stat(filePath);
        if (stat.isFile()) {
          archive.file(filePath, { name: `media/${file}` });
        }
      }
    }

    // Add static public media
    const publicMedia = path.join(CLIENT_DIST_DIR, 'media__1781966150774.png');
    if (fs.existsSync(publicMedia)) {
      archive.file(publicMedia, { name: 'media__1781966150774.png' });
    }
    const devPublicMedia = path.resolve(__dirname, '..', 'public', 'media__1781966150774.png');
    if (fs.existsSync(devPublicMedia)) {
      archive.file(devPublicMedia, { name: 'media__1781966150774.png' });
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP export error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export documentation bundle' });
    }
  }
});

// Import new document (or replace existing one)
app.post('/api/docs/import', authenticateJwt, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = null;
    let fileName = '';
    const fields = {};

    busboy.on('file', (name, file, info) => {
      const { filename } = info;
      fileName = filename;
      const chunks = [];
      file.on('data', (data) => {
        chunks.push(data);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('field', (name, val) => {
      fields[name] = val;
    });

    busboy.on('finish', async () => {
      try {
        if (!fileBuffer || !fileName) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        const adminOnly = fields.adminOnly === 'true' || fields.adminOnly === true;

        const result = await importDocument({
          title: fields.title,
          groupId: fields.groupId,
          adminOnly,
          fileBuffer,
          fileName,
          documentId: fields.documentId,
          role: req.user.role
        });

        res.json(result);
      } catch (err) {
        console.error('Import error inside busboy finish:', err);
        res.status(err.status || 500).json({ error: err.message || 'Failed to import document' });
      }
    });

    busboy.on('error', (err) => {
      console.error('Busboy error:', err);
      if (!res.headersSent) {
        res.status(400).json({ error: 'Failed to parse multipart upload' });
      }
    });

    req.pipe(busboy);
  } catch (err) {
    console.error('Busboy init error:', err);
    res.status(400).json({ error: 'Failed to initialize upload parser' });
  }
});

// Get document history
app.get('/api/docs/:id/history', authenticateJwt, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const history = await getHistory({ id: req.params.id, role: req.user.role });
    res.json({ history });
  } catch (err) {
    console.error('History error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch history' });
  }
});

// Revert document to a previous backup
app.post('/api/docs/:id/revert', authenticateJwt, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const result = await revertDocument({
      id: req.params.id,
      timestamp: req.body.timestamp,
      role: req.user.role
    });
    res.json(result);
  } catch (err) {
    console.error('Revert error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to revert changes' });
  }
});

// Toggle document visibility (hiding/unhiding)
app.put('/api/docs/:id/hidden', authenticateJwt, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const result = await setDocumentHidden({
      id: req.params.id,
      hidden: !!req.body.hidden,
      role: req.user.role
    });
    res.json(result);
  } catch (err) {
    console.error('Visibility error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update visibility' });
  }
});

// Delete custom document
app.delete('/api/docs/:id', authenticateJwt, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const result = await deleteCustomDocument({
      id: req.params.id,
      role: req.user.role
    });
    res.json(result);
  } catch (err) {
    console.error('Delete error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to delete document' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'docs-service'
  });
});

// Serve dynamic uploaded media files
app.use('/media', express.static(path.join(resolveDocsDir(), 'media')));

// Serve Static Files
app.use(express.static(CLIENT_DIST_DIR));

// Fallback to SPA index.html
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});

const start = async () => {
  const seedResult = await seedDocsDirectory({
    sourceDir: process.env.DOCS_DEFAULT_DIR,
    targetDir: resolveDocsDir()
  });
  if (!seedResult.skipped) {
    console.log(
      `Docs seed complete: copied=${seedResult.copied.length}, `
      + `updated=${seedResult.updated.length}, preserved=${seedResult.preserved.length}`
    );
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Docs Service backend listening on 0.0.0.0:${PORT}`);
  });
};

start().catch(error => {
  console.error('Docs Service failed to start:', error);
  process.exit(1);
});
