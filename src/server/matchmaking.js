module.exports = function setupMatchmaking(context) {
  const { crypto, fs, zlib, http, path, QRCode, WebSocket, WebSocketServer, createMetrics, createLogger, clientAddress, isSensitiveTransportAllowed, RANKED_MAX_RATING, RANKED_MIN_RATING, createServerStore, protocol, engine, PORT, ROOT, MAX_WS_FRAME_BYTES, MAX_MESSAGES_PER_10S, MAX_UPDATES_PER_SECOND, MAX_ATTACKS_PER_SECOND, MAX_ATTACK_LINES_PER_10S, MAX_PAYLOAD_KEYS, HTTP_RATE_WINDOW_MS, RECONNECT_GRACE_MS, COUNTDOWN_STEP_MS, MATCH_TICK_MS, SNAPSHOT_INTERVAL_TICKS, RANKED_K_FACTOR, ATTACK_KEY_LIST, MAX_BOARD_PREVIEW_COLS, MAX_BOARD_PREVIEW_ROWS, JOIN_KEY_LIST, INPUT_ACTIONS, INPUT_KEY_LIST, MATCH_OVER_KEY_LIST, MAX_RECORD_SCORE, PING_KEY_LIST, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, REMATCH_KEY_LIST, MATCH_EVENT_KEY_LIST, ROOM_PLAYER_LIMIT, TOURNAMENT_KEY_LIST, UPDATE_KEY_LIST, normalizeIdentityToken, normalizeMatchMode, normalizePlayerId, normalizePlayerName, normalizeRoomId, sanitizeBoardPreview, UPDATE_KEYS, ATTACK_KEYS, REMATCH_KEYS, MATCH_EVENT_KEYS, MATCH_OVER_KEYS, PING_KEYS, JOIN_KEYS, INPUT_KEYS, TOURNAMENT_KEYS, rooms, rankedQueue, httpRateBuckets, startedAt, cachedPackageMeta, store, logger, metrics, eventLoopExpectedAt, previousCpuUsage, previousCpuMeasuredAt, operationalMetricsTimer, mime, securityHeaders, PUBLIC_ROOT_FILES, PUBLIC_PREFIXES } = context;

  const { safeDecodePath, handleHealth, handleLiveness, handleReadiness, sendHealthPayload, handleMetrics, hasMetricsAccess, timingSafeEqualText, serverDateKey, livePlayersCount, liveSpectatorsCount, updateLiveMetrics, readRevision, readPackageMeta, handleCapabilitiesApi, isFeatureEnabled, handleRecordsApi, handleDailyApi, handleDailyRunApi, handleAccountApi, handleRankedApi, readJsonRequest, handleProfileTransferApi, handleAnalyticsApi, authTokenFromRequest, accountFromRequest, sanitizeRecord, sanitizeDailyScore, isPlausibleRecord, isPlausibleDailyScore, verifyDailyReplay, parseTimeSeconds, sendJson, writeHead, allowHttpRequest, sendRateLimited, createClient, isAllowedWebSocketOrigin, allowedWebSocketOrigins, emptyState, createRoom, handleMessage, validateInputShape, inputTargetsActiveMatch, isSafePayload, hasOnlyKeys, isIntegerInRange, isSafeShortText, hasUnsafeTextChars, matchesClientRoom, validateJoinPayload, validateTournamentPayload, validateUpdatePayload, validateAttackPayload, isSafeBoardPreview, allowMessage, allowTypedMessage, allowAttackLines, consumeAttackCredit, safeClose, scheduleTournamentEnd, broadcastAttack, broadcastRoom, broadcast, send, tournamentPayload, matchPayload, seriesPayload, playersPayload, spectatorsPayload, removeClient, cleanPlayerId, cleanName, safeNumber, clamp, pruneProductData, closeStoreAndExit, shutdown } = context;

function joinRoom(client, data) {
  removeClient(client, "rejoin");
  removeQueuedClient(client);
  const roomId = normalizeRoomId(data.room) || "LOBBY";
  const room = rooms.get(roomId);
  const requestedProtocol = clamp(
    safeNumber(data.protocolVersion) || 1,
    1,
    PROTOCOL_VERSION,
  );
  const rankedRequested =
    data.rankedQueue === true || data.ranked === true || Boolean(room?.ranked);
  if (rankedRequested && requestedProtocol < 2) {
    send(client, {
      type: "error",
      code: "protocolUpgradeRequired",
      message: "Ranked play requires WebSocket protocol v2",
    });
    return;
  }
  if (
    rankedRequested &&
    !isFeatureEnabled("ranked", client.authTransportAllowed, client.id)
  ) {
    send(client, {
      type: "error",
      code: "rankedDisabled",
      message: "Ranked play is disabled",
    });
    return;
  }
  if (rankedRequested && !client.authTransportAllowed) {
    send(client, {
      type: "error",
      code: "secureTransportRequired",
      message: "Ranked play requires HTTPS",
    });
    return;
  }
  const accountToken = client.authTransportAllowed
    ? normalizeIdentityToken(data.accountToken)
    : "";
  const account = accountToken ? store.getAccountBySession(accountToken) : null;
  if (data.rankedQueue === true) {
    joinRankedQueue(client, data, account, accountToken);
    return;
  }
  const playerId = normalizePlayerId(data.playerId);
  const identityToken = normalizeIdentityToken(data.identityToken);
  const requestedMode = normalizeMatchMode(data.mode);
  const maxPlayers = ROOM_PLAYER_LIMIT;
  const durationSec = clamp(safeNumber(data.durationSec) || 180, 60, 1800);
  let identity = null;
  if (rankedRequested) {
    identity = store.resolveRankedIdentity({
      playerId: playerId || client.id,
      name: data.name,
      identityToken,
      account,
    });
    if (!identity?.accepted) {
      logger.warn("ranked_identity_rejected", {
        roomId,
        playerId: playerId || client.id,
        code: identity?.code || "unknown",
      });
      send(client, {
        type: "error",
        message: "Ranked identity mismatch",
      });
      safeClose(client, "Ranked identity mismatch");
      return;
    }
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId, maxPlayers, durationSec));
  }
  const actualRoom = rooms.get(roomId);
  const casualV2Enabled = isFeatureEnabled("casualV2", false, roomId);
  const selectedProtocol =
    rankedRequested || (requestedProtocol >= 2 && casualV2Enabled) ? 2 : 1;
  if (actualRoom.protocolVersion === 2 && selectedProtocol < 2) {
    send(client, {
      type: "error",
      code: "protocolUpgradeRequired",
      message: "This room requires WebSocket protocol v2",
    });
    return;
  }
  if (!actualRoom.protocolVersion)
    actualRoom.protocolVersion = selectedProtocol;
  client.protocolVersion = actualRoom.protocolVersion;
  client.authoritative = client.protocolVersion === 2;
  actualRoom.authoritative = actualRoom.protocolVersion === 2;
  if (actualRoom.match.status === "lobby") {
    actualRoom.maxPlayers = ROOM_PLAYER_LIMIT;
    actualRoom.durationSec = durationSec;
    if (actualRoom.players.size === 0 && actualRoom.spectators.size === 0) {
      actualRoom.ranked = rankedRequested;
      actualRoom.mode = requestedMode;
    }
  }

  client.room = roomId;
  client.name = cleanName(data.name || normalizePlayerName(data.name));
  client.ranked = Boolean(actualRoom.ranked);
  client.playerId =
    client.ranked && identity?.profile
      ? identity.profile.id
      : client.ranked
        ? playerId || client.id
        : "";
  client.identityToken = identity?.identityToken || "";
  client.accountToken = accountToken;
  client.account = account ? store.publicAccount(account) : null;
  client.rankedProfile = client.ranked ? identity?.profile || null : null;
  client.state = emptyState();

  const reconnectId = findReconnectSlot(
    actualRoom,
    client.name,
    client.playerId,
    normalizeIdentityToken(data.reconnectToken),
    client.protocolVersion,
  );
  if (reconnectId) {
    const slot = actualRoom.reconnects.get(reconnectId);
    clearReconnect(actualRoom, reconnectId);
    client.id = reconnectId;
    client.role = "player";
    client.ranked = Boolean(slot?.ranked || actualRoom.ranked);
    client.playerId = slot?.playerId || client.playerId;
    client.identityToken = slot?.identityToken || client.identityToken;
    client.accountToken = slot?.accountToken || client.accountToken;
    client.account = slot?.account || client.account;
    client.rankedProfile = slot?.rankedProfile || client.rankedProfile;
    client.reconnectToken = slot?.reconnectToken || client.reconnectToken;
    client.pendingInputs = [];
    actualRoom.players.set(client.id, client);
  } else if (
    actualRoom.players.size < actualRoom.maxPlayers &&
    actualRoom.match.status !== "playing"
  ) {
    client.role = "player";
    actualRoom.players.set(client.id, client);
  } else {
    client.role = "spectator";
    actualRoom.spectators.set(client.id, client);
  }

  send(client, {
    type: "hello",
    id: client.id,
    protocolVersion: client.protocolVersion,
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    engineVersion: engine.ENGINE_VERSION,
  });
  send(client, {
    type: "protocol",
    selectedVersion: client.protocolVersion,
    authoritative: client.authoritative,
    reconnectToken: client.reconnectToken,
    reconnectGraceMs: RECONNECT_GRACE_MS,
  });
  send(client, { type: "role", role: client.role });
  if (client.rankedProfile) {
    send(client, {
      type: "rankedProfile",
      ...store.publicRankedProfile(client.rankedProfile),
      account: client.account,
    });
  }
  if (client.role === "spectator") {
    send(client, {
      type: "notice",
      code: "spectator",
      message: "Room is full, spectator mode enabled",
    });
  }
  broadcastRoom(roomId);
  updateLiveMetrics();
  if (
    reconnectId &&
    actualRoom.authoritative &&
    actualRoom.match.status === "playing"
  ) {
    sendAuthoritativeSnapshot(actualRoom, client);
  }
  maybeAutoStart(actualRoom);
}

function validateMatchEventPayload(client, data) {
  return (
    hasOnlyKeys(data, MATCH_EVENT_KEYS) &&
    matchesClientRoom(client, data) &&
    isSafeShortText(data.eventType, 24) &&
    isIntegerInRange(data.lines ?? 0, 0, 4) &&
    isIntegerInRange(data.attackLines ?? 0, 0, 12) &&
    isIntegerInRange(data.combo ?? 0, 0, 999) &&
    isIntegerInRange(data.score ?? 0, 0, MAX_RECORD_SCORE) &&
    isIntegerInRange(data.elapsedMs ?? 0, 0, 3 * 60 * 60 * 1000)
  );
}

function joinRankedQueue(client, data, account, accountToken) {
  if (!account) {
    send(client, {
      type: "error",
      message: "Account required for ranked matchmaking",
    });
    return;
  }
  const waiting = rankedQueue.find(
    (entry) =>
      entry.client.socket?.readyState === WebSocket.OPEN &&
      entry.account.id !== account.id,
  );
  client.name = cleanName(account.displayName || data.name);
  client.accountToken = accountToken;
  client.account = store.publicAccount(account);
  client.playerId = `acct.${cleanPlayerId(account.id)}`;
  client.ranked = true;
  client.state = emptyState();
  for (let index = rankedQueue.length - 1; index >= 0; index -= 1) {
    if (rankedQueue[index].account.id === account.id)
      rankedQueue.splice(index, 1);
  }
  if (!waiting) {
    rankedQueue.push({
      client,
      account,
      accountToken,
      data: {
        ...data,
        room: "",
        ranked: true,
        name: client.name,
        playerId: client.playerId,
      },
    });
    send(client, { type: "queued", mode: normalizeMatchMode(data.mode) });
    return;
  }

  rankedQueue.splice(rankedQueue.indexOf(waiting), 1);
  const roomId = `RANK${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  send(waiting.client, { type: "matchFound", room: roomId });
  send(client, { type: "matchFound", room: roomId });
  joinRoom(waiting.client, {
    ...waiting.data,
    room: roomId,
    ranked: true,
    rankedQueue: false,
    accountToken: waiting.accountToken,
  });
  joinRoom(client, {
    ...data,
    room: roomId,
    ranked: true,
    rankedQueue: false,
    accountToken,
    name: client.name,
    playerId: client.playerId,
  });
}

function removeQueuedClient(client) {
  const index = rankedQueue.findIndex((entry) => entry.client === client);
  if (index >= 0) rankedQueue.splice(index, 1);
}

function findReconnectSlot(
  room,
  _name,
  _playerId = "",
  reconnectToken = "",
  _protocolVersion = 1,
) {
  for (const [id, slot] of room.reconnects.entries()) {
    if (
      reconnectToken &&
      timingSafeEqualText(reconnectToken, slot.reconnectToken || "")
    ) {
      return id;
    }
  }
  return "";
}

function clearReconnect(room, id) {
  const slot = room.reconnects.get(id);
  if (slot?.timer) clearTimeout(slot.timer);
  room.reconnects.delete(id);
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
    boardPreview: sanitizeBoardPreview(data.boardPreview || data.fieldPreview),
  };
}

function startTournament(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.maxPlayers = ROOM_PLAYER_LIMIT;
  room.durationSec = clamp(
    safeNumber(data.durationSec) || room.durationSec,
    60,
    1800,
  );
  if (room.match.status === "lobby") {
    room.mode = normalizeMatchMode(data.mode || room.mode);
  }
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

function maybeAutoStart(room) {
  if (!room || room.maxPlayers !== ROOM_PLAYER_LIMIT) return;
  if (room.match.status !== "lobby" && room.match.status !== "finished") return;
  if (room.players.size !== 2 || room.countdownTimer) return;
  if (room.ranked && !room.series.active) startRankedSeries(room);
  startCountdown(room, "matchStart");
}

function startRankedSeries(room) {
  room.series = {
    active: true,
    seriesId: `series:${room.id}:${Date.now()}`,
    bestOf: 3,
    targetWins: 2,
    wins: Object.fromEntries([...room.players.keys()].map((id) => [id, 0])),
    matchNumber: 1,
    completed: false,
    winnerId: "",
  };
  room.lastRankedResult = null;
}

function startCountdown(room, finalType) {
  room.match.status = "countdown";
  room.match.seed = `pvp:${room.id}:${Date.now()}:${Math.random()}`;
  room.rematchReady.clear();
  let value = 3;
  const tick = () => {
    if (!rooms.has(room.id) || room.players.size < 2) {
      room.match.status = "lobby";
      room.countdownTimer = null;
      broadcastRoom(room.id);
      return;
    }
    if (value > 0) {
      broadcast(room, { type: "countdown", value });
      value -= 1;
      room.countdownTimer = setTimeout(tick, COUNTDOWN_STEP_MS);
      return;
    }
    room.countdownTimer = null;
    room.match.status = "playing";
    room.match.startedAt = Date.now();
    room.match.winnerId = "";
    room.match.loserId = "";
    room.match.reason = "";
    for (const player of room.players.values()) {
      player.state = emptyState();
      player.attackCredit = 0;
      player.lastRankedEventAt = 0;
    }
    if (room.authoritative) startAuthoritativeMatch(room);
    broadcast(room, {
      type: finalType,
      seed: room.match.seed,
      matchId: room.authority.matchId || room.match.seed,
      mode: room.mode,
      startedAt: room.match.startedAt,
      protocolVersion: room.protocolVersion,
      engineVersion: engine.ENGINE_VERSION,
      authoritative: room.authoritative,
    });
    if (room.authoritative) sendAuthoritativeSnapshots(room, true);
    broadcastRoom(room.id);
  };
  tick();
}

function startAuthoritativeMatch(room) {
  stopAuthoritativeMatch(room);
  const authority = room.authority;
  authority.matchId = `match:${room.id}:${crypto.randomUUID()}`;
  authority.serverTick = 0;
  authority.snapshotTick = 0;
  authority.states = new Map();
  authority.inputQueues = new Map();
  authority.lastSeq = new Map();
  authority.inputStreams = new Map();
  authority.externalEvents = new Map();
  authority.identities = new Map();
  for (const player of [...room.players.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const gameState = engine.createState({
      seed: room.match.seed,
      mode: room.mode,
    });
    authority.states.set(player.id, gameState);
    authority.inputQueues.set(player.id, new Map());
    authority.lastSeq.set(player.id, 0);
    authority.inputStreams.set(player.id, []);
    authority.externalEvents.set(player.id, []);
    authority.identities.set(player.id, player.playerId || player.id);
    updateClientFromEngine(player, gameState);
  }
  store.createMatchSession({
    id: authority.matchId,
    roomId: room.id,
    protocolVersion: room.protocolVersion,
    engineVersion: engine.ENGINE_VERSION,
    mode: room.mode,
    seed: room.match.seed,
    status: "playing",
    createdAt: room.match.startedAt,
    startedAt: room.match.startedAt,
    expiresAt: room.match.startedAt + 30 * 24 * 60 * 60 * 1000,
  });
  authority.tickTimer = setInterval(
    () => tickAuthoritativeMatch(room.id),
    MATCH_TICK_MS,
  );
  authority.tickTimer.unref?.();
}

function stopAuthoritativeMatch(room) {
  if (room?.authority?.tickTimer) clearInterval(room.authority.tickTimer);
  if (room?.authority) room.authority.tickTimer = null;
}

function queueAuthoritativeInput(client, data) {
  const room = rooms.get(client.room);
  const state = room?.authority.states.get(client.id);
  const queue = room?.authority.inputQueues.get(client.id);
  if (!room || !state || !queue) return;
  const seq = safeNumber(data.seq);
  if (seq <= state.lastAckSeq || queue.has(seq)) {
    sendAuthoritativeSnapshot(room, client);
    return;
  }
  if (seq > state.lastAckSeq + 120) {
    safeClose(client, "Input sequence too far ahead");
    return;
  }
  const input = {
    tick: clamp(safeNumber(data.tick), 0, state.tick + 120),
    seq,
    action: data.action,
    pressed: data.pressed !== false,
  };
  queue.set(seq, input);
  room.authority.lastSeq.set(
    client.id,
    Math.max(seq, room.authority.lastSeq.get(client.id) || 0),
  );
  store.appendMatchInput({
    matchId: room.authority.matchId,
    playerId: client.playerId || client.id,
    ...input,
  });
}

function drainAuthoritativeInputs(room, playerId, state) {
  const queue = room.authority.inputQueues.get(playerId);
  if (!queue) return [];
  const inputs = [];
  let expectedSeq = state.lastAckSeq + 1;
  while (inputs.length < 32) {
    const input = queue.get(expectedSeq);
    if (!input || input.tick > state.tick + 6) break;
    queue.delete(expectedSeq);
    inputs.push(input);
    room.authority.inputStreams.get(playerId)?.push(input);
    expectedSeq += 1;
  }
  return inputs;
}

function tickAuthoritativeMatch(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.authoritative || room.match.status !== "playing") {
    if (room) stopAuthoritativeMatch(room);
    return;
  }
  const orderedIds = [...room.authority.states.keys()].sort();
  const results = [];
  const allEvents = [];
  const tickStartedAt = performance.now();
  for (const playerId of orderedIds) {
    const state = room.authority.states.get(playerId);
    if (!state || state.gameOver) continue;
    const inputs = drainAuthoritativeInputs(room, playerId, state);
    const { events } = engine.step(state, inputs);
    const player = room.players.get(playerId);
    if (player) updateClientFromEngine(player, state);
    for (const event of events) {
      allEvents.push({ playerId, ...event });
      if (event.type === "lock" && event.attack > 0) {
        const targetId = orderedIds.find((id) => id !== playerId);
        const targetState = targetId
          ? room.authority.states.get(targetId)
          : null;
        if (targetState && !targetState.gameOver) {
          engine.queueGarbage(targetState, event.attack);
          room.authority.externalEvents.get(targetId)?.push({
            tick: targetState.tick,
            type: "garbage",
            lines: event.attack,
          });
          allEvents.push({
            type: "garbageQueued",
            tick: state.tick,
            playerId,
            targetId,
            lines: event.attack,
          });
        }
      }
      if (event.type === "gameResult") {
        results.push({ playerId, won: Boolean(event.won), state });
      }
    }
    if (
      state.gameOver &&
      !results.some((result) => result.playerId === playerId)
    ) {
      results.push({ playerId, won: Boolean(state.won), state });
    }
  }
  room.authority.serverTick += 1;
  metrics.observe?.(
    "blockdrop_match_processing_ms",
    Math.max(0, performance.now() - tickStartedAt),
  );
  for (const event of allEvents) {
    broadcast(room, {
      type: "match.event",
      matchId: room.authority.matchId,
      serverTick: room.authority.serverTick,
      event,
    });
  }
  if (results.length) {
    finishAuthoritativeResult(room, results, orderedIds);
    return;
  }
  if (
    room.authority.serverTick - room.authority.snapshotTick >=
    SNAPSHOT_INTERVAL_TICKS
  ) {
    room.authority.snapshotTick = room.authority.serverTick;
    sendAuthoritativeSnapshots(room);
  }
}

function finishAuthoritativeResult(room, results, orderedIds) {
  const winningResult = results.find((result) => result.won);
  let winnerId = winningResult?.playerId || "";
  if (!winnerId) {
    winnerId = orderedIds.find(
      (id) => !room.authority.states.get(id)?.gameOver,
    );
  }
  if (!winnerId) {
    winnerId = [...orderedIds].sort((left, right) => {
      const leftState = room.authority.states.get(left);
      const rightState = room.authority.states.get(right);
      return (
        rightState.score - leftState.score ||
        rightState.lines - leftState.lines ||
        left.localeCompare(right)
      );
    })[0];
  }
  const loserId = orderedIds.find((id) => id !== winnerId) || "";
  finishMatch(room, {
    reason: winningResult ? "goal" : "gameOver",
    winnerId,
    loserId,
  });
}

function updateClientFromEngine(client, state) {
  const boardPreview = state.board
    .slice(-MAX_BOARD_PREVIEW_ROWS)
    .map((row) => row.map((cell) => (cell ? 1 : 0)));
  client.state = {
    score: state.score,
    lines: state.lines,
    level: state.level,
    height: state.board.findIndex((row) => row.some(Boolean)),
    sentGarbage: state.sentGarbage,
    receivedGarbage: state.receivedGarbage,
    mode: state.mode,
    time: formatTickTime(state.tick),
    status: state.gameOver ? (state.won ? "Won" : "Finished") : "Playing",
    boardPreview,
  };
  if (client.state.height < 0) client.state.height = 0;
  else client.state.height = engine.ROWS - client.state.height;
}

function formatTickTime(tick) {
  const totalSeconds = Math.floor(safeNumber(tick) / engine.TICK_RATE);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function authoritativeOpponentPayload(room, ownId) {
  return [...room.authority.states.entries()]
    .filter(([id]) => id !== ownId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, state]) => ({
      id,
      board: state.board,
      active: state.active,
      stats: {
        score: state.score,
        lines: state.lines,
        level: state.level,
        combo: state.combo,
        sentGarbage: state.sentGarbage,
        receivedGarbage: state.receivedGarbage,
      },
      pendingGarbage: state.pendingGarbage,
      gameOver: state.gameOver,
    }));
}

function sendAuthoritativeSnapshot(room, client) {
  const state = room.authority.states.get(client.id);
  if (!state) return;
  const gameSnapshot = engine.snapshot(state);
  send(client, {
    type: "match.snapshot",
    matchId: room.authority.matchId,
    serverTick: room.authority.serverTick,
    ackSeq: state.lastAckSeq,
    board: gameSnapshot.board,
    active: gameSnapshot.active,
    queue: gameSnapshot.queue.slice(0, 5),
    hold: gameSnapshot.hold,
    stats: {
      score: gameSnapshot.score,
      lines: gameSnapshot.lines,
      level: gameSnapshot.level,
      combo: gameSnapshot.combo,
      sentGarbage: gameSnapshot.sentGarbage,
      receivedGarbage: gameSnapshot.receivedGarbage,
    },
    pendingGarbage: gameSnapshot.pendingGarbage,
    gameSnapshot,
    opponents: authoritativeOpponentPayload(room, client.id),
  });
}

function sendAuthoritativeSnapshots(room, includeSpectators = false) {
  for (const client of room.players.values()) {
    sendAuthoritativeSnapshot(room, client);
  }
  if (includeSpectators || room.spectators.size) {
    const players = authoritativeOpponentPayload(room, "");
    broadcast(
      room,
      {
        type: "match.snapshot",
        matchId: room.authority.matchId,
        serverTick: room.authority.serverTick,
        spectator: true,
        players,
      },
      (client) => client.role === "spectator",
    );
  }
}

function markRematchReady(client) {
  const room = rooms.get(client.room);
  if (!room || client.role !== "player") return;
  if (room.players.size < 2) {
    send(client, { type: "error", message: "Opponent left" });
    return;
  }
  room.rematchReady.add(client.id);
  broadcastRoom(room.id);
  const allReady = [...room.players.keys()].every((id) =>
    room.rematchReady.has(id),
  );
  if (allReady) {
    if (room.ranked && room.series.completed) startRankedSeries(room);
    else if (room.ranked && !room.series.active) startRankedSeries(room);
    startCountdown(room, "rematchStart");
  }
}

function finishMatchFromClient(client, result) {
  const room = rooms.get(client.room);
  if (!room || room.match.status !== "playing") return;
  const other = [...room.players.values()].find(
    (player) => player.id !== client.id,
  );
  if (!other) return;
  const clientWon = room.ranked ? false : result === "win";
  finishMatch(room, {
    reason: "gameOver",
    winnerId: clientWon ? client.id : other.id,
    loserId: clientWon ? other.id : client.id,
  });
}

function finishMatch(room, { reason, winnerId, loserId }) {
  stopAuthoritativeMatch(room);
  room.match.status = "finished";
  room.match.reason = reason;
  room.match.winnerId = winnerId;
  room.match.loserId = loserId;
  room.rematchReady.clear();
  const ranked = room.ranked
    ? finalizeRankedMatch(room, { winnerId, loserId, reason })
    : null;
  if (room.authoritative && room.authority.matchId) {
    const result = {
      reason,
      winnerId,
      loserId,
      finishedAt: Date.now(),
    };
    const checksum = engine.checksum(
      [...room.authority.states.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, state]) => [id, engine.snapshot(state)]),
    );
    persistAuthoritativeReplays(room, result);
    store.createMatchSession({
      id: room.authority.matchId,
      roomId: room.id,
      protocolVersion: room.protocolVersion,
      engineVersion: engine.ENGINE_VERSION,
      mode: room.mode,
      seed: room.match.seed,
      status: "finished",
      result,
      checksum,
      verificationStatus: "verified",
      createdAt: room.match.startedAt,
      startedAt: room.match.startedAt,
      finishedAt: result.finishedAt,
      expiresAt: result.finishedAt + 30 * 24 * 60 * 60 * 1000,
    });
    broadcast(room, {
      type: "match.result",
      matchId: room.authority.matchId,
      serverTick: room.authority.serverTick,
      checksum,
      ...result,
    });
  }
  broadcast(room, {
    type: "matchFinished",
    reason,
    winnerId,
    loserId,
    ranked,
    series: seriesPayload(room),
  });
  broadcastRoom(room.id);
}

function persistAuthoritativeReplays(room, result) {
  const createdAt = Number(room.match.startedAt) || Date.now();
  const expiresAt = Number(result.finishedAt) + 30 * 24 * 60 * 60 * 1000;
  for (const [connectionId, finalState] of room.authority.states.entries()) {
    const replay = engine.createReplay({
      seed: room.match.seed,
      mode: room.mode,
      inputs: room.authority.inputStreams.get(connectionId) || [],
      externalEvents: room.authority.externalEvents.get(connectionId) || [],
      finalState,
      metadata: {
        matchId: room.authority.matchId,
        connectionId,
        winnerId: result.winnerId,
        loserId: result.loserId,
        reason: result.reason,
        ranked: room.ranked,
      },
    });
    const verification = engine.simulateReplay(replay);
    store.saveReplay({
      id: `${room.authority.matchId}:${connectionId}`,
      matchId: room.authority.matchId,
      playerId: room.authority.identities.get(connectionId) || connectionId,
      mode: room.mode,
      engineVersion: engine.ENGINE_VERSION,
      replaySchemaVersion: engine.REPLAY_VERSION,
      seed: room.match.seed,
      inputStream: {
        inputs: replay.inputs,
        externalEvents: replay.externalEvents,
        finalTick: replay.finalTick,
        metadata: replay.metadata,
      },
      checkpoints: replay.checkpoints,
      result,
      checksum: replay.finalChecksum,
      verificationStatus: verification.ok ? "verified" : verification.code,
      createdAt,
      expiresAt,
    });
  }
}

function finalizeRankedMatch(room, { winnerId, loserId, reason }) {
  const winner = rankedParticipant(room, winnerId);
  const loser = rankedParticipant(room, loserId);
  if (
    !winner?.playerId ||
    !loser?.playerId ||
    winner.playerId === loser.playerId
  )
    return null;

  const winnerBefore = store.normalizeRankedPlayer(
    store.getRankedProfile(winner.playerId, winner.name),
    winner.playerId,
    winner.name,
  );
  const loserBefore = store.normalizeRankedPlayer(
    store.getRankedProfile(loser.playerId, loser.name),
    loser.playerId,
    loser.name,
  );
  const expectedWinner =
    1 / (1 + 10 ** ((loserBefore.rating - winnerBefore.rating) / 400));
  const delta = clamp(
    Math.round(RANKED_K_FACTOR * (1 - expectedWinner)),
    8,
    RANKED_K_FACTOR,
  );
  const winnerAfter = {
    ...winnerBefore,
    name: cleanName(winner.name),
    rating: clamp(
      winnerBefore.rating + delta,
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    ),
    wins: winnerBefore.wins + 1,
    streak: winnerBefore.streak >= 0 ? winnerBefore.streak + 1 : 1,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    identitySecret: winnerBefore.identitySecret,
  };
  winnerAfter.bestWinStreak = Math.max(
    winnerAfter.bestWinStreak,
    winnerAfter.streak,
  );
  const loserAfter = {
    ...loserBefore,
    name: cleanName(loser.name),
    rating: clamp(
      loserBefore.rating - delta,
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    ),
    losses: loserBefore.losses + 1,
    streak: loserBefore.streak <= 0 ? loserBefore.streak - 1 : -1,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    identitySecret: loserBefore.identitySecret,
  };
  loserAfter.bestLossStreak = Math.max(
    loserAfter.bestLossStreak,
    Math.abs(loserAfter.streak),
  );

  const winnerSaved = store.upsertRankedProfile(winnerAfter);
  const loserSaved = store.upsertRankedProfile(loserAfter);
  applyRankedProfileToParticipant(room, winnerId, winnerSaved);
  applyRankedProfileToParticipant(room, loserId, loserSaved);

  const matchIndex = room.series?.matchNumber || 1;

  if (room.series.active && !room.series.completed) {
    room.series.wins[winnerId] = (room.series.wins[winnerId] || 0) + 1;
    if (room.series.wins[winnerId] >= room.series.targetWins) {
      room.series.completed = true;
      room.series.winnerId = winnerId;
    } else {
      room.series.matchNumber += 1;
    }
  }

  room.lastRankedResult = {
    reason,
    winner: rankedResultPayload(winner, winnerBefore, winnerSaved),
    loser: rankedResultPayload(loser, loserBefore, loserSaved),
    series: seriesPayload(room),
  };
  store.logRankedMatch({
    id: `${room.series?.seriesId || room.id}:${matchIndex}:${winner.playerId}:${loser.playerId}`,
    roomId: room.id,
    seriesId: room.series?.seriesId || `series:${room.id}`,
    matchIndex,
    mode: room.mode,
    reason,
    startedAt: room.match.startedAt || Date.now(),
    finishedAt: Date.now(),
    winner: room.lastRankedResult.winner,
    loser: room.lastRankedResult.loser,
  });
  metrics.increment("blockdrop_ranked_matches_total");
  logger.info("ranked_match_logged", {
    roomId: room.id,
    reason,
    winnerId: winner.playerId,
    loserId: loser.playerId,
    matchIndex,
  });
  return room.lastRankedResult;
}

function recordMatchEvent(client, data) {
  const room = rooms.get(client.room);
  if (!room || room.match.status !== "playing") return;
  const elapsedMs = safeNumber(data.elapsedMs);
  if (room.ranked) {
    const startedElapsed = Date.now() - room.match.startedAt;
    if (elapsedMs > startedElapsed + 15000) return;
    const attackLines = clamp(safeNumber(data.attackLines), 0, 12);
    const lines = clamp(safeNumber(data.lines), 0, 4);
    if (attackLines > maxAttackForEvent(lines, safeNumber(data.combo))) {
      metrics.increment("blockdrop_ranked_event_rejected_total");
      return;
    }
    client.attackCredit = clamp(client.attackCredit + attackLines, 0, 24);
    client.lastRankedEventAt = Date.now();
    store.logRankedEvent({
      matchId: room.match.seed,
      roomId: room.id,
      playerId: client.playerId || client.id,
      eventType: data.eventType,
      lines,
      attackLines,
      combo: data.combo,
      score: data.score,
      elapsedMs,
    });
    metrics.increment("blockdrop_ranked_events_received_total");
  }
}

function maxAttackForEvent(lines, combo) {
  const base = [0, 0, 1, 2, 4][clamp(lines, 0, 4)] || 0;
  const comboBonus = combo >= 2 ? Math.min(4, Math.floor(combo / 2)) : 0;
  return Math.min(12, base + comboBonus + 4);
}

function rankedParticipant(room, id) {
  const client = room.players.get(id);
  if (client) {
    return {
      id,
      playerId: client.playerId,
      name: client.name,
      state: client.state,
    };
  }
  const slot = room.reconnects.get(id);
  if (!slot) return null;
  return {
    id,
    playerId: slot.playerId,
    name: slot.name,
    state: slot.state,
  };
}

function applyRankedProfileToParticipant(room, id, profile) {
  const client = room.players.get(id);
  if (client) client.rankedProfile = profile;
  const slot = room.reconnects.get(id);
  if (slot) slot.rankedProfile = profile;
}

function rankedResultPayload(participant, before, after) {
  return {
    id: participant.id,
    playerId: participant.playerId,
    name: participant.name,
    ratingBefore: before.rating,
    ratingAfter: after.rating,
    ratingDelta: after.rating - before.rating,
    streak: after.streak,
    bestWinStreak: after.bestWinStreak,
    bestLossStreak: after.bestLossStreak,
    stats: {
      score: participant.state.score,
      lines: participant.state.lines,
      sentGarbage: participant.state.sentGarbage,
      receivedGarbage: participant.state.receivedGarbage,
      time: participant.state.time,
    },
  };
}

  return {
    joinRoom,
    validateMatchEventPayload,
    joinRankedQueue,
    removeQueuedClient,
    findReconnectSlot,
    clearReconnect,
    updateClientState,
    startTournament,
    maybeAutoStart,
    startRankedSeries,
    startCountdown,
    startAuthoritativeMatch,
    stopAuthoritativeMatch,
    queueAuthoritativeInput,
    drainAuthoritativeInputs,
    tickAuthoritativeMatch,
    finishAuthoritativeResult,
    updateClientFromEngine,
    formatTickTime,
    authoritativeOpponentPayload,
    sendAuthoritativeSnapshot,
    sendAuthoritativeSnapshots,
    markRematchReady,
    finishMatchFromClient,
    finishMatch,
    persistAuthoritativeReplays,
    finalizeRankedMatch,
    recordMatchEvent,
    maxAttackForEvent,
    rankedParticipant,
    applyRankedProfileToParticipant,
    rankedResultPayload,
  };
};
