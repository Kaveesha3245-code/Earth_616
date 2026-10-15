import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPortalHandler } from '../server/api.mjs';

const PASSWORD = 'backend-test-gate';
const ADMIN = 'backend-test-moderator';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function portal(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'earth616-api-'));
  const seedDir = join(dir, 'seed');
  await mkdir(seedDir);
  await writeFile(join(seedDir, 'portrait.png'), PNG);
  const api = createPortalHandler({ dataDir: join(dir, 'data'), seedDir, password: PASSWORD, adminPassword: ADMIN, sessionSecret: 'test-only-secret-with-more-than-32-characters', scan: async () => 'unscanned', ...options });
  await api.ready;
  const server = createServer((req, res) => api(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  async function request(path, { method = 'GET', cookie, json, bytes, headers = {} } = {}) {
    const result = await fetch(origin + path, {
      method, headers: { ...(method !== 'GET' && method !== 'HEAD' ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : bytes,
    });
    const text = await result.text();
    let data;
    try { data = JSON.parse(text); } catch {}
    return { status: result.status, headers: result.headers, data, text };
  }
  async function login() {
    const result = await request('/api/auth', { method: 'POST', json: { password: PASSWORD } });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
  }
  async function upload(cookie, extra = {}) {
    const intent = await request('/api/uploads', { method: 'POST', cookie, json: { filename: 'memory.png', mimeType: 'image/png', size: PNG.length, consent: true, caption: 'A birthday memory', ...extra } });
    assert.equal(intent.status, 201);
    const result = await request(intent.data.uploadUrl, { method: 'PUT', cookie, bytes: PNG, headers: { 'Content-Type': 'image/png' } });
    return { intent, result };
  }
  return { dir, request, login, upload };
}

test('signed cookie authentication, cross-origin rejection and protected source/media', async t => {
  const app = await portal(t);
  assert.deepEqual((await app.request('/api/session')).data, { ok: true, authenticated: false, mode: 'local' });
  assert.equal((await app.request('/private-media/seed/portrait.png')).status, 401);
  const denied = await app.request('/api/auth', { method: 'POST', json: { password: 'incorrect' } });
  assert.equal(denied.status, 401);
  assert.equal(denied.text.includes(PASSWORD), false);
  assert.equal((await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD }, headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD }, headers: { Origin: '' } })).status, 403);
  const loggedIn = await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD } });
  const cookieHeader = loggedIn.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Strict/);
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await app.request('/api/session', { cookie })).data.authenticated, true);
  const [cookieName, signed] = cookie.split('=');
  const tampered = `${cookieName}=${signed.slice(0, -1)}${signed.endsWith('a') ? 'b' : 'a'}`;
  assert.equal((await app.request('/api/session', { cookie: tampered })).data.authenticated, false);
  for (const path of ['/private/seed-media/portrait.png', '/%70rivate/seed-media/portrait.png', '/@fs/C:/site/private/seed-media/portrait.png', '/server/api.mjs', '/.data/gallery.json', '/.env.local']) assert.equal((await app.request(path, { cookie })).status, 404, path);
  const range = await app.request('/private-media/seed/portrait.png', { cookie, headers: { Range: 'bytes=0-7' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-7/${PNG.length}`);
  assert.equal((await app.request('/private-media/seed/portrait.png', { cookie, headers: { Range: 'bytes=9999-' } })).status, 416);
  const logout = await app.request('/api/logout', { method: 'POST', cookie });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('single-use upload, private pending visibility, moderation, ownership and durable deletion', async t => {
  const app = await portal(t);
  const owner = await app.login();
  const visitor = await app.login();
  const { intent, result } = await app.upload(owner);
  assert.equal(result.status, 201);
  const memory = result.data.item;
  assert.equal(memory.status, 'pending_review'); assert.equal(memory.scanStatus, 'unscanned');
  assert.equal(memory.owned, true); assert.equal(memory.ownerId, undefined);
  assert.equal((await app.request(intent.data.uploadUrl, { method: 'PUT', cookie: owner, bytes: PNG, headers: { 'Content-Type': 'image/png' } })).status, 410);
  assert.equal((await app.request('/api/gallery', { cookie: owner })).data.items.length, 1);
  assert.equal((await app.request('/api/gallery', { cookie: visitor })).data.items.length, 0);
  assert.equal((await app.request(memory.url, { cookie: visitor })).status, 404);
  assert.equal((await app.request(memory.url, { cookie: owner })).status, 200);
  assert.equal((await app.request(`/api/gallery/${memory.id}`, { method: 'DELETE', cookie: visitor })).status, 404);
  assert.equal((await app.request(`/api/moderation/${memory.id}`, { method: 'POST', cookie: owner, json: { action: 'approve', adminPassword: 'incorrect' } })).status, 403);
  const approved = await app.request(`/api/moderation/${memory.id}`, { method: 'POST', cookie: owner, json: { action: 'approve', adminPassword: ADMIN } });
  assert.equal(approved.status, 200); assert.equal(approved.data.item.status, 'approved');
  assert.equal((await app.request('/api/gallery', { cookie: visitor })).data.items[0].owned, false);
  assert.equal((await app.request(memory.url, { cookie: visitor })).status, 200);
  const saved = JSON.parse(await readFile(join(app.dir, 'data', 'gallery.json'), 'utf8'));
  assert.equal(saved[0].status, 'approved'); assert.equal(saved[0].consent, true);
  assert.equal((await app.request(`/api/gallery/${memory.id}`, { method: 'DELETE', cookie: owner })).status, 200);
  assert.equal((await app.request(memory.url, { cookie: owner })).status, 404);
  assert.deepEqual(JSON.parse(await readFile(join(app.dir, 'data', 'gallery.json'), 'utf8')), []);
});

test('upload metadata, size, magic and token ownership are enforced', async t => {
  const app = await portal(t);
  const cookie = await app.login();
  const metadata = { filename: 'memory.png', mimeType: 'image/png', size: PNG.length, consent: true };
  for (const invalid of [{ consent: false }, { filename: '../escape.png' }, { filename: 'folder\\escape.png' }, { mimeType: 'image/svg+xml' }, { size: 0 }, { size: 20 * 1024 * 1024 + 1 }]) {
    const result = await app.request('/api/uploads', { method: 'POST', cookie, json: { ...metadata, ...invalid } });
    assert.ok([400, 413, 415].includes(result.status), JSON.stringify(invalid));
  }
  const intent = await app.request('/api/uploads', { method: 'POST', cookie, json: metadata });
  const visitor = await app.login();
  assert.equal((await app.request(intent.data.uploadUrl, { method: 'PUT', cookie: visitor, bytes: PNG, headers: { 'Content-Type': 'image/png' } })).status, 410);
  const invalidFile = Buffer.alloc(PNG.length, 65);
  assert.equal((await app.request(intent.data.uploadUrl, { method: 'PUT', cookie, bytes: invalidFile, headers: { 'Content-Type': 'image/png' } })).status, 415);
  assert.deepEqual((await app.request('/api/gallery', { cookie })).data.items, []);
});

test('moderator elevation reveals other owners pending files without granting owner deletion', async t => {
  const app = await portal(t);
  const owner = await app.login();
  const visitor = await app.login();
  const originalSession = (await app.request('/api/session', { cookie: visitor })).data;
  assert.equal(originalSession.moderator, false);
  const { result } = await app.upload(owner);
  const memory = result.data.item;
  assert.equal((await app.request('/api/gallery', { cookie: visitor })).data.items.length, 0);
  assert.equal((await app.request(memory.url, { cookie: visitor })).status, 404);
  const denied = await app.request('/api/moderation/auth', { method: 'POST', cookie: visitor, json: { adminPassword: 'incorrect' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('set-cookie'), null);
  const elevated = await app.request('/api/moderation/auth', { method: 'POST', cookie: visitor, json: { adminPassword: ADMIN } });
  assert.equal(elevated.status, 200); assert.equal(elevated.data.moderator, true);
  const moderator = elevated.headers.get('set-cookie').split(';')[0];
  const session = (await app.request('/api/session', { cookie: moderator })).data;
  assert.equal(session.moderator, true); assert.equal(session.ownerId, originalSession.ownerId);
  const queue = (await app.request('/api/gallery', { cookie: moderator })).data.items;
  assert.equal(queue.length, 1); assert.equal(queue[0].status, 'pending_review'); assert.equal(queue[0].owned, false);
  assert.equal((await app.request(memory.url, { cookie: moderator })).status, 200);
  assert.equal((await app.request(`/api/gallery/${memory.id}`, { method: 'DELETE', cookie: moderator })).status, 404);
  const approved = await app.request(`/api/moderation/${memory.id}`, { method: 'POST', cookie: moderator, json: { action: 'approve' } });
  assert.equal(approved.status, 200); assert.equal(approved.data.item.status, 'approved');
  const next = await app.upload(owner);
  assert.equal((await app.request(next.result.data.item.url, { cookie: visitor })).status, 404);
  const rejected = await app.request(`/api/moderation/${next.result.data.item.id}`, { method: 'POST', cookie: moderator, json: { action: 'reject' } });
  assert.equal(rejected.status, 200);
  assert.equal((await app.request(next.result.data.item.url, { cookie: owner })).status, 404);
});

test('production fails closed when a safety scan is incomplete and marks cookie secure', async t => {
  const app = await portal(t, { production: true, scan: async () => 'unscanned' });
  const login = await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD } });
  assert.match(login.headers.get('set-cookie'), /Secure/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { result } = await app.upload(cookie);
  assert.equal(result.status, 503);
  assert.deepEqual((await app.request('/api/gallery', { cookie })).data.items, []);
});

test('production accepts a clean scan, remains pending, and supports moderator rejection', async t => {
  const app = await portal(t, { production: true, scan: async () => 'clean' });
  const cookie = await app.login();
  const { result } = await app.upload(cookie);
  assert.equal(result.status, 201); assert.equal(result.data.item.status, 'pending_review');
  assert.equal(result.data.item.scanStatus, 'clean');
  const rejected = await app.request(`/api/moderation/${result.data.item.id}`, { method: 'POST', cookie, json: { action: 'reject' }, headers: { 'x-admin-password': ADMIN } });
  assert.equal(rejected.status, 200);
  assert.equal((await app.request('/api/gallery', { cookie })).data.items.length, 0);
});

test('an unavailable configured scanner rejects the file and leaves no gallery record', async t => {
  const app = await portal(t, { production: true, scan: null, scanCommand: 'earth616-test-scanner-that-does-not-exist' });
  const cookie = await app.login();
  const { result } = await app.upload(cookie);
  assert.equal(result.status, 503);
  assert.equal(result.text.includes('ENOENT'), false);
  assert.deepEqual((await app.request('/api/gallery', { cookie })).data.items, []);
});

test('failed password attempts are rate limited', async t => {
  const app = await portal(t);
  for (let i = 0; i < 10; i += 1) assert.equal((await app.request('/api/auth', { method: 'POST', json: { password: 'incorrect' } })).status, 401);
  const limited = await app.request('/api/auth', { method: 'POST', json: { password: PASSWORD } });
  assert.equal(limited.status, 429);
});
