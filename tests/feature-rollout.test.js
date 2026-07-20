import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applyRollout } = require("../scripts/feature-rollout.js");
const Database = require("better-sqlite3");
const files = [];

afterEach(() => {
  for (const file of files.splice(0)) {
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        fs.unlinkSync(candidate);
      } catch {
        // already removed
      }
    }
  }
});

describe("feature rollout CLI", () => {
  it("moves casual v2 through a percentage and rolls it back to v1", () => {
    const db = path.join(os.tmpdir(), `rollout-${crypto.randomUUID()}.sqlite`);
    files.push(db);
    expect(applyRollout({ db, flag: "casualV2", stage: "10" })).toMatchObject({
      enabled: true,
      rolloutPercentage: 10,
    });
    expect(applyRollout({ db, flag: "casualV2", rollback: true })).toMatchObject({
      enabled: false,
      rolloutPercentage: 0,
    });
    const database = new Database(db, { readonly: true });
    expect(
      database
        .prepare("SELECT enabled, rollout_percentage FROM feature_flags WHERE key = 'casualV2'")
        .get(),
    ).toEqual({ enabled: 0, rollout_percentage: 0 });
    database.close();
  });

  it("rejects unknown flags and rollout stages", () => {
    expect(() => applyRollout({ flag: "unknown", stage: "10" })).toThrow(
      /Unknown feature flag/,
    );
    expect(() => applyRollout({ flag: "casualV2", stage: "25" })).toThrow(
      /Stage must be/,
    );
  });
});
