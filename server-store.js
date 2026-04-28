const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const {
  cleanUsername,
  cleanDisplayName,
  normalizeSessionToken,
  validateCredentials,
  hashPassword,
  verifyPassword,
  createSessionToken,
} = require("./server-auth");

const MAX_RECORDS = 50;
const RANKED_START_RATING = 1000;
const RANKED_MIN_RATING = 100;
const RANKED_MAX_RATING = 3000;

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampSigned(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function cleanName(value) {
  return (
    String(value || "Player")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 18) || "Player"
  );
}

function cleanPlayerId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 64);
}

function defaultRankedPlayer(id, name = "Player") {
  return {
    id,
    name: cleanName(name),
    rating: RANKED_START_RATING,
    wins: 0,
    losses: 0,
    streak: 0,
    bestWinStreak: 0,
    bestLossStreak: 0,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

function normalizeRankedPlayer(record, id, name = "Player") {
  const fallback = defaultRankedPlayer(id, name);
  const streak = clampSigned(record?.streak, -999, 999);
  return {
    ...fallback,
    ...record,
    id,
    name: cleanName(name || record?.name || fallback.name),
    rating: clamp(
      safeNumber(record?.rating) || RANKED_START_RATING,
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    ),
    wins: clamp(safeNumber(record?.wins), 0, 999999),
    losses: clamp(safeNumber(record?.losses), 0, 999999),
    streak,
    bestWinStreak: clamp(safeNumber(record?.bestWinStreak), 0, 999999),
    bestLossStreak: clamp(safeNumber(record?.bestLossStreak), 0, 999999),
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    identitySecret: String(record?.identitySecret || ""),
  };
}

function parseTimeSeconds(value) {
  const [minutes, seconds] = String(value)
    .split(":")
    .map((part) => Number(part));
  return (
    (Number.isFinite(minutes) ? minutes : 0) * 60 +
    (Number.isFinite(seconds) ? seconds : 0)
  );
}

function compareRecords(a, b) {
  return b.score - a.score || b.lines - a.lines || a.date.localeCompare(b.date);
}

function compareDailyEntries(a, b) {
  return (
    b.score - a.score ||
    b.lines - a.lines ||
    a.timeMs - b.timeMs ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createServerStore({
  root = __dirname,
  dbFile = path.join(root, "blockdrop.sqlite"),
  recordsFile = path.join(root, "records.json"),
  rankedFile = path.join(root, "ranked.json"),
} = {}) {
  const db = new Database(dbFile);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      level INTEGER NOT NULL,
      mode TEXT NOT NULL,
      time TEXT NOT NULL,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ranked_players (
      player_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      streak INTEGER NOT NULL,
      best_win_streak INTEGER NOT NULL,
      best_loss_streak INTEGER NOT NULL,
      identity_secret TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ranked_matches (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      series_id TEXT NOT NULL,
      match_index INTEGER NOT NULL,
      mode TEXT NOT NULL,
      reason TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      winner_player_id TEXT NOT NULL,
      loser_player_id TEXT NOT NULL,
      winner_name TEXT NOT NULL,
      loser_name TEXT NOT NULL,
      winner_rating_before INTEGER NOT NULL,
      winner_rating_after INTEGER NOT NULL,
      loser_rating_before INTEGER NOT NULL,
      loser_rating_after INTEGER NOT NULL,
      winner_score INTEGER NOT NULL,
      loser_score INTEGER NOT NULL,
      winner_lines INTEGER NOT NULL,
      loser_lines INTEGER NOT NULL,
      winner_sent_garbage INTEGER NOT NULL,
      loser_sent_garbage INTEGER NOT NULL,
      winner_received_garbage INTEGER NOT NULL,
      loser_received_garbage INTEGER NOT NULL,
      winner_time TEXT NOT NULL,
      loser_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ranked_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      lines INTEGER NOT NULL,
      attack_lines INTEGER NOT NULL,
      combo INTEGER NOT NULL,
      score INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_seeds (
      date_key TEXT PRIMARY KEY,
      seed TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_runs (
      token TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      seed TEXT NOT NULL,
      player_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      submitted_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_key TEXT NOT NULL,
      player_id TEXT NOT NULL,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      lines INTEGER NOT NULL,
      level INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(date_key, player_id)
    );
    CREATE TABLE IF NOT EXISTS deploy_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision TEXT NOT NULL,
      version TEXT NOT NULL,
      pid INTEGER NOT NULL,
      reason TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
  `);

  const getMetaStmt = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMetaStmt = db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS total FROM records");
  const countRankedStmt = db.prepare(
    "SELECT COUNT(*) AS total FROM ranked_players",
  );
  const countAccountsStmt = db.prepare("SELECT COUNT(*) AS total FROM accounts");
  const countDailyStmt = db.prepare(
    "SELECT COUNT(*) AS total FROM daily_scores WHERE date_key = ?",
  );
  const countRankedMatchesStmt = db.prepare(
    "SELECT COUNT(*) AS total FROM ranked_matches",
  );
  const countRankedEventsStmt = db.prepare(
    "SELECT COUNT(*) AS total FROM ranked_events",
  );
  const countDailyRunsStmt = db.prepare(
    "SELECT COUNT(*) AS total FROM daily_runs WHERE date_key = ?",
  );
  const listRecordsStmt = db.prepare(`
    SELECT name, score, lines, level, mode, time, date
    FROM records
    ORDER BY score DESC, lines DESC, date ASC
    LIMIT ?
  `);
  const deleteRecordsStmt = db.prepare("DELETE FROM records");
  const insertRecordStmt = db.prepare(`
    INSERT INTO records(name, score, lines, level, mode, time, date)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `);
  const getRankedStmt = db.prepare(`
    SELECT
      player_id AS playerId,
      name,
      rating,
      wins,
      losses,
      streak,
      best_win_streak AS bestWinStreak,
      best_loss_streak AS bestLossStreak,
      identity_secret AS identitySecret,
      updated_at AS updatedAt,
      last_seen_at AS lastSeenAt
    FROM ranked_players
    WHERE player_id = ?
  `);
  const listRankedStmt = db.prepare(`
    SELECT
      player_id AS playerId,
      name,
      rating,
      wins,
      losses,
      streak,
      best_win_streak AS bestWinStreak,
      best_loss_streak AS bestLossStreak
    FROM ranked_players
    ORDER BY rating DESC, wins DESC, losses ASC, updated_at ASC
    LIMIT ?
  `);
  const upsertRankedStmt = db.prepare(`
    INSERT INTO ranked_players(
      player_id,
      name,
      rating,
      wins,
      losses,
      streak,
      best_win_streak,
      best_loss_streak,
      identity_secret,
      updated_at,
      last_seen_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id) DO UPDATE SET
      name = excluded.name,
      rating = excluded.rating,
      wins = excluded.wins,
      losses = excluded.losses,
      streak = excluded.streak,
      best_win_streak = excluded.best_win_streak,
      best_loss_streak = excluded.best_loss_streak,
      identity_secret = excluded.identity_secret,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
  `);
  const getAccountByUsernameStmt = db.prepare(`
    SELECT
      id,
      username,
      display_name AS displayName,
      password_hash AS passwordHash,
      created_at AS createdAt,
      last_login_at AS lastLoginAt
    FROM accounts
    WHERE username = ?
  `);
  const getAccountByIdStmt = db.prepare(`
    SELECT
      id,
      username,
      display_name AS displayName,
      created_at AS createdAt,
      last_login_at AS lastLoginAt
    FROM accounts
    WHERE id = ?
  `);
  const insertAccountStmt = db.prepare(`
    INSERT INTO accounts(id, username, display_name, password_hash, created_at, last_login_at)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  const touchAccountLoginStmt = db.prepare(
    "UPDATE accounts SET last_login_at = ? WHERE id = ?",
  );
  const updateAccountPasswordStmt = db.prepare(
    "UPDATE accounts SET password_hash = ?, last_login_at = ? WHERE id = ?",
  );
  const insertSessionStmt = db.prepare(`
    INSERT INTO account_sessions(token, account_id, created_at, last_seen_at)
    VALUES(?, ?, ?, ?)
  `);
  const getSessionStmt = db.prepare(`
    SELECT
      sessions.token,
      sessions.account_id AS accountId,
      accounts.id,
      accounts.username,
      accounts.display_name AS displayName,
      accounts.created_at AS createdAt,
      accounts.last_login_at AS lastLoginAt
    FROM account_sessions sessions
    JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token = ?
  `);
  const touchSessionStmt = db.prepare(
    "UPDATE account_sessions SET last_seen_at = ? WHERE token = ?",
  );
  const deleteSessionStmt = db.prepare(
    "DELETE FROM account_sessions WHERE token = ?",
  );
  const insertMatchStmt = db.prepare(`
    INSERT OR REPLACE INTO ranked_matches(
      id,
      room_id,
      series_id,
      match_index,
      mode,
      reason,
      started_at,
      finished_at,
      winner_player_id,
      loser_player_id,
      winner_name,
      loser_name,
      winner_rating_before,
      winner_rating_after,
      loser_rating_before,
      loser_rating_after,
      winner_score,
      loser_score,
      winner_lines,
      loser_lines,
      winner_sent_garbage,
      loser_sent_garbage,
      winner_received_garbage,
      loser_received_garbage,
      winner_time,
      loser_time,
      created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRankedEventStmt = db.prepare(`
    INSERT INTO ranked_events(
      match_id,
      room_id,
      player_id,
      event_type,
      lines,
      attack_lines,
      combo,
      score,
      elapsed_ms,
      created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getDailySeedStmt = db.prepare(
    "SELECT seed FROM daily_seeds WHERE date_key = ?",
  );
  const insertDailySeedStmt = db.prepare(
    "INSERT OR IGNORE INTO daily_seeds(date_key, seed, created_at) VALUES(?, ?, ?)",
  );
  const insertDailyRunStmt = db.prepare(`
    INSERT INTO daily_runs(token, date_key, seed, player_id, account_id, started_at, expires_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `);
  const getDailyRunStmt = db.prepare(`
    SELECT
      token,
      date_key AS dateKey,
      seed,
      player_id AS playerId,
      account_id AS accountId,
      started_at AS startedAt,
      expires_at AS expiresAt,
      submitted_at AS submittedAt
    FROM daily_runs
    WHERE token = ?
  `);
  const markDailyRunSubmittedStmt = db.prepare(
    "UPDATE daily_runs SET submitted_at = ? WHERE token = ? AND submitted_at = 0",
  );
  const getDailyScoreStmt = db.prepare(`
    SELECT
      date_key AS dateKey,
      player_id AS playerId,
      name,
      score,
      lines,
      level,
      time_ms AS timeMs,
      created_at AS createdAt
    FROM daily_scores
    WHERE date_key = ? AND player_id = ?
  `);
  const upsertDailyScoreStmt = db.prepare(`
    INSERT INTO daily_scores(date_key, player_id, name, score, lines, level, time_ms, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_key, player_id) DO UPDATE SET
      name = excluded.name,
      score = excluded.score,
      lines = excluded.lines,
      level = excluded.level,
      time_ms = excluded.time_ms,
      created_at = excluded.created_at
  `);
  const listDailyScoresStmt = db.prepare(`
    SELECT
      date_key AS dateKey,
      player_id AS playerId,
      name,
      score,
      lines,
      level,
      time_ms AS timeMs,
      created_at AS createdAt
    FROM daily_scores
    WHERE date_key = ?
    ORDER BY score DESC, lines DESC, time_ms ASC, created_at ASC
    LIMIT ?
  `);
  const insertDeployAuditStmt = db.prepare(`
    INSERT INTO deploy_audit(revision, version, pid, reason, started_at)
    VALUES(?, ?, ?, ?, ?)
  `);

  function getOrCreateMeta(key, createValue) {
    const existing = getMetaStmt.get(key);
    if (existing?.value) return String(existing.value);
    const value = String(
      typeof createValue === "function" ? createValue() : createValue,
    );
    setMetaStmt.run(key, value);
    return value;
  }

  const identitySigningKey = getOrCreateMeta(
    "identity-signing-key",
    () => crypto.randomBytes(32).toString("hex"),
  );

  function migrateLegacyFiles() {
    const hasRecords = Number(countStmt.get()?.total || 0) > 0;
    if (!hasRecords) {
      try {
        const raw = JSON.parse(fs.readFileSync(recordsFile, "utf8"));
        if (Array.isArray(raw) && raw.length) {
          saveRecordsSnapshot(
            raw.slice(0, MAX_RECORDS).map((record) => ({
              name: cleanName(record.name),
              score: clamp(safeNumber(record.score), 0, 99999999),
              lines: clamp(safeNumber(record.lines), 0, 9999),
              level: clamp(safeNumber(record.level), 1, 99),
              mode: String(record.mode || "Classic").slice(0, 24),
              time: String(record.time || "0:00").slice(0, 12),
              date: record.date || new Date().toISOString(),
            })),
          );
        }
      } catch {
        // no legacy records to migrate
      }
    }

    const hasRanked = Number(countRankedStmt.get()?.total || 0) > 0;
    if (!hasRanked) {
      try {
        const raw = JSON.parse(fs.readFileSync(rankedFile, "utf8"));
        const players = raw?.players && typeof raw.players === "object"
          ? raw.players
          : {};
        for (const [playerId, record] of Object.entries(players)) {
          const safeId = cleanPlayerId(playerId);
          if (!safeId) continue;
          const profile = normalizeRankedPlayer(record, safeId, record?.name);
          upsertRankedProfile({
            ...profile,
            identitySecret: "",
          });
        }
      } catch {
        // no legacy ranked data to migrate
      }
    }
  }

  function signIdentityToken(playerId, identitySecret) {
    const safeId = cleanPlayerId(playerId);
    const payload = `${safeId}.${identitySecret}`;
    const signature = crypto
      .createHmac("sha256", identitySigningKey)
      .update(payload)
      .digest();
    return `v1.${safeId}.${toBase64Url(signature)}`;
  }

  function verifyIdentityToken(playerId, token, identitySecret) {
    if (!token || !identitySecret) return false;
    const expected = signIdentityToken(playerId, identitySecret);
    return timingSafeEqualText(expected, token);
  }

  function publicRankedProfile(profile, includeIdentityToken = true) {
    if (!profile) return null;
    const payload = {
      playerId: profile.id,
      name: profile.name,
      rating: profile.rating,
      wins: profile.wins,
      losses: profile.losses,
      streak: profile.streak,
      bestWinStreak: profile.bestWinStreak,
      bestLossStreak: profile.bestLossStreak,
    };
    if (includeIdentityToken) {
      payload.identityToken = signIdentityToken(
        profile.id,
        profile.identitySecret,
      );
    }
    return payload;
  }

  function getRankedProfile(playerId, name = "Player") {
    const safeId = cleanPlayerId(playerId);
    if (!safeId) return null;
    const row = getRankedStmt.get(safeId);
    if (!row) return null;
    return normalizeRankedPlayer(row, safeId, name || row.name);
  }

  function listRankedLeaderboard(limit = 20) {
    return listRankedStmt
      .all(clamp(safeNumber(limit) || 20, 1, 100))
      .map((row) => ({
        ...row,
        rating: Number(row.rating),
        wins: Number(row.wins),
        losses: Number(row.losses),
        streak: Number(row.streak),
        bestWinStreak: Number(row.bestWinStreak),
        bestLossStreak: Number(row.bestLossStreak),
      }));
  }

  function upsertRankedProfile(profile) {
    const normalized = normalizeRankedPlayer(
      profile,
      profile.id || profile.playerId,
      profile.name,
    );
    upsertRankedStmt.run(
      normalized.id,
      normalized.name,
      normalized.rating,
      normalized.wins,
      normalized.losses,
      normalized.streak,
      normalized.bestWinStreak,
      normalized.bestLossStreak,
      String(profile.identitySecret || normalized.identitySecret || ""),
      normalized.updatedAt,
      normalized.lastSeenAt,
    );
    return {
      ...normalized,
      identitySecret: String(profile.identitySecret || normalized.identitySecret || ""),
    };
  }

  function resolveRankedIdentity({
    playerId,
    name = "Player",
    identityToken = "",
    account = null,
  }) {
    const accountId = account?.id ? `acct.${cleanPlayerId(account.id)}` : "";
    const safeId = accountId || cleanPlayerId(playerId);
    if (!safeId) {
      return { accepted: false, code: "missingPlayerId" };
    }
    const profileName = account?.displayName || name;

    const existing = getRankedProfile(safeId, profileName);
    if (!existing) {
      const created = upsertRankedProfile({
        ...defaultRankedPlayer(safeId, profileName),
        id: safeId,
        identitySecret: crypto.randomBytes(24).toString("hex"),
      });
      return {
        accepted: true,
        created: true,
        profile: created,
        identityToken: signIdentityToken(safeId, created.identitySecret),
      };
    }

    const secret = String(existing.identitySecret || "");
    if (accountId) {
      const refreshed = upsertRankedProfile({
        ...existing,
        id: safeId,
        name: profileName,
        identitySecret: secret || crypto.randomBytes(24).toString("hex"),
      });
      return {
        accepted: true,
        created: false,
        profile: refreshed,
        identityToken: signIdentityToken(safeId, refreshed.identitySecret),
      };
    }
    if (!secret) {
      const migrated = upsertRankedProfile({
        ...existing,
        id: safeId,
        name: profileName,
        identitySecret: crypto.randomBytes(24).toString("hex"),
      });
      return {
        accepted: true,
        created: false,
        migrated: true,
        profile: migrated,
        identityToken: signIdentityToken(safeId, migrated.identitySecret),
      };
    }

    if (!verifyIdentityToken(safeId, identityToken, secret)) {
      return { accepted: false, code: "identityMismatch" };
    }

    const refreshed = upsertRankedProfile({
      ...existing,
      id: safeId,
      name: profileName,
      identitySecret: secret,
    });
    return {
      accepted: true,
      created: false,
      profile: refreshed,
      identityToken: signIdentityToken(safeId, secret),
    };
  }

  function publicAccount(account) {
    if (!account) return null;
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
    };
  }

  function createAccount({ username, password, displayName = "" }) {
    const credentials = validateCredentials({ username, password });
    if (!credentials.ok) return { ok: false, code: credentials.code };
    if (getAccountByUsernameStmt.get(credentials.username)) {
      return { ok: false, code: "usernameTaken" };
    }
    const now = new Date().toISOString();
    const account = {
      id: crypto.randomUUID(),
      username: credentials.username,
      displayName: cleanDisplayName(displayName || credentials.username),
      createdAt: now,
      lastLoginAt: now,
    };
    insertAccountStmt.run(
      account.id,
      account.username,
      account.displayName,
      hashPassword(credentials.password),
      now,
      now,
    );
    const token = createAccountSession(account.id);
    return { ok: true, account, token };
  }

  function loginAccount({ username, password }) {
    const safeUsername = cleanUsername(username);
    const row = getAccountByUsernameStmt.get(safeUsername);
    if (!row || !verifyPassword(password, row.passwordHash)) {
      return { ok: false, code: "invalidCredentials" };
    }
    const now = new Date().toISOString();
    touchAccountLoginStmt.run(now, row.id);
    const account = {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      createdAt: row.createdAt,
      lastLoginAt: now,
    };
    const token = createAccountSession(account.id);
    return { ok: true, account, token };
  }

  function changeAccountPassword({ token, currentPassword, newPassword }) {
    const safeToken = normalizeSessionToken(token);
    const session = safeToken ? getSessionStmt.get(safeToken) : null;
    if (!session) return { ok: false, code: "invalidSession" };
    const row = getAccountByUsernameStmt.get(session.username);
    if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
      return { ok: false, code: "invalidCredentials" };
    }
    const credentials = validateCredentials({
      username: row.username,
      password: newPassword,
    });
    if (!credentials.ok) return { ok: false, code: credentials.code };
    const now = new Date().toISOString();
    updateAccountPasswordStmt.run(hashPassword(credentials.password), now, row.id);
    return {
      ok: true,
      account: {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        createdAt: row.createdAt,
        lastLoginAt: now,
      },
    };
  }

  function createAccountSession(accountId) {
    const token = createSessionToken();
    const now = new Date().toISOString();
    insertSessionStmt.run(token, accountId, now, now);
    return token;
  }

  function getAccountBySession(token) {
    const safeToken = normalizeSessionToken(token);
    if (!safeToken) return null;
    const row = getSessionStmt.get(safeToken);
    if (!row) return null;
    touchSessionStmt.run(new Date().toISOString(), safeToken);
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt,
    };
  }

  function logoutAccount(token) {
    const safeToken = normalizeSessionToken(token);
    if (!safeToken) return false;
    deleteSessionStmt.run(safeToken);
    return true;
  }

  function listRecords(limit = MAX_RECORDS) {
    return listRecordsStmt.all(limit).map((record) => ({
      ...record,
      score: Number(record.score),
      lines: Number(record.lines),
      level: Number(record.level),
    }));
  }

  function saveRecordsSnapshot(records) {
    db.exec("BEGIN IMMEDIATE");
    try {
      deleteRecordsStmt.run();
      for (const record of records) {
        insertRecordStmt.run(
          record.name,
          record.score,
          record.lines,
          record.level,
          record.mode,
          record.time,
          record.date,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function saveRecord(record) {
    const records = listRecords(MAX_RECORDS)
      .concat({
        name: cleanName(record.name),
        score: clamp(safeNumber(record.score), 0, 99999999),
        lines: clamp(safeNumber(record.lines), 0, 9999),
        level: clamp(safeNumber(record.level), 1, 99),
        mode: String(record.mode || "Classic").replace(/[<>]/g, "").slice(0, 24),
        time: String(record.time || "0:00").replace(/[<>]/g, "").slice(0, 12),
        date: record.date || new Date().toISOString(),
      })
      .sort(compareRecords)
      .slice(0, MAX_RECORDS);
    saveRecordsSnapshot(records);
    return records;
  }

  function getOrCreateDailySeed(dateKey) {
    const existing = getDailySeedStmt.get(dateKey);
    if (existing?.seed) return String(existing.seed);
    const seed = crypto
      .createHmac("sha256", identitySigningKey)
      .update(`daily:${dateKey}`)
      .digest("hex")
      .slice(0, 24);
    insertDailySeedStmt.run(dateKey, seed, new Date().toISOString());
    return seed;
  }

  function signDailyRun({ token, dateKey, seed, playerId, startedAt }) {
    return crypto
      .createHmac("sha256", identitySigningKey)
      .update(`${token}.${dateKey}.${seed}.${playerId}.${startedAt}`)
      .digest("base64url");
  }

  function createDailyRun({
    dateKey,
    playerId = "",
    account = null,
    ttlMs = 6 * 60 * 60 * 1000,
  }) {
    const seed = getOrCreateDailySeed(dateKey);
    const token = crypto.randomBytes(24).toString("base64url");
    const safePlayerId = account?.id
      ? `acct.${cleanPlayerId(account.id)}`
      : cleanPlayerId(playerId) || `guest.${crypto.randomBytes(8).toString("hex")}`;
    const startedAt = Date.now();
    const run = {
      token,
      dateKey,
      seed,
      playerId: safePlayerId,
      accountId: account?.id || "",
      startedAt,
      expiresAt: startedAt + ttlMs,
    };
    insertDailyRunStmt.run(
      run.token,
      run.dateKey,
      run.seed,
      run.playerId,
      run.accountId,
      run.startedAt,
      run.expiresAt,
    );
    return {
      ...run,
      signature: signDailyRun(run),
    };
  }

  function verifyDailyRun({ token, signature, dateKey }) {
    const safeToken = normalizeSessionToken(token);
    if (!safeToken || !signature) return { ok: false, code: "missingRun" };
    const run = getDailyRunStmt.get(safeToken);
    if (!run || run.dateKey !== dateKey) return { ok: false, code: "badRun" };
    if (Number(run.expiresAt) < Date.now()) return { ok: false, code: "expiredRun" };
    if (Number(run.submittedAt) > 0) return { ok: false, code: "usedRun" };
    const expected = signDailyRun(run);
    if (!timingSafeEqualText(expected, signature)) {
      return { ok: false, code: "badSignature" };
    }
    return { ok: true, run };
  }

  function listDailyLeaderboard(dateKey, limit = 10) {
    return listDailyScoresStmt.all(dateKey, limit).map((entry) => ({
      ...entry,
      score: Number(entry.score),
      lines: Number(entry.lines),
      level: Number(entry.level),
      timeMs: Number(entry.timeMs),
    }));
  }

  function saveDailyScore({
    dateKey,
    playerId,
    name = "Player",
    score,
    lines,
    level,
    timeMs,
  }) {
    const safeId = cleanPlayerId(playerId);
    if (!safeId || !dateKey) return listDailyLeaderboard(dateKey);
    const incoming = {
      dateKey,
      playerId: safeId,
      name: cleanName(name),
      score: clamp(safeNumber(score), 0, 99999999),
      lines: clamp(safeNumber(lines), 0, 9999),
      level: clamp(safeNumber(level), 1, 99),
      timeMs: clamp(safeNumber(timeMs), 0, 60 * 60 * 1000 * 3),
      createdAt: new Date().toISOString(),
    };
    const current = getDailyScoreStmt.get(dateKey, safeId);
    if (current) {
      const best = [incoming, current].sort(compareDailyEntries)[0];
      if (
        best.score === current.score &&
        best.lines === current.lines &&
        best.timeMs === Number(current.timeMs)
      ) {
        return listDailyLeaderboard(dateKey);
      }
    }
    upsertDailyScoreStmt.run(
      incoming.dateKey,
      incoming.playerId,
      incoming.name,
      incoming.score,
      incoming.lines,
      incoming.level,
      incoming.timeMs,
      incoming.createdAt,
    );
    return listDailyLeaderboard(dateKey);
  }

  function markDailyRunSubmitted(token) {
    markDailyRunSubmittedStmt.run(Date.now(), normalizeSessionToken(token));
  }

  function logRankedEvent({
    matchId,
    roomId,
    playerId,
    eventType = "clear",
    lines = 0,
    attackLines = 0,
    combo = 0,
    score = 0,
    elapsedMs = 0,
  }) {
    insertRankedEventStmt.run(
      String(matchId || "").slice(0, 120),
      String(roomId || "").slice(0, 24),
      cleanPlayerId(playerId),
      String(eventType || "clear").replace(/[<>]/g, "").slice(0, 24),
      clamp(safeNumber(lines), 0, 4),
      clamp(safeNumber(attackLines), 0, 12),
      clamp(safeNumber(combo), 0, 999),
      clamp(safeNumber(score), 0, 99999999),
      clamp(safeNumber(elapsedMs), 0, 3 * 60 * 60 * 1000),
      new Date().toISOString(),
    );
  }

  function logRankedMatch({
    id,
    roomId,
    seriesId,
    matchIndex,
    mode,
    reason,
    startedAt,
    finishedAt,
    winner,
    loser,
  }) {
    insertMatchStmt.run(
      id,
      roomId,
      seriesId,
      matchIndex,
      mode,
      reason,
      startedAt,
      finishedAt,
      winner.playerId,
      loser.playerId,
      winner.name,
      loser.name,
      winner.ratingBefore,
      winner.ratingAfter,
      loser.ratingBefore,
      loser.ratingAfter,
      winner.stats.score,
      loser.stats.score,
      winner.stats.lines,
      loser.stats.lines,
      winner.stats.sentGarbage,
      loser.stats.sentGarbage,
      winner.stats.receivedGarbage,
      loser.stats.receivedGarbage,
      winner.stats.time,
      loser.stats.time,
      new Date().toISOString(),
    );
  }

  function insertDeployAudit({ revision, version, reason = "startup" }) {
    insertDeployAuditStmt.run(
      String(revision || "unknown").slice(0, 64),
      String(version || "0.0.0").slice(0, 32),
      process.pid,
      String(reason || "startup").slice(0, 64),
      new Date().toISOString(),
    );
  }

  function getHealthCounts(dateKey) {
    return {
      records: Number(countStmt.get()?.total || 0),
      rankedPlayers: Number(countRankedStmt.get()?.total || 0),
      accounts: Number(countAccountsStmt.get()?.total || 0),
      dailyEntries: Number(countDailyStmt.get(dateKey)?.total || 0),
      dailyRuns: Number(countDailyRunsStmt.get(dateKey)?.total || 0),
      rankedMatches: Number(countRankedMatchesStmt.get()?.total || 0),
      rankedEvents: Number(countRankedEventsStmt.get()?.total || 0),
    };
  }

  migrateLegacyFiles();

  return {
    db,
    cleanName,
    cleanPlayerId,
    defaultRankedPlayer,
    normalizeRankedPlayer,
    parseTimeSeconds,
    publicRankedProfile,
    publicAccount,
    createAccount,
    loginAccount,
    changeAccountPassword,
    getAccountBySession,
    logoutAccount,
    getAccountById: (accountId) => getAccountByIdStmt.get(accountId),
    getRankedProfile,
    listRankedLeaderboard,
    resolveRankedIdentity,
    upsertRankedProfile,
    listRecords,
    saveRecord,
    getOrCreateDailySeed,
    createDailyRun,
    verifyDailyRun,
    markDailyRunSubmitted,
    listDailyLeaderboard,
    saveDailyScore,
    logRankedEvent,
    logRankedMatch,
    insertDeployAudit,
    getHealthCounts,
  };
}

module.exports = {
  MAX_RECORDS,
  RANKED_START_RATING,
  RANKED_MIN_RATING,
  RANKED_MAX_RATING,
  createServerStore,
};
