const path = require("path");
const { createServerStore } = require("../server-store");

const ALLOWED_FLAGS = new Set([
  "casualV2",
  "accounts",
  "ranked",
  "analytics",
  "pwaInstall",
]);
const STAGES = Object.freeze({ internal: 0, 10: 10, 50: 50, 100: 100 });

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rollback") options.rollback = true;
    else if (argument.startsWith("--"))
      options[argument.slice(2)] = argv[++index];
  }
  return options;
}

function applyRollout(options = {}) {
  const key = String(options.flag || "");
  if (!ALLOWED_FLAGS.has(key)) {
    throw new Error(`Unknown feature flag: ${key || "missing"}`);
  }
  const databaseFile = path.resolve(
    options.db || process.env.BLOCKDROP_DB_FILE || "blockdrop.sqlite",
  );
  const stage = options.rollback ? "internal" : String(options.stage || "");
  if (!(stage in STAGES)) {
    throw new Error("Stage must be internal, 10, 50, or 100");
  }
  const store = createServerStore({ dbFile: databaseFile });
  try {
    const existing = store.getFeatureFlag(key);
    const secureTransportRequired = [
      "accounts",
      "ranked",
      "pwaInstall",
    ].includes(key);
    return store.upsertFeatureFlag({
      key,
      enabled: options.rollback ? false : stage !== "internal",
      rolloutPercentage: STAGES[stage],
      secureTransportRequired:
        existing?.secureTransportRequired ?? secureTransportRequired,
    });
  } finally {
    store.db.close();
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(applyRollout(parseArgs(process.argv.slice(2)))));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { ALLOWED_FLAGS, STAGES, applyRollout, parseArgs };
