# BlockDrop Web Game

Browser Tetris-style game with solo modes, AI practice, local saves, server records, online PvP rooms, mobile controls, replay/ghost run, and PWA-friendly assets.

Live demo: [http://45.148.117.119/](http://45.148.117.119/)

## Screenshots

![Mobile menu](screenshots/menu-mobile.png)
![Mobile gameplay](screenshots/game-mobile.png)
![Gameplay GIF](screenshots/gameplay.gif)

## Features

- 10x20 playfield with 7-bag randomizer, SRS wall kicks, ghost piece, hold, next queue, DAS/ARR, and lock delay.
- Game flow: menu, playing, pause, game over, resume, restart, and main menu.
- Modes: Classic, 40 Lines, Hardcore, Time Attack, Zen, and Chaos.
- Score, level, lines, timer, high score, local stats, achievements, and server leaderboard.
- Gradual speed progression with a cap.
- Special pieces: normal, danger, bonus, and rare chaos.
- Survival streak and score bonuses for stable play.
- Web Audio API sounds, mute toggle, screen shake, particles, score flash, and game over effect.
- AI opponent with difficulty, style, and pace settings.
- Replay/Ghost run: the best local run is saved, shown as a timeline, and used as a ghost silhouette in later attempts.
- Online rooms with shareable `/room/CODE` links, QR invite, WebSocket PvP garbage attacks, opponent progress silhouette, and tournament room.
- Russian and English UI.
- Mobile controls with touch gestures, buttons, handedness, sensitivity, and performance settings.
- Offline-friendly/PWA files for secure hosts.

## Controls

- Keyboard: arrows or WASD to move, `Up/W/X` to rotate, `Q` to rotate back, `Space/Z` for hard drop, `C/H/E/Shift` for hold, `P/Esc` for pause.
- Mouse/trackpad on the board: click to rotate, double click to rotate back, drag left/right to move, drag down to drop, right click for hold.
- Touch: tap to rotate, double tap to rotate back, swipe left/right to move, swipe down for soft drop, fast swipe down for hard drop, long press for hold.
- Mobile buttons can be enabled from settings.

## Run Locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:8787
```

`index.html` can still run static solo play. Online rooms and server records require `server.js`.

## Scripts

```bash
npm start
npm run lint
npm test
npm run test:e2e
npm run capture:media
npm run verify
```

## Project Structure

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
js/modes.js
server.js
tests/
e2e/
screenshots/
scripts/
```

## Testing

- Vitest covers game logic, scoring, modes, storage helpers, online helpers, audio config, and server hardening.
- Playwright covers game startup, pause, game over overlay, mobile layout, room links, online rooms, modes, and replay menu.
- `npm run capture:media` refreshes mobile screenshots and gameplay GIF.

## Online Rooms

Example room URLs:

- Local: [http://localhost:8787/room/DUEL](http://localhost:8787/room/DUEL)
- Public: [http://45.148.117.119/room/DUEL](http://45.148.117.119/room/DUEL)

Use **Play with friend / Играть с другом** from the main menu to generate a room URL and QR invite.
