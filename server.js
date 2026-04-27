const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const RECORDS_FILE = path.join(ROOT, "records.json");
const MAX_RECORDS = 50;
const MAX_WS_FRAME_BYTES = 4096;
const MAX_WS_MESSAGES_PER_CHUNK = 12;
const MAX_MESSAGES_PER_10S = 90;
const MAX_UPDATES_PER_SECOND = 8;
const MAX_ATTACKS_PER_SECOND = 4;
const MAX_ATTACK_LINES_PER_10S = 18;
const MAX_RECORD_SCORE = 99999999;
const MAX_PAYLOAD_KEYS = 16;
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
]);
const ATTACK_KEYS = new Set(["type", "room", "lines"]);
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
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  const safePath = path
    .normalize(decodedPathname)
    .replace(/^([/\\])/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
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
    revision: readRevision(),
  };

  if (req.method === "HEAD") {
    res.writeHead(200, {
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

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(payload));
}

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
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

  const client = {
    id: crypto.randomUUID(),
    socket,
    room: "",
    name: "Player",
    state: emptyState(),
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

  socket.on("data", (chunk) => {
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
  });

  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));
  sendFrame(socket, JSON.stringify({ type: "hello", id: client.id }));
});

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
  };
}

function createRoom(id, maxPlayers = 4, durationSec = 180) {
  return {
    id,
    clients: new Map(),
    maxPlayers: clamp(maxPlayers, 2, 8),
    durationSec: clamp(durationSec, 60, 1800),
    tournament: null,
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

  if (!client.room) return;

  if (data.type === "update") {
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
    startTournament(client.room, data);
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

function joinRoom(client, data) {
  removeClient(client);
  const roomId = cleanCode(data.room) || "LOBBY";
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
  const maxPlayers = clamp(safeNumber(data.maxPlayers) || 2, 2, 8);
  const durationSec = clamp(safeNumber(data.durationSec) || 180, 60, 1800);
  if (!rooms.has(roomId))
    rooms.set(roomId, createRoom(roomId, maxPlayers, durationSec));
  const room = rooms.get(roomId);
  room.maxPlayers = maxPlayers;
  room.durationSec = durationSec;

  if (room.clients.size >= room.maxPlayers) {
    sendFrame(
      client.socket,
      JSON.stringify({ type: "error", message: "Room is full" }),
    );
    return;
  }

  client.room = roomId;
  client.name = cleanName(data.name);
  client.state = emptyState();
  room.clients.set(client.id, client);
  sendFrame(client.socket, JSON.stringify({ type: "hello", id: client.id }));
  broadcastRoom(roomId);
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
  };
}

function startTournament(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.maxPlayers = clamp(safeNumber(data.maxPlayers) || room.maxPlayers, 2, 8);
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
  removeClient(client);
  try {
    sendFrame(
      client.socket,
      JSON.stringify({ type: "error", message: reason }),
    );
  } catch {
    client.socket = null;
  }
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
    const players = playersPayload(room);
    const payload = JSON.stringify({
      type: "tournamentEnd",
      tournament: tournamentPayload(room),
      players,
    });
    for (const client of room.clients.values())
      sendFrame(client.socket, payload);
    broadcastRoom(roomId);
  }, delay);
}

function broadcastAttack(attacker, lines) {
  const room = rooms.get(attacker.room);
  if (!room || lines <= 0) return;
  const payload = JSON.stringify({
    type: "attack",
    from: attacker.name,
    lines: clamp(lines, 1, 6),
  });
  for (const client of room.clients.values()) {
    if (client.id !== attacker.id) sendFrame(client.socket, payload);
  }
}

function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify({
    type: "state",
    room: roomId,
    tournament: tournamentPayload(room),
    players: playersPayload(room),
  });
  for (const client of room.clients.values()) sendFrame(client.socket, payload);
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

function playersPayload(room) {
  const players = {};
  for (const client of room.clients.values()) {
    players[client.id] = {
      id: client.id,
      name: client.name,
      ...client.state,
    };
  }
  return players;
}

function removeClient(client) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;
  room.clients.delete(client.id);
  if (room.clients.size === 0) rooms.delete(client.room);
  else broadcastRoom(client.room);
  client.room = "";
}

function cleanCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
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
