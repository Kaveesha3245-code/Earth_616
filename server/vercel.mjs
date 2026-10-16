import { createPortalHandler } from './api.mjs';

// Vercel serves dist/ itself; only login and protected archive files use this function.
export function createVercelHandler(options = {}) {
  const portal = createPortalHandler({ ...options, root: options.root || process.cwd(), production: true, readOnly: true });
  const handler = async (req, res) => {
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'private, no-store');
    let route;
    try { route = new URL(req.url, 'http://portal.local').searchParams.get('portalPath'); }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: 'Invalid request path.' })); return;
    }
    if (route !== null) {
      if (!route.startsWith('/api/') && !route.startsWith('/private-media/')) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: 'Endpoint not found.' })); return;
      }
      // Explicit forwarding also works when the platform exposes the rewritten URL.
      req.url = route;
    }
    await portal(req, res);
  };
  handler.ready = portal.ready;
  return handler;
}
