# Release validation

Local release checks were performed on Windows x64 with Python 3.10, FFmpeg, Playwright Chromium, and the production Waitress entry point.

## Checks

- Python unit, security, browser, audio, and real video-export tests, including font data and vendored library integrity.
- Fourteen JavaScript regression suites covering state, lyrics, playback, downloads, drafts, and visual effects.
- Actual Waitress HTTP responses and security headers.
- Chromium layouts at 320, 375, 768, 1024, and 1440 pixels in both color schemes, with no horizontal page overflow, uncaught page exceptions, or CSP violations.
- Cold refresh with cache disabled, 150 ms latency, and constrained throughput; stable header geometry.
- Canvas preview/export comparisons, including portrait video, layered effects, lyric transitions, and cancellation.
- Dependency vulnerability audit and Gitleaks scan of the staged public source.
- Git exclusions for local configuration, downloaded media, outputs, virtual environments, model caches, and test artifacts.

The CI workflow repeats Python/JavaScript tests and dependency auditing on Ubuntu with Python 3.12. Its results are shown under the repository's Actions tab.

## Limits

This is a local single-user release, not a public multi-user hosting release. Jobs are process-local and are interrupted by restarts. Public source availability does not mean the HTTP server should be publicly exposed.

A physical phone, Safari/iOS, a real remote SSH session, and live third-party API credentials were not available for this validation. Responsive emulation is not a substitute for those device and network checks. Optional WhisperX model integration and full transcription model downloads were not exercised. No claim is made that a vulnerability scan proves the absence of all security issues.

The original development environment contains an unrelated MoviePy installation whose Pillow constraint conflicts with the patched application dependency. Use a fresh virtual environment and `requirements.txt` for a clean installation.

A separate clean virtual environment was installed successfully from `requirements.txt`; its `pip check` reports no broken requirements.

## 2026-10-12 bug audit

The next [30-feature TODO](FEATURE_TODO_NEXT.md) was prepared before the audit.
Its items remain unimplemented; bug fixes do not count as new roadmap features.

Six issues were reproduced and corrected:

- Browser validation cloned numeric fields through JSON before checking them.
  `NaN` and infinity therefore became valid `null` values for source ends and
  frozen-frame positions. Validation now precedes cloning; rejected edits keep
  both project state and undo history intact.
- Explicit invalid sections and collections could silently become defaults in
  the browser while the server rejected them. Both now reject malformed values;
  genuinely omitted fields still receive defaults for older projects.
- Cyberpunk and Lo-Fi lyric presets could retain the previous preset's beat
  effects. Each preset now supplies its intended effect list.
- The lyric box selector mislabeled `none` and omitted `box`. Disabled, square
  and rounded backgrounds are now selectable and survive project reopening.
- A delayed lyric file read could overwrite intervening edits using an obsolete
  project-time conversion. Imports now verify source identity, timing context
  and lyric content; only the latest file selection may complete.
- Failure to create the media import's temporary directory leaked the operation
  slot, preventing subsequent uploads until restart. Setup now shares the same
  cleanup path as upload failures, and immediate retries remain possible.

Regression checks include 118 passing JavaScript tests, browser tests for preset
switching and all box modes, delayed/overlapping lyric imports, mirrored Python
contract checks, and failed media setup followed by retries. Waitress checks
passed with CSP, cache disabled, 150 ms network latency, constrained throughput,
five viewport widths in both color schemes, native touch dragging, snapshot and
undo verification, and playback. No separate frontend build exists.

The complete existing Python suite passed: 238 tests in 1478.241 seconds, with
no failures or skips. Six newly added Python/browser regressions passed in
targeted runs, covering 244 distinct Python test methods overall. The final
API/security/contract run passed all 19 tests. All 27 canvas export tests passed,
including a fully decoded 12-second 1080p/60 FPS output with 720 frames and a
two-minute 60 FPS output with 7,200 frames, checking late audio/lyric boundaries.
JavaScript syntax, Python compilation and `git diff --check` passed.

A fresh `.local/audit-env` installation from `requirements.txt` passed `pip check`,
exact direct dependency version checks, real application/transcription imports,
HTTP/CSP smoke checks, and ten contract/security/word-timing tests. The original
environment's unrelated MoviePy–Pillow conflict remains; no unrelated installed
packages were removed or downgraded. The device/model limitations above still
apply.

## 2026-10-12 — Feature 21: mixed clip selection

Implemented a shared selection for main montage clips, auxiliary audio and
video. Shift selection, cross-lane box selection, touch selection mode, rigid
group dragging, frame nudges, group copy/paste/duplicate/delete and group focus
use pure project-time operations. Movement preserves gaps, audio fade clocks
and automation, and respects non-selected clips and project bounds. Group
locks round-trip through the shared JavaScript/Python schema. Failed edits
leave state and history unchanged; the final main clock cannot be deleted.
Pointer previews never change saved state and commit one undo entry on release.

The group toolbar and built-in lock controls are present in the initial HTML
to reserve their space before deferred scripts run. The controller reuses
those controls. Existing single-clip editors keep their commands and share
the active selection with the group editor.

Validation:

- All 127 JavaScript tests passed, including nine new group editing tests.
- A targeted Python run passed all 30 tests (project contract, audio rendering,
  package operations and native touch group gestures).
- Eight browser tests passed against Waitress with CSP, cache disabled,
  150 ms latency and constrained throughput. Coverage includes five new
  selection scenarios and existing main/video/audio clipboard regressions.
  Tests check mixed drag drafts, cancellation, one-step undo/redo, native
  touch add/move/cancel, keyboard copy/paste/nudge, playable copied audio,
  duplicate, collision errors, deletion, saved locks and reopen.
- The production run checked 320/375/768/1024/1440 px in light and dark,
  cold reload CLS below 0.005, and no browser errors or CSP violations.
  Desktop and mobile screenshots were inspected.
- The real MP4 main montage/lyrics/visualizer parity test passed.
- JavaScript syntax, Python compilation and tracked-file diff checks passed.

The targeted runs cover 38 distinct Python/browser tests, with overlapping
touch checks counted once. This feature slice did not rerun the entire Python
suite. Physical phone, Safari/iOS and tunnel checks remain unverified.
Feature 22 was next at the end of that slice; its implementation is recorded below.

## 2026-10-12 — Feature 22: cross-lane ripple editing

Added an explicit project-time range and lane checklist for removal and gap
insertion. Main montage, video, auxiliary audio, lyrics and each audio track's
automation can be chosen separately. Crossing clips split while retaining
source phase, loop phase, fade clocks, video remapping and mask clocks.
Automation subsegments retain nonlinear domains and Bezier controls. Group
locks, transition overlap boundaries, fractional video frame cuts, short
fragments and project limits fail atomically. Every accepted range edit is
one undo entry, including decoded audio reconnection for newly split lanes.

Added a shared `lyrics.timeBase` contract with the legacy `source` default and
explicit `project` support. Ripple freezes existing source-linked lyrics into
their project occurrences before changing the main clock. Unchecked lyrics
retain their project positions; chosen lyrics split and move with word timing.
Editor seeking/stamping, bulk edits, review loops, imports, recognition drafts,
preview, subtitle exports and the shared MP4 renderer use the chosen clock.
Out-of-montage source text is retained as untimed review material.

Validation:

- All 139 JavaScript tests passed, including 12 new ripple/lyric clock tests.
- Targeted Python checks passed: 21 project/audio, 14 lyrics, 3 explicit word
  timing, 4 contract and 1 new browser-authored ripple mixer parity test.
  The parity test validates the actual edited JSON on the trusted side and
  compares removal/insertion samples, loop phase, fades, Bezier gain and pan.
- Nine browser tests passed against Waitress with CSP, cache disabled, 150 ms
  latency and constrained throughput. Four new ripple scenarios verify
  playable split audio, optional lanes, locks, failed edit history, undo/redo,
  save/reopen, project lyric word seeking, import/export and recognition draft
  mapping. Recognition responses are mocked; no speech model was downloaded.
  Existing word controls, async imports, main montage, review loop ownership
  and frame unit regressions also passed.
- The browser run checked 320/375/768/1024/1440 px in both themes, cold reload
  CLS below 0.005 and no browser errors or CSP violations.
- A new real MP4 parity test passed, comparing project-clock words rendered
  inside a main montage gap with decoded output frames.
- JavaScript syntax, Python compilation and tracked-file diff checks passed.

These runs cover 53 distinct Python/browser tests. There is no separate frontend
build in this application; the production WSGI path was exercised. This slice
did not rerun the entire Python suite or verify a physical phone, Safari/iOS
or a network tunnel. The next feature is 23: slip editing.


### 45–46: group routing and dynamics

229 JavaScript tests passed. Three routing Python tests cover post-fader sends, wet-only delay, independent streaming boundaries, group solo/mute, strict references, package roundtrip and actual WAV output. Four dynamics Python tests cover controls, gate hold, compressor settling, limiter bounds, JavaScript/export sample parity and actual track-compressor/group-limiter output. The 21 existing project/audio and eight effect tests also passed. Five targeted production browser scenarios passed against Waitress/CSP and throttled cold loads, including native Web Audio wet returns, track/group AudioWorklet parity, live gain-reduction meters, locks, undo/redo, save/reopen and five widths in both themes. Cold-load CLS remained below 0.005. Physical phones, Safari/iOS and tunnel behavior remain unverified.


### 47: external sidechain

230 JavaScript tests passed. Three Python tests validate key references, group/cross-key cycle rejection, all three gain characters, pump hold, detector filters, arbitrary block boundaries, JS/export sample equality and actual group-key WAV ducking. The 21 project/audio regressions passed after preserving legacy main-source metadata behavior. Three production browser scenarios passed: live track/group routing, seek/reset, meter, cycle rejection, group deletion/undo, save/reopen, five widths/themes and native two-input AudioWorklet/export sample parity. Existing dynamics UI also passed.


### 48: spectral cleanup

232 JavaScript tests passed, including voice/comp cleanup inheritance regressions and shared FFT visual tests. Five Python tests passed: strict regions/source bounds, identity reconstruction, band attenuation, profile preservation, JS/Python FFT sample equality, source-clock main montage WAV, package roundtrip and an actual MP4 whose particle analysis follows cleaned audio. The 21 existing project/audio checks passed. Six distinct production browser scenarios passed across the initial and follow-up runs: spectral regions/removed audition/apply/history/reopen, brush/keyboard/profile/cancel/locks/responsive layouts, visible worker failure with blocked stale playback and recovery, both main montage regressions, and comp regeneration. Waitress/CSP, throttled cold loads, five widths and both themes were exercised; cold CLS remained below 0.005. Physical phone/Safari/tunnel verification remains unavailable.


### 49: pitch-independent warp

235 JavaScript tests passed. Five Python tests cover strict mappings/live artifacts, speed versus pitch, octave transpose, identity seams, exact lengths, retimed transients, malformed/busy endpoint behavior, browser-authored package roundtrip and actual mixed WAV mapping. Three production browser tests passed using the real local stretch endpoint: preview/apply/single undo, source preservation, regeneration with moved output controls, dissolve/save/reopen; canvas/keyboard precision, invalid drafts, cancellation, locks and all five widths/themes; waveform mount failure restoring state/history. Cold Waitress/CSP tests used throttled transfers and CLS below 0.005. A missing pointer-handler width was found and fixed by the actual drag test. No new DSP dependency was added.


### 50: loudness targets and measurement

235 existing JavaScript tests passed. Four Python tests cover live DSP versus full-file gated R128 measurements, high-frequency true peak, linear/dynamic/silent normalization, cancellation, custom export targets, mono gain, endpoint validation/busy state and cached audition range/delete. Two production browser tests passed against Waitress/CSP and throttled cold loads: real analysis/audition/apply/undo/reopen/invalidation/cancel plus all widths/themes; actual native AudioWorklet measurement and 1/2/4/6-channel speaker downmix calibration. Both live and file meters use the same zero-extension boundary convention. The tests exposed and fixed the difference between loudnorm dynamic statistics and R128 integration on quiet intervals. Physical device/Safari/tunnel verification remains unavailable.


### 29: nested sequences and linked uses

243 JavaScript tests passed. Eight sequence tests cover mixed ownership, local clocks, main-cut lifecycle, nested propagation, lock boundaries, cycle/depth/dangling validation, linked content edits, detach, visual stack order and internal sidechain remapping. Three Python sequence tests passed with fresh schema state: strict typed ownership/ramp bounds; browser-authored nested placement through package and real audio/video MP4; shared-definition edits through server validation/package with identical audio at two placements.

Nine functional production browser scenarios passed in the final batches: mixed create/local text/seek/move/undo/reopen/dissolve; nested release/locks/keyboard/pointer cancel/responsive; main montage split and newly added text retaining membership; shared reuse/File identity/linked edit/detach/undo/source replacement guard; failed waveform loading restoring project and history; both LUFS scenarios; both pre-existing main-montage regressions. Waitress, actual CSP, throttled cold transfers, five widths and both themes were exercised. The extra visual review produced desktop/mobile screenshots and passed the cold-load CLS < 0.005 check. Physical phone, Safari/iOS and a network tunnel remain unverified.

This pass fixed root-level sequence keyboard events moving another selected video, pointer capture preventing double-click entry, pending montage seeks exposing the previous clock to edit commands, and source replacement discarding media before a sequence validation failure. Canonical clips remain the playback/export/package source; no proxy render is introduced for sequences. Linked uses support shared parameter/content/order changes; changing clip counts or grouping requires explicitly detaching a use first.

Final verification: 243 JavaScript tests and 218 Python tests passed in fresh processes against the final schema. The earlier 253-test broad scan also exercised all 35 canvas parity cases (including sustained 1080p/60 FPS) and the two-minute integration export; those 36 checks passed. That broad run had one sequence error because its Python schema was loaded before a concurrent schema edit; the affected module, including the new shared-use case, passed in the fresh final run. The full workspace browser suite was not repeated; the nine targeted production scenarios above passed.
### Controller audit corrections — 13 October 2026

246 JavaScript tests, 21 project/audio Python regressions and four Python contract checks passed. Seven new controller browser scenarios passed against Waitress with the actual CSP; 39 existing workspace scenarios passed across the broad run and targeted recheck against the application's WSGI test server/CSP. The frame-unit video test now loads real media and checks the selected canonical clip. Final targeted checks also cover disabled source fields without media and tool navigation at five widths in both themes.

The corrections cover marker/source clocks, eight-pixel source snapping, selected-clip source edits, readonly and cancellable numeric gestures, local input previews, fine steps, accurate bass units, matching overlay bounds, dynamic range fills, SELECT-safe shortcuts, accessible labels and choice semantics. Lazy rendering retains dynamic audio controls, sequence entry and keyframe keyboard ownership. The comparable 15-event slider benchmark changed from 58.7 ms to 14.7 ms median synchronous work (10.7–20.3 ms final range); deferred preview/GPU work is outside that metric. See [CONTROLLER_FIXES.md](CONTROLLER_FIXES.md) and its evidence file for scope and limitations.

Follow-up: nine controller browser tests passed against Waitress/CSP, including two new regressions for missing selected-source metadata, precision bounds/empty/focused values, marker deletion focus and the visible live status announcement. Two existing keyframe/precision and canvas-transform regressions also passed against WSGI/CSP. Both new tests failed on their targeted behavior before correction. These UI changes preserve the stored project/audio model; the JavaScript/Python counts above are from the preceding pass.

### Unit controls — 14 October 2026

247 JavaScript tests, 14 Python lyric/output tests and 17 browser scenarios passed: 12 controller scenarios against Waitress/actual CSP and five existing frame, keyframe, word-timing and automation scenarios against WSGI/CSP. New cases first reproduced frame scrubbing lost during lyric-row replacement, missing readonly propagation and a silent dB control jumping to 112.2% gain. The fixes preserve mirror identity and native restrictions, refresh focused frame counts when FPS/source values change, show validation errors and start silent-level scrubbing at -120 dB without restricting quieter typed values. A regression also verifies exact 22/24-second lyric storage with millisecond SRT formatting only at export. Earlier performance/cold-load records remain historical; physical-device/Safari/tunnel verification was not added in this pass.

### Short-clip unit boundaries — 14 October 2026

249 JavaScript tests and 20 browser scenarios passed (15 Waitress/CSP controller cases, five existing WSGI/CSP regressions). Integer frame presentation now stays within representable bounds, labels approximations, preserves canonical seconds and offers the seconds selector when no integer frame exists. Disabling the focused frame field transfers focus to the unit selector. Precision display rounding preserves fractional boundaries. New coverage includes a 0.05-second clip at 24 fps, an interval with no legal integer frame, fractional precision limits and a negative cover-fit pixel axis whose increment moves the actual rectangle by one pixel. Pixel/percent switches preserve geometry; five widths in both themes had no horizontal page overflow. Previous Python/benchmark/cold-load records were not repeated for this UI pass.

### Studio interface redesign — 14 October 2026

The interface adapts the local Awesome DESIGN.md Linear and ElevenLabs references: neutral surface hierarchy, restrained lavender actions/focus, system sans typography, consistent mono values and a light palette resolved in critical CSS. Desktop preview and the selected-source editor sit above a full-width timeline; mobile stacks the same controls. Video editing precedes source imports, and a dedicated Kurgu mode opens montage controls.

A context-aware tool selector and Ctrl/Command+K dialog reveal existing editor nodes. The dialog searches Turkish/ASCII names and operation aliases, includes added audio channels, supports keyboard navigation/focus restoration and blocks underlying project shortcuts. Search-field Escape clearing and focus leaving the dialog were found in actual keyboard tests and corrected. Audio channel headers now align their label and group-lock control on one row, retaining the full accessible lock name and showing all three default channels.

Visual verification also moved the media library and scene-layer editors into an explicit auxiliary container after the primary montage form. The visual editor receives its container explicitly. A horizontal clip picker and tighter grid spacing keep the first montage fields inside the initial inspector viewport; the design test asserts this geometry. A test-listener setup attempt hit Chromium's blocked port 2049 before page load; the Waitress fixture now binds directly within the private/dynamic port range, without weakening browser security.

249 JavaScript tests and 27 distinct browser scenarios passed. Fifteen controller scenarios and four new design scenarios passed against Waitress/actual CSP for five widths, both themes, all five modes, geometry, unique IDs, context navigation, dynamic channels, search/empty results, keyframe access, native audio file choice, project/history preservation and keyboard containment. Eight existing WSGI/CSP scenarios passed in the final run, covering layout, added channels, main montage, nested sequences, keyframe/precision, word timing, audio routing and visual canvas drafts. The initial layout failure was corrected by aligning audio channel headers and group locks, retaining the existing three-channel visibility assertion. Text/muted contrast was checked at >=4.5:1 and focus/form boundaries at >=3:1 for both palettes. Results are recorded in [STUDIO_DESIGN_EVIDENCE.json](STUDIO_DESIGN_EVIDENCE.json).

Waitress cold loads and refreshes at 1440 px dark and 375 px dark/light used disabled cache, 150 ms latency and constrained transfer rates. CLS was 0 for all six samples, with no page errors or CSP violations. Desktop/light/dark, mobile and search screenshots were visually inspected. These checks use Chromium; physical phone, Safari/iOS, Firefox, a tunnel and screen-reader speech remain unverified. No DSP, project schema, package format or export behavior was changed.
