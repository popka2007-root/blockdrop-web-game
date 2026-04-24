const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const rooms = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])/, "").replace(/^(\.\.[/\\])+/, "");
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
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

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

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  const client = {
    id: crypto.randomUUID(),
    socket,
    room: "",
    name: "Игрок",
    state: {
      score: 0,
      lines: 0,
      level: 1,
      mode: "Классика",
      time: "0:00",
      status: "В комнате"
    }
  };

  socket.on("data", (chunk) => {
    for (const message of decodeFrames(chunk)) {
      handleMessage(client, message);
    }
  });

  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));
});

function handleMessage(client, raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (data.type === "join") {
    removeClient(client);
    client.room = cleanCode(data.room) || "LOBBY";
    client.name = cleanName(data.name);
    if (!rooms.has(client.room)) rooms.set(client.room, new Map());
    rooms.get(client.room).set(client.id, client);
    broadcastRoom(client.room);
    return;
  }

  if (data.type === "update" && client.room) {
    client.name = cleanName(data.name || client.name);
    client.state = {
      score: safeNumber(data.score),
      lines: safeNumber(data.lines),
      level: safeNumber(data.level),
      mode: String(data.mode || "Классика").slice(0, 24),
      time: String(data.time || "0:00").slice(0, 12),
      status: String(data.status || "Играет").slice(0, 18)
    };
    broadcastRoom(client.room);
  }
}

function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const players = {};
  for (const client of room.values()) {
    players[client.id] = {
      name: client.name,
      ...client.state
    };
  }

  const payload = JSON.stringify({ type: "state", room: roomId, players });
  for (const client of room.values()) sendFrame(client.socket, payload);
}

function removeClient(client) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;
  room.delete(client.id);
  if (room.size === 0) rooms.delete(client.room);
  else broadcastRoom(client.room);
  client.room = "";
}

function cleanCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

function cleanName(value) {
  return String(value || "Игрок").replace(/[<>]/g, "").trim().slice(0, 18) || "Игрок";
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const second = buffer[offset + 1];
    const masked = (second & 0x80) !== 0;
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

server.listen(PORT, () => {
  console.log(`BlockDrop server: http://localhost:${PORT}`);
});
