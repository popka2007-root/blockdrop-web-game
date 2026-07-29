import "../shared/engine.js";

const engine = globalThis.__blockdropEngine;

if (!engine) {
  throw new Error("BlockDrop deterministic engine failed to initialize");
}

export const {
  ACTIONS,
  ATTACK,
  COLS,
  ENGINE_VERSION,
  GARBAGE_HOLE_CHANGE_RATE,
  MAX_ATTACK_PER_LOCK,
  MAX_GARBAGE_PER_APPLY,
  MAX_PENDING_GARBAGE,
  MODE_RULES,
  PIECES,
  REPLAY_VERSION,
  ROWS,
  SCORE,
  SHAPES,
  SNAPSHOT_VERSION,
  SRS_KICKS,
  TICK_RATE,
  addGarbage,
  advanceReplayState,
  applyInput,
  buildReplayCheckpoints,
  calculateClearResult,
  checksum,
  clearLines,
  createReplay,
  createState,
  hashSeed,
  isValid,
  makeBoard,
  nextRandom,
  pieceCells,
  queueGarbage,
  restoreSnapshot,
  rotatePiece,
  simulateReplay,
  snapshot,
  step,
} = engine;

export default engine;
