# BlockDrop design system

BlockDrop keeps its graphite, mint, warm-accent identity while using one set of semantic components across menu, gameplay, online, replay, and result scenes.

## Foundations

- Color tokens live in `styles.css`: `--bg-*`, `--panel*`, `--text`, `--muted`, `--accent`, `--accent-2`, `--danger`, and `--line`. Components must use semantic tokens rather than theme-specific colors.
- The four supported themes are `ember`, `day`, `candy`, and `mono`. Every new component must pass visual and axe checks in each theme.
- Spacing follows a 4 px base. Normal gaps are 8–12 px; modal sections use 16–24 px. Safe-area insets are always included at the app boundary.
- Radius tokens are 6, 8, and 12 px. Motion tokens are 180, 300, and 500 ms.
- Typography uses the system-first Trebuchet/Avenir/Segoe stack. Text must remain readable at 200% browser zoom.

## Components

- `.button` is the universal action, with `.primary` for the single preferred action and `.warn` for destructive or high-impact actions.
- `.panel`, `.stat`, `.status-card`, `.room-card`, and `.help-card` share border, background, and elevation behavior.
- `.overlay > .modal` is the only dialog pattern. Dialogs require `role="dialog"`, `aria-modal="true"`, a labelled heading, focus trapping, and focus restoration.
- All pointer targets are at least 44×44 CSS px. Focus must remain visible independently of hover.
- Live gameplay changes use the polite status region; match-ending and onboarding-completion messages use the assertive region.

## Responsive profiles

Pinned release profiles are 360×780 at DPR 3 (Galaxy S25 FE), 360×700, 390×844, landscape 780×360, and desktop 1280×720. The board owns the remaining space; side information may scroll internally but must never overlap controls. No page-level horizontal scroll is allowed.

## Performance and motion

The default target is 60 FPS and under 80 ms local input latency on the Galaxy S25 FE profile. Adaptive mode caps particles, pools them, and removes blur/shadow-heavy effects when data saver, a low-capability device, battery mode, or `prefers-reduced-motion` is detected. Essential state changes never depend on animation alone.

## Content and localization

Static product copy is sourced from `js/i18n.js`. RU and EN catalogs are release-gated for structural parity. New labels must be added to both locales in the same change; user or server data must be escaped before HTML rendering.
