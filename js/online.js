export function normalizeRoomId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

export function normalizePlayerName(value) {
  return String(value || "Player").replace(/[<>]/g, "").trim().slice(0, 18) || "Player";
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
  const canUsePrettyRoom = locationLike.protocol.startsWith("http") && !locationLike.hostname.endsWith("github.io");
  if (canUsePrettyRoom) {
    const basePath = url.pathname.includes("/room/") ? url.pathname.split("/room/")[0] : url.pathname.replace(/\/[^/]*$/, "");
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
    durationSec: Number(durationSec) || 180
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
    receivedGarbage: Math.max(0, Math.floor(Number(state.receivedGarbage) || 0)),
    mode: String(state.mode || "Classic").slice(0, 24),
    time: String(state.time || "0:00").slice(0, 12),
    status: String(state.status || "Playing").slice(0, 18),
    force: Boolean(state.force)
  };
}

export function buildTournamentMessage({ room, maxPlayers, durationSec }) {
  return {
    type: "startTournament",
    room: normalizeRoomId(room),
    maxPlayers: Number(maxPlayers) || 2,
    durationSec: Number(durationSec) || 180
  };
}

export function parseServerMessage(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || typeof data.type !== "string") {
    throw new Error("Bad server message");
  }
  return data;
}
