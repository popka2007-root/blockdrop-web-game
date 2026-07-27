const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const Database = require("better-sqlite3");
const { pruneTier, runBackup, verifyDatabase } = require("./backup-sqlite");
const { restoreDatabase } = require("./restore-sqlite");

function createCrashedWalDatabase(file) {
  const code = `
    const Database = require("better-sqlite3");
    const db = new Database(${JSON.stringify(file)});
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE proof(id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO proof VALUES('old', 'before-crash');");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("DELETE FROM proof; INSERT INTO proof VALUES('stale', 'from-wal');");
    console.log("ready");
    setInterval(() => {}, 1000);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", code], {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Crashed-WAL fixture timed out: ${stderr}`));
    }, 5000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("ready")) return;
      clearTimeout(timeout);
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
    child.once("error", reject);
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blockdrop-backup-test-"));
  try {
    const source = path.join(root, "source.sqlite");
    const restored = path.join(root, "restored.sqlite");
    const db = new Database(source);
    db.exec("CREATE TABLE proof(id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO proof(id, value) VALUES(?, ?)").run(id, "verified");
    db.close();

    const backup = await runBackup({
      source,
      backupRoot: path.join(root, "backups"),
      at: "2026-07-20",
      allTiers: true,
    });
    if (backup.created.length !== 3)
      throw new Error("Expected three backup tiers");
    restoreDatabase({ backup: backup.created[0], target: restored });
    verifyDatabase(restored);
    const restoredDb = new Database(restored, {
      readonly: true,
      fileMustExist: true,
    });
    const proof = restoredDb.prepare("SELECT id, value FROM proof").get();
    restoredDb.close();
    if (proof?.id !== id || proof?.value !== "verified") {
      throw new Error("Restored database contents do not match the source");
    }

    const crashedTarget = path.join(root, "crashed-target.sqlite");
    await createCrashedWalDatabase(crashedTarget);
    if (
      !fs.existsSync(`${crashedTarget}-wal`) ||
      !fs.existsSync(`${crashedTarget}-shm`)
    ) {
      throw new Error("Crashed-WAL fixture did not leave SQLite sidecars");
    }
    const crashedRestore = restoreDatabase({
      backup: backup.created[0],
      target: crashedTarget,
      force: true,
    });
    const recoveredDb = new Database(crashedTarget, {
      readonly: true,
      fileMustExist: true,
    });
    const recoveredProof = recoveredDb
      .prepare("SELECT id, value FROM proof")
      .get();
    recoveredDb.close();
    if (recoveredProof?.id !== id || recoveredProof?.value !== "verified") {
      throw new Error("Stale WAL data replaced the restored backup");
    }
    if (crashedRestore.rollbackFiles.length !== 3) {
      throw new Error("Restore did not preserve the previous SQLite file set");
    }

    const retentionRoot = path.join(root, "retention");
    for (const [tier, total, keep] of [
      ["daily", 20, 14],
      ["weekly", 12, 8],
      ["monthly", 9, 6],
    ]) {
      const tierRoot = path.join(retentionRoot, tier);
      fs.mkdirSync(tierRoot, { recursive: true });
      for (let day = 1; day <= total; day += 1) {
        fs.writeFileSync(
          path.join(
            tierRoot,
            `blockdrop-2025-01-${String(day).padStart(2, "0")}.sqlite`,
          ),
          "retention-fixture",
        );
      }
      const removed = pruneTier(retentionRoot, tier, keep);
      if (removed.length !== total - keep) {
        throw new Error(`Unexpected ${tier} retention result`);
      }
      if (fs.readdirSync(tierRoot).length !== keep) {
        throw new Error(`Unexpected ${tier} retained file count`);
      }
    }

    console.log(
      JSON.stringify({
        status: "ok",
        tiers: backup.created.length,
        retention: { daily: 14, weekly: 8, monthly: 6 },
      }),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
