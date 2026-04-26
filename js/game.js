import { SOUND_EVENTS, initAudio, makeAudioSettings, playSound as playAudioSound, setVolume, toggleMute } from "./audio.js";
import {
  COLS,
  PHYSICS,
  ROWS,
  SCORING_THRESHOLDS,
  SCORE_TABLE,
  SHAPES,
  SRS_KICKS,
  TIMING,
  UI as UI_CONFIG
} from "./config.js";
import { gestureProfile, normalizeControls, swipeThresholdForPreset } from "./input.js";
import { GAME_MODES, getModeConfig, normalizeModeKey } from "./modes.js";
import {
  buildRoomInviteUrl,
  connectOnline as openOnlineSocket,
  createOnlineClient,
  defaultServerUrl,
  disconnectOnline as closeOnlineSocket,
  generateRoomCode,
  normalizeRoomId,
  onOnlineMessage,
  roomFromLocation,
  sendAttack,
  sendOnlineMessage,
  sendScoreUpdate
} from "./online.js";
import { createGameStorage } from "./storage.js";
import { createUi } from "./ui.js";
import { createBag } from "./game-core.js";

(() => {
  "use strict";

  const LOCK_DELAY_MS = TIMING.LOCK_DELAY_MS;
  const MAX_LOCK_RESETS = 12;
  const STORAGE = {
    high: "blockdrop-high-score",
    stats: "blockdrop-stats-v2",
    settings: "blockdrop-settings-v2",
    save: "blockdrop-save-v2",
    scores: "blockdrop-scoreboard-v2",
    achievements: "blockdrop-achievements-v2",
    lastRoom: "tetris-last-room",
    playerName: "blockdrop-player-name"
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

  const MODES = GAME_MODES;

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

  const HAPTICS = {
    move: 3,
    rotate: 4,
    hold: 5,
    drop: 8,
    clear: [6, 18, 6],
    tetris: [8, 20, 8],
    attack: [7, 24, 7],
    win: [8, 22, 8],
    gameOver: [12, 30, 14]
  };

  const storage = createGameStorage(STORAGE);
  const ui = createUi();
  const onlineClient = createOnlineClient();
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
    layoutObserver: null,
    settings: loadSettings(),
    stats: loadStats(),
    scores: storage.loadScores([]),
    serverRecords: [],
    unlocked: storage.loadAchievements({}),
    online: {
      id: "",
      connected: false,
      room: "",
      name: "",
      peers: {},
      tournament: null,
      lastSent: 0
    },
    ai: {
      enabled: false,
      score: 0,
      height: 0,
      elapsedMs: 0,
      attackMs: 0,
      name: "AI"
    }
  };

  const audio = initAudio(() => state.settings);

  function ensureAudio() {
    audio.player.resume();
  }

  function makeBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadSettings() {
    return {
      theme: "ember",
      ...normalizeControls(),
      ghost: true,
      bigButtons: false,
      vibration: true,
      grid: true,
      danger: true,
      particles: true,
      colorBlind: false,
      autoPause: true,
      reducedMotion: false,
      language: "ru",
      performanceMode: "auto",
      ...makeAudioSettings(),
      ...storage.loadSettings({})
    };
  }

  function loadStats() {
    return {
      games: 0,
      totalScore: 0,
      totalLines: 0,
      totalPieces: 0,
      totalTime: 0,
      bestScore: storage.loadBestScore(0),
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
      modeCounts: { classic: 0, sprint: 0, relax: 0, chaos: 0 },
      pieceCounts: { I: 0, O: 0, T: 0, S: 0, Z: 0, J: 0, L: 0 },
      ...storage.loadStats({})
    };
  }

  function applySettings() {
    Object.assign(state.settings, normalizeControls(state.settings));
    state.settings.grid = true;
    state.settings.danger = true;
    state.settings.performanceMode = ["auto", "battery", "quality"].includes(state.settings.performanceMode) ? state.settings.performanceMode : "auto";
    state.settings.particles = state.settings.performanceMode !== "battery";
    state.settings.colorBlind = false;
    state.settings.ghost = true;
    state.settings.bigButtons = false;
    state.settings.autoPause = true;
    state.settings.reducedMotion = state.settings.performanceMode === "battery";
    state.settings.language = ["ru", "en"].includes(state.settings.language) ? state.settings.language : "ru";
    state.settings.volume = clamp(Number(state.settings.volume) || 0, 0, 100);
    state.settings.moveVolume = state.settings.volume;
    state.settings.clearVolume = state.settings.volume;
    state.settings.alertVolume = state.settings.volume;
    state.settings.sound = state.settings.volume > 0;
    setVolume(audio, state.settings.volume);
    toggleMute(audio, !state.settings.sound);
    ui.applySettings(state.settings);
    storage.saveSettings(state.settings);
    updateLayoutMetrics();
  }

  function updateLayoutMetrics() {
    ui.updateLayoutMetrics({ cols: COLS, rows: ROWS, onlineConnected: state.online.connected });
  }

  function refillBag() {
    state.bag.push(...createBag(random));
  }

  function random() {
    return state.rng ? state.rng() : Math.random();
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

  function startGame(mode = ui.getStartMode(), difficulty = "normal", options = {}) {
    difficulty = "normal";
    mode = normalizeModeKey(mode);
    const modeConfig = getModeConfig(mode);
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
    state.level = Math.max(modeConfig.startLevel, DIFFICULTY[difficulty].startLevel);
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
    state.ai.enabled = Boolean(options.ai);
    state.ai.score = 0;
    state.ai.height = 0;
    state.ai.elapsedMs = 0;
    state.ai.attackMs = 0;
    state.ai.name = state.settings.language === "en" ? "AI bot" : "Бот";
    hideOverlays();
    fillQueue();
    addGarbage(DIFFICULTY[difficulty].garbage);
    if (modeConfig.garbageAttacks) addGarbage(4);
    spawn();
    ensureAudio();
    buzz("move");
    syncUi();
    saveCurrentGame();
  }

  function startAiGame() {
    startGame("classic", "normal", { ai: true });
    showToast(state.settings.language === "en" ? "AI opponent joined" : "AI соперник подключён");
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
    playEvent("attack");
    buzz("attack");
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
    if (dx !== 0) playEvent("move");
    return true;
  }

  function rotate(direction = 1) {
    if (!canInput()) return;
    const from = state.active.rotation;
    const normalizedDirection = direction < 0 ? -1 : 1;
    const to = (from + normalizedDirection + 4) % 4;
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
        playEvent("rotate", normalizedDirection < 0 ? { freq: SOUND_EVENTS.rotate.freq - 50 } : {});
        buzz("rotate");
        return true;
      }
    }
    return false;
  }

  function softDrop() {
    if (!move(0, PHYSICS.SOFT_DROP_SPEED, true)) updateLockDelay(TIMING.SOFT_DROP_LOCK_MS);
  }

  function stepHorizontal(direction) {
    const moved = move(direction, 0);
    if (moved) buzz("move");
    return moved;
  }

  function rotateClockwise() {
    return rotate(1);
  }

  function rotateCounterClockwise() {
    return rotate(-1);
  }

  function hardDrop() {
    if (!canInput()) return;
    let distance = 0;
    while (move(0, 1, false)) distance += 1;
    state.hardDrops += 1;
    state.stats.totalHardDrops += 1;
    addScore(distance * PHYSICS.HARD_DROP_SCORE_PER_CELL);
    lock();
    playEvent("hardDrop");
    buzz("drop");
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
    playEvent("hold");
  }

  function lock() {
    if (!state.active) return;
    const modeConfig = getModeConfig(state.mode);
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
      state.level = modeConfig.relaxed ? modeConfig.startLevel : Math.min(20, Math.floor(state.lines / modeConfig.levelUp) + DIFFICULTY[state.difficulty].startLevel);
      playEvent(count === 4 ? "tetris" : "line");
      if (count === 4) burst(44);
      if (state.combo >= 2) playEvent("combo", { freq: SOUND_EVENTS.combo.freq + state.combo * 18 });
      if (state.level > previousLevel) {
        showToast(`Уровень ${state.level}`);
        playEvent("levelUp");
        burst(26);
      }
      buzz(count === 4 ? "tetris" : "clear");
      const comboText = state.combo >= 2 ? `. Комбо x${state.combo}` : "";
      if (count === 4) showToast("Четыре линии сразу!");
      else if (count >= 2) showToast(`${count} линии${comboText}`);
      sendAttackForClear(count);
      burst(count === 4 ? 34 : 18);
      shakeBoard();
    } else {
      state.combo = 0;
    }

    if (modeConfig.targetLines && state.lines >= modeConfig.targetLines) {
      finish(true, "Цель выполнена. 40 линий очищены.");
      return;
    }

    if (modeConfig.garbageAttacks && state.pieces > 0 && state.pieces % 14 === 0) {
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
    return SCORE_TABLE[Math.min(count, 4)] * state.level;
  }

  function attackLinesForClear(count) {
    if (count < 2) return 0;
    if (count === 2) return 1;
    if (count === 3) return 2;
    return 4;
  }

  function sendAttackForClear(count) {
    const lines = attackLinesForClear(count);
    if (!lines || (!state.online.connected && !state.ai.enabled)) return;
    state.sentGarbage += lines;
    if (state.online.connected) sendAttack(onlineClient, state.online.room, lines);
    if (state.ai.enabled) {
      state.ai.height = Math.max(0, state.ai.height - lines);
      state.ai.attackMs = Math.max(0, state.ai.attackMs - lines * 1200);
    }
    playEvent("attack", { duration: 0.09 });
    burst(12);
    showToast(state.ai.enabled && !state.online.connected ? `Атака AI: +${lines}` : `Атака соперникам: +${lines}`);
  }

  function addScore(value) {
    state.score += value;
    state.stats.bestScore = Math.max(state.stats.bestScore, state.score);
    storage.saveBestScore(state.stats.bestScore);
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
    state.stats.modeCounts = { classic: 0, sprint: 0, relax: 0, chaos: 0, ...state.stats.modeCounts };
    state.stats.modeCounts[state.mode] = (state.stats.modeCounts[state.mode] || 0) + 1;
    state.scores.unshift({
      score: state.score,
      lines: state.lines,
      level: state.level,
      mode: MODES[state.mode].name,
      time: formatTime(state.elapsedMs),
      date: new Date().toLocaleDateString("ru-RU")
    });
    state.scores = state.scores.sort((a, b) => b.score - a.score).slice(0, 10);
    storage.saveStats(state.stats);
    storage.saveScores(state.scores);
    storage.clearSave();
    checkAchievements();
    ui.showGameOver({
      title: won ? "Победа!" : "Игра окончена",
      text,
      score: state.score,
      level: state.level,
      lines: state.lines,
      combo: state.bestComboRun,
      record: state.stats.bestScore,
      insight: gameOverInsight(),
      serverStatus: "Серверный рекорд отправляется..."
    });
    renderCoachTips();
    playEvent(won ? "win" : "gameOver");
    buzz(won ? "win" : "gameOver");
    if (won) burst(50);
    sendOnlineUpdate(true);
    submitServerRecord();
  }

  function pause() {
    if (!state.running || state.gameOver) return;
    state.paused = true;
    saveCurrentGame();
    ui.setPauseVisible(true);
  }

  function resume() {
    if (!state.running || state.gameOver) return;
    state.paused = false;
    state.lastTime = 0;
    ui.setPauseVisible(false);
  }

  function returnToMainMenu() {
    let saved = false;
    if (state.running && !state.gameOver) {
      state.paused = true;
      saveCurrentGame();
      saved = true;
    }
    hideOverlays();
    ui.showOverlay("startOverlay");
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
    const modeConfig = getModeConfig(state.mode);
    const relaxed = modeConfig.relaxed ? PHYSICS.RELAXED_DROP_BONUS_MS : 0;
    return Math.max(PHYSICS.MIN_DROP_INTERVAL_MS, PHYSICS.BASE_DROP_INTERVAL_MS + relaxed - (state.level - 1) * PHYSICS.LEVEL_DROP_STEP_MS - bonus);
  }

  function update(time) {
    if (!state.lastTime) state.lastTime = time;
    const delta = Math.min(TIMING.MAX_FRAME_DELTA_MS, time - state.lastTime);
    state.lastTime = time;

    if (state.running && !state.paused && !state.gameOver) {
      state.elapsedMs += delta;
      state.dropMs += delta;
      if (state.dropMs >= dropInterval()) {
        state.dropMs = 0;
        move(0, 1, false);
      }
      updateLockDelay(delta);
      updateAiOpponent(delta);
    }

    state.flashes = state.flashes
      .map((f) => ({ ...f, life: f.life - delta / UI_CONFIG.FLASH_DECAY_MS, width: Math.min(1, f.width + delta / UI_CONFIG.FLASH_GROW_MS) }))
      .filter((f) => f.life > 0);
    draw();
    syncUi();
    requestAnimationFrame(update);
  }

  function updateAiOpponent(delta) {
    if (!state.ai.enabled) return;
    state.ai.elapsedMs += delta;
    state.ai.attackMs += delta;
    state.ai.score += delta * (0.045 + state.level * 0.004);
    const wave = Math.sin(state.ai.elapsedMs / 5200) * 2;
    state.ai.height = Math.max(2, Math.min(16, Math.round(4 + state.level * 0.35 + state.ai.elapsedMs / 42000 + wave)));
    const attackInterval = Math.max(9000, 21000 - state.level * 520);
    if (state.ai.attackMs >= attackInterval) {
      state.ai.attackMs = 0;
      const lines = state.level >= 7 && Math.random() > 0.55 ? 2 : 1;
      receiveGarbage(lines, state.ai.name);
    }
  }

  function ghostPiece() {
    if (!state.active) return null;
    let ghost = { ...state.active };
    while (valid({ ...ghost, y: ghost.y + 1 })) ghost.y += 1;
    return ghost;
  }

  function draw() {
    ui.renderGame({
      cols: COLS,
      rows: ROWS,
      board: state.board,
      active: state.active ? { kind: state.active.kind, cells: cells(state.active) } : null,
      ghost: state.settings.ghost && state.active ? cells(ghostPiece()) : null,
      queue: state.queue,
      hold: state.hold,
      flashes: state.flashes,
      opponentHeight: opponentHeight()
    }, {
      settings: state.settings,
      shapes: SHAPES,
      palettes: {
        base: COLORS,
        safe: SAFE_COLORS,
        themes: THEME_COLORS
      }
    });
  }

  function syncUi() {
    const modeConfig = getModeConfig(state.mode);
    ui.syncHud({
      score: state.score,
      level: state.level,
      lines: modeConfig.targetLines ? `${state.lines}/${modeConfig.targetLines}` : state.lines,
      record: state.stats.bestScore,
      combo: state.combo,
      pieces: state.pieces,
      time: formatTime(state.elapsedMs),
      apm: actionsPerMinute(),
      height: currentHeight(),
      goal: goalText(),
      progress: progressPercent(),
      rank: rankText(),
      danger: state.settings.danger && topDanger()
    });
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
    const modeConfig = getModeConfig(state.mode);
    if (modeConfig.targetLines) return `${state.lines}/${modeConfig.targetLines} линий`;
    if (modeConfig.relaxed) return modeConfig.goalText;
    if (modeConfig.garbageAttacks) return "Выжить";
    return "Рекорд";
  }

  function progressPercent() {
    const modeConfig = getModeConfig(state.mode);
    if (modeConfig.targetLines) return Math.min(100, Math.round(state.lines / modeConfig.targetLines * 100));
    return Math.min(100, Math.round(state.level / 20 * 100));
  }

  function rankText() {
    if (state.score >= SCORING_THRESHOLDS.LEGEND) return "Легенда";
    if (state.score >= SCORING_THRESHOLDS.MASTER) return "Мастер";
    if (state.score >= SCORING_THRESHOLDS.PRO) return "Профи";
    if (state.score >= SCORING_THRESHOLDS.PLAYER) return "Игрок";
    return "Новичок";
  }

  function openOnline() {
    const form = ui.getOnlineForm();
    ui.setOnlineDefaults({
      server: form.server || defaultServerUrl(),
      room: form.room || storage.loadRoomCode("") || generateRoomCode(),
      name: form.name || storage.loadPlayerName("Игрок")
    });
    ui.showOverlay("onlineOverlay");
    renderOnlinePlayers();
    updateOnlineControls();
    updateLayoutMetrics();
  }

  function ensureRoomCode() {
    const room = normalizeRoomId(ui.getOnlineForm().room || state.online.room) || generateRoomCode();
    ui.setOnlineRoom(room);
    storage.saveRoomCode(room);
    return room;
  }

  function roomInviteUrl(room = ensureRoomCode()) {
    return buildRoomInviteUrl(location, room);
  }

  function shareRoomLink() {
    const room = ensureRoomCode();
    shareText(`Заходи в комнату Тетриса ${room}: ${roomInviteUrl(room)}`);
  }

  function createFriendRoom() {
    const room = generateRoomCode();
    ui.setOnlineRoom(room);
    storage.saveRoomCode(room);
    state.online.room = room;
    const link = roomInviteUrl(room);
    if (location.protocol.startsWith("http")) history.replaceState(null, "", link);
    openOnline();
    shareText(`Заходи в комнату Тетриса ${room}: ${link}`);
    showToast("Ссылка комнаты готова");
  }

  function connectOnline() {
    const { server, name: rawName, maxPlayers, durationSec } = ui.getOnlineForm();
    const room = ensureRoomCode();
    const name = (rawName || "Игрок").slice(0, 18);
    storage.savePlayerName(name);
    storage.saveRoomCode(room);
    ui.setOnlineRoom(room);
    disconnectOnline(false);
    try {
      state.online.room = room;
      state.online.name = name;
      ui.setOnlineStatus("Подключение...");
      openOnlineSocket(onlineClient, { server, room, name, maxPlayers, durationSec });
      state.online.connected = false;
    } catch {
      showToast("Неверный адрес сервера");
    }
  }

  onOnlineMessage(onlineClient, (data) => {
    if (data.type === "open") {
      state.online.connected = true;
      sendOnlineUpdate(true);
      ui.setOnlineStatus(`Комната ${data.room}`);
      if (location.protocol.startsWith("http")) history.replaceState(null, "", roomInviteUrl(data.room));
      updateOnlineControls();
      updateLayoutMetrics();
      showToast(`Онлайн: ${data.room}`);
      return;
    }

    if (data.type === "hello") {
      state.online.id = data.id;
      return;
    }

    if (data.type === "close") {
      state.online.connected = false;
      ui.setOnlineStatus("Отключено");
      renderOnlinePanel();
      updateOnlineControls();
      updateLayoutMetrics();
      return;
    }

    if (data.type === "socketError") {
      ui.setOnlineStatus("Ошибка подключения");
      showToast("Сервер недоступен");
      return;
    }

    if (data.type === "error") {
      ui.setOnlineStatus(data.message || "Ошибка комнаты");
      showToast(data.message || "Ошибка комнаты");
      return;
    }

    if (data.type === "state") {
      state.online.peers = data.players || {};
      state.online.tournament = data.tournament || null;
      renderOnlinePlayers();
      renderOnlinePanel();
      return;
    }

    if (data.type === "attack") {
      receiveGarbage(Number(data.lines) || 0, data.from || "соперника");
      return;
    }

    if (data.type === "tournamentEnd") {
      state.online.tournament = data.tournament || state.online.tournament;
      showTournamentResults(data.players || state.online.peers || {});
    }
  });

  function disconnectOnline(show = true) {
    closeOnlineSocket(onlineClient);
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
    ui.setOnlineButtonState(state.online.connected);
  }

  function sendOnlineUpdate(force = false) {
    if (!state.online.connected) return;
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
      mode: MODES[state.mode].name,
      time: formatTime(state.elapsedMs),
      status: state.gameOver ? (state.won ? "Победа" : "Финиш") : state.paused ? "Пауза" : "Играет",
      force
    });
  }

  function sendOnlineUpdateThrottled() {
    if (performance.now() - state.online.lastSent > 700) sendOnlineUpdate(false);
  }

  function startTournament() {
    if (!state.online.connected) {
      showToast("Сначала подключись к комнате");
      return;
    }
    const { maxPlayers, durationSec } = ui.getOnlineForm();
    sendOnlineMessage(onlineClient, { type: "startTournament", room: state.online.room, maxPlayers, durationSec });
    showToast("Турнир запускается");
    startGame(state.mode, state.difficulty);
  }

  function renderOnlinePlayers() {
    const players = Object.values(state.online.peers || {}).sort((a, b) => b.score - a.score);
    ui.renderOnlinePlayers(players, state.online.tournament, formatTime);
  }

  function renderOnlinePanel() {
    if (state.ai.enabled) {
      ui.renderOnlinePanel({
        connected: true,
        room: "AI",
        tournament: null,
        players: [{
          name: state.ai.name,
          score: Math.round(state.ai.score),
          status: state.settings.language === "en" ? "Training" : "Тренировка"
        }],
        formatTime
      });
      return;
    }
    const players = Object.values(state.online.peers || {}).sort((a, b) => b.score - a.score).slice(0, 4);
    ui.renderOnlinePanel({
      connected: state.online.connected,
      room: state.online.room,
      tournament: state.online.tournament,
      players,
      formatTime
    });
  }

  function showTournamentResults(playersObject) {
    const players = Object.values(playersObject || {}).sort((a, b) => b.score - a.score);
    if (ui.renderTournamentResults(players, state.running && !state.gameOver)) {
      state.running = false;
      state.gameOver = true;
      storage.clearSave();
    }
  }

  function opponentHeight() {
    if (state.ai.enabled) return state.ai.height;
    return Object.values(state.online.peers || {})
      .filter((p) => p.id !== state.online.id && Number.isFinite(Number(p.height)))
      .sort((a, b) => b.score - a.score)[0]?.height || 0;
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
    storage.saveGame({
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
    const save = storage.loadSave(null);
    if (!save) {
      showToast("Сохранения пока нет");
      return;
    }
    Object.assign(state, save, { running: true, paused: false, gameOver: false, won: false, lastTime: 0, dropMs: 0, lockDelayMs: 0, lockResets: 0, flashes: [] });
    state.mode = normalizeModeKey(state.mode);
    state.ai.enabled = false;
    state.sessionHistory = Array.isArray(save.sessionHistory) ? save.sessionHistory : [];
    state.difficulty = "normal";
    state.rng = Math.random;
    hideOverlays();
    updateLayoutMetrics();
    syncUi();
    showToast("Сохранение загружено");
  }

  function renderStats() {
    const modeCounts = { classic: 0, sprint: 0, relax: 0, chaos: 0, ...state.stats.modeCounts };
    const favoriteMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0];
    const averageDuration = state.stats.games ? formatTime((state.stats.totalTime / state.stats.games) * 1000) : "0:00";
    const rank = rankInfo(state.stats.bestScore);
    const statsRows = [
      { label: "Лучший счёт", value: state.stats.bestScore, note: rank.current },
      { label: "Всего игр", value: state.stats.games, note: `${state.stats.totalLines} линий` },
      { label: "Любимый режим", value: favoriteMode?.[1] ? getModeConfig(favoriteMode[0]).name : "-", note: favoriteMode?.[1] ? `${favoriteMode[1]} игр` : "сыграй первую партию" },
      { label: "Средняя длительность", value: averageDuration, note: "за партию" },
      { label: "Прогресс ранга", value: rank.next ? `${rank.progress}%` : "100%", note: rank.next ? `до ${rank.next}` : "максимальный ранг", progress: rank.progress }
    ];

    ui.renderStats({
      statsRows,
      scores: state.scores,
      serverRecords: serverRecordsForUi(),
      achievements: ACHIEVEMENTS.map(([id, title, description]) => ({
        title,
        description,
        unlocked: Boolean(state.unlocked[id])
      }))
    });
  }

  function serverRecordsForUi() {
    return state.serverRecords.slice(0, 10).map((record) => ({
      name: record.name,
      mode: record.mode,
      date: new Date(record.date).toLocaleDateString("ru-RU"),
      score: record.score
    }));
  }

  async function loadServerRecords() {
    if (!location.protocol.startsWith("http")) return;
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      const data = await response.json();
      state.serverRecords = Array.isArray(data.records) ? data.records : [];
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
    } catch {
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
    }
  }

  async function submitServerRecord() {
    if (!location.protocol.startsWith("http") || state.score <= 0) {
      ui.setServerRecordStatus(location.protocol.startsWith("http") ? "" : "Серверные рекорды доступны на онлайн-версии.");
      return;
    }
    try {
      const name = storage.loadPlayerName("Игрок") || state.online.name || "Игрок";
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
      ui.setServerRecordStatus(place >= 0 && place < 10 ? `Серверный топ: место ${place + 1}` : "Результат сохранён на сервере");
    } catch {
      ui.setServerRecordStatus("Офлайн: результат сохранён только на устройстве");
    }
  }

  function gameOverInsight() {
    const holes = countHoles();
    const height = currentHeight();
    const worstPlacement = state.sessionHistory
      .filter((step) => step.clear === 0)
      .sort((a, b) => (b.holesDelta * 4 + b.heightDelta * 2 + b.bumpinessDelta) - (a.holesDelta * 4 + a.heightDelta * 2 + a.bumpinessDelta))[0];
    if (worstPlacement && worstPlacement.holesDelta >= 2) {
      return `<b>Ключевая ошибка: ${worstPlacement.kind}-фигура</b><small>После неё добавилось дыр: +${worstPlacement.holesDelta}. В похожей ситуации лучше играть в край или убрать фигуру в запас.</small>`;
    }
    if (holes >= 7) return `<b>Главная проблема: дыры</b><small>На поле осталось ${holes}. Играй ровнее и не закрывай пустые клетки, особенно S/Z фигурами.</small>`;
    if (height >= 13) return `<b>Главная проблема: высота</b><small>Башня поднялась до ${height}. Держи рабочую зону ниже середины поля и чаще чисти 2+ линии.</small>`;
    if (state.holds < 1 && state.pieces > 10) return `<b>Не использован запас</b><small>Кнопка "Запас" помогает пережить неудобную фигуру и подготовить место под I.</small>`;
    if (state.bestClearInGame < 2 && state.lines >= 4) return `<b>Мало сильных очисток</b><small>Попробуй строить под 2-4 линии. В онлайне это ещё и отправляет мусор сопернику.</small>`;
    return `<b>Хорошая база</b><small>Следующий шаг: заранее смотреть 2-3 фигуры вперёд и держать один ровный колодец сбоку.</small>`;
  }

  function rankInfo(score) {
    const ranks = [
      ["Новичок", 0],
      ["Игрок", 1200],
      ["Профи", 3500],
      ["Мастер", 7000],
      ["Легенда", 12000]
    ];
    let index = 0;
    for (let i = 0; i < ranks.length; i += 1) {
      if (score >= ranks[i][1]) index = i;
    }
    const current = ranks[index][0];
    const next = ranks[index + 1]?.[0] || "";
    if (!next) return { current, next: "", progress: 100 };
    const from = ranks[index][1];
    const to = ranks[index + 1][1];
    return {
      current,
      next,
      progress: Math.round((score - from) / Math.max(1, to - from) * 100)
    };
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
      if (step.bumpinessDelta > 0) parts.push("поверхность стала неровнее");
      tips.push([`Неудачная ${step.kind}-фигура`, `После этой постановки ${parts.join(", ")}. В похожей ситуации лучше играть в край, в колодец или увести фигуру в запас.`]);
    }
    if (holes >= 6) tips.push(["Слишком много дыр", `Под блоками осталось ${holes} пустых клеток. Сначала закрывай низ ровными фигурами, а неудобные S/Z убирай в запас или на край.`]);
    if (bumpiness >= 18) tips.push(["Неровная поверхность", "Поле стало зубчатым. Старайся ставить фигуры так, чтобы соседние столбцы отличались на 1-2 клетки."]);
    if (state.receivedGarbage > 0) tips.push(["Онлайн-давление", `Ты получил ${state.receivedGarbage} мусорных линий. В PvP старайся отвечать очисткой 2+ линий, а не просто выживать.`]);
    if (currentHeight() >= 12) tips.push(["Высокая башня", "Поле стало слишком высоким. Оставляй один ровный колодец сбоку и не закрывай его S/Z фигурами."]);
    if (state.holds < 2 && state.pieces > 12) tips.push(["Запас почти не использовался", "Запас нужен не только для I-фигуры. Убирай туда неудобную фигуру, если она ломает поверхность поля."]);
    if (state.bestComboRun < 2 && state.lines > 3) tips.push(["Мало серий", "После очистки линии попробуй сразу готовить следующую. Даже комбо x2 уже заметно ускоряет набор очков."]);
    if (state.hardDrops < 5 && state.elapsedMs > 60000) tips.push(["Слишком осторожно", "Резкий сброс экономит время. Используй призрачную фигуру, чтобы быстрее принимать решения."]);
    if (state.rotations > state.pieces * 4 && state.pieces > 8) tips.push(["Много лишних поворотов", "Если фигура крутится 4+ раз, ты поздно решил, куда её ставить. Смотри на следующую фигуру заранее."]);
    tips.push(["Следующая цель", state.mode === "sprint" ? "В режиме 40 линий цель не рекорд, а чистое поле и скорость. Не копи слишком высокую башню." : "Попробуй играть через 2-3 линии за раз: это уже включает PvP-атаки и тренирует контроль поля."]);
    ui.renderCoachTips(tips.slice(0, 3));
  }

  function checkAchievements() {
    let changed = false;
    for (const [id, title, , rule] of ACHIEVEMENTS) {
      if (!state.unlocked[id] && rule(state.stats)) {
        state.unlocked[id] = true;
        changed = true;
        showToast(`Достижение: ${title}`);
        playEvent("levelUp", { duration: 0.10 });
      }
    }
    if (changed) storage.saveAchievements(state.unlocked);
  }

  function playEvent(name, overrides = {}) {
    const event = SOUND_EVENTS[name];
    if (!event) return;
    const themed = themedSound(event, overrides);
    playAudioSound(
      audio,
      themed.freq,
      themed.duration,
      themed.type,
      themed.category
    );
  }

  function themedSound(event, overrides = {}) {
    const profile = {
      ember: { freq: 1, duration: 1, type: null },
      day: { freq: 0.94, duration: 0.92, type: "triangle" },
      candy: { freq: 1.14, duration: 1.06, type: "triangle" },
      mono: { freq: 0.8, duration: 0.86, type: "sine" }
    }[state.settings.theme] || {};
    return {
      freq: (overrides.freq ?? event.freq) * (profile.freq || 1),
      duration: (overrides.duration ?? event.duration) * (profile.duration || 1),
      type: overrides.type ?? profile.type ?? event.type,
      category: overrides.category ?? event.category
    };
  }

  function buzz(pattern = "move") {
    if (!state.settings.vibration || !navigator.vibrate) return;
    const value = Array.isArray(pattern) || typeof pattern === "number" ? pattern : HAPTICS[pattern] || HAPTICS.move;
    navigator.vibrate(value);
  }

  function showToast(text) {
    ui.showToast(text);
  }

  function shakeBoard() {
    ui.shakeBoard(state.settings.reducedMotion);
  }

  function burst(count) {
    ui.burst({
      count,
      reducedMotion: state.settings.reducedMotion,
      particles: state.settings.particles,
      colors: Object.values(state.settings.colorBlind ? SAFE_COLORS : COLORS)
    });
  }

  function hideOverlays() {
    ui.hideOverlays();
  }

  function openSettings() {
    ui.openSettings();
  }

  function updateInstallButton() {
    ui.updateInstallButton(Boolean(deferredInstallPrompt));
  }

  async function installApp() {
    if (!deferredInstallPrompt) {
      showToast("Установка доступна на HTTPS-версии");
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch {
      return;
    }
    deferredInstallPrompt = null;
    updateInstallButton();
  }

  let statsReturnOverlay = null;
  const horizontalKeys = new Map();
  const touchState = {
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTime: 0,
    lastTapAt: 0,
    tapTimer: 0,
    softSteps: 0,
    holdTimer: 0,
    moved: false,
    hardDropped: false,
    softDropped: false,
    holdTriggered: false
  };
  const pointerState = {
    active: false,
    pointerId: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTime: 0,
    lastTapAt: 0,
    moved: false,
    hardDropped: false,
    softDropped: false
  };

  function openStats() {
    statsReturnOverlay = ui.getVisiblePrimaryOverlay();
    if (statsReturnOverlay) ui.hideOverlay(statsReturnOverlay);
    renderStats();
    ui.showOverlay("statsOverlay");
    loadServerRecords();
  }

  function closeStats() {
    ui.hideOverlay("statsOverlay");
    if (statsReturnOverlay) ui.showOverlay(statsReturnOverlay);
    statsReturnOverlay = null;
  }

  function changeSetting(key, value) {
    state.settings[key] = value;
    if (key === "volume") {
      state.settings.moveVolume = value;
      state.settings.clearVolume = value;
      state.settings.alertVolume = value;
    }
    applySettings();
    syncUi();
  }

  function clearTouchHold() {
    clearTimeout(touchState.holdTimer);
    touchState.holdTimer = 0;
  }

  function clearPendingTap() {
    clearTimeout(touchState.tapTimer);
    touchState.tapTimer = 0;
  }

  function stopHorizontal(key) {
    const timers = horizontalKeys.get(key);
    if (!timers) return;
    clearTimeout(timers.das);
    clearInterval(timers.arr);
    horizontalKeys.delete(key);
  }

  function clearHorizontalInputs() {
    for (const key of [...horizontalKeys.keys()]) stopHorizontal(key);
  }

  function startHorizontal(key, direction) {
    if (horizontalKeys.has(key)) return;
    stepHorizontal(direction);
    syncUi();
    const timers = { das: 0, arr: 0 };
    timers.das = setTimeout(() => {
      const repeat = () => {
        stepHorizontal(direction);
        syncUi();
      };
      repeat();
      if (state.settings.arrMs === 0) {
        while (stepHorizontal(direction)) {
          continue;
        }
        syncUi();
        return;
      }
      timers.arr = setInterval(repeat, state.settings.arrMs);
    }, state.settings.dasMs);
    horizontalKeys.set(key, timers);
  }

  function handleKeyDown(event) {
    if (shouldIgnoreKeyboardTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "arrowleft" || key === "a") {
      event.preventDefault();
      startHorizontal(key, -1);
    } else if (key === "arrowright" || key === "d") {
      event.preventDefault();
      startHorizontal(key, 1);
    } else if (key === "arrowdown" || key === "s") {
      event.preventDefault();
      softDrop();
      syncUi();
    } else if (key === "arrowup" || key === "w" || key === "x") {
      event.preventDefault();
      rotateClockwise();
      syncUi();
    } else if (key === " " || key === "z") {
      event.preventDefault();
      hardDrop();
      syncUi();
    } else if (key === "c" || key === "h" || key === "e" || key === "shift") {
      event.preventDefault();
      holdPiece();
      syncUi();
    } else if (key === "q") {
      event.preventDefault();
      rotateCounterClockwise();
      syncUi();
    } else if (key === "p" || key === "escape") {
      event.preventDefault();
      togglePause();
      syncUi();
    }
  }

  function handleKeyUp(event) {
    if (shouldIgnoreKeyboardTarget(event.target)) return;
    stopHorizontal(event.key.toLowerCase());
  }

  function shouldIgnoreKeyboardTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function handleTouchStart(event) {
    if (state.settings.controlMode === "buttons") return;
    event.preventDefault();
    const touch = event.changedTouches[0];
    touchState.startX = touch.clientX;
    touchState.startY = touch.clientY;
    touchState.lastX = touchState.startX;
    touchState.lastY = touchState.startY;
    touchState.startTime = performance.now();
    touchState.softSteps = 0;
    touchState.moved = false;
    touchState.hardDropped = false;
    touchState.softDropped = false;
    touchState.holdTriggered = false;
    clearTouchHold();
    touchState.holdTimer = setTimeout(() => {
      if (touchState.moved || touchState.softDropped || touchState.hardDropped || touchState.holdTriggered) return;
      if (!canInput()) return;
      holdPiece();
      touchState.holdTriggered = true;
      buzz("hold");
      syncUi();
    }, 240);
  }

  function handleTouchMove(event) {
    if (state.settings.controlMode === "buttons") return;
    event.preventDefault();
    const touch = event.changedTouches[0];
    const threshold = swipeThresholdForPreset(state.settings.sensitivityPreset);
    const dx = touch.clientX - touchState.lastX;
    const totalDy = touch.clientY - touchState.startY;
    const totalDx = touch.clientX - touchState.startX;
    if (Math.abs(totalDx) > threshold * 0.4 || Math.abs(totalDy) > threshold * 0.4) {
      touchState.moved = true;
      clearTouchHold();
      clearPendingTap();
    }

    if (Math.abs(dx) >= threshold * 0.88 && Math.abs(totalDx) > Math.abs(totalDy) * 0.7) {
      const steps = Math.max(1, Math.min(3, Math.floor(Math.abs(dx) / threshold)));
      let moved = false;
      for (let i = 0; i < steps; i += 1) moved = stepHorizontal(dx < 0 ? -1 : 1) || moved;
      touchState.lastX = touch.clientX;
      if (moved) syncUi();
      return;
    }

    if (totalDy > threshold && totalDy > Math.abs(totalDx) * 1.04) {
      const targetSteps = Math.max(1, Math.min(6, Math.floor(totalDy / threshold)));
      const pendingSteps = targetSteps - touchState.softSteps;
      if (pendingSteps > 0) {
        for (let i = 0; i < pendingSteps; i += 1) softDrop();
        touchState.softSteps = targetSteps;
        touchState.softDropped = true;
        syncUi();
      }
    }
    touchState.lastY = touch.clientY;
  }

  function handleTouchEnd(event) {
    if (state.settings.controlMode === "buttons") return;
    event.preventDefault();
    clearTouchHold();
    if (touchState.holdTriggered) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchState.startX;
    const dy = touch.clientY - touchState.startY;
    const threshold = swipeThresholdForPreset(state.settings.sensitivityPreset);
    const elapsedMs = performance.now() - touchState.startTime;
    const gesture = gestureProfile({ dx, dy, elapsedMs, threshold });

    if (gesture.shouldHardDrop && !touchState.hardDropped) {
      hardDrop();
      touchState.hardDropped = true;
      clearPendingTap();
      syncUi();
      return;
    }

    if (gesture.direction && !touchState.softDropped) {
      const steps = Math.max(1, Math.min(6, Math.round(Math.abs(dx) / threshold)));
      let moved = false;
      for (let i = 0; i < steps; i += 1) moved = stepHorizontal(gesture.direction === "left" ? -1 : 1) || moved;
      clearPendingTap();
      if (moved) syncUi();
      return;
    }

    if (gesture.isTap && !touchState.moved && !touchState.softDropped) {
      const now = performance.now();
      if (now - touchState.lastTapAt <= 260) {
        clearPendingTap();
        rotateCounterClockwise();
        touchState.lastTapAt = 0;
      } else {
        clearPendingTap();
        touchState.tapTimer = setTimeout(() => {
          rotateClockwise();
          syncUi();
          touchState.lastTapAt = 0;
          touchState.tapTimer = 0;
        }, 165);
        touchState.lastTapAt = now;
      }
      return;
    }

    if (gesture.shouldSoftDrop && !touchState.softDropped) {
      const steps = Math.max(1, Math.min(4, Math.round(dy / threshold)));
      for (let i = 0; i < steps; i += 1) softDrop();
      touchState.softDropped = true;
      clearPendingTap();
      syncUi();
    }
  }

  function handleTouchCancel(event) {
    if (state.settings.controlMode === "buttons") return;
    event.preventDefault();
    clearTouchHold();
    clearPendingTap();
  }

  function handlePointerStart(event) {
    if (state.settings.controlMode === "buttons" || event.pointerType === "touch") return;
    if (event.button === 2) {
      event.preventDefault();
      holdPiece();
      syncUi();
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    pointerState.active = true;
    pointerState.pointerId = event.pointerId;
    pointerState.startX = event.clientX;
    pointerState.startY = event.clientY;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    pointerState.startTime = performance.now();
    pointerState.moved = false;
    pointerState.hardDropped = false;
    pointerState.softDropped = false;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!pointerState.active || event.pointerId !== pointerState.pointerId) return;
    event.preventDefault();
    const threshold = swipeThresholdForPreset(state.settings.sensitivityPreset);
    const dx = event.clientX - pointerState.lastX;
    const totalDx = event.clientX - pointerState.startX;
    const totalDy = event.clientY - pointerState.startY;
    if (Math.abs(totalDx) > threshold * 0.45 || Math.abs(totalDy) > threshold * 0.45) pointerState.moved = true;

    if (Math.abs(dx) >= threshold && Math.abs(totalDx) > Math.abs(totalDy) * 0.75) {
      const steps = Math.max(1, Math.min(4, Math.floor(Math.abs(dx) / threshold)));
      let moved = false;
      for (let i = 0; i < steps; i += 1) moved = stepHorizontal(dx < 0 ? -1 : 1) || moved;
      pointerState.lastX = event.clientX;
      if (moved) syncUi();
      return;
    }

    if (totalDy > threshold * 1.25 && totalDy > Math.abs(totalDx) * 1.1) {
      softDrop();
      pointerState.softDropped = true;
      pointerState.lastY = event.clientY;
      syncUi();
    }
  }

  function handlePointerEnd(event) {
    if (!pointerState.active || event.pointerId !== pointerState.pointerId) return;
    event.preventDefault();
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    pointerState.active = false;
    const dx = event.clientX - pointerState.startX;
    const dy = event.clientY - pointerState.startY;
    const threshold = swipeThresholdForPreset(state.settings.sensitivityPreset);
    const elapsedMs = performance.now() - pointerState.startTime;
    const gesture = gestureProfile({ dx, dy, elapsedMs, threshold });

    if (gesture.shouldHardDrop && !pointerState.hardDropped) {
      hardDrop();
      pointerState.hardDropped = true;
      syncUi();
      return;
    }

    if (gesture.direction && !pointerState.softDropped) {
      const steps = Math.max(1, Math.min(6, Math.round(Math.abs(dx) / threshold)));
      let moved = false;
      for (let i = 0; i < steps; i += 1) moved = stepHorizontal(gesture.direction === "left" ? -1 : 1) || moved;
      if (moved) syncUi();
      return;
    }

    if (gesture.isTap && !pointerState.moved && !pointerState.softDropped) {
      const now = performance.now();
      if (now - pointerState.lastTapAt <= 280) {
        rotateCounterClockwise();
        pointerState.lastTapAt = 0;
      } else {
        rotateClockwise();
        pointerState.lastTapAt = now;
      }
      syncUi();
      return;
    }

    if (gesture.shouldSoftDrop && !pointerState.softDropped) {
      softDrop();
      syncUi();
    }
  }

  function handlePointerCancel(event) {
    if (event.pointerId !== pointerState.pointerId) return;
    pointerState.active = false;
  }

  function handlePointerContextMenu(event) {
    event.preventDefault();
  }

  function bindUi() {
    ui.bindControls({
      startGame: () => startGame(),
      startAiGame: () => { startAiGame(); syncUi(); },
      loadCurrentGame: () => { loadCurrentGame(); syncUi(); },
      playWithFriend: () => { createFriendRoom(); syncUi(); },
      openSettings: () => { openSettings(); syncUi(); },
      installApp,
      openStats: () => { openStats(); syncUi(); },
      openHelp: () => { ui.showOverlay("helpOverlay"); syncUi(); },
      closeHelp: () => { ui.hideOverlay("helpOverlay"); syncUi(); },
      openTutorial: () => { ui.hideOverlay("helpOverlay"); ui.showOverlay("tutorialOverlay"); syncUi(); },
      closeTutorial: () => { ui.hideOverlay("tutorialOverlay"); syncUi(); },
      startTutorialGame: () => { ui.hideOverlay("tutorialOverlay"); startGame("classic", "normal"); showToast("Тренировка началась"); syncUi(); },
      closeCoach: () => { ui.hideOverlay("coachOverlay"); syncUi(); },
      openOnline: () => { openOnline(); syncUi(); },
      toggleOnlineConnection: () => { toggleOnlineConnection(); syncUi(); },
      shareRoomLink,
      startTournament: () => { startTournament(); syncUi(); },
      closeOnline: () => { ui.hideOverlay("onlineOverlay"); syncUi(); },
      closeTournament: () => { ui.hideOverlay("tournamentOverlay"); syncUi(); },
      rematch: () => { startTournament(); syncUi(); },
      resume: () => { resume(); syncUi(); },
      playAgain: () => startGame(state.mode, state.difficulty),
      togglePause: () => { togglePause(); syncUi(); },
      returnToMainMenu,
      restartGame: () => startGame(state.mode, state.difficulty),
      closeSettings: () => { ui.hideOverlay("settingsOverlay"); syncUi(); },
      closeStats: () => { closeStats(); syncUi(); },
      shareStats: () => shareText(statsText()),
      openCoach: () => { ui.showOverlay("coachOverlay"); syncUi(); },
      shareResult: () => shareText(resultText()),
      holdPiece: () => { holdPiece(); syncUi(); },
      moveLeft: () => { stepHorizontal(-1); syncUi(); },
      moveRight: () => { stepHorizontal(1); syncUi(); },
      softDrop: () => { softDrop(); syncUi(); },
      rotate: () => { rotateClockwise(); syncUi(); },
      hardDrop: () => { hardDrop(); syncUi(); },
      changeSetting
    });

    state.layoutObserver = ui.bindWindowEvents({
      visibilityChange: () => {
        if (state.settings.autoPause && document.hidden && state.running && !state.paused) pause();
      },
      offline: () => showToast("Офлайн: одиночная игра доступна"),
      online: () => {
        showToast("Сеть вернулась");
        loadServerRecords();
      },
      beforeUnload: saveCurrentGame,
      resize: () => {
        updateLayoutMetrics();
        draw();
      },
      resizeObserver: () => updateLayoutMetrics(),
      keydown: handleKeyDown,
      keyup: handleKeyUp,
      blur: () => {
        clearHorizontalInputs();
        clearTouchHold();
        clearPendingTap();
      }
    });

    ui.bindBoardTouch({
      touchstart: handleTouchStart,
      touchmove: handleTouchMove,
      touchend: handleTouchEnd,
      touchcancel: handleTouchCancel
    });
    ui.bindBoardPointer({
      pointerdown: handlePointerStart,
      pointermove: handlePointerMove,
      pointerup: handlePointerEnd,
      pointercancel: handlePointerCancel,
      contextmenu: handlePointerContextMenu
    });
  }

  function bootPwa() {
    const canUsePwa = "serviceWorker" in navigator && (window.isSecureContext || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
    if (canUsePwa) {
      navigator.serviceWorker.register("sw.js").then(() => {
        showToast("Офлайн-кэш готовится");
      }).catch(() => undefined);
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
    if (mode && MODES[normalizeModeKey(mode)]) ui.setStartMode(normalizeModeKey(mode));
    const room = roomFromLocation(location);
    if (room) {
      ui.setOnlineRoom(room);
      storage.saveRoomCode(room);
      setTimeout(openOnline, 0);
    }
  }

  bindUi();
  applyUrlParams();
  applySettings();
  syncUi();
  draw();
  bootPwa();
  loadServerRecords();
  requestAnimationFrame(update);
})();
