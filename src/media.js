// Public MP4 masters work immediately. An optional HLS rendition can be passed
// by a deployment; Safari uses native HLS, other browsers use the supplied module.
export async function attachFilm(video, { mp4, hls, poster }, reportError = () => {}, { signal } = {}) {
  if (signal?.aborted) throw new DOMException('Playback cancelled.', 'AbortError');
  const generation = (video._filmGeneration || 0) + 1;
  video._filmGeneration = generation;
  video._filmCleanup?.();
  video._hls?.destroy();
  video._hls = null;
  const current = () => video._filmGeneration === generation;
  const useMp4 = () => { if (current()) video.src = mp4; };
  if (poster) video.poster = poster;
  if (!hls) { useMp4(); return; }
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hls;
    const fallback = () => { if (current() && video.getAttribute('src') === hls) { useMp4(); reportError('Adaptive playback is unavailable. Playing the MP4 version.'); } };
    video.addEventListener('error', fallback, { once:true });
    video._filmCleanup = () => video.removeEventListener('error', fallback);
    return;
  }
  const moduleUrl = import.meta.env.VITE_HLS_MODULE_URL;
  if (!moduleUrl) { useMp4(); reportError('The adaptive player is not configured. Playing the MP4 version.'); return; }
  try {
    const { default: Hls } = await import(/* @vite-ignore */ moduleUrl);
    if (signal?.aborted || !current()) throw new DOMException('Playback cancelled.', 'AbortError');
    if (!Hls.isSupported()) { useMp4(); return; }
    const player = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20 });
    video._hls = player;
    player.loadSource(hls);
    player.attachMedia(video);
    player.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal && current()) { player.destroy(); video._hls = null; useMp4(); reportError('Adaptive playback is unavailable. Playing the MP4 version.'); }
    });
  } catch (error) { if (error.name === 'AbortError') throw error; useMp4(); if (current()) reportError('Adaptive playback is unavailable. Playing the MP4 version.'); }
}

export async function prepareUpload(file) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP photograph or an MP4 film.');
  if (file.size > 20 * 1024 * 1024) throw new Error('This file is larger than 20 MB. Please choose a smaller version.');
  if (!file.type.startsWith('image/')) return file;
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const ratio = Math.min(1, 2200 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, .88));
    if (!blob) throw new Error('This photograph could not be prepared. Try another file.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${mime === 'image/png' ? 'png' : 'jpg'}`, { type: mime });
  } finally { image.close(); }
}
