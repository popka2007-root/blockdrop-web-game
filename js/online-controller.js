import {
  buildRoomInviteUrl,
  connectOnline as openOnlineSocket,
  defaultServerUrl,
  disconnectOnline as closeOnlineSocket,
  generateRoomCode,
  loadRankedIdentityToken,
  loadAccountToken,
  loadOrCreatePlayerId,
  normalizeRoomId,
  onOnlineMessage,
  saveRankedIdentityToken,
  sendOnlineMessage,
  sendRematchReady,
  sendScoreUpdate,
} from "./online.js";

export function createOnlineController({
  state,
  storage,
  ui,
  onlineClient,
  normalizeModeKey,
  onlineText,
  defaultPlayerName,
  formatTime,
  showToast,
  shareText,
  copyTextToClipboard,
  updateLayoutMetrics,
  startGame,
  syncUi,
  setSession,
  isOnlineSession,
  finish,
  receiveGarbage,
  currentHeight,
  modeName,
  buildBoardPreview,
}) {
  function emitOnlineEvent(type, detail = {}) {
    globalThis.dispatchEvent(
      new CustomEvent("blockdrop:online-event", {
        detail: { type, ...detail },
      }),
    );
  }

  function updateOnlineControls() {
    ui.setOnlineButtonState(state.online.connected);
  }

  function renderOnlinePlayers() {
    const players = Object.values(state.online.peers || {})
      .sort((a, b) => b.score - a.score)
      .map((player) => ({
        ...player,
        status: player.ranked
          ? `${player.rating || 1000} MMR · ${player.status || "Lobby"}`
          : player.status,
      }));
    ui.renderOnlinePlayers(players, state.online.tournament, formatTime);
  }

  function renderOnlinePanel() {
    const players = Object.values(state.online.peers || {})
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    ui.renderOnlinePanel({
      connected: state.online.connected,
      room: state.online.ranked
        ? `Ranked ${state.online.room}`
        : state.online.room,
      tournament: state.online.tournament,
      players,
      formatTime,
    });
  }

  function showRankedResultToast(data) {
    const ranked = data.ranked;
    if (!ranked) {
      showToast(onlineText("Матч завершён", "Match finished"));
      return;
    }
    const self =
      ranked.winner?.id === state.online.id ? ranked.winner : ranked.loser;
    const result =
      ranked.winner?.id === state.online.id
        ? onlineText("Победа", "Win")
        : onlineText("Поражение", "Loss");
    const series = ranked.series?.completed
      ? onlineText("Серия завершена", "Series complete")
      : onlineText("Серия продолжается", "Series continues");
    showToast(
      `${result}: ${self.ratingBefore} -> ${self.ratingAfter} (${self.ratingDelta >= 0 ? "+" : ""}${self.ratingDelta}) · ${series}`,
    );
  }

  function showTournamentResults(playersObject) {
    const players = Object.values(playersObject || {}).sort(
      (a, b) => b.score - a.score,
    );
    if (ui.renderTournamentResults(players, state.running && !state.gameOver)) {
      state.running = false;
      state.gameOver = true;
      storage.clearSave();
    }
  }

  function ensureRoomCode() {
    const room =
      normalizeRoomId(ui.getOnlineForm().room || state.online.room) ||
      generateRoomCode();
    ui.setOnlineRoom(room);
    storage.saveRoomCode(room);
    ui.renderRoomInvite({ room, url: roomInviteUrl(room) });
    return room;
  }

  function roomInviteUrl(room = ensureRoomCode()) {
    return buildRoomInviteUrl(globalThis.location, room);
  }

  function inviteText(room) {
    return onlineText(
      `Заходи в комнату BlockDrop ${room}: ${roomInviteUrl(room)}`,
      `Join my BlockDrop room ${room}: ${roomInviteUrl(room)}`,
    );
  }

  function openOnline({ autoConnect = false } = {}) {
    const form = ui.getOnlineForm();
    const room = form.room || storage.loadRoomCode("") || generateRoomCode();
    ui.setOnlineDefaults({
      server: form.server || defaultServerUrl(),
      room,
      name: form.name || storage.loadPlayerName(defaultPlayerName()),
    });
    if (storage.loadAccountName?.("")) {
      ui.setAccountSession?.({
        username: storage.loadAccountName(""),
        displayName: storage.loadAccountName(""),
      });
    }
    ui.renderRoomInvite({ room, url: roomInviteUrl(room) });
    ui.showOverlay("onlineOverlay");
    renderOnlinePlayers();
    updateOnlineControls();
    updateLayoutMetrics();
    if (autoConnect && !state.online.connected) connectOnline();
  }

  function shareRoomLink() {
    const room = ensureRoomCode();
    shareText(inviteText(room));
  }

  function copyRoomLink() {
    const room = ensureRoomCode();
    const link = roomInviteUrl(room);
    copyTextToClipboard(
      link,
      onlineText("Ссылка скопирована", "Link copied"),
      onlineText("Не удалось скопировать", "Copy failed"),
    );
  }

  function createFriendRoom() {
    const room = generateRoomCode();
    ui.setOnlineRoom(room);
    ui.setOnlineRanked(false);
    storage.saveRoomCode(room);
    state.online.room = room;
    state.online.mode = normalizeModeKey(ui.getStartMode());
    state.online.ranked = false;
    const link = roomInviteUrl(room);
    if (globalThis.location.protocol.startsWith("http")) {
      globalThis.history.replaceState(null, "", link);
    }
    openOnline({ autoConnect: true });
    copyTextToClipboard(
      link,
      onlineText(
        "Комната создана, ссылка скопирована",
        "Room created, link copied",
      ),
      onlineText("Комната создана", "Room created"),
    );
  }

  function disconnectOnline(show = true) {
    closeOnlineSocket(onlineClient);
    state.online.connected = false;
    state.online.peers = {};
    state.online.tournament = null;
    state.online.mode = normalizeModeKey(ui.getStartMode());
    state.online.ranked = false;
    state.online.rankedResult = null;
    state.online.series = null;
    if (isOnlineSession()) setSession({ type: "solo", source: "disconnect" });
    renderOnlinePanel();
    renderOnlinePlayers();
    updateOnlineControls();
    updateLayoutMetrics();
    emitOnlineEvent("disconnect", {
      room: state.online.room,
      role: onlineClient.role,
    });
    if (show) showToast(onlineText("Онлайн отключён", "Online disconnected"));
  }

  function connectOnline() {
    const { server, name: rawName, ranked, maxPlayers, durationSec } =
      ui.getOnlineForm();
    const room = ensureRoomCode();
    const name = (rawName || defaultPlayerName()).slice(0, 18);
    const playerId = loadOrCreatePlayerId();
    const identityToken = loadRankedIdentityToken();
    const accountToken = storage.loadAccountToken?.("") || loadAccountToken();
    const mode = normalizeModeKey(ui.getStartMode());
    storage.saveRankedPlayerId(playerId);
    storage.savePlayerName(name);
    storage.saveRoomCode(room);
    ui.setOnlineRoom(room);
    disconnectOnline(false);
    try {
      state.online.room = room;
      state.online.mode = mode;
      state.online.name = name;
      state.online.ranked = Boolean(ranked);
      ui.setOnlineStatus(onlineText("Подключение...", "Connecting..."));
      openOnlineSocket(onlineClient, {
        server,
        room,
        name,
        maxPlayers,
        durationSec,
        mode,
        ranked,
        playerId,
        identityToken,
        accountToken,
      });
      state.online.connected = false;
    } catch {
      showToast(onlineText("Неверный адрес сервера", "Invalid server address"));
    }
  }

  function findRankedMatch() {
    const accountToken = storage.loadAccountToken?.("") || loadAccountToken();
    if (!accountToken) {
      showToast(
        onlineText(
          "Для быстрого ranked нужен аккаунт",
          "Sign in to find a ranked match",
        ),
      );
      return;
    }
    const { server, name: rawName, maxPlayers, durationSec } = ui.getOnlineForm();
    const name = (rawName || storage.loadAccountName?.("") || defaultPlayerName()).slice(0, 18);
    const playerId = loadOrCreatePlayerId();
    const identityToken = loadRankedIdentityToken();
    const mode = normalizeModeKey(ui.getStartMode());
    disconnectOnline(false);
    try {
      state.online.room = "RANKED";
      state.online.mode = mode;
      state.online.name = name;
      state.online.ranked = true;
      ui.setOnlineRanked(true);
      ui.setOnlineStatus(onlineText("Ищем ranked матч...", "Finding ranked match..."));
      openOnlineSocket(onlineClient, {
        server,
        room: "RANKED",
        name,
        maxPlayers,
        durationSec,
        mode,
        ranked: true,
        playerId,
        identityToken,
        accountToken,
        rankedQueue: true,
      });
      state.online.connected = false;
    } catch {
      showToast(onlineText("Неверный адрес сервера", "Invalid server address"));
    }
  }

  function toggleOnlineConnection() {
    if (state.online.connected) disconnectOnline();
    else connectOnline();
  }

  function startOnlineGame() {
    ui.hideOverlay("onlineOverlay");
    startGame(ui.getStartMode(), state.difficulty, {
      session: {
        type: "online",
        source: "manual",
        room: state.online.room,
        ranked: state.online.ranked,
      },
    });
    syncUi();
  }

  function sendOnlineUpdate(force = false) {
    if (!state.online.connected || !isOnlineSession()) return;
    state.online.lastSent = performance.now();
    sendScoreUpdate(onlineClient, {
      room: state.online.room,
      name: state.online.name,
      score: state.score,
      lines: state.lines,
      level: state.level,
      height: currentHeight(),
      sentGarbage: state.sentGarbage,
      receivedGarbage: state.receivedGarbage,
      boardPreview: buildBoardPreview ? buildBoardPreview() : [],
      mode: modeName(),
      time: formatTime(state.elapsedMs),
      status: state.gameOver
        ? state.won
          ? "Победа"
          : "Финиш"
        : state.paused
          ? "Пауза"
          : "Играет",
      force,
    });
  }

  function sendOnlineUpdateThrottled() {
    if (performance.now() - state.online.lastSent > 700) {
      sendOnlineUpdate(false);
    }
  }

  function startTournament() {
    if (!state.online.connected) {
      showToast("Сначала подключись к комнате");
      return;
    }
    const { maxPlayers, durationSec } = ui.getOnlineForm();
    sendOnlineMessage(onlineClient, {
      type: "startTournament",
      room: state.online.room,
      maxPlayers,
      durationSec,
      mode: normalizeModeKey(ui.getStartMode()),
    });
    showToast("Турнир запускается");
    startGame(ui.getStartMode(), state.difficulty, {
      session: {
        type: "online",
        source: "tournament",
        room: state.online.room,
        ranked: state.online.ranked,
      },
    });
  }

  function requestRematch() {
    if (!state.online.connected) {
      showToast(
        onlineText("Сначала подключись к комнате", "Connect to a room first"),
      );
      return;
    }
    if (onlineClient.role === "spectator") {
      showToast(
        onlineText(
          "Зритель не может начать реванш",
          "Spectators cannot rematch",
        ),
      );
      return;
    }
    sendRematchReady(onlineClient, state.online.room);
    showToast(onlineText("Ждём готовность соперника", "Waiting for opponent"));
  }

  onOnlineMessage(onlineClient, (data) => {
    if (data.type === "open") {
      state.online.connected = true;
      ui.setOnlineStatus(onlineText(`Комната ${data.room}`, `Room ${data.room}`));
      if (globalThis.location.protocol.startsWith("http")) {
        globalThis.history.replaceState(null, "", roomInviteUrl(data.room));
      }
      updateOnlineControls();
      updateLayoutMetrics();
      emitOnlineEvent("open", {
        room: data.room,
        role: onlineClient.role,
      });
      showToast(onlineText(`Онлайн: ${data.room}`, `Online: ${data.room}`));
      return;
    }

    if (data.type === "hello") {
      state.online.id = data.id;
      emitOnlineEvent("hello", { id: data.id });
      return;
    }

    if (data.type === "ping") {
      emitOnlineEvent("ping", { pingMs: data.pingMs || 0 });
      return;
    }

    if (data.type === "rankedProfile") {
      state.online.ranked = true;
      state.online.rating = Number(data.rating) || state.online.rating;
      if (data.identityToken) {
        saveRankedIdentityToken(data.identityToken);
        onlineClient.identityToken = data.identityToken;
      }
      emitOnlineEvent("rankedProfile", { profile: data });
      showToast(
        onlineText(
          `Ranked: ${state.online.rating} MMR`,
          `Ranked: ${state.online.rating} MMR`,
        ),
      );
      renderOnlinePanel();
      return;
    }

    if (data.type === "queued") {
      ui.setOnlineStatus(onlineText("Ожидание соперника...", "Waiting for opponent..."));
      showToast(onlineText("Ranked очередь", "Ranked queue"));
      return;
    }

    if (data.type === "matchFound") {
      state.online.room = data.room || state.online.room;
      ui.setOnlineRoom(state.online.room);
      ui.setOnlineStatus(onlineText(`Матч найден: ${state.online.room}`, `Match found: ${state.online.room}`));
      showToast(onlineText("Соперник найден", "Opponent found"));
      return;
    }

    if (data.type === "close") {
      state.online.connected = false;
      if (isOnlineSession()) setSession({ type: "solo", source: "disconnect" });
      ui.setOnlineStatus(onlineText("Отключено", "Disconnected"));
      renderOnlinePanel();
      updateOnlineControls();
      updateLayoutMetrics();
      emitOnlineEvent("disconnect", {
        room: state.online.room,
        role: onlineClient.role,
      });
      return;
    }

    if (data.type === "socketError") {
      ui.setOnlineStatus(onlineText("Ошибка подключения", "Connection error"));
      emitOnlineEvent("socketError");
      showToast(onlineText("Сервер недоступен", "Server unavailable"));
      return;
    }

    if (data.type === "error") {
      ui.setOnlineStatus(
        data.message || onlineText("Ошибка комнаты", "Room error"),
      );
      emitOnlineEvent("error", { message: data.message || "" });
      showToast(data.message || onlineText("Ошибка комнаты", "Room error"));
      return;
    }

    if (data.type === "state") {
      state.online.peers = data.players || {};
      state.online.tournament = data.tournament || null;
      state.online.mode = normalizeModeKey(data.match?.mode || state.online.mode);
      state.online.series = data.match?.series || null;
      state.online.ranked = Boolean(data.match?.ranked || state.online.ranked);
      state.online.rankedResult =
        data.match?.rankedResult || state.online.rankedResult;
      renderOnlinePlayers();
      renderOnlinePanel();
      emitOnlineEvent("state", {
        room: data.room || state.online.room,
        roomState: {
          room: data.room || state.online.room,
          players: Object.values(data.players || {}),
          spectators: Object.values(data.spectators || {}),
          match: data.match || {},
          tournament: data.tournament || {},
        },
      });
      return;
    }

    if (data.type === "countdown") {
      emitOnlineEvent("countdown", { value: data.value || 0 });
      showToast(onlineText(`PvP старт: ${data.value}`, `PvP starts: ${data.value}`));
      return;
    }

    if (data.type === "matchStart" || data.type === "rematchStart") {
      ui.hideOverlay("onlineOverlay");
      const matchMode = normalizeModeKey(data.mode || state.online.mode);
      state.online.mode = matchMode;
      startGame(matchMode, state.difficulty, {
        seed: data.seed,
        session: {
          type: "online",
          source: data.type,
          room: state.online.room,
          ranked: state.online.ranked,
          matchId: data.startedAt || data.seed,
        },
      });
      syncUi();
      emitOnlineEvent("matchStart", {
        seed: data.seed,
        mode: matchMode,
        startedAt: data.startedAt || 0,
      });
      showToast(
        data.type === "rematchStart"
          ? onlineText("Раунд серии начался", "Series round started")
          : onlineText("Ranked PvP начался", "Ranked PvP started"),
      );
      return;
    }

    if (data.type === "matchFinished") {
      state.online.rankedResult = data.ranked || null;
      state.online.series = data.series || state.online.series;
      if (isOnlineSession() && state.running && !state.gameOver) {
        const selfWon = data.winnerId === state.online.id;
        const resultText = selfWon
          ? onlineText("Победа в онлайн-матче", "Online match won")
          : onlineText("Поражение в онлайн-матче", "Online match lost");
        finish(selfWon, resultText, { reportOnline: false });
      }
      emitOnlineEvent("matchFinished", data);
      showRankedResultToast(data);
      renderOnlinePanel();
      return;
    }

    if (data.type === "attack") {
      if (isOnlineSession()) {
        receiveGarbage(Number(data.lines) || 0, data.from || "соперника");
      }
      emitOnlineEvent("attack", {
        lines: Number(data.lines) || 0,
        from: data.from || "",
      });
      return;
    }

    if (data.type === "tournamentEnd") {
      state.online.tournament = data.tournament || state.online.tournament;
      emitOnlineEvent("tournamentEnd", {
        tournament: data.tournament || null,
        players: data.players || state.online.peers || {},
      });
      showTournamentResults(data.players || state.online.peers || {});
    }
  });

  return {
    openOnline,
    shareRoomLink,
    copyRoomLink,
    createFriendRoom,
    connectOnline,
    findRankedMatch,
    disconnectOnline,
    toggleOnlineConnection,
    startOnlineGame,
    startTournament,
    requestRematch,
    renderOnlinePlayers,
    renderOnlinePanel,
    sendOnlineUpdate,
    sendOnlineUpdateThrottled,
  };
}
