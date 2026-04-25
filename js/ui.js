export function byId(id, root = document) {
  return root.getElementById(id);
}

export function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

const UI_IDS = [
  "app", "topbar", "statusStrip", "gameLayout", "sidePanel", "controls", "nextPanel", "holdPanel", "statsPanel",
  "board", "boardShell", "next1", "next2", "next3", "hold", "scoreValue", "levelValue", "linesValue", "recordValue",
  "comboValue", "piecesValue", "timeValue", "goalValue", "progressFill", "rankValue", "apmValue", "heightValue",
  "onlinePanel", "startOverlay", "pauseOverlay", "settingsOverlay", "statsOverlay", "gameOverOverlay", "startButton",
  "continueButton", "startSettingsButton", "installButton", "openStatsButton", "resumeButton", "playAgainButton",
  "pauseButton", "mainMenuButton", "pauseMenuButton", "gameOverMenuButton", "pauseRestartButton", "pauseSettingsButton",
  "holdButton", "leftButton", "rightButton", "rotateButton", "downButton", "dropButton", "startMode", "themeSelect",
  "controlModeSelect", "vibrationToggle", "sensitivitySelect", "handednessSelect",
  "volumeRange", "volumeValue", "closeSettingsButton", "closeStatsButton",
  "shareStatsButton", "gameOverStatsButton", "statsGrid", "leaderboard", "serverLeaderboard", "achievementsList",
  "helpButton", "onlineButton", "helpOverlay", "coachOverlay", "coachTips", "closeCoachButton", "onlineOverlay",
  "onlineServerInput", "onlineRoomInput", "onlineNameInput", "onlineMaxPlayersSelect", "onlineDurationSelect",
  "onlinePlayers", "onlineStatus", "connectOnlineButton", "shareRoomButton", "startTournamentButton", "closeOnlineButton",
  "tournamentOverlay", "tournamentResults", "closeTournamentButton", "rematchButton", "closeHelpButton", "shareResultButton",
  "finalScore", "finalLevel", "finalLines", "finalCombo", "finalRecord", "gameOverTitle", "gameOverText",
  "gameOverInsight", "gameOverCoachButton", "serverRecordStatus", "toast", "fxLayer"
];

export function createUi(options = {}) {
  const root = options.root || document;
  const documentRef = options.documentRef || document;
  const windowRef = options.windowRef || window;
  const performanceRef = options.performanceRef || performance;
  const refs = Object.fromEntries(UI_IDS.map((id) => [id, byId(id, root)]));
  const ctx = refs.board.getContext("2d");
  const previews = [refs.next1.getContext("2d"), refs.next2.getContext("2d"), refs.next3.getContext("2d")];
  const holdCtx = refs.hold.getContext("2d");
  let toastTimer = 0;

  function applySettings(settings) {
    documentRef.documentElement.dataset.theme = settings.theme === "ember" ? "" : settings.theme;
    documentRef.body.classList.toggle("big-buttons", settings.bigButtons);
    documentRef.body.classList.toggle("reduced-motion", settings.reducedMotion);
    documentRef.body.classList.toggle("controls-hybrid", settings.controlMode === "hybrid");
    documentRef.body.classList.toggle("controls-buttons", settings.controlMode === "buttons");
    documentRef.body.classList.toggle("handed-left", settings.handedness === "left");

    refs.themeSelect.value = settings.theme;
    refs.controlModeSelect.value = settings.controlMode;
    refs.vibrationToggle.checked = settings.vibration;
    refs.sensitivitySelect.value = settings.sensitivityPreset;
    refs.handednessSelect.value = settings.handedness;
    refs.volumeRange.value = settings.volume;
    refs.volumeValue.textContent = settings.volume;
  }

  function updateLayoutMetrics({ cols, rows, onlineConnected }) {
    const appRect = refs.app.getBoundingClientRect();
    if (!appRect.width || !appRect.height) return null;

    const gap = appRect.width <= 420 ? 6 : appRect.width >= 760 ? 12 : 8;
    const topbarHeight = refs.topbar.offsetHeight;
    const statusHeight = refs.statusStrip.offsetHeight;
    const controlsHeight = refs.controls.offsetHeight;
    const availableHeight = Math.max(240, appRect.height - topbarHeight - statusHeight - controlsHeight - gap * 3);
    const isLandscape = appRect.width / Math.max(1, appRect.height) > 1.15;
    const stacked = appRect.width < 500 || (isLandscape && appRect.height < 620);
    const wide = appRect.width >= 760;
    const short = appRect.height < 700;

    documentRef.body.classList.toggle("layout-stacked", stacked);
    documentRef.body.classList.toggle("layout-wide", wide);
    documentRef.body.classList.toggle("layout-short", short);

    const sideWidth = stacked
      ? Math.max(84, Math.min(appRect.width <= 420 ? 104 : 116, Math.round(appRect.width * 0.27)))
      : Math.max(74, Math.min(wide ? 156 : 108, Math.round(appRect.width * (wide ? 0.20 : 0.23))));
    const boardAvailWidth = appRect.width - sideWidth - gap - 14;
    const widthCell = boardAvailWidth / cols;
    const onlineReserve = stacked && onlineConnected ? 32 : 0;
    const boardAvailHeight = availableHeight - onlineReserve - 14;
    const cellFloor = stacked && appRect.width <= 420 ? 10 : 12;
    const cell = Math.max(cellFloor, Math.floor(Math.min(widthCell, boardAvailHeight / rows)));
    const boardWidth = cell * cols;
    const boardHeight = cell * rows;
    const boardPad = cell <= 18 ? 5 : cell <= 26 ? 6 : 8;
    const previewMain = Math.max(34, Math.min(stacked ? 72 : (wide ? 104 : 86), Math.round(sideWidth - boardPad * 2 - 8)));
    const previewSmall = Math.max(34, Math.min(72, Math.round(previewMain * 0.76)));

    documentRef.documentElement.style.setProperty("--layout-gap", `${gap}px`);
    documentRef.documentElement.style.setProperty("--side-width", `${sideWidth}px`);
    documentRef.documentElement.style.setProperty("--board-width", `${boardWidth}px`);
    documentRef.documentElement.style.setProperty("--board-height", `${boardHeight}px`);
    documentRef.documentElement.style.setProperty("--board-pad", `${boardPad}px`);
    documentRef.documentElement.style.setProperty("--preview-main", `${previewMain}px`);
    documentRef.documentElement.style.setProperty("--preview-small", `${previewSmall}px`);
    documentRef.documentElement.style.setProperty("--game-area-height", `${boardHeight + boardPad * 2}px`);

    return { stacked, wide, short, cell, boardWidth, boardHeight };
  }

  function resizeCanvas(canvas, width, height) {
    const ratio = Math.max(1, Math.min(3, windowRef.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
  }

  function round(context, x, y, w, h, r, fill, stroke) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
    if (fill) context.fill();
    if (stroke) context.stroke();
  }

  function line(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }

  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const amount = Math.round(2.55 * percent);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (num & 255) + amount));
    return `rgb(${r},${g},${b})`;
  }

  function drawCell(context, x, y, size, kind, alpha, renderConfig) {
    const { settings, palettes } = renderConfig;
    const palette = settings.colorBlind ? palettes.safe : (palettes.themes[settings.theme] || palettes.base);
    const color = palette[kind] || palette.X || palettes.base.X;
    const theme = settings.theme;
    const pad = Math.max(1, size * (theme === "mono" ? 0.10 : theme === "candy" ? 0.04 : 0.06));
    const side = size - pad * 2;
    const radius = theme === "mono" ? Math.max(2, size * 0.04) : theme === "candy" ? Math.max(5, size * 0.22) : Math.max(3, size * 0.15);
    context.globalAlpha = alpha;
    if (!kind) {
      context.fillStyle = "rgba(255,255,255,0.035)";
      round(context, x + pad, y + pad, side, side, radius, true, false);
      context.globalAlpha = 1;
      return;
    }

    const gradient = context.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, shade(color, theme === "day" ? -12 : -22));
    context.fillStyle = gradient;
    round(context, x + pad, y + pad, side, side, radius, true, false);
    if (theme !== "mono") {
      context.fillStyle = theme === "candy" ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)";
      round(context, x + pad + 3, y + pad + 3, Math.max(2, side - 6), Math.max(5, side * 0.22), Math.max(2, size * 0.08), true, false);
    }
    context.strokeStyle = theme === "mono" ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.18)";
    round(context, x + pad, y + pad, side, side, radius, false, true);
    context.globalAlpha = 1;
  }

  function drawPreview(context, canvas, kind, renderConfig) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    const size = Math.min(width, height) / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const filled = kind && renderConfig.shapes[kind][0].some(([sx, sy]) => sx === x && sy === y);
        drawCell(context, x * size + 2, y * size + 2, size - 2, filled ? kind : null, filled ? 1 : 0.5, renderConfig);
      }
    }
  }

  function renderGame(renderState, renderConfig) {
    const { cols, rows, board, active, ghost, queue, hold, flashes, opponentHeight } = renderState;
    resizeCanvas(refs.board, refs.board.clientWidth, refs.board.clientHeight);
    for (const canvas of [refs.next1, refs.next2, refs.next3, refs.hold]) {
      resizeCanvas(canvas, canvas.clientWidth, canvas.clientHeight);
    }

    const width = refs.board.clientWidth;
    const height = refs.board.clientHeight;
    const cell = Math.min(width / cols, height / rows);
    const boardWidth = cell * cols;
    const x0 = (width - boardWidth) / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    round(ctx, x0, 0, boardWidth, cell * rows, 8, true, false);

    if (opponentHeight) {
      const ghostHeight = Math.min(rows, opponentHeight) * cell;
      const y = rows * cell - ghostHeight;
      ctx.fillStyle = "rgba(255, 178, 74, 0.13)";
      ctx.fillRect(x0, y, boardWidth, ghostHeight);
      ctx.strokeStyle = "rgba(255, 178, 74, 0.45)";
      ctx.lineWidth = 2;
      line(ctx, x0, y, x0 + boardWidth, y);
    }

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        drawCell(ctx, x0 + x * cell, y * cell, cell, board[y][x], 1, renderConfig);
      }
    }

    if (renderConfig.settings.ghost && ghost) {
      for (const cellData of ghost) drawCell(ctx, x0 + cellData.x * cell, cellData.y * cell, cell, active.kind, 0.22, renderConfig);
    }

    if (active) {
      for (const cellData of active.cells) drawCell(ctx, x0 + cellData.x * cell, cellData.y * cell, cell, active.kind, 1, renderConfig);
    }

    if (renderConfig.settings.grid) {
      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= cols; x += 1) line(ctx, x0 + x * cell, 0, x0 + x * cell, rows * cell);
      for (let y = 0; y <= rows; y += 1) line(ctx, x0, y * cell, x0 + boardWidth, y * cell);
    }

    for (const flash of flashes) {
      const stripWidth = boardWidth * flash.width;
      const stripX = x0 + (boardWidth - stripWidth) / 2;
      const gradient = ctx.createLinearGradient(stripX, 0, stripX + stripWidth, 0);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.62 * flash.life})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(stripX, flash.row * cell, stripWidth, cell);
      ctx.fillStyle = `rgba(86,223,186,${0.22 * flash.life})`;
      ctx.fillRect(x0, flash.row * cell + cell * 0.42, boardWidth, Math.max(2, cell * 0.16));
    }

    drawPreview(previews[0], refs.next1, queue[0], renderConfig);
    drawPreview(previews[1], refs.next2, queue[1], renderConfig);
    drawPreview(previews[2], refs.next3, queue[2], renderConfig);
    drawPreview(holdCtx, refs.hold, hold, renderConfig);
  }

  function syncHud(payload) {
    refs.scoreValue.textContent = payload.score;
    refs.levelValue.textContent = payload.level;
    refs.linesValue.textContent = payload.lines;
    refs.recordValue.textContent = payload.record;
    refs.comboValue.textContent = payload.combo;
    refs.piecesValue.textContent = payload.pieces;
    refs.timeValue.textContent = payload.time;
    refs.apmValue.textContent = payload.apm;
    refs.heightValue.textContent = payload.height;
    refs.goalValue.textContent = payload.goal;
    refs.progressFill.style.width = `${payload.progress}%`;
    refs.rankValue.textContent = payload.rank;
    refs.boardShell.classList.toggle("danger", payload.danger);
  }

  function showGameOver(payload) {
    refs.gameOverTitle.textContent = payload.title;
    refs.gameOverText.textContent = payload.text;
    refs.finalScore.textContent = payload.score;
    refs.finalLevel.textContent = payload.level;
    refs.finalLines.textContent = payload.lines;
    refs.finalCombo.textContent = payload.combo;
    refs.finalRecord.textContent = payload.record;
    refs.gameOverInsight.innerHTML = payload.insight;
    refs.serverRecordStatus.textContent = payload.serverStatus;
    refs.gameOverOverlay.hidden = false;
  }

  function setPauseVisible(visible) {
    refs.pauseOverlay.hidden = !visible;
  }

  function hideOverlays() {
    refs.startOverlay.hidden = true;
    refs.pauseOverlay.hidden = true;
    refs.settingsOverlay.hidden = true;
    refs.statsOverlay.hidden = true;
    refs.helpOverlay.hidden = true;
    refs.coachOverlay.hidden = true;
    refs.onlineOverlay.hidden = true;
    refs.tournamentOverlay.hidden = true;
    refs.gameOverOverlay.hidden = true;
  }

  function showOverlay(name) {
    refs[name].hidden = false;
  }

  function hideOverlay(name) {
    refs[name].hidden = true;
  }

  function isOverlayVisible(name) {
    return !refs[name].hidden;
  }

  function openSettings() {
    refs.settingsOverlay.hidden = false;
  }

  function getStartMode() {
    return refs.startMode.value;
  }

  function setStartMode(mode) {
    refs.startMode.value = mode;
  }

  function getVisiblePrimaryOverlay() {
    if (!refs.gameOverOverlay.hidden) return "gameOverOverlay";
    if (!refs.startOverlay.hidden) return "startOverlay";
    if (!refs.pauseOverlay.hidden) return "pauseOverlay";
    return null;
  }

  function renderOnlinePlayers(players, tournament, formatTime) {
    refs.onlinePlayers.innerHTML = players.length
      ? players.map((player) => `<div class="result-row"><span>${escapeHtml(player.name)} · ${escapeHtml(player.status)}</span><span>${player.score}</span></div>`).join("")
      : `<div class="result-row"><span>Игроков пока нет</span><span>0</span></div>`;
    if (tournament?.active) {
      refs.onlineStatus.textContent = `Турнир: ${formatTime(tournament.timeLeftMs)} · ${players.length}/${tournament.maxPlayers}`;
    }
  }

  function renderOnlinePanel({ connected, room, tournament, players, formatTime }) {
    if (!connected) {
      refs.onlinePanel.classList.remove("active");
      refs.onlinePanel.innerHTML = "";
      return;
    }
    refs.onlinePanel.classList.add("active");
    const timer = tournament?.active ? `<div class="online-timer">Турнир: ${formatTime(tournament.timeLeftMs)}</div>` : "";
    refs.onlinePanel.innerHTML = timer +
      `<div class="mission done"><span>Онлайн ${escapeHtml(room)}</span><b>${players.length}</b></div>` +
      players.map((player) => `<div class="online-player"><span>${escapeHtml(player.name)}</span><b>${player.score}</b></div>`).join("");
  }

  function renderTournamentResults(players, stateWasRunning) {
    refs.tournamentResults.innerHTML = players.length
      ? players.map((player, index) => `<div class="result-row"><span>${index + 1}. ${escapeHtml(player.name)} · ${escapeHtml(player.status)}</span><span>${player.score}</span></div>`).join("")
      : `<div class="result-row"><span>Нет результатов</span><span>0</span></div>`;
    refs.tournamentOverlay.hidden = false;
    return stateWasRunning;
  }

  function renderStats({ statsRows, scores, serverRecords, achievements }) {
    refs.statsGrid.innerHTML = statsRows.map(([label, value]) => `<div class="result-row"><span>${label}</span><span>${value}</span></div>`).join("");
    refs.leaderboard.innerHTML = scores.length
      ? scores.map((entry, index) => `<div class="score-row"><span>${index + 1}. ${escapeHtml(entry.mode)}, ${escapeHtml(entry.date)}</span><span>${entry.score}</span></div>`).join("")
      : `<div class="score-row"><span>Пока пусто</span><span>0</span></div>`;
    refs.serverLeaderboard.innerHTML = serverRecords.length
      ? serverRecords.map((entry, index) => `<div class="score-row"><span>${index + 1}. ${escapeHtml(entry.name)} · ${escapeHtml(entry.mode)} · ${escapeHtml(entry.date)}</span><span>${entry.score}</span></div>`).join("")
      : `<div class="score-row"><span>Пока нет связи с сервером</span><span>—</span></div>`;
    refs.achievementsList.innerHTML = achievements.map((item) => {
      const prefix = item.unlocked ? "✓ " : "";
      return `<div class="achievement"><b>${prefix}${escapeHtml(item.title)}</b><small>${escapeHtml(item.description)}</small></div>`;
    }).join("");
  }

  function renderCoachTips(items) {
    refs.coachTips.innerHTML = items.map(([title, body]) => `<div class="achievement"><b>${title}</b><small>${body}</small></div>`).join("");
  }

  function setServerRecordStatus(text) {
    refs.serverRecordStatus.textContent = text;
  }

  function setOnlineDefaults({ server, room, name }) {
    if (server) refs.onlineServerInput.value = server;
    if (room) refs.onlineRoomInput.value = room;
    if (name) refs.onlineNameInput.value = name;
  }

  function getOnlineForm() {
    return {
      server: refs.onlineServerInput.value.trim(),
      room: refs.onlineRoomInput.value.trim(),
      name: refs.onlineNameInput.value.trim(),
      maxPlayers: Number(refs.onlineMaxPlayersSelect.value),
      durationSec: Number(refs.onlineDurationSelect.value)
    };
  }

  function setOnlineRoom(room) {
    refs.onlineRoomInput.value = room;
  }

  function setOnlineStatus(text) {
    refs.onlineStatus.textContent = text;
  }

  function setOnlineButtonState(connected) {
    refs.connectOnlineButton.textContent = connected ? "Отключиться" : "Подключиться";
    refs.connectOnlineButton.classList.toggle("primary", !connected);
  }

  function updateInstallButton(visible) {
    refs.installButton.classList.toggle("hidden", !visible);
  }

  function showToast(text) {
    refs.toast.textContent = text;
    refs.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => refs.toast.classList.remove("show"), 1800);
  }

  function shakeBoard(reducedMotion) {
    if (reducedMotion) return;
    refs.boardShell.classList.remove("shake");
    void refs.boardShell.offsetWidth;
    refs.boardShell.classList.add("shake");
  }

  function burst({ count, reducedMotion, particles, colors }) {
    if (!particles || reducedMotion) return;
    const rect = refs.boardShell.getBoundingClientRect();
    for (let i = 0; i < count; i += 1) {
      const particle = documentRef.createElement("i");
      particle.className = "particle";
      particle.style.left = `${rect.left + rect.width / 2}px`;
      particle.style.top = `${rect.top + rect.height * 0.42}px`;
      particle.style.background = colors[i % colors.length];
      particle.style.setProperty("--dx", `${Math.cos(i * 1.7) * (60 + Math.random() * 110)}px`);
      particle.style.setProperty("--dy", `${Math.sin(i * 1.7) * (60 + Math.random() * 110)}px`);
      refs.fxLayer.appendChild(particle);
      setTimeout(() => particle.remove(), 760);
    }
  }

  function bindPress(element, handler) {
    let ignoreClickUntil = 0;
    const run = (event) => {
      event.preventDefault();
      handler();
    };
    element.addEventListener("pointerdown", (event) => {
      ignoreClickUntil = performanceRef.now() + 450;
      run(event);
    });
    element.addEventListener("click", (event) => {
      if (performanceRef.now() < ignoreClickUntil) {
        event.preventDefault();
        return;
      }
      run(event);
    });
  }

  function bindRepeat(element, handler, interval = 82) {
    let timer = 0;
    const stop = () => {
      clearInterval(timer);
      timer = 0;
    };
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handler();
      stop();
      timer = setInterval(handler, interval);
    });
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
    element.addEventListener("pointerleave", stop);
  }

  function bindControls(callbacks) {
    bindPress(refs.startButton, callbacks.startGame);
    bindPress(refs.continueButton, callbacks.loadCurrentGame);
    bindPress(refs.startSettingsButton, callbacks.openSettings);
    bindPress(refs.installButton, callbacks.installApp);
    bindPress(refs.openStatsButton, callbacks.openStats);
    bindPress(refs.helpButton, callbacks.openHelp);
    bindPress(refs.closeHelpButton, callbacks.closeHelp);
    bindPress(refs.closeCoachButton, callbacks.closeCoach);
    bindPress(refs.onlineButton, callbacks.openOnline);
    bindPress(refs.connectOnlineButton, callbacks.toggleOnlineConnection);
    bindPress(refs.shareRoomButton, callbacks.shareRoomLink);
    bindPress(refs.startTournamentButton, callbacks.startTournament);
    bindPress(refs.closeOnlineButton, callbacks.closeOnline);
    bindPress(refs.closeTournamentButton, callbacks.closeTournament);
    bindPress(refs.rematchButton, callbacks.rematch);
    bindPress(refs.resumeButton, callbacks.resume);
    bindPress(refs.playAgainButton, callbacks.playAgain);
    bindPress(refs.pauseButton, callbacks.togglePause);
    bindPress(refs.mainMenuButton, callbacks.returnToMainMenu);
    bindPress(refs.pauseMenuButton, callbacks.returnToMainMenu);
    bindPress(refs.gameOverMenuButton, callbacks.returnToMainMenu);
    bindPress(refs.pauseRestartButton, callbacks.restartGame);
    bindPress(refs.pauseSettingsButton, callbacks.openSettings);
    bindPress(refs.closeSettingsButton, callbacks.closeSettings);
    bindPress(refs.closeStatsButton, callbacks.closeStats);
    bindPress(refs.shareStatsButton, callbacks.shareStats);
    bindPress(refs.gameOverStatsButton, callbacks.openStats);
    bindPress(refs.gameOverCoachButton, callbacks.openCoach);
    bindPress(refs.shareResultButton, callbacks.shareResult);
    bindPress(refs.holdButton, callbacks.holdPiece);
    bindRepeat(refs.leftButton, callbacks.moveLeft);
    bindRepeat(refs.rightButton, callbacks.moveRight);
    bindRepeat(refs.downButton, callbacks.softDrop, 58);
    bindPress(refs.rotateButton, callbacks.rotate);
    bindPress(refs.dropButton, callbacks.hardDrop);

    refs.themeSelect.addEventListener("change", () => callbacks.changeSetting("theme", refs.themeSelect.value));
    refs.controlModeSelect.addEventListener("change", () => callbacks.changeSetting("controlMode", refs.controlModeSelect.value));
    refs.sensitivitySelect.addEventListener("change", () => callbacks.changeSetting("sensitivityPreset", refs.sensitivitySelect.value));
    refs.handednessSelect.addEventListener("change", () => callbacks.changeSetting("handedness", refs.handednessSelect.value));
    refs.vibrationToggle.addEventListener("change", () => callbacks.changeSetting("vibration", refs.vibrationToggle.checked));
    refs.volumeRange.addEventListener("input", () => callbacks.changeSetting("volume", Number(refs.volumeRange.value)));
  }

  function bindWindowEvents(callbacks) {
    documentRef.addEventListener("visibilitychange", callbacks.visibilityChange);
    windowRef.addEventListener("offline", callbacks.offline);
    windowRef.addEventListener("online", callbacks.online);
    windowRef.addEventListener("beforeunload", callbacks.beforeUnload);
    windowRef.addEventListener("resize", callbacks.resize);
    windowRef.addEventListener("keydown", callbacks.keydown);
    windowRef.addEventListener("keyup", callbacks.keyup);
    windowRef.addEventListener("blur", callbacks.blur);

    if ("ResizeObserver" in windowRef) {
      const observer = new ResizeObserver(callbacks.resizeObserver);
      observer.observe(refs.app);
      observer.observe(refs.controls);
      observer.observe(refs.statusStrip);
      observer.observe(refs.topbar);
      return observer;
    }
    return null;
  }

  function bindBoardTouch(callbacks) {
    refs.board.addEventListener("touchstart", callbacks.touchstart, { passive: false });
    refs.board.addEventListener("touchmove", callbacks.touchmove, { passive: false });
    refs.board.addEventListener("touchend", callbacks.touchend, { passive: false });
    refs.board.addEventListener("touchcancel", callbacks.touchcancel, { passive: false });
  }

  return {
    ...refs,
    refs,
    applySettings,
    updateLayoutMetrics,
    renderGame,
    syncHud,
    showGameOver,
    setPauseVisible,
    hideOverlays,
    showOverlay,
    hideOverlay,
    isOverlayVisible,
    openSettings,
    getStartMode,
    setStartMode,
    getVisiblePrimaryOverlay,
    renderOnlinePlayers,
    renderOnlinePanel,
    renderTournamentResults,
    renderStats,
    renderCoachTips,
    setServerRecordStatus,
    setOnlineDefaults,
    getOnlineForm,
    setOnlineRoom,
    setOnlineStatus,
    setOnlineButtonState,
    updateInstallButton,
    showToast,
    shakeBoard,
    burst,
    bindControls,
    bindWindowEvents,
    bindBoardTouch
  };
}
