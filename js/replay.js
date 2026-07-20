import {
  ACTIONS,
  ENGINE_VERSION,
  REPLAY_VERSION,
  TICK_RATE,
  advanceReplayState,
  checksum,
  createState,
  restoreSnapshot,
  simulateReplay,
  snapshot,
} from "./engine.js";

const MAX_REPLAY_TICKS = TICK_RATE * 60 * 60;
const SPEEDS = Object.freeze([0.5, 1, 2, 4]);

function safeTick(value) {
  return Math.max(
    0,
    Math.min(MAX_REPLAY_TICKS, Math.floor(Number(value) || 0)),
  );
}

function normalizeInputs(value) {
  if (!Array.isArray(value) || value.length > 100_000) {
    throw new Error("corruptInputStream");
  }
  return value.map((input) => {
    const action = String(input?.action || "");
    if (!ACTIONS.includes(action)) throw new Error("corruptInputStream");
    return {
      tick: safeTick(input.tick),
      seq: Math.max(0, Math.floor(Number(input.seq) || 0)),
      action,
      pressed: input.pressed !== false,
    };
  });
}

function normalizeExternalEvents(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error("corruptInputStream");
  }
  return value.map((event) => {
    if (event?.type !== "garbage") throw new Error("corruptInputStream");
    const lines = Math.max(
      1,
      Math.min(40, Math.floor(Number(event.lines) || 0)),
    );
    return { tick: safeTick(event.tick), type: "garbage", lines };
  });
}

function normalizeCheckpoints(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((checkpoint) => {
    const restored = restoreSnapshot(checkpoint?.snapshot);
    const expected = String(checkpoint?.checksum || "");
    if (expected && checksum(restored) !== expected) {
      throw new Error("corruptCheckpoint");
    }
    return {
      tick: safeTick(checkpoint.tick),
      processedCurrentTick: Boolean(checkpoint.processedCurrentTick),
      snapshot: restored,
      checksum: expected || checksum(restored),
    };
  });
}

export function validateReplay(raw, { verifyChecksum = true } = {}) {
  if (
    !raw ||
    Number(raw.replayVersion) !== REPLAY_VERSION ||
    Number(raw.engineVersion) !== ENGINE_VERSION
  ) {
    return { ok: false, code: "incompatibleReplay" };
  }
  try {
    const replay = {
      replayVersion: REPLAY_VERSION,
      engineVersion: ENGINE_VERSION,
      seed: String(raw.seed || "blockdrop").slice(0, 128),
      mode: String(raw.mode || "classic").slice(0, 24),
      createdAt: String(raw.createdAt || new Date().toISOString()),
      inputs: normalizeInputs(raw.inputs),
      externalEvents: normalizeExternalEvents(raw.externalEvents),
      checkpoints: normalizeCheckpoints(raw.checkpoints),
      finalTick: safeTick(raw.finalTick),
      finalChecksum: String(raw.finalChecksum || "").slice(0, 64),
      metadata:
        raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
    };
    if (verifyChecksum) {
      const verified = simulateReplay(replay, MAX_REPLAY_TICKS);
      if (!verified.ok) return { ok: false, code: verified.code, replay };
    }
    return { ok: true, code: "ok", replay };
  } catch (error) {
    return { ok: false, code: error.message || "corruptReplay" };
  }
}

function streamByTick(stream) {
  const result = new Map();
  for (const item of stream) {
    const list = result.get(item.tick) || [];
    list.push(item);
    result.set(item.tick, list);
  }
  return result;
}

export function createReplayPlayer(raw) {
  const validation = validateReplay(raw);
  if (!validation.ok) {
    const error = new Error(validation.code);
    error.code = validation.code;
    throw error;
  }
  const replay = validation.replay;
  const inputsByTick = streamByTick(replay.inputs);
  const eventsByTick = streamByTick(replay.externalEvents);
  let state = createState({ seed: replay.seed, mode: replay.mode });
  let currentTickProcessed = false;
  let paused = false;
  let speed = 1;
  let accumulator = 0;

  function seek(targetTick) {
    const target = Math.min(replay.finalTick, safeTick(targetTick));
    const checkpoint = [...replay.checkpoints]
      .filter((entry) => entry.tick <= target)
      .sort((left, right) => right.tick - left.tick)[0];
    if (checkpoint) {
      state = restoreSnapshot(checkpoint.snapshot);
      currentTickProcessed = checkpoint.processedCurrentTick;
    } else {
      state = createState({ seed: replay.seed, mode: replay.mode });
      currentTickProcessed = false;
    }
    advanceReplayState(
      state,
      inputsByTick,
      target,
      eventsByTick,
      !currentTickProcessed,
    );
    currentTickProcessed = true;
    accumulator = 0;
    return snapshot(state);
  }

  function advance(deltaMs) {
    if (paused || state.gameOver || state.tick >= replay.finalTick) {
      return { state: snapshot(state), complete: isComplete() };
    }
    accumulator += Math.max(0, Number(deltaMs) || 0) * speed;
    const tickMs = 1000 / TICK_RATE;
    const ticks = Math.floor(accumulator / tickMs);
    if (ticks > 0) {
      accumulator -= ticks * tickMs;
      advanceReplayState(
        state,
        inputsByTick,
        Math.min(replay.finalTick, state.tick + ticks),
        eventsByTick,
        !currentTickProcessed,
      );
      currentTickProcessed = true;
    }
    return { state: snapshot(state), complete: isComplete() };
  }

  function isComplete() {
    return state.gameOver || state.tick >= replay.finalTick;
  }

  function verification() {
    const actual = checksum(snapshot(state));
    return {
      ok: isComplete() && actual === replay.finalChecksum,
      expected: replay.finalChecksum,
      actual,
    };
  }

  return {
    replay,
    get state() {
      return snapshot(state);
    },
    get paused() {
      return paused;
    },
    get speed() {
      return speed;
    },
    advance,
    isComplete,
    pause() {
      paused = true;
    },
    play() {
      paused = false;
    },
    seek,
    setSpeed(value) {
      const next = Number(value);
      speed = SPEEDS.includes(next) ? next : 1;
      return speed;
    },
    verification,
  };
}

export { SPEEDS };
