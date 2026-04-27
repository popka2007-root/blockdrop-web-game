export function normalizeRoomId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

export function normalizePlayerName(value) {
  return (
    String(value || "Player")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 18) || "Player"
  );
}

export function attackLinesForClear(count) {
  if (count < 2) return 0;
  if (count === 2) return 1;
  if (count === 3) return 2;
  return 4;
}

export function generateRoomCode(random = Math.random) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[Math.floor(random() * alphabet.length)];
  }
  return code;
}

export function defaultServerUrl(locationLike = globalThis.location) {
  if (locationLike?.protocol === "https:") return `wss://${locationLike.host}`;
  if (locationLike?.protocol === "http:") return `ws://${locationLike.host}`;
  return "ws://localhost:8787";
}

export function roomFromLocation(locationLike = globalThis.location) {
  const pathRoom = locationLike?.pathname?.match(/\/room\/([A-Z0-9]+)/i)?.[1];
  const queryRoom = new URLSearchParams(locationLike?.search || "").get("room");
  return normalizeRoomId(pathRoom || queryRoom);
}

export function buildRoomInviteUrl(locationLike, room) {
  const url = new URL(locationLike.href);
  const safeRoom = normalizeRoomId(room);
  const canUsePrettyRoom =
    locationLike.protocol.startsWith("http") &&
    !locationLike.hostname.endsWith("github.io");
  if (canUsePrettyRoom) {
    const basePath = url.pathname.includes("/room/")
      ? url.pathname.split("/room/")[0]
      : url.pathname.replace(/\/[^/]*$/, "");
    url.pathname = `${basePath.replace(/\/$/, "")}/room/${safeRoom}`;
    url.search = "";
  } else {
    url.searchParams.set("room", safeRoom);
  }
  url.hash = "";
  return url.toString();
}

export function buildJoinMessage({ room, name, maxPlayers, durationSec }) {
  return {
    type: "join",
    room: normalizeRoomId(room),
    name: normalizePlayerName(name),
    maxPlayers: Number(maxPlayers) || 2,
    durationSec: Number(durationSec) || 180,
  };
}

export function buildUpdateMessage(state) {
  return {
    type: "update",
    room: normalizeRoomId(state.room),
    name: normalizePlayerName(state.name),
    score: Math.max(0, Math.floor(Number(state.score) || 0)),
    lines: Math.max(0, Math.floor(Number(state.lines) || 0)),
    level: Math.max(1, Math.floor(Number(state.level) || 1)),
    height: Math.max(0, Math.floor(Number(state.height) || 0)),
    sentGarbage: Math.max(0, Math.floor(Number(state.sentGarbage) || 0)),
    receivedGarbage: Math.max(
      0,
      Math.floor(Number(state.receivedGarbage) || 0),
    ),
    mode: String(state.mode || "Classic").slice(0, 24),
    time: String(state.time || "0:00").slice(0, 12),
    status: String(state.status || "Playing").slice(0, 18),
    force: Boolean(state.force),
  };
}

export function buildTournamentMessage({ room, maxPlayers, durationSec }) {
  return {
    type: "startTournament",
    room: normalizeRoomId(room),
    maxPlayers: Number(maxPlayers) || 2,
    durationSec: Number(durationSec) || 180,
  };
}

export function parseServerMessage(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    throw new Error("Bad server message");
  }
  return data;
}

export function createOnlineClient() {
  return {
    socket: null,
    connected: false,
    room: "",
    name: "",
    lastSentAt: 0,
    listeners: new Set(),
  };
}

export function onOnlineMessage(client, handler) {
  client.listeners.add(handler);
  return () => client.listeners.delete(handler);
}

function emitOnlineMessage(client, payload) {
  for (const listener of client.listeners) listener(payload);
}

export function sendOnlineMessage(client, payload) {
  if (!client?.socket || client.socket.readyState !== WebSocket.OPEN)
    return false;
  client.socket.send(JSON.stringify(payload));
  return true;
}

export function sendAttack(client, room, lines) {
  return sendOnlineMessage(client, {
    type: "attack",
    room: normalizeRoomId(room),
    lines: Math.max(1, Math.min(6, Math.floor(Number(lines) || 0))),
  });
}

export function sendScoreUpdate(client, state) {
  client.lastSentAt = performance.now();
  return sendOnlineMessage(client, buildUpdateMessage(state));
}

export function disconnectOnline(client) {
  if (client?.socket) client.socket.close();
  if (!client) return;
  client.socket = null;
  client.connected = false;
}

export function connectOnline(
  client,
  { server, room, name, maxPlayers, durationSec },
) {
  disconnectOnline(client);
  const socket = new WebSocket(server);
  client.socket = socket;
  client.room = normalizeRoomId(room);
  client.name = normalizePlayerName(name);

  socket.addEventListener("open", () => {
    client.connected = true;
    sendOnlineMessage(
      client,
      buildJoinMessage({
        room: client.room,
        name: client.name,
        maxPlayers,
        durationSec,
      }),
    );
    emitOnlineMessage(client, {
      type: "open",
      room: client.room,
      name: client.name,
    });
  });

  socket.addEventListener("message", (event) => {
    try {
      emitOnlineMessage(client, parseServerMessage(event.data));
    } catch (error) {
      emitOnlineMessage(client, { type: "error", message: error.message });
    }
  });

  socket.addEventListener("close", () => {
    client.connected = false;
    client.socket = null;
    emitOnlineMessage(client, { type: "close" });
  });

  socket.addEventListener("error", () => {
    emitOnlineMessage(client, { type: "socketError" });
  });

  return socket;
}
