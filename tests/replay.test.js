import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createReplayPlayer, validateReplay } from "../js/replay.js";

const require = createRequire(import.meta.url);
const engine = require("../shared/engine.js");

function createRecordedGame() {
  const state = engine.createState({ seed: "recorded-game" });
  const inputs = [];
  const externalEvents = [];
  let seq = 0;
  for (let piece = 0; piece < 18 && !state.gameOver; piece += 1) {
    if (piece === 5) {
      engine.queueGarbage(state, 2);
      externalEvents.push({ tick: state.tick, type: "garbage", lines: 2 });
    }
    const input = {
      tick: state.tick,
      seq: ++seq,
      action: "hardDrop",
      pressed: true,
    };
    inputs.push(input);
    engine.applyInput(state, input, []);
    for (let tick = 0; tick < 5 && !state.gameOver; tick += 1) {
      engine.step(state);
    }
  }
  return {
    replay: engine.createReplay({
      seed: state.seed,
      mode: state.mode,
      inputs,
      externalEvents,
      finalState: state,
      checkpointIntervalTicks: 3,
    }),
    finalState: state,
  };
}

describe("versioned replay playback", () => {
  it("reproduces external garbage and the final checksum", () => {
    const { replay } = createRecordedGame();
    const result = engine.simulateReplay(replay);

    expect(result.ok).toBe(true);
    expect(result.finalChecksum).toBe(replay.finalChecksum);
    expect(replay.externalEvents).toHaveLength(1);
    expect(replay.checkpoints.length).toBeGreaterThan(1);
  });

  it("supports pause, speeds, checkpoint seeking, and completion", () => {
    const { replay } = createRecordedGame();
    const player = createReplayPlayer(replay);
    player.setSpeed(4);
    player.pause();
    const pausedTick = player.state.tick;
    player.advance(1000);
    expect(player.state.tick).toBe(pausedTick);

    player.play();
    player.seek(Math.floor(replay.finalTick / 2));
    expect(player.state.tick).toBe(Math.floor(replay.finalTick / 2));
    player.seek(replay.finalTick);
    expect(player.isComplete()).toBe(true);
    expect(player.verification()).toMatchObject({ ok: true });
  });

  it("marks incompatible and checksum-mismatched files without applying them", () => {
    const { replay } = createRecordedGame();
    expect(
      validateReplay({ ...replay, engineVersion: replay.engineVersion + 1 }),
    ).toMatchObject({ ok: false, code: "incompatibleReplay" });
    expect(
      validateReplay({ ...replay, finalChecksum: "00000000" }),
    ).toMatchObject({ ok: false, code: "checksumMismatch" });
    expect(
      validateReplay({
        ...replay,
        inputs: [{ tick: 0, seq: 1, action: "teleport" }],
      }),
    ).toMatchObject({ ok: false, code: "corruptInputStream" });
  });
});
