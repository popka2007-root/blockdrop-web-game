const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const { WebSocket, WebSocketServer } = require("ws");
const { createMetrics, createLogger } = require("./server-observability");
const {
  clientAddress,
  isSensitiveTransportAllowed,
} = require("./server-transport");
const {
  RANKED_MAX_RATING,
  RANKED_MIN_RATING,
  createServerStore,
} = require("./server-store");
const protocol = require("./shared/protocol.js");
const engine = require("./shared/engine.js");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const MAX_WS_FRAME_BYTES = 4096;
const MAX_MESSAGES_PER_10S = 90;
const MAX_UPDATES_PER_SECOND = 8;
const MAX_ATTACKS_PER_SECOND = 4;
const MAX_ATTACK_LINES_PER_10S = 18;
const MAX_PAYLOAD_KEYS = 18;
const HTTP_RATE_WINDOW_MS = 10 * 60 * 1000;
const RECONNECT_GRACE_MS = 12000;
const COUNTDOWN_STEP_MS = 700;
const MATCH_TICK_MS = 1000 / engine.TICK_RATE;
const SNAPSHOT_INTERVAL_TICKS = 6;
const RANKED_K_FACTOR = 32;
const {
  ATTACK_KEYS: ATTACK_KEY_LIST,
  BOARD_PREVIEW_COLS: MAX_BOARD_PREVIEW_COLS,
  BOARD_PREVIEW_ROWS: MAX_BOARD_PREVIEW_ROWS,
  JOIN_KEYS: JOIN_KEY_LIST,
  INPUT_ACTIONS,
  INPUT_KEYS: INPUT_KEY_LIST,
  MATCH_OVER_KEYS: MATCH_OVER_KEY_LIST,
  MAX_RECORD_SCORE,
  PING_KEYS: PING_KEY_LIST,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  REMATCH_KEYS: REMATCH_KEY_LIST,
  MATCH_EVENT_KEYS: MATCH_EVENT_KEY_LIST,
  ROOM_PLAYER_LIMIT,
  TOURNAMENT_KEYS: TOURNAMENT_KEY_LIST,
  UPDATE_KEYS: UPDATE_KEY_LIST,
  normalizeIdentityToken,
  normalizeMatchMode,
  normalizePlayerId,
  normalizePlayerName,
  normalizeRoomId,
  sanitizeBoardPreview,
} = protocol;
const UPDATE_KEYS = new Set(UPDATE_KEY_LIST);
const ATTACK_KEYS = new Set(ATTACK_KEY_LIST);
const REMATCH_KEYS = new Set(REMATCH_KEY_LIST);
const MATCH_EVENT_KEYS = new Set(MATCH_EVENT_KEY_LIST);
const MATCH_OVER_KEYS = new Set(MATCH_OVER_KEY_LIST);
const PING_KEYS = new Set(PING_KEY_LIST);
const JOIN_KEYS = new Set(JOIN_KEY_LIST);
const INPUT_KEYS = new Set(INPUT_KEY_LIST);
const TOURNAMENT_KEYS = new Set(TOURNAMENT_KEY_LIST);
const rooms = new Map();
const rankedQueue = [];
const httpRateBuckets = new Map();
const startedAt = Date.now();
let cachedPackageMeta = null;
const store = createServerStore({
  root: ROOT,
  dbFile: process.env.BLOCKDROP_DB_FILE || undefined,
});
const logger = createLogger({ service: "blockdrop-web-game" });
const metrics = createMetrics();
metrics.increment("blockdrop_http_5xx_total", 0);
metrics.increment("blockdrop_ws_disconnect_total", 0);
metrics.increment("blockdrop_match_abort_total", 0);
metrics.increment("blockdrop_db_errors_total", 0);
metrics.increment("blockdrop_db_lock_errors_total", 0);
let eventLoopExpectedAt = performance.now() + 1000;
let previousCpuUsage = process.cpuUsage();
let previousCpuMeasuredAt = performance.now();
const operationalMetricsTimer = setInterval(() => {
  const now = performance.now();
  metrics.set(
    "blockdrop_event_loop_lag_ms",
    Math.max(0, now - eventLoopExpectedAt),
  );
  eventLoopExpectedAt = now + 1000;
  const memory = process.memoryUsage();
  metrics.set("blockdrop_memory_rss_bytes", memory.rss);
  metrics.set("blockdrop_memory_heap_used_bytes", memory.heapUsed);
  const cpuUsage = process.cpuUsage(previousCpuUsage);
  const elapsedMicroseconds = Math.max(1, (now - previousCpuMeasuredAt) * 1000);
  metrics.set(
    "blockdrop_process_cpu_percent",
    ((cpuUsage.user + cpuUsage.system) / elapsedMicroseconds) * 100,
  );
  previousCpuUsage = process.cpuUsage();
  previousCpuMeasuredAt = now;
}, 1000);
operationalMetricsTimer.unref();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};
const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const PUBLIC_ROOT_FILES = new Set([
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/sw.js",
  "/PRIVACY.md",
  "/TERMS.md",
  "/SECURITY.md",
  "/LICENSE",
]);
const PUBLIC_PREFIXES = ["/js/", "/styles/", "/icons/", "/shared/"];

const server = http.createServer((req, res) => {
  const requestStartedAt = performance.now();
  const requestId = crypto.randomUUID();
  res.blockdropRequestId = requestId;
  res.once("finish", () => {
    metrics.observe(
      "blockdrop_http_request_ms",
      Math.max(0, performance.now() - requestStartedAt),
    );
    if (res.statusCode >= 500) {
      logger.error("http_5xx", {
        requestId,
        path: String(req.url || "").split("?")[0].slice(0, 160),
        status: res.statusCode,
      });
    }
  });
  let requestUrl;
  try {
    requestUrl = new URL(req.url || "/", "http://blockdrop.local");
  } catch {
    writeHead(res, 400);
    res.end("Bad request");
    return;
  }
  metrics.increment("blockdrop_http_requests_total");

  if (requestUrl.pathname === "/api/capabilities") {
    handleCapabilitiesApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/qr") {
    handleQrApi(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/api/records") {
    handleRecordsApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/daily") {
    handleDailyApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/daily/run") {
    handleDailyRunApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/account") {
    handleAccountApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/ranked") {
    handleRankedApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/profile-transfer") {
    handleProfileTransferApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/analytics") {
    handleAnalyticsApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/health/live") {
    handleLiveness(req, res);
    return;
  }

  if (requestUrl.pathname === "/health/ready") {
    handleReadiness(req, res, false);
    return;
  }

  if (requestUrl.pathname === "/health") {
    handleHealth(req, res);
    return;
  }

  if (requestUrl.pathname === "/metrics") {
    handleMetrics(req, res);
    return;
  }

  const pathname =
    requestUrl.pathname === "/" ||
    /^\/room\/[A-Z0-9]+$/i.test(requestUrl.pathname)
      ? "/index.html"
      : requestUrl.pathname;
  const decodedPathname = safeDecodePath(pathname);
  if (!decodedPathname) {
    writeHead(res, 400);
    res.end("Bad request");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  const safePath = path
    .normalize(decodedPathname)
    .replace(/^([/\\])/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const publicPath = `/${safePath.replace(/\\/g, "/")}`;
  if (
    !PUBLIC_ROOT_FILES.has(publicPath) &&
    !PUBLIC_PREFIXES.some((prefix) => publicPath.startsWith(prefix))
  ) {
    writeHead(res, 404);
    res.end("Not found");
    return;
  }
  const filePath = path.join(ROOT, safePath);

  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    writeHead(res, 403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      writeHead(res, 404);
      res.end("Not found");
      return;
    }
    writeHead(res, 200, {
      "Content-Type":
        mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_FRAME_BYTES,
  perMessageDeflate: false,
});

function safeDecodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "";
  }
}

function handleHealth(req, res) {
  handleReadiness(req, res, true);
}

function handleLiveness(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  const payload = {
    ok: true,
    status: "live",
    service: "blockdrop-web-game",
    version: readPackageMeta().version,
    revision: readRevision(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
  sendHealthPayload(req, res, payload, 200);
}

function handleReadiness(req, res, includeDetails) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  const readiness = store.checkReady();
  if (!readiness.ok) {
    metrics.increment("blockdrop_db_errors_total");
    sendHealthPayload(
      req,
      res,
      {
        ok: false,
        status: "not-ready",
        service: "blockdrop-web-game",
        version: readPackageMeta().version,
        revision: readRevision(),
      },
      503,
    );
    return;
  }

  if (!includeDetails) {
    sendHealthPayload(
      req,
      res,
      {
        ok: true,
        status: "ready",
        service: "blockdrop-web-game",
        version: readPackageMeta().version,
        revision: readRevision(),
        database: "ready",
      },
      200,
    );
    return;
  }

  const dailyDate = serverDateKey();
  const counts = store.getHealthCounts(dailyDate);
  updateLiveMetrics();
  const payload = {
    ok: true,
    app: "BlockDrop",
    service: "blockdrop-web-game",
    version: readPackageMeta().version,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    rooms: rooms.size,
    players: livePlayersCount(),
    spectators: liveSpectatorsCount(),
    records: counts.records,
    rankedPlayers: counts.rankedPlayers,
    accounts: counts.accounts,
    dailyDate,
    dailyEntries: counts.dailyEntries,
    dailyRuns: counts.dailyRuns,
    rankedMatches: counts.rankedMatches,
    rankedEvents: counts.rankedEvents,
    revision: readRevision(),
    backupAgeSec: counts.latestBackupAt
      ? Math.max(0, Math.floor((Date.now() - counts.latestBackupAt) / 1000))
      : null,
  };

  sendHealthPayload(req, res, payload, 200);
}

function sendHealthPayload(req, res, payload, status) {
  if (req.method === "HEAD") {
    writeHead(res, status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }
  sendJson(res, payload, status);
}

function handleMetrics(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!hasMetricsAccess(req)) {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }
  const counts = store.getHealthCounts(serverDateKey());
  updateLiveMetrics();
  writeHead(res, 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(
    metrics.render({
      blockdrop_records_total: counts.records,
      blockdrop_ranked_players_total: counts.rankedPlayers,
      blockdrop_daily_entries_total: counts.dailyEntries,
      blockdrop_daily_runs_total: counts.dailyRuns,
      blockdrop_ranked_matches_stored_total: counts.rankedMatches,
      blockdrop_ranked_events_total: counts.rankedEvents,
      blockdrop_ranked_queue_waiting: rankedQueue.length,
      blockdrop_backup_age_seconds: counts.latestBackupAt
        ? Math.max(0, Math.floor((Date.now() - counts.latestBackupAt) / 1000))
        : -1,
    }),
  );
}

function hasMetricsAccess(req) {
  const configuredToken = String(process.env.BLOCKDROP_METRICS_TOKEN || "");
  if (configuredToken) {
    const header = String(req.headers.authorization || "");
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    return timingSafeEqualText(token, configuredToken);
  }
  if (req.headers.forwarded || req.headers["x-forwarded-for"]) return false;
  const address = String(req.socket?.remoteAddress || "").toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function timingSafeEqualText(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function serverDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function livePlayersCount() {
  let total = 0;
  for (const room of rooms.values()) total += room.players.size;
  return total;
}

function liveSpectatorsCount() {
  let total = 0;
  for (const room of rooms.values()) total += room.spectators.size;
  return total;
}

function updateLiveMetrics() {
  metrics.set("blockdrop_rooms_active", rooms.size);
  metrics.set("blockdrop_players_active", livePlayersCount());
  metrics.set("blockdrop_spectators_active", liveSpectatorsCount());
}

function readRevision() {
  if (process.env.BLOCKDROP_REVISION) return process.env.BLOCKDROP_REVISION;
  try {
    return (
      fs
        .readFileSync(path.join(ROOT, "REVISION"), "utf8")
        .trim()
        .slice(0, 64) || "unknown"
    );
  } catch {
    return "unknown";
  }
}

function readPackageMeta() {
  if (cachedPackageMeta) return cachedPackageMeta;
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    cachedPackageMeta = {
      version: String(meta.version || "0.0.0").slice(0, 32),
    };
    return cachedPackageMeta;
  } catch {
    cachedPackageMeta = { version: "0.0.0" };
    return cachedPackageMeta;
  }
}

function handleCapabilitiesApi(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  const secureTransport = isSensitiveTransportAllowed(req);
  const bucket = clientAddress(req);
  const authEnabled = isFeatureEnabled("accounts", secureTransport, bucket);
  const payload = {
    secureTransport,
    authEnabled,
    rankedEnabled:
      authEnabled && isFeatureEnabled("ranked", secureTransport, bucket),
    casualOnlineEnabled: true,
    casualV2Enabled: isFeatureEnabled("casualV2", secureTransport, bucket),
    analyticsEnabled: isFeatureEnabled("analytics", secureTransport, bucket),
    pwaInstallEnabled: isFeatureEnabled("pwaInstall", secureTransport, bucket),
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: engine.ENGINE_VERSION,
    maxPlayers: ROOM_PLAYER_LIMIT,
    localQrEnabled: true,
    version: readPackageMeta().version,
  };
  if (req.method === "HEAD") {
    writeHead(res, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }
  sendJson(res, payload);
}

function isFeatureEnabled(key, secureTransport, bucket = "") {
  const environmentKey = `BLOCKDROP_FEATURE_${String(key)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase()}`;
  const environmentValue = process.env[environmentKey];
  const flag = store.getFeatureFlag(key);
  const hasEnvironmentOverride = environmentValue != null;
  const enabled = hasEnvironmentOverride
    ? environmentValue === "true" || environmentValue === "1"
    : Boolean(flag?.enabled);
  if (!enabled) return false;
  if (flag?.secureTransportRequired && !secureTransport) return false;
  if (hasEnvironmentOverride) return true;
  const rollout = clamp(Number(flag?.rolloutPercentage) || 0, 0, 100);
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;
  const digest = crypto
    .createHash("sha256")
    .update(`${key}:${bucket}`)
    .digest()
    .readUInt32BE(0);
  return digest % 100 < rollout;
}

async function handleQrApi(req, res, requestUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!allowHttpRequest(req, "qr", 80, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  const rawValue = String(requestUrl.searchParams.get("data") || "").slice(
    0,
    512,
  );
  let inviteUrl;
  try {
    inviteUrl = new URL(rawValue);
  } catch {
    sendJson(res, { error: "Invalid invite URL" }, 400);
    return;
  }
  const requestHost = String(req.headers.host || "").toLowerCase();
  if (
    !["http:", "https:"].includes(inviteUrl.protocol) ||
    !requestHost ||
    inviteUrl.host.toLowerCase() !== requestHost
  ) {
    sendJson(res, { error: "Invite URL must use this BlockDrop host" }, 400);
    return;
  }
  try {
    const svg = await QRCode.toString(inviteUrl.toString(), {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 160,
      color: { dark: "#101827", light: "#ffffff" },
    });
    writeHead(res, 200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    });
    res.end(req.method === "HEAD" ? undefined : svg);
  } catch {
    sendJson(res, { error: "QR generation failed" }, 500);
  }
}

function handleRecordsApi(req, res) {
  if (req.method === "GET") {
    sendJson(res, { records: store.listRecords() });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  if (!allowHttpRequest(req, "records", 30, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }

    const record = sanitizeRecord(data);
    if (record.score <= 0) {
      sendJson(res, { records: store.listRecords() });
      return;
    }

    if (!isPlausibleRecord(record)) {
      logger.warn("record_rejected", {
        name: record.name,
        score: record.score,
        lines: record.lines,
      });
      sendJson(
        res,
        {
          error: "Record rejected by server authority",
          records: store.listRecords(),
        },
        422,
      );
      return;
    }

    const records = store.saveRecord(record);
    sendJson(res, { records });
  });
}

function handleDailyApi(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const dateKey = serverDateKey();
    if (!allowHttpRequest(req, "daily-read", 120, HTTP_RATE_WINDOW_MS)) {
      sendRateLimited(res);
      return;
    }
    const payload = {
      date: dateKey,
      seed: store.getOrCreateDailySeed(dateKey),
      leaderboard: store.listDailyLeaderboard(dateKey),
    };
    if (req.method === "HEAD") {
      writeHead(res, 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end();
      return;
    }
    sendJson(res, payload);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  if (!allowHttpRequest(req, "daily-submit", 40, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }

    const dateKey = serverDateKey();
    const account = isSensitiveTransportAllowed(req)
      ? accountFromRequest(req, data.accountToken)
      : null;
    const entry = sanitizeDailyScore(data, dateKey, account);
    const runCheck = store.verifyDailyRun({
      token: data.runToken,
      signature: data.runSignature,
      dateKey,
    });
    const replayCheck = runCheck.ok
      ? verifyDailyReplay(data, entry, runCheck.run)
      : { ok: false, code: runCheck.code };
    if (
      !runCheck.ok ||
      !isPlausibleDailyScore(entry, data, runCheck.run) ||
      !replayCheck.ok
    ) {
      metrics.increment("blockdrop_daily_rejected_total");
      sendJson(
        res,
        {
          error: runCheck.code || replayCheck.code || "Daily score rejected",
          date: dateKey,
          seed: store.getOrCreateDailySeed(dateKey),
          leaderboard: store.listDailyLeaderboard(dateKey),
        },
        422,
      );
      return;
    }
    entry.playerId = runCheck.run.playerId;
    const leaderboard = store.saveDailyScore(entry);
    store.saveReplay({
      id: `daily:${dateKey}:${data.runToken}`,
      playerId: entry.playerId,
      mode: replayCheck.replay.mode,
      engineVersion: replayCheck.replay.engineVersion,
      replaySchemaVersion: replayCheck.replay.replayVersion,
      seed: replayCheck.replay.seed,
      inputStream: {
        inputs: replayCheck.replay.inputs,
        externalEvents: replayCheck.replay.externalEvents || [],
        finalTick: replayCheck.replay.finalTick,
        metadata: replayCheck.replay.metadata || {},
      },
      checkpoints: replayCheck.replay.checkpoints || [],
      result: entry,
      checksum: replayCheck.replay.finalChecksum,
      verificationStatus: "verified",
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    store.markDailyRunSubmitted(data.runToken);
    metrics.increment("blockdrop_daily_submissions_total");
    sendJson(res, {
      date: dateKey,
      seed: store.getOrCreateDailySeed(dateKey),
      leaderboard,
    });
  });
}

function handleDailyRunApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!allowHttpRequest(req, "daily-start", 40, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  readJsonRequest(req, res, 16 * 1024, (data) => {
    const dateKey = serverDateKey();
    const account = isSensitiveTransportAllowed(req)
      ? accountFromRequest(req, data.accountToken)
      : null;
    const playerId = cleanPlayerId(data.playerId);
    const run = store.createDailyRun({ dateKey, account, playerId });
    sendJson(
      res,
      {
        date: dateKey,
        seed: store.getOrCreateDailySeed(dateKey),
        runToken: run.token,
        runSignature: run.signature,
        runExpiresAt: run.expiresAt,
        leaderboard: store.listDailyLeaderboard(dateKey),
      },
      201,
    );
  });
}

function handleAccountApi(req, res) {
  if (!isSensitiveTransportAllowed(req)) {
    sendJson(
      res,
      {
        error: "secureTransportRequired",
        message: "Accounts and ranked play require HTTPS",
      },
      426,
    );
    return;
  }
  if (req.method === "GET") {
    const account = accountFromRequest(req);
    if (!account) {
      sendJson(res, { account: null }, 401);
      return;
    }
    sendJson(res, { account: store.publicAccount(account) });
    return;
  }

  if (req.method === "DELETE") {
    const token = authTokenFromRequest(req);
    store.logoutAccount(token);
    sendJson(res, { ok: true });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }
    const action = String(data.action || "login");
    const usernameKey = String(data.username || "anonymous")
      .trim()
      .toLowerCase()
      .slice(0, 32);
    if (
      !allowHttpRequest(req, `account:${action}`, 20, HTTP_RATE_WINDOW_MS) ||
      !allowHttpRequest(
        req,
        `account:${action}:${usernameKey}`,
        8,
        HTTP_RATE_WINDOW_MS,
      )
    ) {
      sendRateLimited(res);
      return;
    }
    const result =
      action === "register"
        ? store.createAccount(data)
        : action === "changePassword"
          ? store.changeAccountPassword({
              token: data.token || authTokenFromRequest(req),
              currentPassword: data.currentPassword,
              newPassword: data.newPassword,
            })
          : store.loginAccount(data);
    if (!result.ok) {
      sendJson(res, { error: result.code || "accountError" }, 400);
      return;
    }
    sendJson(res, {
      account: store.publicAccount(result.account),
      token:
        result.token ||
        normalizeIdentityToken(data.token) ||
        authTokenFromRequest(req),
    });
  });
}

function handleRankedApi(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  const payload = {
    leaderboard: store.listRankedLeaderboard(20),
    queueWaiting: rankedQueue.length,
  };
  if (req.method === "HEAD") {
    writeHead(res, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end();
    return;
  }
  sendJson(res, payload);
}

function readJsonRequest(req, res, limitBytes, callback) {
  let body = "";
  let rejected = false;
  req.on("data", (chunk) => {
    if (rejected) return;
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > limitBytes) {
      rejected = true;
      sendJson(res, { error: "Payload too large" }, 413);
    }
  });
  req.on("end", () => {
    if (rejected) return;
    try {
      callback(JSON.parse(body || "{}"));
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
    }
  });
}

function handleProfileTransferApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!allowHttpRequest(req, "profile-transfer", 20, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  readJsonRequest(req, res, 256 * 1024, (data) => {
    const action = data.action === "verify" ? "verify" : "sign";
    const payload = data.payload;
    if (
      !payload ||
      payload.kind !== "blockdrop-profile" ||
      Number(payload.exportSchemaVersion) !== 1 ||
      !payload.profile ||
      Number(payload.profile.profileSchemaVersion) !== 1
    ) {
      sendJson(res, { error: "invalidProfile" }, 422);
      return;
    }
    if (action === "verify") {
      const verified = store.verifyPortablePayload(payload, data.signature);
      sendJson(res, { verified }, verified ? 200 : 422);
      return;
    }
    sendJson(res, {
      envelopeSchemaVersion: 1,
      algorithm: "HMAC-SHA256-v1",
      payload,
      signature: store.signPortablePayload(payload),
    });
  });
}

function handleAnalyticsApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  const bucket = clientAddress(req);
  if (
    !isFeatureEnabled("analytics", isSensitiveTransportAllowed(req), bucket)
  ) {
    sendJson(res, { accepted: false }, 404);
    return;
  }
  if (!allowHttpRequest(req, "analytics", 120, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  readJsonRequest(req, res, 4096, (data) => {
    const accepted = store.saveAnalyticsEvent(data);
    if (accepted) metrics.increment("blockdrop_analytics_events_total");
    sendJson(res, { accepted }, accepted ? 202 : 422);
  });
}

function authTokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? normalizeIdentityToken(match[1]) : "";
}

function accountFromRequest(req, explicitToken = "") {
  const token =
    normalizeIdentityToken(explicitToken) || authTokenFromRequest(req);
  return token ? store.getAccountBySession(token) : null;
}

function sanitizeRecord(data) {
  return {
    name: cleanName(data.name || "\u0418\u0433\u0440\u043e\u043a"),
    score: clamp(safeNumber(data.score), 0, MAX_RECORD_SCORE),
    lines: clamp(safeNumber(data.lines), 0, 9999),
    level: clamp(safeNumber(data.level), 1, 99),
    mode: String(
      data.mode || "\u041a\u043b\u0430\u0441\u0441\u0438\u043a\u0430",
    )
      .replace(/[<>]/g, "")
      .slice(0, 24),
    time: String(data.time || "0:00")
      .replace(/[<>]/g, "")
      .slice(0, 12),
    date: new Date().toISOString(),
  };
}

function sanitizeDailyScore(data, dateKey, account = null) {
  return {
    dateKey,
    playerId: account?.id
      ? `acct.${cleanPlayerId(account.id)}`
      : cleanPlayerId(data.playerId),
    name:
      account?.displayName ||
      cleanName(data.name || "\u0418\u0433\u0440\u043e\u043a"),
    score: clamp(safeNumber(data.score), 0, MAX_RECORD_SCORE),
    lines: clamp(safeNumber(data.lines), 0, 9999),
    level: clamp(safeNumber(data.level), 1, 99),
    timeMs: clamp(safeNumber(data.timeMs), 0, 60 * 60 * 1000 * 3),
  };
}

function isPlausibleRecord(record) {
  if (!record.score || record.score > MAX_RECORD_SCORE) return false;
  if (!record.time || !/^\d{1,3}:\d{2}$/.test(record.time)) return false;
  const seconds = parseTimeSeconds(record.time);
  if (seconds < 2 || seconds > 60 * 60 * 3) return false;
  if (record.level > Math.max(1, Math.floor(record.lines / 8) + 14))
    return false;

  const mode = record.mode.toLowerCase();
  const sprintCap = mode.includes("40") || mode.includes("sprint") ? 40 : 9999;
  if (record.lines > sprintCap) return false;

  const lineScoreCap =
    Math.max(1, record.lines) * Math.max(1, record.level) * 1100;
  const timeScoreCap = seconds * 520;
  const modifierCap = 9000 + record.level * 900;
  return record.score <= lineScoreCap + timeScoreCap + modifierCap;
}

function isPlausibleDailyScore(entry, data, run) {
  if (!entry.score || !entry.timeMs || entry.timeMs < 1500) return false;
  if (Number(run.startedAt) > Date.now() + 1000) return false;
  const wallElapsed = Date.now() - Number(run.startedAt);
  if (entry.timeMs > wallElapsed + 15000) return false;
  if (entry.timeMs < wallElapsed - 6 * 60 * 60 * 1000) return false;
  const pieces = clamp(safeNumber(data.pieces), 0, 20000);
  const bestCombo = clamp(safeNumber(data.bestCombo), 0, 999);
  const tSpins = clamp(safeNumber(data.tSpins), 0, 999);
  const perfectClears = clamp(safeNumber(data.perfectClears), 0, 999);
  if (pieces && entry.lines > pieces * 4) return false;
  if (bestCombo > entry.lines + 1) return false;
  if (tSpins > pieces) return false;
  if (perfectClears > Math.max(1, Math.floor(entry.lines / 4) + 1))
    return false;
  const seconds = Math.max(1, entry.timeMs / 1000);
  const lineRateCap = seconds * 3.2 + 8;
  if (entry.lines > lineRateCap) return false;
  const scoreCap =
    Math.max(1, entry.lines) * Math.max(1, entry.level) * 1800 +
    seconds * 900 +
    bestCombo * 650 +
    tSpins * 4500 +
    perfectClears * 5000 +
    12000;
  return entry.score <= scoreCap;
}

function verifyDailyReplay(data, entry, run) {
  const submitted = data?.replay;
  if (!submitted || typeof submitted !== "object") {
    return { ok: false, code: "replayRequired" };
  }
  if (
    Number(submitted.engineVersion) !== engine.ENGINE_VERSION ||
    Number(submitted.replayVersion) !== engine.REPLAY_VERSION ||
    submitted.seed !== `daily:${run.seed}` ||
    submitted.mode !== "classic" ||
    !Array.isArray(submitted.inputs) ||
    submitted.inputs.length > 100000 ||
    (submitted.externalEvents || []).length
  ) {
    return { ok: false, code: "invalidDailyReplay" };
  }
  const verified = engine.simulateReplay(submitted, engine.TICK_RATE * 60 * 60);
  if (!verified.ok) return { ok: false, code: verified.code };
  const replayTimeMs = Math.floor(
    (Number(verified.state.tick) / engine.TICK_RATE) * 1000,
  );
  if (
    verified.state.score !== entry.score ||
    verified.state.lines !== entry.lines ||
    verified.state.level !== entry.level ||
    Math.abs(replayTimeMs - entry.timeMs) > 20 ||
    String(data.replayChecksum || "") !== verified.finalChecksum
  ) {
    return { ok: false, code: "dailyReplayResultMismatch" };
  }
  const replay = engine.createReplay({
    seed: submitted.seed,
    mode: submitted.mode,
    inputs: submitted.inputs,
    finalState: verified.state,
    metadata: {
      date: run.dateKey,
      playerId: run.playerId,
      score: entry.score,
      lines: entry.lines,
    },
  });
  return { ok: true, code: "ok", replay };
}

function parseTimeSeconds(value) {
  return store.parseTimeSeconds(value);
}

function sendJson(res, payload, status = 200) {
  writeHead(res, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(payload));
}

function writeHead(res, status, headers = {}) {
  if (status >= 500) metrics.increment("blockdrop_http_5xx_total");
  res.writeHead(status, {
    ...securityHeaders,
    "X-Request-Id": res.blockdropRequestId || crypto.randomUUID(),
    ...headers,
  });
}

function allowHttpRequest(req, bucketName, max, windowMs) {
  const now = Date.now();
  const key = `${clientAddress(req)}:${bucketName}`;
  const bucket = httpRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    httpRateBuckets.set(key, { startedAt: now, count: 1 });
    if (httpRateBuckets.size > 5000) {
      for (const [entryKey, entry] of httpRateBuckets) {
        if (now - entry.startedAt >= windowMs) httpRateBuckets.delete(entryKey);
      }
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function sendRateLimited(res) {
  writeHead(res, 429, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": String(Math.ceil(HTTP_RATE_WINDOW_MS / 1000)),
  });
  res.end(JSON.stringify({ error: "rateLimited" }));
}

server.on("upgrade", (req, socket, head) => {
  req.blockdropRequestId = crypto.randomUUID();
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  if (!isAllowedWebSocketOrigin(req)) {
    metrics.increment("blockdrop_ws_rejected_origin_total");
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, req);
  });
});

webSocketServer.on("connection", (socket, req) => {
  const client = createClient(socket, {
    authTransportAllowed: isSensitiveTransportAllowed(req),
  });
  metrics.increment("blockdrop_ws_connections_total");
  logger.info("ws_connected", {
    connectionId: client.id,
    requestId: req.blockdropRequestId,
  });
  updateLiveMetrics();
  socket.on("message", (message, isBinary) => {
    if (
      isBinary ||
      message.length > MAX_WS_FRAME_BYTES ||
      !allowMessage(client)
    ) {
      metrics.increment("blockdrop_ws_policy_close_total");
      safeClose(client, "Rate limited or invalid frame");
      return;
    }
    metrics.increment("blockdrop_ws_messages_total");
    handleMessage(client, message.toString("utf8"));
  });
  socket.on("close", () => {
    if (!client.disconnectObserved) {
      metrics.increment("blockdrop_ws_disconnect_total");
      client.disconnectObserved = true;
    }
    logger.info("ws_disconnected", {
      connectionId: client.id,
      roomId: client.room,
      matchId: rooms.get(client.room)?.authority?.matchId || "",
    });
    removeClient(client, "close");
  });
  socket.on("error", () => {
    if (!client.disconnectObserved) {
      metrics.increment("blockdrop_ws_disconnect_total");
      client.disconnectObserved = true;
    }
    removeClient(client, "error");
  });
  send(client, {
    type: "hello",
    id: client.id,
    protocolVersion: PROTOCOL_VERSION,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    engineVersion: engine.ENGINE_VERSION,
  });
});

function createClient(socket, options = {}) {
  return {
    id: crypto.randomUUID(),
    socket,
    room: "",
    role: "player",
    ranked: false,
    playerId: "",
    identityToken: "",
    accountToken: "",
    account: null,
    authTransportAllowed: Boolean(options.authTransportAllowed),
    rankedProfile: null,
    name: "Player",
    protocolVersion: 1,
    authoritative: false,
    reconnectToken: crypto.randomBytes(24).toString("base64url"),
    pendingInputs: [],
    state: emptyState(),
    attackCredit: 0,
    lastRankedEventAt: 0,
    disconnectedAt: 0,
    disconnectObserved: false,
    disconnectTimer: null,
    buckets: {
      windowStartedAt: Date.now(),
      messages: 0,
      updateStartedAt: Date.now(),
      updates: 0,
      attackStartedAt: Date.now(),
      attacks: 0,
      attackLinesStartedAt: Date.now(),
      attackLines: 0,
    },
  };
}

function isAllowedWebSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let normalized;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }
  return allowedWebSocketOrigins(req).has(normalized);
}

function allowedWebSocketOrigins(req) {
  const origins = new Set();
  for (const origin of String(process.env.BLOCKDROP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    try {
      origins.add(new URL(origin).origin);
    } catch {
      // Ignore invalid deployment config entries instead of breaking upgrades.
    }
  }
  const host = req.headers.host;
  if (host) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  origins.add("http://45.148.117.119");
  origins.add("http://localhost:8787");
  origins.add("http://127.0.0.1:8787");
  return origins;
}

function emptyState() {
  return {
    score: 0,
    lines: 0,
    level: 1,
    height: 0,
    sentGarbage: 0,
    receivedGarbage: 0,
    mode: "Classic",
    time: "0:00",
    status: "Lobby",
    boardPreview: [],
  };
}

function createRoom(id, _maxPlayers = ROOM_PLAYER_LIMIT, durationSec = 180) {
  return {
    id,
    protocolVersion: 0,
    authoritative: false,
    ranked: false,
    mode: "classic",
    players: new Map(),
    spectators: new Map(),
    maxPlayers: ROOM_PLAYER_LIMIT,
    durationSec: clamp(durationSec, 60, 1800),
    tournament: null,
    match: {
      status: "lobby",
      seed: "",
      startedAt: 0,
      winnerId: "",
      loserId: "",
      reason: "",
    },
    series: {
      active: false,
      seriesId: "",
      bestOf: 3,
      targetWins: 2,
      wins: {},
      matchNumber: 1,
      completed: false,
      winnerId: "",
    },
    lastRankedResult: null,
    countdownTimer: null,
    rematchReady: new Set(),
    reconnects: new Map(),
    authority: {
      matchId: "",
      serverTick: 0,
      states: new Map(),
      inputQueues: new Map(),
      lastSeq: new Map(),
      inputStreams: new Map(),
      externalEvents: new Map(),
      identities: new Map(),
      tickTimer: null,
      snapshotTick: 0,
    },
  };
}

function handleMessage(client, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    safeClose(client, "Bad JSON");
    return;
  }

  if (!isSafePayload(data)) {
    safeClose(client, "Bad payload");
    return;
  }

  if (data.type === "join") {
    if (!validateJoinPayload(data)) {
      metrics.increment("blockdrop_ws_policy_close_total");
      safeClose(client, "Bad join");
      return;
    }
    joinRoom(client, data);
    return;
  }

  if (data.type === "ping") {
    if (!hasOnlyKeys(data, PING_KEYS)) return;
    send(client, { type: "pong", ts: safeNumber(data.ts) });
    return;
  }

  if (!client.room) return;

  if (data.type === "input") {
    if (client.role !== "player" || !client.authoritative) return;
    if (!validateInputShape(data)) {
      metrics.increment("blockdrop_ws_policy_close_total");
      safeClose(client, "Bad input");
      return;
    }
    if (!inputTargetsActiveMatch(client, data)) {
      metrics.increment("blockdrop_ws_stale_input_total");
      const room = rooms.get(client.room);
      if (room?.match.status === "playing") {
        sendAuthoritativeSnapshot(room, client);
      }
      return;
    }
    queueAuthoritativeInput(client, data);
    return;
  }

  if (data.type === "update") {
    if (client.authoritative) {
      safeClose(client, "Protocol v2 accepts input commands only");
      return;
    }
    if (client.role !== "player") return;
    if (!allowTypedMessage(client, "update")) return;
    if (!validateUpdatePayload(client, data)) {
      safeClose(client, "Bad update");
      return;
    }
    updateClientState(client, data);
    broadcastRoom(client.room);
    return;
  }

  if (data.type === "attack") {
    if (client.authoritative) {
      safeClose(client, "Protocol v2 calculates attacks on the server");
      return;
    }
    if (client.role !== "player") return;
    if (!allowTypedMessage(client, "attack")) return;
    if (!validateAttackPayload(client, data)) {
      safeClose(client, "Bad attack");
      return;
    }
    const lines = Number(data.lines);
    if (!allowAttackLines(client, lines)) return;
    if (!consumeAttackCredit(client, lines)) {
      metrics.increment("blockdrop_ranked_attack_rejected_total");
      return;
    }
    broadcastAttack(client, lines);
    return;
  }

  if (data.type === "matchEvent") {
    if (client.authoritative) return;
    if (client.role !== "player") return;
    if (!validateMatchEventPayload(client, data)) {
      safeClose(client, "Bad match event");
      return;
    }
    recordMatchEvent(client, data);
    return;
  }

  if (data.type === "startTournament") {
    if (client.role !== "player") return;
    if (!validateTournamentPayload(client, data)) return;
    startTournament(client.room, data);
    return;
  }

  if (data.type === "rematchReady") {
    if (client.role !== "player") return;
    if (!hasOnlyKeys(data, REMATCH_KEYS) || !matchesClientRoom(client, data))
      return;
    markRematchReady(client);
    return;
  }

  if (data.type === "matchOver") {
    if (client.authoritative) return;
    if (client.role !== "player") return;
    if (!hasOnlyKeys(data, MATCH_OVER_KEYS) || !matchesClientRoom(client, data))
      return;
    finishMatchFromClient(client, data.result);
    return;
  }

  safeClose(client, "Unknown message");
}

function validateInputShape(data) {
  return (
    hasOnlyKeys(data, INPUT_KEYS) &&
    typeof data.matchId === "string" &&
    data.matchId.length > 0 &&
    data.matchId.length <= 160 &&
    isIntegerInRange(data.seq, 1, 2_147_483_647) &&
    isIntegerInRange(data.tick, 0, 60 * 60 * 60) &&
    INPUT_ACTIONS.includes(data.action) &&
    typeof data.pressed === "boolean"
  );
}

function inputTargetsActiveMatch(client, data) {
  const room = rooms.get(client.room);
  return (
    room?.authoritative === true &&
    room.match.status === "playing" &&
    String(data.matchId) === room.authority.matchId
  );
}

function isSafePayload(data) {
  return (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof data.type === "string" &&
    data.type.length <= 32 &&
    Object.keys(data).length <= MAX_PAYLOAD_KEYS
  );
}

function hasOnlyKeys(data, allowed) {
  return Object.keys(data).every((key) => allowed.has(key));
}

function isIntegerInRange(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max;
}

function isSafeShortText(value, maxLength) {
  if (value == null) return true;
  const text = String(value);
  return text.length <= maxLength && !hasUnsafeTextChars(text);
}

function hasUnsafeTextChars(text) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || text[i] === "<" || text[i] === ">") return true;
  }
  return false;
}

function matchesClientRoom(client, data) {
  return !data.room || normalizeRoomId(data.room) === client.room;
}

function validateJoinPayload(data) {
  return (
    hasOnlyKeys(data, JOIN_KEYS) &&
    isSafeShortText(data.name, 40) &&
    isSafeShortText(data.mode, 24) &&
    isIntegerInRange(data.maxPlayers ?? ROOM_PLAYER_LIMIT, 2, 8) &&
    isIntegerInRange(data.durationSec ?? 180, 60, 1800) &&
    (data.protocolVersion == null ||
      isIntegerInRange(data.protocolVersion, 1, PROTOCOL_VERSION)) &&
    (data.ranked == null || typeof data.ranked === "boolean") &&
    (data.rankedQueue == null || typeof data.rankedQueue === "boolean") &&
    String(data.room || "").length <= 32 &&
    normalizePlayerId(data.playerId).length <= 64 &&
    normalizeIdentityToken(data.identityToken).length <= 256 &&
    normalizeIdentityToken(data.accountToken).length <= 256 &&
    normalizeIdentityToken(data.reconnectToken).length <= 256
  );
}

function validateTournamentPayload(client, data) {
  return (
    hasOnlyKeys(data, TOURNAMENT_KEYS) &&
    matchesClientRoom(client, data) &&
    isIntegerInRange(data.maxPlayers ?? ROOM_PLAYER_LIMIT, 2, 8) &&
    isIntegerInRange(data.durationSec ?? 180, 60, 1800) &&
    isSafeShortText(data.mode, 24)
  );
}

function validateUpdatePayload(client, data) {
  if (!hasOnlyKeys(data, UPDATE_KEYS) || !matchesClientRoom(client, data))
    return false;
  if (
    !isSafeShortText(data.name, 40) ||
    !isSafeShortText(data.mode, 24) ||
    !isSafeShortText(data.status, 18)
  )
    return false;
  if (data.time != null && !/^\d{1,3}:\d{2}$/.test(String(data.time)))
    return false;
  if (data.force != null && typeof data.force !== "boolean") return false;
  if (!isSafeBoardPreview(data.boardPreview || data.fieldPreview)) return false;
  const room = rooms.get(client.room);
  if (room?.ranked && room.match.status === "playing") {
    if (safeNumber(data.score) + 500 < client.state.score) return false;
    if (safeNumber(data.lines) < client.state.lines) return false;
    if (safeNumber(data.sentGarbage) < client.state.sentGarbage) return false;
    if (safeNumber(data.receivedGarbage) < client.state.receivedGarbage)
      return false;
    const seconds = parseTimeSeconds(data.time || client.state.time);
    const serverElapsed = Math.max(
      0,
      (Date.now() - room.match.startedAt) / 1000,
    );
    if (seconds > serverElapsed + 20) return false;
  }
  return (
    isIntegerInRange(data.score ?? 0, 0, MAX_RECORD_SCORE) &&
    isIntegerInRange(data.lines ?? 0, 0, 9999) &&
    isIntegerInRange(data.level ?? 1, 1, 99) &&
    isIntegerInRange(data.height ?? 0, 0, 20) &&
    isIntegerInRange(data.sentGarbage ?? 0, 0, 9999) &&
    isIntegerInRange(data.receivedGarbage ?? 0, 0, 9999)
  );
}

function validateAttackPayload(client, data) {
  return (
    hasOnlyKeys(data, ATTACK_KEYS) &&
    matchesClientRoom(client, data) &&
    isIntegerInRange(data.lines, 1, 6)
  );
}

function isSafeBoardPreview(value) {
  if (value == null) return true;
  if (!Array.isArray(value) || value.length > MAX_BOARD_PREVIEW_ROWS)
    return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length <= MAX_BOARD_PREVIEW_COLS &&
      row.every(
        (cell) => cell === 0 || cell === 1 || cell === true || cell === false,
      ),
  );
}

function joinRoom(client, data) {
  removeClient(client, "rejoin");
  removeQueuedClient(client);
  const roomId = normalizeRoomId(data.room) || "LOBBY";
  const room = rooms.get(roomId);
  const requestedProtocol = clamp(
    safeNumber(data.protocolVersion) || 1,
    1,
    PROTOCOL_VERSION,
  );
  const rankedRequested =
    data.rankedQueue === true || data.ranked === true || Boolean(room?.ranked);
  if (rankedRequested && requestedProtocol < 2) {
    send(client, {
      type: "error",
      code: "protocolUpgradeRequired",
      message: "Ranked play requires WebSocket protocol v2",
    });
    return;
  }
  if (
    rankedRequested &&
    !isFeatureEnabled("ranked", client.authTransportAllowed, client.id)
  ) {
    send(client, {
      type: "error",
      code: "rankedDisabled",
      message: "Ranked play is disabled",
    });
    return;
  }
  if (rankedRequested && !client.authTransportAllowed) {
    send(client, {
      type: "error",
      code: "secureTransportRequired",
      message: "Ranked play requires HTTPS",
    });
    return;
  }
  const accountToken = client.authTransportAllowed
    ? normalizeIdentityToken(data.accountToken)
    : "";
  const account = accountToken ? store.getAccountBySession(accountToken) : null;
  if (data.rankedQueue === true) {
    joinRankedQueue(client, data, account, accountToken);
    return;
  }
  const playerId = normalizePlayerId(data.playerId);
  const identityToken = normalizeIdentityToken(data.identityToken);
  const requestedMode = normalizeMatchMode(data.mode);
  const maxPlayers = ROOM_PLAYER_LIMIT;
  const durationSec = clamp(safeNumber(data.durationSec) || 180, 60, 1800);
  let identity = null;
  if (rankedRequested) {
    identity = store.resolveRankedIdentity({
      playerId: playerId || client.id,
      name: data.name,
      identityToken,
      account,
    });
    if (!identity?.accepted) {
      logger.warn("ranked_identity_rejected", {
        roomId,
        playerId: playerId || client.id,
        code: identity?.code || "unknown",
      });
      send(client, {
        type: "error",
        message: "Ranked identity mismatch",
      });
      safeClose(client, "Ranked identity mismatch");
      return;
    }
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId, maxPlayers, durationSec));
  }
  const actualRoom = rooms.get(roomId);
  const casualV2Enabled = isFeatureEnabled("casualV2", false, roomId);
  const selectedProtocol =
    rankedRequested || (requestedProtocol >= 2 && casualV2Enabled) ? 2 : 1;
  if (actualRoom.protocolVersion === 2 && selectedProtocol < 2) {
    send(client, {
      type: "error",
      code: "protocolUpgradeRequired",
      message: "This room requires WebSocket protocol v2",
    });
    return;
  }
  if (!actualRoom.protocolVersion)
    actualRoom.protocolVersion = selectedProtocol;
  client.protocolVersion = actualRoom.protocolVersion;
  client.authoritative = client.protocolVersion === 2;
  actualRoom.authoritative = actualRoom.protocolVersion === 2;
  if (actualRoom.match.status === "lobby") {
    actualRoom.maxPlayers = ROOM_PLAYER_LIMIT;
    actualRoom.durationSec = durationSec;
    if (actualRoom.players.size === 0 && actualRoom.spectators.size === 0) {
      actualRoom.ranked = rankedRequested;
      actualRoom.mode = requestedMode;
    }
  }

  client.room = roomId;
  client.name = cleanName(data.name || normalizePlayerName(data.name));
  client.ranked = Boolean(actualRoom.ranked);
  client.playerId =
    client.ranked && identity?.profile
      ? identity.profile.id
      : client.ranked
        ? playerId || client.id
        : "";
  client.identityToken = identity?.identityToken || "";
  client.accountToken = accountToken;
  client.account = account ? store.publicAccount(account) : null;
  client.rankedProfile = client.ranked ? identity?.profile || null : null;
  client.state = emptyState();

  const reconnectId = findReconnectSlot(
    actualRoom,
    client.name,
    client.playerId,
    normalizeIdentityToken(data.reconnectToken),
    client.protocolVersion,
  );
  if (reconnectId) {
    const slot = actualRoom.reconnects.get(reconnectId);
    clearReconnect(actualRoom, reconnectId);
    client.id = reconnectId;
    client.role = "player";
    client.ranked = Boolean(slot?.ranked || actualRoom.ranked);
    client.playerId = slot?.playerId || client.playerId;
    client.identityToken = slot?.identityToken || client.identityToken;
    client.accountToken = slot?.accountToken || client.accountToken;
    client.account = slot?.account || client.account;
    client.rankedProfile = slot?.rankedProfile || client.rankedProfile;
    client.reconnectToken = slot?.reconnectToken || client.reconnectToken;
    client.pendingInputs = [];
    actualRoom.players.set(client.id, client);
  } else if (
    actualRoom.players.size < actualRoom.maxPlayers &&
    actualRoom.match.status !== "playing"
  ) {
    client.role = "player";
    actualRoom.players.set(client.id, client);
  } else {
    client.role = "spectator";
    actualRoom.spectators.set(client.id, client);
  }

  send(client, {
    type: "hello",
    id: client.id,
    protocolVersion: client.protocolVersion,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    engineVersion: engine.ENGINE_VERSION,
  });
  send(client, {
    type: "protocol",
    selectedVersion: client.protocolVersion,
    authoritative: client.authoritative,
    reconnectToken: client.reconnectToken,
    reconnectGraceMs: RECONNECT_GRACE_MS,
  });
  send(client, { type: "role", role: client.role });
  if (client.rankedProfile) {
    send(client, {
      type: "rankedProfile",
      ...store.publicRankedProfile(client.rankedProfile),
      account: client.account,
    });
  }
  if (client.role === "spectator") {
    send(client, {
      type: "notice",
      code: "spectator",
      message: "Room is full, spectator mode enabled",
    });
  }
  broadcastRoom(roomId);
  updateLiveMetrics();
  if (
    reconnectId &&
    actualRoom.authoritative &&
    actualRoom.match.status === "playing"
  ) {
    sendAuthoritativeSnapshot(actualRoom, client);
  }
  maybeAutoStart(actualRoom);
}

function validateMatchEventPayload(client, data) {
  return (
    hasOnlyKeys(data, MATCH_EVENT_KEYS) &&
    matchesClientRoom(client, data) &&
    isSafeShortText(data.eventType, 24) &&
    isIntegerInRange(data.lines ?? 0, 0, 4) &&
    isIntegerInRange(data.attackLines ?? 0, 0, 12) &&
    isIntegerInRange(data.combo ?? 0, 0, 999) &&
    isIntegerInRange(data.score ?? 0, 0, MAX_RECORD_SCORE) &&
    isIntegerInRange(data.elapsedMs ?? 0, 0, 3 * 60 * 60 * 1000)
  );
}

function joinRankedQueue(client, data, account, accountToken) {
  if (!account) {
    send(client, {
      type: "error",
      message: "Account required for ranked matchmaking",
    });
    return;
  }
  const waiting = rankedQueue.find(
    (entry) =>
      entry.client.socket?.readyState === WebSocket.OPEN &&
      entry.account.id !== account.id,
  );
  client.name = cleanName(account.displayName || data.name);
  client.accountToken = accountToken;
  client.account = store.publicAccount(account);
  client.playerId = `acct.${cleanPlayerId(account.id)}`;
  client.ranked = true;
  client.state = emptyState();
  for (let index = rankedQueue.length - 1; index >= 0; index -= 1) {
    if (rankedQueue[index].account.id === account.id)
      rankedQueue.splice(index, 1);
  }
  if (!waiting) {
    rankedQueue.push({
      client,
      account,
      accountToken,
      data: {
        ...data,
        room: "",
        ranked: true,
        name: client.name,
        playerId: client.playerId,
      },
    });
    send(client, { type: "queued", mode: normalizeMatchMode(data.mode) });
    return;
  }

  rankedQueue.splice(rankedQueue.indexOf(waiting), 1);
  const roomId = `RANK${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  send(waiting.client, { type: "matchFound", room: roomId });
  send(client, { type: "matchFound", room: roomId });
  joinRoom(waiting.client, {
    ...waiting.data,
    room: roomId,
    ranked: true,
    rankedQueue: false,
    accountToken: waiting.accountToken,
  });
  joinRoom(client, {
    ...data,
    room: roomId,
    ranked: true,
    rankedQueue: false,
    accountToken,
    name: client.name,
    playerId: client.playerId,
  });
}

function removeQueuedClient(client) {
  const index = rankedQueue.findIndex((entry) => entry.client === client);
  if (index >= 0) rankedQueue.splice(index, 1);
}

function findReconnectSlot(
  room,
  name,
  playerId = "",
  reconnectToken = "",
  protocolVersion = 1,
) {
  const normalized = cleanName(name).toLowerCase();
  const safePlayerId = cleanPlayerId(playerId);
  for (const [id, slot] of room.reconnects.entries()) {
    if (
      reconnectToken &&
      timingSafeEqualText(reconnectToken, slot.reconnectToken || "")
    ) {
      return id;
    }
    if (protocolVersion >= 2) continue;
    if (safePlayerId && slot.playerId === safePlayerId) return id;
    if (slot.name.toLowerCase() === normalized) return id;
  }
  return "";
}

function clearReconnect(room, id) {
  const slot = room.reconnects.get(id);
  if (slot?.timer) clearTimeout(slot.timer);
  room.reconnects.delete(id);
}

function updateClientState(client, data) {
  client.name = cleanName(data.name || client.name);
  client.state = {
    score: clamp(safeNumber(data.score), 0, 99999999),
    lines: clamp(safeNumber(data.lines), 0, 9999),
    level: clamp(safeNumber(data.level), 1, 99),
    height: clamp(safeNumber(data.height), 0, 20),
    sentGarbage: clamp(safeNumber(data.sentGarbage), 0, 9999),
    receivedGarbage: clamp(safeNumber(data.receivedGarbage), 0, 9999),
    mode: String(data.mode || "Classic").slice(0, 24),
    time: String(data.time || "0:00").slice(0, 12),
    status: String(data.status || "Playing").slice(0, 18),
    boardPreview: sanitizeBoardPreview(data.boardPreview || data.fieldPreview),
  };
}

function startTournament(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.maxPlayers = ROOM_PLAYER_LIMIT;
  room.durationSec = clamp(
    safeNumber(data.durationSec) || room.durationSec,
    60,
    1800,
  );
  if (room.match.status === "lobby") {
    room.mode = normalizeMatchMode(data.mode || room.mode);
  }
  room.tournament = {
    active: true,
    startedAt: Date.now(),
    endsAt: Date.now() + room.durationSec * 1000,
    maxPlayers: room.maxPlayers,
    durationSec: room.durationSec,
  };
  broadcastRoom(roomId);
  scheduleTournamentEnd(roomId, room.durationSec * 1000 + 250);
}

function maybeAutoStart(room) {
  if (!room || room.maxPlayers !== ROOM_PLAYER_LIMIT) return;
  if (room.match.status !== "lobby" && room.match.status !== "finished") return;
  if (room.players.size !== 2 || room.countdownTimer) return;
  if (room.ranked && !room.series.active) startRankedSeries(room);
  startCountdown(room, "matchStart");
}

function startRankedSeries(room) {
  room.series = {
    active: true,
    seriesId: `series:${room.id}:${Date.now()}`,
    bestOf: 3,
    targetWins: 2,
    wins: Object.fromEntries([...room.players.keys()].map((id) => [id, 0])),
    matchNumber: 1,
    completed: false,
    winnerId: "",
  };
  room.lastRankedResult = null;
}

function startCountdown(room, finalType) {
  room.match.status = "countdown";
  room.match.seed = `pvp:${room.id}:${Date.now()}:${Math.random()}`;
  room.rematchReady.clear();
  let value = 3;
  const tick = () => {
    if (!rooms.has(room.id) || room.players.size < 2) {
      room.match.status = "lobby";
      room.countdownTimer = null;
      broadcastRoom(room.id);
      return;
    }
    if (value > 0) {
      broadcast(room, { type: "countdown", value });
      value -= 1;
      room.countdownTimer = setTimeout(tick, COUNTDOWN_STEP_MS);
      return;
    }
    room.countdownTimer = null;
    room.match.status = "playing";
    room.match.startedAt = Date.now();
    room.match.winnerId = "";
    room.match.loserId = "";
    room.match.reason = "";
    for (const player of room.players.values()) {
      player.state = emptyState();
      player.attackCredit = 0;
      player.lastRankedEventAt = 0;
    }
    if (room.authoritative) startAuthoritativeMatch(room);
    broadcast(room, {
      type: finalType,
      seed: room.match.seed,
      matchId: room.authority.matchId || room.match.seed,
      mode: room.mode,
      startedAt: room.match.startedAt,
      protocolVersion: room.protocolVersion,
      engineVersion: engine.ENGINE_VERSION,
      authoritative: room.authoritative,
    });
    if (room.authoritative) sendAuthoritativeSnapshots(room, true);
    broadcastRoom(room.id);
  };
  tick();
}

function startAuthoritativeMatch(room) {
  stopAuthoritativeMatch(room);
  const authority = room.authority;
  authority.matchId = `match:${room.id}:${crypto.randomUUID()}`;
  authority.serverTick = 0;
  authority.snapshotTick = 0;
  authority.states = new Map();
  authority.inputQueues = new Map();
  authority.lastSeq = new Map();
  authority.inputStreams = new Map();
  authority.externalEvents = new Map();
  authority.identities = new Map();
  for (const player of [...room.players.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const gameState = engine.createState({
      seed: room.match.seed,
      mode: room.mode,
    });
    authority.states.set(player.id, gameState);
    authority.inputQueues.set(player.id, new Map());
    authority.lastSeq.set(player.id, 0);
    authority.inputStreams.set(player.id, []);
    authority.externalEvents.set(player.id, []);
    authority.identities.set(player.id, player.playerId || player.id);
    updateClientFromEngine(player, gameState);
  }
  store.createMatchSession({
    id: authority.matchId,
    roomId: room.id,
    protocolVersion: room.protocolVersion,
    engineVersion: engine.ENGINE_VERSION,
    mode: room.mode,
    seed: room.match.seed,
    status: "playing",
    createdAt: room.match.startedAt,
    startedAt: room.match.startedAt,
    expiresAt: room.match.startedAt + 30 * 24 * 60 * 60 * 1000,
  });
  authority.tickTimer = setInterval(
    () => tickAuthoritativeMatch(room.id),
    MATCH_TICK_MS,
  );
  authority.tickTimer.unref?.();
}

function stopAuthoritativeMatch(room) {
  if (room?.authority?.tickTimer) clearInterval(room.authority.tickTimer);
  if (room?.authority) room.authority.tickTimer = null;
}

function queueAuthoritativeInput(client, data) {
  const room = rooms.get(client.room);
  const state = room?.authority.states.get(client.id);
  const queue = room?.authority.inputQueues.get(client.id);
  if (!room || !state || !queue) return;
  const seq = safeNumber(data.seq);
  if (seq <= state.lastAckSeq || queue.has(seq)) {
    sendAuthoritativeSnapshot(room, client);
    return;
  }
  if (seq > state.lastAckSeq + 120) {
    safeClose(client, "Input sequence too far ahead");
    return;
  }
  const input = {
    tick: clamp(safeNumber(data.tick), 0, state.tick + 120),
    seq,
    action: data.action,
    pressed: data.pressed !== false,
  };
  queue.set(seq, input);
  room.authority.lastSeq.set(
    client.id,
    Math.max(seq, room.authority.lastSeq.get(client.id) || 0),
  );
  store.appendMatchInput({
    matchId: room.authority.matchId,
    playerId: client.playerId || client.id,
    ...input,
  });
}

function drainAuthoritativeInputs(room, playerId, state) {
  const queue = room.authority.inputQueues.get(playerId);
  if (!queue) return [];
  const inputs = [];
  let expectedSeq = state.lastAckSeq + 1;
  while (inputs.length < 32) {
    const input = queue.get(expectedSeq);
    if (!input || input.tick > state.tick + 6) break;
    queue.delete(expectedSeq);
    inputs.push(input);
    room.authority.inputStreams.get(playerId)?.push(input);
    expectedSeq += 1;
  }
  return inputs;
}

function tickAuthoritativeMatch(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.authoritative || room.match.status !== "playing") {
    if (room) stopAuthoritativeMatch(room);
    return;
  }
  const orderedIds = [...room.authority.states.keys()].sort();
  const results = [];
  const allEvents = [];
  const tickStartedAt = performance.now();
  for (const playerId of orderedIds) {
    const state = room.authority.states.get(playerId);
    if (!state || state.gameOver) continue;
    const inputs = drainAuthoritativeInputs(room, playerId, state);
    const { events } = engine.step(state, inputs);
    const player = room.players.get(playerId);
    if (player) updateClientFromEngine(player, state);
    for (const event of events) {
      allEvents.push({ playerId, ...event });
      if (event.type === "lock" && event.attack > 0) {
        const targetId = orderedIds.find((id) => id !== playerId);
        const targetState = targetId
          ? room.authority.states.get(targetId)
          : null;
        if (targetState && !targetState.gameOver) {
          engine.queueGarbage(targetState, event.attack);
          room.authority.externalEvents.get(targetId)?.push({
            tick: targetState.tick,
            type: "garbage",
            lines: event.attack,
          });
          allEvents.push({
            type: "garbageQueued",
            tick: state.tick,
            playerId,
            targetId,
            lines: event.attack,
          });
        }
      }
      if (event.type === "gameResult") {
        results.push({ playerId, won: Boolean(event.won), state });
      }
    }
    if (
      state.gameOver &&
      !results.some((result) => result.playerId === playerId)
    ) {
      results.push({ playerId, won: Boolean(state.won), state });
    }
  }
  room.authority.serverTick += 1;
  metrics.observe?.(
    "blockdrop_match_processing_ms",
    Math.max(0, performance.now() - tickStartedAt),
  );
  for (const event of allEvents) {
    broadcast(room, {
      type: "match.event",
      matchId: room.authority.matchId,
      serverTick: room.authority.serverTick,
      event,
    });
  }
  if (results.length) {
    finishAuthoritativeResult(room, results, orderedIds);
    return;
  }
  if (
    room.authority.serverTick - room.authority.snapshotTick >=
    SNAPSHOT_INTERVAL_TICKS
  ) {
    room.authority.snapshotTick = room.authority.serverTick;
    sendAuthoritativeSnapshots(room);
  }
}

function finishAuthoritativeResult(room, results, orderedIds) {
  const winningResult = results.find((result) => result.won);
  let winnerId = winningResult?.playerId || "";
  if (!winnerId) {
    winnerId = orderedIds.find(
      (id) => !room.authority.states.get(id)?.gameOver,
    );
  }
  if (!winnerId) {
    winnerId = [...orderedIds].sort((left, right) => {
      const leftState = room.authority.states.get(left);
      const rightState = room.authority.states.get(right);
      return (
        rightState.score - leftState.score ||
        rightState.lines - leftState.lines ||
        left.localeCompare(right)
      );
    })[0];
  }
  const loserId = orderedIds.find((id) => id !== winnerId) || "";
  finishMatch(room, {
    reason: winningResult ? "goal" : "gameOver",
    winnerId,
    loserId,
  });
}

function updateClientFromEngine(client, state) {
  const boardPreview = state.board
    .slice(-MAX_BOARD_PREVIEW_ROWS)
    .map((row) => row.map((cell) => (cell ? 1 : 0)));
  client.state = {
    score: state.score,
    lines: state.lines,
    level: state.level,
    height: state.board.findIndex((row) => row.some(Boolean)),
    sentGarbage: state.sentGarbage,
    receivedGarbage: state.receivedGarbage,
    mode: state.mode,
    time: formatTickTime(state.tick),
    status: state.gameOver ? (state.won ? "Won" : "Finished") : "Playing",
    boardPreview,
  };
  if (client.state.height < 0) client.state.height = 0;
  else client.state.height = engine.ROWS - client.state.height;
}

function formatTickTime(tick) {
  const totalSeconds = Math.floor(safeNumber(tick) / engine.TICK_RATE);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function authoritativeOpponentPayload(room, ownId) {
  return [...room.authority.states.entries()]
    .filter(([id]) => id !== ownId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, state]) => ({
      id,
      board: state.board,
      active: state.active,
      stats: {
        score: state.score,
        lines: state.lines,
        level: state.level,
        combo: state.combo,
        sentGarbage: state.sentGarbage,
        receivedGarbage: state.receivedGarbage,
      },
      pendingGarbage: state.pendingGarbage,
      gameOver: state.gameOver,
    }));
}

function sendAuthoritativeSnapshot(room, client) {
  const state = room.authority.states.get(client.id);
  if (!state) return;
  const gameSnapshot = engine.snapshot(state);
  send(client, {
    type: "match.snapshot",
    matchId: room.authority.matchId,
    serverTick: room.authority.serverTick,
    ackSeq: state.lastAckSeq,
    board: gameSnapshot.board,
    active: gameSnapshot.active,
    queue: gameSnapshot.queue.slice(0, 5),
    hold: gameSnapshot.hold,
    stats: {
      score: gameSnapshot.score,
      lines: gameSnapshot.lines,
      level: gameSnapshot.level,
      combo: gameSnapshot.combo,
      sentGarbage: gameSnapshot.sentGarbage,
      receivedGarbage: gameSnapshot.receivedGarbage,
    },
    pendingGarbage: gameSnapshot.pendingGarbage,
    gameSnapshot,
    opponents: authoritativeOpponentPayload(room, client.id),
  });
}

function sendAuthoritativeSnapshots(room, includeSpectators = false) {
  for (const client of room.players.values()) {
    sendAuthoritativeSnapshot(room, client);
  }
  if (includeSpectators || room.spectators.size) {
    const players = authoritativeOpponentPayload(room, "");
    broadcast(
      room,
      {
        type: "match.snapshot",
        matchId: room.authority.matchId,
        serverTick: room.authority.serverTick,
        spectator: true,
        players,
      },
      (client) => client.role === "spectator",
    );
  }
}

function markRematchReady(client) {
  const room = rooms.get(client.room);
  if (!room || client.role !== "player") return;
  if (room.players.size < 2) {
    send(client, { type: "error", message: "Opponent left" });
    return;
  }
  room.rematchReady.add(client.id);
  broadcastRoom(room.id);
  const allReady = [...room.players.keys()].every((id) =>
    room.rematchReady.has(id),
  );
  if (allReady) {
    if (room.ranked && room.series.completed) startRankedSeries(room);
    else if (room.ranked && !room.series.active) startRankedSeries(room);
    startCountdown(room, "rematchStart");
  }
}

function finishMatchFromClient(client, result) {
  const room = rooms.get(client.room);
  if (!room || room.match.status !== "playing") return;
  const other = [...room.players.values()].find(
    (player) => player.id !== client.id,
  );
  if (!other) return;
  const clientWon = room.ranked ? false : result === "win";
  finishMatch(room, {
    reason: "gameOver",
    winnerId: clientWon ? client.id : other.id,
    loserId: clientWon ? other.id : client.id,
  });
}

function finishMatch(room, { reason, winnerId, loserId }) {
  stopAuthoritativeMatch(room);
  room.match.status = "finished";
  room.match.reason = reason;
  room.match.winnerId = winnerId;
  room.match.loserId = loserId;
  room.rematchReady.clear();
  const ranked = room.ranked
    ? finalizeRankedMatch(room, { winnerId, loserId, reason })
    : null;
  if (room.authoritative && room.authority.matchId) {
    const result = {
      reason,
      winnerId,
      loserId,
      finishedAt: Date.now(),
    };
    const checksum = engine.checksum(
      [...room.authority.states.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, state]) => [id, engine.snapshot(state)]),
    );
    persistAuthoritativeReplays(room, result);
    store.createMatchSession({
      id: room.authority.matchId,
      roomId: room.id,
      protocolVersion: room.protocolVersion,
      engineVersion: engine.ENGINE_VERSION,
      mode: room.mode,
      seed: room.match.seed,
      status: "finished",
      result,
      checksum,
      verificationStatus: "verified",
      createdAt: room.match.startedAt,
      startedAt: room.match.startedAt,
      finishedAt: result.finishedAt,
      expiresAt: result.finishedAt + 30 * 24 * 60 * 60 * 1000,
    });
    broadcast(room, {
      type: "match.result",
      matchId: room.authority.matchId,
      serverTick: room.authority.serverTick,
      checksum,
      ...result,
    });
  }
  broadcast(room, {
    type: "matchFinished",
    reason,
    winnerId,
    loserId,
    ranked,
    series: seriesPayload(room),
  });
  broadcastRoom(room.id);
}

function persistAuthoritativeReplays(room, result) {
  const createdAt = Number(room.match.startedAt) || Date.now();
  const expiresAt = Number(result.finishedAt) + 30 * 24 * 60 * 60 * 1000;
  for (const [connectionId, finalState] of room.authority.states.entries()) {
    const replay = engine.createReplay({
      seed: room.match.seed,
      mode: room.mode,
      inputs: room.authority.inputStreams.get(connectionId) || [],
      externalEvents: room.authority.externalEvents.get(connectionId) || [],
      finalState,
      metadata: {
        matchId: room.authority.matchId,
        connectionId,
        winnerId: result.winnerId,
        loserId: result.loserId,
        reason: result.reason,
        ranked: room.ranked,
      },
    });
    const verification = engine.simulateReplay(replay);
    store.saveReplay({
      id: `${room.authority.matchId}:${connectionId}`,
      matchId: room.authority.matchId,
      playerId: room.authority.identities.get(connectionId) || connectionId,
      mode: room.mode,
      engineVersion: engine.ENGINE_VERSION,
      replaySchemaVersion: engine.REPLAY_VERSION,
      seed: room.match.seed,
      inputStream: {
        inputs: replay.inputs,
        externalEvents: replay.externalEvents,
        finalTick: replay.finalTick,
        metadata: replay.metadata,
      },
      checkpoints: replay.checkpoints,
      result,
      checksum: replay.finalChecksum,
      verificationStatus: verification.ok ? "verified" : verification.code,
      createdAt,
      expiresAt,
    });
  }
}

function finalizeRankedMatch(room, { winnerId, loserId, reason }) {
  const winner = rankedParticipant(room, winnerId);
  const loser = rankedParticipant(room, loserId);
  if (
    !winner?.playerId ||
    !loser?.playerId ||
    winner.playerId === loser.playerId
  )
    return null;

  const winnerBefore = store.normalizeRankedPlayer(
    store.getRankedProfile(winner.playerId, winner.name),
    winner.playerId,
    winner.name,
  );
  const loserBefore = store.normalizeRankedPlayer(
    store.getRankedProfile(loser.playerId, loser.name),
    loser.playerId,
    loser.name,
  );
  const expectedWinner =
    1 / (1 + 10 ** ((loserBefore.rating - winnerBefore.rating) / 400));
  const delta = clamp(
    Math.round(RANKED_K_FACTOR * (1 - expectedWinner)),
    8,
    RANKED_K_FACTOR,
  );
  const winnerAfter = {
    ...winnerBefore,
    name: cleanName(winner.name),
    rating: clamp(
      winnerBefore.rating + delta,
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    ),
    wins: winnerBefore.wins + 1,
    streak: winnerBefore.streak >= 0 ? winnerBefore.streak + 1 : 1,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    identitySecret: winnerBefore.identitySecret,
  };
  winnerAfter.bestWinStreak = Math.max(
    winnerAfter.bestWinStreak,
    winnerAfter.streak,
  );
  const loserAfter = {
    ...loserBefore,
    name: cleanName(loser.name),
    rating: clamp(
      loserBefore.rating - delta,
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    ),
    losses: loserBefore.losses + 1,
    streak: loserBefore.streak <= 0 ? loserBefore.streak - 1 : -1,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    identitySecret: loserBefore.identitySecret,
  };
  loserAfter.bestLossStreak = Math.max(
    loserAfter.bestLossStreak,
    Math.abs(loserAfter.streak),
  );

  const winnerSaved = store.upsertRankedProfile(winnerAfter);
  const loserSaved = store.upsertRankedProfile(loserAfter);
  applyRankedProfileToParticipant(room, winnerId, winnerSaved);
  applyRankedProfileToParticipant(room, loserId, loserSaved);

  const matchIndex = room.series?.matchNumber || 1;

  if (room.series.active && !room.series.completed) {
    room.series.wins[winnerId] = (room.series.wins[winnerId] || 0) + 1;
    if (room.series.wins[winnerId] >= room.series.targetWins) {
      room.series.completed = true;
      room.series.winnerId = winnerId;
    } else {
      room.series.matchNumber += 1;
    }
  }

  room.lastRankedResult = {
    reason,
    winner: rankedResultPayload(winner, winnerBefore, winnerSaved),
    loser: rankedResultPayload(loser, loserBefore, loserSaved),
    series: seriesPayload(room),
  };
  store.logRankedMatch({
    id: `${room.series?.seriesId || room.id}:${matchIndex}:${winner.playerId}:${loser.playerId}`,
    roomId: room.id,
    seriesId: room.series?.seriesId || `series:${room.id}`,
    matchIndex,
    mode: room.mode,
    reason,
    startedAt: room.match.startedAt || Date.now(),
    finishedAt: Date.now(),
    winner: room.lastRankedResult.winner,
    loser: room.lastRankedResult.loser,
  });
  metrics.increment("blockdrop_ranked_matches_total");
  logger.info("ranked_match_logged", {
    roomId: room.id,
    reason,
    winnerId: winner.playerId,
    loserId: loser.playerId,
    matchIndex,
  });
  return room.lastRankedResult;
}

function recordMatchEvent(client, data) {
  const room = rooms.get(client.room);
  if (!room || room.match.status !== "playing") return;
  const elapsedMs = safeNumber(data.elapsedMs);
  if (room.ranked) {
    const startedElapsed = Date.now() - room.match.startedAt;
    if (elapsedMs > startedElapsed + 15000) return;
    const attackLines = clamp(safeNumber(data.attackLines), 0, 12);
    const lines = clamp(safeNumber(data.lines), 0, 4);
    if (attackLines > maxAttackForEvent(lines, safeNumber(data.combo))) {
      metrics.increment("blockdrop_ranked_event_rejected_total");
      return;
    }
    client.attackCredit = clamp(client.attackCredit + attackLines, 0, 24);
    client.lastRankedEventAt = Date.now();
    store.logRankedEvent({
      matchId: room.match.seed,
      roomId: room.id,
      playerId: client.playerId || client.id,
      eventType: data.eventType,
      lines,
      attackLines,
      combo: data.combo,
      score: data.score,
      elapsedMs,
    });
    metrics.increment("blockdrop_ranked_events_received_total");
  }
}

function maxAttackForEvent(lines, combo) {
  const base = [0, 0, 1, 2, 4][clamp(lines, 0, 4)] || 0;
  const comboBonus = combo >= 2 ? Math.min(4, Math.floor(combo / 2)) : 0;
  return Math.min(12, base + comboBonus + 4);
}

function rankedParticipant(room, id) {
  const client = room.players.get(id);
  if (client) {
    return {
      id,
      playerId: client.playerId,
      name: client.name,
      state: client.state,
    };
  }
  const slot = room.reconnects.get(id);
  if (!slot) return null;
  return {
    id,
    playerId: slot.playerId,
    name: slot.name,
    state: slot.state,
  };
}

function applyRankedProfileToParticipant(room, id, profile) {
  const client = room.players.get(id);
  if (client) client.rankedProfile = profile;
  const slot = room.reconnects.get(id);
  if (slot) slot.rankedProfile = profile;
}

function rankedResultPayload(participant, before, after) {
  return {
    id: participant.id,
    playerId: participant.playerId,
    name: participant.name,
    ratingBefore: before.rating,
    ratingAfter: after.rating,
    ratingDelta: after.rating - before.rating,
    streak: after.streak,
    bestWinStreak: after.bestWinStreak,
    bestLossStreak: after.bestLossStreak,
    stats: {
      score: participant.state.score,
      lines: participant.state.lines,
      sentGarbage: participant.state.sentGarbage,
      receivedGarbage: participant.state.receivedGarbage,
      time: participant.state.time,
    },
  };
}

function allowMessage(client) {
  const now = Date.now();
  if (now - client.buckets.windowStartedAt > 10000) {
    client.buckets.windowStartedAt = now;
    client.buckets.messages = 0;
  }
  client.buckets.messages += 1;
  return client.buckets.messages <= MAX_MESSAGES_PER_10S;
}

function allowTypedMessage(client, type) {
  const now = Date.now();
  const key = type === "attack" ? "attack" : "update";
  const max =
    type === "attack" ? MAX_ATTACKS_PER_SECOND : MAX_UPDATES_PER_SECOND;
  const startedKey = `${key}StartedAt`;
  const countKey = `${key}s`;
  if (now - client.buckets[startedKey] > 1000) {
    client.buckets[startedKey] = now;
    client.buckets[countKey] = 0;
  }
  client.buckets[countKey] += 1;
  return client.buckets[countKey] <= max;
}

function allowAttackLines(client, lines) {
  const now = Date.now();
  if (now - client.buckets.attackLinesStartedAt > 10000) {
    client.buckets.attackLinesStartedAt = now;
    client.buckets.attackLines = 0;
  }
  client.buckets.attackLines += lines;
  return client.buckets.attackLines <= MAX_ATTACK_LINES_PER_10S;
}

function consumeAttackCredit(client, lines) {
  const room = rooms.get(client.room);
  if (!room?.ranked) return true;
  if (Date.now() - client.lastRankedEventAt > 5000) return false;
  if (client.attackCredit < lines) return false;
  client.attackCredit -= lines;
  return true;
}

function safeClose(client, reason = "Policy violation") {
  logger.warn("ws_policy_close", {
    connectionId: client.id,
    roomId: client.room,
    matchId: client.matchId,
    reason: String(reason).slice(0, 120),
  });
  send(client, { type: "error", message: reason });
  removeClient(client, "policy");
  try {
    client.socket.close(1008, String(reason).slice(0, 120));
    setTimeout(() => {
      if (client.socket.readyState !== WebSocket.CLOSED)
        client.socket.terminate();
    }, 1000).unref?.();
  } catch {
    return;
  }
}

function scheduleTournamentEnd(roomId, delay) {
  setTimeout(() => {
    const room = rooms.get(roomId);
    if (
      !room ||
      !room.tournament?.active ||
      Date.now() < room.tournament.endsAt
    )
      return;
    room.tournament.active = false;
    broadcast(room, {
      type: "tournamentEnd",
      tournament: tournamentPayload(room),
      players: playersPayload(room),
    });
    broadcastRoom(roomId);
  }, delay);
}

function broadcastAttack(attacker, lines) {
  const room = rooms.get(attacker.room);
  if (!room || lines <= 0) return;
  broadcast(
    room,
    {
      type: "garbage",
      from: attacker.name,
      fromId: attacker.id,
      lines: clamp(lines, 1, 6),
    },
    (client) => client.id !== attacker.id,
  );
  broadcast(
    room,
    {
      type: "attack",
      from: attacker.name,
      lines: clamp(lines, 1, 6),
    },
    (client) => client.id !== attacker.id,
  );
}

function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcast(room, {
    type: "state",
    room: roomId,
    tournament: tournamentPayload(room),
    match: matchPayload(room),
    players: playersPayload(room),
    spectators: spectatorsPayload(room),
  });
  broadcast(room, {
    type: "roomState",
    room: roomId,
    tournament: tournamentPayload(room),
    match: matchPayload(room),
    players: Object.values(playersPayload(room)),
    spectators: Object.values(spectatorsPayload(room)),
  });
}

function broadcast(room, payload, predicate = () => true) {
  const message = JSON.stringify(payload);
  for (const client of [
    ...room.players.values(),
    ...room.spectators.values(),
  ]) {
    if (predicate(client) && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}

function send(client, payload) {
  try {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(payload));
    }
  } catch {
    // Ignore writes to already closed sockets.
  }
}

function tournamentPayload(room) {
  if (!room.tournament) {
    return {
      active: false,
      maxPlayers: room.maxPlayers,
      durationSec: room.durationSec,
      timeLeftMs: 0,
    };
  }
  return {
    ...room.tournament,
    timeLeftMs: Math.max(0, room.tournament.endsAt - Date.now()),
  };
}

function matchPayload(room) {
  return {
    ...room.match,
    mode: room.mode,
    ranked: room.ranked,
    protocolVersion: room.protocolVersion,
    authoritative: room.authoritative,
    matchId: room.authority.matchId || room.match.seed,
    serverTick: room.authority.serverTick,
    series: seriesPayload(room),
    rankedResult: room.lastRankedResult,
    rematchReady: [...room.rematchReady],
    reconnecting: [...room.reconnects.entries()].map(([id, slot]) => ({
      id,
      name: slot.name,
      remainingMs: Math.max(0, slot.expiresAt - Date.now()),
    })),
  };
}

function seriesPayload(room) {
  return {
    ...room.series,
    wins: { ...room.series.wins },
  };
}

function playersPayload(room) {
  const players = {};
  for (const client of room.players.values()) {
    players[client.id] = {
      id: client.id,
      role: "player",
      ranked: client.ranked,
      rating: client.rankedProfile?.rating,
      streak: client.rankedProfile?.streak,
      account: client.account,
      name: client.name,
      ...client.state,
    };
  }
  for (const [id, slot] of room.reconnects.entries()) {
    players[id] = {
      id,
      role: "player",
      ranked: slot.ranked,
      rating: slot.rankedProfile?.rating,
      streak: slot.rankedProfile?.streak,
      account: slot.account,
      name: slot.name,
      disconnected: true,
      ...slot.state,
    };
  }
  return players;
}

function spectatorsPayload(room) {
  const spectators = {};
  for (const client of room.spectators.values()) {
    spectators[client.id] = {
      id: client.id,
      role: "spectator",
      name: client.name,
    };
  }
  return spectators;
}

function removeClient(client, reason = "close") {
  removeQueuedClient(client);
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;
  const roomId = client.room;
  if (client.role === "spectator") {
    room.spectators.delete(client.id);
  } else if (room.players.has(client.id)) {
    room.players.delete(client.id);
    if (room.match.status === "playing" && reason !== "rejoin") {
      const expiresAt = Date.now() + RECONNECT_GRACE_MS;
      const id = client.id;
      const timer = setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (!currentRoom || !currentRoom.reconnects.has(id)) return;
        currentRoom.reconnects.delete(id);
        const winner = [...currentRoom.players.keys()][0];
        if (winner) {
          finishMatch(currentRoom, {
            reason: "disconnect",
            winnerId: winner,
            loserId: id,
          });
        } else if (
          currentRoom.players.size === 0 &&
          currentRoom.spectators.size === 0
        ) {
          if (currentRoom.match.status === "playing") {
            metrics.increment("blockdrop_match_abort_total");
          }
          stopAuthoritativeMatch(currentRoom);
          rooms.delete(roomId);
        } else {
          currentRoom.match.status = "finished";
          broadcastRoom(roomId);
        }
      }, RECONNECT_GRACE_MS);
      room.reconnects.set(id, {
        name: client.name,
        ranked: client.ranked,
        playerId: client.playerId,
        identityToken: client.identityToken,
        accountToken: client.accountToken,
        account: client.account,
        rankedProfile: client.rankedProfile,
        reconnectToken: client.reconnectToken,
        state: client.state,
        expiresAt,
        timer,
      });
      broadcast(room, {
        type: "reconnecting",
        playerId: id,
        name: client.name,
      });
    }
  }
  client.room = "";
  if (
    room.players.size === 0 &&
    room.spectators.size === 0 &&
    room.reconnects.size === 0
  ) {
    if (room.match.status === "playing") {
      metrics.increment("blockdrop_match_abort_total");
    }
    stopAuthoritativeMatch(room);
    rooms.delete(roomId);
  } else {
    broadcastRoom(roomId);
  }
  updateLiveMetrics();
}

function cleanPlayerId(value) {
  return normalizePlayerId(value);
}

function cleanName(value) {
  return normalizePlayerName(value);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const roomMetricsTimer = setInterval(() => {
  updateLiveMetrics();
  for (const roomId of rooms.keys()) broadcastRoom(roomId);
}, 1000);
roomMetricsTimer.unref();

function pruneProductData() {
  try {
    const removed = store.pruneExpiredProductData();
    if (Object.values(removed).some(Boolean)) {
      logger.info("expired_product_data_pruned", removed);
    }
  } catch (error) {
    const message = String(error?.message || error);
    metrics.increment("blockdrop_db_errors_total");
    if (/busy|locked/i.test(message)) {
      metrics.increment("blockdrop_db_lock_errors_total");
    }
    logger.error("product_data_prune_failed", {
      error: message.slice(0, 240),
    });
  }
}

pruneProductData();
const productDataPruneTimer = setInterval(
  pruneProductData,
  60 * 60 * 1000,
);
productDataPruneTimer.unref();

store.insertDeployAudit({
  revision: readRevision(),
  version: readPackageMeta().version,
  reason: process.env.BLOCKDROP_DEPLOY_REASON || "startup",
});

let shutdownStarted = false;

function closeStoreAndExit(code) {
  try {
    store.db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    logger.error("shutdown_checkpoint_failed", {
      error: String(error?.message || error).slice(0, 240),
    });
  }
  try {
    store.db.close();
  } catch {
    // The store may already be closed by a completed shutdown callback.
  }
  process.exit(code);
}

function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info("server_shutdown_started", { signal });
  clearInterval(operationalMetricsTimer);
  clearInterval(roomMetricsTimer);
  clearInterval(productDataPruneTimer);
  for (const room of rooms.values()) stopAuthoritativeMatch(room);
  for (const socket of webSocketServer.clients) {
    try {
      socket.close(1012, "Server restart");
    } catch {
      socket.terminate();
    }
  }
  webSocketServer.close();
  server.close(() => closeStoreAndExit(0));
  server.closeIdleConnections?.();
  const deadline = setTimeout(() => {
    server.closeAllConnections?.();
    closeStoreAndExit(1);
  }, 5000);
  deadline.unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, () => {
  updateLiveMetrics();
  logger.info("server_started", {
    port: PORT,
    version: readPackageMeta().version,
    revision: readRevision(),
    url: `http://localhost:${PORT}`,
  });
  console.log(`BlockDrop server: http://localhost:${PORT}`);
});
