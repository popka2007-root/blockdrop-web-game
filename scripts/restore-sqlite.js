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

function syncDirectory(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(path.dirname(file), "r");
    fs.fsyncSync(descriptor);
  } catch {
    // Directory fsync is not supported on every platform (notably Windows).
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
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
  const targetArtifacts = [targetFile, `${targetFile}-wal`, `${targetFile}-shm`];
  const existingArtifacts = targetArtifacts.filter((file) => fs.existsSync(file));
  if (existingArtifacts.length && !force) {
    throw new Error(`Restore target already exists: ${existingArtifacts[0]}`);
  }
  verifyDatabase(backupFile);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true, mode: 0o750 });
  const temporaryFile = `${targetFile}.restore-${process.pid}`;
  const rollbackSuffix = `.before-restore-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const displaced = [];
  try {
    fs.copyFileSync(backupFile, temporaryFile);
    verifyDatabase(temporaryFile);
    try {
      for (const file of existingArtifacts) {
        const rollbackFile = `${file}${rollbackSuffix}`;
        fs.renameSync(file, rollbackFile);
        displaced.push({ file, rollbackFile });
      }
      fs.renameSync(temporaryFile, targetFile);
      fs.chmodSync(targetFile, 0o600);
      syncDirectory(targetFile);
      verifyDatabase(targetFile);
    } catch (error) {
      if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
      for (const entry of [...displaced].reverse()) {
        if (fs.existsSync(entry.rollbackFile)) {
          fs.renameSync(entry.rollbackFile, entry.file);
        }
      }
      syncDirectory(targetFile);
      throw error;
    }
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
  return {
    backup: backupFile,
    target: targetFile,
    rollbackFiles: displaced.map((entry) => entry.rollbackFile),
    status: "ok",
  };
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
