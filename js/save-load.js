const SAVE_KEYS = [
  "board",
  "active",
  "queue",
  "bag",
  "hold",
  "holdUsed",
  "mode",
  "difficulty",
  "score",
  "lines",
  "level",
  "combo",
  "bestComboRun",
  "pieces",
  "hardDrops",
  "holds",
  "rotations",
  "moves",
  "softDrops",
  "bestClearInGame",
  "sessionHistory",
  "survivalStreak",
  "lastStreakMs",
  "currentGhostRun",
  "lastGhostSampleMs",
  "elapsedMs",
];

export function buildSavePayload(state) {
  return Object.fromEntries(SAVE_KEYS.map((key) => [key, state[key]]));
}

export function applySaveSnapshot(state, save, phase) {
  Object.assign(state, save, {
    running: true,
    paused: false,
    gameOver: false,
    won: false,
    phase,
    lastTime: 0,
    dropMs: 0,
    lockDelayMs: 0,
    lockResets: 0,
    flashes: [],
  });

  state.sessionHistory = Array.isArray(save.sessionHistory)
    ? save.sessionHistory
    : [];
  state.survivalStreak = Number(save.survivalStreak) || 0;
  state.lastStreakMs = Number(save.lastStreakMs) || state.elapsedMs || 0;
  state.currentGhostRun = Array.isArray(save.currentGhostRun)
    ? save.currentGhostRun
    : [];
  state.lastGhostSampleMs =
    Number(save.lastGhostSampleMs) || state.elapsedMs || 0;
}
