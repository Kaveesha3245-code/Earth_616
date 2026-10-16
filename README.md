# Earth 616 · Second edition

A separate cinematic birthday website for LordX. This folder is self-contained; the original `earth-616` project and supplied ZIP archives were left untouched.

The silk and flower resources are used as full-bleed moving environments. The opening and three journey films play across the entire viewport with continuous playback and preloading of the next film. Visible chapter labels, transport controls and segment rails were removed according to the annotated screenshots. Keyboard controls remain: Space pauses/plays, Right Arrow advances, M toggles audio, and Escape exits. Scroll chapters use full-height sticky film stages.

The complete site uses a dark palette with rounded buttons, inputs and picture frames. The heart sits just above the top tip of the Y in BIRTHDAY, leaving the flower arc visible. Its red center retains the 45° clockwise angle and now has thicker, flowing luminous-blue flame strands. The replacement `Untitled design (1).mp4` stays inside the rounded section-two video box; its optimized copy preserves all 85.9 seconds at 30 fps, without a competing embedded soundtrack.

## Section music

The entry screen fits the desktop or phone viewport and stays fixed until the server verifies a signed-in session. The scroll prompt and following page sections become available after login; locking the archive returns to the entry screen. The fullscreen opening and its sign-in step remain available while scrolling is locked.

The opening soundtrack buffers directly from the initial HTML and retries playback during the first click, tap or key press. Browsers may require that interaction before allowing audible playback. Other section tracks retain their independent mute settings.

The previous synthesized score and message-only music behavior have been removed. The supplied tracks now cover complete sections:

| Section | Track |
| --- | --- |
| Home, fullscreen opening and journey | The Avengers — the confirmed 1:15–2:09 excerpt (exactly 54 seconds), looping while the section remains active. |
| Entire personal archive, including its locked area, portraits and message | The First Time — supplied replacement recording. |
| Birthday celebration and closing footer | I Think They Call This Love — supplied recording. |

There are no music pause controls. The small round button mutes only the current section, remembers that section's preference and keeps its playback clock running. Other sections have independent mute preferences. Pausing a film or the inline video does not pause the section music. Leaving a section switches to the next track; hiding the browser suspends sound. Browser audio starts after the first interaction.

The heart now turns 45° clockwise, retaining a red center with luminous blue outer strings. The particle background shares one continuous scene across the journey and the complete personal archive. Only the visible background film decodes at a time, and decorative 3D work pauses behind fullscreen footage.

Playback uses optimized, fast-start copies under `public/media/stream`; the original files remain untouched. Crossing/arrival are about 80% smaller, silk 82% smaller and flowers 92% smaller. Source durations and frame rates are preserved. The opening warms up while the home page is idle; the next moment buffers before its decoded frame replaces the previous held frame. Closing/restarting cancels pending loads. A genuine load/play failure presents rounded Retry/Skip controls instead of an endless loading state. Actual network stalls can still occur; the player now bounds and recovers them.

## Run

Use Node.js 22.12 or newer. From this folder:

```powershell
npm install
npm run dev
```

Open [the local website](http://127.0.0.1:6162/). It requires the Node/Vite server; opening `index.html` directly does not run authentication.

The local gate retains the original project's case-sensitive password, `KaimeraX.com`. To change it, copy `.env.example` to `.env` and set `PORTAL_PASSWORD`. Set a separate `PORTAL_ADMIN_PASSWORD` before hosting. The provided start/dev/preview commands load `.env` privately.

```powershell
npm test
npm run build
npm start
```

`npm start` serves the production build and API at port 4173 by default. The `dist` folder alone does not include the server or private assets. Keep `server`, `private/seed-media`, and a persistent private data directory alongside it.

For the browser checks, with the dev server running:

```powershell
node scripts/section-media-qa.mjs
```

For authenticated entry, mobile scroll gestures and opening-audio checks, run `node scripts/entry-gate-qa.mjs`.

The browser script uses Microsoft Edge and saves screenshots in `test-results`.

## Personal archive

### Deploy on Vercel

Deploy this entire project folder (the folder containing `package.json`, `vercel.json`, `api`, `server` and `private`), with the **Vite** framework preset, build command `npm run build` and output directory `dist`. When importing the Git repository, select this folder as the Root Directory. Deploying only the `dist` folder omits the login API and causes `/api/auth` to return 404.

In Vercel **Settings → Environment Variables**, add `PORTAL_SESSION_SECRET` for Production and Preview. Use a random value of at least 32 characters; generate one locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Keep the same secret across function instances. `PORTAL_PASSWORD` is optional and overrides the existing case-sensitive archive password. Do not prefix either variable with `VITE_`. Leave `PORTAL_ORIGIN` unset unless you intentionally restrict login to one exact origin; leaving it unset supports both the production hostname and Vercel preview hostnames.

Commit/push the project changes and redeploy after saving the environment variables. Verify `/api/session` returns JSON with `authenticated: false`, sign in, and check that portraits, the birthday letter and the memory video load. `/api/health` also returns JSON when the function is configured correctly.

`vercel.json` routes `/api/*` and `/private-media/*` to `api/portal.js` and includes the private seed files in the function bundle. The function validates the signed session cookie before streaming private files; range requests support video seeking. The private files stay outside `dist` and `public`. This archive mode performs no filesystem writes and does not expose the unused upload/gallery backend; the full local server retains that backend. See [Vercel's Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js) and [streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

The server issues signed HttpOnly session cookies and protects the original portraits, slideshow, soundtrack and messages. The visitor gallery, upload controls, empty state and review interface were removed at the user's request. Their previous backend remains available in source; it is no longer part of the visitor experience. Earlier browser QA scripts describe the previous interface and are retained as history rather than current acceptance tests.

Runtime gallery files and the session signing key live in `.data`, excluded from source control and static delivery. Local uploads are labeled unscanned if ClamAV is unavailable. Production uploads fail closed unless the scanner succeeds. Production hosting needs persistent storage, HTTPS, unique credentials and a configured scanner. This edition includes a local filesystem backend; cloud storage, CDN and CMS account integrations are documented deployment work.

The archive's expandable message contains the personal birthday letter, with its stanza breaks and indentation preserved in a single readable column. Edit `private/seed-media/birthday-message.txt` to update it. This file is served only after sign-in.

## Optional adaptive streaming

MP4 playback works with the supplied assets. No HLS manifests are supplied or silently generated. If ffmpeg is installed, prepare three HLS renditions with:

```powershell
node scripts/prepare-hls.mjs --ffmpeg C:/tools/ffmpeg.exe
```

Set `VITE_INTRO_HLS_URL=/media/hls/intro/master.m3u8` before building. For portrait compositions, generate a separate output with `--input` and `--output` and set `VITE_INTRO_PORTRAIT_HLS_URL`. Safari uses native HLS. Other browsers require a tested `hls.mjs` module URL in `VITE_HLS_MODULE_URL`; MP4 remains the fallback. Deploy valid playlists and segments with correct MIME types and cache headers.

See [the implementation guide](docs/IMPLEMENTATION.md) for architecture, source mapping, component responsibilities, security limits, production pipeline, deployment checklist and acceptance criteria. Performance and accessibility targets are stated as targets, not measured certifications.
