const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const RECORDS_FILE = path.join(ROOT, "records.json");
const RANKED_FILE = path.join(ROOT, "ranked.json");
const MAX_RECORDS = 50;
const MAX_WS_FRAME_BYTES = 4096;
const MAX_WS_MESSAGES_PER_CHUNK = 12;
const MAX_MESSAGES_PER_10S = 90;
const MAX_UPDATES_PER_SECOND = 8;
const MAX_ATTACKS_PER_SECOND = 4;
const MAX_ATTACK_LINES_PER_10S = 18;
const MAX_RECORD_SCORE = 99999999;
const MAX_PAYLOAD_KEYS = 18;
const MAX_BOARD_PREVIEW_ROWS = 15;
const MAX_BOARD_PREVIEW_COLS = 10;
const ROOM_PLAYER_LIMIT = 2;
const RECONNECT_GRACE_MS = 12000;
const COUNTDOWN_STEP_MS = 700;
const RANKED_START_RATING = 1000;
const RANKED_MIN_RATING = 100;
const RANKED_MAX_RATING = 3000;
const RANKED_K_FACTOR = 32;
const UPDATE_KEYS = new Set([
  "type",
  "room",
  "name",
  "score",
  "lines",
  "level",
  "height",
  "sentGarbage",
  "receivedGarbage",
  "mode",
  "time",
  "status",
  "force",
  "boardPreview",
  "fieldPreview",
]);
const ATTACK_KEYS = new Set(["type", "room", "lines"]);
const REMATCH_KEYS = new Set(["type", "room"]);
const MATCH_OVER_KEYS = new Set(["type", "room", "result"]);
const PING_KEYS = new Set(["type", "ts"]);
const rooms = new Map();
const startedAt = Date.now();

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

  if (requestUrl.pathname === "/api/records") {
    handleRecordsApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/health") {
    handleHealth(req, res);
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

  const payload = {
    ok: true,
    service: "blockdrop-web-game",
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    rooms: rooms.size,
    records: readRecords().length,
    rankedPlayers: Object.keys(readRankedStore().players).length,
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

function handleRecordsApi(req, res) {
  if (req.method === "GET") {
    sendJson(res, { records: readRecords() });
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
      sendJson(res, { records: readRecords() });
      return;
    }

    if (!isPlausibleRecord(record)) {
      sendJson(
        res,
        {
          error: "Record rejected by server authority",
          records: readRecords(),
        },
        422,
      );
      return;
    }

    const records = readRecords()
      .concat(record)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.lines - a.lines ||
          a.date.localeCompare(b.date),
      )
      .slice(0, MAX_RECORDS);
    writeRecords(records);
    sendJson(res, { records });
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
  const [minutes, seconds] = String(value)
    .split(":")
    .map((part) => Number(part));
  return (
    (Number.isFinite(minutes) ? minutes : 0) * 60 +
    (Number.isFinite(seconds) ? seconds : 0)
  );
}

function readRecords() {
  try {
    const raw = fs.readFileSync(RECORDS_FILE, "utf8");
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records.slice(0, MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

function writeRecords(records) {
  try {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
  } catch (error) {
    console.error("Cannot write records:", error.message);
  }
}

function readRankedStore() {
  try {
    const raw = fs.readFileSync(RANKED_FILE, "utf8");
    const store = JSON.parse(raw);
    return store && typeof store === "object" && store.players
      ? { players: store.players }
      : { players: {} };
  } catch {
    return { players: {} };
  }
}

function writeRankedStore(store) {
  try {
    fs.writeFileSync(RANKED_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error("Cannot write ranked data:", error.message);
  }
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
    rating: clamp(safeNumber(record?.rating) || RANKED_START_RATING, RANKED_MIN_RATING, RANKED_MAX_RATING),
    wins: clamp(safeNumber(record?.wins), 0, 999999),
    losses: clamp(safeNumber(record?.losses), 0, 999999),
    streak,
    bestWinStreak: clamp(safeNumber(record?.bestWinStreak), 0, 999999),
    bestLossStreak: clamp(safeNumber(record?.bestLossStreak), 0, 999999),
    updatedAt: new Date().toISOString(),
  };
}

function getRankedProfile(id, name = "Player") {
  const safeId = cleanPlayerId(id);
  if (!safeId) return null;
  const store = readRankedStore();
  const profile = normalizeRankedPlayer(store.players[safeId], safeId, name);
  store.players[safeId] = profile;
  writeRankedStore(store);
  return profile;
}

function publicRankedProfile(profile) {
  if (!profile) return null;
  return {
    playerId: profile.id,
    name: profile.name,
    rating: profile.rating,
    wins: profile.wins,
    losses: profile.losses,
    streak: profile.streak,
    bestWinStreak: profile.bestWinStreak,
    bestLossStreak: profile.bestLossStreak,
  };
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
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!isValidWebSocketKey(key)) {
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
    safeClose(client, "Frame too large");
    return;
  }
  let messages;
  try {
    messages = decodeFrames(chunk);
  } catch {
    safeClose(client, "Bad frame");
    return;
  }
  if (messages.length > MAX_WS_MESSAGES_PER_CHUNK) {
    safeClose(client, "Too many frames");
    return;
  }
  for (const message of messages) {
    if (!allowMessage(client) || message.length > MAX_WS_FRAME_BYTES) {
      safeClose(client, "Rate limited");
      return;
    }
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
  return !data.room || cleanCode(data.room) === client.room;
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

function sanitizeBoardPreview(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_BOARD_PREVIEW_ROWS).map((row) =>
    row.slice(0, MAX_BOARD_PREVIEW_COLS).map((cell) => {
      if (cell === true) return 1;
      if (cell === false) return 0;
      return Number(cell) > 0 ? 1 : 0;
    }),
  );
}

function joinRoom(client, data) {
  removeClient(client, "rejoin");
  const roomId = cleanCode(data.room) || "LOBBY";
  const rankedRequested = data.ranked === true;
  const playerId = cleanPlayerId(data.playerId);
  if (
    data.room &&
    roomId !==
      String(data.room)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 16)
  ) {
    safeClose(client, "Bad room");
    return;
  }
  const maxPlayers = ROOM_PLAYER_LIMIT;
  const durationSec = clamp(safeNumber(data.durationSec) || 180, 60, 1800);
  if (!rooms.has(roomId))
    rooms.set(roomId, createRoom(roomId, maxPlayers, durationSec));
  const room = rooms.get(roomId);
  if (room.match.status === "lobby") {
    room.maxPlayers = ROOM_PLAYER_LIMIT;
    room.durationSec = durationSec;
    if (room.players.size === 0 && room.spectators.size === 0) {
      room.ranked = rankedRequested;
    }
  }

  client.room = roomId;
  client.name = cleanName(data.name);
  client.ranked = Boolean(room.ranked);
  client.playerId = client.ranked ? playerId || client.id : "";
  client.rankedProfile = client.ranked
    ? getRankedProfile(client.playerId, client.name)
    : null;
  client.state = emptyState();

  const reconnectId = findReconnectSlot(room, client.name);
  if (reconnectId) {
    const slot = room.reconnects.get(reconnectId);
    clearReconnect(room, reconnectId);
    client.id = reconnectId;
    client.role = "player";
    client.ranked = Boolean(slot?.ranked || room.ranked);
    client.playerId = slot?.playerId || client.playerId;
    client.rankedProfile =
      slot?.rankedProfile ||
      (client.ranked ? getRankedProfile(client.playerId, client.name) : null);
    room.players.set(client.id, client);
  } else if (room.players.size < room.maxPlayers && room.match.status !== "playing") {
    client.role = "player";
    room.players.set(client.id, client);
  } else {
    client.role = "spectator";
    room.spectators.set(client.id, client);
  }

  send(client, { type: "hello", id: client.id });
  send(client, { type: "role", role: client.role });
  if (client.rankedProfile) {
    send(client, {
      type: "rankedProfile",
      ...publicRankedProfile(client.rankedProfile),
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
  maybeAutoStart(room);
}

function findReconnectSlot(room, name) {
  const normalized = cleanName(name).toLowerCase();
  for (const [id, slot] of room.reconnects.entries()) {
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

  const store = readRankedStore();
  const winnerBefore = normalizeRankedPlayer(
    store.players[winner.playerId],
    winner.playerId,
    winner.name,
  );
  const loserBefore = normalizeRankedPlayer(
    store.players[loser.playerId],
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
  };
  loserAfter.bestLossStreak = Math.max(
    loserAfter.bestLossStreak,
    Math.abs(loserAfter.streak),
  );

  store.players[winner.playerId] = winnerAfter;
  store.players[loser.playerId] = loserAfter;
  writeRankedStore(store);
  applyRankedProfileToParticipant(room, winnerId, winnerAfter);
  applyRankedProfileToParticipant(room, loserId, loserAfter);

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
    winner: rankedResultPayload(winner, winnerBefore, winnerAfter),
    loser: rankedResultPayload(loser, loserBefore, loserAfter),
    series: seriesPayload(room),
  };
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
}

function cleanCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

function cleanPlayerId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 64);
}

function cleanName(value) {
  return (
    String(value || "Player")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 18) || "Player"
  );
}

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
  for (const roomId of rooms.keys()) broadcastRoom(roomId);
}, 1000);

server.listen(PORT, () => {
  console.log(`BlockDrop server: http://localhost:${PORT}`);
});
