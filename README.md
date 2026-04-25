# BlockDrop Web Game

Browser Tetris-style game with Russian UI, solo modes, local saves, server records, and online PvP rooms.

Live demo:

```text
http://45.148.117.119/
```

GitHub Pages can host the offline solo version. The Node.js server is still required for WebSocket rooms and server records.

## Features

- 10x20 playfield, ghost piece, hold, next queue, 7-bag randomizer.
- SRS-style wall kicks, lock delay, DAS/ARR settings, soft drop and hard drop.
- Classic, 40 lines, Zen, and Chaos modes.
- Score, levels, local records, server records, achievements, and autosave.
- Web Audio API sound effects for move, rotate, hard drop, line clear, Tetris, combo, level up, game over, and PvP attacks.
- Online PvP rooms with 1v1, tournament timer, garbage attacks, and opponent progress silhouette.
- PWA manifest and service worker for offline solo play on secure hosts.

## Controls

- Keyboard: arrows or WASD to move, Up/W/X to rotate, Space/Z for hard drop, C for hold, P/Esc for pause.
- Touch: tap to rotate, swipe left/right to move, short swipe down for soft drop, long swipe down for hard drop.
- Settings include swipe sensitivity, DAS, ARR, sound categories, vibration, theme, large buttons, and ghost piece.

## Installation

```bash
npm install
npm start
```

Open:

```text
http://localhost:8787
```

The static game can still be opened through `index.html`, but online rooms and server records require `server.js`.

## Development

Project structure:

```text
index.html
styles.css
js/config.js
js/game-core.js
js/game.js
js/ui.js
js/input.js
js/audio.js
js/online.js
js/storage.js
screenshots/
server.js
tests/
e2e/
```

`js/game.js` is still the browser coordinator, but core data, config, storage helpers, input normalization, Web Audio playback, and online message builders now live in imported modules instead of being duplicated in the runtime.

Useful scripts:

```bash
npm run dev
npm run lint
npm test
npm run test:e2e
npm run format
```

## Testing

Unit tests use Vitest and cover:

- piece generation and 7-bag randomizer;
- collision checks;
- SRS wall kicks;
- line clears;
- scoring;
- hold;
- game over;
- garbage and attack logic.

E2E tests use Playwright and cover:

- page loads;
- game starts;
- piece movement input is accepted;
- pause overlay opens;
- game over overlay is visible when triggered.

## Online Multiplayer

Run the Node server and share a room URL:

```text
http://localhost:8787/room/DUEL
```

On the public server:

```text
http://45.148.117.119/room/DUEL
```

WebSocket messages are validated and rate-limited. Suspicious or oversized messages are closed without crashing existing rooms.

## GitHub Pages

GitHub Pages can serve the static files for solo play:

1. Push the repository to GitHub.
2. Open repository settings.
3. Enable Pages from the `master` branch.
4. Open the generated Pages URL.

Known limitation: GitHub Pages cannot run `server.js`, so online rooms and server records need a VPS/Node host.

## Screenshots / GIF

Current mobile screenshots:

![Mobile menu](screenshots/menu-mobile.png)
![Mobile gameplay](screenshots/game-mobile.png)

Good next media task: add a short gameplay GIF after visual polish stabilizes.

## Roadmap

- Move more runtime code from `js/game.js` into smaller imported modules.
- Split the browser coordinator into scene, rendering, HUD, and online controller modules.
- Add HTTPS/domain deployment so PWA install works on the public server IP replacement.
- Add stricter server-side scoring validation for competitive rooms.
- Add mobile-first HUD variants for very small screens.
- Add persistent server leaderboard UI filters.

## Known Issues

- The current public URL is plain HTTP, so full PWA install is limited by browser security rules.
- `js/game.js` still contains the browser runtime, but it now delegates shared mechanics and helpers to real modules.
- The WebSocket server validates message shape and rate-limits traffic, but competitive anti-cheat is not authoritative yet.
- Playwright requires browser binaries. In CI this is handled by `npx playwright install --with-deps chromium`.
