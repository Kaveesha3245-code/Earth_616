# Verification · 2026-10-16

## Neon glass and repeatable wish ignition · 2026-10-16

`node scripts/glass-wish-qa.mjs` passed 17 checks with zero JavaScript errors, failed requests or failed stages. The desktop and phone runs verify the exact “Hi baby, Only for you lord” title, backdrop blur, pink-to-blue outline, all four rounded corners, native click/Space/Enter disclosure and no horizontal overflow. Repeated wishes increment and restart ignition both during and after a burst; the Make a wish button remains enabled with its original label. Normal motion, paused ambient motion, reduced motion and a WebGL-disabled fallback all pass, while retaining the correct single section soundtrack.

The report and 13 screenshots are in `test-results/glass-wish/`. Desktop and phone collapsed/expanded panels and heart ignition/fallback screenshots were visually reviewed. The production build passes. The heart uses two blue flame strands and preserves the red body, transparent background and placement near the Y in BIRTHDAY.

## Supplied section tracks and video · 2026-10-16

The current build replaces all synthesized/message-only music with the three supplied section tracks. FFprobe confirms the Avengers derivative is exactly 54.000 seconds, trimmed from the confirmed source interval 1:15–2:09. The replacement section-two video contains its complete 85.900 seconds at 30 fps, 720×1280, with no embedded audio stream. The production build passes.

Current browser acceptance is maintained in `scripts/section-media-qa.mjs`, with reports and screenshots in `test-results/section-media/`. It checks section-wide music through locked/unlocked archive and footer, independence from video pause, per-section mute preferences and moving playback clocks, no simultaneous tracks, no old media requests/synthesized AudioContext, replacement inline video and heart placement/flame appearance. Older QA reports below describe superseded interfaces and sound behavior.

The fresh `--followup` run passed 14 desktop/mobile checks with zero JavaScript errors or failures. It specifically verified loop-aware advancing music clocks while the inline and fullscreen videos are paused, the clickable mute button inside the fullscreen dialog, independent section mute state, and the button's return to the page. Its clean report is `section-media-followup.json`. The earlier base run's desktop clock assertion failed when the 54-second excerpt wrapped; the follow-up explicitly accounts for that loop. Refreshed screenshots at a visible video frame and the latest thicker/lower blue-fire heart were visually reviewed. The base run reported no unexpected network requests, no old-media requests and no synthetic AudioContext.

## Annotated screenshot revision

The current interface supersedes the original gallery and fullscreen-message checks listed below. `node scripts/revision-qa.mjs` passed 38 desktop/mobile checks with zero browser errors and zero request failures. It verifies the marked UI removals; dark archive/locked/message surfaces; rounded controls and pictures; the clean fullscreen opening sequence; the inline message video and automatic song on entry; offscreen pause and re-entry resume; global mute affecting the track and actual Web Audio master gain; and the miniature heart placement (230×250 desktop stage, 135×155 mobile stage). Eight reviewed screenshots and the report are under `test-results/revision/`.

The heart renderer subsequently switched to direct transparent rendering to remove the rectangular postprocessing background. The tunnel retains its existing bloom. Browser sound starts after the first interaction; a small global sound control can enable it if autoplay is blocked and mute it at any time.

## Earlier implementation checks (historical)

- Production build: passed (`npm run build`).
- Server integration: 8 tests passed, including signed authentication, protected files, upload limits/signatures, one-use intents, owner privacy, moderator sessions, durable records and production scanner failure handling.
- Browser functional flow: 17 checks passed in Microsoft Edge, including sign-in, source portrait order/text, persistence, consent, actual PNG upload, pending visibility, moderation, deletion and logout.
- Cinema flow: 6 checks passed. Natural video completion advances opening → touch → crossing → arrival; arrival completion opens the archive gate. Private message playback fills the viewport on desktop and mobile.
- Visual inspection: 1440×960 desktop and 390×844 mobile. Fullscreen video bounds and horizontal overflow checks passed. Screenshots were reviewed for the opening, full-bleed chapter, hero and 3D birthday heart.
- Browser runs reported zero uncaught JavaScript errors and zero unexpected network failures. Temporary gallery uploads were removed.

Reports and screenshots are in `test-results` (generated, excluded from source control). Run `node scripts/browser-qa.mjs --functional-only` or `--cinema-only` with the dev server running to repeat the respective checks.

The 320×700 visual attempt stalled and was interrupted; that width remains unverified. Lighthouse scores, full WCAG audits, real cloud/CDN/HLS services and external malware scanning were not measured or provisioned. The optional HLS generation script requires ffmpeg and was not run here. These are separate production deployment checks documented in IMPLEMENTATION.md.
