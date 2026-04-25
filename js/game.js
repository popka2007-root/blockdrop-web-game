import "./audio.js";
import "./config.js";
import "./input.js";
import "./online.js";
import "./storage.js";
import "./ui.js";

(() => {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const LOCK_DELAY_MS = 480;
  const MAX_LOCK_RESETS = 12;
  const STORAGE = {
    high: "blockdrop-high-score",
    stats: "blockdrop-stats-v2",
    settings: "blockdrop-settings-v2",
    save: "blockdrop-save-v2",
    scores: "blockdrop-scoreboard-v2",
    achievements: "blockdrop-achievements-v2"
  };

  const COLORS = {
    I: "#21d3f5",
    O: "#ffd166",
    T: "#9b6cff",
    S: "#22d699",
    Z: "#ff6b6b",
    J: "#4f78ff",
    L: "#ff9a3d",
    X: "#dfe6ee"
  };

  const THEME_COLORS = {
    ember: COLORS,
    day: {
      I: "#0796a8",
      O: "#e0a21a",
      T: "#6d5bd0",
      S: "#158a6f",
      Z: "#d84b42",
      J: "#2f6fbc",
      L: "#d66b22",
      X: "#4f5f67"
    },
    candy: {
      I: "#5ce1ff",
      O: "#ffdf6e",
      T: "#c084fc",
      S: "#66f2b9",
      Z: "#ff7aa8",
      J: "#7ca7ff",
      L: "#ffb45f",
      X: "#fff4cc"
    },
    mono: {
      I: "#d9d0bd",
      O: "#b8d8c8",
      T: "#a9b0aa",
      S: "#8dd3c7",
      Z: "#c6a99c",
      J: "#9fb8b1",
      L: "#d6c28f",
      X: "#eeeeee"
    }
  };

  const SAFE_COLORS = {
    I: "#00b4d8",
    O: "#f9c74f",
    T: "#577590",
    S: "#43aa8b",
    Z: "#f94144",
    J: "#277da1",
    L: "#f8961e",
    X: "#dfe6ee"
  };

  const SHAPES = {
    I: [[[0,1],[1,1],[2,1],[3,1]], [[2,0],[2,1],[2,2],[2,3]], [[0,2],[1,2],[2,2],[3,2]], [[1,0],[1,1],[1,2],[1,3]]],
    O: [[[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]], [[1,0],[2,0],[1,1],[2,1]]],
    T: [[[1,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[2,1],[1,2]], [[1,0],[0,1],[1,1],[1,2]]],
    S: [[[1,0],[2,0],[0,1],[1,1]], [[1,0],[1,1],[2,1],[2,2]], [[1,1],[2,1],[0,2],[1,2]], [[0,0],[0,1],[1,1],[1,2]]],
    Z: [[[0,0],[1,0],[1,1],[2,1]], [[2,0],[1,1],[2,1],[1,2]], [[0,1],[1,1],[1,2],[2,2]], [[1,0],[0,1],[1,1],[0,2]]],
    J: [[[0,0],[0,1],[1,1],[2,1]], [[1,0],[2,0],[1,1],[1,2]], [[0,1],[1,1],[2,1],[2,2]], [[1,0],[1,1],[0,2],[1,2]]],
    L: [[[2,0],[0,1],[1,1],[2,1]], [[1,0],[1,1],[1,2],[2,2]], [[0,1],[1,1],[2,1],[0,2]], [[0,0],[1,0],[1,1],[1,2]]]
  };

  const SRS_KICKS = {
    normal: {
      "0>1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
      "1>0": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
      "1>2": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
      "2>1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
      "2>3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
      "3>2": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
      "3>0": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
      "0>3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]]
    },
    I: {
      "0>1": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
      "1>0": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
      "1>2": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
      "2>1": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
      "2>3": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
      "3>2": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
      "3>0": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
      "0>3": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
    }
  };

  const MODES = {
    classic: { name: "Классика", goal: 0, relaxed: false, chaos: false },
    sprint: { name: "40 линий", goal: 40, relaxed: false, chaos: false },
    relax: { name: "Дзен", goal: 0, relaxed: true, chaos: false },
    chaos: { name: "Хаос", goal: 0, relaxed: false, chaos: true }
  };

  const DIFFICULTY = {
    easy: { name: "Лёгкая", startLevel: 1, speedBonus: -80, garbage: 0 },
    normal: { name: "Нормальная", startLevel: 1, speedBonus: 0, garbage: 0 },
    hard: { name: "Сложная", startLevel: 4, speedBonus: 40, garbage: 2 },
    expert: { name: "Эксперт", startLevel: 7, speedBonus: 80, garbage: 4 }
  };

  const ACHIEVEMENTS = [
    ["firstLine", "Первый шаг", "Очистить первую линию", (s) => s.totalLines >= 1],
    ["tenLines", "Разогрев", "Очистить 10 линий за всё время", (s) => s.totalLines >= 10],
    ["hundredLines", "Мастер поля", "Очистить 100 линий за всё время", (s) => s.totalLines >= 100],
    ["score1000", "Тысяча", "Набрать 1000 очков", (s) => s.bestScore >= 1000],
    ["score5000", "Пять тысяч", "Набрать 5000 очков", (s) => s.bestScore >= 5000],
    ["combo3", "Комбо x3", "Сделать комбо 3", (s) => s.bestCombo >= 3],
    ["tetris", "Четыре сразу", "Очистить 4 линии одним ходом", (s) => s.bestClear >= 4],
    ["sprinter", "Спринтер", "Закончить режим 40 линий", (s) => s.sprintWins >= 1],
    ["survivor", "Выживший", "Дойти до 10 уровня", (s) => s.bestLevel >= 10],
    ["collector", "Коллекционер", "Поставить 300 фигур", (s) => s.totalPieces >= 300],
    ["hardDropper", "Без тормозов", "Сделать 100 резких сбросов", (s) => s.totalHardDrops >= 100],
    ["keeper", "Запасливый", "Использовать запас 50 раз", (s) => s.totalHolds >= 50],
    ["spinner", "Вертушка", "Повернуть фигуры 250 раз", (s) => s.totalRotations >= 250],
    ["patient", "Долгая партия", "Сыграть 10 минут суммарно", (s) => s.totalTime >= 600],
    ["chaosFan", "Друг хаоса", "Сыграть 5 партий в режиме Хаос", (s) => s.chaosGames >= 5],
    ["relaxFan", "Спокойный ход", "Сыграть 5 партий в режиме Дзен", (s) => s.relaxGames >= 5]
  ];

  const ui = {};
  for (const id of [
    "app","topbar","statusStrip","gameLayout","sidePanel","controls","nextPanel","holdPanel","statsPanel","board","boardShell","next1","next2","next3","hold","scoreValue","levelValue","linesValue","recordValue","comboValue","piecesValue","timeValue",
    "goalValue","progressFill","rankValue","apmValue","heightValue","onlinePanel",
    "startOverlay","pauseOverlay","settingsOverlay","statsOverlay","gameOverOverlay","startButton","continueButton","startSettingsButton","installButton","openStatsButton","resumeButton",
    "playAgainButton","pauseButton","mainMenuButton","pauseMenuButton","gameOverMenuButton","pauseRestartButton","pauseSettingsButton",
    "holdButton","leftButton","rightButton","rotateButton","downButton","dropButton","startMode","themeSelect","controlModeSelect","ghostToggle",
    "bigButtonsToggle","vibrationToggle",
    "sensitivityRange","sensitivityValue","dasRange","dasValue","arrRange","arrValue","volumeRange","volumeValue","moveVolumeRange","moveVolumeValue","clearVolumeRange","clearVolumeValue","alertVolumeRange","alertVolumeValue","closeSettingsButton","closeStatsButton","shareStatsButton","gameOverStatsButton","statsGrid",
    "leaderboard","serverLeaderboard","achievementsList","helpButton","onlineButton","helpOverlay","coachOverlay","coachTips","closeCoachButton","onlineOverlay","onlineServerInput","onlineRoomInput","onlineNameInput",
    "onlineMaxPlayersSelect","onlineDurationSelect","onlinePlayers","onlineStatus","connectOnlineButton","shareRoomButton","startTournamentButton","closeOnlineButton",
    "tournamentOverlay","tournamentResults","closeTournamentButton","rematchButton","closeHelpButton","shareResultButton","finalScore","finalLevel","finalLines","finalCombo",
    "finalRecord","gameOverTitle","gameOverText","gameOverInsight","gameOverCoachButton","serverRecordStatus","toast","fxLayer"
  ]) {
    ui[id] = document.getElementById(id);
  }

  const ctx = ui.board.getContext("2d");
  const previews = [ui.next1.getContext("2d"), ui.next2.getContext("2d"), ui.next3.getContext("2d")];
  const holdCtx = ui.hold.getContext("2d");
  let deferredInstallPrompt = null;

  const state = {
    board: makeBoard(),
    active: null,
    queue: [],
    bag: [],
    hold: null,
    holdUsed: false,
    rng: Math.random,
    mode: "classic",
    difficulty: "normal",
    score: 0,
    lines: 0,
    level: 1,
    combo: 0,
    bestComboRun: 0,
    pieces: 0,
    hardDrops: 0,
    incomingGarbage: 0,
    receivedGarbage: 0,
    sentGarbage: 0,
    holds: 0,
    rotations: 0,
    moves: 0,
    softDrops: 0,
    bestClearInGame: 0,
    sessionHistory: [],
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    lastTime: 0,
    elapsedMs: 0,
    dropMs: 0,
    lockDelayMs: 0,
    lockResets: 0,
    flashes: [],
    audio: null,
    layoutObserver: null,
    settings: loadSettings(),
    stats: loadStats(),
    scores: loadJson(STORAGE.scores, []),
    serverRecords: [],
    unlocked: loadJson(STORAGE.achievements, {}),
    online: {
      socket: null,
      id: "",
      connected: false,
      room: "",
      name: "",
      peers: {},
      tournament: null,
      lastSent: 0
    }
  };

  function makeBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadSettings() {
    return {
      theme: "ember",
      sensitivity: 24,
      controlMode: "gestures",
      ghost: true,
      bigButtons: false,
      vibration: true,
      sound: true,
      grid: true,
      danger: true,
      particles: true,
      colorBlind: false,
      autoPause: true,
      reducedMotion: false,
      volume: 70,
      moveVolume: 55,
      clearVolume: 100,
      alertVolume: 90,
      dasMs: 140,
      arrMs: 36,
      ...loadJson(STORAGE.settings, {})
    };
  }

  function loadStats() {
    return {
      games: 0,
      totalScore: 0,
      totalLines: 0,
      totalPieces: 0,
      totalTime: 0,
      bestScore: Number(localStorage.getItem(STORAGE.high)) || 0,
      bestLevel: 1,
      bestCombo: 0,
      bestClear: 0,
      sprintWins: 0,
      modeWins: 0,
      chaosGames: 0,
      relaxGames: 0,
      totalHardDrops: 0,
      totalHolds: 0,
      totalRotations: 0,
      totalMoves: 0,
      totalSoftDrops: 0,
      pieceCounts: { I: 0, O: 0, T: 0, S: 0, Z: 0, J: 0, L: 0 },
      ...loadJson(STORAGE.stats, {})
    };
  }

  function applySettings() {
    document.documentElement.dataset.theme = state.settings.theme === "ember" ? "" : state.settings.theme;
    document.body.classList.toggle("big-buttons", state.settings.bigButtons);
    state.settings.sensitivity = Math.max(12, Math.min(42, Number(state.settings.sensitivity) || 24));
    state.settings.grid = true;
    state.settings.danger = true;
    state.settings.particles = true;
    state.settings.colorBlind = false;
    state.settings.autoPause = true;
    state.settings.reducedMotion = false;
    state.settings.volume = clamp(Number(state.settings.volume) || 0, 0, 100);
    state.settings.moveVolume = clamp(Number(state.settings.moveVolume) || 0, 0, 140);
    state.settings.clearVolume = clamp(Number(state.settings.clearVolume) || 0, 0, 140);
    state.settings.alertVolume = clamp(Number(state.settings.alertVolume) || 0, 0, 140);
    state.settings.dasMs = clamp(Number(state.settings.dasMs) || 140, 60, 260);
    state.settings.arrMs = clamp(Number(state.settings.arrMs) || 36, 0, 100);
    state.settings.sound = state.settings.volume > 0;
    ui.themeSelect.value = state.settings.theme;
    ui.controlModeSelect.value = state.settings.controlMode;
    ui.ghostToggle.checked = state.settings.ghost;
    ui.bigButtonsToggle.checked = state.settings.bigButtons;
    ui.vibrationToggle.checked = state.settings.vibration;
    ui.sensitivityRange.value = state.settings.sensitivity;
    ui.sensitivityValue.textContent = state.settings.sensitivity;
    ui.dasRange.value = state.settings.dasMs;
    ui.dasValue.textContent = state.settings.dasMs;
    ui.arrRange.value = state.settings.arrMs;
    ui.arrValue.textContent = state.settings.arrMs;
    ui.volumeRange.value = state.settings.volume;
    ui.volumeValue.textContent = state.settings.volume;
    ui.moveVolumeRange.value = state.settings.moveVolume;
    ui.moveVolumeValue.textContent = state.settings.moveVolume;
    ui.clearVolumeRange.value = state.settings.clearVolume;
    ui.clearVolumeValue.textContent = state.settings.clearVolume;
    ui.alertVolumeRange.value = state.settings.alertVolume;
    ui.alertVolumeValue.textContent = state.settings.alertVolume;
    document.body.classList.toggle("reduced-motion", state.settings.reducedMotion);
    document.body.classList.toggle("controls-hybrid", state.settings.controlMode === "hybrid");
    document.body.classList.toggle("controls-buttons", state.settings.controlMode === "buttons");
    saveJson(STORAGE.settings, state.settings);
    updateLayoutMetrics();
  }

  function updateLayoutMetrics() {
    const appRect = ui.app.getBoundingClientRect();
    if (!appRect.width || !appRect.height) return;

    const gap = appRect.width <= 420 ? 6 : appRect.width >= 760 ? 12 : 8;
    const topbarHeight = ui.topbar.offsetHeight;
    const statusHeight = ui.statusStrip.offsetHeight;
    const controlsHeight = ui.controls.offsetHeight;
    const availableHeight = Math.max(240, appRect.height - topbarHeight - statusHeight - controlsHeight - gap * 3);
    const isLandscape = appRect.width / Math.max(1, appRect.height) > 1.15;
    const stacked = appRect.width < 500 || (isLandscape && appRect.height < 620);
    const wide = appRect.width >= 760;
    const short = appRect.height < 700;

    document.body.classList.toggle("layout-stacked", stacked);
    document.body.classList.toggle("layout-wide", wide);
    document.body.classList.toggle("layout-short", short);

    const sideWidth = stacked ? Math.max(0, appRect.width - gap * 2) : clamp(Math.round(appRect.width * (wide ? 0.20 : 0.23)), 74, wide ? 156 : 108);
    const stackedSideHeight = stacked ? (state.online.connected ? 126 : 94) : 0;
    const boardAvailWidth = stacked ? appRect.width - gap * 2 - 14 : appRect.width - sideWidth - gap - 14;
    const boardAvailHeight = stacked ? availableHeight - stackedSideHeight - gap - 14 : availableHeight - 14;
    const cell = Math.max(12, Math.floor(Math.min(boardAvailWidth / COLS, boardAvailHeight / ROWS)));
    const boardWidth = cell * COLS;
    const boardHeight = cell * ROWS;
    const boardPad = cell <= 18 ? 5 : cell <= 26 ? 6 : 8;
    const previewMain = clamp(Math.round((stacked ? boardWidth / 3 : sideWidth) - boardPad * 2), 44, wide ? 104 : 86);
    const previewSmall = clamp(Math.round(previewMain * 0.76), 34, 72);

    document.documentElement.style.setProperty("--layout-gap", `${gap}px`);
    document.documentElement.style.setProperty("--side-width", `${sideWidth}px`);
    document.documentElement.style.setProperty("--board-width", `${boardWidth}px`);
    document.documentElement.style.setProperty("--board-height", `${boardHeight}px`);
    document.documentElement.style.setProperty("--board-pad", `${boardPad}px`);
    document.documentElement.style.setProperty("--preview-main", `${previewMain}px`);
    document.documentElement.style.setProperty("--preview-small", `${previewSmall}px`);
    document.documentElement.style.setProperty("--game-area-height", stacked ? "auto" : `${boardHeight + boardPad * 2}px`);
  }

  function refillBag() {
    const kinds = Object.keys(SHAPES);
    for (let i = kinds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    state.bag.push(...kinds);
  }

  function random() {
    return state.rng ? state.rng() : Math.random();
  }

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  }

  function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  function takeKind() {
    if (state.bag.length === 0) refillBag();
    return state.bag.shift();
  }

  function fillQueue() {
    while (state.queue.length < 3) state.queue.push(takeKind());
  }

  function makePiece(kind) {
    return { kind, rotation: 0, x: 3, y: 0 };
  }

  function cells(piece) {
    return SHAPES[piece.kind][piece.rotation].map(([x, y]) => ({ x: piece.x + x, y: piece.y + y }));
  }

  function valid(piece) {
    for (const c of cells(piece)) {
      if (c.x < 0 || c.x >= COLS || c.y < 0 || c.y >= ROWS) return false;
      if (state.board[c.y][c.x]) return false;
    }
    return true;
  }

  function startGame(mode = ui.startMode.value, difficulty = "normal") {
    difficulty = "normal";
    state.board = makeBoard();
    state.active = null;
    state.queue = [];
    state.bag = [];
    state.hold = null;
    state.holdUsed = false;
    state.rng = Math.random;
    state.mode = mode;
    state.difficulty = difficulty;
    state.score = 0;
    state.lines = 0;
    state.level = DIFFICULTY[difficulty].startLevel;
    state.combo = 0;
    state.bestComboRun = 0;
    state.pieces = 0;
    state.hardDrops = 0;
    state.incomingGarbage = 0;
    state.receivedGarbage = 0;
    state.sentGarbage = 0;
    state.holds = 0;
    state.rotations = 0;
    state.moves = 0;
    state.softDrops = 0;
    state.bestClearInGame = 0;
    state.sessionHistory = [];
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.lastTime = 0;
    state.elapsedMs = 0;
    state.dropMs = 0;
    state.lockDelayMs = 0;
    state.lockResets = 0;
    state.flashes = [];
    hideOverlays();
    fillQueue();
    addGarbage(DIFFICULTY[difficulty].garbage);
    if (MODES[mode].chaos) addGarbage(4);
    spawn();
    ensureAudio();
    buzz(8);
    syncUi();
    saveCurrentGame();
  }

  function spawn() {
    fillQueue();
    state.active = makePiece(state.queue.shift());
    fillQueue();
    state.holdUsed = false;
    state.lockDelayMs = 0;
    state.lockResets = 0;
    if (!valid(state.active)) finish(false, "Башня дошла до верхней границы.");
  }

  function addGarbage(count) {
    for (let i = 0; i < count; i += 1) {
      const hole = Math.floor(random() * COLS);
      state.board.shift();
      state.board.push(Array.from({ length: COLS }, (_, x) => (x === hole ? null : "X")));
    }
    if (state.active && !valid(state.active)) finish(false, "Соперники вытолкнули башню мусорными линиями.");
  }

  function receiveGarbage(count, from = "соперника") {
    if (!state.running || state.gameOver || count <= 0) return;
    state.incomingGarbage += count;
    state.receivedGarbage += count;
    addGarbage(count);
    shakeBoard();
    playSound(150, 0.12, "sawtooth", "alert");
    showToast(`Атака от ${from}: +${count}`);
    sendOnlineUpdate(true);
  }

  function isGrounded(piece = state.active) {
    return Boolean(piece) && !valid({ ...piece, y: piece.y + 1 });
  }

  function resetLockDelayIfGrounded() {
    if (!isGrounded() || state.lockResets >= MAX_LOCK_RESETS) return;
    state.lockDelayMs = 0;
    state.lockResets += 1;
  }

  function updateLockDelay(delta) {
    if (!state.active) return;
    if (!isGrounded()) {
      state.lockDelayMs = 0;
      state.lockResets = 0;
      return;
    }
    state.lockDelayMs += delta;
    if (state.lockDelayMs >= LOCK_DELAY_MS) lock();
  }

  function move(dx, dy, scoreSoft = false) {
    if (!canInput()) return false;
    const candidate = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
    if (!valid(candidate)) return false;
    state.active = candidate;
    if (dx !== 0) resetLockDelayIfGrounded();
    if (scoreSoft && dy > 0) addScore(1);
    if (dx !== 0) {
      state.moves += 1;
      state.stats.totalMoves += 1;
    }
    if (scoreSoft && dy > 0) {
      state.softDrops += 1;
      state.stats.totalSoftDrops += 1;
    }
    if (dx !== 0) playSound(420, 0.025, "square", "move");
    return true;
  }

  function rotate() {
    if (!canInput()) return;
    const from = state.active.rotation;
    const to = (from + 1) % 4;
    const rotated = { ...state.active, rotation: to };
    const kicks = state.active.kind === "O"
      ? [[0, 0]]
      : (state.active.kind === "I" ? SRS_KICKS.I : SRS_KICKS.normal)[`${from}>${to}`] || [[0, 0]];
    for (const [dx, dy] of kicks) {
      const candidate = { ...rotated, x: rotated.x + dx, y: rotated.y + dy };
      if (valid(candidate)) {
        state.active = candidate;
        resetLockDelayIfGrounded();
        state.rotations += 1;
        state.stats.totalRotations += 1;
        playSound(560, 0.04, "sawtooth", "rotate");
        buzz(4);
        return;
      }
    }
  }

  function softDrop() {
    if (!move(0, 1, true)) updateLockDelay(80);
  }

  function hardDrop() {
    if (!canInput()) return;
    let distance = 0;
    while (move(0, 1, false)) distance += 1;
    state.hardDrops += 1;
    state.stats.totalHardDrops += 1;
    addScore(distance * 2);
    lock();
    playSound(190, 0.055, "square", "drop");
    buzz(12);
    shakeBoard();
  }

  function holdPiece() {
    if (!canInput() || state.holdUsed) return;
    const current = state.active.kind;
    state.holds += 1;
    state.stats.totalHolds += 1;
    if (state.hold) {
      state.active = makePiece(state.hold);
      state.hold = current;
    } else {
      state.hold = current;
      spawn();
    }
    state.holdUsed = true;
    playSound(330, 0.05, "triangle", "ui");
  }

  function lock() {
    if (!state.active) return;
    const lockedKind = state.active.kind;
    const beforeMetrics = {
      holes: countHoles(),
      height: currentHeight(),
      bumpiness: surfaceBumpiness()
    };
    for (const c of cells(state.active)) state.board[c.y][c.x] = state.active.kind;
    state.stats.pieceCounts[state.active.kind] += 1;
    state.pieces += 1;
    state.stats.totalPieces += 1;
    state.active = null;
    const count = clearLines();
    const afterMetrics = {
      holes: countHoles(),
      height: currentHeight(),
      bumpiness: surfaceBumpiness()
    };
    state.sessionHistory.push({
      kind: lockedKind,
      clear: count,
      holesDelta: afterMetrics.holes - beforeMetrics.holes,
      heightDelta: afterMetrics.height - beforeMetrics.height,
      bumpinessDelta: afterMetrics.bumpiness - beforeMetrics.bumpiness
    });
    if (state.sessionHistory.length > 60) state.sessionHistory.shift();
    if (count > 0) {
      const previousLevel = state.level;
      state.combo += 1;
      state.bestComboRun = Math.max(state.bestComboRun, state.combo);
      state.bestClearInGame = Math.max(state.bestClearInGame, count);
      state.lines += count;
      addScore(lineScore(count) + state.combo * 25);
      state.level = MODES[state.mode].relaxed ? 1 : Math.min(20, Math.floor(state.lines / 10) + DIFFICULTY[state.difficulty].startLevel);
      playSound(count === 4 ? 880 : 720, count === 4 ? 0.14 : 0.08, "triangle", "clear");
      if (count === 4) burst(44);
      if (state.combo >= 2) playSound(960 + state.combo * 18, 0.09, "triangle", "clear");
      if (state.level > previousLevel) {
        showToast(`Уровень ${state.level}`);
        playSound(1040, 0.12, "triangle", "clear");
        burst(26);
      }
      const comboText = state.combo >= 2 ? `. Комбо x${state.combo}` : "";
      if (count === 4) showToast("Четыре линии сразу!");
      else if (count >= 2) showToast(`${count} линии${comboText}`);
      sendAttackForClear(count);
      burst(count === 4 ? 34 : 18);
      shakeBoard();
    } else {
      state.combo = 0;
    }

    if (MODES[state.mode].goal && state.lines >= MODES[state.mode].goal) {
      finish(true, "Цель выполнена. 40 линий очищены.");
      return;
    }

    if (MODES[state.mode].chaos && state.pieces > 0 && state.pieces % 14 === 0) {
      addGarbage(1);
      showToast("Хаос добавил линию снизу");
    }

    spawn();
    syncUi();
    checkAchievements();
    saveCurrentGame();
  }

  function clearLines() {
    const rows = [];
    for (let y = 0; y < ROWS; y += 1) {
      if (state.board[y].every(Boolean)) rows.push(y);
    }
    if (!rows.length) return 0;
    state.flashes = rows.map((row) => ({ row, life: 1, width: 0 }));
    state.board = state.board.filter((_, y) => !rows.includes(y));
    while (state.board.length < ROWS) state.board.unshift(Array(COLS).fill(null));
    return rows.length;
  }

  function lineScore(count) {
    return [0, 100, 300, 500, 800][Math.min(count, 4)] * state.level;
  }

  function attackLinesForClear(count) {
    if (count < 2) return 0;
    if (count === 2) return 1;
    if (count === 3) return 2;
    return 4;
  }

  function sendAttackForClear(count) {
    const lines = attackLinesForClear(count);
    if (!lines || !state.online.connected || !state.online.socket || state.online.socket.readyState !== WebSocket.OPEN) return;
    state.sentGarbage += lines;
    state.online.socket.send(JSON.stringify({
      type: "attack",
      room: state.online.room,
      lines
    }));
    playSound(150, 0.09, "sawtooth", "alert");
    burst(12);
    showToast(`Атака соперникам: +${lines}`);
  }

  function addScore(value) {
    state.score += value;
    state.stats.bestScore = Math.max(state.stats.bestScore, state.score);
    localStorage.setItem(STORAGE.high, String(state.stats.bestScore));
  }

  function finish(won, text) {
    state.running = false;
    state.gameOver = true;
    state.won = won;
    state.stats.games += 1;
    state.stats.totalScore += state.score;
    state.stats.totalLines += state.lines;
    state.stats.totalTime += Math.floor(state.elapsedMs / 1000);
    state.stats.bestLevel = Math.max(state.stats.bestLevel, state.level);
    state.stats.bestCombo = Math.max(state.stats.bestCombo, state.bestComboRun);
    state.stats.bestClear = Math.max(state.stats.bestClear, state.bestClearInGame);
    if (won) state.stats.modeWins += 1;
    if (won && state.mode === "sprint") state.stats.sprintWins += 1;
    if (state.mode === "chaos") state.stats.chaosGames += 1;
    if (state.mode === "relax") state.stats.relaxGames += 1;
    state.scores.unshift({
      score: state.score,
      lines: state.lines,
      level: state.level,
      mode: MODES[state.mode].name,
      time: formatTime(state.elapsedMs),
      date: new Date().toLocaleDateString("ru-RU")
    });
    state.scores = state.scores.sort((a, b) => b.score - a.score).slice(0, 10);
    saveJson(STORAGE.stats, state.stats);
    saveJson(STORAGE.scores, state.scores);
    localStorage.removeItem(STORAGE.save);
    checkAchievements();
    ui.gameOverTitle.textContent = won ? "Победа!" : "Игра окончена";
    ui.gameOverText.textContent = text;
    ui.finalScore.textContent = state.score;
    ui.finalLevel.textContent = state.level;
    ui.finalLines.textContent = state.lines;
    ui.finalCombo.textContent = state.bestComboRun;
    ui.finalRecord.textContent = state.stats.bestScore;
    ui.gameOverInsight.innerHTML = gameOverInsight();
    ui.serverRecordStatus.textContent = "Серверный рекорд отправляется...";
    ui.gameOverOverlay.hidden = false;
    renderCoachTips();
    playSound(won ? 980 : 170, 0.22, won ? "triangle" : "sawtooth", "alert");
    if (won) burst(50);
    sendOnlineUpdate(true);
    submitServerRecord();
  }

  function pause() {
    if (!state.running || state.gameOver) return;
    state.paused = true;
    saveCurrentGame();
    ui.pauseOverlay.hidden = false;
  }

  function resume() {
    if (!state.running || state.gameOver) return;
    state.paused = false;
    state.lastTime = 0;
    ui.pauseOverlay.hidden = true;
  }

  function returnToMainMenu() {
    let saved = false;
    if (state.running && !state.gameOver) {
      state.paused = true;
      saveCurrentGame();
      saved = true;
    }
    hideOverlays();
    ui.startOverlay.hidden = false;
    showToast(saved ? "Партия сохранена" : "Главное меню");
  }

  function togglePause() {
    if (state.paused) resume();
    else pause();
  }

  function canInput() {
    return state.running && !state.paused && !state.gameOver && state.active;
  }

  function dropInterval() {
    const bonus = DIFFICULTY[state.difficulty].speedBonus;
    const relaxed = MODES[state.mode].relaxed ? 180 : 0;
    return Math.max(70, 760 + relaxed - (state.level - 1) * 42 - bonus);
  }

  function update(time) {
    if (!state.lastTime) state.lastTime = time;
    const delta = Math.min(80, time - state.lastTime);
    state.lastTime = time;

    if (state.running && !state.paused && !state.gameOver) {
      state.elapsedMs += delta;
      state.dropMs += delta;
      if (state.dropMs >= dropInterval()) {
        state.dropMs = 0;
        move(0, 1, false);
      }
      updateLockDelay(delta);
    }

    state.flashes = state.flashes
      .map((f) => ({ ...f, life: f.life - delta / 320, width: Math.min(1, f.width + delta / 140) }))
      .filter((f) => f.life > 0);
    draw();
    syncUi();
    requestAnimationFrame(update);
  }

  function ghostPiece() {
    if (!state.active) return null;
    let ghost = { ...state.active };
    while (valid({ ...ghost, y: ghost.y + 1 })) ghost.y += 1;
    return ghost;
  }

  function draw() {
    resize(ui.board, ui.board.clientWidth, ui.board.clientHeight);
    for (const canvas of [ui.next1, ui.next2, ui.next3, ui.hold]) resize(canvas, canvas.clientWidth, canvas.clientHeight);

    const width = ui.board.clientWidth;
    const height = ui.board.clientHeight;
    const cell = Math.min(width / COLS, height / ROWS);
    const boardW = cell * COLS;
    const x0 = (width - boardW) / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    round(ctx, x0, 0, boardW, cell * ROWS, 8, true, false);

    drawOpponentGhost(x0, boardW, cell);

    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) drawCell(ctx, x0 + x * cell, y * cell, cell, state.board[y][x], 1);
    }

    if (state.settings.ghost && state.active) {
      for (const c of cells(ghostPiece())) drawCell(ctx, x0 + c.x * cell, c.y * cell, cell, state.active.kind, 0.22);
    }

    if (state.active) {
      for (const c of cells(state.active)) drawCell(ctx, x0 + c.x * cell, c.y * cell, cell, state.active.kind, 1);
    }

    if (state.settings.grid) {
      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= COLS; x += 1) line(ctx, x0 + x * cell, 0, x0 + x * cell, ROWS * cell);
      for (let y = 0; y <= ROWS; y += 1) line(ctx, x0, y * cell, x0 + boardW, y * cell);
    }

    for (const f of state.flashes) {
      const stripW = boardW * f.width;
      const stripX = x0 + (boardW - stripW) / 2;
      const gradient = ctx.createLinearGradient(stripX, 0, stripX + stripW, 0);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, `rgba(255,255,255,${0.62 * f.life})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(stripX, f.row * cell, stripW, cell);
      ctx.fillStyle = `rgba(86,223,186,${0.22 * f.life})`;
      ctx.fillRect(x0, f.row * cell + cell * 0.42, boardW, Math.max(2, cell * 0.16));
    }

    drawPreview(previews[0], ui.next1, state.queue[0]);
    drawPreview(previews[1], ui.next2, state.queue[1]);
    drawPreview(previews[2], ui.next3, state.queue[2]);
    drawPreview(holdCtx, ui.hold, state.hold);
  }

  function resize(canvas, width, height) {
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
  }

  function drawPreview(context, canvas, kind) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    const size = Math.min(width, height) / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const filled = kind && SHAPES[kind][0].some(([sx, sy]) => sx === x && sy === y);
        drawCell(context, x * size + 2, y * size + 2, size - 2, filled ? kind : null, filled ? 1 : 0.5);
      }
    }
  }

  function drawOpponentGhost(x0, boardW, cell) {
    const height = opponentHeight();
    if (!height) return;
    const ghostHeight = Math.min(ROWS, height) * cell;
    const y = ROWS * cell - ghostHeight;
    ctx.fillStyle = "rgba(255, 178, 74, 0.13)";
    ctx.fillRect(x0, y, boardW, ghostHeight);
    ctx.strokeStyle = "rgba(255, 178, 74, 0.45)";
    ctx.lineWidth = 2;
    line(ctx, x0, y, x0 + boardW, y);
  }

  function drawCell(context, x, y, size, kind, alpha) {
    const theme = state.settings.theme;
    const pad = Math.max(1, size * (theme === "mono" ? 0.10 : theme === "candy" ? 0.04 : 0.06));
    const s = size - pad * 2;
    const radius = theme === "mono" ? Math.max(2, size * 0.04) : theme === "candy" ? Math.max(5, size * 0.22) : Math.max(3, size * 0.15);
    context.globalAlpha = alpha;
    if (!kind) {
      context.fillStyle = "rgba(255,255,255,0.035)";
      round(context, x + pad, y + pad, s, s, radius, true, false);
      context.globalAlpha = 1;
      return;
    }
    const gradient = context.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, colorFor(kind));
    gradient.addColorStop(1, shade(colorFor(kind), theme === "day" ? -12 : -22));
    context.fillStyle = gradient;
    round(context, x + pad, y + pad, s, s, radius, true, false);
    if (theme !== "mono") {
      context.fillStyle = theme === "candy" ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)";
      round(context, x + pad + 3, y + pad + 3, Math.max(2, s - 6), Math.max(5, s * 0.22), Math.max(2, size * 0.08), true, false);
    }
    context.strokeStyle = theme === "mono" ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.18)";
    round(context, x + pad, y + pad, s, s, radius, false, true);
    context.globalAlpha = 1;
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

  function colorFor(kind) {
    const palette = state.settings.colorBlind ? SAFE_COLORS : (THEME_COLORS[state.settings.theme] || COLORS);
    return palette[kind] || palette.X || COLORS.X;
  }

  function syncUi() {
    ui.scoreValue.textContent = state.score;
    ui.levelValue.textContent = state.level;
    ui.linesValue.textContent = MODES[state.mode].goal ? `${state.lines}/${MODES[state.mode].goal}` : state.lines;
    ui.recordValue.textContent = state.stats.bestScore;
    ui.comboValue.textContent = state.combo;
    ui.piecesValue.textContent = state.pieces;
    ui.timeValue.textContent = formatTime(state.elapsedMs);
    ui.apmValue.textContent = actionsPerMinute();
    ui.heightValue.textContent = currentHeight();
    ui.goalValue.textContent = goalText();
    ui.progressFill.style.width = `${progressPercent()}%`;
    ui.rankValue.textContent = rankText();
    ui.boardShell.classList.toggle("danger", state.settings.danger && topDanger());
    renderOnlinePanel();
    sendOnlineUpdateThrottled();
  }

  function actionsPerMinute() {
    const minutes = Math.max(1 / 60, state.elapsedMs / 60000);
    return Math.round((state.moves + state.rotations + state.hardDrops + state.holds + state.softDrops) / minutes);
  }

  function currentHeight() {
    const first = state.board.findIndex((row) => row.some(Boolean));
    return first === -1 ? 0 : ROWS - first;
  }

  function columnHeights() {
    return Array.from({ length: COLS }, (_, x) => {
      for (let y = 0; y < ROWS; y += 1) {
        if (state.board[y][x]) return ROWS - y;
      }
      return 0;
    });
  }

  function countHoles() {
    let holes = 0;
    for (let x = 0; x < COLS; x += 1) {
      let seenBlock = false;
      for (let y = 0; y < ROWS; y += 1) {
        if (state.board[y][x]) seenBlock = true;
        else if (seenBlock) holes += 1;
      }
    }
    return holes;
  }

  function surfaceBumpiness() {
    const heights = columnHeights();
    return heights.slice(1).reduce((sum, height, index) => sum + Math.abs(height - heights[index]), 0);
  }

  function goalText() {
    if (MODES[state.mode].goal) return `${state.lines}/${MODES[state.mode].goal} линий`;
    if (state.mode === "relax") return "Без давления";
    if (state.mode === "chaos") return "Выжить";
    return "Рекорд";
  }

  function progressPercent() {
    if (MODES[state.mode].goal) return Math.min(100, Math.round(state.lines / MODES[state.mode].goal * 100));
    return Math.min(100, Math.round(state.level / 20 * 100));
  }

  function rankText() {
    if (state.score >= 12000) return "Легенда";
    if (state.score >= 7000) return "Мастер";
    if (state.score >= 3500) return "Профи";
    if (state.score >= 1200) return "Игрок";
    return "Новичок";
  }

  function defaultServerUrl() {
    if (location.protocol === "https:") return `wss://${location.host}`;
    if (location.protocol === "http:") return `ws://${location.host}`;
    return "ws://localhost:8787";
  }

  function openOnline() {
    ui.onlineServerInput.value = ui.onlineServerInput.value || defaultServerUrl();
    ui.onlineRoomInput.value = ui.onlineRoomInput.value || localStorage.getItem("tetris-last-room") || generateRoomCode();
    ui.onlineNameInput.value = ui.onlineNameInput.value || localStorage.getItem("blockdrop-player-name") || "Игрок";
    ui.onlineOverlay.hidden = false;
    renderOnlinePlayers();
    updateOnlineControls();
    updateLayoutMetrics();
  }

  function ensureRoomCode() {
    const room = normalizeCode(ui.onlineRoomInput.value || state.online.room) || generateRoomCode();
    ui.onlineRoomInput.value = room;
    localStorage.setItem("tetris-last-room", room);
    return room;
  }

  function roomFromUrl() {
    const pathRoom = location.pathname.match(/\/room\/([A-Z0-9]+)/i)?.[1];
    const queryRoom = new URLSearchParams(location.search).get("room");
    return normalizeCode(pathRoom || queryRoom);
  }

  function roomInviteUrl(room = ensureRoomCode()) {
    const url = new URL(location.href);
    const canUsePrettyRoom = location.protocol.startsWith("http") && !location.hostname.endsWith("github.io");
    if (canUsePrettyRoom) {
      const basePath = url.pathname.includes("/room/") ? url.pathname.split("/room/")[0] : url.pathname.replace(/\/[^/]*$/, "");
      url.pathname = `${basePath.replace(/\/$/, "")}/room/${room}`;
      url.search = "";
    } else {
      url.searchParams.set("room", room);
    }
    url.hash = "";
    return url.toString();
  }

  function shareRoomLink() {
    const room = ensureRoomCode();
    shareText(`Заходи в комнату Тетриса ${room}: ${roomInviteUrl(room)}`);
  }

  function connectOnline() {
    const server = ui.onlineServerInput.value.trim();
    const room = ensureRoomCode();
    const name = (ui.onlineNameInput.value.trim() || "Игрок").slice(0, 18);
    localStorage.setItem("blockdrop-player-name", name);
    localStorage.setItem("tetris-last-room", room);
    ui.onlineRoomInput.value = room;

    disconnectOnline(false);
    try {
      const socket = new WebSocket(server);
      state.online.socket = socket;
      state.online.room = room;
      state.online.name = name;
      ui.onlineStatus.textContent = "Подключение...";

      socket.addEventListener("open", () => {
        state.online.connected = true;
        socket.send(JSON.stringify({
          type: "join",
          room,
          name,
          maxPlayers: Number(ui.onlineMaxPlayersSelect.value),
          durationSec: Number(ui.onlineDurationSelect.value)
        }));
        sendOnlineUpdate(true);
        ui.onlineStatus.textContent = `Комната ${room}`;
        if (location.protocol.startsWith("http")) history.replaceState(null, "", roomInviteUrl(room));
        updateOnlineControls();
        updateLayoutMetrics();
        showToast(`Онлайн: ${room}`);
      });

      socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "hello") {
          state.online.id = data.id;
        }
        if (data.type === "error") {
          ui.onlineStatus.textContent = data.message || "Ошибка комнаты";
          showToast(data.message || "Ошибка комнаты");
        }
        if (data.type === "state") {
          state.online.peers = data.players || {};
          state.online.tournament = data.tournament || null;
          renderOnlinePlayers();
          renderOnlinePanel();
        }
        if (data.type === "attack") {
          receiveGarbage(Number(data.lines) || 0, data.from || "соперника");
        }
        if (data.type === "tournamentEnd") {
          state.online.tournament = data.tournament || state.online.tournament;
          showTournamentResults(data.players || state.online.peers || {});
        }
      });

      socket.addEventListener("close", () => {
        state.online.connected = false;
        state.online.socket = null;
        ui.onlineStatus.textContent = "Отключено";
        renderOnlinePanel();
        updateOnlineControls();
        updateLayoutMetrics();
      });

      socket.addEventListener("error", () => {
        ui.onlineStatus.textContent = "Ошибка подключения";
        showToast("Сервер недоступен");
      });
    } catch {
      showToast("Неверный адрес сервера");
    }
  }

  function disconnectOnline(show = true) {
    if (state.online.socket) state.online.socket.close();
    state.online.socket = null;
    state.online.connected = false;
    state.online.peers = {};
    state.online.tournament = null;
    renderOnlinePanel();
    renderOnlinePlayers();
    updateOnlineControls();
    updateLayoutMetrics();
    if (show) showToast("Онлайн отключён");
  }

  function toggleOnlineConnection() {
    if (state.online.connected) disconnectOnline();
    else connectOnline();
  }

  function updateOnlineControls() {
    ui.connectOnlineButton.textContent = state.online.connected ? "Отключиться" : "Подключиться";
    ui.connectOnlineButton.classList.toggle("primary", !state.online.connected);
  }

  function sendOnlineUpdate(force = false) {
    const socket = state.online.socket;
    if (!state.online.connected || !socket || socket.readyState !== WebSocket.OPEN) return;
    state.online.lastSent = performance.now();
    socket.send(JSON.stringify({
      type: "update",
      room: state.online.room,
      name: state.online.name,
      score: state.score,
      lines: state.lines,
      level: state.level,
      height: currentHeight(),
      sentGarbage: state.sentGarbage,
      receivedGarbage: state.receivedGarbage,
      mode: MODES[state.mode].name,
      time: formatTime(state.elapsedMs),
      status: state.gameOver ? (state.won ? "Победа" : "Финиш") : state.paused ? "Пауза" : "Играет",
      force
    }));
  }

  function sendOnlineUpdateThrottled() {
    if (performance.now() - state.online.lastSent > 700) sendOnlineUpdate(false);
  }

  function startTournament() {
    if (!state.online.connected || !state.online.socket || state.online.socket.readyState !== WebSocket.OPEN) {
      showToast("Сначала подключись к комнате");
      return;
    }
    state.online.socket.send(JSON.stringify({
      type: "startTournament",
      room: state.online.room,
      maxPlayers: Number(ui.onlineMaxPlayersSelect.value),
      durationSec: Number(ui.onlineDurationSelect.value)
    }));
    showToast("Турнир запускается");
    startGame(state.mode, state.difficulty);
  }

  function renderOnlinePlayers() {
    const players = Object.values(state.online.peers || {}).sort((a, b) => b.score - a.score);
    ui.onlinePlayers.innerHTML = players.length
      ? players.map((p) => `<div class="result-row"><span>${escapeHtml(p.name)} · ${escapeHtml(p.status)}</span><span>${p.score}</span></div>`).join("")
      : `<div class="result-row"><span>Игроков пока нет</span><span>0</span></div>`;
    if (state.online.tournament?.active) {
      ui.onlineStatus.textContent = `Турнир: ${formatTime(state.online.tournament.timeLeftMs)} · ${players.length}/${state.online.tournament.maxPlayers}`;
    }
  }

  function renderOnlinePanel() {
    if (!state.online.connected) {
      ui.onlinePanel.classList.remove("active");
      ui.onlinePanel.innerHTML = "";
      return;
    }
    const players = Object.values(state.online.peers || {}).sort((a, b) => b.score - a.score).slice(0, 4);
    ui.onlinePanel.classList.add("active");
    const timer = state.online.tournament?.active ? `<div class="online-timer">Турнир: ${formatTime(state.online.tournament.timeLeftMs)}</div>` : "";
    ui.onlinePanel.innerHTML = timer + `<div class="mission done"><span>Онлайн ${escapeHtml(state.online.room)}</span><b>${players.length}</b></div>` +
      players.map((p) => `<div class="online-player"><span>${escapeHtml(p.name)}</span><b>${p.score}</b></div>`).join("");
  }

  function showTournamentResults(playersObject) {
    const players = Object.values(playersObject || {}).sort((a, b) => b.score - a.score);
    ui.tournamentResults.innerHTML = players.length
      ? players.map((p, i) => `<div class="result-row"><span>${i + 1}. ${escapeHtml(p.name)} · ${escapeHtml(p.status)}</span><span>${p.score}</span></div>`).join("")
      : `<div class="result-row"><span>Нет результатов</span><span>0</span></div>`;
    if (state.running && !state.gameOver) {
      state.running = false;
      state.gameOver = true;
      localStorage.removeItem(STORAGE.save);
    }
    ui.tournamentOverlay.hidden = false;
  }

  function opponentHeight() {
    return Object.values(state.online.peers || {})
      .filter((p) => p.id !== state.online.id && Number.isFinite(Number(p.height)))
      .sort((a, b) => b.score - a.score)[0]?.height || 0;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function topDanger() {
    return state.board.slice(0, 4).some((row) => row.some(Boolean));
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const min = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, "0");
    return `${min}:${sec}`;
  }

  function saveCurrentGame() {
    if (!state.running || state.gameOver) return;
    saveJson(STORAGE.save, {
      board: state.board,
      active: state.active,
      queue: state.queue,
      bag: state.bag,
      hold: state.hold,
      holdUsed: state.holdUsed,
      mode: state.mode,
      difficulty: state.difficulty,
      score: state.score,
      lines: state.lines,
      level: state.level,
      combo: state.combo,
      bestComboRun: state.bestComboRun,
      pieces: state.pieces,
      hardDrops: state.hardDrops,
      holds: state.holds,
      rotations: state.rotations,
      moves: state.moves,
      softDrops: state.softDrops,
      bestClearInGame: state.bestClearInGame,
      sessionHistory: state.sessionHistory,
      elapsedMs: state.elapsedMs
    });
  }

  function loadCurrentGame() {
    const save = loadJson(STORAGE.save, null);
    if (!save) {
      showToast("Сохранения пока нет");
      return;
    }
    Object.assign(state, save, { running: true, paused: false, gameOver: false, won: false, lastTime: 0, dropMs: 0, lockDelayMs: 0, lockResets: 0, flashes: [] });
    state.sessionHistory = Array.isArray(save.sessionHistory) ? save.sessionHistory : [];
    state.difficulty = "normal";
    state.rng = Math.random;
    hideOverlays();
    updateLayoutMetrics();
    syncUi();
    showToast("Сохранение загружено");
  }

  function renderStats() {
    const average = state.stats.games ? Math.round(state.stats.totalScore / state.stats.games) : 0;
    ui.statsGrid.innerHTML = [
      ["Игр сыграно", state.stats.games],
      ["Лучший счёт", state.stats.bestScore],
      ["Средний счёт", average],
      ["Всего линий", state.stats.totalLines],
      ["Всего фигур", state.stats.totalPieces],
      ["Лучший уровень", state.stats.bestLevel],
      ["Лучшее комбо", state.stats.bestCombo],
      ["Резких сбросов", state.stats.totalHardDrops],
      ["Запасов", state.stats.totalHolds],
      ["Поворотов", state.stats.totalRotations],
      ["Движений", state.stats.totalMoves],
      ["Время в игре", formatTime(state.stats.totalTime * 1000)]
    ].filter((_, index) => index !== 8).map(([k, v]) => `<div class="result-row"><span>${k}</span><span>${v}</span></div>`).join("");

    ui.leaderboard.innerHTML = state.scores.length
      ? state.scores.map((s, i) => `<div class="score-row"><span>${i + 1}. ${s.mode}, ${s.date}</span><span>${s.score}</span></div>`).join("")
      : `<div class="score-row"><span>Пока пусто</span><span>0</span></div>`;

    renderServerRecords();

    ui.achievementsList.innerHTML = ACHIEVEMENTS.map(([id, title, desc]) => {
      const open = state.unlocked[id];
      return `<div class="achievement"><b>${open ? "✓ " : ""}${title}</b><small>${desc}</small></div>`;
    }).join("");
  }

  function renderServerRecords() {
    ui.serverLeaderboard.innerHTML = state.serverRecords.length
      ? state.serverRecords.slice(0, 10).map((s, i) => `<div class="score-row"><span>${i + 1}. ${escapeHtml(s.name)} · ${escapeHtml(s.mode)} · ${escapeHtml(new Date(s.date).toLocaleDateString("ru-RU"))}</span><span>${s.score}</span></div>`).join("")
      : `<div class="score-row"><span>Пока нет связи с сервером</span><span>—</span></div>`;
  }

  async function loadServerRecords() {
    if (!location.protocol.startsWith("http")) return;
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      const data = await response.json();
      state.serverRecords = Array.isArray(data.records) ? data.records : [];
      renderServerRecords();
    } catch {
      renderServerRecords();
    }
  }

  async function submitServerRecord() {
    if (!location.protocol.startsWith("http") || state.score <= 0) {
      ui.serverRecordStatus.textContent = location.protocol.startsWith("http") ? "" : "Серверные рекорды доступны на онлайн-версии.";
      return;
    }
    try {
      const name = localStorage.getItem("blockdrop-player-name") || state.online.name || "Игрок";
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          score: state.score,
          lines: state.lines,
          level: state.level,
          mode: MODES[state.mode].name,
          time: formatTime(state.elapsedMs)
        })
      });
      const data = await response.json();
      state.serverRecords = Array.isArray(data.records) ? data.records : [];
      const place = state.serverRecords.findIndex((record) => record.score === state.score && record.lines === state.lines && record.time === formatTime(state.elapsedMs));
      ui.serverRecordStatus.textContent = place >= 0 && place < 10 ? `Серверный топ: место ${place + 1}` : "Результат сохранён на сервере";
    } catch {
      ui.serverRecordStatus.textContent = "Офлайн: результат сохранён только на устройстве";
    }
  }

  function gameOverInsight() {
    const holes = countHoles();
    const height = currentHeight();
    const worstPlacement = state.sessionHistory
      .filter((step) => step.clear === 0)
      .sort((a, b) => (b.holesDelta * 4 + b.heightDelta * 2 + b.bumpinessDelta) - (a.holesDelta * 4 + a.heightDelta * 2 + a.bumpinessDelta))[0];
    if (worstPlacement && worstPlacement.holesDelta >= 2) {
      return `<b>Ключевая ошибка: ${worstPlacement.kind}-фигура</b><small>Именно после неё добавилось дыр: +${worstPlacement.holesDelta}. В похожей ситуации лучше играть в край или убрать фигуру в запас.</small>`;
    }
    if (holes >= 7) return `<b>Главная проблема: дыры</b><small>На поле осталось ${holes}. Играй ровнее и не закрывай пустые клетки, особенно S/Z фигурами.</small>`;
    if (height >= 13) return `<b>Главная проблема: высота</b><small>Башня поднялась до ${height}. Держи рабочую зону ниже середины поля и чисти 2+ линии чаще.</small>`;
    if (state.holds < 1 && state.pieces > 10) return `<b>Не использован запас</b><small>Кнопка “Запас” помогает пережить неудобную фигуру и подготовить место под I.</small>`;
    if (state.bestClearInGame < 2 && state.lines >= 4) return `<b>Мало сильных очисток</b><small>Попробуй строить под 2-4 линии. В онлайне это ещё и отправляет мусор сопернику.</small>`;
    return `<b>Хорошая база</b><small>Следующий шаг: заранее смотреть 2-3 фигуры вперёд и держать один ровный колодец сбоку.</small>`;
  }

  async function shareText(text) {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Тетрис", text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        showToast("Текст скопирован");
      } else {
        showToast(text);
      }
    } catch {
      showToast("Не удалось поделиться");
    }
  }

  function resultText() {
    return `Тетрис: ${state.score} очков, ${state.lines} линий, уровень ${state.level}, режим ${MODES[state.mode].name}.`;
  }

  function statsText() {
    return `Моя статистика в Тетрис: рекорд ${state.stats.bestScore}, линий ${state.stats.totalLines}, игр ${state.stats.games}.`;
  }

  function renderCoachTips() {
    const tips = [];
    const holes = countHoles();
    const bumpiness = surfaceBumpiness();
    const badPlacements = state.sessionHistory
      .filter((step) => step.clear === 0 && (step.holesDelta > 1 || step.heightDelta > 1 || step.bumpinessDelta > 3))
      .sort((a, b) => (b.holesDelta * 4 + b.heightDelta * 2 + b.bumpinessDelta) - (a.holesDelta * 4 + a.heightDelta * 2 + a.bumpinessDelta))
      .slice(0, 2);
    for (const step of badPlacements) {
      const parts = [];
      if (step.holesDelta > 0) parts.push(`дыр стало больше на ${step.holesDelta}`);
      if (step.heightDelta > 0) parts.push(`высота выросла на ${step.heightDelta}`);
      if (step.bumpinessDelta > 0) parts.push(`поверхность стала неровнее`);
      tips.push([`Неудачная ${step.kind}-фигура`, `После этой постановки ${parts.join(", ")}. В похожей ситуации лучше играть в край, в колодец или увести фигуру в запас.`]);
    }
    if (holes >= 6) {
      tips.push(["Слишком много дыр", `Под блоками осталось ${holes} пустых клеток. Сначала закрывай низ ровными фигурами, а неудобные S/Z убирай в запас или на край.`]);
    }
    if (bumpiness >= 18) {
      tips.push(["Неровная поверхность", "Поле стало зубчатым. Старайся ставить фигуры так, чтобы соседние столбцы отличались на 1-2 клетки, тогда меньше придётся крутить в панике."]);
    }
    if (state.receivedGarbage > 0) {
      tips.push(["Онлайн-давление", `Ты получил ${state.receivedGarbage} мусорных линий. В PvP старайся отвечать очисткой 2+ линий, а не просто выживать.`]);
    }
    if (currentHeight() >= 12) {
      tips.push(["Высокая башня", "Поле стало слишком высоким. Оставляй один ровный колодец сбоку и не закрывай его S/Z фигурами."]);
    }
    if (state.holds < 2 && state.pieces > 12) {
      tips.push(["Запас почти не использовался", "Запас нужен не только для I-фигуры. Убирай туда неудобную фигуру, если она ломает поверхность поля."]);
    }
    if (state.bestComboRun < 2 && state.lines > 3) {
      tips.push(["Мало серий", "После очистки линии попробуй сразу готовить следующую. Даже комбо x2 уже заметно ускоряет набор очков."]);
    }
    if (state.hardDrops < 5 && state.elapsedMs > 60000) {
      tips.push(["Слишком осторожно", "Резкий сброс экономит время. Используй призрачную фигуру, чтобы быстрее принимать решения."]);
    }
    if (state.rotations > state.pieces * 4 && state.pieces > 8) {
      tips.push(["Много лишних поворотов", "Если фигура крутится 4+ раза, ты поздно решил, куда её ставить. Смотри на следующую фигуру заранее."]);
    }
    tips.push(["Следующая цель", state.mode === "sprint" ? "В режиме 40 линий цель не рекорд, а чистое поле и скорость. Не копи слишком высокую башню." : "Попробуй играть через 2-3 линии за раз: это уже включает PvP-атаки и тренирует контроль поля."]);
    ui.coachTips.innerHTML = tips.slice(0, 3).map(([title, body]) => `<div class="achievement"><b>${title}</b><small>${body}</small></div>`).join("");
  }

  function checkAchievements() {
    let changed = false;
    for (const [id, title, , rule] of ACHIEVEMENTS) {
      if (!state.unlocked[id] && rule(state.stats)) {
        state.unlocked[id] = true;
        changed = true;
        showToast(`Достижение: ${title}`);
        playSound(1040, 0.10, "triangle", "clear");
      }
    }
    if (changed) saveJson(STORAGE.achievements, state.unlocked);
  }

  function ensureAudio() {
    if (!state.settings.sound) return;
    const AudioClass = window.AudioContext || window.webkitAudioContext;
    if (!state.audio && AudioClass) state.audio = new AudioClass();
    if (state.audio && state.audio.state === "suspended") state.audio.resume();
  }

  function soundLevelFor(category) {
    if (category === "move" || category === "rotate" || category === "drop") return state.settings.moveVolume / 100;
    if (category === "clear") return state.settings.clearVolume / 100;
    if (category === "alert") return state.settings.alertVolume / 100;
    return Math.min(1.4, (state.settings.moveVolume + state.settings.alertVolume) / 200);
  }

  function playSound(freq, duration, type, category = "ui") {
    if (!state.settings.sound || state.settings.volume <= 0) return;
    ensureAudio();
    if (!state.audio) return;
    const now = state.audio.currentTime;
    const oscillator = state.audio.createOscillator();
    const filter = state.audio.createBiquadFilter();
    const gain = state.audio.createGain();
    const softType = type === "sawtooth" || type === "square" ? "triangle" : type;
    const categoryGain = {
      move: 0.55,
      rotate: 0.62,
      drop: 0.78,
      clear: 1.05,
      alert: 0.9,
      ui: 0.68
    }[category] || 0.68;
    oscillator.type = softType;
    oscillator.frequency.setValueAtTime(Math.max(110, freq * 0.82), now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(category === "clear" ? 1900 : 1320, now);
    filter.Q.setValueAtTime(0.35, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.052 * categoryGain * soundLevelFor(category) * (state.settings.volume / 100), now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.04, duration * 0.9));
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(state.audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function buzz(ms) {
    if (state.settings.vibration && navigator.vibrate) navigator.vibrate(Math.min(ms, 12));
  }

  let toastTimer = 0;
  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1800);
  }

  function shakeBoard() {
    if (state.settings.reducedMotion) return;
    ui.boardShell.classList.remove("shake");
    void ui.boardShell.offsetWidth;
    ui.boardShell.classList.add("shake");
  }

  function burst(count) {
    if (!state.settings.particles || state.settings.reducedMotion) return;
    const rect = ui.boardShell.getBoundingClientRect();
    for (let i = 0; i < count; i += 1) {
      const p = document.createElement("i");
      p.className = "particle";
      p.style.left = `${rect.left + rect.width / 2}px`;
      p.style.top = `${rect.top + rect.height * 0.42}px`;
      p.style.background = Object.values(state.settings.colorBlind ? SAFE_COLORS : COLORS)[i % 7];
      p.style.setProperty("--dx", `${Math.cos(i * 1.7) * (60 + Math.random() * 110)}px`);
      p.style.setProperty("--dy", `${Math.sin(i * 1.7) * (60 + Math.random() * 110)}px`);
      ui.fxLayer.appendChild(p);
      setTimeout(() => p.remove(), 760);
    }
  }

  function hideOverlays() {
    ui.startOverlay.hidden = true;
    ui.pauseOverlay.hidden = true;
    ui.settingsOverlay.hidden = true;
    ui.statsOverlay.hidden = true;
    ui.helpOverlay.hidden = true;
    ui.coachOverlay.hidden = true;
    ui.onlineOverlay.hidden = true;
    ui.tournamentOverlay.hidden = true;
    ui.gameOverOverlay.hidden = true;
  }

  function openSettings() {
    ui.settingsOverlay.hidden = false;
  }

  function updateInstallButton() {
    ui.installButton.classList.toggle("hidden", !deferredInstallPrompt);
  }

  async function installApp() {
    if (!deferredInstallPrompt) {
      showToast("Установка доступна на HTTPS-версии");
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch {}
    deferredInstallPrompt = null;
    updateInstallButton();
  }

  let statsReturnOverlay = null;
  function openStats() {
    statsReturnOverlay =
      !ui.gameOverOverlay.hidden ? ui.gameOverOverlay :
      !ui.startOverlay.hidden ? ui.startOverlay :
      !ui.pauseOverlay.hidden ? ui.pauseOverlay :
      null;
    if (statsReturnOverlay) statsReturnOverlay.hidden = true;
    renderStats();
    ui.statsOverlay.hidden = false;
    loadServerRecords();
  }

  function closeStats() {
    ui.statsOverlay.hidden = true;
    if (statsReturnOverlay) statsReturnOverlay.hidden = false;
    statsReturnOverlay = null;
  }

  function bindPress(element, handler) {
    let ignoreClickUntil = 0;
    const run = (event) => {
      event.preventDefault();
      handler();
      syncUi();
    };
    element.addEventListener("pointerdown", (event) => {
      ignoreClickUntil = performance.now() + 450;
      run(event);
    });
    element.addEventListener("click", (event) => {
      if (performance.now() < ignoreClickUntil) {
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
      syncUi();
      stop();
      timer = setInterval(() => {
        handler();
        syncUi();
      }, interval);
    });
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
    element.addEventListener("pointerleave", stop);
  }

  function bind() {
    bindPress(ui.startButton, () => startGame());
    bindPress(ui.continueButton, loadCurrentGame);
    bindPress(ui.startSettingsButton, openSettings);
    bindPress(ui.installButton, installApp);
    bindPress(ui.openStatsButton, openStats);
    bindPress(ui.helpButton, () => ui.helpOverlay.hidden = false);
    bindPress(ui.closeHelpButton, () => ui.helpOverlay.hidden = true);
    bindPress(ui.closeCoachButton, () => ui.coachOverlay.hidden = true);
    bindPress(ui.onlineButton, openOnline);
    bindPress(ui.connectOnlineButton, toggleOnlineConnection);
    bindPress(ui.shareRoomButton, shareRoomLink);
    bindPress(ui.startTournamentButton, startTournament);
    bindPress(ui.closeOnlineButton, () => ui.onlineOverlay.hidden = true);
    bindPress(ui.closeTournamentButton, () => ui.tournamentOverlay.hidden = true);
    bindPress(ui.rematchButton, startTournament);
    bindPress(ui.resumeButton, resume);
    bindPress(ui.playAgainButton, () => startGame(state.mode, state.difficulty));
    bindPress(ui.pauseButton, togglePause);
    bindPress(ui.mainMenuButton, returnToMainMenu);
    bindPress(ui.pauseMenuButton, returnToMainMenu);
    bindPress(ui.gameOverMenuButton, returnToMainMenu);
    bindPress(ui.pauseRestartButton, () => startGame(state.mode, state.difficulty));
    bindPress(ui.pauseSettingsButton, openSettings);
    bindPress(ui.closeSettingsButton, () => ui.settingsOverlay.hidden = true);
    bindPress(ui.closeStatsButton, closeStats);
    bindPress(ui.shareStatsButton, () => shareText(statsText()));
    bindPress(ui.gameOverStatsButton, openStats);
    bindPress(ui.gameOverCoachButton, () => ui.coachOverlay.hidden = false);
    bindPress(ui.shareResultButton, () => shareText(resultText()));
    bindPress(ui.holdButton, holdPiece);
    bindRepeat(ui.leftButton, () => move(-1, 0));
    bindRepeat(ui.rightButton, () => move(1, 0));
    bindRepeat(ui.downButton, softDrop, 58);
    bindPress(ui.rotateButton, rotate);
    bindPress(ui.dropButton, hardDrop);
    ui.themeSelect.addEventListener("change", () => { state.settings.theme = ui.themeSelect.value; applySettings(); });
    ui.controlModeSelect.addEventListener("change", () => { state.settings.controlMode = ui.controlModeSelect.value; applySettings(); });
    ui.sensitivityRange.addEventListener("input", () => { state.settings.sensitivity = Number(ui.sensitivityRange.value); applySettings(); });
    ui.dasRange.addEventListener("input", () => { state.settings.dasMs = Number(ui.dasRange.value); applySettings(); });
    ui.arrRange.addEventListener("input", () => { state.settings.arrMs = Number(ui.arrRange.value); applySettings(); });
    ui.ghostToggle.addEventListener("change", () => { state.settings.ghost = ui.ghostToggle.checked; applySettings(); });
    ui.bigButtonsToggle.addEventListener("change", () => { state.settings.bigButtons = ui.bigButtonsToggle.checked; applySettings(); });
    ui.vibrationToggle.addEventListener("change", () => { state.settings.vibration = ui.vibrationToggle.checked; applySettings(); });
    ui.volumeRange.addEventListener("input", () => { state.settings.volume = Number(ui.volumeRange.value); applySettings(); });
    ui.moveVolumeRange.addEventListener("input", () => { state.settings.moveVolume = Number(ui.moveVolumeRange.value); applySettings(); });
    ui.clearVolumeRange.addEventListener("input", () => { state.settings.clearVolume = Number(ui.clearVolumeRange.value); applySettings(); });
    ui.alertVolumeRange.addEventListener("input", () => { state.settings.alertVolume = Number(ui.alertVolumeRange.value); applySettings(); });

    const horizontalKeys = new Map();
    const stopHorizontal = (key) => {
      const timers = horizontalKeys.get(key);
      if (!timers) return;
      clearTimeout(timers.das);
      clearInterval(timers.arr);
      horizontalKeys.delete(key);
    };
    const startHorizontal = (key, direction) => {
      if (horizontalKeys.has(key)) return;
      move(direction, 0);
      const timers = { das: 0, arr: 0 };
      timers.das = setTimeout(() => {
        const repeat = () => {
          move(direction, 0);
          syncUi();
        };
        repeat();
        if (state.settings.arrMs === 0) {
          while (move(direction, 0)) {}
          syncUi();
          return;
        }
        timers.arr = setInterval(repeat, state.settings.arrMs);
      }, state.settings.dasMs);
      horizontalKeys.set(key, timers);
    };

    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "a") { event.preventDefault(); startHorizontal(key, -1); }
      else if (key === "arrowright" || key === "d") { event.preventDefault(); startHorizontal(key, 1); }
      else if (key === "arrowdown" || key === "s") { event.preventDefault(); softDrop(); }
      else if (key === "arrowup" || key === "w" || key === "x") { event.preventDefault(); rotate(); }
      else if (key === " " || key === "z") { event.preventDefault(); hardDrop(); }
      else if (key === "c") { event.preventDefault(); holdPiece(); }
      else if (key === "p" || key === "escape") { event.preventDefault(); togglePause(); }
      syncUi();
    });
    window.addEventListener("keyup", (event) => stopHorizontal(event.key.toLowerCase()));
    window.addEventListener("blur", () => {
      for (const key of [...horizontalKeys.keys()]) stopHorizontal(key);
    });

    let sx = 0;
    let sy = 0;
    let lastX = 0;
    let gestureMoved = false;
    let gestureHardDropped = false;
    let gestureSoftDropped = false;
    ui.board.addEventListener("touchstart", (event) => {
      if (state.settings.controlMode === "buttons") return;
      event.preventDefault();
      sx = event.changedTouches[0].clientX;
      sy = event.changedTouches[0].clientY;
      lastX = sx;
      gestureMoved = false;
      gestureHardDropped = false;
      gestureSoftDropped = false;
    }, { passive: false });
    ui.board.addEventListener("touchmove", (event) => {
      if (state.settings.controlMode === "buttons") return;
      event.preventDefault();
      const touch = event.changedTouches[0];
      const threshold = state.settings.sensitivity;
      const dx = touch.clientX - lastX;
      const totalDy = touch.clientY - sy;
      if (Math.abs(dx) >= threshold * 0.85 && Math.abs(dx) > Math.abs(totalDy) * 0.42) {
        const steps = Math.max(1, Math.min(3, Math.floor(Math.abs(dx) / threshold)));
        for (let i = 0; i < steps; i += 1) move(dx < 0 ? -1 : 1, 0);
        lastX = touch.clientX;
        gestureMoved = true;
        syncUi();
      } else if (totalDy > threshold * 1.1 && !gestureMoved && !gestureSoftDropped) {
        const steps = Math.max(1, Math.min(5, Math.round(totalDy / threshold)));
        for (let i = 0; i < steps; i += 1) softDrop();
        gestureSoftDropped = true;
        syncUi();
      }
    }, { passive: false });
    ui.board.addEventListener("touchend", (event) => {
      if (state.settings.controlMode === "buttons") return;
      event.preventDefault();
      const touch = event.changedTouches[0];
      const dx = touch.clientX - sx;
      const dy = touch.clientY - sy;
      const threshold = state.settings.sensitivity;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold && !gestureMoved) rotate();
      else if (Math.abs(dx) > Math.abs(dy) && !gestureMoved) {
        const steps = Math.max(1, Math.min(6, Math.round(Math.abs(dx) / threshold)));
        for (let i = 0; i < steps; i += 1) move(dx < 0 ? -1 : 1, 0);
      }
      else if (dy < -threshold * 1.1) rotate();
      else if (dy > threshold * 2.6 && !gestureHardDropped) hardDrop();
      else if (dy > threshold && !gestureSoftDropped) {
        const steps = Math.max(1, Math.min(4, Math.round(dy / threshold)));
        for (let i = 0; i < steps; i += 1) softDrop();
      }
      syncUi();
    }, { passive: false });

    document.addEventListener("visibilitychange", () => {
      if (state.settings.autoPause && document.hidden && state.running && !state.paused) pause();
    });
    window.addEventListener("offline", () => showToast("Офлайн: одиночная игра доступна"));
    window.addEventListener("online", () => {
      showToast("Сеть вернулась");
      loadServerRecords();
    });
    window.addEventListener("beforeunload", saveCurrentGame);
    window.addEventListener("resize", () => {
      updateLayoutMetrics();
      draw();
    });

    if ("ResizeObserver" in window) {
      state.layoutObserver = new ResizeObserver(() => updateLayoutMetrics());
      state.layoutObserver.observe(ui.app);
      state.layoutObserver.observe(ui.controls);
      state.layoutObserver.observe(ui.statusStrip);
      state.layoutObserver.observe(ui.topbar);
    }
  }

  function bootPwa() {
    const canUsePwa = "serviceWorker" in navigator && (window.isSecureContext || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
    if (canUsePwa) {
      navigator.serviceWorker.register("sw.js").then(() => {
        showToast("Офлайн-кэш готовится");
      }).catch(() => {});
    }
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallButton();
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      updateInstallButton();
      showToast("Офлайн-версия установлена");
    });
  }

  function applyUrlParams() {
    const params = new URLSearchParams(location.search);
    const mode = params.get("mode");
    if (mode && MODES[mode]) ui.startMode.value = mode;
    const room = roomFromUrl();
    if (room) {
      ui.onlineRoomInput.value = room;
      localStorage.setItem("tetris-last-room", room);
      setTimeout(openOnline, 0);
    }
  }

  bind();
  applyUrlParams();
  applySettings();
  syncUi();
  draw();
  bootPwa();
  loadServerRecords();
  requestAnimationFrame(update);
})();
