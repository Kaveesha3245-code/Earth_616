import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:6162';
const output = resolve(root, 'test-results', 'entry-gate');
const desktopOnly = process.argv.includes('--desktop-only');
const source = await readFile(resolve(root, 'server/api.mjs'), 'utf8');
const password = process.env.PORTAL_PASSWORD || source.match(/const DEFAULT_PASSWORD = ['"]([^'"]+)['"]/)[1];
const report = { baseURL, checks: [], screenshots: [], pageErrors: [], requestFailures: [], failures: [] };
await mkdir(output, { recursive: true });
async function save() { await writeFile(resolve(output, desktopOnly ? 'entry-gate-desktop.json' : 'entry-gate-qa.json'), JSON.stringify(report, null, 2)); }
async function check(name, data = {}) { report.checks.push({ name, ...data }); await save(); console.log(`PASS ${name}`); }
async function screenshot(page, name) { await page.screenshot({ path: resolve(output, name), animations: 'disabled' }); report.screenshots.push(name); await save(); }

const browser = await chromium.launch({
  channel: 'msedge', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'],
});

async function observe(context, label) {
  await context.addInitScript(() => {
    window.__entryQa = { gestures: [], calls: [], playing: [] };
    const recordGesture = event => {
      if (event.isTrusted) window.__entryQa.gestures.push({ type: event.type, time: performance.now() });
    };
    for (const event of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown']) {
      document.addEventListener(event, recordGesture, { capture: true, passive: true });
    }
    // Observe native playback without changing either its result or autoplay policy.
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this.tagName === 'AUDIO') window.__entryQa.calls.push({ track: this.dataset.sectionTrack, time: performance.now() });
      return Reflect.apply(nativePlay, this, args);
    };
    document.addEventListener('playing', event => {
      if (event.target.tagName === 'AUDIO') window.__entryQa.playing.push({ track: event.target.dataset.sectionTrack, time: performance.now() });
    }, true);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  page.on('requestfailed', request => {
    const message = request.failure()?.errorText || '';
    if (!message.includes('ERR_ABORTED')) report.requestFailures.push({ label, url: request.url(), message });
  });
  return page;
}

async function locked(page, label) {
  await expect(page.locator('#home .hero-bottom a[href="#journey"]')).toBeHidden();
  const state = await page.evaluate(() => {
    const hero = document.querySelector('#home').getBoundingClientRect();
    const button = document.querySelector('#play-intro').getBoundingClientRect();
    return {
      y: scrollY, x: scrollX,
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      hero: { top: hero.top, height: hero.height, bottom: hero.bottom },
      entryButton: { top: button.top, bottom: button.bottom },
    };
  });
  assert.equal(state.y, 0, `${label}: document moved: ${JSON.stringify(state)}`);
  assert.equal(state.x, 0, `${label}: horizontal scrolling exposed`);
  assert.ok(state.documentWidth >= state.viewport.width - 1, `${label}: vertical scrollbar still takes up viewport width`);
  assert.ok(state.contentWidth <= state.viewport.width + 1, `${label}: horizontal overflow`);
  assert.ok(state.hero.top >= -1 && state.hero.bottom <= state.viewport.height + 1, `${label}: landing page exceeds viewport: ${JSON.stringify(state)}`);
  assert.ok(state.entryButton.top >= 0 && state.entryButton.bottom <= state.viewport.height, `${label}: entry button clipped`);
  return state;
}

async function swipe(page, context) {
  const viewport = page.viewportSize();
  const client = await context.newCDPSession(page);
  const x = Math.round(viewport.width * .45), from = Math.round(viewport.height * .77), to = Math.round(viewport.height * .27);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from, id: 1 }] });
  for (let step = 1; step <= 8; step++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 8, id: 1 }] });
    await page.waitForTimeout(20);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(300);
}

async function openLogin(page) {
  await page.locator('#play-intro').click();
  await expect(page.locator('#film-dialog')).toBeVisible();
  await page.locator('#cinema-home').focus();
  // ArrowRight is the film player's real keyboard skip action; complete the
  // four moments without spending their full running times in this gate test.
  for (let moment = 0; moment < 4; moment++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#film-dialog')).not.toBeVisible();
  await expect(page.locator('#login-dialog')).toBeVisible();
}

async function submitPassword(page, value) {
  await page.locator('#password').fill(value);
  await page.locator('#login-form button[type="submit"]').click();
}

async function run(viewport, label, mobile = false) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await observe(context, label);
  try {
    let releaseSession;
    const sessionWait = new Promise(resolve => { releaseSession = resolve; });
    await page.route('**/api/session', async route => { await sessionWait; await route.continue(); });
    const sessionResponse = page.waitForResponse(response => response.url().endsWith('/api/session') && response.status() === 200);
    sessionResponse.catch(() => {}); // Context closure can cancel a deliberately held request.
    await page.goto(`${baseURL}/#archive`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('#hero-title')).toBeVisible();
    await check(`${label} initial deep link stays at the landing page while session verification is pending`, await locked(page, label));
    releaseSession();
    await sessionResponse;
    await page.unroute('**/api/session');
    await check(`${label} unverified landing page hides the scroll prompt and scrollbar`, await locked(page, label));

    await page.waitForFunction(() => document.querySelector('audio[data-section-track="journey"]')?.readyState >= 2, null, { timeout: 20000 });
    const cold = await page.locator('audio[data-section-track="journey"]').evaluate(audio => ({ paused: audio.paused, readyState: audio.readyState, buffered: audio.buffered.length }));
    if (mobile) await page.locator('#hero-title').tap(); else await page.locator('#hero-title').click();
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio[data-section-track="journey"]');
      return audio && !audio.paused && audio.currentTime > .05;
    }, null, { timeout: 1800 });
    const timing = await page.evaluate(() => {
      const gesture = window.__entryQa.gestures[0];
      const call = window.__entryQa.calls.find(item => item.track === 'journey' && item.time >= gesture.time);
      const playing = window.__entryQa.playing.find(item => item.track === 'journey' && item.time >= gesture.time);
      const autoplay = window.__entryQa.playing.find(item => item.track === 'journey' && item.time < gesture.time);
      return { gesture, callDelayMs: call?.time - gesture.time, playbackDelayMs: playing?.time - gesture.time, autoplayBeforeGesture: Boolean(autoplay), autoplayStartMs: autoplay?.time };
    });
    if (cold.paused) {
      assert.ok(timing.callDelayMs >= 0 && timing.callDelayMs < 150, `${label}: play was not requested promptly: ${JSON.stringify({ cold, ...timing })}`);
      assert.ok(timing.playbackDelayMs >= 0 && timing.playbackDelayMs < 1200, `${label}: playback delayed: ${JSON.stringify({ cold, ...timing })}`);
    } else assert.equal(timing.autoplayBeforeGesture, true, `${label}: native playback was not observed before the gesture`);
    await check(`${label} preloads landing music and plays by the first ${mobile ? 'touch' : 'pointer'} gesture`, { beforeGesture: cold, ...timing });

    await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
    await page.mouse.wheel(0, 1600); await page.waitForTimeout(180);
    await locked(page, `${label} wheel`);
    await page.locator('#hero-title').click({ position: { x: 5, y: 5 } });
    for (const key of ['PageDown', 'Space', 'End', 'ArrowDown']) {
      await page.keyboard.press(key); await page.waitForTimeout(80); await locked(page, `${label} ${key}`);
    }
    if (mobile) { await swipe(page, context); await locked(page, `${label} touch swipe`); }
    await page.evaluate(() => { location.hash = '#celebration'; });
    await page.waitForTimeout(150); await locked(page, `${label} fragment navigation`);
    await page.locator('#archive').evaluate(element => element.scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(100); await locked(page, `${label} programmatic deep link`);
    await check(`${label} blocks wheel, keyboard, fragments${mobile ? ', touch swipe' : ''} and hidden-section scrolling before login`);
    await screenshot(page, `01-locked-${label}.png`);

    await openLogin(page);
    await submitPassword(page, 'incorrect-entry-gate-password');
    await expect(page.locator('#login-error')).not.toHaveText('');
    await expect(page.locator('#login-form button[type="submit"]')).toBeEnabled();
    await locked(page, `${label} rejected password`);
    await screenshot(page, `02-login-${label}.png`);
    await check(`${label} cinematic journey reaches login and a rejected password keeps scrolling locked`);

    await submitPassword(page, password);
    await expect(page.locator('#login-dialog')).not.toBeVisible();
    await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await expect(page.locator('#home .hero-bottom a[href="#journey"]')).toBeVisible();
    await page.locator('#home').evaluate(element => element.scrollIntoView({ behavior: 'instant' }));
    await page.waitForFunction(() => document.documentElement.scrollHeight > innerHeight);
    if (mobile) await swipe(page, context);
    else {
      await page.mouse.move(Math.round(viewport.width * .75), Math.round(viewport.height * .7));
      await page.mouse.wheel(0, 800);
    }
    await expect.poll(() => page.evaluate(() => scrollY), { timeout: 2500, message: `${label}: scrolling did not unlock after real server authentication` }).toBeGreaterThan(100);
    await check(`${label} successful server login reveals the scroll cue and enables ${mobile ? 'touch' : 'wheel'} scrolling`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await expect(page.locator('#home .hero-bottom a[href="#journey"]')).toBeVisible();
    await page.locator('#archive').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => scrollY > 100), `${label}: verified cookie session did not unlock after reload`);
    await check(`${label} reload verifies the server session and restores scrolling`);

    await page.locator('#logout').click();
    await expect(page.locator('#logout')).toBeHidden();
    await page.waitForTimeout(100);
    await check(`${label} logout from the footer returns to the landing page and locks scrolling again`, await locked(page, label));
    if (mobile) await swipe(page, context); else await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(150); await locked(page, `${label} after logout scroll attempt`);
  } catch (error) {
    await screenshot(page, `failure-${label}.png`).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function keyboardAndUnavailableSession() {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 }, reducedMotion: 'reduce' });
  const page = await observe(context, 'keyboard-and-service-failure');
  try {
    await page.route('**/api/session', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable for regression verification"}' }));
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('audio[data-section-track="journey"]')?.readyState >= 2);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => !document.querySelector('audio[data-section-track="journey"]').paused, null, { timeout: 1800 });
    await locked(page, 'unavailable session');
    await check('keyboard gesture starts the ready soundtrack and a failed session verification keeps the page locked');
  } finally { await context.close(); }
}

async function fitOnly(viewport, label) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await observe(context, label);
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero-title')).toBeVisible();
    const state = await locked(page, label);
    if (viewport.height > viewport.width) {
      const geometry = await page.evaluate(() => ({
        captionBottom: document.querySelector('.hero-caption').getBoundingClientRect().bottom,
        entryTop: document.querySelector('#play-intro').getBoundingClientRect().top,
        bottomTop: document.querySelector('.hero-bottom').getBoundingClientRect().top,
        entryBottom: document.querySelector('#play-intro').getBoundingClientRect().bottom,
      }));
      assert.ok(geometry.captionBottom <= geometry.entryTop + 1, `${label}: title/caption overlaps entry button: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.entryBottom <= geometry.bottomTop + 1, `${label}: entry button overlaps bottom controls: ${JSON.stringify(geometry)}`);
    }
    await screenshot(page, `03-locked-${label}.png`);
    await check(`${label} keeps the locked landing page and entry control inside the viewport`, state);
  } finally { await context.close(); }
}

async function staleSessionResponse() {
  const label = 'stale-session';
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const page = await observe(context, label);
  let releaseSession;
  const release = new Promise(resolve => { releaseSession = resolve; });
  let capturedSession;
  const captured = new Promise(resolve => { capturedSession = resolve; });
  await page.route('**/api/session', async route => {
    const response = await route.fetch();
    capturedSession(await response.json());
    await release;
    await route.fulfill({ response });
  });
  const delivered = page.waitForResponse(response => response.url().endsWith('/api/session'));
  delivered.catch(() => {});
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    assert.equal((await captured).authenticated, false);
    await openLogin(page);
    await submitPassword(page, password);
    await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await expect(page.locator('#home .hero-bottom a[href="#journey"]')).toBeVisible();
    releaseSession();
    await delivered;
    await page.waitForTimeout(150);
    await expect(page.locator('#home .hero-bottom a[href="#journey"]')).toBeVisible();
    await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await page.locator('#celebration').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => scrollY > 100));
    await check('an older unverified session response cannot relock the page after successful interactive login');
  } finally { releaseSession(); await context.close(); }
}

try {
  for (const [viewport, label, mobile] of [
    [{ width: 1440, height: 960 }, 'desktop', false],
    [{ width: 390, height: 844 }, 'mobile', true],
    [{ width: 375, height: 667 }, 'small-mobile', true],
  ]) {
    if (desktopOnly && label !== 'desktop') continue;
    try { await run(viewport, label, mobile); }
    catch (error) { report.failures.push({ label, message: error.message }); await save(); console.error(`FAIL ${label}: ${error.message}`); }
  }
  if (!desktopOnly) {
  try { await keyboardAndUnavailableSession(); }
  catch (error) { report.failures.push({ label: 'keyboard-and-service-failure', message: error.message }); console.error(`FAIL keyboard-and-service-failure: ${error.message}`); }
  for (const [viewport, label] of [[{ width: 320, height: 480 }, 'compact-mobile'], [{ width: 844, height: 390 }, 'landscape-mobile']]) {
    try { await fitOnly(viewport, label); }
    catch (error) { report.failures.push({ label, message: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
  }
  try { await staleSessionResponse(); }
  catch (error) { report.failures.push({ label: 'stale-session', message: error.message }); console.error(`FAIL stale-session: ${error.message}`); }
  }
} finally { await browser.close(); await save(); }
console.log(`Completed ${report.checks.length} checks, ${report.screenshots.length} screenshots; ${report.pageErrors.length} JS errors; ${report.requestFailures.length} request failures; ${report.failures.length} failed stages.`);
if (report.failures.length || report.pageErrors.length || report.requestFailures.length) process.exitCode = 1;
