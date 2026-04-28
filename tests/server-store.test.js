import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.js";

const tempPaths = new Set();
const openStores = new Set();

afterEach(() => {
  for (const store of openStores) {
    try {
      store.db.close();
    } catch {
      // ignore close errors
    }
  }
  openStores.clear();
  for (const file of tempPaths) {
    try {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
    } catch {
      // ignore temp cleanup failures
    }
  }
  tempPaths.clear();
});

function makeTempDbFile() {
  const file = path.join(
    os.tmpdir(),
    `blockdrop-test-${crypto.randomUUID()}.sqlite`,
  );
  tempPaths.add(file);
  return file;
}

function createTempStore() {
  const store = createServerStore({ dbFile: makeTempDbFile() });
  openStores.add(store);
  return store;
}

describe("server store", () => {
  it("creates accounts, sessions, and account-backed ranked identities", () => {
    const store = createTempStore();
    const created = store.createAccount({
      username: "Alpha_User",
      password: "password123",
      displayName: "Alpha",
    });

    expect(created.ok).toBe(true);
    expect(created.account.username).toBe("alpha_user");
    expect(created.token).toBeTruthy();
    expect(store.publicAccount(store.getAccountBySession(created.token))).toEqual({
      id: created.account.id,
      username: "alpha_user",
      displayName: "Alpha",
    });

    expect(
      store.loginAccount({ username: "alpha_user", password: "wrongpass" }),
    ).toMatchObject({ ok: false, code: "invalidCredentials" });

    const identity = store.resolveRankedIdentity({
      playerId: "local-id",
      name: "Ignored",
      account: created.account,
    });
    expect(identity.accepted).toBe(true);
    expect(identity.profile.id).toBe(`acct.${created.account.id}`);
    expect(identity.profile.name).toBe("Alpha");
  });

  it("creates stable ranked identities and rejects invalid tokens", () => {
    const store = createTempStore();
    const first = store.resolveRankedIdentity({
      playerId: "ranked-player",
      name: "Alpha",
    });

    expect(first.accepted).toBe(true);
    expect(first.identityToken).toMatch(/^v1\./);

    const again = store.resolveRankedIdentity({
      playerId: "ranked-player",
      name: "Alpha",
      identityToken: first.identityToken,
    });
    expect(again.accepted).toBe(true);
    expect(again.profile.rating).toBe(1000);

    const rejected = store.resolveRankedIdentity({
      playerId: "ranked-player",
      name: "Alpha",
      identityToken: "v1.rank.fake",
    });
    expect(rejected).toMatchObject({
      accepted: false,
      code: "identityMismatch",
    });
  });

  it("keeps one server daily seed per day and stores only the best run per player", () => {
    const store = createTempStore();
    const seedA = store.getOrCreateDailySeed("2026-04-28");
    const seedB = store.getOrCreateDailySeed("2026-04-28");
    const seedC = store.getOrCreateDailySeed("2026-04-29");

    expect(seedA).toBe(seedB);
    expect(seedC).not.toBe(seedA);

    store.saveDailyScore({
      dateKey: "2026-04-28",
      playerId: "p1",
      name: "Alpha",
      score: 1200,
      lines: 12,
      level: 4,
      timeMs: 90000,
    });
    store.saveDailyScore({
      dateKey: "2026-04-28",
      playerId: "p1",
      name: "Alpha",
      score: 800,
      lines: 10,
      level: 3,
      timeMs: 95000,
    });
    store.saveDailyScore({
      dateKey: "2026-04-28",
      playerId: "p2",
      name: "Bravo",
      score: 1300,
      lines: 11,
      level: 4,
      timeMs: 85000,
    });

    expect(store.listDailyLeaderboard("2026-04-28")).toEqual([
      expect.objectContaining({ playerId: "p2", score: 1300 }),
      expect.objectContaining({ playerId: "p1", score: 1200 }),
    ]);
  });

  it("creates signed daily runs and rejects reused or bad signatures", () => {
    const store = createTempStore();
    const run = store.createDailyRun({
      dateKey: "2026-04-28",
      playerId: "p1",
    });

    expect(run.token).toBeTruthy();
    expect(run.signature).toBeTruthy();
    expect(
      store.verifyDailyRun({
        token: run.token,
        signature: run.signature,
        dateKey: "2026-04-28",
      }),
    ).toMatchObject({ ok: true });
    expect(
      store.verifyDailyRun({
        token: run.token,
        signature: "bad",
        dateKey: "2026-04-28",
      }),
    ).toMatchObject({ ok: false, code: "badSignature" });
    store.markDailyRunSubmitted(run.token);
    expect(
      store.verifyDailyRun({
        token: run.token,
        signature: run.signature,
        dateKey: "2026-04-28",
      }),
    ).toMatchObject({ ok: false, code: "usedRun" });
  });
});
