import "../shared/protocol.js";

export const ONLINE_UPDATE_INTERVAL_MS = 125;
export const ONLINE_PING_INTERVAL_MS = 4000;
export const RANKED_PLAYER_ID_KEY = "blockdrop-ranked-player-id-v1";
export const RANKED_IDENTITY_TOKEN_KEY = "blockdrop-ranked-identity-token-v1";
export const ACCOUNT_TOKEN_KEY = "blockdrop-account-token-v1";

const protocol = globalThis.__blockdropProtocol;

export const {
  BOARD_PREVIEW_ROWS,
  BOARD_PREVIEW_COLS,
  normalizeRoomId,
  normalizePlayerName,
  normalizePlayerId,
  normalizeIdentityToken,
  createLocalPlayerId,
  sanitizeBoardPreview,
  buildJoinMessage,
  buildUpdateMessage,
  buildTournamentMessage,
  buildPingMessage,
  buildRematchReadyMessage,
  buildMatchOverMessage,
  buildMatchEventMessage,
} = protocol;

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

export function loadRankedIdentityToken(
  storage = globalThis.localStorage,
  key = RANKED_IDENTITY_TOKEN_KEY,
) {
  try {
    return normalizeIdentityToken(storage?.getItem(key));
  } catch {
    return "";
  }
}

export function saveRankedIdentityToken(
  token,
  storage = globalThis.localStorage,
  key = RANKED_IDENTITY_TOKEN_KEY,
) {
  try {
    const safeToken = normalizeIdentityToken(token);
    if (safeToken) storage?.setItem(key, safeToken);
    else storage?.removeItem(key);
    return safeToken;
  } catch {
    return normalizeIdentityToken(token);
  }
}

export function loadAccountToken(
  storage = globalThis.localStorage,
  key = ACCOUNT_TOKEN_KEY,
) {
  try {
    return normalizeIdentityToken(storage?.getItem(key));
  } catch {
    return "";
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
    identityToken: "",
    accountToken: "",
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

export function sendMatchEvent(client, room, event) {
  if (client?.role === "spectator") return false;
  return sendOnlineMessage(client, buildMatchEventMessage(room, event));
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
  {
    server,
    room,
    name,
    maxPlayers,
    durationSec,
    mode = "classic",
    ranked = false,
    playerId = "",
    identityToken = "",
    accountToken = "",
    rankedQueue = false,
  },
) {
  disconnectOnline(client);
  const socket = new WebSocket(server);
  client.socket = socket;
  client.room = normalizeRoomId(room);
  client.name = normalizePlayerName(name);
  client.role = "player";
  client.ranked = Boolean(ranked);
  client.playerId = normalizePlayerId(playerId);
  client.identityToken = normalizeIdentityToken(identityToken);
  client.accountToken = normalizeIdentityToken(accountToken);

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
        mode,
        ranked: client.ranked,
        playerId: client.playerId,
        identityToken: client.identityToken,
        accountToken: client.accountToken,
        rankedQueue,
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
        if (payload.identityToken) {
          client.identityToken = normalizeIdentityToken(payload.identityToken);
        }
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
