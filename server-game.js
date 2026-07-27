const crypto = require("crypto");
const { RANKED_MAX_RATING, RANKED_MIN_RATING } = require("./server-store");
const protocol = require("./shared/protocol.js");
const engine = require("./shared/engine.js");

const RECONNECT_GRACE_MS = 12000;
const COUNTDOWN_STEP_MS = 700;
const MATCH_TICK_MS = 1000 / engine.TICK_RATE;
const SNAPSHOT_INTERVAL_TICKS = 6;
const RANKED_K_FACTOR = 32;

const {
  MAX_RECORD_SCORE,
  PROTOCOL_VERSION,
  ROOM_PLAYER_LIMIT,
  normalizeMatchMode,
  normalizePlayerId,
  normalizeRoomId,
  sanitizeBoardPreview,
} = protocol;

function createGameManager({ store, metrics, rooms, rankedQueue }) {
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

  function send(client, payload) {
    if (!client?.socket || client.socket.readyState !== 1) return;
    try {
      client.socket.send(JSON.stringify(payload));
    } catch {
      safeClose(client, "Send failure");
    }
  }

  function safeClose(client, reason = "Closed by server") {
    if (!client?.socket) return;
    try {
      if (client.socket.readyState === 1 || client.socket.readyState === 0) {
        client.socket.close(1000, reason.slice(0, 120));
      }
    } catch {
      // Ignore socket closing exceptions.
    }
  }

  function broadcast(room, payload, excludeClient = null) {
    if (!room) return;
    const raw = JSON.stringify(payload);
    for (const client of room.players.values()) {
      if (client !== excludeClient && client.socket.readyState === 1) {
        try {
          client.socket.send(raw);
        } catch {
          safeClose(client, "Broadcast failure");
        }
      }
    }
    for (const client of room.spectators.values()) {
      if (client !== excludeClient && client.socket.readyState === 1) {
        try {
          client.socket.send(raw);
        } catch {
          safeClose(client, "Broadcast failure");
        }
      }
    }
  }

  function tournamentPayload(room) {
    if (!room?.tournament) return null;
    return {
      active: true,
      stage: room.tournament.stage,
      mode: room.tournament.mode,
      maxPlayers: room.tournament.maxPlayers,
      durationSec: room.tournament.durationSec,
      targetWins: room.tournament.targetWins,
      matchNumber: room.tournament.matchNumber,
      scores: { ...room.tournament.scores },
      winnerId: room.tournament.winnerId,
    };
  }

  function matchPayload(room) {
    if (!room) return { status: "lobby" };
    return {
      status: room.match.status,
      seed: room.match.seed,
      startedAt: room.match.startedAt,
      winnerId: room.match.winnerId,
      loserId: room.match.loserId,
      reason: room.match.reason,
      durationSec: room.durationSec,
      mode: room.mode,
      authoritative: room.authoritative,
      matchId: room.authority.matchId,
    };
  }

  function seriesPayload(room) {
    if (!room?.series?.active) return null;
    return {
      seriesId: room.series.seriesId,
      bestOf: room.series.bestOf,
      targetWins: room.series.targetWins,
      wins: { ...room.series.wins },
      matchNumber: room.series.matchNumber,
      completed: room.series.completed,
      winnerId: room.series.winnerId,
    };
  }

  function playersPayload(room) {
    return Array.from(room.players.values()).map((client) => ({
      id: client.id,
      playerId: client.playerId,
      name: client.name,
      role: client.role,
      ranked: client.ranked,
      state: client.state,
      rematchReady: room.rematchReady.has(client.id),
      account: client.account ? store.publicAccount(client.account) : null,
      rankedProfile: client.rankedProfile,
      connected: Boolean(client.socket && client.socket.readyState === 1),
    }));
  }

  function spectatorsPayload(room) {
    return Array.from(room.spectators.values()).map((client) => ({
      id: client.id,
      name: client.name,
      role: client.role,
    }));
  }

  function broadcastRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    broadcast(room, {
      type: "room",
      room: room.id,
      protocolVersion: room.protocolVersion,
      authoritative: room.authoritative,
      ranked: room.ranked,
      mode: room.mode,
      durationSec: room.durationSec,
      match: matchPayload(room),
      series: seriesPayload(room),
      tournament: tournamentPayload(room),
      lastRankedResult: room.lastRankedResult,
      players: playersPayload(room),
      spectators: spectatorsPayload(room),
    });
  }

  function joinRankedQueue(client, data) {
    const accountToken = protocol.normalizeIdentityToken(data.accountToken);
    const account = store.getAccountBySession(accountToken);
    if (!account) {
      send(client, {
        type: "error",
        code: "authRequired",
        message: "Ranked play requires account login",
      });
      return;
    }
    client.accountToken = accountToken;
    client.account = account;
    client.playerId = `acct.${cleanPlayerId(account.id)}`;
    client.name = account.displayName;
    client.rankedProfile = store.getRankedProfile(client.playerId);
    client.protocolVersion = Math.max(2, client.protocolVersion);
    client.authoritative = true;

    if (!rankedQueue.some((item) => item.client.id === client.id)) {
      rankedQueue.push({ client, joinedAt: Date.now() });
      metrics.set("blockdrop_ranked_queue_waiting", rankedQueue.length);
    }

    send(client, {
      type: "rankedQueueStatus",
      status: "queued",
      queueWaiting: rankedQueue.length,
      rating: client.rankedProfile.rating,
      tier: client.rankedProfile.tier,
    });

    if (rankedQueue.length >= 2) {
      const p1 = rankedQueue.shift().client;
      const p2 = rankedQueue.shift().client;
      metrics.set("blockdrop_ranked_queue_waiting", rankedQueue.length);

      const roomId = `RANKED-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const room = createRoom(roomId, 2, 180);
      room.ranked = true;
      room.mode = "classic";
      room.authoritative = true;
      room.protocolVersion = 2;
      rooms.set(roomId, room);

      joinRoom(p1, { room: roomId, protocolVersion: 2, ranked: true });
      joinRoom(p2, { room: roomId, protocolVersion: 2, ranked: true });
      startRankedSeries(room);
    }
  }

  function removeQueuedClient(client) {
    const idx = rankedQueue.findIndex((item) => item.client.id === client.id);
    if (idx !== -1) {
      rankedQueue.splice(idx, 1);
      metrics.set("blockdrop_ranked_queue_waiting", rankedQueue.length);
      send(client, { type: "rankedQueueStatus", status: "idle" });
    }
  }

  function findReconnectSlot(room, data) {
    const token = protocol.normalizeIdentityToken(data.reconnectToken);
    if (!token) return null;
    return room.reconnects.get(token) || null;
  }

  function clearReconnect(room, token) {
    if (!token) return;
    const existing = room.reconnects.get(token);
    if (existing) {
      if (existing.client?.disconnectTimer) {
        clearTimeout(existing.client.disconnectTimer);
      }
      room.reconnects.delete(token);
    }
  }

  function joinRoom(client, data) {
    removeClient(client, "rejoin");
    removeQueuedClient(client);

    if (data.rankedQueue === true) {
      joinRankedQueue(client, data);
      return;
    }

    const roomId = normalizeRoomId(data.room) || "LOBBY";
    let room = rooms.get(roomId);
    const requestedProtocol = clamp(
      safeNumber(data.protocolVersion) || 1,
      1,
      PROTOCOL_VERSION,
    );

    if (!room) {
      room = createRoom(
        roomId,
        clamp(safeNumber(data.maxPlayers) || ROOM_PLAYER_LIMIT, 2, 8),
        clamp(safeNumber(data.durationSec) || 180, 60, 1800),
      );
      room.mode = normalizeMatchMode(data.mode);
      room.protocolVersion = requestedProtocol;
      room.authoritative = requestedProtocol >= 2;
      rooms.set(roomId, room);
    }

    client.protocolVersion = Math.min(
      requestedProtocol,
      room.protocolVersion || 2,
    );
    client.authoritative = room.authoritative;
    client.reconnectToken =
      protocol.normalizeIdentityToken(data.reconnectToken) ||
      client.reconnectToken;

    const account = store.getAccountBySession(data.accountToken);
    if (account) {
      client.accountToken = data.accountToken;
      client.account = account;
      client.playerId = `acct.${cleanPlayerId(account.id)}`;
      client.name = account.displayName;
    } else {
      client.playerId =
        normalizePlayerId(data.playerId) || cleanPlayerId(client.id);
      client.name = cleanName(data.name || "Player");
    }
    client.rankedProfile = store.getRankedProfile(client.playerId);

    const slot = findReconnectSlot(room, data);
    if (slot && slot.client !== client) {
      clearReconnect(room, client.reconnectToken);
      const oldClient = slot.client;
      client.state = oldClient.state;
      client.attackCredit = oldClient.attackCredit;

      if (room.players.has(oldClient.id)) {
        room.players.delete(oldClient.id);
        room.players.set(client.id, client);
      } else if (room.spectators.has(oldClient.id)) {
        room.spectators.delete(oldClient.id);
        room.spectators.set(client.id, client);
      }

      if (room.authority.states.has(oldClient.id)) {
        const engineState = room.authority.states.get(oldClient.id);
        room.authority.states.delete(oldClient.id);
        room.authority.states.set(client.id, engineState);
      }
      if (room.authority.inputQueues.has(oldClient.id)) {
        const queue = room.authority.inputQueues.get(oldClient.id);
        room.authority.inputQueues.delete(oldClient.id);
        room.authority.inputQueues.set(client.id, queue);
      }
      if (room.authority.lastSeq.has(oldClient.id)) {
        const lastSeq = room.authority.lastSeq.get(oldClient.id);
        room.authority.lastSeq.delete(oldClient.id);
        room.authority.lastSeq.set(client.id, lastSeq);
      }
    } else {
      if (room.players.size < room.maxPlayers) {
        client.role = "player";
        room.players.set(client.id, client);
      } else {
        client.role = "spectator";
        room.spectators.set(client.id, client);
      }
    }

    client.room = room.id;
    send(client, {
      type: "joined",
      room: room.id,
      role: client.role,
      reconnectToken: client.reconnectToken,
      protocolVersion: room.protocolVersion,
      authoritative: room.authoritative,
      ranked: room.ranked,
      mode: room.mode,
      durationSec: room.durationSec,
      players: playersPayload(room),
      spectators: spectatorsPayload(room),
    });

    broadcastRoom(room.id);
    maybeAutoStart(room);
  }

  function removeClient(client, reason = "leave") {
    removeQueuedClient(client);
    if (!client.room) return;
    const room = rooms.get(client.room);
    if (!room) return;

    if (reason === "close" || reason === "error") {
      client.disconnectedAt = Date.now();
      room.reconnects.set(client.reconnectToken, {
        client,
        disconnectedAt: Date.now(),
      });

      client.disconnectTimer = setTimeout(() => {
        finalizeClientRemoval(client, room, "reconnectTimeout");
      }, RECONNECT_GRACE_MS);
      return;
    }

    finalizeClientRemoval(client, room, reason);
  }

  function finalizeClientRemoval(client, room, reason) {
    clearReconnect(room, client.reconnectToken);
    room.players.delete(client.id);
    room.spectators.delete(client.id);
    room.rematchReady.delete(client.id);
    client.room = "";

    if (room.players.size === 0 && room.spectators.size === 0) {
      stopAuthoritativeMatch(room);
      rooms.delete(room.id);
    } else {
      if (room.match.status === "playing" && client.role === "player") {
        const remainingPlayers = Array.from(room.players.values());
        const winner = remainingPlayers[0];
        finishMatch(
          room,
          winner?.id || "",
          client.id,
          reason === "reconnectTimeout" ? "disconnect" : "forfeit",
        );
      }
      broadcastRoom(room.id);
    }
  }

  function updateClientState(client, data) {
    client.state = {
      score: clamp(safeNumber(data.score), 0, MAX_RECORD_SCORE),
      lines: clamp(safeNumber(data.lines), 0, 9999),
      level: clamp(safeNumber(data.level), 1, 99),
      height: clamp(safeNumber(data.height), 0, 20),
      sentGarbage: clamp(safeNumber(data.sentGarbage), 0, 9999),
      receivedGarbage: clamp(safeNumber(data.receivedGarbage), 0, 9999),
      mode: String(data.mode || client.state.mode || "Classic").slice(0, 24),
      time: String(data.time || "0:00").slice(0, 12),
      status: String(data.status || "Playing").slice(0, 18),
      boardPreview: sanitizeBoardPreview(
        data.boardPreview || data.fieldPreview,
      ),
    };
  }

  function startTournament(roomId, data) {
    const room = rooms.get(roomId);
    if (!room || room.players.size < 2) return;
    room.tournament = {
      active: true,
      stage: "active",
      mode: normalizeMatchMode(data.mode),
      maxPlayers: clamp(safeNumber(data.maxPlayers) || ROOM_PLAYER_LIMIT, 2, 8),
      durationSec: clamp(safeNumber(data.durationSec) || 180, 60, 1800),
      targetWins: 2,
      matchNumber: 1,
      scores: {},
      winnerId: "",
    };
    for (const player of room.players.values()) {
      room.tournament.scores[player.id] = 0;
    }
    startCountdown(room);
  }

  function maybeAutoStart(room) {
    if (room.match.status !== "lobby" || room.players.size < 2) return;
    startCountdown(room);
  }

  function startRankedSeries(room) {
    room.series = {
      active: true,
      seriesId: `SERIES-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
      bestOf: 3,
      targetWins: 2,
      wins: {},
      matchNumber: 1,
      completed: false,
      winnerId: "",
    };
    for (const player of room.players.values()) {
      room.series.wins[player.id] = 0;
    }
    startCountdown(room);
  }

  function startCountdown(room) {
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    room.match.status = "countdown";
    room.rematchReady.clear();
    let step = 3;

    broadcast(room, { type: "countdown", step });
    broadcastRoom(room.id);

    room.countdownTimer = setInterval(() => {
      step -= 1;
      if (step > 0) {
        broadcast(room, { type: "countdown", step });
      } else {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
        if (room.authoritative) {
          startAuthoritativeMatch(room);
        } else {
          startClientMatch(room);
        }
      }
    }, COUNTDOWN_STEP_MS);
  }

  function startClientMatch(room) {
    room.match = {
      status: "playing",
      seed: crypto.randomBytes(8).toString("hex"),
      startedAt: Date.now(),
      winnerId: "",
      loserId: "",
      reason: "",
    };
    for (const client of room.players.values()) {
      client.state = emptyState();
      client.state.status = "Playing";
      client.attackCredit = 0;
    }
    broadcast(room, {
      type: "matchStart",
      seed: room.match.seed,
      startedAt: room.match.startedAt,
      durationSec: room.durationSec,
      mode: room.mode,
    });
    broadcastRoom(room.id);
  }

  function startAuthoritativeMatch(room) {
    stopAuthoritativeMatch(room);
    room.authority.matchId = `MATCH-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    room.authority.serverTick = 0;
    room.authority.states.clear();
    room.authority.inputQueues.clear();
    room.authority.lastSeq.clear();
    room.authority.inputStreams.clear();
    room.authority.externalEvents.clear();
    room.authority.identities.clear();
    room.authority.snapshotTick = 0;

    room.match = {
      status: "playing",
      seed: crypto.randomBytes(8).toString("hex"),
      startedAt: Date.now(),
      winnerId: "",
      loserId: "",
      reason: "",
    };

    const players = Array.from(room.players.values());
    for (const client of players) {
      client.state = emptyState();
      client.state.status = "Playing";
      client.attackCredit = 0;

      const engineState = engine.createState({
        seed: `${room.match.seed}:${client.id}`,
        mode: room.mode,
      });

      room.authority.states.set(client.id, engineState);
      room.authority.inputQueues.set(client.id, []);
      room.authority.lastSeq.set(client.id, 0);
      room.authority.inputStreams.set(client.id, []);
      room.authority.externalEvents.set(client.id, []);
      room.authority.identities.set(client.id, {
        id: client.id,
        playerId: client.playerId,
        name: client.name,
      });

      updateClientFromEngine(client, engineState);
    }

    broadcast(room, {
      type: "matchStart",
      matchId: room.authority.matchId,
      seed: room.match.seed,
      startedAt: room.match.startedAt,
      durationSec: room.durationSec,
      mode: room.mode,
      authoritative: true,
      players: playersPayload(room),
    });

    sendAuthoritativeSnapshots(room);
    broadcastRoom(room.id);

    room.authority.tickTimer = setInterval(() => {
      tickAuthoritativeMatch(room);
    }, MATCH_TICK_MS);
  }

  function stopAuthoritativeMatch(room) {
    if (room.authority.tickTimer) {
      clearInterval(room.authority.tickTimer);
      room.authority.tickTimer = null;
    }
  }

  function queueAuthoritativeInput(client, data) {
    const room = rooms.get(client.room);
    if (!room || !room.authoritative || room.match.status !== "playing") return;

    const queue = room.authority.inputQueues.get(client.id);
    const lastSeq = room.authority.lastSeq.get(client.id) || 0;
    if (!queue || data.seq <= lastSeq) return;

    if (queue.length > 500) {
      safeClose(client, "Input buffer overflow");
      return;
    }

    queue.push({
      seq: Number(data.seq),
      tick: Number(data.tick),
      action: String(data.action),
      pressed: Boolean(data.pressed),
    });
    room.authority.lastSeq.set(client.id, data.seq);
  }

  function drainAuthoritativeInputs(room, clientId, currentTick) {
    const queue = room.authority.inputQueues.get(clientId);
    const engineState = room.authority.states.get(clientId);
    const inputStream = room.authority.inputStreams.get(clientId);
    const externalEvents = room.authority.externalEvents.get(clientId);
    if (!queue || !engineState || !inputStream || !externalEvents) return;

    while (queue.length > 0 && queue[0].tick <= currentTick) {
      const item = queue.shift();
      const events = engine.applyInput(engineState, item, externalEvents);
      inputStream.push({
        tick: item.tick,
        seq: item.seq,
        action: item.action,
        pressed: item.pressed,
      });

      if (events.sentAttacks > 0) {
        const clients = Array.from(room.players.values());
        const opponent = clients.find((c) => c.id !== clientId);
        if (opponent) {
          const oppEvents = room.authority.externalEvents.get(opponent.id);
          if (oppEvents) {
            oppEvents.push({
              tick: currentTick,
              kind: "garbage",
              lines: events.sentAttacks,
            });
            engine.enqueueGarbage(
              room.authority.states.get(opponent.id),
              events.sentAttacks,
            );
          }
        }
      }
    }
  }

  function tickAuthoritativeMatch(room) {
    if (room.match.status !== "playing") return;
    room.authority.serverTick += 1;
    const currentTick = room.authority.serverTick;
    const players = Array.from(room.players.values());

    for (const client of players) {
      const engineState = room.authority.states.get(client.id);
      if (!engineState || engineState.gameOver) continue;

      drainAuthoritativeInputs(room, client.id, currentTick);
      engine.step(engineState);
      updateClientFromEngine(client, engineState);
    }

    const alive = players.filter((c) => {
      const st = room.authority.states.get(c.id);
      return st && !st.gameOver;
    });

    if (players.length >= 2 && alive.length <= 1) {
      const winner = alive[0];
      const loser = players.find((c) => c.id !== winner?.id);
      finishAuthoritativeResult(
        room,
        winner?.id || "",
        loser?.id || "",
        "topout",
      );
      return;
    }

    if (currentTick % SNAPSHOT_INTERVAL_TICKS === 0) {
      sendAuthoritativeSnapshots(room);
    }
  }

  function updateClientFromEngine(client, engineState) {
    client.state = {
      score: engineState.score,
      lines: engineState.lines,
      level: engineState.level,
      height: engineState.height || 0,
      sentGarbage: engineState.sentGarbage || 0,
      receivedGarbage: engineState.receivedGarbage || 0,
      mode: engineState.mode || "Classic",
      time: formatTickTime(engineState.tick),
      status: engineState.gameOver ? "Knocked Out" : "Playing",
      boardPreview: sanitizeBoardPreview(
        engine.snapshot(engineState).boardPreview,
      ),
    };
  }

  function formatTickTime(tick) {
    const seconds = Math.floor(tick / engine.TICK_RATE);
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function authoritativeOpponentPayload(room, targetClient) {
    const opponent = Array.from(room.players.values()).find(
      (c) => c.id !== targetClient.id,
    );
    if (!opponent) return null;
    const oppState = room.authority.states.get(opponent.id);
    if (!oppState) return null;
    const snap = engine.snapshot(oppState);
    return {
      id: opponent.id,
      name: opponent.name,
      score: oppState.score,
      lines: oppState.lines,
      level: oppState.level,
      height: oppState.height || 0,
      status: oppState.gameOver ? "Knocked Out" : "Playing",
      boardPreview: snap.boardPreview,
    };
  }

  function sendAuthoritativeSnapshot(room, client) {
    const engineState = room.authority.states.get(client.id);
    if (!engineState) return;
    const snapshot = engine.snapshot(engineState);
    const lastSeq = room.authority.lastSeq.get(client.id) || 0;
    send(client, {
      type: "authoritativeState",
      matchId: room.authority.matchId,
      serverTick: room.authority.serverTick,
      ackSeq: lastSeq,
      state: snapshot,
      opponent: authoritativeOpponentPayload(room, client),
    });
  }

  function sendAuthoritativeSnapshots(room) {
    for (const client of room.players.values()) {
      sendAuthoritativeSnapshot(room, client);
    }
  }

  function finishAuthoritativeResult(room, winnerId, loserId, reason) {
    stopAuthoritativeMatch(room);
    persistAuthoritativeReplays(room, winnerId, loserId, reason);
    finishMatch(room, winnerId, loserId, reason);
  }

  function persistAuthoritativeReplays(room, winnerId, loserId, reason) {
    const matchId = room.authority.matchId;
    if (!matchId) return;

    for (const client of room.players.values()) {
      const engineState = room.authority.states.get(client.id);
      const inputs = room.authority.inputStreams.get(client.id);
      const externalEvents = room.authority.externalEvents.get(client.id);
      if (!engineState || !inputs) continue;

      const finalSnap = engine.snapshot(engineState);
      const result = {
        score: finalSnap.score,
        lines: finalSnap.lines,
        level: finalSnap.level,
        winner: client.id === winnerId,
        reason,
      };

      store.saveReplay({
        id: `match:${matchId}:${client.id}`,
        playerId: client.playerId,
        mode: room.mode,
        engineVersion: engine.ENGINE_VERSION,
        replaySchemaVersion: 1,
        seed: `${room.match.seed}:${client.id}`,
        inputStream: {
          inputs,
          externalEvents: externalEvents || [],
          finalTick: engineState.tick,
          metadata: { matchId, roomId: room.id, role: client.role },
        },
        checkpoints: [],
        result,
        checksum: finalSnap.checksum || "",
        verificationStatus: "verified",
        createdAt: Date.now(),
        expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
      });
    }
  }

  function markRematchReady(client) {
    const room = rooms.get(client.room);
    if (!room || room.match.status !== "finished") return;
    room.rematchReady.add(client.id);
    broadcast(room, {
      type: "rematchReady",
      id: client.id,
      rematchReady: Array.from(room.rematchReady),
    });
    if (room.rematchReady.size >= Math.min(2, room.players.size)) {
      startCountdown(room);
    }
  }

  function finishMatchFromClient(client, resultData) {
    const room = rooms.get(client.room);
    if (!room || room.match.status !== "playing") return;
    if (room.authoritative) return;

    const winnerId = resultData?.winnerId || client.id;
    const loserId =
      Array.from(room.players.keys()).find((id) => id !== winnerId) || "";
    finishMatch(room, winnerId, loserId, resultData?.reason || "knockout");
  }

  function finishMatch(room, winnerId, loserId, reason) {
    stopAuthoritativeMatch(room);
    room.match.status = "finished";
    room.match.winnerId = winnerId;
    room.match.loserId = loserId;
    room.match.reason = reason;

    if (room.series?.active) {
      if (winnerId) {
        room.series.wins[winnerId] = (room.series.wins[winnerId] || 0) + 1;
      }
      if (room.series.wins[winnerId] >= room.series.targetWins) {
        room.series.completed = true;
        room.series.winnerId = winnerId;
      } else {
        room.series.matchNumber += 1;
      }
    }

    if (room.ranked) {
      finalizeRankedMatch(room, winnerId, loserId);
    }

    broadcast(room, {
      type: "matchOver",
      winnerId,
      loserId,
      reason,
      series: seriesPayload(room),
      rankedResult: room.lastRankedResult,
    });
    broadcastRoom(room.id);
  }

  function finalizeRankedMatch(room, winnerId, loserId) {
    const winnerClient = room.players.get(winnerId);
    const loserClient = room.players.get(loserId);
    if (!winnerClient || !loserClient) return;

    const p1 = winnerClient.rankedProfile;
    const p2 = loserClient.rankedProfile;
    if (!p1 || !p2) return;

    const expected1 = 1 / (1 + Math.pow(10, (p2.rating - p1.rating) / 400));
    const newRating1 = clamp(
      Math.round(p1.rating + RANKED_K_FACTOR * (1 - expected1)),
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    );
    const newRating2 = clamp(
      Math.round(p2.rating + RANKED_K_FACTOR * (0 - (1 - expected1))),
      RANKED_MIN_RATING,
      RANKED_MAX_RATING,
    );

    const updated1 = store.updateRankedRating(
      winnerClient.playerId,
      newRating1,
      true,
    );
    const updated2 = store.updateRankedRating(
      loserClient.playerId,
      newRating2,
      false,
    );

    winnerClient.rankedProfile = updated1;
    loserClient.rankedProfile = updated2;

    room.lastRankedResult = {
      matchId: room.authority.matchId,
      winnerId,
      loserId,
      changes: {
        [winnerClient.id]: {
          oldRating: p1.rating,
          newRating: updated1.rating,
          delta: updated1.rating - p1.rating,
          tier: updated1.tier,
        },
        [loserClient.id]: {
          oldRating: p2.rating,
          newRating: updated2.rating,
          delta: updated2.rating - p2.rating,
          tier: updated2.tier,
        },
      },
    };
  }

  function recordMatchEvent(client, data) {
    const room = rooms.get(client.room);
    if (!room || room.match.status !== "playing") return;
    const eventName = String(data.event || "");
    metrics.increment(`blockdrop_event_${eventName}_total`);
  }

  function broadcastAttack(client, lines) {
    const room = rooms.get(client.room);
    if (!room) return;
    broadcast(
      room,
      {
        type: "attack",
        fromId: client.id,
        fromName: client.name,
        lines,
      },
      client,
    );
  }

  return {
    emptyState,
    createClient,
    createRoom,
    send,
    safeClose,
    broadcast,
    broadcastRoom,
    joinRankedQueue,
    removeQueuedClient,
    joinRoom,
    removeClient,
    updateClientState,
    startTournament,
    maybeAutoStart,
    startRankedSeries,
    startCountdown,
    startAuthoritativeMatch,
    stopAuthoritativeMatch,
    queueAuthoritativeInput,
    tickAuthoritativeMatch,
    finishAuthoritativeResult,
    sendAuthoritativeSnapshot,
    markRematchReady,
    finishMatchFromClient,
    finishMatch,
    recordMatchEvent,
    broadcastAttack,
  };
}

function cleanName(value) {
  return String(value || "\u0418\u0433\u0440\u043e\u043a")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 18);
}

function cleanPlayerId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 64);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  createGameManager,
};
