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
  "backToBackChain",
  "bestBackToBackRun",
  "pieces",
  "hardDrops",
  "holds",
  "rotations",
  "moves",
  "softDrops",
  "bestClearInGame",
  "tSpinCount",
  "tSpinMiniCount",
  "perfectClearCount",
  "bestMomentEvent",
  "lastRotation",
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
  state.backToBackChain = Number(save.backToBackChain) || 0;
  state.bestBackToBackRun = Number(save.bestBackToBackRun) || 0;
  state.tSpinCount = Number(save.tSpinCount) || 0;
  state.tSpinMiniCount = Number(save.tSpinMiniCount) || 0;
  state.perfectClearCount = Number(save.perfectClearCount) || 0;
  state.bestMomentEvent =
    save.bestMomentEvent && typeof save.bestMomentEvent === "object"
      ? save.bestMomentEvent
      : null;
  state.lastRotation =
    save.lastRotation && typeof save.lastRotation === "object"
      ? save.lastRotation
      : null;
  state.survivalStreak = Number(save.survivalStreak) || 0;
  state.lastStreakMs = Number(save.lastStreakMs) || state.elapsedMs || 0;
  state.currentGhostRun = Array.isArray(save.currentGhostRun)
    ? save.currentGhostRun
    : [];
  state.lastGhostSampleMs =
    Number(save.lastGhostSampleMs) || state.elapsedMs || 0;
}
