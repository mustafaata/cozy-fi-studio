# Release validation

Local release checks were performed on Windows x64 with Python 3.10, FFmpeg, Playwright Chromium, and the production Waitress entry point.

## Checks

- Python unit, security, browser, audio, and real video-export tests.
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
