export const BOARD_PREVIEW_ROWS = 15;
export const BOARD_PREVIEW_COLS = 10;
export const ONLINE_UPDATE_INTERVAL_MS = 125;
export const ONLINE_PING_INTERVAL_MS = 4000;
export const RANKED_PLAYER_ID_KEY = "blockdrop-ranked-player-id-v1";

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

export function normalizePlayerId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 64);
}

export function createLocalPlayerId(random = globalThis.crypto) {
  if (random?.randomUUID) return random.randomUUID();
  const values = new Uint8Array(16);
  if (random?.getRandomValues) random.getRandomValues(values);
  else {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = Math.floor(Math.random() * 256);
    }
  }
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function loadOrCreatePlayerId(
  storage = globalThis.localStorage,
  key = RANKED_PLAYER_ID_KEY,
) {
  try {
    const existing = normalizePlayerId(storage?.getItem(key));
    if (existing) return existing;
    const created = createLocalPlayerId();
    storage?.setItem(key, created);
    return created;
  } catch {
    return createLocalPlayerId();
  }
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

export function buildRoomInviteText(locationLike, room, language = "ru") {
  const safeRoom = normalizeRoomId(room);
  const url = buildRoomInviteUrl(locationLike, safeRoom);
  return language === "en"
    ? `Join my BlockDrop room ${safeRoom}: ${url}`
    : `Заходи в комнату BlockDrop ${safeRoom}: ${url}`;
}

export function buildJoinMessage({
  room,
  name,
  maxPlayers,
  durationSec,
  ranked = false,
  playerId = "",
}) {
  return {
    type: "join",
    room: normalizeRoomId(room),
    name: normalizePlayerName(name),
    maxPlayers: Number(maxPlayers) || 2,
    durationSec: Number(durationSec) || 180,
    ranked: Boolean(ranked),
    playerId: normalizePlayerId(playerId),
  };
}

export function sanitizeBoardPreview(boardPreview) {
  if (!Array.isArray(boardPreview)) return [];
  return boardPreview.slice(-BOARD_PREVIEW_ROWS).map((row) => {
    const cells = Array.isArray(row)
      ? row
      : String(row || "")
          .split("")
          .map((value) => (value === "0" ? 0 : 1));
    return cells.slice(0, BOARD_PREVIEW_COLS).map((cell) => {
      if (cell === true) return 1;
      if (cell === false || cell == null) return 0;
      const numeric = Number(cell);
      return Number.isFinite(numeric) && numeric > 0 ? 1 : 0;
    });
  });
}

export function buildUpdateMessage(state) {
  const message = {
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
  const boardPreview = sanitizeBoardPreview(state.boardPreview || state.fieldPreview);
  if (boardPreview.length) message.boardPreview = boardPreview;
  return message;
}

export function buildTournamentMessage({ room, maxPlayers, durationSec }) {
  return {
    type: "startTournament",
    room: normalizeRoomId(room),
    maxPlayers: Number(maxPlayers) || 2,
    durationSec: Number(durationSec) || 180,
  };
}

export function buildPingMessage(ts = Date.now()) {
  return { type: "ping", ts: Math.max(0, Math.floor(Number(ts) || 0)) };
}

export function buildRematchReadyMessage(room) {
  return { type: "rematchReady", room: normalizeRoomId(room) };
}

export function buildMatchOverMessage(room, result) {
  return {
    type: "matchOver",
    room: normalizeRoomId(room),
    result: result === "win" ? "win" : "loss",
  };
}

export async function copyTextToClipboard(text, documentLike = globalThis.document) {
  if (!text) return false;
  try {
    if (navigator.clipboard && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("Clipboard API failed:", error);
  }
  const textarea = documentLike.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  documentLike.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let success = false;
  try {
    success = documentLike.execCommand("copy");
  } catch (error) {
    console.warn("Fallback copy failed:", error);
  }
  textarea.remove();
  return success;
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
    reconnecting: false,
    role: "player",
    ranked: false,
    playerId: "",
    rating: 1000,
    pingMs: 0,
    room: "",
    name: "",
    lastSentAt: 0,
    pingTimer: 0,
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
  if (client?.role === "spectator") return false;
  return sendOnlineMessage(client, {
    type: "attack",
    room: normalizeRoomId(room),
    lines: Math.max(1, Math.min(6, Math.floor(Number(lines) || 0))),
  });
}

export function sendScoreUpdate(client, state) {
  if (client?.role === "spectator") return false;
  const now = performance.now();
  if (!state.force && now - client.lastSentAt < ONLINE_UPDATE_INTERVAL_MS)
    return false;
  client.lastSentAt = now;
  return sendOnlineMessage(client, buildUpdateMessage(state));
}

export function sendRematchReady(client, room) {
  if (client?.role === "spectator") return false;
  return sendOnlineMessage(client, buildRematchReadyMessage(room));
}

export function startOnlinePing(client) {
  stopOnlinePing(client);
  client.pingTimer = setInterval(() => {
    sendOnlineMessage(client, buildPingMessage());
  }, ONLINE_PING_INTERVAL_MS);
}

export function stopOnlinePing(client) {
  if (client?.pingTimer) clearInterval(client.pingTimer);
  if (client) client.pingTimer = 0;
}

export function disconnectOnline(client) {
  stopOnlinePing(client);
  if (client?.socket) client.socket.close();
  if (!client) return;
  client.socket = null;
  client.connected = false;
  client.reconnecting = false;
}

export function connectOnline(
  client,
  { server, room, name, maxPlayers, durationSec, ranked = false, playerId = "" },
) {
  disconnectOnline(client);
  const socket = new WebSocket(server);
  client.socket = socket;
  client.room = normalizeRoomId(room);
  client.name = normalizePlayerName(name);
  client.role = "player";
  client.ranked = Boolean(ranked);
  client.playerId = normalizePlayerId(playerId);

  socket.addEventListener("open", () => {
    client.connected = true;
    client.reconnecting = false;
    sendOnlineMessage(
      client,
      buildJoinMessage({
        room: client.room,
        name: client.name,
        maxPlayers,
        durationSec,
        ranked: client.ranked,
        playerId: client.playerId,
      }),
    );
    startOnlinePing(client);
    emitOnlineMessage(client, {
      type: "open",
      room: client.room,
      name: client.name,
    });
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = parseServerMessage(event.data);
      if (payload.type === "pong") {
        client.pingMs = Math.max(0, Date.now() - Number(payload.ts || 0));
        emitOnlineMessage(client, { type: "ping", pingMs: client.pingMs });
        return;
      }
      if (payload.type === "role") client.role = payload.role || "player";
      if (payload.type === "rankedProfile") {
        client.rating = Math.max(0, Math.floor(Number(payload.rating) || 1000));
      }
      emitOnlineMessage(client, payload);
    } catch (error) {
      emitOnlineMessage(client, { type: "error", message: error.message });
    }
  });

  socket.addEventListener("close", () => {
    stopOnlinePing(client);
    client.connected = false;
    client.socket = null;
    emitOnlineMessage(client, { type: "close" });
  });

  socket.addEventListener("error", () => {
    emitOnlineMessage(client, { type: "socketError" });
  });

  return socket;
}
