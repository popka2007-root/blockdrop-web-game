const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const QRCode = require("qrcode");
const {
  clientAddress,
  isSensitiveTransportAllowed,
} = require("./server-transport");
const protocol = require("./shared/protocol.js");
const engine = require("./shared/engine.js");

const HTTP_RATE_WINDOW_MS = 10 * 60 * 1000;
const {
  MAX_RECORD_SCORE,
  PROTOCOL_VERSION,
  ROOM_PLAYER_LIMIT,
  normalizeIdentityToken,
} = protocol;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const SECURITY_HEADERS = {
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

let cachedPackageMeta = null;

function createHttpRouter({
  store,
  logger,
  metrics,
  rooms,
  rankedQueue,
  startedAt,
  rootDir,
}) {
  const httpRateBuckets = new Map();

  function safeDecodePath(pathname) {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return "";
    }
  }

  function writeHead(res, status, extraHeaders = {}) {
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      ...extraHeaders,
    });
  }

  function sendJson(res, data, status = 200, extraHeaders = {}) {
    writeHead(res, status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    res.end(JSON.stringify(data));
  }

  function sendRateLimited(res) {
    sendJson(res, { error: "Too many requests" }, 429, {
      "Retry-After": "60",
    });
  }

  function allowHttpRequest(req, action, maxRequests, windowMs) {
    const address = clientAddress(req);
    const key = `${action}:${address}`;
    const now = Date.now();
    let bucket = httpRateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      httpRateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (httpRateBuckets.size > 5000) {
      for (const [k, b] of httpRateBuckets.entries()) {
        if (b.resetAt <= now) httpRateBuckets.delete(k);
      }
    }
    return bucket.count <= maxRequests;
  }

  function readPackageMeta() {
    if (cachedPackageMeta) return cachedPackageMeta;
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
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

  function readRevision() {
    if (process.env.BLOCKDROP_REVISION) return process.env.BLOCKDROP_REVISION;
    try {
      return (
        fs
          .readFileSync(path.join(rootDir, "REVISION"), "utf8")
          .trim()
          .slice(0, 64) || "unknown"
      );
    } catch {
      return "unknown";
    }
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

  function handleHealth(req, res) {
    handleReadiness(req, res, true);
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
      pwaInstallEnabled: isFeatureEnabled(
        "pwaInstall",
        secureTransport,
        bucket,
      ),
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

  function handleHttpRequest(req, res) {
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
          path: String(req.url || "")
            .split("?")[0]
            .slice(0, 160),
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
    const filePath = path.join(rootDir, safePath);

    const relativePath = path.relative(rootDir, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      writeHead(res, 403);
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        writeHead(res, 404);
        res.end("Not found");
        return;
      }

      const headers = {
        "Content-Type":
          MIME[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        Vary: "Accept-Encoding",
      };

      if (req.method === "HEAD") {
        writeHead(res, 200, headers);
        res.end();
        return;
      }

      const acceptEncoding = req.headers["accept-encoding"] || "";
      const raw = fs.createReadStream(filePath);

      raw.on("error", () => {
        if (!res.headersSent) {
          writeHead(res, 500);
          res.end("Internal Server Error");
        }
      });

      if (acceptEncoding.includes("br")) {
        headers["Content-Encoding"] = "br";
        writeHead(res, 200, headers);
        raw.pipe(zlib.createBrotliCompress()).pipe(res);
      } else if (acceptEncoding.includes("gzip")) {
        headers["Content-Encoding"] = "gzip";
        writeHead(res, 200, headers);
        raw.pipe(zlib.createGzip()).pipe(res);
      } else if (acceptEncoding.includes("deflate")) {
        headers["Content-Encoding"] = "deflate";
        writeHead(res, 200, headers);
        raw.pipe(zlib.createDeflate()).pipe(res);
      } else {
        writeHead(res, 200, headers);
        raw.pipe(res);
      }
    });
  }

  return {
    handleHttpRequest,
    writeHead,
    sendJson,
    sendRateLimited,
    allowHttpRequest,
    isFeatureEnabled,
    serverDateKey,
  };
}

function cleanName(value) {
  return String(value || "\u0418\u0433\u0440\u043e\u043a")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 18);
}

function cleanPlayerId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 64);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimeSeconds(timeStr) {
  const parts = String(timeStr || "")
    .split(":")
    .map((part) => Number(part));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 60 + parts[1];
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
  const mode = String(submitted.mode || "classic");
  const engineVersion = String(submitted.engineVersion || "");
  const replayVersion = Number(submitted.replayVersion || 0);
  const seed = String(submitted.seed || "");
  const inputs = Array.isArray(submitted.inputs) ? submitted.inputs : [];
  const externalEvents = Array.isArray(submitted.externalEvents)
    ? submitted.externalEvents
    : [];
  const checkpoints = Array.isArray(submitted.checkpoints)
    ? submitted.checkpoints
    : [];
  const metadata =
    submitted.metadata && typeof submitted.metadata === "object"
      ? submitted.metadata
      : {};
  const finalChecksum = String(submitted.finalChecksum || "");

  if (
    engineVersion !== engine.ENGINE_VERSION ||
    replayVersion !== 1 ||
    seed !== `daily:${run.dateKey}` ||
    !finalChecksum
  ) {
    return { ok: false, code: "invalidReplayMetadata" };
  }
  if (inputs.length > 30000 || externalEvents.length > 5000) {
    return { ok: false, code: "replayTooLarge" };
  }

  const simulated = engine.createState({ seed, mode });
  let seqExpected = 1;
  let lastTick = -1;
  for (const item of inputs) {
    if (!item || typeof item !== "object") {
      return { ok: false, code: "invalidReplayInput" };
    }
    const tick = Number(item.tick);
    const seq = Number(item.seq);
    const action = String(item.action || "");
    const pressed = Boolean(item.pressed);

    if (
      !Number.isInteger(tick) ||
      tick < lastTick ||
      !Number.isInteger(seq) ||
      seq !== seqExpected ||
      !protocol.INPUT_ACTIONS.has(action)
    ) {
      return { ok: false, code: "invalidReplaySequence" };
    }
    while (simulated.tick < tick && !simulated.gameOver) {
      engine.step(simulated);
    }
    if (simulated.gameOver) break;
    engine.applyInput(simulated, { tick, seq, action, pressed }, []);
    seqExpected += 1;
    lastTick = tick;
  }

  const maxReplayTicks = Math.min(
    15000,
    Math.ceil((entry.timeMs / 1000) * engine.TICK_RATE) + 180,
  );
  while (!simulated.gameOver && simulated.tick < maxReplayTicks) {
    engine.step(simulated);
  }

  const finalSnapshot = engine.snapshot(simulated);
  if (
    finalSnapshot.score !== entry.score ||
    finalSnapshot.lines !== entry.lines ||
    finalSnapshot.level !== entry.level
  ) {
    return { ok: false, code: "replayMismatch" };
  }

  return {
    ok: true,
    replay: {
      mode,
      engineVersion,
      replayVersion,
      seed,
      inputs,
      externalEvents,
      checkpoints,
      metadata,
      finalChecksum,
      finalTick: simulated.tick,
    },
  };
}

module.exports = {
  createHttpRouter,
  SECURITY_HEADERS,
  MIME,
  PUBLIC_ROOT_FILES,
  PUBLIC_PREFIXES,
};
