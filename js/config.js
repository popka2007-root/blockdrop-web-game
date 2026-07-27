import {
  ATTACK as ENGINE_ATTACK,
  COLS,
  PIECES,
  ROWS,
  SCORE as ENGINE_SCORE,
  SHAPES,
  SRS_KICKS,
} from "./engine.js";

export { COLS, PIECES, ROWS, SHAPES, SRS_KICKS };

export const SCORE_TABLE = ENGINE_SCORE.line;

export const ATTACK_TABLE = Object.freeze({
  0: ENGINE_ATTACK.line[0],
  1: ENGINE_ATTACK.line[1],
  2: ENGINE_ATTACK.line[2],
  3: ENGINE_ATTACK.line[3],
  4: ENGINE_ATTACK.line[4],
});

export const ADVANCED_SCORING = Object.freeze({
  line: Object.freeze({ ...ENGINE_SCORE.line }),
  tSpin: Object.freeze({ ...ENGINE_SCORE.tSpin }),
  tSpinMini: Object.freeze({ ...ENGINE_SCORE.tSpinMini }),
  combo: ENGINE_SCORE.combo,
  perfectClear: Object.freeze({ ...ENGINE_SCORE.perfectClear }),
  backToBackMultiplier: 1.5,
});

export const ADVANCED_ATTACK = Object.freeze({
  line: Object.freeze({ ...ENGINE_ATTACK.line }),
  tSpin: Object.freeze({ ...ENGINE_ATTACK.tSpin }),
  tSpinMini: Object.freeze({ ...ENGINE_ATTACK.tSpinMini }),
  combo: ENGINE_ATTACK.combo,
  perfectClear: Object.freeze({ ...ENGINE_ATTACK.perfectClear }),
  backToBackBonus: 1,
});

export const TIMING = Object.freeze({
  FRAME_MS: 16.67,
  GRAVITY_BASE: 1,
  dasMs: 140,
  arrMs: 36,
  lockDelayMs: 480,
  LOCK_DELAY_MS: 480,
  DAS_MS: 140,
  ARR_MS: 36,
  SOFT_DROP_LOCK_MS: 80,
  MAX_FRAME_DELTA_MS: 80,
});

export const PHYSICS = Object.freeze({
  SOFT_DROP_SPEED: 1,
  HARD_DROP_SCORE_PER_CELL: 2,
  MIN_DROP_INTERVAL_MS: 70,
  BASE_DROP_INTERVAL_MS: 760,
  RELAXED_DROP_BONUS_MS: 180,
  LEVEL_DROP_STEP_MS: 42,
});

export const FLOW_STATE = Object.freeze({
  MENU: "menu",
  PLAYING: "playing",
  PAUSED: "paused",
  GAME_OVER: "gameOver",
});

export const PROGRESSION = Object.freeze({
  TIME_SPEED_STEP_MS: 12_000,
  TIME_SPEED_STEP_DROP_MS: 12,
  TIME_SPEED_MAX_DROP_MS: 150,
  SURVIVAL_STREAK_STEP_MS: 10_000,
  SURVIVAL_STREAK_SCORE: 12,
  MAX_STREAK_SCORE_BONUS: 220,
});

export const UI = Object.freeze({
  TOAST_DURATION_MS: 1800,
  ANIMATION_DURATION_MS: 300,
  COMBO_DECAY_MS: 1000,
  FLASH_DECAY_MS: 320,
  FLASH_GROW_MS: 140,
});

export const SCORING_THRESHOLDS = Object.freeze({
  PLAYER: 1200,
  PRO: 3500,
  MASTER: 7000,
  LEGEND: 12000,
});

export const DEFAULT_TIMING = Object.freeze({
  dasMs: TIMING.DAS_MS,
  arrMs: TIMING.ARR_MS,
  lockDelayMs: TIMING.LOCK_DELAY_MS,
});
