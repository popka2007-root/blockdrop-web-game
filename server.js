const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");
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
  const filePath = path.join(ROOT, safePath);

  const relativePath = path.relative(ROOT, filePath);
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
        mime[path.extname(filePath)] || "application/octet-stream",
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
});

const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_FRAME_BYTES,
  perMessageDeflate: false,
});


// --- WIRED MODULES ---
const setupHttp = require('./src/server/http.js');
const setupWs = require('./src/server/ws.js');
const setupMatchmaking = require('./src/server/matchmaking.js');

const context = {
  crypto,
  fs,
  zlib,
  http,
  path,
  QRCode,
  WebSocket,
  WebSocketServer,
  createMetrics,
  createLogger,
  clientAddress,
  isSensitiveTransportAllowed,
  RANKED_MAX_RATING,
  RANKED_MIN_RATING,
  createServerStore,
  protocol,
  engine,
  PORT,
  ROOT,
  MAX_WS_FRAME_BYTES,
  MAX_MESSAGES_PER_10S,
  MAX_UPDATES_PER_SECOND,
  MAX_ATTACKS_PER_SECOND,
  MAX_ATTACK_LINES_PER_10S,
  MAX_PAYLOAD_KEYS,
  HTTP_RATE_WINDOW_MS,
  RECONNECT_GRACE_MS,
  COUNTDOWN_STEP_MS,
  MATCH_TICK_MS,
  SNAPSHOT_INTERVAL_TICKS,
  RANKED_K_FACTOR,
  ATTACK_KEY_LIST,
  MAX_BOARD_PREVIEW_COLS,
  MAX_BOARD_PREVIEW_ROWS,
  JOIN_KEY_LIST,
  INPUT_ACTIONS,
  INPUT_KEY_LIST,
  MATCH_OVER_KEY_LIST,
  MAX_RECORD_SCORE,
  PING_KEY_LIST,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  REMATCH_KEY_LIST,
  MATCH_EVENT_KEY_LIST,
  ROOM_PLAYER_LIMIT,
  TOURNAMENT_KEY_LIST,
  UPDATE_KEY_LIST,
  normalizeIdentityToken,
  normalizeMatchMode,
  normalizePlayerId,
  normalizePlayerName,
  normalizeRoomId,
  sanitizeBoardPreview,
  UPDATE_KEYS,
  ATTACK_KEYS,
  REMATCH_KEYS,
  MATCH_EVENT_KEYS,
  MATCH_OVER_KEYS,
  PING_KEYS,
  JOIN_KEYS,
  INPUT_KEYS,
  TOURNAMENT_KEYS,
  rooms,
  rankedQueue,
  httpRateBuckets,
  startedAt,
  cachedPackageMeta,
  store,
  logger,
  metrics,
  eventLoopExpectedAt,
  previousCpuUsage,
  previousCpuMeasuredAt,
  operationalMetricsTimer,
  mime,
  securityHeaders,
  PUBLIC_ROOT_FILES,
  PUBLIC_PREFIXES,
};

const httpModule = setupHttp(context);
const wsModule = setupWs(context);
const matchmakingModule = setupMatchmaking(context);

Object.assign(context, httpModule, wsModule, matchmakingModule);

Object.assign(globalThis, httpModule, wsModule, matchmakingModule);

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

context.closeStoreAndExit = closeStoreAndExit;
globalThis.closeStoreAndExit = closeStoreAndExit;
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

context.shutdown = shutdown;
globalThis.shutdown = shutdown;
