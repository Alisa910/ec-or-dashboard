/**
 * server.js — 本地开发服务器
 * 同时服务 public/ 静态文件 和 /api/sales Snowflake API
 * 启动：node server.js
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

/* ── 加载 .env.local ── */
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [k, ...v] = line.trim().split('=');
      if (k && !k.startsWith('#')) process.env[k] = v.join('=');
    });
  console.log('  ✓ .env.local loaded');
} else {
  console.warn('  ⚠ .env.local not found — Snowflake API will fail');
}

const PORT = 3000;
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/* ── 懒加载 API handler ── */
let apiHandler = null;
function getApiHandler() {
  if (!apiHandler) {
    try {
      apiHandler = require('./api/sales.js');
    } catch (e) {
      console.error('  ✗ 加载 api/sales.js 失败:', e.message);
    }
  }
  return apiHandler;
}

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  /* ── /api/sales ── */
  if (pathname === '/api/sales') {
    const handler = getApiHandler();
    if (!handler) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API handler not loaded' }));
      return;
    }
    // Vercel-style res shim: res.status(code).json(data) / res.status(code).end()
    req.query = parsed.query;
    res.status = (code) => {
      res._statusCode = code;
      return {
        json: (data) => {
          if (!res.headersSent) {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          }
        },
        end: () => { if (!res.headersSent) { res.writeHead(code); res.end(); } },
      };
    };
    res.json = (data) => {
      if (!res.headersSent) {
        res.writeHead(res._statusCode || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      }
    };
    handler(req, res).catch(err => {
      console.error('[/api/sales] error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  /* ── 静态文件 ── */
  const filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });

}).listen(PORT, () => {
  console.log(`\n  Dashboard:  http://localhost:${PORT}`);
  console.log(`  API test:   http://localhost:${PORT}/api/sales?year=2026\n`);
});
