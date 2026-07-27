import {
  ACTIONS,
  COLS,
  ENGINE_VERSION,
  PIECES,
  ROWS,
  restoreSnapshot,
} from "./engine.js";

export const SAVE_SCHEMA_VERSION = 2;
export const GHOST_SCHEMA_VERSION = 2;

const PIECE_KINDS = new Set([...PIECES, "X"]);
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
  "seed",
  "randomState",
  "engineSnapshot",
  "inputSeq",
  "replayInputs",
  "replayEvents",
];

function safeInteger(value, fallback = 0, min = 0, max = 1_000_000_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeKind(value, allowGarbage = false) {
  const kind = typeof value === "string" ? value : value?.kind;
  if (!PIECE_KINDS.has(kind) || (!allowGarbage && kind === "X")) return "";
  return kind;
}

function normalizeCell(value) {
  if (value == null || value === false || value === 0) return null;
  const kind = normalizeKind(value, true);
  if (!kind) throw new Error("invalidBoardCell");
  return typeof value === "object" ? { kind } : kind;
}

function normalizeBoard(value) {
  if (
    !Array.isArray(value) ||
    value.length !== ROWS ||
    value.some((row) => !Array.isArray(row) || row.length !== COLS)
  ) {
    throw new Error("invalidBoard");
  }
  return value.map((row) => row.map(normalizeCell));
}

function normalizePiece(value, required = false) {
  if (value == null && !required) return null;
  const kind = normalizeKind(value);
  const rotation = safeInteger(value?.rotation, 0, 0, 3);
  const x = safeInteger(value?.x, 3, -4, COLS + 3);
  const y = safeInteger(value?.y, 0, -4, ROWS + 3);
  if (!kind) throw new Error("invalidPiece");
  return { kind, rotation, x, y };
}

function normalizeDraft(value) {
  const kind = normalizeKind(value);
  if (!kind) throw new Error("invalidPieceDraft");
  return { kind };
}

function normalizeState(raw) {
  const state = {};
  for (const key of SAVE_KEYS) state[key] = raw[key];
  state.board = normalizeBoard(raw.board);
  state.active = normalizePiece(raw.active, true);
  state.queue = Array.isArray(raw.queue)
    ? raw.queue.slice(0, 14).map(normalizeDraft)
    : [];
  state.bag = Array.isArray(raw.bag)
    ? raw.bag.slice(0, 14).map((value) => {
        const kind = normalizeKind(value);
        if (!kind) throw new Error("invalidBag");
        return kind;
      })
    : [];
  state.hold = raw.hold == null ? null : normalizeDraft(raw.hold);
  state.holdUsed = Boolean(raw.holdUsed);
  state.mode = String(raw.mode || "classic").slice(0, 24);
  state.difficulty = String(raw.difficulty || "normal").slice(0, 24);
  for (const key of [
    "score",
    "lines",
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
    "survivalStreak",
    "lastStreakMs",
    "lastGhostSampleMs",
    "elapsedMs",
  ]) {
    state[key] = safeInteger(raw[key]);
  }
  state.level = safeInteger(raw.level, 1, 1, 99);
  state.sessionHistory = Array.isArray(raw.sessionHistory)
    ? raw.sessionHistory.slice(-60)
    : [];
  state.currentGhostRun = Array.isArray(raw.currentGhostRun)
    ? raw.currentGhostRun.slice(-240)
    : [];
  state.bestMomentEvent =
    raw.bestMomentEvent && typeof raw.bestMomentEvent === "object"
      ? raw.bestMomentEvent
      : null;
  state.lastRotation =
    raw.lastRotation && typeof raw.lastRotation === "object"
      ? raw.lastRotation
      : null;
  state.seed = String(raw.seed || "").slice(0, 128);
  state.randomState = safeInteger(raw.randomState);
  state.engineSnapshot = raw.engineSnapshot
    ? restoreSnapshot(raw.engineSnapshot)
    : null;
  state.inputSeq = safeInteger(raw.inputSeq);
  state.replayInputs = Array.isArray(raw.replayInputs)
    ? raw.replayInputs.slice(-100_000).map((input) => {
        const action = String(input?.action || "");
        if (!ACTIONS.includes(action)) throw new Error("invalidReplayInput");
        return {
          tick: safeInteger(input.tick, 0, 0, 60 * 60 * 60),
          seq: safeInteger(input.seq),
          action,
          pressed: input.pressed !== false,
        };
      })
    : [];
  state.replayEvents = Array.isArray(raw.replayEvents)
    ? raw.replayEvents.slice(-10_000).map((event) => {
        if (event?.type !== "garbage") throw new Error("invalidReplayEvent");
        return {
          tick: safeInteger(event.tick, 0, 0, 60 * 60 * 60),
          type: "garbage",
          lines: safeInteger(event.lines, 1, 1, 40),
        };
      })
    : [];
  return state;
}

export function buildSavePayload(state, now = new Date()) {
  return {
    saveSchemaVersion: SAVE_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    savedAt: now.toISOString(),
    state: Object.fromEntries(SAVE_KEYS.map((key) => [key, state[key]])),
  };
}

export function migrateSaveSnapshot(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "invalidSave" };
  }
  const version =
    raw.saveSchemaVersion == null ? 1 : Number(raw.saveSchemaVersion);
  if (version !== 1 && version !== SAVE_SCHEMA_VERSION) {
    return { ok: false, code: "unsupportedSaveVersion", version };
  }
  if (
    version === SAVE_SCHEMA_VERSION &&
    Number(raw.engineVersion) > ENGINE_VERSION
  ) {
    return {
      ok: false,
      code: "unsupportedEngineVersion",
      version: Number(raw.engineVersion),
    };
  }
  try {
    const state = normalizeState(version === 1 ? raw : raw.state);
    return {
      ok: true,
      migrated: version !== SAVE_SCHEMA_VERSION,
      value: {
        saveSchemaVersion: SAVE_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        savedAt: String(raw.savedAt || new Date().toISOString()),
        state,
      },
    };
  } catch (error) {
    return { ok: false, code: error.message || "invalidSave" };
  }
}

export function applySaveSnapshot(state, raw, phase) {
  const migration = migrateSaveSnapshot(raw);
  if (!migration.ok) {
    const error = new Error(migration.code);
    error.code = migration.code;
    throw error;
  }
  const save = migration.value.state;
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
  return migration;
}

export function migrateGhostRun(raw) {
  if (!raw) return { ok: true, migrated: false, value: null };
  if (typeof raw !== "object") return { ok: false, code: "invalidGhostRun" };
  const version =
    raw.ghostSchemaVersion == null ? 1 : Number(raw.ghostSchemaVersion);
  if (version !== 1 && version !== GHOST_SCHEMA_VERSION) {
    return { ok: false, code: "unsupportedGhostVersion", version };
  }
  if (!Array.isArray(raw.samples) || !raw.samples.length) {
    return { ok: false, code: "invalidGhostSamples" };
  }
  const samples = raw.samples.slice(-240).map((sample) => ({
    time: safeInteger(sample?.time, 0, 0, 24 * 60 * 60 * 1000),
    score: safeInteger(sample?.score),
    height: safeInteger(sample?.height, 0, 0, ROWS),
    lines: safeInteger(sample?.lines),
  }));
  return {
    ok: true,
    migrated: version !== GHOST_SCHEMA_VERSION,
    value: {
      ghostSchemaVersion: GHOST_SCHEMA_VERSION,
      legacyTimeline: version === 1 || Boolean(raw.legacyTimeline),
      score: safeInteger(raw.score),
      mode: String(raw.mode || "classic").slice(0, 24),
      date: String(raw.date || new Date().toISOString()),
      summary:
        raw.summary && typeof raw.summary === "object" ? raw.summary : {},
      samples,
    },
  };
}
