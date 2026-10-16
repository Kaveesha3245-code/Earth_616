import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createVercelHandler } from '../server/vercel.mjs';

const PASSWORD = 'vercel-regression-gate';
const SECRET = 'vercel-regression-signing-key-at-least-32-characters';
const LETTER = 'Happy birthday, my love.\n\nI love you 3000.\n';
// Larger than the ordinary 4.5 MB response limit: the adapter must preserve
// streaming and byte ranges rather than buffering or truncating private media.
const FILM = Buffer.alloc(5 * 1024 * 1024, 0x61);
FILM.write('ftypisom', 4, 'ascii');
FILM.write('last-frame', FILM.length - 10, 'ascii');

async function portal(t, options = {}, { blockedData = false, consumedBody = false } = {}) {
  const temporaryRoot = resolve(tmpdir());
  const root = resolve(await mkdtemp(join(temporaryRoot, 'earth616-vercel-')));
  const servers = [];
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
    // Verify the exact mkdtemp target before recursive cleanup on Windows.
    assert.equal(dirname(root), temporaryRoot);
    assert.ok(basename(root).startsWith('earth616-vercel-'));
    await rm(root, { recursive: true, force: true });
  });
  const seedDir = join(root, 'private', 'seed-media');
  await mkdir(seedDir, { recursive: true });
  await writeFile(join(seedDir, 'birthday-message.txt'), LETTER);
  await writeFile(join(seedDir, 'message-current.mp4'), FILM);
  if (blockedData) await writeFile(join(root, '.data'), 'Do not read or modify local storage.');

  async function instance(extraOptions = {}) {
    const handler = createVercelHandler({ root, seedDir, password: PASSWORD, sessionSecret: SECRET, ...options, ...extraOptions });
    const server = createServer(async (req, res) => {
      if (consumedBody && req.method === 'POST') {
        // Vercel reads the stream before dispatch, then lazily parses req.body.
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        Object.defineProperty(req, 'body', { configurable: true, get: () => JSON.parse(raw) });
      }
      await handler(req, res);
    });
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = 'GET', cookie, json, bytes, headers = {}, chunked = false } = {}) {
      const payload = json !== undefined ? JSON.stringify(json) : bytes;
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(!['GET', 'HEAD'].includes(method) ? { Origin: origin } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: chunked ? new Blob([payload]).stream() : payload,
        ...(chunked ? { duplex: 'half' } : {}),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const text = buffer.toString('utf8');
      let data;
      try { data = JSON.parse(text); } catch {}
      return { status: response.status, headers: response.headers, buffer, text, data };
    }
    async function login(path = '/api/auth') {
      const response = await request(path, { method: 'POST', json: { password: PASSWORD } });
      assert.equal(response.status, 200, response.text);
      return response.headers.get('set-cookie').split(';')[0];
    }
    return { request, login };
  }
  const app = await instance();
  return { ...app, root, instance };
}

test('Vercel original and rewritten routes authenticate with secure cookies shared across instances', async t => {
  const app = await portal(t);
  assert.deepEqual((await app.request('/api/session')).data, { ok: true, authenticated: false, mode: 'production' });
  const wrong = await app.request('/api/auth', { method: 'POST', json: { password: 'incorrect' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal(wrong.text.includes(PASSWORD), false);
  assert.equal((await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD }, headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD }, headers: { Origin: '' } })).status, 403);
  assert.equal((await app.request('/api/auth', { method: 'POST', bytes: '{invalid', headers: { 'Content-Type': 'application/json' } })).status, 400);

  const login = await app.request('/api/portal?portalPath=%2Fapi%2Fauth', { method: 'POST', json: { password: PASSWORD } });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.data.authenticated, true);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Strict/);
  assert.match(setCookie, /; Secure/);
  const cookie = setCookie.split(';')[0];
  const other = await app.instance();
  assert.equal((await other.request('/api/portal?portalPath=%2Fapi%2Fsession', { cookie })).data.authenticated, true);
  const logout = await other.request('/api/portal?portalPath=%2Fapi%2Flogout', { method: 'POST', cookie, json: {} });
  assert.equal(logout.status, 200);
  assert.equal(logout.data.authenticated, false);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await readdir(app.root), ['private']);
});

test('Vercel preconsumed request bodies authenticate while retaining JSON and size validation', async t => {
  const app = await portal(t, {}, { consumedBody: true });
  const path = '/api/portal?portalPath=%2Fapi%2Fauth';
  const cookie = await app.login(path);
  assert.equal((await app.request('/api/session', { cookie })).data.authenticated, true);
  for (const bytes of ['{invalid', '[]', 'null']) {
    const result = await app.request(path, { method: 'POST', bytes, headers: { 'Content-Type': 'application/json' } });
    assert.equal(result.status, 400, `${bytes}: ${result.text}`);
    assert.match(result.headers.get('content-type'), /application\/json/);
    assert.equal(result.headers.get('set-cookie'), null);
  }
  // The parsed object is small, but the declared wire body exceeds the limit.
  const padded = ' '.repeat(16 * 1024) + JSON.stringify({ password: PASSWORD });
  const oversizedLength = await app.request(path, { method: 'POST', bytes: padded, headers: { 'Content-Type': 'application/json' } });
  assert.equal(oversizedLength.status, 413, oversizedLength.text);
  // Chunked transfer supplies no Content-Length, so validate the parsed object too.
  const oversizedObject = await app.request(path, { method: 'POST', json: { password: PASSWORD, padding: 'x'.repeat(16 * 1024) }, chunked: true });
  assert.equal(oversizedObject.status, 413, oversizedObject.text);
  assert.deepEqual(await readdir(app.root), ['private']);
});

test('Vercel private letter and large films remain authenticated with complete range and HEAD responses', async t => {
  const app = await portal(t);
  assert.equal((await app.request('/private-media/seed/birthday-message.txt')).status, 401);
  assert.equal((await app.request('/api/portal?portalPath=%2Fprivate-media%2Fseed%2Fmessage-current.mp4')).status, 401);
  const cookie = await app.login();
  const letter = await app.request('/api/portal?portalPath=%2Fprivate-media%2Fseed%2Fbirthday-message.txt', { cookie });
  assert.equal(letter.status, 200, letter.text);
  assert.equal(letter.text, LETTER);
  assert.match(letter.headers.get('cache-control'), /private, no-store/);

  const path = '/api/portal?portalPath=%2Fprivate-media%2Fseed%2Fmessage-current.mp4';
  const first = await app.request(path, { cookie, headers: { Range: 'bytes=0-31' } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-type'), 'video/mp4');
  assert.equal(first.headers.get('content-range'), `bytes 0-31/${FILM.length}`);
  assert.equal(first.headers.get('content-length'), '32');
  assert.deepEqual(first.buffer, FILM.subarray(0, 32));
  const last = await app.request(path, { cookie, headers: { Range: 'bytes=-10' } });
  assert.equal(last.status, 206);
  assert.equal(last.text, 'last-frame');
  assert.equal((await app.request(path, { cookie, headers: { Range: `bytes=${FILM.length}-` } })).status, 416);
  const head = await app.request(path, { method: 'HEAD', cookie });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(FILM.length));
  assert.equal(head.buffer.length, 0);
  const full = await app.request('/private-media/seed/message-current.mp4', { cookie });
  assert.equal(full.status, 200);
  assert.deepEqual(full.buffer, FILM);
  assert.deepEqual(await readdir(app.root), ['private']);
});

test('Vercel read-only mode never accesses disk storage or enables the removed gallery endpoints', async t => {
  // A file occupying .data makes legacy mkdir(.data/uploads) initialization fail.
  const app = await portal(t, {}, { blockedData: true });
  const cookie = await app.login();
  assert.equal((await app.request('/private-media/seed/birthday-message.txt', { cookie })).text, LETTER);
  for (const [path, method] of [
    ['/api/uploads', 'POST'],
    ['/api/uploads/unused-token', 'PUT'],
    ['/api/gallery', 'GET'],
    ['/api/gallery/unused-id', 'DELETE'],
    ['/api/moderation/auth', 'POST'],
    ['/api/moderation/unused-id', 'POST'],
    ['/private-media/uploads/unused.png', 'GET'],
  ]) {
    const response = await app.request(path, { method, cookie, ...(!['GET', 'HEAD'].includes(method) ? { json: {} } : {}) });
    assert.equal(response.status, 404, `${method} ${path}: ${response.text}`);
  }
  assert.equal(await readFile(join(app.root, '.data'), 'utf8'), 'Do not read or modify local storage.');
  assert.deepEqual((await readdir(app.root)).sort(), ['.data', 'private']);
});

test('Vercel missing or short signing keys fail with an actionable JSON 503 and no storage creation', async t => {
  const previousSecret = process.env.PORTAL_SESSION_SECRET;
  delete process.env.PORTAL_SESSION_SECRET;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.PORTAL_SESSION_SECRET;
    else process.env.PORTAL_SESSION_SECRET = previousSecret;
  });
  for (const sessionSecret of [undefined, '', 'too-short']) {
    const app = await portal(t, { sessionSecret });
    const response = await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD } });
    assert.equal(response.status, 503, response.text);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.data.ok, false);
    assert.match(response.data.message, /PORTAL_SESSION_SECRET/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await readdir(app.root), ['private']);
  }
  process.env.PORTAL_SESSION_SECRET = SECRET;
  const configured = await portal(t, { sessionSecret: undefined });
  const cookie = await configured.login();
  assert.equal((await configured.request('/api/session', { cookie })).data.authenticated, true);
  assert.deepEqual(await readdir(configured.root), ['private']);
});

test('Vercel route forwarding cannot expose project files or bypass private-file authentication', async t => {
  const app = await portal(t);
  const cookie = await app.login();
  for (const path of [
    '/server/api.mjs',
    '/private/seed-media/birthday-message.txt',
    '/api/portal?portalPath=%2Fserver%2Fapi.mjs',
    '/api/portal?portalPath=%2F.env',
    '/api/portal?portalPath=https%3A%2F%2Felsewhere.example%2Fapi%2Fsession',
    '/api/portal?portalPath=%2Fprivate-media%2Fseed%2F..%2F..%2Fserver%2Fapi.mjs',
  ]) assert.equal((await app.request(path, { cookie })).status, 404, path);
  const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;
  assert.equal((await app.request('/private-media/seed/birthday-message.txt', { cookie: tampered })).status, 401);
});
