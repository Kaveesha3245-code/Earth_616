import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectionAudio } from '../src/section-audio.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(t, { preloaded = false } = {}) {
  class Audio extends EventTarget {
    dataset = {};
    attributes = new Map();
    paused = true;
    error = null;
    muted = false;
    playCalls = 0;
    pauseCalls = 0;
    sourceAssignments = 0;
    attempts = [];
    set src(value) { this.attributes.set('src', value); this.sourceAssignments++; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    load() {}
    remove() {}
    pause() { this.paused = true; this.pauseCalls++; }
    play() {
      this.playCalls++;
      const attempt = deferred();
      this.attempts.push(attempt);
      return attempt.promise;
    }
    start() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  }
  const previousDocument = globalThis.document;
  const elements = [];
  const opening = preloaded ? new Audio() : undefined;
  if (opening) { opening.src = '/journey.mp3'; elements.push(opening); }
  globalThis.document = {
    hidden: false,
    querySelector(selector) { return selector === 'audio[data-section-track="journey"]' ? opening : null; },
    createElement() { return new Audio(); },
    body: { append(audio) { elements.push(audio); } },
  };
  const controller = createSectionAudio({ tracks: {
    journey: '/journey.mp3', archive: '/archive.mp3', celebration: '/celebration.mp3',
  } });
  t.after(() => { controller.dispose(); globalThis.document = previousDocument; });
  return { controller, journey: elements[0], archive: elements[1], celebration: elements[2] };
}

test('the opening track buffers before interaction without downloading all section music', t => {
  const { journey, archive, celebration } = setup(t);
  assert.equal(journey.preload, 'auto');
  assert.equal(archive.preload, 'metadata');
  assert.equal(celebration.preload, 'metadata');
});

test('the controller reuses the HTML opening track without restarting its preload', t => {
  const { controller, journey } = setup(t, { preloaded: true });
  assert.equal(journey.sourceAssignments, 1, 'a matching src must not be assigned again');
  assert.equal(journey.preload, 'auto');
  const result = controller.unlock();
  assert.equal(journey.playCalls, 1);
  controller.dispose();
  return result.then(success => assert.equal(success, false));
});

test('a gesture retries play synchronously while the autoplay attempt is pending', async t => {
  const { controller, journey } = setup(t);
  controller.setSection('journey');
  assert.equal(journey.playCalls, 1);

  const unlocked = controller.unlock();
  assert.equal(journey.playCalls, 2, 'play() must run before the gesture handler returns');
  assert.equal(journey.pauseCalls, 0, 'retry preserves the buffered playback clock');

  journey.attempts[0].reject(Object.assign(new Error('Autoplay blocked'), { name: 'NotAllowedError' }));
  await Promise.resolve();
  assert.equal(controller.state, 'starting', 'stale autoplay failure cannot block the gesture attempt');

  journey.start();
  journey.attempts[1].resolve();
  assert.equal(await unlocked, true);
  assert.equal(controller.state, 'playing');
  assert.equal(await controller.unlock(), true);
  assert.equal(journey.playCalls, 2, 'later gestures do not restart playing music');
});

test('section changes preserve mute preferences and stop the previous track', async t => {
  const { controller, journey, archive } = setup(t);
  const unlocked = controller.unlock();
  journey.start();
  journey.attempts[0].resolve();
  assert.equal(await unlocked, true);
  controller.setMuted(true);
  assert.equal(journey.muted, true);

  controller.setSection('archive');
  assert.equal(journey.paused, true);
  assert.equal(archive.muted, false);
  archive.start();
  archive.attempts[0].resolve();
  await Promise.resolve();
  controller.setSection('journey');
  assert.equal(archive.paused, true);
  assert.equal(journey.muted, true);
  journey.start();
  journey.attempts[1].resolve();
  await Promise.resolve();
  assert.equal(controller.state, 'muted');
  controller.setActive(false);
  assert.equal(journey.paused, true);
  const calls = journey.playCalls;
  assert.equal(await controller.unlock(), false);
  assert.equal(journey.playCalls, calls, 'hidden pages cannot restart section music');
});
