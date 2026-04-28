export const DEFAULT_SESSION = {
  type: "solo",
  source: "local",
  room: "",
  ranked: false,
  matchId: "",
};

export function makeSessionState(next = {}) {
  return {
    ...DEFAULT_SESSION,
    ...next,
    type: ["solo", "ai", "online"].includes(next.type) ? next.type : "solo",
    room: String(next.room || ""),
    ranked: Boolean(next.ranked),
    matchId: String(next.matchId || ""),
  };
}

export function isOnlineSession(stateOrSession) {
  const session = stateOrSession?.session || stateOrSession;
  return session?.type === "online";
}

export function isAiSession(stateOrSession) {
  const session = stateOrSession?.session || stateOrSession;
  return session?.type === "ai";
}
