import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE = 'earth616_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_FILE = 20 * 1024 * 1024;
const TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

STATIC_TYPES['.m3u8'] = 'application/vnd.apple.mpegurl';
STATIC_TYPES['.ts'] = 'video/mp2t';
STATIC_TYPES['.txt'] = 'text/plain; charset=utf-8';

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function equal(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

async function body(req, limit) {
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > limit) throw new ApiError(413, 'The request is too large.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Use application/json.');
  const limit = 16 * 1024;
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > limit) throw new ApiError(413, 'The request is too large.');
  try {
    // Vercel's Node helpers consume the stream and provide a lazy body getter.
    // Access it inside this try so malformed JSON still produces our JSON error.
    const parsedByRuntime = Object.hasOwn(req, 'body');
    const value = parsedByRuntime ? req.body : JSON.parse((await body(req, limit)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    if (parsedByRuntime && Buffer.byteLength(JSON.stringify(value)) > limit) throw new ApiError(413, 'The request is too large.');
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Send a valid JSON object.');
  }
}

function cleanText(value, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new ApiError(400, 'Some upload details are invalid.');
  return value.trim();
}

function filename(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || value.startsWith('.') || /[\\/\u0000-\u001F\u007F]/.test(value) || value.includes('..')) throw new ApiError(400, 'Choose a valid filename without folders.');
  return value;
}

function magicMatches(bytes, mime) {
  const ascii = (start, end) => bytes.toString('ascii', start, end);
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (bytes.length < 16 || ascii(4, 8) !== 'ftyp') return false;
  const brand = ascii(8, 12);
  if (mime === 'image/avif') return ['avif', 'avis'].includes(brand);
  if (mime === 'video/quicktime') return brand === 'qt  ';
  return mime === 'video/mp4' && ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'avc1', 'mp41', 'mp42', 'M4V ', 'MSNV', 'dash'].includes(brand);
}

function parseCommand(command) {
  const parts = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
  return parts.map(part => part.replace(/^(["'])(.*)\1$/, '$2'));
}

async function scanFile(path, options) {
  if (options.scan) return options.scan(path);
  const command = options.scanCommand || process.env.CLAMAV_SCAN_COMMAND;
  const [executable, ...fixed] = command ? parseCommand(command) : ['clamscan', '--no-summary'];
  if (!executable) throw new ApiError(503, 'Upload scanning is unavailable.');
  const hasPlaceholder = fixed.some(arg => arg.includes('{file}'));
  const args = fixed.map(arg => arg.replaceAll('{file}', path));
  if (!hasPlaceholder) args.push(path);
  try {
    await execFileAsync(executable, args, { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
    return 'clean';
  } catch (error) {
    if (error.code === 'ENOENT' && !options.production && !command) return 'unscanned';
    if (error.code === 1) throw new ApiError(422, 'The file did not pass the safety scan.');
    throw new ApiError(503, 'Upload scanning is unavailable. Try again later.');
  }
}

function safePath(base, relative) {
  if (!relative || relative.includes('\0') || relative.includes('\\') || relative.split('/').some(part => part === '..' || part.startsWith('.'))) throw new ApiError(404, 'File not found.');
  const path = resolve(base, relative);
  if (!path.startsWith(resolve(base) + sep)) throw new ApiError(404, 'File not found.');
  return path;
}

export async function streamFile(req, res, path, contentType, privateFile = false) {
  let info;
  try { info = await stat(path); } catch { throw new ApiError(404, 'File not found.'); }
  if (!info.isFile()) throw new ApiError(404, 'File not found.');
  res.setHeader('Content-Type', contentType || STATIC_TYPES[extname(path).toLowerCase()] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', privateFile ? 'private, no-store' : 'no-cache');
  res.setHeader('Accept-Ranges', 'bytes');
  let start = 0;
  let end = info.size - 1;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || (!range[1] && !range[2]) || !info.size) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      res.statusCode = 416; res.end(); return;
    }
    if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
    else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      res.setHeader('Content-Range', `bytes */${info.size}`);
      res.statusCode = 416; res.end(); return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  res.setHeader('Content-Length', Math.max(0, end - start + 1));
  if (req.method === 'HEAD' || !info.size) { res.end(); return; }
  await pipeline(createReadStream(path, { start, end }), res);
}

export function createPortalHandler(options = {}) {
  const root = options.root || ROOT;
  const dataDir = resolve(options.dataDir || process.env.PORTAL_DATA_DIR || join(root, '.data'));
  const seedDir = resolve(options.seedDir || join(root, 'private', 'seed-media'));
  const uploadsDir = join(dataDir, 'uploads');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const readOnly = options.readOnly === true;
  const password = options.password || process.env.PORTAL_PASSWORD || DEFAULT_PASSWORD;
  const adminPassword = options.adminPassword || process.env.PORTAL_ADMIN_PASSWORD || password;
  const expectedOrigin = options.origin || process.env.PORTAL_ORIGIN;
  const tokens = new Map();
  const attempts = new Map();
  let secret;
  let records = [];
  let serial = Promise.resolve();
  const ready = (async () => {
    secret = options.sessionSecret || process.env.PORTAL_SESSION_SECRET;
    if (secret && (typeof secret !== 'string' || secret.length < 32)) throw new ApiError(503, 'PORTAL_SESSION_SECRET must contain at least 32 characters.');
    if (readOnly) {
      if (!secret) throw new ApiError(503, 'Set PORTAL_SESSION_SECRET in Vercel environment variables, then redeploy.');
      return;
    }
    await mkdir(uploadsDir, { recursive: true });
    if (!secret) {
      try { secret = (await readFile(join(dataDir, 'session-key'), 'utf8')).trim(); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        secret = randomBytes(48).toString('hex');
        try { await writeFile(join(dataDir, 'session-key'), secret, { flag: 'wx', mode: 0o600 }); }
        catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; secret = (await readFile(join(dataDir, 'session-key'), 'utf8')).trim(); }
      }
    }
    try {
      const parsed = JSON.parse(await readFile(join(dataDir, 'gallery.json'), 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Gallery storage is invalid.');
      records = parsed;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  ready.catch(() => {});

  function commit(change) {
    const operation = serial.then(async () => {
      const next = structuredClone(records);
      const result = change(next);
      const temp = join(dataDir, `gallery-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(temp, join(dataDir, 'gallery.json'));
      } finally { await unlink(temp).catch(() => {}); }
      records = next;
      return result;
    });
    serial = operation.catch(() => {});
    return operation;
  }

  function sign(value) { return createHmac('sha256', secret).update(value).digest('base64url'); }
  function session(req) {
    const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!value || value.length > 1024) return null;
    const [payload, signature, extra] = value.split('.');
    if (extra || !payload || !signature || !equal(sign(payload), signature)) return null;
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return typeof parsed.ownerId === 'string' && /^[a-f0-9-]{36}$/.test(parsed.ownerId) && parsed.expires > Date.now() ? parsed : null;
    } catch { return null; }
  }
  function setCookie(req, res, ownerId, expire = false, admin = false) {
    const value = Buffer.from(JSON.stringify({ ownerId, admin: admin === true, expires: Date.now() + SESSION_SECONDS * 1000 })).toString('base64url');
    res.setHeader('Set-Cookie', `${COOKIE}=${expire ? '' : `${value}.${sign(value)}`}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expire ? 0 : SESSION_SECONDS}${production || req.socket.encrypted ? '; Secure' : ''}`);
  }
  function requireSession(req) {
    const auth = session(req);
    if (!auth) throw new ApiError(401, 'Please unlock the portal first.');
    return auth;
  }
  function origin(req) {
    try {
      const supplied = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(supplied.protocol) || supplied.origin !== req.headers.origin) throw new Error();
      if (expectedOrigin ? supplied.origin !== expectedOrigin : supplied.host.toLowerCase() !== String(req.headers.host).toLowerCase()) throw new Error();
    } catch { throw new ApiError(403, 'This request must come from this portal.'); }
  }
  function attemptKey(req, bucket) { return `${bucket}:${req.socket.remoteAddress || 'local'}`; }
  function limitLogin(req, bucket = 'login') {
    const key = attemptKey(req, bucket);
    const now = Date.now();
    for (const [address, entry] of attempts) if (now > entry.until) attempts.delete(address);
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
    entry.count += 1; attempts.set(key, entry);
    if (entry.count > 10) throw new ApiError(429, 'Too many attempts. Please try again in 15 minutes.');
  }
  function item(record, auth) {
    return { id: record.id, filename: record.filename, mimeType: record.mimeType, size: record.size, caption: record.caption, displayName: record.displayName, status: record.status, scanStatus: record.scanStatus, createdAt: record.createdAt, url: `/private-media/uploads/${record.storedName}`, owned: auth.ownerId === record.ownerId };
  }
  function requireModerator(req, input, auth) {
    if (auth.admin === true) return;
    const suppliedPassword = req.headers['x-admin-password'] || input.adminPassword;
    limitLogin(req, 'moderation');
    if (typeof suppliedPassword !== 'string' || !equal(suppliedPassword, adminPassword)) throw new ApiError(403, 'Moderator access denied.');
    attempts.delete(attemptKey(req, 'moderation'));
  }

  const handler = async (req, res, next = () => json(res, 404, { ok: false, message: 'Not found.' })) => {
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://portal.local').pathname); }
      catch { throw new ApiError(400, 'Invalid request path.'); }
      // Vite otherwise serves source files, including secrets and private assets.
      let normalized = pathname.replaceAll('\\', '/');
      for (let i = 0; i < 2; i += 1) { try { normalized = decodeURIComponent(normalized); } catch { break; } }
      if (normalized.split('/').some(part => ['private', '.data', '.git', '.codex', '.agents', '.aws', 'server', 'tests'].includes(part.toLowerCase()) || part.toLowerCase().startsWith('.env'))) throw new ApiError(404, 'Not found.');
      if (!pathname.startsWith('/api/') && !pathname.startsWith('/private-media/')) { next(); return; }
      await ready;
      const method = req.method;
      if (!['GET', 'HEAD'].includes(method)) origin(req);
      if (pathname === '/api/health' && method === 'GET') { json(res, 200, { ok: true, mode: production ? 'production' : 'local' }); return; }
      if (pathname === '/api/session' && method === 'GET') {
        const auth = session(req);
        json(res, 200, { ok: true, authenticated: Boolean(auth), ...(auth ? { ownerId: auth.ownerId, moderator: auth.admin === true } : {}), mode: production ? 'production' : 'local' }); return;
      }
      if (pathname === '/api/auth' && method === 'POST') {
        limitLogin(req);
        const input = await jsonBody(req);
        if (typeof input.password !== 'string' || input.password.length > 256) throw new ApiError(400, 'Enter a valid password.');
        if (!equal(input.password, password)) throw new ApiError(401, 'Access denied. Please try again.');
        attempts.delete(attemptKey(req, 'login'));
        setCookie(req, res, session(req)?.ownerId || randomUUID());
        json(res, 200, { ok: true, authenticated: true }); return;
      }
      if (pathname === '/api/logout' && method === 'POST') {
        setCookie(req, res, '', true); json(res, 200, { ok: true, authenticated: false }); return;
      }
      const auth = requireSession(req);
      if (pathname.startsWith('/private-media/') && ['GET', 'HEAD'].includes(method)) {
        if (pathname.startsWith('/private-media/seed/')) {
          await streamFile(req, res, safePath(seedDir, pathname.slice('/private-media/seed/'.length)), null, true); return;
        }
        const storedName = pathname.slice('/private-media/uploads/'.length);
        const record = pathname.startsWith('/private-media/uploads/') && records.find(entry => entry.storedName === storedName && (entry.status === 'approved' || entry.ownerId === auth.ownerId || auth.admin === true));
        if (!record) throw new ApiError(404, 'File not found.');
        await streamFile(req, res, safePath(uploadsDir, record.storedName), record.mimeType, true); return;
      }
      // The current visitor UI has no gallery or uploads. Serverless archive mode
      // must never rely on mutable files or instance-local upload tokens.
      if (readOnly) throw new ApiError(404, 'Endpoint not found.');
      if (pathname === '/api/uploads' && method === 'POST') {
        const input = await jsonBody(req);
        if (input.consent !== true) throw new ApiError(400, 'Confirm you have permission to share this memory.');
        if (!Object.hasOwn(TYPES, input.mimeType)) throw new ApiError(415, 'Choose a supported image or video.');
        if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_FILE) throw new ApiError(input.size > MAX_FILE ? 413 : 400, 'Choose a file up to 20 MB.');
        const details = { filename: filename(input.filename), mimeType: input.mimeType, size: input.size, caption: cleanText(input.caption, 500), displayName: cleanText(input.displayName, 80), ownerId: auth.ownerId };
        const now = Date.now();
        for (const [token, entry] of tokens) if (entry.expires < now) tokens.delete(token);
        if ([...tokens.values()].filter(entry => entry.ownerId === auth.ownerId).length >= 5 || tokens.size >= 500) throw new ApiError(429, 'Please finish or wait for your previous uploads.');
        const token = randomBytes(32).toString('hex');
        const expires = now + 5 * 60_000;
        tokens.set(token, { ...details, expires });
        json(res, 201, { ok: true, token, uploadUrl: `/api/uploads/${token}`, expiresAt: new Date(expires).toISOString() }); return;
      }
      if (pathname.startsWith('/api/uploads/') && method === 'PUT') {
        const token = pathname.slice('/api/uploads/'.length);
        const details = tokens.get(token);
        if (!details || details.expires < Date.now() || details.ownerId !== auth.ownerId) throw new ApiError(410, 'This upload link has expired. Please choose the file again.');
        tokens.delete(token);
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== details.mimeType) throw new ApiError(415, 'The file type does not match the upload.');
        const bytes = await body(req, MAX_FILE);
        if (bytes.length !== details.size || !magicMatches(bytes, details.mimeType)) throw new ApiError(415, 'The file content does not match its image or video type.');
        const id = randomUUID();
        const storedName = `${id}${TYPES[details.mimeType]}`;
        const path = join(uploadsDir, storedName);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        try {
          const scanStatus = await scanFile(path, { ...options, production });
          if (!['clean', 'unscanned'].includes(scanStatus) || production && scanStatus !== 'clean') throw new ApiError(503, 'A completed safety scan is required.');
          const record = { ...details, id, storedName, scanStatus, status: 'pending_review', createdAt: new Date().toISOString(), consent: true };
          delete record.expires;
          await commit(next => next.push(record));
          json(res, 201, { ok: true, item: item(record, auth) });
        } catch (error) { await unlink(path).catch(() => {}); throw error; }
        return;
      }
      if (pathname === '/api/gallery' && method === 'GET') {
        json(res, 200, { ok: true, items: records.filter(record => record.status === 'approved' || record.ownerId === auth.ownerId || auth.admin === true).map(record => item(record, auth)) }); return;
      }
      if (pathname.startsWith('/api/gallery/') && method === 'DELETE') {
        const id = pathname.slice('/api/gallery/'.length);
        const record = await commit(next => {
          const index = next.findIndex(entry => entry.id === id && entry.ownerId === auth.ownerId);
          if (index < 0) throw new ApiError(404, 'Memory not found.');
          return next.splice(index, 1)[0];
        });
        await unlink(join(uploadsDir, record.storedName)).catch(() => {});
        json(res, 200, { ok: true }); return;
      }
      if (pathname === '/api/moderation/auth' && method === 'POST') {
        const input = await jsonBody(req);
        requireModerator(req, input, auth);
        setCookie(req, res, auth.ownerId, false, true);
        json(res, 200, { ok: true, moderator: true }); return;
      }
      if (pathname.startsWith('/api/moderation/') && method === 'POST') {
        const input = await jsonBody(req);
        requireModerator(req, input, auth);
        if (!['approve', 'reject'].includes(input.action)) throw new ApiError(400, 'Choose approve or reject.');
        const id = pathname.slice('/api/moderation/'.length);
        const record = await commit(next => {
          const index = next.findIndex(entry => entry.id === id);
          if (index < 0) throw new ApiError(404, 'Memory not found.');
          if (input.action === 'reject') return next.splice(index, 1)[0];
          if (production && next[index].scanStatus !== 'clean') throw new ApiError(409, 'This file needs a completed safety scan before approval.');
          next[index].status = 'approved'; return next[index];
        });
        if (input.action === 'reject') await unlink(join(uploadsDir, record.storedName)).catch(() => {});
        json(res, 200, { ok: true, ...(input.action === 'approve' ? { item: item(record, auth) } : {}) }); return;
      }
      throw new ApiError(404, 'Endpoint not found.');
    } catch (error) {
      if (res.headersSent) { if (!res.destroyed) res.destroy(); return; }
      json(res, error.status || 500, { ok: false, message: error.status ? error.message : 'The portal could not complete this request.' });
    }
  };
  handler.ready = ready;
  return handler;
}

export function installApi(server, options) {
  const handler = createPortalHandler(options);
  server.middlewares.use(handler);
}

// The original portal's local password is copied at creation; deployments override it.
const DEFAULT_PASSWORD = 'KaimeraX.com';
