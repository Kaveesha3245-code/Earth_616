import { attachFilm } from './media.js';

const FILMS = {
  intro: { label: 'Follow the light.', kicker: 'A FAMILIAR PRESENCE.', mp4: '/media/stream/intro-landscape.mp4', poster: '/media/opening-person-landscape-seek-1080.jpg' },
  touch: { label: 'One touch opens the way.', kicker: 'REACH FOR WHAT LIES BEYOND.', mp4: '/media/stream/touch.mp4', poster: '/media/media2-1080.jpg' },
  warp: { label: 'Across the distance.', kicker: 'SOME CONNECTIONS CROSS UNIVERSES.', mp4: '/media/stream/crossing.mp4', poster: '/media/universal-travel.jpg' },
  platform: { label: 'You have arrived.', kicker: 'TAKE A BREATH. THIS MOMENT IS YOURS.', mp4: '/media/stream/arrival.mp4', poster: '/media/media4-1080.jpg' },
};
const ORDER = Object.keys(FILMS);
const abortError = () => new DOMException('Playback cancelled.', 'AbortError');

function bufferedAhead(video) {
  for (let index = 0; index < video.buffered.length; index++) {
    if (video.buffered.start(index) <= video.currentTime + 0.1 && video.buffered.end(index) > video.currentTime) {
      return video.buffered.end(index) - video.currentTime;
    }
  }
  return 0;
}

// Timers, media listeners and frame callbacks all belong to a cancellable attempt.
function waitForMedia(video, test, signal, timeout = 4500) {
  return new Promise((resolve, reject) => {
    let timer, poll;
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'progress', 'timeupdate'];
    const finish = error => {
      clearTimeout(timer); clearInterval(poll);
      events.forEach(event => video.removeEventListener(event, check));
      video.removeEventListener('error', fail); signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    const check = () => { if (test()) finish(); };
    const fail = () => finish(new Error('The film could not load.'));
    const cancel = () => finish(abortError());
    if (signal.aborted) { cancel(); return; }
    events.forEach(event => video.addEventListener(event, check));
    video.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('The film connection took too long.')), timeout);
    poll = setInterval(check, 150);
    if (video.error) fail(); else check();
  });
}

function boundedPlayback(video, signal, playPromise) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(abortError()); };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error('The film could not start.')); }, 4500);
    Promise.resolve(playPromise).then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
  });
}

function decodedFrame(video, signal) {
  return new Promise((resolve, reject) => {
    let frame, raf, timer;
    const finish = error => {
      clearTimeout(timer);
      if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
      if (raf !== undefined) cancelAnimationFrame(raf);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(abortError());
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('The film could not display a frame.')), 2500);
    if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(() => finish());
    else raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => finish(video.readyState >= 2 ? undefined : new Error('The film is not ready.'))); });
  });
}

export function installCinema({ toast, onOpen, onClose, onComplete, onScene, onPlayback, onToggleMute }) {
  const dialog = document.querySelector('#film-dialog');
  const players = [...dialog.querySelectorAll('.cinema-video')];
  const $ = selector => dialog.querySelector(selector);
  const slots = new Map(players.map(video => [video, {}]));
  let active = players[0], standby = players[1], current = 'intro', requested = 'intro';
  let session = new AbortController(), transition, warming, watchdog;
  let phase = 'idle', switching = false, displayed = false, recoveryAction;
  let lastTime = 0, lastProgress = 0;

  // Recovery is deliberately absent during ordinary playback and transitions.
  const recovery = document.createElement('div');
  recovery.id = 'film-recovery'; recovery.hidden = true; recovery.setAttribute('role', 'alert');
  recovery.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10;width:min(420px,calc(100% - 48px));padding:26px;border-radius:22px;background:#08110eef;border:1px solid #b5d9cc44;box-shadow:0 20px 80px #0008;text-align:center';
  const recoveryText = document.createElement('p');
  recoveryText.id = 'film-error'; recoveryText.style.cssText = 'font-size:14px;line-height:1.7;margin:0 0 20px';
  const retry = document.createElement('button');
  retry.id = 'film-retry'; retry.type = 'button'; retry.className = 'button button-light';
  const skip = document.createElement('button');
  skip.id = 'film-skip'; skip.type = 'button'; skip.className = 'button button-outline';
  skip.textContent = 'Skip this moment'; skip.style.cssText = 'margin:10px 0 0;display:block;width:100%;text-align:center';
  retry.style.cssText = 'display:block;width:100%;text-align:center';
  recovery.append(recoveryText, retry, skip); dialog.append(recovery);

  function setPhase(value) { phase = value; dialog.dataset.playerState = value; }
  function source(name) {
    const portrait = innerHeight > innerWidth;
    let film = FILMS[name];
    if (name === 'intro' && portrait) film = { ...film, mp4: '/media/stream/intro-portrait.mp4', poster: '/media/opening-person-portrait-seek-1080.jpg' };
    return { ...film, hls: name === 'intro' ? (portrait ? import.meta.env.VITE_INTRO_PORTRAIT_HLS_URL : import.meta.env.VITE_INTRO_HLS_URL) : undefined };
  }
  function sourceKey(film) { return `${film.mp4}|${film.hls || ''}`; }
  function cancelLoads() { for (const slot of slots.values()) slot.controller?.abort(); }
  function hideRecovery() { recovery.hidden = true; recoveryAction = undefined; $('#film-loading').hidden = true; }
  function updatePlayback() {
    $('#cinema-pause').textContent = active.paused ? 'Play film' : 'Pause film';
    $('#cinema-pause').setAttribute('aria-label', active.paused ? 'Play film' : 'Pause film');
    if (dialog.open && !switching) onPlayback?.(!active.paused && !active.ended && recovery.hidden);
  }
  function showRecovery(name, error, action) {
    if (!dialog.open || error.name === 'AbortError') return;
    switching = false; setPhase('error'); $('#film-loading').hidden = true;
    recoveryText.textContent = error.name === 'NotAllowedError' ? 'Tap play to continue your journey.' : 'This moment could not continue. Try it again, or follow the next light.';
    retry.textContent = error.name === 'NotAllowedError' ? 'Play film' : 'Retry moment';
    skip.textContent = name === ORDER.at(-1) ? 'Continue' : 'Skip this moment';
    recoveryAction = action; recovery.hidden = false; onPlayback?.(false);
  }

  async function prepare(name, video, parentSignal, seconds, force = false) {
    const slot = slots.get(video), film = source(name), identity = sourceKey(film);
    slot.controller?.abort();
    const controller = new AbortController(), signal = controller.signal;
    slot.controller = controller;
    const cancel = () => controller.abort();
    parentSignal.addEventListener('abort', cancel, { once: true });
    if (parentSignal.aborted) controller.abort();
    video.pause(); video.muted = true; video.preload = 'auto';
    try {
      if (slot.failure && slot.identity === identity && !force) throw slot.failure;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) throw abortError();
        try {
          if (force || attempt || slot.identity !== identity || video.error || !video.getAttribute('src')) {
            slot.identity = identity; slot.name = name; slot.failure = undefined;
            await attachFilm(video, film, toast, { signal });
          }
          if (video.currentTime > 0.05) video.currentTime = 0;
          await waitForMedia(video, () => {
            const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
            const needed = Math.max(0.05, Math.min(seconds, duration - video.currentTime - 0.08));
            return video.readyState >= 2 && (bufferedAhead(video) >= needed || video.readyState === 4);
          }, signal);
          return;
        } catch (error) {
          if (error.name === 'AbortError' || attempt === 1) throw error;
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError' && slot.controller === controller) slot.failure = error;
      throw error;
    } finally { parentSignal.removeEventListener('abort', cancel); }
  }

  function preloadNext() {
    const next = ORDER[ORDER.indexOf(current) + 1];
    if (!next || session.signal.aborted || navigator.connection?.saveData) return;
    void prepare(next, standby, session.signal, 2.5).catch(() => {});
  }
  function commit(name, incoming) {
    if (incoming !== active) {
      active.pause(); active.classList.remove('is-active'); standby = active; active = incoming;
    }
    active.classList.add('is-active'); standby.classList.remove('is-active');
    displayed = true; current = name; requested = name; switching = false;
    dialog.dataset.moment = name; delete dialog.dataset.pendingMoment;
    $('#film-label').textContent = FILMS[name].label; $('#film-kicker').textContent = FILMS[name].kicker;
    hideRecovery(); setPhase('playing'); lastTime = active.currentTime; lastProgress = performance.now();
    onScene?.(name); updatePlayback(); preloadNext();
  }
  async function startPrepared(name, incoming, controller, playPromise) {
    const signal = controller.signal;
    const cancelPlayback = () => incoming.pause();
    signal.addEventListener('abort', cancelPlayback, { once: true });
    try {
      if (signal.aborted) throw abortError();
      // Register before play: even a very short clip must supply a decoded frame.
      const frame = decodedFrame(incoming, signal); frame.catch(() => {});
      await boundedPlayback(incoming, signal, playPromise ?? incoming.play());
      await frame;
      if (!signal.aborted && dialog.open) commit(name, incoming);
    } catch (error) {
      if (signal.aborted || !dialog.open) return;
      incoming.pause();
      showRecovery(name, error, () => {
        if (error.name === 'NotAllowedError') {
          hideRecovery(); switching = true; setPhase('preparing');
          // Invoked directly from the recovery button's user gesture.
          void startPrepared(name, incoming, controller, incoming.play());
        } else void play(name, true);
      });
    } finally { signal.removeEventListener('abort', cancelPlayback); }
  }
  async function play(name, force = false) {
    transition?.abort();
    const controller = new AbortController(); transition = controller;
    const cancel = () => controller.abort();
    session.signal.addEventListener('abort', cancel, { once: true });
    requested = name; switching = true; hideRecovery(); setPhase('preparing'); dialog.dataset.pendingMoment = name;
    const identity = sourceKey(source(name));
    const incoming = players.find(video => slots.get(video).identity === identity && !video.error) || (displayed ? standby : active);
    if (!displayed) { active.poster = source(name).poster; dialog.dataset.moment = name; }
    try {
      await prepare(name, incoming, controller.signal, displayed ? 2.5 : 0.4, force);
      if (controller.signal.aborted || !dialog.open) return;
      // The cold opening has a free second decoder: prime the short next film
      // before awaiting play(). Later transitions preserve the outgoing frame.
      if (!displayed && incoming === active) { current = name; preloadNext(); }
      await startPrepared(name, incoming, controller);
    } catch (error) {
      if (!controller.signal.aborted) showRecovery(name, error, () => void play(name, true));
    } finally { session.signal.removeEventListener('abort', cancel); }
  }
  function next() {
    const index = ORDER.indexOf(requested);
    if (index === ORDER.length - 1) { dialog.close(); onComplete?.(); }
    else void play(ORDER[index + 1]);
  }
  async function togglePause() {
    if (!recovery.hidden) { recoveryAction?.(); return; }
    if (switching) return;
    if (active.error) { void play(current, true); return; }
    if (active.paused) {
      try { await boundedPlayback(active, session.signal, active.play()); setPhase('playing'); lastProgress = performance.now(); }
      catch (error) { showRecovery(current, error, () => void play(current, true)); }
    } else { active.pause(); setPhase('paused'); }
    updatePlayback();
  }
  function toggleMute() {
    const muted = onToggleMute?.();
    $('#cinema-sound').textContent = muted ? 'Enable cinematic audio' : 'Mute cinematic audio';
    $('#cinema-sound').setAttribute('aria-label', $('#cinema-sound').textContent);
  }
  function startWatchdog() {
    clearInterval(watchdog); lastProgress = performance.now(); lastTime = active.currentTime;
    watchdog = setInterval(() => {
      if (!dialog.open || switching || !recovery.hidden || document.hidden) { lastProgress = performance.now(); return; }
      if (active.ended) { next(); return; } // Also handles a missed ended event.
      if (active.paused) return;
      if (active.currentTime > lastTime + 0.04) { lastTime = active.currentTime; lastProgress = performance.now(); return; }
      if (performance.now() - lastProgress > 6500) {
        active.pause(); showRecovery(current, new Error('Playback stopped making progress.'), () => void play(current, true));
      }
    }, 500);
  }

  players.forEach(video => {
    video.addEventListener('timeupdate', () => {
      if (video !== active || switching) return;
      $('#film-arrival-title').classList.toggle('visible', current === 'warp' && active.currentTime > Math.max(0, active.duration - 1.65) || current === 'platform' && active.currentTime < 1.5);
    });
    for (const event of ['play', 'pause']) video.addEventListener(event, () => { if (video === active) updatePlayback(); });
    video.addEventListener('playing', () => { if (video === active && !switching && recovery.hidden) { setPhase('playing'); lastProgress = performance.now(); } });
    for (const event of ['waiting', 'stalled']) video.addEventListener(event, () => { if (video === active && dialog.open && !switching && recovery.hidden) setPhase('buffering'); });
    video.addEventListener('error', () => {
      if (video === active && dialog.open && !switching) showRecovery(current, new Error('Playback failed.'), () => void play(current, true));
    });
    video.addEventListener('ended', () => { if (video === active && !switching && dialog.open) next(); });
  });
  retry.addEventListener('click', () => recoveryAction?.()); skip.addEventListener('click', next);
  $('#film-next').addEventListener('click', next); $('#cinema-pause').addEventListener('click', () => void togglePause());
  $('#cinema-sound').addEventListener('click', toggleMute); $('#cinema-home').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.target.tagName === 'BUTTON' && event.code === 'Space') return;
    if (event.code === 'Space') { event.preventDefault(); void togglePause(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); toggleMute(); }
  });
  dialog.addEventListener('close', () => {
    session.abort(); transition?.abort(); cancelLoads(); clearInterval(watchdog);
    switching = false; players.forEach(video => video.pause()); hideRecovery(); setPhase('idle');
    $('#film-arrival-title').classList.remove('visible'); delete dialog.dataset.pendingMoment; onClose?.();
  });

  return {
    open(name = 'intro') {
      if (!FILMS[name]) return;
      session.abort(); transition?.abort(); warming?.abort(); cancelLoads();
      session = new AbortController(); players.forEach(video => video.pause());
      if (!dialog.open) dialog.showModal();
      onOpen?.(); startWatchdog(); void play(name);
    },
    warmup() {
      if (dialog.open || navigator.connection?.saveData) return;
      warming?.abort(); warming = new AbortController();
      return prepare('intro', active, warming.signal, 0.75).catch(() => {});
    },
    get state() { return phase; },
  };
}
