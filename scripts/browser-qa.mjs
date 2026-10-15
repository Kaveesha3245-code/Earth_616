import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:6162';
const output = resolve(root, 'test-results');
const source = await readFile(resolve(root, 'server/api.mjs'), 'utf8');
const password = process.env.PORTAL_PASSWORD || source.match(/const DEFAULT_PASSWORD = ['"]([^'"]+)['"]/)[1];
const adminPassword = process.env.PORTAL_ADMIN_PASSWORD || password;
const report = { baseURL, checks: [], screenshots: [], pageErrors: [], failedRequests: [], failures: [] };
const errors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
await mkdir(output, { recursive: true });
function check(name, data) { report.checks.push({ name, ...data }); console.log(`PASS ${name}`); }
function observe(page, label) {
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  page.on('requestfailed', request => { const message = request.failure()?.errorText || ''; if (!message.includes('ERR_ABORTED')) report.failedRequests.push({ label, url: request.url(), message }); });
}
async function screenshot(page, name) { await page.screenshot({ path: resolve(output, name), animations: 'disabled' }); report.screenshots.push(name); }
async function overflow(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(result.document <= result.width + 1 && result.body <= result.width + 1, `${label} overflow ${JSON.stringify(result)}`); check(`${label} no horizontal overflow`, result);
}
async function authenticate(page) {
  await page.locator('[data-open-login]').first().click();
  await expect(page.locator('#login-dialog')).toBeVisible();
  await page.locator('#password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
  await expect(page.locator('#login-dialog')).not.toBeVisible();
  await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
}
async function visuals(viewport, label) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, label);
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await expect(page.locator('#hero-title')).toBeVisible();
    await overflow(page, label);
    await screenshot(page, `01-hero-${label}.png`);
    await page.locator('#play-intro').click();
    await expect(page.locator('#film-dialog')).toBeVisible();
    await page.waitForFunction(() => { const video = document.querySelector('.cinema-video.is-active'); return video?.readyState >= 2 && !video.paused; }, { timeout: 20000 });
    await page.locator('.cinema-video.is-active').evaluate(video => { video.pause(); video.currentTime = Math.min(2, video.duration / 2); });
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector('#film-dialog'); const video = document.querySelector('.cinema-video.is-active');
      const d = dialog.getBoundingClientRect(); const v = video.getBoundingClientRect();
      return { viewport: [innerWidth, innerHeight], dialog: [d.x, d.y, d.width, d.height], video: [v.x, v.y, v.width, v.height], fit: getComputedStyle(video).objectFit };
    });
    for (const rect of [metrics.dialog, metrics.video]) { assert.ok(Math.abs(rect[0]) <= 1 && Math.abs(rect[1]) <= 1); assert.ok(Math.abs(rect[2] - viewport.width) <= 1 && Math.abs(rect[3] - viewport.height) <= 1); }
    assert.equal(metrics.fit, 'cover'); check(`${label} cinematic video fills viewport`, metrics);
    await screenshot(page, `02-cinema-${label}.png`);
    await page.keyboard.press('Escape'); await expect(page.locator('#film-dialog')).not.toBeVisible();
    await page.locator('#journey').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#universe')?.width > 0);
    await page.locator('.chapter').first().evaluate(element => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: 'instant' }));
    await screenshot(page, `03-journey-${label}.png`);
    const chapter = await page.locator('.chapter').first().evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, viewport: [innerWidth, innerHeight] }));
    assert.ok(chapter.width >= viewport.width - 1 && chapter.height >= viewport.height - 1); check(`${label} chapter media stage fills viewport`, chapter);
    await page.locator('#celebration').scrollIntoViewIfNeeded();
    await expect(page.locator('#birthday-title')).toBeVisible();
    await page.waitForTimeout(350);
    await screenshot(page, `04-finale-${label}.png`);
    await page.locator('#make-wish').click(); await expect(page.locator('#wish-status')).toContainText('Loved beyond every universe');
    await overflow(page, `${label} finale`);
  } finally { await context.close(); }
}
async function cinemaContinuity() {
  const context = await browser.newContext({ viewport: { width:1440, height:960 }, reducedMotion:'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, 'cinema-continuity');
  try {
    await page.goto(baseURL, { waitUntil:'domcontentloaded' });
    await page.locator('#play-intro').click();
    const order = [['intro','opening-person-landscape'],['touch','media2-1080'],['warp','universal-travel'],['platform','media4-1080']];
    for (let index=0; index<order.length; index++) {
      const [moment, sourcePart] = order[index];
      await page.waitForFunction(({ moment, sourcePart }) => { const dialog = document.querySelector('#film-dialog'); const video = document.querySelector('.cinema-video.is-active'); return dialog.dataset.moment === moment && video.currentSrc.includes(sourcePart) && video.readyState >= 2 && !video.paused; }, { moment, sourcePart }, { timeout:25000 });
      await page.locator('.cinema-video.is-active').evaluate(async video => { video.currentTime = Math.max(0, video.duration-.12); await video.play(); });
      if (index < order.length-1) await expect(page.locator('#film-dialog')).toHaveAttribute('data-moment',order[index+1][0],{timeout:25000});
      check(`natural film ending advances ${moment}${index<order.length-1 ? ` to ${order[index+1][0]}` : ' to archive access'}`);
    }
    await expect(page.locator('#film-dialog')).not.toBeVisible({ timeout:25000 }); await expect(page.locator('#login-dialog')).toBeVisible();
    await page.locator('#password').fill(password); await page.locator('#login-form button[type=submit]').click(); await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await page.locator('#watch-message').click(); await expect(page.locator('#film-dialog')).toBeVisible(); await expect(page.locator('#film-dialog')).toHaveAttribute('data-moment','message');
    await page.waitForFunction(() => document.querySelector('.cinema-video.is-active').currentSrc.includes('media8-1080') && document.querySelector('.cinema-video.is-active').readyState>=2);
    await page.locator('.cinema-video.is-active').evaluate(video => video.pause());
    for (const [viewport,label] of [[{width:1440,height:960},'desktop'],[{width:390,height:844},'mobile']]) {
      await page.setViewportSize(viewport);
      const bounds = await page.locator('.cinema-video.is-active').boundingBox(); assert.ok(Math.abs(bounds.x)<=1 && Math.abs(bounds.y)<=1 && Math.abs(bounds.width-viewport.width)<=1 && Math.abs(bounds.height-viewport.height)<=1); check(`${label} private slideshow fills viewport`,bounds);
      await screenshot(page,`05-message-cinema-${label}.png`);
    }
    await page.keyboard.press('Escape');
    for (const [viewport,label] of [[{width:1440,height:960},'desktop'],[{width:390,height:844},'mobile']]) {
      await page.setViewportSize(viewport);
      await page.locator('.chapter').first().evaluate(element => window.scrollTo({top:scrollY+element.getBoundingClientRect().top,behavior:'instant'}));
      await page.waitForTimeout(300); await screenshot(page,`03-journey-${label}.png`);
    }
  } finally { await context.close(); }
}
function tinyPNG() {
  function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, bytes) { const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([length, name, bytes, crc]); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0,215,35,55,255]))), chunk('IEND', Buffer.alloc(0))]);
}
async function functional() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(12000); observe(page, 'functional');
  let uploadId;
  const origin = new URL(baseURL).origin;
  const headers = { Origin: origin };
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    assert.equal((await context.request.get(`${baseURL}/private-media/seed/portrait-12.webp`)).status(), 401); check('private archive denied before login');
    await page.locator('[data-open-login]').first().click();
    await expect(page.locator('#login-dialog')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#login-dialog')).not.toBeVisible(); check('native sign-in dialog Escape');
    await page.locator('[data-open-login]').first().click();
    await page.locator('#password').fill(`incorrect-${Date.now()}`);
    await page.locator('#login-form button[type=submit]').click();
    await expect(page.locator('#login-error')).not.toBeEmpty();
    await page.locator('#password').fill(password); await page.locator('#login-form button[type=submit]').click();
    await expect(page.locator('#login-dialog')).not.toBeVisible(); await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    const cookies = await context.cookies(); const sessionCookie = cookies.find(cookie => cookie.name === 'earth616_session'); assert.ok(sessionCookie?.httpOnly); assert.equal(sessionCookie.sameSite, 'Strict'); check('wrong password rejected and valid session issued');
    await page.locator('.source-copy summary').click(); await expect(page.locator('#source-copy')).toContainText('Hi babe, Happy birthday, my love.'); await expect(page.locator('#source-copy')).toContainText("I'm with you 'til the end of life");
    assert.deepEqual(await page.locator('#portrait-grid img').evaluateAll(images => images.map(image => image.getAttribute('src'))), [12,14,13].map(id => `/private-media/seed/portrait-${id}.webp`)); check('three portraits and personal birthday letter available');
    await page.locator('#portrait-grid button').first().click(); await expect(page.locator('#lightbox')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#lightbox')).not.toBeVisible(); check('memory viewer Escape');
    await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#portrait-grid figure')).toHaveCount(3); check('login persists after reload');
    const png = tinyPNG(); const caption = `QA temporary memory ${Date.now()}`;
    const noConsent = await context.request.post(`${baseURL}/api/uploads`, { headers, data: { filename: 'qa.png', mimeType: 'image/png', size: png.length, consent: false } });
    assert.ok(noConsent.status() >= 400); check('server rejects upload without consent');
    await page.locator('#share-memory').click(); await expect(page.locator('#upload-dialog')).toBeVisible();
    await page.locator('#memory-file').setInputFiles({ name: 'qa-1px.png', mimeType: 'image/png', buffer: png }); await page.locator('#memory-caption').fill(caption); await page.locator('#memory-name').fill('QA temporary');
    await page.locator('#upload-submit').click();
    assert.equal(await page.locator('#memory-consent').evaluate(input => input.validity.valueMissing), true); await expect(page.locator('#upload-dialog')).toBeVisible(); check('browser requires sharing consent');
    await page.locator('#memory-consent').check();
    const intentPromise = page.waitForRequest(request => request.url().endsWith('/api/uploads') && request.method() === 'POST');
    const uploadPromise = page.waitForResponse(response => /\/api\/uploads\//.test(response.url()) && response.request().method() === 'PUT');
    await page.locator('#upload-submit').click(); const intentRequest = await intentPromise; assert.equal(intentRequest.postDataJSON().mimeType, 'image/png'); assert.equal(intentRequest.postDataJSON().consent, true);
    const uploaded = await uploadPromise; assert.equal(uploaded.status(), 201); const payload = await uploaded.json(); uploadId = payload.item.id;
    assert.equal(payload.item.status, 'pending_review'); await expect(page.locator('#upload-dialog')).not.toBeVisible();
    const card = page.locator('.memory-card').filter({ hasText: caption }); await expect(card).toBeVisible(); await expect(card).toContainText('AWAITING REVIEW'); check('UI upload uses matching MIME and remains pending', { scanStatus: payload.item.scanStatus });
    const anonymous = await browser.newContext(); try { assert.equal((await anonymous.request.get(`${baseURL}${payload.item.url}`)).status(), 401); } finally { await anonymous.close(); } check('uploaded bytes require a session');
    const secondVisitor = await browser.newContext(); try {
      const auth = await secondVisitor.request.post(`${baseURL}/api/auth`, { headers, data: { password } }); assert.equal(auth.status(), 200);
      const otherGallery = await (await secondVisitor.request.get(`${baseURL}/api/gallery`)).json(); assert.ok(!otherGallery.items.some(item => item.id === uploadId));
      assert.equal((await secondVisitor.request.get(`${baseURL}${payload.item.url}`)).status(), 404);
    } finally { await secondVisitor.close(); } check('pending upload private to its owner');
    await page.locator('[data-filter=video]').click(); await expect(page.locator('.memory-card').filter({ hasText: caption })).toHaveCount(0);
    await page.locator('[data-filter=image]').click(); await expect(page.locator('.memory-card').filter({ hasText: caption })).toHaveCount(1); check('gallery photo and film filters');
    await page.locator('#moderation-toggle').click(); await expect(page.locator('#moderation-dialog')).toBeVisible(); await page.locator('#admin-password').fill(adminPassword);
    await page.locator('#moderation-form button[value=approve]').click(); await expect(page.locator('#moderation-dialog')).not.toBeVisible();
    const session = await (await context.request.get(`${baseURL}/api/session`)).json(); assert.equal(session.moderator, true); check('moderator unlock creates elevated server session');
    await card.getByRole('button', { name: /Review contribution/ }).click();
    await page.locator('#moderation-form button[value=approve]').click(); await expect(page.locator('#moderation-dialog')).not.toBeVisible(); await expect(card.locator('.review-badge')).toHaveCount(0); check('moderator approves the pending memory');
    await card.getByRole('button', { name: /Remove memory/ }).click(); await expect(card).toHaveCount(0); uploadId = undefined; check('owner deletion cleans test memory');
    await page.locator('[data-filter=all]').click(); await page.locator('#logout').click(); await expect(page.locator('#archive-locked')).toBeVisible(); assert.equal((await context.request.get(`${baseURL}/private-media/seed/portrait-12.webp`)).status(), 401); check('logout revokes private archive access');
    await overflow(page, 'functional desktop');
  } finally {
    if (uploadId) await context.request.delete(`${baseURL}/api/gallery/${uploadId}`, { headers, data: {} }).catch(() => {});
    await context.close();
  }
}
try {
  if (!process.argv.includes('--functional-only') && !process.argv.includes('--cinema-only')) {
    for (const [viewport, label] of [[{ width:1440,height:960 }, 'desktop'], [{ width:390,height:844 }, 'mobile'], [{ width:320,height:700 }, 'small-mobile']]) {
      try { await visuals(viewport, label); } catch (error) { report.failures.push({ stage: label, message: error.message }); errors.push(error); console.error(`FAIL ${label}: ${error.message}`); }
    }
  }
  if (!process.argv.includes('--visual-only') && !process.argv.includes('--cinema-only')) { try { await functional(); } catch (error) { report.failures.push({ stage: 'functional', message: error.message }); errors.push(error); console.error(`FAIL functional: ${error.message}`); } }
  if (process.argv.includes('--cinema-only')) { try { await cinemaContinuity(); } catch(error) { report.failures.push({stage:'cinema-continuity',message:error.message}); errors.push(error); console.error(`FAIL cinema-continuity: ${error.message}`); } }
  if (report.pageErrors.length) { errors.push(new Error(`${report.pageErrors.length} uncaught browser errors`)); }
  if (report.failedRequests.length) { errors.push(new Error(`${report.failedRequests.length} unexpected network failures`)); }
} finally {
  await browser.close();
  await writeFile(resolve(output, `browser-qa${process.argv.includes('--visual-only') ? '-visual' : process.argv.includes('--functional-only') ? '-functional' : process.argv.includes('--cinema-only') ? '-cinema' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(`Completed ${report.checks.length} checks; ${report.screenshots.length} screenshots; ${report.pageErrors.length} browser errors; ${report.failedRequests.length} request failures.`);
}
if (errors.length) process.exitCode = 1;
