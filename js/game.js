import {
  SOUND_EVENTS,
  initAudio,
  makeAudioSettings,
  playSound as playAudioSound,
  setVolume,
  toggleMute,
} from "./audio.js";
import {
  COLS,
  FLOW_STATE,
  PHYSICS,
  PROGRESSION,
  ROWS,
  SHAPES,
  SRS_KICKS,
  TIMING,
  UI as UI_CONFIG,
} from "./config.js";
import {
  gestureProfile,
  normalizeControls,
  swipeThresholdForPreset,
} from "./input.js";
import { GAME_MODES, getModeConfig, normalizeModeKey } from "./modes.js";
import {
  createOnlineClient,
  roomFromLocation,
  sendAttack,
  sendOnlineMessage,
} from "./online.js";
import { createOnlineController } from "./online-controller.js";
import { advanceFrameClock, decayFlashes } from "./runtime-loop.js";
import {
  addPositiveScore,
  rankInfo,
  rankTextForScore,
  resultBadgeForGame,
  resultHighlightsForGame,
} from "./scoring.js";
import {
  countHoles as boardCountHoles,
  currentHeight as boardCurrentHeight,
  surfaceBumpiness as boardSurfaceBumpiness,
  topDanger as boardTopDanger,
} from "./scene-state.js";
import { applySaveSnapshot, buildSavePayload } from "./save-load.js";
import { createGameStorage } from "./storage.js";
import { createUi } from "./ui.js";
import {
  buildClearEvent,
  createBag,
  detectTSpinType,
  isBoardEmpty,
  makeBoard,
} from "./game-core.js";
import {
  isAiSession as sessionIsAi,
  isOnlineSession as sessionIsOnline,
  makeSessionState,
} from "./session-state.js";
import { getGhostOverlayHeight, localDateKey } from "./utils.js";

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
    ghostRun: "blockdrop-ghost-run-v1",
    lastRoom: "tetris-last-room",
    playerName: "blockdrop-player-name",
    rankedPlayerId: "blockdrop-ranked-player-id-v1",
  };

  const COLORS = {
    I: "#21d3f5",
    O: "#ffd166",
    T: "#9b6cff",
    S: "#22d699",
    Z: "#ff6b6b",
    J: "#4f78ff",
    L: "#ff9a3d",
    X: "#dfe6ee",
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
      X: "#4f5f67",
    },
    candy: {
      I: "#5ce1ff",
      O: "#ffdf6e",
      T: "#c084fc",
      S: "#66f2b9",
      Z: "#ff7aa8",
      J: "#7ca7ff",
      L: "#ffb45f",
      X: "#fff4cc",
    },
    mono: {
      I: "#d9d0bd",
      O: "#b8d8c8",
      T: "#a9b0aa",
      S: "#8dd3c7",
      Z: "#c6a99c",
      J: "#9fb8b1",
      L: "#d6c28f",
      X: "#eeeeee",
    },
  };

  const SAFE_COLORS = {
    I: "#00b4d8",
    O: "#f9c74f",
    T: "#577590",
    S: "#43aa8b",
    Z: "#f94144",
    J: "#277da1",
    L: "#f8961e",
    X: "#dfe6ee",
  };

  const MODES = GAME_MODES;

  const DIFFICULTY = {
    easy: { name: "Лёгкая", startLevel: 1, speedBonus: -80, garbage: 0 },
    normal: { name: "Нормальная", startLevel: 1, speedBonus: 0, garbage: 0 },
    hard: { name: "Сложная", startLevel: 4, speedBonus: 40, garbage: 2 },
    expert: { name: "Эксперт", startLevel: 7, speedBonus: 80, garbage: 4 },
  };

  const AI_DIFFICULTY = {
    easy: {
      name: "Лёгкий",
      scoreRate: 0.68,
      heightRate: 0.72,
      attackRate: 1.35,
      doubleChance: 0.08,
    },
    normal: {
      name: "Нормальный",
      scoreRate: 1,
      heightRate: 1,
      attackRate: 1,
      doubleChance: 0.22,
    },
    hard: {
      name: "Сильный",
      scoreRate: 1.35,
      heightRate: 1.18,
      attackRate: 0.78,
      doubleChance: 0.38,
    },
    insane: {
      name: "Безумный",
      scoreRate: 1.75,
      heightRate: 1.36,
      attackRate: 0.58,
      doubleChance: 0.58,
    },
  };

  const AI_STYLE = {
    balanced: { name: "Баланс", score: 1, height: 1, attack: 1, burst: 1 },
    aggressive: {
      name: "Атака",
      score: 1.08,
      height: 1.08,
      attack: 0.78,
      burst: 1.25,
    },
    defensive: {
      name: "Защита",
      score: 0.94,
      height: 0.82,
      attack: 1.18,
      burst: 0.75,
    },
  };

  const AI_PACE = {
    calm: { name: "Спокойный", score: 0.86, attack: 1.22 },
    fair: { name: "Ровный", score: 1, attack: 1 },
    fast: { name: "Быстрый", score: 1.16, attack: 0.84 },
  };

  const ACHIEVEMENTS = [
    [
      "firstLine",
      "Первый шаг",
      "Очистить первую линию",
      (s) => s.totalLines >= 1,
    ],
    [
      "tenLines",
      "Разогрев",
      "Очистить 10 линий за всё время",
      (s) => s.totalLines >= 10,
    ],
    [
      "hundredLines",
      "Мастер поля",
      "Очистить 100 линий за всё время",
      (s) => s.totalLines >= 100,
    ],
    ["score1000", "Тысяча", "Набрать 1000 очков", (s) => s.bestScore >= 1000],
    [
      "score5000",
      "Пять тысяч",
      "Набрать 5000 очков",
      (s) => s.bestScore >= 5000,
    ],
    ["combo3", "Комбо x3", "Сделать комбо 3", (s) => s.bestCombo >= 3],
    [
      "tetris",
      "Четыре сразу",
      "Очистить 4 линии одним ходом",
      (s) => s.bestClear >= 4,
    ],
    [
      "sprinter",
      "Спринтер",
      "Закончить режим 40 линий",
      (s) => s.sprintWins >= 1,
    ],
    ["survivor", "Выживший", "Дойти до 10 уровня", (s) => s.bestLevel >= 10],
    [
      "collector",
      "Коллекционер",
      "Поставить 300 фигур",
      (s) => s.totalPieces >= 300,
    ],
    [
      "hardDropper",
      "Без тормозов",
      "Сделать 100 резких сбросов",
      (s) => s.totalHardDrops >= 100,
    ],
    [
      "keeper",
      "Запасливый",
      "Использовать запас 50 раз",
      (s) => s.totalHolds >= 50,
    ],
    [
      "spinner",
      "Вертушка",
      "Повернуть фигуры 250 раз",
      (s) => s.totalRotations >= 250,
    ],
    [
      "patient",
      "Долгая партия",
      "Сыграть 10 минут суммарно",
      (s) => s.totalTime >= 600,
    ],
    [
      "chaosFan",
      "Друг хаоса",
      "Сыграть 5 партий в режиме Хаос",
      (s) => s.chaosGames >= 5,
    ],
    [
      "relaxFan",
      "Спокойный ход",
      "Сыграть 5 партий в режиме Дзен",
      (s) => s.relaxGames >= 5,
    ],
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
    gameOver: [12, 30, 14],
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
    backToBackChain: 0,
    bestBackToBackRun: 0,
    pieces: 0,
    hardDrops: 0,
    incomingGarbage: 0,
    receivedGarbage: 0,
    sentGarbage: 0,
    phase: FLOW_STATE.MENU,
    survivalStreak: 0,
    lastStreakMs: 0,
    holds: 0,
    rotations: 0,
    moves: 0,
    softDrops: 0,
    bestClearInGame: 0,
    tSpinCount: 0,
    tSpinMiniCount: 0,
    perfectClearCount: 0,
    bestMomentEvent: null,
    lastRotation: null,
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
      mode: "classic",
      name: "",
      ranked: false,
      rating: 1000,
      rankedResult: null,
      series: null,
      peers: {},
      tournament: null,
      lastSent: 0,
    },
    ai: {
      enabled: false,
      difficulty: "normal",
      score: 0,
      height: 0,
      elapsedMs: 0,
      attackMs: 0,
      name: "AI",
    },
    ghostRun: storage.loadGhostRun(null),
    currentGhostRun: [],
    lastGhostSampleMs: 0,
    previousBestScore: 0,
    daily: null,
    ghostReplay: false,
    session: {
      type: "solo",
      source: "local",
      room: "",
      ranked: false,
      matchId: "",
    },
  };

  const audio = initAudio(() => state.settings);

  function ensureAudio() {
    audio.player.resume();
  }

  function setSession(next = {}) {
    state.session = makeSessionState(next);
  }

  function isOnlineSession() {
    return sessionIsOnline(state);
  }

  function isAiSession() {
    return sessionIsAi(state);
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
      aiDifficulty: "normal",
      aiStyle: "balanced",
      aiPace: "fair",
      lastMode: "classic",
      muted: false,
      ...makeAudioSettings(),
      ...storage.loadSettings({}),
    };
  }

  function loadStats() {
    const defaults = {
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
      totalTetrises: 0,
      totalTSpins: 0,
      totalTSpinMinis: 0,
      totalPerfectClears: 0,
      totalBackToBackClears: 0,
      bestBackToBack: 0,
      totalSentGarbage: 0,
      totalReceivedGarbage: 0,
      modeCounts: {
        classic: 0,
        sprint: 0,
        hardcore: 0,
        timeAttack: 0,
        relax: 0,
        chaos: 0,
      },
      daily: { date: "", score: 0, lines: 0 },
      pieceCounts: { I: 0, O: 0, T: 0, S: 0, Z: 0, J: 0, L: 0 },
    };
    const saved = storage.loadStats({});
    return {
      ...defaults,
      ...saved,
      modeCounts: {
        ...defaults.modeCounts,
        ...(saved.modeCounts || {}),
      },
      daily: {
        ...defaults.daily,
        ...(saved.daily || {}),
      },
      pieceCounts: {
        ...defaults.pieceCounts,
        ...(saved.pieceCounts || {}),
      },
    };
  }

  function applySettings() {
    Object.assign(state.settings, normalizeControls(state.settings));
    state.settings.grid = true;
    state.settings.danger = true;
    state.settings.performanceMode = ["auto", "battery", "quality"].includes(
      state.settings.performanceMode,
    )
      ? state.settings.performanceMode
      : "auto";
    state.settings.particles = state.settings.performanceMode !== "battery";
    state.settings.colorBlind = false;
    state.settings.ghost = true;
    state.settings.bigButtons = false;
    state.settings.autoPause = true;
    state.settings.reducedMotion = state.settings.performanceMode === "battery";
    state.settings.language = ["ru", "en"].includes(state.settings.language)
      ? state.settings.language
      : "ru";
    state.settings.aiDifficulty = AI_DIFFICULTY[state.settings.aiDifficulty]
      ? state.settings.aiDifficulty
      : "normal";
    state.settings.aiStyle = AI_STYLE[state.settings.aiStyle]
      ? state.settings.aiStyle
      : "balanced";
    state.settings.aiPace = AI_PACE[state.settings.aiPace]
      ? state.settings.aiPace
      : "fair";
    state.settings.lastMode = MODES[normalizeModeKey(state.settings.lastMode)]
      ? normalizeModeKey(state.settings.lastMode)
      : "classic";
    state.settings.volume = clamp(Number(state.settings.volume) || 0, 0, 100);
    state.settings.muted = Boolean(state.settings.muted);
    state.settings.moveVolume = state.settings.volume;
    state.settings.clearVolume = state.settings.volume;
    state.settings.alertVolume = state.settings.volume;
    setVolume(audio, state.settings.volume);
    state.settings.sound = state.settings.volume > 0 && !state.settings.muted;
    toggleMute(audio, state.settings.muted || !state.settings.sound);
    ui.applySettings(state.settings);
    storage.saveSettings(state.settings);
    updateLayoutMetrics();
  }

  function updateLayoutMetrics() {
    ui.updateLayoutMetrics({
      cols: COLS,
      rows: ROWS,
      onlineConnected: state.online.connected,
    });
  }

  function refillBag() {
    state.bag.push(...createBag(random));
  }

  function random() {
    return state.rng ? state.rng() : Math.random();
  }

  function seededRandom(seedText) {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i += 1) {
      seed ^= seedText.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    return () => {
      seed += 0x6d2b79f5;
      let value = seed;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function takeKind() {
    if (state.bag.length === 0) refillBag();
    return state.bag.shift();
  }

  function fillQueue() {
    while (state.queue.length < 3) state.queue.push(makePieceDraft(takeKind()));
  }

  function makePieceDraft(kind) {
    return { kind };
  }

  function normalizePieceDraft(value) {
    if (typeof value === "string") return { kind: value };
    return {
      kind: value?.kind || "T",
    };
  }

  function makePiece(draft) {
    const normalized = normalizePieceDraft(draft);
    return { ...normalized, rotation: 0, x: 3, y: 0 };
  }

  function cells(piece) {
    return SHAPES[piece.kind][piece.rotation].map(([x, y]) => ({
      x: piece.x + x,
      y: piece.y + y,
    }));
  }

  function valid(piece) {
    for (const c of cells(piece)) {
      if (c.x < 0 || c.x >= COLS || c.y < 0 || c.y >= ROWS) return false;
      if (state.board[c.y][c.x]) return false;
    }
    return true;
  }

  function startGame(
    mode = ui.getStartMode(),
    difficulty = "normal",
    options = {},
  ) {
    const session = makeSessionState(
      options.session || (options.ai ? { type: "ai" } : { type: "solo" }),
    );
    if (session.type !== "online" && state.online.connected) {
      disconnectOnline(false);
    }
    difficulty = "normal";
    mode = normalizeModeKey(mode);
    const modeConfig = getModeConfig(mode);
    state.settings.lastMode = mode;
    storage.saveSettings(state.settings);
    state.board = makeBoard();
    state.active = null;
    state.queue = [];
    state.bag = [];
    state.hold = null;
    state.holdUsed = false;
    state.rng = options.seed ? seededRandom(options.seed) : Math.random;
    state.mode = mode;
    state.difficulty = difficulty;
    state.score = 0;
    state.lines = 0;
    state.level = Math.max(
      modeConfig.startLevel,
      DIFFICULTY[difficulty].startLevel,
    );
    state.combo = 0;
    state.bestComboRun = 0;
    state.backToBackChain = 0;
    state.bestBackToBackRun = 0;
    state.pieces = 0;
    state.hardDrops = 0;
    state.incomingGarbage = 0;
    state.receivedGarbage = 0;
    state.sentGarbage = 0;
    state.phase = FLOW_STATE.PLAYING;
    state.survivalStreak = 0;
    state.lastStreakMs = 0;
    state.currentGhostRun = [];
    state.lastGhostSampleMs = 0;
    state.previousBestScore = state.stats.bestScore;
    state.holds = 0;
    state.rotations = 0;
    state.moves = 0;
    state.softDrops = 0;
    state.bestClearInGame = 0;
    state.tSpinCount = 0;
    state.tSpinMiniCount = 0;
    state.perfectClearCount = 0;
    state.bestMomentEvent = null;
    state.lastRotation = null;
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
    state.ai.enabled = session.type === "ai";
    state.ai.difficulty = options.aiDifficulty || state.settings.aiDifficulty;
    state.ai.score = 0;
    state.ai.height = 0;
    state.ai.elapsedMs = 0;
    state.ai.attackMs = 0;
    state.ai.name =
      state.settings.language === "en"
        ? `AI ${state.settings.aiStyle}/${state.settings.aiPace}`
        : `Бот ${AI_DIFFICULTY[state.ai.difficulty].name} · ${AI_STYLE[state.settings.aiStyle].name}`;
    state.daily = options.daily
      ? { date: localDateKey(), seed: options.seed }
      : null;
    state.ghostReplay = Boolean(options.ghostReplay);
    setSession({
      ...session,
      room: session.room || state.online.room,
      ranked: session.ranked || state.online.ranked,
      matchId: session.matchId || options.seed || "",
    });
    hideOverlays();
    fillQueue();
    addGarbage(DIFFICULTY[difficulty].garbage);
    if (modeConfig.garbageAttacks) addGarbage(4);
    if (mode === "hardcore") addGarbage(2);
    spawn();
    ensureAudio();
    buzz("move");
    syncUi();
    saveCurrentGame();
  }

  function startAiGame() {
    startGame(ui.getStartMode(), "normal", {
      ai: true,
      session: { type: "ai", source: "ai" },
      aiDifficulty: state.settings.aiDifficulty,
    });
    showToast(
      state.settings.language === "en"
        ? "AI opponent joined"
        : `AI: ${AI_DIFFICULTY[state.settings.aiDifficulty].name}`,
    );
  }

  function startDailyChallenge() {
    const key = localDateKey();
    startGame("classic", "normal", { daily: true, seed: `daily:${key}` });
    showToast(onlineText(`Испытание дня ${key}`, `Daily challenge ${key}`));
  }

  function spawn() {
    fillQueue();
    state.active = makePiece(state.queue.shift());
    fillQueue();
    state.holdUsed = false;
    state.lastRotation = null;
    state.lockDelayMs = 0;
    state.lockResets = 0;
    if (!valid(state.active)) finish(false, "Башня дошла до верхней границы.");
  }

  function addGarbage(count) {
    for (let i = 0; i < count; i += 1) {
      const hole = Math.floor(random() * COLS);
      state.board.shift();
      state.board.push(
        Array.from({ length: COLS }, (_, x) => (x === hole ? null : "X")),
      );
    }
    if (state.active && !valid(state.active))
      finish(false, "Соперники вытолкнули башню мусорными линиями.");
  }

  function receiveGarbage(count, from = "соперника") {
    if (!state.running || state.gameOver || count <= 0) return;
    state.incomingGarbage += count;
    state.receivedGarbage += count;
    state.stats.totalReceivedGarbage += count;
    resetStreak();
    addGarbage(count);
    shakeBoard();
    playEvent("attack");
    buzz("attack");
    showToast(`Атака от ${from}: +${count}`);
    if (isOnlineSession()) sendOnlineUpdate(true);
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
    const candidate = {
      ...state.active,
      x: state.active.x + dx,
      y: state.active.y + dy,
    };
    if (!valid(candidate)) return false;
    state.active = candidate;
    if (dx !== 0) state.lastRotation = null;
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
    const kicks =
      state.active.kind === "O"
        ? [[0, 0]]
        : (state.active.kind === "I" ? SRS_KICKS.I : SRS_KICKS.normal)[
            `${from}>${to}`
          ] || [[0, 0]];
    for (const [kickIndex, [dx, dy]] of kicks.entries()) {
      const candidate = { ...rotated, x: rotated.x + dx, y: rotated.y + dy };
      if (valid(candidate)) {
        state.active = candidate;
        state.lastRotation = {
          active: true,
          from,
          to,
          direction: normalizedDirection,
          kickIndex,
          usedKick: kickIndex > 0,
        };
        resetLockDelayIfGrounded();
        state.rotations += 1;
        state.stats.totalRotations += 1;
        playEvent(
          "rotate",
          normalizedDirection < 0
            ? { freq: SOUND_EVENTS.rotate.freq - 50 }
            : {},
        );
        buzz("rotate");
        return true;
      }
    }
    return false;
  }

  function softDrop() {
    if (!move(0, PHYSICS.SOFT_DROP_SPEED, true))
      updateLockDelay(TIMING.SOFT_DROP_LOCK_MS);
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
    const current = {
      kind: state.active.kind,
    };
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
    state.lastRotation = null;
    playEvent("hold");
  }

  function lock() {
    if (!state.active) return;
    const modeConfig = getModeConfig(state.mode);
    const lockedPiece = { ...state.active };
    const lockedKind = lockedPiece.kind;
    const beforeMetrics = {
      holes: countHoles(),
      height: currentHeight(),
      bumpiness: surfaceBumpiness(),
    };
    for (const c of cells(lockedPiece))
      state.board[c.y][c.x] = {
        kind: lockedPiece.kind,
      };
    state.stats.pieceCounts[lockedPiece.kind] += 1;
    state.pieces += 1;
    state.stats.totalPieces += 1;
    const tSpinType = detectTSpinType(state.board, lockedPiece, state.lastRotation);
    state.active = null;
    const count = clearLines();
    const perfectClear = count > 0 && isBoardEmpty(state.board);
    const combo = count > 0 ? state.combo + 1 : 0;
    const clearEvent = buildClearEvent({
      lines: count,
      level: state.level,
      combo,
      perfectClear,
      backToBackActive: state.backToBackChain > 0,
      tSpinType,
      streakBonus: count > 0 ? streakScoreBonus() : 0,
    });
    const afterMetrics = {
      holes: countHoles(),
      height: currentHeight(),
      bumpiness: surfaceBumpiness(),
    };
    state.sessionHistory.push({
      kind: lockedKind,
      clear: count,
      special: clearEvent.tSpinType,
      perfectClear: clearEvent.perfectClear,
      backToBack: clearEvent.backToBack,
      attack: clearEvent.attackLines,
      score: clearEvent.score,
      holesDelta: afterMetrics.holes - beforeMetrics.holes,
      heightDelta: afterMetrics.height - beforeMetrics.height,
      bumpinessDelta: afterMetrics.bumpiness - beforeMetrics.bumpiness,
    });
    if (state.sessionHistory.length > 60) state.sessionHistory.shift();
    if (clearEvent.score > 0) addScore(clearEvent.score);
    if (clearEvent.isTSpin) {
      state.tSpinCount += 1;
      state.stats.totalTSpins += 1;
    } else if (clearEvent.isMini) {
      state.tSpinMiniCount += 1;
      state.stats.totalTSpinMinis += 1;
    }
    if (clearEvent.perfectClear) {
      state.perfectClearCount += 1;
      state.stats.totalPerfectClears += 1;
    }
    if (!clearEvent.isTSpin && !clearEvent.isMini && count === 4) {
      state.stats.totalTetrises += 1;
    }
    if (clearEvent.backToBackEligible) {
      state.backToBackChain = clearEvent.backToBack
        ? state.backToBackChain + 1
        : 1;
      state.bestBackToBackRun = Math.max(
        state.bestBackToBackRun,
        state.backToBackChain,
      );
      state.stats.bestBackToBack = Math.max(
        state.stats.bestBackToBack,
        state.bestBackToBackRun,
      );
      if (clearEvent.backToBack) state.stats.totalBackToBackClears += 1;
    } else if (count > 0) {
      state.backToBackChain = 0;
    }
    rememberBestMoment(clearEvent);
    if (count > 0) {
      const previousLevel = state.level;
      state.combo = combo;
      state.bestComboRun = Math.max(state.bestComboRun, state.combo);
      state.bestClearInGame = Math.max(state.bestClearInGame, count);
      state.lines += count;
      state.level = modeConfig.relaxed
        ? modeConfig.startLevel
        : Math.min(
            20,
            Math.floor(state.lines / modeConfig.levelUp) +
              modeConfig.startLevel +
              DIFFICULTY[state.difficulty].startLevel -
              1,
          );
      playEvent(clearEvent.isTSpin || count === 4 ? "tetris" : "line");
      if (clearEvent.isTSpin || count === 4 || clearEvent.perfectClear) burst(44);
      if (state.combo >= 2)
        playEvent("combo", {
          freq: SOUND_EVENTS.combo.freq + state.combo * 18,
        });
      if (state.level > previousLevel) {
        showToast(`Уровень ${state.level}`);
        playEvent("levelUp");
        burst(26);
      }
      buzz(clearEvent.isTSpin || count === 4 ? "tetris" : "clear");
      showToast(formatClearEventToast(clearEvent));
      sendAttackForEvent(clearEvent);
      burst(clearEvent.isTSpin || count === 4 ? 34 : 18);
      shakeBoard();
    } else {
      state.combo = 0;
      if (clearEvent.isTSpin || clearEvent.isMini) {
        playEvent("line");
        buzz("clear");
        showToast(formatClearEventToast(clearEvent));
      }
    }
    state.lastRotation = null;
    if (modeConfig.targetLines && state.lines >= modeConfig.targetLines) {
      finish(true, `${modeConfig.goalText} выполнено.`);
      return;
    }

    if (
      modeConfig.garbageAttacks &&
      state.pieces > 0 &&
      state.pieces % 14 === 0
    ) {
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
    while (state.board.length < ROWS)
      state.board.unshift(Array(COLS).fill(null));
    return rows.length;
  }

  function sendAttackForEvent(event) {
    const lines = Number(event?.attackLines) || 0;
    if (!lines || (!isOnlineSession() && !isAiSession())) return;
    state.sentGarbage += lines;
    state.stats.totalSentGarbage += lines;
    if (isOnlineSession())
      sendAttack(onlineClient, state.online.room, lines);
    if (isAiSession()) {
      state.ai.height = Math.max(0, state.ai.height - lines);
      state.ai.attackMs = Math.max(0, state.ai.attackMs - lines * 1200);
    }
    playEvent("attack", { duration: 0.09 });
    burst(12);
  }

  function addScore(value) {
    state.score = addPositiveScore(state.score, value);
    state.stats.bestScore = Math.max(state.stats.bestScore, state.score);
    storage.saveBestScore(state.stats.bestScore);
    if (value >= 50) ui.pulseScore?.();
  }

  function streakScoreBonus() {
    return Math.min(
      PROGRESSION.MAX_STREAK_SCORE_BONUS,
      state.survivalStreak * 8,
    );
  }

  function resetStreak() {
    state.survivalStreak = 0;
    state.lastStreakMs = state.elapsedMs;
  }

  function rewardSurvivalStreak() {
    if (!state.running || state.paused || state.gameOver || topDanger()) return;
    if (
      state.elapsedMs - state.lastStreakMs <
      PROGRESSION.SURVIVAL_STREAK_STEP_MS
    )
      return;
    state.lastStreakMs = state.elapsedMs;
    state.survivalStreak += 1;
    addScore(PROGRESSION.SURVIVAL_STREAK_SCORE * state.survivalStreak);
    if (state.survivalStreak > 1) {
      playEvent("combo", {
        freq: SOUND_EVENTS.combo.freq + state.survivalStreak * 10,
        duration: 0.055,
      });
      if (state.survivalStreak % 3 === 0) burst(10);
    }
  }

  function lineClearLabel(lines) {
    const labels = {
      2: onlineText("Дабл", "Double"),
      3: onlineText("Трипл", "Triple"),
      4: "Tetris",
    };
    return labels[lines] || "";
  }

  function clearEventLabel(event) {
    if (!event) return "";
    if (event.isTSpin) {
      return event.lines === 0
        ? "T-Spin"
        : `T-Spin ${lineClearLabel(event.lines)}`;
    }
    if (event.isMini) {
      return event.lines === 0
        ? "T-Spin Mini"
        : `T-Spin Mini ${lineClearLabel(event.lines)}`;
    }
    return lineClearLabel(event.lines);
  }

  function clearEventRank(event) {
    if (!event) return 0;
    return (
      (event.perfectClear ? 1000 : 0) +
      (event.isTSpin ? 700 : 0) +
      (event.isMini ? 500 : 0) +
      (event.lines === 4 ? 350 : 0) +
      Math.max(0, event.lines) * 20 +
      Math.max(0, event.combo) +
      Math.max(0, event.attackLines || 0)
    );
  }

  function rememberBestMoment(event) {
    if (!event || clearEventRank(event) <= 0) return;
    if (
      !state.bestMomentEvent ||
      clearEventRank(event) > clearEventRank(state.bestMomentEvent)
    ) {
      state.bestMomentEvent = { ...event };
    }
  }

  function formatClearEventToast(event) {
    const parts = [];
    const label = clearEventLabel(event);
    if (label) parts.push(label);
    if (event?.backToBack) parts.push("B2B");
    if (event?.perfectClear) parts.push("Perfect Clear");
    if ((event?.combo || 0) >= 2) {
      parts.push(onlineText(`Комбо x${event.combo}`, `Combo x${event.combo}`));
    }
    if (!parts.length && event?.attackLines) {
      parts.push(
        onlineText(`Атака +${event.attackLines}`, `Attack +${event.attackLines}`),
      );
    }
    return parts.join(" • ");
  }

  function bestMomentLabel() {
    if (state.bestMomentEvent) return formatClearEventToast(state.bestMomentEvent);
    if (state.bestComboRun >= 2) {
      return onlineText(
        `Комбо x${state.bestComboRun}`,
        `Combo x${state.bestComboRun}`,
      );
    }
    return lineClearLabel(state.bestClearInGame);
  }

  function resultBadge(won) {
    return resultBadgeForGame({
      won,
      mode: state.mode,
      daily: state.daily,
      bestClearInGame: state.bestClearInGame,
      bestComboRun: state.bestComboRun,
      bestBackToBackRun: state.bestBackToBackRun,
      totalTSpins: state.tSpinCount,
      totalPerfectClears: state.perfectClearCount,
      holes: countHoles(),
      score: state.score,
      bestScore: state.stats.bestScore,
      language: state.settings.language,
    });
  }

  function resultHighlights() {
    const modeConfig = getModeConfig(state.mode);
    return resultHighlightsForGame({
      modeName:
        state.settings.language === "en" ? modeConfig.nameEn : modeConfig.name,
      dailyLabel: state.daily
        ? `${state.stats.daily?.score || state.score} · ${state.daily.date}`
        : "—",
      bestClearInGame: state.bestClearInGame,
      bestComboRun: state.bestComboRun,
      bestMoment: bestMomentLabel(),
      bestBackToBackRun: state.bestBackToBackRun,
      totalPerfectClears: state.perfectClearCount,
      apm: actionsPerMinute(),
      language: state.settings.language,
    });
  }

  function finish(won, text, options = {}) {
    const { reportOnline = true } = options;
    state.running = false;
    state.gameOver = true;
    state.phase = FLOW_STATE.GAME_OVER;
    state.won = won;
    state.stats.games += 1;
    state.stats.totalScore += state.score;
    state.stats.totalLines += state.lines;
    state.stats.totalTime += Math.floor(state.elapsedMs / 1000);
    state.stats.bestLevel = Math.max(state.stats.bestLevel, state.level);
    state.stats.bestCombo = Math.max(state.stats.bestCombo, state.bestComboRun);
    state.stats.bestClear = Math.max(
      state.stats.bestClear,
      state.bestClearInGame,
    );
    state.stats.bestBackToBack = Math.max(
      state.stats.bestBackToBack,
      state.bestBackToBackRun,
    );
    if (won) state.stats.modeWins += 1;
    if (won && state.mode === "sprint") state.stats.sprintWins += 1;
    if (state.mode === "chaos") state.stats.chaosGames += 1;
    if (state.mode === "relax") state.stats.relaxGames += 1;
    if (state.daily) {
      const currentDaily = state.stats.daily || {
        date: "",
        score: 0,
        lines: 0,
      };
      if (
        currentDaily.date !== state.daily.date ||
        state.score > currentDaily.score
      ) {
        state.stats.daily = {
          date: state.daily.date,
          score: state.score,
          lines: state.lines,
        };
      }
    }
    saveGhostRunIfBest();
    state.stats.modeCounts = {
      classic: 0,
      sprint: 0,
      hardcore: 0,
      timeAttack: 0,
      relax: 0,
      chaos: 0,
      ...state.stats.modeCounts,
    };
    state.stats.modeCounts[state.mode] =
      (state.stats.modeCounts[state.mode] || 0) + 1;
    state.scores.unshift({
      score: state.score,
      lines: state.lines,
      level: state.level,
      mode: MODES[state.mode].name,
      time: formatTime(state.elapsedMs),
      date: new Date().toLocaleDateString("ru-RU"),
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
      badge: resultBadge(won),
      highlights: resultHighlights(),
      insight: gameOverInsight(),
      serverStatus: "Серверный рекорд отправляется...",
    });
    renderCoachTips();
    playEvent(won ? "win" : "gameOver");
    buzz(won ? "win" : "gameOver");
    shakeBoard();
    if (won) burst(50);
    sendOnlineUpdate(true);
    if (reportOnline) sendOnlineMatchResult(won);
    submitServerRecord();
  }

  function sendOnlineMatchResult(won) {
    if (
      !isOnlineSession() ||
      !state.online.connected ||
      onlineClient.role === "spectator"
    )
      return;
    sendOnlineMessage(onlineClient, {
      type: "matchOver",
      room: state.online.room,
      result: won ? "win" : "loss",
    });
  }

  function pause() {
    if (!state.running || state.gameOver) return;
    state.paused = true;
    state.phase = FLOW_STATE.PAUSED;
    saveCurrentGame();
    ui.setPauseVisible(true);
  }

  function resume() {
    if (!state.running || state.gameOver) return;
    state.paused = false;
    state.phase = FLOW_STATE.PLAYING;
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
    state.phase = FLOW_STATE.MENU;
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
    const timeSteps = Math.floor(
      state.elapsedMs / PROGRESSION.TIME_SPEED_STEP_MS,
    );
    const timePressure = Math.min(
      PROGRESSION.TIME_SPEED_MAX_DROP_MS,
      timeSteps * PROGRESSION.TIME_SPEED_STEP_DROP_MS,
    );
    const modeMultiplier = modeConfig.speedMultiplier || 1;
    return Math.max(
      PHYSICS.MIN_DROP_INTERVAL_MS,
      (PHYSICS.BASE_DROP_INTERVAL_MS +
        relaxed -
        (state.level - 1) * PHYSICS.LEVEL_DROP_STEP_MS -
        bonus -
        timePressure) /
        modeMultiplier,
    );
  }

  function update(time) {
    const delta = advanceFrameClock(state, time, TIMING.MAX_FRAME_DELTA_MS);

    if (state.running && !state.paused && !state.gameOver) {
      state.elapsedMs += delta;
      const modeConfig = getModeConfig(state.mode);
      if (
        modeConfig.timeLimit &&
        state.elapsedMs >= modeConfig.timeLimit * 1000
      ) {
        finish(true, "Время вышло. Результат сохранён.");
        draw();
        syncUi();
        requestAnimationFrame(update);
        return;
      }
      state.dropMs += delta;
      if (state.dropMs >= dropInterval()) {
        state.dropMs = 0;
        move(0, 1, false);
      }
      updateLockDelay(delta);
      updateAiOpponent(delta);
      rewardSurvivalStreak(delta);
      recordGhostSample();
    }

    state.flashes = decayFlashes(state.flashes, delta, UI_CONFIG);
    draw();
    syncUi();
    requestAnimationFrame(update);
  }

  function updateAiOpponent(delta) {
    if (!state.ai.enabled) return;
    const ai = AI_DIFFICULTY[state.ai.difficulty] || AI_DIFFICULTY.normal;
    const style = AI_STYLE[state.settings.aiStyle] || AI_STYLE.balanced;
    const pace = AI_PACE[state.settings.aiPace] || AI_PACE.fair;
    state.ai.elapsedMs += delta;
    state.ai.attackMs += delta;
    state.ai.score +=
      delta *
      (0.045 + state.level * 0.004) *
      ai.scoreRate *
      style.score *
      pace.score;
    const wave = Math.sin(state.ai.elapsedMs / 5200) * 2;
    state.ai.height = Math.max(
      2,
      Math.min(
        18,
        Math.round(
          4 +
            state.level * 0.35 * ai.heightRate * style.height +
            state.ai.elapsedMs / (42000 / ai.heightRate) +
            wave,
        ),
      ),
    );
    const attackInterval = Math.max(
      6500,
      (21000 - state.level * 520) * ai.attackRate * style.attack * pace.attack,
    );
    if (state.ai.attackMs >= attackInterval) {
      state.ai.attackMs = 0;
      const lines =
        state.level >= 7 && Math.random() < ai.doubleChance * style.burst
          ? 2
          : 1;
      receiveGarbage(lines, state.ai.name);
    }
  }

  function recordGhostSample() {
    if (state.elapsedMs - state.lastGhostSampleMs < 2000) return;
    state.lastGhostSampleMs = state.elapsedMs;
    state.currentGhostRun.push({
      time: Math.floor(state.elapsedMs),
      score: state.score,
      height: currentHeight(),
      lines: state.lines,
    });
    if (state.currentGhostRun.length > 240) state.currentGhostRun.shift();
  }

  function saveGhostRunIfBest() {
    if (
      state.score < state.previousBestScore ||
      state.currentGhostRun.length < 3
    )
      return;
    state.ghostRun = {
      score: state.score,
      mode: state.mode,
      date: new Date().toISOString(),
      summary: {
        tSpins: state.tSpinCount,
        tSpinMinis: state.tSpinMiniCount,
        perfectClears: state.perfectClearCount,
        bestBackToBack: state.bestBackToBackRun,
        bestMoment: bestMomentLabel(),
      },
      samples: state.currentGhostRun,
    };
    storage.saveGhostRun(state.ghostRun);
  }

  function ghostRunHeight() {
    return getGhostOverlayHeight({
      ghostRun: state.ghostRun,
      mode: state.mode,
      running: state.running,
      ghostReplay: state.ghostReplay,
      elapsedMs: state.elapsedMs,
    });
  }

  function ghostPiece() {
    if (!state.active) return null;
    let ghost = { ...state.active };
    while (valid({ ...ghost, y: ghost.y + 1 })) ghost.y += 1;
    return ghost;
  }

  function draw() {
    ui.renderGame(
      {
        cols: COLS,
        rows: ROWS,
        board: state.board,
        active: state.active
          ? {
              kind: state.active.kind,
              cells: cells(state.active),
            }
          : null,
        ghost:
          state.settings.ghost && state.active ? cells(ghostPiece()) : null,
        queue: state.queue,
        hold: state.hold,
        flashes: state.flashes,
        opponentHeight: opponentHeight(),
      },
      {
        settings: state.settings,
        shapes: SHAPES,
        palettes: {
          base: COLORS,
          safe: SAFE_COLORS,
          themes: THEME_COLORS,
        },
      },
    );
  }

  function syncUi() {
    const modeConfig = getModeConfig(state.mode);
    ui.syncHud({
      score: state.score,
      level: state.level,
      lines: modeConfig.targetLines
        ? `${state.lines}/${modeConfig.targetLines}`
        : state.lines,
      record: state.stats.bestScore,
      combo: state.combo,
      streak: state.survivalStreak,
      pieces: state.pieces,
      time: formatTime(state.elapsedMs),
      apm: actionsPerMinute(),
      height: currentHeight(),
      goal: goalText(),
      progress: progressPercent(),
      rank: localizedRank(rankTextForScore(state.score)),
      danger: state.settings.danger && topDanger(),
    });
    ui.renderMenuRecords({
      bestScore: state.stats.bestScore,
      lastGame: state.scores[0],
      sprintBest:
        state.scores.find((entry) => entry.mode === MODES.sprint.name)?.score ||
        0,
      dailyBest:
        state.stats.daily?.date === localDateKey()
          ? state.stats.daily.score
          : 0,
      serverTop: state.serverRecords[0],
    });
    renderOnlinePanel();
    sendOnlineUpdateThrottled();
  }

  function localizedRank(rank) {
    if (state.settings.language !== "en") return rank;
    return (
      {
        Новичок: "Rookie",
        Игрок: "Player",
        Профи: "Pro",
        Мастер: "Master",
        Легенда: "Legend",
      }[rank] || rank
    );
  }

  function actionsPerMinute() {
    const minutes = Math.max(1 / 60, state.elapsedMs / 60000);
    return Math.round(
      (state.moves +
        state.rotations +
        state.hardDrops +
        state.holds +
        state.softDrops) /
        minutes,
    );
  }

  function currentHeight() {
    return boardCurrentHeight(state.board);
  }

  function buildBoardPreview() {
    const previewRows = 15;
    const preview = state.board.slice(-previewRows).map((row) =>
      row.map((cell) => (cell ? 1 : 0)),
    );
    if (state.active) {
      for (const cell of cells(state.active)) {
        const previewY = cell.y - (ROWS - previewRows);
        if (
          previewY >= 0 &&
          previewY < preview.length &&
          cell.x >= 0 &&
          cell.x < COLS
        ) {
          preview[previewY][cell.x] = 1;
        }
      }
    }
    return preview;
  }

  function countHoles() {
    return boardCountHoles(state.board);
  }

  function surfaceBumpiness() {
    return boardSurfaceBumpiness(state.board);
  }

  function goalText() {
    const modeConfig = getModeConfig(state.mode);
    if (modeConfig.targetLines)
      return onlineText(
        `${state.lines}/${modeConfig.targetLines} линий`,
        `${state.lines}/${modeConfig.targetLines} lines`,
      );
    if (modeConfig.timeLimit)
      return formatTime(
        Math.max(0, modeConfig.timeLimit * 1000 - state.elapsedMs),
      );
    if (modeConfig.relaxed)
      return state.settings.language === "en"
        ? modeConfig.goalTextEn
        : modeConfig.goalText;
    if (state.mode === "hardcore") return "Hardcore";
    if (modeConfig.garbageAttacks) return onlineText("Выжить", "Survive");
    return onlineText("Рекорд", "High score");
  }

  function progressPercent() {
    const modeConfig = getModeConfig(state.mode);
    if (modeConfig.targetLines)
      return Math.min(
        100,
        Math.round((state.lines / modeConfig.targetLines) * 100),
      );
    if (modeConfig.timeLimit)
      return Math.min(
        100,
        Math.round((state.elapsedMs / (modeConfig.timeLimit * 1000)) * 100),
      );
    return Math.min(100, Math.round((state.level / 20) * 100));
  }

  function onlineText(ru, en) {
    return state.settings.language === "en" ? en : ru;
  }

  function defaultPlayerName() {
    return onlineText("Игрок", "Player");
  }

  const onlineController = createOnlineController({
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
    modeName: () => MODES[state.mode].name,
    buildBoardPreview,
  });
  const {
    openOnline,
    shareRoomLink,
    copyRoomLink,
    createFriendRoom,
    disconnectOnline,
    toggleOnlineConnection,
    startOnlineGame,
    startTournament,
    requestRematch,
    renderOnlinePanel,
    sendOnlineUpdate,
    sendOnlineUpdateThrottled,
  } = onlineController;

  function opponentHeight() {
    if (isAiSession()) return state.ai.height;
    if (!isOnlineSession()) return ghostRunHeight();
    const peerHeight = Object.values(state.online.peers || {})
      .filter(
        (p) => p.id !== state.online.id && Number.isFinite(Number(p.height)),
      )
      .sort((a, b) => b.score - a.score)[0]?.height;
    return peerHeight || ghostRunHeight();
  }

  function topDanger() {
    return boardTopDanger(state.board);
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const min = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, "0");
    return `${min}:${sec}`;
  }

  function saveCurrentGame() {
    if (!state.running || state.gameOver || isOnlineSession()) return;
    storage.saveGame(buildSavePayload(state));
  }

  function loadCurrentGame() {
    const save = storage.loadSave(null);
    if (!save) {
      showToast(onlineText("Сохранения пока нет", "No saved game yet"));
      return;
    }
    if (state.online.connected) disconnectOnline(false);
    applySaveSnapshot(state, save, FLOW_STATE.PLAYING);
    state.mode = normalizeModeKey(state.mode);
    state.ai.enabled = false;
    state.ghostReplay = false;
    state.difficulty = "normal";
    state.rng = Math.random;
    setSession({ type: "solo", source: "save" });
    hideOverlays();
    updateLayoutMetrics();
    syncUi();
    showToast(onlineText("Сохранение загружено", "Save loaded"));
  }

  function renderStats() {
    const modeCounts = {
      classic: 0,
      sprint: 0,
      hardcore: 0,
      timeAttack: 0,
      relax: 0,
      chaos: 0,
      ...state.stats.modeCounts,
    };
    const favoriteMode = Object.entries(modeCounts).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const averageDuration = state.stats.games
      ? formatTime((state.stats.totalTime / state.stats.games) * 1000)
      : "0:00";
    const rank = rankInfo(state.stats.bestScore);
    const statsRows = [
      {
        label: onlineText("Лучший счёт", "Best score"),
        value: state.stats.bestScore,
        note: rank.current,
      },
      {
        label: onlineText("Всего игр", "Total games"),
        value: state.stats.games,
        note: onlineText(
          `${state.stats.totalLines} линий`,
          `${state.stats.totalLines} lines`,
        ),
      },
      {
        label: onlineText("Любимый режим", "Favorite mode"),
        value: favoriteMode?.[1]
          ? state.settings.language === "en"
            ? getModeConfig(favoriteMode[0]).nameEn
            : getModeConfig(favoriteMode[0]).name
          : "-",
        note: favoriteMode?.[1]
          ? onlineText(`${favoriteMode[1]} игр`, `${favoriteMode[1]} games`)
          : onlineText("сыграй первую партию", "play your first game"),
      },
      {
        label: onlineText("Средняя длительность", "Average duration"),
        value: averageDuration,
        note: onlineText("за партию", "per game"),
      },
      {
        label: onlineText("Прогресс ранга", "Rank progress"),
        value: rank.next ? `${rank.progress}%` : "100%",
        note: rank.next
          ? onlineText(`до ${rank.next}`, `to ${rank.next}`)
          : onlineText("максимальный ранг", "max rank"),
        progress: rank.progress,
      },
      {
        label: onlineText("Спецприёмы", "Special clears"),
        value: onlineText(
          `T ${state.stats.totalTSpins} / PC ${state.stats.totalPerfectClears}`,
          `T ${state.stats.totalTSpins} / PC ${state.stats.totalPerfectClears}`,
        ),
        note: onlineText(
          `мини ${state.stats.totalTSpinMinis}`,
          `mini ${state.stats.totalTSpinMinis}`,
        ),
      },
      {
        label: onlineText("PvP-давление", "PvP pressure"),
        value: onlineText(
          `+${state.stats.totalSentGarbage}`,
          `+${state.stats.totalSentGarbage}`,
        ),
        note: onlineText(
          `B2B x${state.stats.bestBackToBack}`,
          `B2B x${state.stats.bestBackToBack}`,
        ),
      },
    ];

    ui.renderStats({
      statsRows,
      scores: state.scores,
      serverRecords: serverRecordsForUi(),
      achievements: ACHIEVEMENTS.map(([id, title, description]) => ({
        title,
        description,
        unlocked: Boolean(state.unlocked[id]),
      })),
    });
  }

  function serverRecordsForUi() {
    return state.serverRecords.slice(0, 10).map((record) => ({
      name: record.name,
      mode: record.mode,
      date: new Date(record.date).toLocaleDateString(
        state.settings.language === "en" ? "en-US" : "ru-RU",
      ),
      score: record.score,
    }));
  }

  async function loadServerRecords() {
    if (!location.protocol.startsWith("http")) return;
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      const data = await response.json();
      state.serverRecords = Array.isArray(data.records) ? data.records : [];
      syncUi();
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
    } catch {
      syncUi();
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
    }
  }

  async function submitServerRecord() {
    const modeConfig = getModeConfig(state.mode);
    if (
      !location.protocol.startsWith("http") ||
      state.score <= 0 ||
      modeConfig.relaxed
    ) {
      ui.setServerRecordStatus(
        location.protocol.startsWith("http")
          ? ""
          : "Серверные рекорды доступны на онлайн-версии.",
      );
      return;
    }
    try {
      const name =
        storage.loadPlayerName("Игрок") || state.online.name || "Игрок";
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          score: state.score,
          lines: state.lines,
          level: state.level,
          mode: MODES[state.mode].name,
          time: formatTime(state.elapsedMs),
        }),
      });
      const data = await response.json();
      state.serverRecords = Array.isArray(data.records) ? data.records : [];
      const place = state.serverRecords.findIndex(
        (record) =>
          record.score === state.score &&
          record.lines === state.lines &&
          record.time === formatTime(state.elapsedMs),
      );
      ui.setServerRecordStatus(
        place >= 0 && place < 10
          ? `Серверный топ: место ${place + 1}`
          : "Результат сохранён на сервере",
      );
    } catch {
      ui.setServerRecordStatus(
        "Офлайн: результат сохранён только на устройстве",
      );
    }
  }

  function gameOverInsight() {
    const holes = countHoles();
    const height = currentHeight();
    const worstPlacement = state.sessionHistory
      .filter((step) => step.clear === 0)
      .sort(
        (a, b) =>
          b.holesDelta * 4 +
          b.heightDelta * 2 +
          b.bumpinessDelta -
          (a.holesDelta * 4 + a.heightDelta * 2 + a.bumpinessDelta),
      )[0];
    if (worstPlacement && worstPlacement.holesDelta >= 2) {
      return `<b>Ключевая ошибка: ${worstPlacement.kind}-фигура</b><small>После неё добавилось дыр: +${worstPlacement.holesDelta}. В похожей ситуации лучше играть в край или убрать фигуру в запас.</small>`;
    }
    if (holes >= 7)
      return `<b>Главная проблема: дыры</b><small>На поле осталось ${holes}. Играй ровнее и не закрывай пустые клетки, особенно S/Z фигурами.</small>`;
    if (height >= 13)
      return `<b>Главная проблема: высота</b><small>Башня поднялась до ${height}. Держи рабочую зону ниже середины поля и чаще чисти 2+ линии.</small>`;
    if (state.holds < 1 && state.pieces > 10)
      return `<b>Не использован запас</b><small>Кнопка "Запас" помогает пережить неудобную фигуру и подготовить место под I.</small>`;
    if (state.bestClearInGame < 2 && state.lines >= 4)
      return `<b>Мало сильных очисток</b><small>Попробуй строить под 2-4 линии. В онлайне это ещё и отправляет мусор сопернику.</small>`;
    return `<b>Хорошая база</b><small>Следующий шаг: заранее смотреть 2-3 фигуры вперёд и держать один ровный колодец сбоку.</small>`;
  }

  async function shareText(text) {
    try {
      if (navigator.share) {
        await navigator.share({ title: "BlockDrop", text });
      } else {
        await copyTextToClipboard(
          text,
          onlineText("Текст скопирован", "Text copied"),
          onlineText("Не удалось поделиться", "Share failed"),
        );
      }
    } catch {
      showToast(onlineText("Не удалось поделиться", "Share failed"));
    }
  }

  async function copyTextToClipboard(text, successMessage, failureMessage) {
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("copy command failed");
      }
      showToast(successMessage);
      return true;
    } catch {
      showToast(failureMessage);
      return false;
    }
  }

  function resultText() {
    const modeName =
      state.settings.language === "en"
        ? MODES[state.mode].nameEn
        : MODES[state.mode].name;
    return onlineText(
      `BlockDrop: ${state.score} очков, ${state.lines} линий, уровень ${state.level}, режим ${modeName}. Лучший момент: ${bestMomentLabel() || "—"}.`,
      `BlockDrop: ${state.score} points, ${state.lines} lines, level ${state.level}, mode ${modeName}. Best moment: ${bestMomentLabel() || "—"}.`,
    );
  }

  function statsText() {
    return onlineText(
      `Моя статистика в BlockDrop: рекорд ${state.stats.bestScore}, линий ${state.stats.totalLines}, игр ${state.stats.games}, T-Spin ${state.stats.totalTSpins}, Perfect Clear ${state.stats.totalPerfectClears}.`,
      `My BlockDrop stats: best ${state.stats.bestScore}, lines ${state.stats.totalLines}, games ${state.stats.games}, T-Spin ${state.stats.totalTSpins}, Perfect Clear ${state.stats.totalPerfectClears}.`,
    );
  }

  function renderCoachTips() {
    const tips = [];
    const holes = countHoles();
    const bumpiness = surfaceBumpiness();
    const badPlacements = state.sessionHistory
      .filter(
        (step) =>
          step.clear === 0 &&
          (step.holesDelta > 1 ||
            step.heightDelta > 1 ||
            step.bumpinessDelta > 3),
      )
      .sort(
        (a, b) =>
          b.holesDelta * 4 +
          b.heightDelta * 2 +
          b.bumpinessDelta -
          (a.holesDelta * 4 + a.heightDelta * 2 + a.bumpinessDelta),
      )
      .slice(0, 2);
    for (const step of badPlacements) {
      const parts = [];
      if (step.holesDelta > 0)
        parts.push(`дыр стало больше на ${step.holesDelta}`);
      if (step.heightDelta > 0)
        parts.push(`высота выросла на ${step.heightDelta}`);
      if (step.bumpinessDelta > 0) parts.push("поверхность стала неровнее");
      tips.push([
        `Неудачная ${step.kind}-фигура`,
        `После этой постановки ${parts.join(", ")}. В похожей ситуации лучше играть в край, в колодец или увести фигуру в запас.`,
      ]);
    }
    if (holes >= 6)
      tips.push([
        "Слишком много дыр",
        `Под блоками осталось ${holes} пустых клеток. Сначала закрывай низ ровными фигурами, а неудобные S/Z убирай в запас или на край.`,
      ]);
    if (bumpiness >= 18)
      tips.push([
        "Неровная поверхность",
        "Поле стало зубчатым. Старайся ставить фигуры так, чтобы соседние столбцы отличались на 1-2 клетки.",
      ]);
    if (state.receivedGarbage > 0)
      tips.push([
        "Онлайн-давление",
        `Ты получил ${state.receivedGarbage} мусорных линий. В PvP старайся отвечать очисткой 2+ линий, а не просто выживать.`,
      ]);
    if (currentHeight() >= 12)
      tips.push([
        "Высокая башня",
        "Поле стало слишком высоким. Оставляй один ровный колодец сбоку и не закрывай его S/Z фигурами.",
      ]);
    if (state.holds < 2 && state.pieces > 12)
      tips.push([
        "Запас почти не использовался",
        "Запас нужен не только для I-фигуры. Убирай туда неудобную фигуру, если она ломает поверхность поля.",
      ]);
    if (state.bestComboRun < 2 && state.lines > 3)
      tips.push([
        "Мало серий",
        "После очистки линии попробуй сразу готовить следующую. Даже комбо x2 уже заметно ускоряет набор очков.",
      ]);
    if (state.lines >= 8 && state.tSpinCount === 0)
      tips.push([
        "Нет T-Spin давления",
        "Ты уже держишь поле под контролем, но не ищешь T-слоты. Даже один T-Spin Double заметно усиливает и скоринг, и PvP-атаку.",
      ]);
    if (state.bestBackToBackRun < 2 && state.bestClearInGame >= 4)
      tips.push([
        "Обрывается B2B",
        "После Tetris старайся не сбрасывать темп одиночными линиями. Следующий сильный клир подряд теперь даёт дополнительную атаку.",
      ]);
    if (state.hardDrops < 5 && state.elapsedMs > 60000)
      tips.push([
        "Слишком осторожно",
        "Резкий сброс экономит время. Используй призрачную фигуру, чтобы быстрее принимать решения.",
      ]);
    if (state.rotations > state.pieces * 4 && state.pieces > 8)
      tips.push([
        "Много лишних поворотов",
        "Если фигура крутится 4+ раз, ты поздно решил, куда её ставить. Смотри на следующую фигуру заранее.",
      ]);
    tips.push([
      "Следующая цель",
      state.mode === "sprint"
        ? "В режиме 40 линий цель не рекорд, а чистое поле и скорость. Не копи слишком высокую башню."
        : "Попробуй играть через 2-3 линии за раз: это уже включает PvP-атаки и тренирует контроль поля.",
    ]);
    ui.renderCoachTips(tips.slice(0, 3));
  }

  function checkAchievements() {
    let changed = false;
    for (const [id, title, , rule] of ACHIEVEMENTS) {
      if (!state.unlocked[id] && rule(state.stats)) {
        state.unlocked[id] = true;
        changed = true;
        showToast(`Достижение: ${title}`);
        playEvent("levelUp", { duration: 0.1 });
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
      themed.category,
    );
  }

  function themedSound(event, overrides = {}) {
    const profile =
      {
        ember: { freq: 1, duration: 1, type: null },
        day: { freq: 0.94, duration: 0.92, type: "triangle" },
        candy: { freq: 1.14, duration: 1.06, type: "triangle" },
        mono: { freq: 0.8, duration: 0.86, type: "sine" },
      }[state.settings.theme] || {};
    return {
      freq: (overrides.freq ?? event.freq) * (profile.freq || 1),
      duration:
        (overrides.duration ?? event.duration) * (profile.duration || 1),
      type: overrides.type ?? profile.type ?? event.type,
      category: overrides.category ?? event.category,
    };
  }

  function buzz(pattern = "move") {
    if (!state.settings.vibration || !navigator.vibrate) return;
    const value =
      Array.isArray(pattern) || typeof pattern === "number"
        ? pattern
        : HAPTICS[pattern] || HAPTICS.move;
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
      colors: Object.values(state.settings.colorBlind ? SAFE_COLORS : COLORS),
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
    holdTriggered: false,
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
    softDropped: false,
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

  function openReplay() {
    ui.renderReplay(state.ghostRun, formatTime);
  }

  function closeReplay() {
    ui.hideOverlay("replayOverlay");
    syncUi();
  }

  function startGhostRun() {
    if (!state.ghostRun?.mode) {
      showToast("Сначала поставь локальный рекорд");
      return;
    }
    ui.hideOverlay("replayOverlay");
    startGame(state.ghostRun.mode, "normal", { ghostReplay: true });
    showToast("Призрак лучшей партии включён");
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

  function toggleSoundMute() {
    state.settings.muted = !state.settings.muted;
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
    const code = event.code;
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
    } else if (
      key === "c" ||
      code === "KeyC" ||
      key === "h" ||
      code === "KeyH" ||
      key === "e" ||
      code === "KeyE" ||
      key === "shift"
    ) {
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
    return (
      target.isContentEditable ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT"
    );
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
      if (
        touchState.moved ||
        touchState.softDropped ||
        touchState.hardDropped ||
        touchState.holdTriggered
      )
        return;
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
    if (
      Math.abs(totalDx) > threshold * 0.4 ||
      Math.abs(totalDy) > threshold * 0.4
    ) {
      touchState.moved = true;
      clearTouchHold();
      clearPendingTap();
    }

    if (
      Math.abs(dx) >= threshold * 0.88 &&
      Math.abs(totalDx) > Math.abs(totalDy) * 0.7
    ) {
      const steps = Math.max(
        1,
        Math.min(3, Math.floor(Math.abs(dx) / threshold)),
      );
      let moved = false;
      for (let i = 0; i < steps; i += 1)
        moved = stepHorizontal(dx < 0 ? -1 : 1) || moved;
      touchState.lastX = touch.clientX;
      if (moved) syncUi();
      return;
    }

    if (totalDy > threshold && totalDy > Math.abs(totalDx) * 1.04) {
      const targetSteps = Math.max(
        1,
        Math.min(6, Math.floor(totalDy / threshold)),
      );
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
      const steps = Math.max(
        1,
        Math.min(6, Math.round(Math.abs(dx) / threshold)),
      );
      let moved = false;
      for (let i = 0; i < steps; i += 1)
        moved = stepHorizontal(gesture.direction === "left" ? -1 : 1) || moved;
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
    if (
      state.settings.controlMode === "buttons" ||
      event.pointerType === "touch"
    )
      return;
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
    if (!pointerState.active || event.pointerId !== pointerState.pointerId)
      return;
    event.preventDefault();
    const threshold = swipeThresholdForPreset(state.settings.sensitivityPreset);
    const dx = event.clientX - pointerState.lastX;
    const totalDx = event.clientX - pointerState.startX;
    const totalDy = event.clientY - pointerState.startY;
    if (
      Math.abs(totalDx) > threshold * 0.45 ||
      Math.abs(totalDy) > threshold * 0.45
    )
      pointerState.moved = true;

    if (
      Math.abs(dx) >= threshold &&
      Math.abs(totalDx) > Math.abs(totalDy) * 0.75
    ) {
      const steps = Math.max(
        1,
        Math.min(4, Math.floor(Math.abs(dx) / threshold)),
      );
      let moved = false;
      for (let i = 0; i < steps; i += 1)
        moved = stepHorizontal(dx < 0 ? -1 : 1) || moved;
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
    if (!pointerState.active || event.pointerId !== pointerState.pointerId)
      return;
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
      const steps = Math.max(
        1,
        Math.min(6, Math.round(Math.abs(dx) / threshold)),
      );
      let moved = false;
      for (let i = 0; i < steps; i += 1)
        moved = stepHorizontal(gesture.direction === "left" ? -1 : 1) || moved;
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
      startDailyChallenge: () => {
        startDailyChallenge();
        syncUi();
      },
      startAiGame: () => {
        startAiGame();
        syncUi();
      },
      openAiSettings: () => {
        ui.showOverlay("aiOverlay");
        syncUi();
      },
      closeAiSettings: () => {
        ui.hideOverlay("aiOverlay");
        ui.showOverlay("startOverlay");
        syncUi();
      },
      loadCurrentGame: () => {
        loadCurrentGame();
        syncUi();
      },
      playWithFriend: () => {
        createFriendRoom();
        syncUi();
      },
      openSettings: () => {
        openSettings();
        syncUi();
      },
      installApp,
      openStats: () => {
        openStats();
        syncUi();
      },
      openReplay: () => {
        openReplay();
        syncUi();
      },
      closeReplay,
      startGhostRun,
      openHelp: () => {
        ui.showOverlay("helpOverlay");
        syncUi();
      },
      closeHelp: () => {
        ui.hideOverlay("helpOverlay");
        syncUi();
      },
      openTutorial: () => {
        ui.hideOverlay("helpOverlay");
        ui.showOverlay("tutorialOverlay");
        syncUi();
      },
      closeTutorial: () => {
        ui.hideOverlay("tutorialOverlay");
        syncUi();
      },
      startTutorialGame: () => {
        ui.hideOverlay("tutorialOverlay");
        startGame("classic", "normal");
        showToast("Тренировка началась");
        syncUi();
      },
      closeCoach: () => {
        ui.hideOverlay("coachOverlay");
        syncUi();
      },
      openOnline: () => {
        openOnline();
        syncUi();
      },
      toggleOnlineConnection: () => {
        if (state.online.connected) startOnlineGame();
        else {
          toggleOnlineConnection();
          syncUi();
        }
      },
      copyRoomLink,
      shareRoomLink,
      startTournament: () => {
        startTournament();
        syncUi();
      },
      closeOnline: () => {
        if (state.online.connected) disconnectOnline(false);
        ui.hideOverlay("onlineOverlay");
        syncUi();
      },
      closeTournament: () => {
        ui.hideOverlay("tournamentOverlay");
        syncUi();
      },
      rematch: () => {
        requestRematch();
        syncUi();
      },
      resume: () => {
        resume();
        syncUi();
      },
      playAgain: () => startGame(state.mode, state.difficulty),
      togglePause: () => {
        togglePause();
        syncUi();
      },
      returnToMainMenu,
      restartGame: () => startGame(state.mode, state.difficulty),
      closeSettings: () => {
        ui.hideOverlay("settingsOverlay");
        syncUi();
      },
      closeStats: () => {
        closeStats();
        syncUi();
      },
      shareStats: () => shareText(statsText()),
      openCoach: () => {
        ui.showOverlay("coachOverlay");
        syncUi();
      },
      shareResult: () => shareText(resultText()),
      holdPiece: () => {
        holdPiece();
        syncUi();
      },
      moveLeft: () => {
        stepHorizontal(-1);
        syncUi();
      },
      moveRight: () => {
        stepHorizontal(1);
        syncUi();
      },
      softDrop: () => {
        softDrop();
        syncUi();
      },
      rotate: () => {
        rotateClockwise();
        syncUi();
      },
      hardDrop: () => {
        hardDrop();
        syncUi();
      },
      toggleMute: toggleSoundMute,
      changeSetting,
    });

    state.layoutObserver = ui.bindWindowEvents({
      visibilityChange: () => {
        if (
          state.settings.autoPause &&
          document.hidden &&
          state.running &&
          !state.paused
        )
          pause();
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
      },
    });

    ui.bindBoardTouch({
      touchstart: handleTouchStart,
      touchmove: handleTouchMove,
      touchend: handleTouchEnd,
      touchcancel: handleTouchCancel,
    });
    ui.bindBoardPointer({
      pointerdown: handlePointerStart,
      pointermove: handlePointerMove,
      pointerup: handlePointerEnd,
      pointercancel: handlePointerCancel,
      contextmenu: handlePointerContextMenu,
    });
  }

  function bootPwa() {
    const canUsePwa =
      "serviceWorker" in navigator &&
      (window.isSecureContext ||
        /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
    if (canUsePwa) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          showToast("Офлайн-кэш готовится");
        })
        .catch(() => undefined);
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
    if (mode && MODES[normalizeModeKey(mode)])
      ui.setStartMode(normalizeModeKey(mode));
    const room = roomFromLocation(location);
    if (room) {
      ui.setOnlineRoom(room);
      storage.saveRoomCode(room);
      setTimeout(() => openOnline({ autoConnect: true }), 0);
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
