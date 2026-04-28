const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createMetrics, createLogger } = require("./server-observability");
const {
  RANKED_MAX_RATING,
  RANKED_MIN_RATING,
  createServerStore,
} = require("./server-store");
const protocol = require("./shared/protocol.js");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const MAX_WS_FRAME_BYTES = 4096;
const MAX_WS_MESSAGES_PER_CHUNK = 12;
const MAX_MESSAGES_PER_10S = 90;
const MAX_UPDATES_PER_SECOND = 8;
const MAX_ATTACKS_PER_SECOND = 4;
const MAX_ATTACK_LINES_PER_10S = 18;
const MAX_PAYLOAD_KEYS = 18;
const RECONNECT_GRACE_MS = 12000;
const COUNTDOWN_STEP_MS = 700;
const RANKED_K_FACTOR = 32;
const {
  ATTACK_KEYS: ATTACK_KEY_LIST,
  BOARD_PREVIEW_COLS: MAX_BOARD_PREVIEW_COLS,
  BOARD_PREVIEW_ROWS: MAX_BOARD_PREVIEW_ROWS,
  JOIN_KEYS: JOIN_KEY_LIST,
  MATCH_OVER_KEYS: MATCH_OVER_KEY_LIST,
  MAX_RECORD_SCORE,
  PING_KEYS: PING_KEY_LIST,
  PROTOCOL_VERSION,
  REMATCH_KEYS: REMATCH_KEY_LIST,
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
const MATCH_OVER_KEYS = new Set(MATCH_OVER_KEY_LIST);
const PING_KEYS = new Set(PING_KEY_LIST);
const JOIN_KEYS = new Set(JOIN_KEY_LIST);
const TOURNAMENT_KEYS = new Set(TOURNAMENT_KEY_LIST);
const rooms = new Map();
const startedAt = Date.now();
let cachedPackageMeta = null;
const store = createServerStore({ root: ROOT });
const logger = createLogger({ service: "blockdrop-web-game" });
const metrics = createMetrics();

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
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://api.qrserver.com",
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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  metrics.increment("blockdrop_http_requests_total");

  if (requestUrl.pathname === "/api/records") {
    handleRecordsApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/daily") {
    handleDailyApi(req, res);
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

  const safePath = path
    .normalize(decodedPathname)
    .replace(/^([/\\])/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
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
    res.end(data);
  });
});

function safeDecodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "";
  }
}

function handleHealth(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
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
    dailyDate,
    dailyEntries: counts.dailyEntries,
    revision: readRevision(),
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

function handleMetrics(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
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
    }),
  );
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

function handleRecordsApi(req, res) {
  if (req.method === "GET") {
    sendJson(res, { records: store.listRecords() });
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
    let data = {};
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

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let data = {};
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }

    const dateKey = serverDateKey();
    const entry = sanitizeDailyScore(data, dateKey);
    const leaderboard = store.saveDailyScore(entry);
    metrics.increment("blockdrop_daily_submissions_total");
    sendJson(res, {
      date: dateKey,
      seed: store.getOrCreateDailySeed(dateKey),
      leaderboard,
    });
  });
}

function sanitizeRecord(data) {
  return {
    name: cleanName(data.name || "\u0418\u0433\u0440\u043e\u043a"),
    score: clamp(safeNumber(data.score), 0, MAX_RECORD_SCORE),
    lines: clamp(safeNumber(data.lines), 0, 9999),
    level: clamp(safeNumber(data.level), 1, 99),
    mode: String(data.mode || "\u041a\u043b\u0430\u0441\u0441\u0438\u043a\u0430")
      .replace(/[<>]/g, "")
      .slice(0, 24),
    time: String(data.time || "0:00")
      .replace(/[<>]/g, "")
      .slice(0, 12),
    date: new Date().toISOString(),
  };
}

function sanitizeDailyScore(data, dateKey) {
  return {
    dateKey,
    playerId: cleanPlayerId(data.playerId),
    name: cleanName(data.name || "\u0418\u0433\u0440\u043e\u043a"),
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
  res.writeHead(status, { ...securityHeaders, ...headers });
}

server.on("upgrade", (req, socket) => {
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

  const key = req.headers["sec-websocket-key"];
  if (!isValidWebSocketKey(key)) {
    metrics.increment("blockdrop_ws_bad_handshake_total");
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const client = createClient(socket);
  metrics.increment("blockdrop_ws_connections_total");
  updateLiveMetrics();
  socket.on("data", (chunk) => handleSocketData(client, chunk));
  socket.on("close", () => removeClient(client, "close"));
  socket.on("error", () => removeClient(client, "error"));
  send(client, { type: "hello", id: client.id });
});

function createClient(socket) {
  return {
    id: crypto.randomUUID(),
    socket,
    room: "",
    role: "player",
    ranked: false,
    playerId: "",
    identityToken: "",
    rankedProfile: null,
    name: "Player",
    state: emptyState(),
    disconnectedAt: 0,
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

function handleSocketData(client, chunk) {
  if (chunk.length > MAX_WS_FRAME_BYTES + 32) {
    metrics.increment("blockdrop_ws_policy_close_total");
    safeClose(client, "Frame too large");
    return;
  }
  let messages;
  try {
    messages = decodeFrames(chunk);
  } catch {
    metrics.increment("blockdrop_ws_policy_close_total");
    safeClose(client, "Bad frame");
    return;
  }
  if (messages.length > MAX_WS_MESSAGES_PER_CHUNK) {
    metrics.increment("blockdrop_ws_policy_close_total");
    safeClose(client, "Too many frames");
    return;
  }
  for (const message of messages) {
    if (!allowMessage(client) || message.length > MAX_WS_FRAME_BYTES) {
      metrics.increment("blockdrop_ws_policy_close_total");
      safeClose(client, "Rate limited");
      return;
    }
    metrics.increment("blockdrop_ws_messages_total");
    handleMessage(client, message);
  }
}

function isValidWebSocketKey(key) {
  if (typeof key !== "string") return false;
  try {
    return Buffer.from(key, "base64").length === 16;
  } catch {
    return false;
  }
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

  if (data.type === "update") {
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
    if (client.role !== "player") return;
    if (!allowTypedMessage(client, "attack")) return;
    if (!validateAttackPayload(client, data)) {
      safeClose(client, "Bad attack");
      return;
    }
    const lines = Number(data.lines);
    if (!allowAttackLines(client, lines)) return;
    broadcastAttack(client, lines);
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
    if (!hasOnlyKeys(data, REMATCH_KEYS) || !matchesClientRoom(client, data)) return;
    markRematchReady(client);
    return;
  }

  if (data.type === "matchOver") {
    if (client.role !== "player") return;
    if (!hasOnlyKeys(data, MATCH_OVER_KEYS) || !matchesClientRoom(client, data)) return;
    finishMatchFromClient(client, data.result);
    return;
  }

  safeClose(client, "Unknown message");
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
    String(data.room || "").length <= 32 &&
    normalizePlayerId(data.playerId).length <= 64 &&
    normalizeIdentityToken(data.identityToken).length <= 256
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
  if (!Array.isArray(value) || value.length > MAX_BOARD_PREVIEW_ROWS) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length <= MAX_BOARD_PREVIEW_COLS &&
      row.every((cell) => cell === 0 || cell === 1 || cell === true || cell === false),
  );
}

function joinRoom(client, data) {
  removeClient(client, "rejoin");
  const roomId = normalizeRoomId(data.room) || "LOBBY";
  const room = rooms.get(roomId);
  const rankedRequested = data.ranked === true || Boolean(room?.ranked);
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
      removeClient(client, "identity");
      try {
        client.socket.end();
      } catch {
        return;
      }
      return;
    }
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId, maxPlayers, durationSec));
  }
  const actualRoom = rooms.get(roomId);
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
  client.rankedProfile = client.ranked ? identity?.profile || null : null;
  client.state = emptyState();

  const reconnectId = findReconnectSlot(actualRoom, client.name, client.playerId);
  if (reconnectId) {
    const slot = actualRoom.reconnects.get(reconnectId);
    clearReconnect(actualRoom, reconnectId);
    client.id = reconnectId;
    client.role = "player";
    client.ranked = Boolean(slot?.ranked || actualRoom.ranked);
    client.playerId = slot?.playerId || client.playerId;
    client.identityToken = slot?.identityToken || client.identityToken;
    client.rankedProfile = slot?.rankedProfile || client.rankedProfile;
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

  send(client, { type: "hello", id: client.id });
  send(client, { type: "role", role: client.role });
  if (client.rankedProfile) {
    send(client, {
      type: "rankedProfile",
      ...store.publicRankedProfile(client.rankedProfile),
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
  maybeAutoStart(actualRoom);
}

function findReconnectSlot(room, name, playerId = "") {
  const normalized = cleanName(name).toLowerCase();
  const safePlayerId = cleanPlayerId(playerId);
  for (const [id, slot] of room.reconnects.entries()) {
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
    for (const player of room.players.values()) player.state = emptyState();
    broadcast(room, {
      type: finalType,
      seed: room.match.seed,
      mode: room.mode,
      startedAt: room.match.startedAt,
    });
    broadcastRoom(room.id);
  };
  tick();
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
  const allReady = [...room.players.keys()].every((id) => room.rematchReady.has(id));
  if (allReady) {
    if (room.ranked && room.series.completed) startRankedSeries(room);
    else if (room.ranked && !room.series.active) startRankedSeries(room);
    startCountdown(room, "rematchStart");
  }
}

function finishMatchFromClient(client, result) {
  const room = rooms.get(client.room);
  if (!room || room.match.status !== "playing") return;
  const other = [...room.players.values()].find((player) => player.id !== client.id);
  if (!other) return;
  const clientWon = room.ranked ? false : result === "win";
  finishMatch(room, {
    reason: "gameOver",
    winnerId: clientWon ? client.id : other.id,
    loserId: clientWon ? other.id : client.id,
  });
}

function finishMatch(room, { reason, winnerId, loserId }) {
  room.match.status = "finished";
  room.match.reason = reason;
  room.match.winnerId = winnerId;
  room.match.loserId = loserId;
  room.rematchReady.clear();
  const ranked = room.ranked
    ? finalizeRankedMatch(room, { winnerId, loserId, reason })
    : null;
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

function finalizeRankedMatch(room, { winnerId, loserId, reason }) {
  const winner = rankedParticipant(room, winnerId);
  const loser = rankedParticipant(room, loserId);
  if (!winner?.playerId || !loser?.playerId || winner.playerId === loser.playerId)
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

function safeClose(client, reason = "Policy violation") {
  send(client, { type: "error", message: reason });
  removeClient(client, "policy");
  try {
    client.socket.end();
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
  for (const client of [...room.players.values(), ...room.spectators.values()]) {
    if (predicate(client)) sendFrame(client.socket, message);
  }
}

function send(client, payload) {
  try {
    sendFrame(client.socket, JSON.stringify(payload));
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
        } else if (currentRoom.players.size === 0 && currentRoom.spectators.size === 0) {
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
        rankedProfile: client.rankedProfile,
        state: client.state,
        expiresAt,
        timer,
      });
      broadcast(room, { type: "reconnecting", playerId: id, name: client.name });
    }
  }
  client.room = "";
  if (
    room.players.size === 0 &&
    room.spectators.size === 0 &&
    room.reconnects.size === 0
  ) {
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

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const opcode = first & 0x0f;
    if (opcode === 0x08) break;
    if (opcode !== 0x01) throw new Error("Unsupported frame opcode");

    const second = buffer[offset + 1];
    const masked = (second & 0x80) !== 0;
    if (!masked) throw new Error("Unmasked client frame");
    let length = second & 0x7f;
    let header = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      header = 10;
    }

    if (length > MAX_WS_FRAME_BYTES) throw new Error("Frame payload too large");

    const maskOffset = offset + header;
    const dataOffset = maskOffset + (masked ? 4 : 0);
    const frameEnd = dataOffset + length;
    if (frameEnd > buffer.length) break;

    const payload = Buffer.from(buffer.subarray(dataOffset, frameEnd));
    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }

    messages.push(payload.toString("utf8"));
    offset = frameEnd;
  }

  return messages;
}

function sendFrame(socket, message) {
  const payload = Buffer.from(message);
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

setInterval(() => {
  updateLiveMetrics();
  for (const roomId of rooms.keys()) broadcastRoom(roomId);
}, 1000);

store.insertDeployAudit({
  revision: readRevision(),
  version: readPackageMeta().version,
  reason: process.env.BLOCKDROP_DEPLOY_REASON || "startup",
});

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
