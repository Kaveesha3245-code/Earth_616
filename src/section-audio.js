const SECTIONS = ['journey', 'archive', 'celebration'];

/** Native section music: one active track, with an independent mute preference. */
export function createSectionAudio({ button, tracks = {}, onBlocked } = {}) {
  const elements = new Map(), preferences = new Map(), visited = new Set();
  const reported = new Map();
  let section = 'journey', active = !document.hidden, disposed = false;
  let state = 'idle', generation = 0, pending;

  function current() { return elements.get(section); }
  function paint() {
    if (!button) return;
    const muted = preferences.get(section);
    const label = `${muted ? 'Unmute' : 'Mute'} ${section} music`;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(muted));
    button.title = label;
    button.dataset.musicSection = section;
    button.dataset.musicState = state;
    button.classList.toggle('is-muted', muted);
    if (!button.textContent.trim()) button.textContent = '♫';
  }
  function block(error) {
    state = 'blocked'; paint();
    const reason = error?.name || error?.message || 'MediaError';
    if (reported.get(section) !== reason) {
      reported.set(section, reason);
      onBlocked?.({ section, error });
    }
  }
  function cancelPending() {
    generation++;
    pending?.finish(false);
    pending = undefined;
  }
  function pauseOthers() {
    for (const [name, audio] of elements) if (name !== section) audio.pause();
  }

  function playCurrent(retry = false) {
    if (disposed || !active) return Promise.resolve(false);
    const audio = current();
    pauseOthers();
    audio.muted = preferences.get(section);
    if (!audio.getAttribute('src')) {
      block(new Error('The section music is unavailable.'));
      return Promise.resolve(false);
    }
    if (pending?.audio === audio) {
      if (!retry) return pending.promise;
      // A pending autoplay attempt may not have had user activation. Issue a
      // fresh play() in this gesture instead of waiting for that attempt.
      cancelPending();
    }
    if (!audio.paused && !audio.error) {
      state = audio.muted ? 'muted' : 'playing'; paint();
      return Promise.resolve(true);
    }
    if (audio.error && !retry) {
      block(new Error('The section music could not load.'));
      return Promise.resolve(false);
    }
    if (audio.error) audio.load();
    state = 'starting'; paint();
    const token = ++generation;
    let resolve, timer, settled = false;
    const promise = new Promise(done => { resolve = done; });
    const operation = {
      audio, promise,
      finish(success, error) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (pending === operation) pending = undefined;
        if (token !== generation || disposed || audio !== current() || !active) {
          if (audio !== current() || !active || disposed) audio.pause();
          resolve(false); return;
        }
        if (success) {
          state = audio.muted ? 'muted' : 'playing'; reported.delete(section); paint();
        } else if (error) {
          audio.pause();
          if (error.name === 'AbortError') { state = 'idle'; paint(); }
          else block(error);
        }
        resolve(success);
      },
    };
    pending = operation;
    timer = setTimeout(() => operation.finish(false, new Error('The section music did not become ready.')), 8000);
    try {
      Promise.resolve(audio.play()).then(() => operation.finish(true), error => operation.finish(false, error));
    } catch (error) { operation.finish(false, error); }
    return promise;
  }

  for (const name of SECTIONS) {
    const existing = document.querySelector(`audio[data-section-track="${name}"]`);
    const audio = existing || document.createElement('audio');
    audio.dataset.sectionTrack = name;
    audio.hidden = true; audio.controls = false; audio.loop = true;
    // Buffer the opening track while the landing page loads. Later sections
    // only need their metadata until the visitor reaches them.
    audio.preload = name === 'journey' ? 'auto' : 'metadata'; audio.volume = 0.68;
    audio.setAttribute('aria-hidden', 'true');
    const url = typeof tracks[name] === 'string' ? tracks[name].trim() : '';
    if (url && audio.getAttribute('src') !== url) audio.src = url;
    preferences.set(name, false); elements.set(name, audio);
    audio.addEventListener('playing', () => {
      if (disposed || !active || audio !== current() || state === 'blocked') { audio.pause(); return; }
      pauseOthers();
      if (pending?.audio === audio) pending.finish(true);
      state = audio.muted ? 'muted' : 'playing'; paint();
    });
    audio.addEventListener('error', () => {
      if (disposed || audio !== current() || !active) return;
      const error = new Error('The section music could not load.');
      if (pending?.audio === audio) pending.finish(false, error);
      else { audio.pause(); block(error); }
    });
    if (!existing) document.body.append(audio);
  }

  function setMuted(value) {
    if (disposed) return;
    preferences.set(section, Boolean(value));
    current().muted = Boolean(value);
    if (!current().paused) state = value ? 'muted' : 'playing';
    paint();
    // Muting keeps the section's clock moving, including a muted autoplay start.
    if (active && current().paused) void playCurrent();
  }
  function toggleMute() { setMuted(!preferences.get(section)); return preferences.get(section); }
  function unlock() { return playCurrent(true); }
  function click() { toggleMute(); void unlock(); }
  button?.addEventListener('click', click);
  paint();

  return {
    setSection(name) {
      if (disposed || !elements.has(name)) return;
      if (name !== section) {
        cancelPending(); current().pause(); section = name; pauseOthers();
        state = active ? 'idle' : 'inactive';
      }
      if (!visited.has(name)) { visited.add(name); current().currentTime = 0; }
      current().muted = preferences.get(name); paint();
      if (active) void playCurrent();
    },
    unlock, setMuted, toggleMute,
    setActive(value) {
      if (disposed || active === Boolean(value)) return;
      active = Boolean(value); cancelPending();
      if (!active) { for (const audio of elements.values()) audio.pause(); state = 'inactive'; paint(); }
      else void playCurrent();
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelPending();
      for (const audio of elements.values()) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio.remove(); }
      button?.removeEventListener('click', click); state = 'closed'; paint();
    },
    get section() { return section; },
    get muted() { return preferences.get(section); },
    get state() { return state; },
  };
}
