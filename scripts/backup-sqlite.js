const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const RETENTION = Object.freeze({ daily: 14, weekly: 8, monthly: 6 });

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--all-tiers") options.allTiers = true;
    else if (value.startsWith("--")) options[value.slice(2)] = argv[++index];
  }
  return options;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Backup target escapes backup root: ${target}`);
  }
}

function verifyDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma("quick_check", { simple: true });
    if (result !== "ok")
      throw new Error(`SQLite quick_check failed: ${result}`);
  } finally {
    db.close();
  }
}

async function createVerifiedBackup(sourceFile, destinationFile) {
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true, mode: 0o750 });
  const temporaryFile = `${destinationFile}.tmp-${process.pid}`;
  const source = new Database(sourceFile, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    await source.backup(temporaryFile);
  } finally {
    source.close();
  }
  try {
    verifyDatabase(temporaryFile);
    if (fs.existsSync(destinationFile)) fs.unlinkSync(destinationFile);
    fs.renameSync(temporaryFile, destinationFile);
    fs.chmodSync(destinationFile, 0o600);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
  return destinationFile;
}

function pruneTier(root, tier, keep) {
  const directory = path.join(root, tier);
  if (!fs.existsSync(directory)) return [];
  const files = fs
    .readdirSync(directory)
    .filter((name) => /^blockdrop-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))
    .sort()
    .reverse();
  const removed = [];
  for (const name of files.slice(keep)) {
    const target = path.join(directory, name);
    assertInside(root, target);
    fs.unlinkSync(target);
    removed.push(target);
  }
  return removed;
}

async function runBackup(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const sourceFile = path.resolve(
    options.source ||
      process.env.BLOCKDROP_DB_FILE ||
      path.join(root, "blockdrop.sqlite"),
  );
  const backupRoot = path.resolve(
    options.backupRoot ||
      process.env.BLOCKDROP_BACKUP_DIR ||
      path.join(path.dirname(sourceFile), "backups"),
  );
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`SQLite source does not exist: ${sourceFile}`);
  }
  const now = options.at ? new Date(`${options.at}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Invalid backup date");
  const tiers = ["daily"];
  if (options.allTiers || now.getUTCDay() === 0) tiers.push("weekly");
  if (options.allTiers || now.getUTCDate() === 1) tiers.push("monthly");

  const created = [];
  for (const tier of tiers) {
    const destination = path.join(
      backupRoot,
      tier,
      `blockdrop-${dateKey(now)}.sqlite`,
    );
    assertInside(backupRoot, destination);
    created.push(await createVerifiedBackup(sourceFile, destination));
  }

  const removed = [];
  for (const [tier, keep] of Object.entries(RETENTION)) {
    removed.push(...pruneTier(backupRoot, tier, keep));
  }
  const audit = {
    timestamp: new Date().toISOString(),
    source: sourceFile,
    created,
    removed,
    retention: RETENTION,
    status: "ok",
  };
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o750 });
  fs.appendFileSync(
    path.join(backupRoot, "backup-audit.jsonl"),
    `${JSON.stringify(audit)}\n`,
    { mode: 0o600 },
  );
  return audit;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  runBackup({
    source: args.source,
    backupRoot: args.destination,
    at: args.at,
    allTiers: args.allTiers,
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

module.exports = {
  RETENTION,
  createVerifiedBackup,
  pruneTier,
  runBackup,
  verifyDatabase,
};
