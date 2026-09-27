# Engineering Role & Production Standards

## Role and Standard

Write code as if it will run in production and be maintained by others for years. Prefer durable, idiomatic, secure, production-grade solutions over quick fixes, temporary patches, or local workarounds. "It works on my screen" is not done; done means correct, secure, stable, and maintainable.

## Before Changing Anything

- Understand the existing architecture, conventions, data flow, naming, folder structure, and abstractions before editing.
- When a framework, library, platform API, or established project pattern exists, work with it. Do not bypass it with ad-hoc code.
- Fix root causes, not symptoms. If you apply a symptom-level fix, state explicitly why the root cause cannot be fixed now.
- Prefer the smallest change that is architecturally correct. Do not rewrite unrelated code.
- If a requirement is ambiguous and a wrong guess is costly, ask before implementing.

## Architecture and Code Quality

- Keep the codebase modular: small, single-responsibility units with clear boundaries and explicit interfaces.
- Design for change: any part (component, style, service, config) must be replaceable or editable later without touching unrelated parts.
- Separate concerns: UI, state, business logic, data access, and configuration live in their own layers.
- Avoid duplicated logic; extract shared behavior into reusable utilities, components, hooks, or mixins.
- Avoid tight coupling, hidden side effects, global mutable state, magic numbers, and monolithic files.
- Centralize configuration and constants; never hardcode environment-specific values, and see Environment Parity for what may legitimately differ between environments.
- Use clear, consistent naming. Comment the "why", not the "what".
- Handle relevant errors and edge cases (empty, loading, error, slow network, long content, missing data). Do not over-engineer: the simplest fully correct solution wins.
- Keep types strict where the language supports it; avoid `any`-style escapes.

## Security (Default, Never Optional)

- Validate and sanitize all external input on the trusted side (server), not only in the client.
- Prevent injection: XSS, SQL/NoSQL, command, path traversal, template, and prototype pollution. Never inject untrusted HTML; use safe APIs.
- Enforce authentication and authorization at every boundary; never trust client-side checks alone.
- Never expose secrets, tokens, internal errors, or stack traces to clients or logs. Keep secrets out of source control.
- Apply least privilege, secure defaults, and safe headers (CSP, HSTS, X-Content-Type-Options, frame protections) where applicable.
- Prefer maintained, well-known dependencies; avoid adding a dependency for trivial functionality.
- Never trade security for convenience.

## Environment Parity (Dev/Prod)

Behaviour must not depend on the environment unless the difference IS the requirement (e.g. `__Host-` cookies require https). This is 12-Factor X: every environment-conditional branch is code that local development never executes, and therefore never tests.

- No `if (isProd)` / `if (secure)` / `if (localhost)` branch may change what the client receives beyond the minimum the platform requires. Document each one and why it exists.
- Anything that only exists in the build (CSP and the rest of `_headers`, minification, code splitting) must be exercised against a production build before it ships. The dev server is not a rehearsal.
- Treat "works on localhost" as untested: localhost has no latency, no packet loss, an empty browser cache, and a secure-context exemption. Verify once over a tunnel, on a real phone, with network throttling.
- Prefer APIs whose failure mode is visible. A header the browser may stall on (`Clear-Site-Data`) is a production-only outage a laptop cannot reproduce.
- A UI state transition must never depend on a second round trip after the server already committed the change: seed state from the response, then navigate.
- Never swallow a failure. Every rejected promise ends in a toast, a log, or an error boundary; a silent catch turns a parity bug into a ghost.

## Web: Compatibility and Performance

- Support modern desktop and mobile browsers (Chrome, Safari incl. iOS, Firefox, Edge) from the start, not as an afterthought.
- Account for touch input, hover-less devices (`@media (hover: hover)`), safe-area insets, dynamic viewport units (`dvh`/`svh` instead of raw `100vh` on mobile), and different pixel densities.
- Check feature support before relying on newer CSS/JS APIs; provide fallbacks with `@supports` or progressive enhancement.
- Mind performance: minimal render-blocking resources, lazy loading where appropriate, no layout thrashing, animate only `transform` and `opacity`.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`; ensure accessible contrast, focus states, and semantic HTML.

## Web: Zero Visual Instability on Load (FOUC / FOUT / FOIT / CLS / Flash)

The first painted frame must match the final state as closely as possible. No flicker, no flash, no jump, no element briefly appearing in the wrong color, position, size, or style — on first load, on refresh, on navigation, or during hydration.

### Background and Theme
- Always set an explicit background color and text color on `html` and `body` in critical, render-blocking CSS (inline in `<head>` if needed). Never let the browser's default white show through.
- Declare `color-scheme` (both the `<meta name="color-scheme">` tag and the CSS property) so native UI, scrollbars, form controls, and the pre-paint canvas match the theme.
- Resolve the theme (light/dark/user choice) BEFORE first paint, using a tiny blocking inline script in `<head>` that sets the theme attribute on `<html>`. Never resolve theme after hydration.

### Translucency and Blur (`backdrop-filter`, glassmorphism)
- A translucent/blurred element must never reveal an unstyled or white background during load. The page background behind it must be painted from the first frame.
- Always give translucent elements a solid or semi-opaque fallback `background-color` that looks correct on its own; layer `backdrop-filter` on top via `@supports`. Include `-webkit-backdrop-filter` for Safari.
- Do not let blur, opacity, or background transition in from their initial values on page load.

### Transitions and Animations
- Never let CSS transitions fire on initial load or theme application (e.g. background fading from white to dark). Suppress transitions until the page is ready, or apply them only to user-triggered state changes.
- Entrance animations must start from their intended initial state, defined in CSS, not set by JS after paint.

### Fonts
- Preload critical fonts, use `font-display` deliberately (`swap` with a metric-matched fallback, or `optional` for non-critical fonts).
- Match fallback font metrics (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`) so the font swap causes no reflow.

### Layout Shift
- Reserve space for all async content: set `width`/`height` or `aspect-ratio` on images, video, iframes, embeds, and ads.
- Use skeletons or placeholders with the exact final dimensions.
- Do not insert content above existing content after load unless triggered by the user.
- Avoid scrollbar-induced shifts (`scrollbar-gutter: stable` where appropriate).

### SSR / Hydration
- Server-rendered markup must match the client's first render exactly. Never render values that differ between server and client (theme, dates, viewport, random IDs, `localStorage`) without handling the mismatch before paint.
- Responsive layout must be solved in CSS (media/container queries), not by measuring the viewport in JS after mount.

## Web: Pixel-Perfect Alignment and Spacing

Treat alignment and spacing as precision work, but achieve it through the layout system, not brittle hacks.

- Use a spacing scale defined as design tokens (CSS custom properties). No arbitrary one-off values like `13px` or `7px`.
- Keep spacing symmetric and intentional: top/bottom and left/right padding must be balanced unless asymmetry is deliberate.
- Prefer `gap` in flex/grid over margins on children. Avoid margin collapse surprises and stray margins on first/last children.
- Align related elements to shared edges and baselines across rows, columns, containers, and breakpoints. Use grid (including `subgrid` where supported) to align content across sibling cards.
- Use `box-sizing: border-box` globally. Borders must not shift layout between states (use `outline`, `box-shadow`, or reserve border width).
- Interaction states (hover, focus, active, selected, disabled, loading) must not change element size or shift neighbors.
- Buttons, inputs, and controls in the same row must share identical height and vertical alignment.
- Avoid sub-pixel blur: no fractional `transform` values on text, no odd scaling of crisp elements.

### Text + Icon Alignment
- Treat an icon and its text as one unit: use `display: inline-flex; align-items: center; gap: var(--space-x)`.
- Size icons relative to text (`1em` or a token that matches the line height) and use a consistent icon set with a uniform viewBox.
- Set an explicit `line-height` on the unit; remove inline SVG baseline gaps (`display: block` on the SVG inside the flex container).
- Use `text-box-trim` / `text-box-edge` where supported for optical centering; fall back gracefully.
- Only use small optical offsets when the glyph itself is optically off-center, never to compensate for a broken layout, and document why.

### Verification
- Check layouts at common widths (≈320, 375, 768, 1024, 1440+), in light and dark mode, with long and short content, and in every interaction state.
- Verify refresh behavior (including hard refresh and slow network throttling) for flashes, jumps, and late style changes.
- Run the same checks against a production build, not only the dev server.

## CSS Architecture

- Organize styles in a predictable layered structure (e.g. `@layer reset, tokens, base, layout, components, utilities`) to control specificity instead of fighting it.
- Define colors, spacing, radii, shadows, typography, z-index, and motion as tokens; components consume tokens only.
- Scope component styles (CSS Modules, component-scoped styles, or a consistent naming convention). No global leakage.
- Avoid `!important`, deep selectors, ID selectors for styling, and z-index wars (use a defined z-index scale).
- Prefer logical properties (`margin-inline`, `padding-block`) for direction-agnostic layouts.

## Output Expectations

- State what changed, why, and any trade-offs or follow-ups.
- Mention related issues outside the scope rather than silently touching unrelated code.
