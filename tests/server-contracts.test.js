import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HTTP_STORE_CONTRACT,
  SERVER_STORE_CONTRACT,
  assertServerContracts,
} from "../server-contracts.js";
import { createHttpService } from "../server-http.js";
import { createServerStore } from "../server-store.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function createStoreStub(methods = SERVER_STORE_CONTRACT) {
  const store = Object.fromEntries(
    methods.map((method) => [method, () => null]),
  );
  store.db = { close() {}, pragma() {} };
  return store;
}

function createHttpDependencies(store) {
  return {
    root: __dirname,
    store,
    logger: { error() {}, warn() {} },
    metrics: {
      increment() {},
      observe() {},
      render() {
        return "";
      },
      set() {},
    },
    rooms: new Map(),
    rankedQueue: [],
  };
}

describe("server module contracts", () => {
  it("accepts the real SQLite store at the composition root", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "blockdrop-contract-"),
    );
    temporaryDirectories.push(directory);
    const store = createServerStore({
      root: directory,
      dbFile: path.join(directory, "contract.sqlite"),
    });

    expect(() => assertServerContracts({ store })).not.toThrow();
    store.db.close();
  });

  it("reports every missing runtime dependency before the server starts", () => {
    const store = createStoreStub();
    delete store.pruneExpiredProductData;
    delete store.upsertRankedProfile;

    expect(() => assertServerContracts({ store })).toThrow(
      "store contract missing: pruneExpiredProductData, upsertRankedProfile",
    );
  });

  it("guards the HTTP module boundary independently", () => {
    const store = createStoreStub(HTTP_STORE_CONTRACT);
    delete store.verifyDailyRun;

    expect(() => createHttpService(createHttpDependencies(store))).toThrow(
      "store contract missing: verifyDailyRun",
    );
  });
});
