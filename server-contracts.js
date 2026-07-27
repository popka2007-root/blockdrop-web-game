const HTTP_STORE_CONTRACT = Object.freeze([
  "changeAccountPassword",
  "checkReady",
  "createAccount",
  "createDailyRun",
  "getAccountBySession",
  "getFeatureFlag",
  "getHealthCounts",
  "getOrCreateDailySeed",
  "listDailyLeaderboard",
  "listRankedLeaderboard",
  "listRecords",
  "loginAccount",
  "logoutAccount",
  "markDailyRunSubmitted",
  "parseTimeSeconds",
  "publicAccount",
  "saveAnalyticsEvent",
  "saveDailyScore",
  "saveRecord",
  "saveReplay",
  "signPortablePayload",
  "verifyDailyRun",
  "verifyPortablePayload",
]);

const WEBSOCKET_STORE_CONTRACT = Object.freeze([
  "appendMatchInput",
  "createMatchSession",
  "getAccountBySession",
  "getRankedProfile",
  "insertDeployAudit",
  "logRankedEvent",
  "logRankedMatch",
  "normalizeRankedPlayer",
  "pruneExpiredProductData",
  "publicAccount",
  "publicRankedProfile",
  "resolveRankedIdentity",
  "saveReplay",
  "upsertRankedProfile",
]);

const SERVER_STORE_CONTRACT = Object.freeze([
  ...new Set([...HTTP_STORE_CONTRACT, ...WEBSOCKET_STORE_CONTRACT]),
]);

function assertMethods(name, target, methods) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    throw new TypeError(`${name} must be an object`);
  }
  const missing = methods.filter(
    (method) => typeof target[method] !== "function",
  );
  if (missing.length) {
    throw new TypeError(`${name} contract missing: ${missing.join(", ")}`);
  }
}

function assertServerContracts({ store }) {
  assertMethods("store", store, SERVER_STORE_CONTRACT);
  assertMethods("store.db", store.db, ["close", "pragma"]);
}

module.exports = {
  HTTP_STORE_CONTRACT,
  SERVER_STORE_CONTRACT,
  WEBSOCKET_STORE_CONTRACT,
  assertMethods,
  assertServerContracts,
};
