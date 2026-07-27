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
