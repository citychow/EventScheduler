#!/usr/bin/env node
/**
 * Wembley Monitor — Express Server
 * Serves the frontend and exposes API endpoints for live data.
 *
 * Endpoints:
 *   GET  /              → serves index.html
 *   GET  /api/events    → returns events.json
 *   GET  /api/run-log   → returns run-log.json
 *   GET  /exports/:file → download a CSV export file
 *
 * Usage:
 *   node server.js
 *   PORT=3000 node server.js
 */

const http    = require('http');
const fs      = require('fs');
const path    = require('path');

require('dotenv').config();

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const STATIC_DIR  = __dirname;
const EVENTS_FILE = path.join(__dirname, 'events.json');
const LOG_FILE    = path.join(__dirname, 'run-log.json');
const EXPORTS_DIR = path.join(__dirname, 'exports');

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.csv':  'text/csv',
  '.ico':  'image/x-icon',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, 'application/json', JSON.stringify(data, null, 2));
}

function sendFile(res, filepath, contentType) {
  fs.readFile(filepath, (err, data) => {
    if (err) {
      send(res, 404, 'text/plain', 'Not found');
      return;
    }
    send(res, 200, contentType, data);
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────
function router(req, res) {
  const url = req.url.split('?')[0];

  console.log(`[${new Date().toLocaleString('en-GB')}] ${req.method} ${url}`);

  // ── GET /api/events ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/events') {
    if (!fs.existsSync(EVENTS_FILE)) {
      sendJSON(res, 200, []);
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
      sendJSON(res, 200, data);
    } catch(e) {
      sendJSON(res, 500, { error: 'Failed to read events.json' });
    }
    return;
  }

  // ── GET /api/run-log ────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/run-log') {
    if (!fs.existsSync(LOG_FILE)) {
      sendJSON(res, 200, []);
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      sendJSON(res, 200, data);
    } catch(e) {
      sendJSON(res, 500, { error: 'Failed to read run-log.json' });
    }
    return;
  }

  // ── GET /exports/:filename ──────────────────────────────────────────────────
  if (req.method === 'GET' && url.startsWith('/exports/')) {
    const filename = path.basename(url.replace('/exports/', ''));

    // only allow .csv files, block path traversal
    if (!filename.endsWith('.csv') || filename.includes('..')) {
      send(res, 400, 'text/plain', 'Invalid filename');
      return;
    }

    const filepath = path.join(EXPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) {
      send(res, 404, 'text/plain', 'Export file not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    fs.createReadStream(filepath).pipe(res);
    return;
  }

  // ── GET / → index.html ──────────────────────────────────────────────────────
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    sendFile(res, path.join(STATIC_DIR, 'index.html'), 'text/html');
    return;
  }

  // ── Static files (style.css etc.) ───────────────────────────────────────────
  if (req.method === 'GET') {
    const ext      = path.extname(url);
    const mime     = MIME[ext] || 'application/octet-stream';
    const filepath = path.join(STATIC_DIR, path.basename(url));

    // only serve known extensions from the project root
    if (ext && MIME[ext] && fs.existsSync(filepath)) {
      sendFile(res, filepath, mime);
      return;
    }
  }

  // ── 404 ─────────────────────────────────────────────────────────────────────
  send(res, 404, 'text/plain', 'Not found');
}

// ─── Start ────────────────────────────────────────────────────────────────────
const server = http.createServer(router);

server.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Wembley Monitor — Express Server         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Events file:  ${EVENTS_FILE}`);
  console.log(`Exports dir:  ${EXPORTS_DIR}`);
  console.log('');
});

server.on('error', err => {
  console.error('[Server error]', err.message);
  process.exit(1);
});
