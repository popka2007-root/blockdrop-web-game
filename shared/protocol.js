(function initBlockDropProtocol(root, factory) {
  const protocol = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = protocol;
  }
  root.__blockdropProtocol = protocol;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function makeBlockDropProtocol() {
    const PROTOCOL_VERSION = 2;
    const BOARD_PREVIEW_ROWS = 15;
    const BOARD_PREVIEW_COLS = 10;
    const MAX_RECORD_SCORE = 99999999;
    const ROOM_PLAYER_LIMIT = 2;
    const MATCH_MODES = [
      "classic",
      "sprint",
      "hardcore",
      "timeAttack",
      "relax",
      "chaos",
    ];
    const UPDATE_KEYS = [
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
    ];
    const ATTACK_KEYS = ["type", "room", "lines"];
    const REMATCH_KEYS = ["type", "room"];
    const MATCH_OVER_KEYS = ["type", "room", "result"];
    const PING_KEYS = ["type", "ts"];
    const JOIN_KEYS = [
      "type",
      "room",
      "name",
      "maxPlayers",
      "durationSec",
      "mode",
      "ranked",
      "playerId",
      "identityToken",
      "protocolVersion",
    ];
    const TOURNAMENT_KEYS = [
      "type",
      "room",
      "maxPlayers",
      "durationSec",
      "mode",
    ];

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function normalizeRoomId(value) {
      return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 16);
    }

    function normalizePlayerName(value) {
      return (
        String(value || "Player")
          .replace(/[<>]/g, "")
          .trim()
          .slice(0, 18) || "Player"
      );
    }

    function normalizePlayerId(value) {
      return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, "")
        .slice(0, 64);
    }

    function normalizeIdentityToken(value) {
      return String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "")
        .slice(0, 256);
    }

    function normalizeMatchMode(value) {
      const normalized = String(value || "")
        .trim()
        .toLowerCase();
      if (normalized === "timeattack") return "timeAttack";
      return MATCH_MODES.includes(normalized) ? normalized : "classic";
    }

    function createLocalPlayerId(random = globalThis.crypto) {
      if (random?.randomUUID) return normalizePlayerId(random.randomUUID());
      const values = new Uint8Array(16);
      if (random?.getRandomValues) {
        random.getRandomValues(values);
      } else {
        for (let index = 0; index < values.length; index += 1) {
          values[index] = Math.floor(Math.random() * 256);
        }
      }
      return [...values]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    }

    function sanitizeBoardPreview(boardPreview) {
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

    function buildJoinMessage({
      room,
      name,
      maxPlayers,
      durationSec,
      mode = "classic",
      ranked = false,
      playerId = "",
      identityToken = "",
    }) {
      return {
        type: "join",
        protocolVersion: PROTOCOL_VERSION,
        room: normalizeRoomId(room),
        name: normalizePlayerName(name),
        maxPlayers: Number(maxPlayers) || ROOM_PLAYER_LIMIT,
        durationSec: Number(durationSec) || 180,
        mode: normalizeMatchMode(mode),
        ranked: Boolean(ranked),
        playerId: normalizePlayerId(playerId),
        identityToken: normalizeIdentityToken(identityToken),
      };
    }

    function buildUpdateMessage(state) {
      const message = {
        type: "update",
        room: normalizeRoomId(state.room),
        name: normalizePlayerName(state.name),
        score: clamp(Math.floor(Number(state.score) || 0), 0, MAX_RECORD_SCORE),
        lines: clamp(Math.floor(Number(state.lines) || 0), 0, 9999),
        level: clamp(Math.floor(Number(state.level) || 1), 1, 99),
        height: clamp(Math.floor(Number(state.height) || 0), 0, 20),
        sentGarbage: clamp(Math.floor(Number(state.sentGarbage) || 0), 0, 9999),
        receivedGarbage: clamp(
          Math.floor(Number(state.receivedGarbage) || 0),
          0,
          9999,
        ),
        mode: String(state.mode || "Classic").slice(0, 24),
        time: String(state.time || "0:00").slice(0, 12),
        status: String(state.status || "Playing").slice(0, 18),
        force: Boolean(state.force),
      };
      const boardPreview = sanitizeBoardPreview(
        state.boardPreview || state.fieldPreview,
      );
      if (boardPreview.length) message.boardPreview = boardPreview;
      return message;
    }

    function buildTournamentMessage({
      room,
      maxPlayers,
      durationSec,
      mode = "classic",
    }) {
      return {
        type: "startTournament",
        room: normalizeRoomId(room),
        maxPlayers: Number(maxPlayers) || ROOM_PLAYER_LIMIT,
        durationSec: Number(durationSec) || 180,
        mode: normalizeMatchMode(mode),
      };
    }

    function buildPingMessage(ts = Date.now()) {
      return { type: "ping", ts: Math.max(0, Math.floor(Number(ts) || 0)) };
    }

    function buildRematchReadyMessage(room) {
      return { type: "rematchReady", room: normalizeRoomId(room) };
    }

    function buildMatchOverMessage(room, result) {
      return {
        type: "matchOver",
        room: normalizeRoomId(room),
        result: result === "win" ? "win" : "loss",
      };
    }

    return {
      PROTOCOL_VERSION,
      BOARD_PREVIEW_ROWS,
      BOARD_PREVIEW_COLS,
      MAX_RECORD_SCORE,
      ROOM_PLAYER_LIMIT,
      MATCH_MODES,
      UPDATE_KEYS,
      ATTACK_KEYS,
      REMATCH_KEYS,
      MATCH_OVER_KEYS,
      PING_KEYS,
      JOIN_KEYS,
      TOURNAMENT_KEYS,
      normalizeRoomId,
      normalizePlayerName,
      normalizePlayerId,
      normalizeIdentityToken,
      normalizeMatchMode,
      createLocalPlayerId,
      sanitizeBoardPreview,
      buildJoinMessage,
      buildUpdateMessage,
      buildTournamentMessage,
      buildPingMessage,
      buildRematchReadyMessage,
      buildMatchOverMessage,
    };
  },
);
