const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { readDocuments } = require('./docs-service.cjs');

const PORT = process.env.PORT || 3003;
const AUTH_INTROSPECTION_URL = process.env.AUTH_INTROSPECTION_URL || '';
const AUTH_SERVICE_TOKEN = process.env.AUTH_SERVICE_TOKEN || '';
const CLIENT_DIST_DIR = process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : path.resolve(__dirname, '..', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

// Token Introspection Helper
async function introspectToken(token) {
  if (!AUTH_INTROSPECTION_URL) {
    throw new Error('AUTH_INTROSPECTION_URL is not configured');
  }

  const response = await fetch(AUTH_INTROSPECTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_SERVICE_TOKEN ? { 'X-Auth-Service-Token': AUTH_SERVICE_TOKEN } : {})
    },
    body: JSON.stringify({ token })
  });

  if (!response.ok) {
    throw new Error(`Auth introspection failed with status ${response.status}`);
  }

  return response.json();
}

// Authentication Middleware
async function authenticateJwt(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  try {
    const result = await introspectToken(token);
    if (!result?.active || !result.payload) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or revoked token' });
    }

    req.user = result.payload;
    next();
  } catch (err) {
    console.error('Authentication check failed:', err.message);
    res.status(503).json({ error: 'Authentication service unavailable' });
  }
}

// API Routes

// Documentation API
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'docs-service'
  });
});

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Docs Service backend listening on 0.0.0.0:${PORT}`);
});
