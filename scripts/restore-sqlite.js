const fs = require("fs");
const path = require("path");
const { verifyDatabase } = require("./backup-sqlite");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") options.force = true;
    else if (value === "--allow-live-target") options.allowLiveTarget = true;
    else if (value.startsWith("--")) options[value.slice(2)] = argv[++index];
  }
  return options;
}

function restoreDatabase({
  backup,
  target,
  force = false,
  allowLiveTarget = false,
}) {
  if (!backup || !target) throw new Error("--backup and --target are required");
  const backupFile = path.resolve(backup);
  const targetFile = path.resolve(target);
  const liveFile = process.env.BLOCKDROP_DB_FILE
    ? path.resolve(process.env.BLOCKDROP_DB_FILE)
    : "";
  if (liveFile && targetFile === liveFile && !allowLiveTarget) {
    throw new Error(
      "Refusing to overwrite the live database without --allow-live-target",
    );
  }
  if (fs.existsSync(targetFile) && !force) {
    throw new Error(`Restore target already exists: ${targetFile}`);
  }
  verifyDatabase(backupFile);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true, mode: 0o750 });
  const temporaryFile = `${targetFile}.restore-${process.pid}`;
  try {
    fs.copyFileSync(backupFile, temporaryFile);
    verifyDatabase(temporaryFile);
    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
    fs.renameSync(temporaryFile, targetFile);
    fs.chmodSync(targetFile, 0o600);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
  verifyDatabase(targetFile);
  return { backup: backupFile, target: targetFile, status: "ok" };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = restoreDatabase({
      backup: args.backup,
      target: args.target,
      force: args.force,
      allowLiveTarget: args.allowLiveTarget,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { restoreDatabase };
