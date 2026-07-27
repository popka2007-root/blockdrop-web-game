const crypto = require("crypto");
const { isSensitiveTransportAllowed } = require("./server-transport");
const protocol = require("./shared/protocol.js");
const engine = require("./shared/engine.js");

const MAX_WS_FRAME_BYTES = 4096;
const MAX_MESSAGES_PER_10S = 90;
const MAX_UPDATES_PER_SECOND = 8;
const MAX_ATTACKS_PER_SECOND = 4;
const MAX_ATTACK_LINES_PER_10S = 18;
const MAX_PAYLOAD_KEYS = 18;

const {
  ATTACK_KEYS: ATTACK_KEY_LIST,
  BOARD_PREVIEW_COLS: MAX_BOARD_PREVIEW_COLS,
  BOARD_PREVIEW_ROWS: MAX_BOARD_PREVIEW_ROWS,
  JOIN_KEYS: JOIN_KEY_LIST,
  INPUT_ACTIONS,
  INPUT_KEYS: INPUT_KEY_LIST,
  MATCH_OVER_KEYS: MATCH_OVER_KEY_LIST,
  MAX_RECORD_SCORE,
  PING_KEYS: PING_KEY_LIST,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  REMATCH_KEYS: REMATCH_KEY_LIST,
  MATCH_EVENT_KEYS: MATCH_EVENT_KEY_LIST,
  ROOM_PLAYER_LIMIT,
  TOURNAMENT_KEYS: TOURNAMENT_KEY_LIST,
  UPDATE_KEYS: UPDATE_KEY_LIST,
  normalizeIdentityToken,
  normalizePlayerId,
  normalizeRoomId,
} = protocol;

const UPDATE_KEYS = new Set(UPDATE_KEY_LIST);
const ATTACK_KEYS = new Set(ATTACK_KEY_LIST);
const REMATCH_KEYS = new Set(REMATCH_KEY_LIST);
const MATCH_EVENT_KEYS = new Set(MATCH_EVENT_KEY_LIST);
const MATCH_OVER_KEYS = new Set(MATCH_OVER_KEY_LIST);
const PING_KEYS = new Set(PING_KEY_LIST);
const JOIN_KEYS = new Set(JOIN_KEY_LIST);
const INPUT_KEYS = new Set(INPUT_KEY_LIST);
const TOURNAMENT_KEYS = new Set(TOURNAMENT_KEY_LIST);

function createWsHandler({
  webSocketServer,
  gameManager,
  metrics,
  logger,
  rooms,
}) {
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

    origins.add("http://localhost:8787");
    origins.add("http://127.0.0.1:8787");
    return origins;
  }

  function handleUpgrade(req, socket, head) {
    req.blockdropRequestId = crypto.randomUUID();
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
    webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, req);
    });
  }

  function handleConnection(socket, req) {
    const client = gameManager.createClient(socket, {
      authTransportAllowed: isSensitiveTransportAllowed(req),
    });
    metrics.increment("blockdrop_ws_connections_total");
    logger.info("ws_connected", {
      connectionId: client.id,
      requestId: req.blockdropRequestId,
    });
    socket.on("message", (message, isBinary) => {
      if (
        isBinary ||
        message.length > MAX_WS_FRAME_BYTES ||
        !allowMessage(client)
      ) {
        metrics.increment("blockdrop_ws_policy_close_total");
        gameManager.safeClose(client, "Rate limited or invalid frame");
        return;
      }
      metrics.increment("blockdrop_ws_messages_total");
      handleMessage(client, message.toString("utf8"));
    });
    socket.on("close", () => {
      if (!client.disconnectObserved) {
        metrics.increment("blockdrop_ws_disconnect_total");
        client.disconnectObserved = true;
      }
      logger.info("ws_disconnected", {
        connectionId: client.id,
        roomId: client.room,
        matchId: rooms.get(client.room)?.authority?.matchId || "",
      });
      gameManager.removeClient(client, "close");
    });
    socket.on("error", () => {
      if (!client.disconnectObserved) {
        metrics.increment("blockdrop_ws_disconnect_total");
        client.disconnectObserved = true;
      }
      gameManager.removeClient(client, "error");
    });
    gameManager.send(client, {
      type: "hello",
      id: client.id,
      protocolVersion: PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      engineVersion: engine.ENGINE_VERSION,
    });
  }

  function handleMessage(client, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      gameManager.safeClose(client, "Bad JSON");
      return;
    }

    if (!isSafePayload(data)) {
      gameManager.safeClose(client, "Bad payload");
      return;
    }

    if (data.type === "join") {
      if (!validateJoinPayload(data)) {
        metrics.increment("blockdrop_ws_policy_close_total");
        gameManager.safeClose(client, "Bad join");
        return;
      }
      gameManager.joinRoom(client, data);
      return;
    }

    if (data.type === "ping") {
      if (!hasOnlyKeys(data, PING_KEYS)) return;
      gameManager.send(client, { type: "pong", ts: safeNumber(data.ts) });
      return;
    }

    if (!client.room) return;

    if (data.type === "input") {
      if (client.role !== "player" || !client.authoritative) return;
      if (!validateInputShape(data)) {
        metrics.increment("blockdrop_ws_policy_close_total");
        gameManager.safeClose(client, "Bad input");
        return;
      }
      if (!inputTargetsActiveMatch(client, data)) {
        metrics.increment("blockdrop_ws_stale_input_total");
        const room = rooms.get(client.room);
        if (room?.match.status === "playing") {
          gameManager.sendAuthoritativeSnapshot(room, client);
        }
        return;
      }
      gameManager.queueAuthoritativeInput(client, data);
      return;
    }

    if (data.type === "update") {
      if (client.authoritative) {
        gameManager.safeClose(
          client,
          "Protocol v2 accepts input commands only",
        );
        return;
      }
      if (client.role !== "player") return;
      if (!allowTypedMessage(client, "update")) return;
      if (!validateUpdatePayload(client, data)) {
        gameManager.safeClose(client, "Bad update");
        return;
      }
      gameManager.updateClientState(client, data);
      gameManager.broadcastRoom(client.room);
      return;
    }

    if (data.type === "attack") {
      if (client.authoritative) {
        gameManager.safeClose(
          client,
          "Protocol v2 calculates attacks on the server",
        );
        return;
      }
      if (client.role !== "player") return;
      if (!allowTypedMessage(client, "attack")) return;
      if (!validateAttackPayload(client, data)) {
        gameManager.safeClose(client, "Bad attack");
        return;
      }
      const lines = Number(data.lines);
      if (!allowAttackLines(client, lines)) return;
      if (!consumeAttackCredit(client, lines)) {
        metrics.increment("blockdrop_ranked_attack_rejected_total");
        return;
      }
      gameManager.broadcastAttack(client, lines);
      return;
    }

    if (data.type === "matchEvent") {
      if (client.authoritative) return;
      if (client.role !== "player") return;
      if (!validateMatchEventPayload(client, data)) {
        gameManager.safeClose(client, "Bad match event");
        return;
      }
      gameManager.recordMatchEvent(client, data);
      return;
    }

    if (data.type === "startTournament") {
      if (client.role !== "player") return;
      if (!validateTournamentPayload(client, data)) return;
      gameManager.startTournament(client.room, data);
      return;
    }

    if (data.type === "rematchReady") {
      if (client.role !== "player") return;
      if (!hasOnlyKeys(data, REMATCH_KEYS) || !matchesClientRoom(client, data))
        return;
      gameManager.markRematchReady(client);
      return;
    }

    if (data.type === "matchOver") {
      if (client.authoritative) return;
      if (client.role !== "player") return;
      if (
        !hasOnlyKeys(data, MATCH_OVER_KEYS) ||
        !matchesClientRoom(client, data)
      )
        return;
      gameManager.finishMatchFromClient(client, data.result);
      return;
    }

    gameManager.safeClose(client, "Unknown message");
  }

  function validateInputShape(data) {
    return (
      hasOnlyKeys(data, INPUT_KEYS) &&
      typeof data.matchId === "string" &&
      data.matchId.length > 0 &&
      data.matchId.length <= 160 &&
      isIntegerInRange(data.seq, 1, 2_147_483_647) &&
      isIntegerInRange(data.tick, 0, 60 * 60 * 60) &&
      INPUT_ACTIONS.has(data.action) &&
      typeof data.pressed === "boolean"
    );
  }

  function inputTargetsActiveMatch(client, data) {
    const room = rooms.get(client.room);
    return (
      room?.authoritative === true &&
      room.match.status === "playing" &&
      String(data.matchId) === room.authority.matchId
    );
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
      (data.rankedQueue == null || typeof data.rankedQueue === "boolean") &&
      String(data.room || "").length <= 32 &&
      normalizePlayerId(data.playerId).length <= 64 &&
      normalizeIdentityToken(data.identityToken).length <= 256 &&
      normalizeIdentityToken(data.accountToken).length <= 256 &&
      normalizeIdentityToken(data.reconnectToken).length <= 256
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
    if (!isSafeBoardPreview(data.boardPreview || data.fieldPreview))
      return false;
    const room = rooms.get(client.room);
    if (room?.ranked && room.match.status === "playing") {
      if (safeNumber(data.score) + 500 < client.state.score) return false;
      if (safeNumber(data.lines) < client.state.lines) return false;
      if (safeNumber(data.sentGarbage) < client.state.sentGarbage) return false;
      if (safeNumber(data.receivedGarbage) < client.state.receivedGarbage)
        return false;
      const seconds = parseTimeSeconds(data.time || client.state.time);
      const serverElapsed = Math.max(
        0,
        (Date.now() - room.match.startedAt) / 1000,
      );
      if (seconds > serverElapsed + 20) return false;
    }
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

  function validateMatchEventPayload(client, data) {
    if (
      !hasOnlyKeys(data, MATCH_EVENT_KEYS) ||
      !matchesClientRoom(client, data)
    )
      return false;
    const eventName = String(data.event || "");
    const room = rooms.get(client.room);
    if (
      !protocol.MATCH_EVENTS.has(eventName) ||
      !room ||
      room.match.status !== "playing"
    )
      return false;

    const now = Date.now();
    if (now - (client.lastRankedEventAt || 0) < 100) return false;
    client.lastRankedEventAt = now;

    const maxAttack = maxAttackForEvent(eventName);
    const attackLines = safeNumber(data.attackLines);
    if (attackLines > maxAttack) return false;

    const combo = safeNumber(data.combo);
    if (combo > 20) return false;
    return true;
  }

  function maxAttackForEvent(eventName) {
    switch (eventName) {
      case "single":
        return 0;
      case "double":
        return 1;
      case "triple":
        return 2;
      case "quad":
      case "tspin_double":
        return 4;
      case "tspin_triple":
        return 6;
      case "perfect_clear":
        return 10;
      default:
        return 4;
    }
  }

  function isSafeBoardPreview(value) {
    if (value == null) return true;
    if (!Array.isArray(value) || value.length > MAX_BOARD_PREVIEW_ROWS)
      return false;
    return value.every(
      (row) =>
        Array.isArray(row) &&
        row.length <= MAX_BOARD_PREVIEW_COLS &&
        row.every(
          (cell) => cell === 0 || cell === 1 || cell === true || cell === false,
        ),
    );
  }

  function allowMessage(client) {
    const now = Date.now();
    if (now - client.buckets.windowStartedAt >= 10000) {
      client.buckets.windowStartedAt = now;
      client.buckets.messages = 0;
    }
    client.buckets.messages += 1;
    return client.buckets.messages <= MAX_MESSAGES_PER_10S;
  }

  function allowTypedMessage(client, type) {
    const now = Date.now();
    if (type === "update") {
      if (now - client.buckets.updateStartedAt >= 1000) {
        client.buckets.updateStartedAt = now;
        client.buckets.updates = 0;
      }
      client.buckets.updates += 1;
      return client.buckets.updates <= MAX_UPDATES_PER_SECOND;
    }
    if (type === "attack") {
      if (now - client.buckets.attackStartedAt >= 1000) {
        client.buckets.attackStartedAt = now;
        client.buckets.attacks = 0;
      }
      client.buckets.attacks += 1;
      return client.buckets.attacks <= MAX_ATTACKS_PER_SECOND;
    }
    return true;
  }

  function allowAttackLines(client, lines) {
    const now = Date.now();
    if (now - client.buckets.attackLinesStartedAt >= 10000) {
      client.buckets.attackLinesStartedAt = now;
      client.buckets.attackLines = 0;
    }
    client.buckets.attackLines += lines;
    return client.buckets.attackLines <= MAX_ATTACK_LINES_PER_10S;
  }

  function consumeAttackCredit(client, lines) {
    const room = rooms.get(client.room);
    if (!room) return false;
    if (!room.ranked) return true;
    if (client.attackCredit >= lines) {
      client.attackCredit -= lines;
      return true;
    }
    return false;
  }

  return {
    handleUpgrade,
    handleConnection,
  };
}

function parseTimeSeconds(timeStr) {
  const parts = String(timeStr || "")
    .split(":")
    .map((part) => Number(part));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 60 + parts[1];
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  createWsHandler,
};
