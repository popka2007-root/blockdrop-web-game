BlockDrop Web Game
==================

Browser Tetris-style game with solo modes, AI practice, local saves, server records, online PvP rooms, mobile controls, replay/ghost run, and PWA-friendly assets.

Live demo:
http://45.148.117.119/

Features
--------

- 10x20 playfield with 7-bag randomizer, SRS wall kicks, ghost piece, hold, next queue, DAS/ARR, and lock delay.
- Modes: Classic, 40 Lines, Hardcore, Time Attack, Zen, and Chaos.
- Score, level, lines, timer, high score, local stats, achievements, and server leaderboard.
- Special pieces: normal, danger, bonus, and rare chaos.
- Survival streak and score bonuses.
- Web Audio API sounds, mute toggle, screen shake, particles, score flash, and game over effect.
- AI opponent with difficulty, style, and pace settings.
- Replay/Ghost run for the best local run.
- Online rooms with /room/CODE links, QR invite, WebSocket PvP garbage attacks, and tournament room.
- Russian and English UI.
- Mobile controls with gestures, buttons, handedness, sensitivity, and performance settings.

Controls
--------

- Keyboard: arrows or WASD to move, Up/W/X to rotate, Q to rotate back, Space/Z for hard drop, C/H/E/Shift for hold, P/Esc for pause.
- Mouse/trackpad: click to rotate, double click to rotate back, drag to move/drop, right click for hold.
- Touch: tap to rotate, double tap to rotate back, swipe left/right, swipe down, fast swipe down for hard drop, long press for hold.

Run Locally
-----------

npm install
npm start

Open:
http://localhost:8787

index.html can run static solo play. Online rooms and server records require server.js.

Scripts
-------

npm start
npm run lint
npm test
npm run test:e2e
npm run capture:media
npm run verify

Online Rooms
------------

Local:
http://localhost:8787/room/DUEL

Public:
http://45.148.117.119/room/DUEL

Use "Play with friend / Играть с другом" from the main menu to generate a room URL and QR invite.
