import { describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, makeBoard } from "../js/engine.js";
import {
  GHOST_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSION,
  applySaveSnapshot,
  buildSavePayload,
  migrateGhostRun,
  migrateSaveSnapshot,
} from "../js/save-load.js";
import { createGameStorage } from "../js/storage.js";

function savedState() {
  return {
    board: makeBoard(),
    active: { kind: "T", rotation: 0, x: 3, y: 0 },
    queue: [{ kind: "I" }, { kind: "O" }, { kind: "S" }],
    bag: ["Z", "J", "L"],
    hold: null,
    holdUsed: false,
    mode: "classic",
    difficulty: "normal",
    score: 1200,
    lines: 8,
    level: 1,
    combo: 2,
    sessionHistory: [],
    currentGhostRun: [],
    elapsedMs: 12_000,
    seed: "save-seed",
    randomState: 123456,
  };
}

describe("versioned save data", () => {
  it("writes and restores a versioned save envelope", () => {
    const payload = buildSavePayload(
      savedState(),
      new Date("2026-07-20T00:00:00Z"),
    );
    expect(payload).toMatchObject({
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      savedAt: "2026-07-20T00:00:00.000Z",
    });

    const target = {};
    const result = applySaveSnapshot(target, payload, "playing");
    expect(result.ok).toBe(true);
    expect(target).toMatchObject({
      score: 1200,
      seed: "save-seed",
      randomState: 123456,
      running: true,
      phase: "playing",
    });
  });

  it("migrates the former flat save format", () => {
    const migrated = migrateSaveSnapshot(savedState());
    expect(migrated).toMatchObject({
      ok: true,
      migrated: true,
      value: {
        saveSchemaVersion: SAVE_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
      },
    });
    expect(migrated.value.state.queue).toEqual([
      { kind: "I" },
      { kind: "O" },
      { kind: "S" },
    ]);
  });

  it("rejects unknown versions and corrupt boards without mutating state", () => {
    expect(
      migrateSaveSnapshot({ ...savedState(), saveSchemaVersion: 99 }),
    ).toMatchObject({ ok: false, code: "unsupportedSaveVersion" });
    expect(
      migrateSaveSnapshot({ ...savedState(), board: [["T"]] }),
    ).toMatchObject({ ok: false, code: "invalidBoard" });

    const target = { sentinel: true };
    expect(() =>
      applySaveSnapshot(target, { saveSchemaVersion: 99 }, "playing"),
    ).toThrow();
    expect(target).toEqual({ sentinel: true });
  });

  it("migrates legacy ghost timelines and rejects incompatible versions", () => {
    const result = migrateGhostRun({
      score: 100,
      mode: "classic",
      samples: [{ time: 1000, score: 100, height: 3, lines: 1 }],
    });
    expect(result).toMatchObject({
      ok: true,
      migrated: true,
      value: {
        ghostSchemaVersion: GHOST_SCHEMA_VERSION,
        legacyTimeline: true,
      },
    });
    expect(
      migrateGhostRun({ ghostSchemaVersion: 77, samples: [{}] }),
    ).toMatchObject({ ok: false, code: "unsupportedGhostVersion" });
  });

  it("archives incompatible data and keeps only five recovery entries", () => {
    const bucket = new Map();
    const localStorage = {
      getItem: vi.fn((key) => bucket.get(key) ?? null),
      setItem: vi.fn((key, value) => bucket.set(key, value)),
      removeItem: vi.fn((key) => bucket.delete(key)),
    };
    const keys = { save: "save", saveArchive: "save-archive" };
    const storage = createGameStorage(keys, localStorage);
    storage.saveGame({ active: true });
    for (let index = 0; index < 7; index += 1) {
      storage.archiveSave({ index }, "unsupportedSaveVersion");
    }

    expect(localStorage.removeItem).toHaveBeenCalledWith("save");
    expect(storage.loadSaveArchive()).toHaveLength(5);
    expect(storage.loadSaveArchive()[0]).toMatchObject({
      reason: "unsupportedSaveVersion",
      value: { index: 6 },
    });
  });
});
