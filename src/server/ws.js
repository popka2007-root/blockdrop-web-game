module.exports = function setupWs(context) {
  const { crypto, fs, zlib, http, path, QRCode, WebSocket, WebSocketServer, createMetrics, createLogger, clientAddress, isSensitiveTransportAllowed, RANKED_MAX_RATING, RANKED_MIN_RATING, createServerStore, protocol, engine, PORT, ROOT, MAX_WS_FRAME_BYTES, MAX_MESSAGES_PER_10S, MAX_UPDATES_PER_SECOND, MAX_ATTACKS_PER_SECOND, MAX_ATTACK_LINES_PER_10S, MAX_PAYLOAD_KEYS, HTTP_RATE_WINDOW_MS, RECONNECT_GRACE_MS, COUNTDOWN_STEP_MS, MATCH_TICK_MS, SNAPSHOT_INTERVAL_TICKS, RANKED_K_FACTOR, ATTACK_KEY_LIST, MAX_BOARD_PREVIEW_COLS, MAX_BOARD_PREVIEW_ROWS, JOIN_KEY_LIST, INPUT_ACTIONS, INPUT_KEY_LIST, MATCH_OVER_KEY_LIST, MAX_RECORD_SCORE, PING_KEY_LIST, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, REMATCH_KEY_LIST, MATCH_EVENT_KEY_LIST, ROOM_PLAYER_LIMIT, TOURNAMENT_KEY_LIST, UPDATE_KEY_LIST, normalizeIdentityToken, normalizeMatchMode, normalizePlayerId, normalizePlayerName, normalizeRoomId, sanitizeBoardPreview, UPDATE_KEYS, ATTACK_KEYS, REMATCH_KEYS, MATCH_EVENT_KEYS, MATCH_OVER_KEYS, PING_KEYS, JOIN_KEYS, INPUT_KEYS, TOURNAMENT_KEYS, rooms, rankedQueue, httpRateBuckets, startedAt, cachedPackageMeta, store, logger, metrics, eventLoopExpectedAt, previousCpuUsage, previousCpuMeasuredAt, operationalMetricsTimer, mime, securityHeaders, PUBLIC_ROOT_FILES, PUBLIC_PREFIXES } = context;

  const { safeDecodePath, handleHealth, handleLiveness, handleReadiness, sendHealthPayload, handleMetrics, hasMetricsAccess, timingSafeEqualText, serverDateKey, livePlayersCount, liveSpectatorsCount, updateLiveMetrics, readRevision, readPackageMeta, handleCapabilitiesApi, isFeatureEnabled, handleRecordsApi, handleDailyApi, handleDailyRunApi, handleAccountApi, handleRankedApi, readJsonRequest, handleProfileTransferApi, handleAnalyticsApi, authTokenFromRequest, accountFromRequest, sanitizeRecord, sanitizeDailyScore, isPlausibleRecord, isPlausibleDailyScore, verifyDailyReplay, parseTimeSeconds, sendJson, writeHead, allowHttpRequest, sendRateLimited, joinRoom, validateMatchEventPayload, joinRankedQueue, removeQueuedClient, findReconnectSlot, clearReconnect, updateClientState, startTournament, maybeAutoStart, startRankedSeries, startCountdown, startAuthoritativeMatch, stopAuthoritativeMatch, queueAuthoritativeInput, drainAuthoritativeInputs, tickAuthoritativeMatch, finishAuthoritativeResult, updateClientFromEngine, formatTickTime, authoritativeOpponentPayload, sendAuthoritativeSnapshot, sendAuthoritativeSnapshots, markRematchReady, finishMatchFromClient, finishMatch, persistAuthoritativeReplays, finalizeRankedMatch, recordMatchEvent, maxAttackForEvent, rankedParticipant, applyRankedProfileToParticipant, rankedResultPayload, closeStoreAndExit, shutdown } = context;

function createClient(socket, options = {}) {
  return {
    id: crypto.randomUUID(),
    socket,
    room: "",
    role: "player",
    ranked: false,
    playerId: "",
    identityToken: "",
    accountToken: "",
    account: null,
    authTransportAllowed: Boolean(options.authTransportAllowed),
    rankedProfile: null,
    name: "Player",
    protocolVersion: 1,
    authoritative: false,
    reconnectToken: crypto.randomBytes(24).toString("base64url"),
    pendingInputs: [],
    state: emptyState(),
    attackCredit: 0,
    lastRankedEventAt: 0,
    disconnectedAt: 0,
    disconnectObserved: false,
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
    protocolVersion: 0,
    authoritative: false,
    ranked: false,
    mode: "classic",
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
      seriesId: "",
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
    authority: {
      matchId: "",
      serverTick: 0,
      states: new Map(),
      inputQueues: new Map(),
      lastSeq: new Map(),
      inputStreams: new Map(),
      externalEvents: new Map(),
      identities: new Map(),
      tickTimer: null,
      snapshotTick: 0,
    },
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
    if (!validateJoinPayload(data)) {
      metrics.increment("blockdrop_ws_policy_close_total");
      safeClose(client, "Bad join");
      return;
    }
    joinRoom(client, data);
    return;
  }

  if (data.type === "ping") {
    if (!hasOnlyKeys(data, PING_KEYS)) return;
    send(client, { type: "pong", ts: safeNumber(data.ts) });
    return;
  }

  if (!client.room) return;

  if (data.type === "input") {
    if (client.role !== "player" || !client.authoritative) return;
    if (!validateInputShape(data)) {
      metrics.increment("blockdrop_ws_policy_close_total");
      safeClose(client, "Bad input");
      return;
    }
    if (!inputTargetsActiveMatch(client, data)) {
      metrics.increment("blockdrop_ws_stale_input_total");
      const room = rooms.get(client.room);
      if (room?.match.status === "playing") {
        sendAuthoritativeSnapshot(room, client);
      }
      return;
    }
    queueAuthoritativeInput(client, data);
    return;
  }

  if (data.type === "update") {
    if (client.authoritative) {
      safeClose(client, "Protocol v2 accepts input commands only");
      return;
    }
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
    if (client.authoritative) {
      safeClose(client, "Protocol v2 calculates attacks on the server");
      return;
    }
    if (client.role !== "player") return;
    if (!allowTypedMessage(client, "attack")) return;
    if (!validateAttackPayload(client, data)) {
      safeClose(client, "Bad attack");
      return;
    }
    const lines = Number(data.lines);
    if (!allowAttackLines(client, lines)) return;
    if (!consumeAttackCredit(client, lines)) {
      metrics.increment("blockdrop_ranked_attack_rejected_total");
      return;
    }
    broadcastAttack(client, lines);
    return;
  }

  if (data.type === "matchEvent") {
    if (client.authoritative) return;
    if (client.role !== "player") return;
    if (!validateMatchEventPayload(client, data)) {
      safeClose(client, "Bad match event");
      return;
    }
    recordMatchEvent(client, data);
    return;
  }

  if (data.type === "startTournament") {
    if (client.role !== "player") return;
    if (!validateTournamentPayload(client, data)) return;
    startTournament(client.room, data);
    return;
  }

  if (data.type === "rematchReady") {
    if (client.role !== "player") return;
    if (!hasOnlyKeys(data, REMATCH_KEYS) || !matchesClientRoom(client, data))
      return;
    markRematchReady(client);
    return;
  }

  if (data.type === "matchOver") {
    if (client.authoritative) return;
    if (client.role !== "player") return;
    if (!hasOnlyKeys(data, MATCH_OVER_KEYS) || !matchesClientRoom(client, data))
      return;
    finishMatchFromClient(client, data.result);
    return;
  }

  safeClose(client, "Unknown message");
}

function validateInputShape(data) {
  return (
    hasOnlyKeys(data, INPUT_KEYS) &&
    typeof data.matchId === "string" &&
    data.matchId.length > 0 &&
    data.matchId.length <= 160 &&
    isIntegerInRange(data.seq, 1, 2_147_483_647) &&
    isIntegerInRange(data.tick, 0, 60 * 60 * 60) &&
    INPUT_ACTIONS.includes(data.action) &&
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
  if (!isSafeBoardPreview(data.boardPreview || data.fieldPreview)) return false;
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

function consumeAttackCredit(client, lines) {
  const room = rooms.get(client.room);
  if (!room?.ranked) return true;
  if (Date.now() - client.lastRankedEventAt > 5000) return false;
  if (client.attackCredit < lines) return false;
  client.attackCredit -= lines;
  return true;
}

function safeClose(client, reason = "Policy violation") {
  logger.warn("ws_policy_close", {
    connectionId: client.id,
    roomId: client.room,
    matchId: client.matchId,
    reason: String(reason).slice(0, 120),
  });
  send(client, { type: "error", message: reason });
  removeClient(client, "policy");
  try {
    client.socket.close(1008, String(reason).slice(0, 120));
    setTimeout(() => {
      if (client.socket.readyState !== WebSocket.CLOSED)
        client.socket.terminate();
    }, 1000).unref?.();
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
  for (const client of [
    ...room.players.values(),
    ...room.spectators.values(),
  ]) {
    if (predicate(client) && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(message);
    }
  }
}

function send(client, payload) {
  try {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(payload));
    }
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
    mode: room.mode,
    ranked: room.ranked,
    protocolVersion: room.protocolVersion,
    authoritative: room.authoritative,
    matchId: room.authority.matchId || room.match.seed,
    serverTick: room.authority.serverTick,
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
      account: client.account,
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
      account: slot.account,
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
  removeQueuedClient(client);
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
        } else if (
          currentRoom.players.size === 0 &&
          currentRoom.spectators.size === 0
        ) {
          if (currentRoom.match.status === "playing") {
            metrics.increment("blockdrop_match_abort_total");
          }
          stopAuthoritativeMatch(currentRoom);
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
        identityToken: client.identityToken,
        accountToken: client.accountToken,
        account: client.account,
        rankedProfile: client.rankedProfile,
        reconnectToken: client.reconnectToken,
        state: client.state,
        expiresAt,
        timer,
      });
      broadcast(room, {
        type: "reconnecting",
        playerId: id,
        name: client.name,
      });
    }
  }
  client.room = "";
  if (
    room.players.size === 0 &&
    room.spectators.size === 0 &&
    room.reconnects.size === 0
  ) {
    if (room.match.status === "playing") {
      metrics.increment("blockdrop_match_abort_total");
    }
    stopAuthoritativeMatch(room);
    rooms.delete(roomId);
  } else {
    broadcastRoom(roomId);
  }
  updateLiveMetrics();
}

function cleanPlayerId(value) {
  return normalizePlayerId(value);
}

function cleanName(value) {
  return normalizePlayerName(value);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pruneProductData() {
  try {
    const removed = store.pruneExpiredProductData();
    if (Object.values(removed).some(Boolean)) {
      logger.info("expired_product_data_pruned", removed);
    }
  } catch (error) {
    const message = String(error?.message || error);
    metrics.increment("blockdrop_db_errors_total");
    if (/busy|locked/i.test(message)) {
      metrics.increment("blockdrop_db_lock_errors_total");
    }
    logger.error("product_data_prune_failed", {
      error: message.slice(0, 240),
    });
  }
}

  return {
    createClient,
    isAllowedWebSocketOrigin,
    allowedWebSocketOrigins,
    emptyState,
    createRoom,
    handleMessage,
    validateInputShape,
    inputTargetsActiveMatch,
    isSafePayload,
    hasOnlyKeys,
    isIntegerInRange,
    isSafeShortText,
    hasUnsafeTextChars,
    matchesClientRoom,
    validateJoinPayload,
    validateTournamentPayload,
    validateUpdatePayload,
    validateAttackPayload,
    isSafeBoardPreview,
    allowMessage,
    allowTypedMessage,
    allowAttackLines,
    consumeAttackCredit,
    safeClose,
    scheduleTournamentEnd,
    broadcastAttack,
    broadcastRoom,
    broadcast,
    send,
    tournamentPayload,
    matchPayload,
    seriesPayload,
    playersPayload,
    spectatorsPayload,
    removeClient,
    cleanPlayerId,
    cleanName,
    safeNumber,
    clamp,
    pruneProductData,
  };
};
