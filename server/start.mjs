import { createServer } from 'node:http';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createPortalHandler, streamFile } from './api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = joinPath(root, 'dist');
const api = createPortalHandler({ root });
await api.ready;
try { await stat(joinPath(dist, 'index.html')); }
catch { throw new Error('Build the site first with npm run build.'); }

function joinPath(...parts) { return resolve(...parts); }

async function serve(req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'Method not allowed.' })); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://portal.local').pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) throw new Error();
    let path = resolve(dist, `.${pathname}`);
    if (path !== dist && !path.startsWith(dist + sep)) throw new Error();
    if (pathname === '/' || !extname(pathname)) path = joinPath(dist, 'index.html');
    await streamFile(req, res, path);
  } catch (error) {
    if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
    res.writeHead(error.status || 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, message: 'File not found.' }));
  }
}

const server = createServer((req, res) => {
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  api(req, res, () => { void serve(req, res); });
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => {
  const address = server.address();
  console.log(`Earth 616 is available at http://${address.address}:${address.port}`);
});
