import {
  SOUND_EVENTS,
  initAudio,
  makeAudioSettings,
  playSound as playAudioSound,
  setVolume,
  toggleMute,
} from "./audio.js";
import { createAiController } from "./ai-client.js";
import { createPrivacyAnalytics } from "./analytics.js";
import {
  COLS,
  FLOW_STATE,
  PROGRESSION,
  ROWS,
  SHAPES,
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
  loadOrCreatePlayerId,
  roomFromLocation,
  sendAttack,
  sendMatchEvent,
  sendOnlineMessage,
} from "./online.js";
import { createOnlineController } from "./online-controller.js";
import { advanceFrameClock, decayFlashes } from "./runtime-loop.js";
import {
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
import {
  TICK_RATE,
  applyInput as applyEngineInput,
  createReplay as createEngineReplay,
  createState as createEngineState,
  isValid as engineIsValid,
  makeBoard as makeEngineBoard,
  pieceCells as enginePieceCells,
  queueGarbage as queueEngineGarbage,
  restoreSnapshot as restoreEngineSnapshot,
  snapshot as createEngineSnapshot,
  step as stepEngine,
} from "./engine.js";
import { createReplayPlayer, validateReplay } from "./replay.js";
import {
  applyGameProgress,
  normalizeProfile,
  portableProfile,
  selectCosmetic,
  xpForNextLevel,
} from "./progression.js";
import {
  applySaveSnapshot,
  buildSavePayload,
  migrateGhostRun,
  migrateSaveSnapshot,
} from "./save-load.js";
import { createGameStorage } from "./storage.js";
import { createUi } from "./ui.js";
import {
  isAiSession as sessionIsAi,
  isOnlineSession as sessionIsOnline,
  isReplaySession as sessionIsReplay,
  makeSessionState,
} from "./session-state.js";
import { getGhostOverlayHeight, localDateKey } from "./utils.js";

(() => {
  "use strict";

  const FIXED_TICK_MS = 1000 / TICK_RATE;
  const STORAGE = {
    high: "blockdrop-high-score",
    stats: "blockdrop-stats-v2",
    settings: "blockdrop-settings-v2",
    save: "blockdrop-save-v2",
    saveArchive: "blockdrop-save-archive-v1",
    scores: "blockdrop-scoreboard-v2",
    achievements: "blockdrop-achievements-v2",
    ghostRun: "blockdrop-ghost-run-v1",
    ghostArchive: "blockdrop-ghost-archive-v1",
    replay: "blockdrop-replay-v1",
    replayArchive: "blockdrop-replay-archive-v1",
    lastRoom: "tetris-last-room",
    playerName: "blockdrop-player-name",
    rankedPlayerId: "blockdrop-ranked-player-id-v1",
    rankedIdentityToken: "blockdrop-ranked-identity-token-v1",
    accountToken: "blockdrop-account-token-v1",
    accountName: "blockdrop-account-name-v1",
    matchHistory: "blockdrop-online-match-history-v1",
    onlineStats: "blockdrop-online-stats-v1",
    onboarding: "blockdrop-onboarding-v1",
    profile: "blockdrop-profile-v1",
    analyticsConsent: "blockdrop-analytics-consent-v1",
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

  const AI_DIFFICULTY = {
    easy: { name: "Лёгкий", nameEn: "Easy" },
    normal: { name: "Нормальный", nameEn: "Normal" },
    hard: { name: "Сильный", nameEn: "Hard" },
    insane: { name: "Безумный", nameEn: "Insane" },
  };

  const AI_STYLE = {
    balanced: { name: "Баланс", nameEn: "Balanced" },
    aggressive: { name: "Атака", nameEn: "Attack" },
    defensive: { name: "Защита", nameEn: "Defense" },
  };

  const AI_PACE = {
    calm: { name: "Спокойный", nameEn: "Calm", thinkMultiplier: 1.35 },
    fair: { name: "Ровный", nameEn: "Fair", thinkMultiplier: 1 },
    fast: { name: "Быстрый", nameEn: "Fast", thinkMultiplier: 0.72 },
  };

  const ONBOARDING_STEPS = [
    {
      actions: ["left", "right"],
      ru: "Сделай свайп влево или вправо",
      en: "Swipe left or right",
    },
    {
      actions: ["rotateCW", "rotateCCW"],
      ru: "Поверни фигуру касанием или кнопкой",
      en: "Rotate the piece with a tap or key",
    },
    {
      actions: ["hardDrop"],
      ru: "Сделай быстрый сброс вниз",
      en: "Hard drop the piece",
    },
    {
      actions: ["hold"],
      ru: "Отложи фигуру в запас",
      en: "Hold the current piece",
    },
  ];

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
  const storedGhostRun = storage.loadGhostRun(null);
  const ghostMigration = migrateGhostRun(storedGhostRun);
  if (!ghostMigration.ok) {
    storage.archiveGhostRun(storedGhostRun, ghostMigration.code);
  } else if (ghostMigration.migrated) {
    storage.saveGhostRun(ghostMigration.value);
  }
  const storedReplay = storage.loadReplay(null);
  const replayValidation = storedReplay
    ? validateReplay(storedReplay)
    : { ok: true, replay: null };
  if (!replayValidation.ok) {
    storage.archiveReplay(storedReplay, replayValidation.code);
  }
  const storedProfile = normalizeProfile(storage.loadProfile({}));
  const ui = createUi();
  const onlineClient = createOnlineClient();
  let deferredInstallPrompt = null;
  let pendingServiceWorker = null;
  let reloadAfterMatch = false;
  let pwaReloadRequested = false;
  let onboardingTimer = 0;

  const state = {
    board: makeEngineBoard(),
    active: null,
    queue: [],
    bag: [],
    hold: null,
    holdUsed: false,
    seed: "",
    randomState: 0,
    tick: 0,
    tickAccumulatorMs: 0,
    inputSeq: 0,
    replayInputs: [],
    replayEvents: [],
    bestReplay: replayValidation.ok ? replayValidation.replay : null,
    lastCompletedReplay: null,
    replayPlayer: null,
    replaySpeed: 1,
    replayCompleteNotified: false,
    onboarding: {
      active: false,
      step: 0,
      startedAt: 0,
      completed: Boolean(storage.loadOnboarding(null)?.completed),
    },
    profile: storedProfile,
    softDropReleaseTick: 0,
    resultFinalized: false,
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
    serverDaily: {
      date: "",
      seed: "",
      runToken: "",
      runSignature: "",
      runExpiresAt: 0,
      leaderboard: [],
    },
    serverRanked: {
      leaderboard: [],
      queueWaiting: 0,
    },
    capabilities: {
      secureTransport: false,
      authEnabled: false,
      rankedEnabled: false,
      casualV2Enabled: false,
      analyticsEnabled: false,
      pwaInstallEnabled: false,
      casualOnlineEnabled: true,
      maxPlayers: 2,
    },
    unlocked: storage.loadAchievements({}),
    online: {
      id: "",
      connected: false,
      room: "",
      mode: "classic",
      name: "",
      ranked: false,
      authoritative: false,
      protocolVersion: 1,
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
      name: "AI",
      engineState: null,
      pendingActions: [],
      inputSeq: 0,
      workerBusy: false,
      requestId: "",
      requestPiece: "",
      nextThinkTick: 0,
      lastPlan: null,
      workerError: "",
    },
    ghostRun: ghostMigration.ok ? ghostMigration.value : null,
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

  const aiController = createAiController({
    onPlan: handleAiPlan,
    onError: handleAiError,
  });

  const analytics = createPrivacyAnalytics({
    enabled: state.capabilities.analyticsEnabled,
    consented: state.settings.analyticsConsent,
    context: () => ({
      mode: state.mode,
      locale: state.settings.language,
    }),
  });
  let consentScreenViewSent = false;

  function trackConsentScreenView() {
    analytics.setEnabled(Boolean(state.capabilities.analyticsEnabled));
    analytics.setConsent(Boolean(state.settings.analyticsConsent));
    if (
      consentScreenViewSent ||
      !state.settings.analyticsConsent ||
      !state.capabilities.analyticsEnabled
    ) {
      return;
    }
    consentScreenViewSent = true;
    analytics.track("screen_view", { result: "consent_enabled" });
  }

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

  function isReplaySession() {
    return sessionIsReplay(state);
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
      analyticsConsent: storage.loadAnalyticsConsent(false),
      selectedCosmetic: storedProfile.selectedCosmetic,
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
    const prefersReducedMotion = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    const constrainedDevice =
      (Number(navigator.hardwareConcurrency) || 8) <= 4 ||
      (Number(navigator.deviceMemory) || 8) <= 4 ||
      Boolean(navigator.connection?.saveData);
    state.settings.adaptiveLowPower =
      state.settings.performanceMode === "battery" ||
      (state.settings.performanceMode === "auto" && constrainedDevice);
    state.settings.particles =
      state.settings.performanceMode === "quality" ||
      !state.settings.adaptiveLowPower;
    state.settings.colorBlind = false;
    state.settings.ghost = true;
    state.settings.bigButtons = false;
    state.settings.autoPause = true;
    state.settings.reducedMotion =
      state.settings.performanceMode === "battery" || prefersReducedMotion;
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

  function createLocalSeed() {
    const values = new Uint32Array(2);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(values);
      return `local:${values[0].toString(16)}${values[1].toString(16)}`;
    }
    return `local:${Date.now()}:${Math.floor(Math.random() * 0xffffffff)}`;
  }

  function cells(piece) {
    return enginePieceCells(piece);
  }

  function valid(piece) {
    return engineIsValid(state.board, piece);
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
    const seed = String(options.seed || createLocalSeed()).slice(0, 128);
    const engineState = createEngineState({ seed, mode });
    state.settings.lastMode = mode;
    storage.saveSettings(state.settings);
    Object.assign(state, engineState);
    state.difficulty = difficulty;
    state.bestComboRun = 0;
    state.backToBackChain = 0;
    state.bestBackToBackRun = 0;
    state.hardDrops = 0;
    state.incomingGarbage = state.pendingGarbage;
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
    state.resultFinalized = false;
    state.lastTime = 0;
    state.elapsedMs = 0;
    state.dropMs = 0;
    state.tickAccumulatorMs = 0;
    state.inputSeq = 0;
    state.replayInputs = [];
    state.replayEvents = [];
    state.lastCompletedReplay = null;
    state.replayPlayer = null;
    state.softDropReleaseTick = 0;
    state.lockDelayMs = 0;
    state.lockResets = 0;
    state.flashes = [];
    state.ai.enabled = session.type === "ai";
    state.ai.difficulty = options.aiDifficulty || state.settings.aiDifficulty;
    state.ai.score = 0;
    state.ai.height = 0;
    state.ai.elapsedMs = 0;
    state.ai.engineState = state.ai.enabled
      ? createEngineState({ seed, mode })
      : null;
    state.ai.pendingActions = [];
    state.ai.inputSeq = 0;
    state.ai.workerBusy = false;
    state.ai.requestId = "";
    state.ai.requestPiece = "";
    state.ai.nextThinkTick = 0;
    state.ai.lastPlan = null;
    state.ai.workerError = "";
    state.ai.name =
      state.settings.language === "en"
        ? `AI ${AI_DIFFICULTY[state.ai.difficulty].nameEn} · ${AI_STYLE[state.settings.aiStyle].nameEn}`
        : `Бот ${AI_DIFFICULTY[state.ai.difficulty].name} · ${AI_STYLE[state.settings.aiStyle].name}`;
    state.daily = options.daily
      ? { date: options.dailyDate || localDateKey(), seed: options.seed }
      : null;
    state.ghostReplay = Boolean(options.ghostReplay);
    setSession({
      ...session,
      room: session.room || state.online.room,
      ranked: session.ranked || state.online.ranked,
      matchId: session.matchId || options.seed || "",
    });
    hideOverlays();
    ensureAudio();
    buzz("move");
    syncUi();
    saveCurrentGame();
    analytics.track("game_start", { mode });
    if (
      session.type === "solo" &&
      !state.onboarding.completed &&
      !options.ghostReplay
    ) {
      beginOnboarding();
    }
    wakeUpdate();
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

  async function startDailyChallenge() {
    const daily =
      (await createServerDailyRun()) || (await loadServerDaily()) || null;
    const key = daily?.date || localDateKey();
    const seed = daily?.seed ? `daily:${daily.seed}` : `daily:${key}`;
    startGame("classic", "normal", {
      daily: true,
      dailyDate: key,
      seed,
    });
    showToast(onlineText(`Испытание дня ${key}`, `Daily challenge ${key}`));
  }

  function receiveGarbage(count, from = "соперника") {
    if (!state.running || state.gameOver || count <= 0) return;
    queueEngineGarbage(state, count);
    if (!isReplaySession()) {
      state.replayEvents.push({
        tick: state.tick,
        type: "garbage",
        lines: Math.floor(count),
      });
    }
    state.incomingGarbage = state.pendingGarbage;
    resetStreak();
    shakeBoard();
    playEvent("attack");
    buzz("attack");
    showToast(`Атака от ${from}: +${count} в очереди`);
    ui.announce(
      onlineText(
        `Получено мусорных линий: ${count}`,
        `Incoming garbage: ${count}`,
      ),
      "assertive",
    );
    if (isOnlineSession()) sendOnlineUpdate(true);
  }

  function processEngineEvents(events = []) {
    for (const event of events) {
      if (event.type === "lock") handleEngineLock(event);
      if (event.type === "garbageApplied") {
        state.stats.totalReceivedGarbage += event.lines;
        showToast(
          onlineText(
            `Применено мусорных линий: ${event.lines}`,
            `Garbage applied: ${event.lines}`,
          ),
        );
      }
      if (event.type === "chaosGarbage") {
        state.stats.totalReceivedGarbage += event.lines;
        showToast(onlineText("Хаос добавил линию снизу", "Chaos added a line"));
      }
    }
    state.incomingGarbage = state.pendingGarbage;
    state.stats.bestScore = Math.max(state.stats.bestScore, state.score);
    storage.saveBestScore(state.stats.bestScore);
    if (state.gameOver && !state.resultFinalized) {
      finish(
        Boolean(state.won),
        state.won
          ? onlineText("Цель режима выполнена.", "Mode goal completed.")
          : onlineText(
              "Башня дошла до верхней границы.",
              "The stack reached the top.",
            ),
      );
    }
  }

  function handleEngineLock(event) {
    const clearEvent = {
      lines: event.lines,
      combo: event.combo,
      tSpinType: event.tSpinType,
      isTSpin: event.tSpinType === "full",
      isMini: event.tSpinType === "mini",
      difficult: Boolean(event.difficult),
      backToBack: Boolean(event.backToBack),
      backToBackEligible: Boolean(event.difficult),
      perfectClear: Boolean(event.perfectClear),
      score: event.score,
      attackLines: event.attack,
      accounted: true,
    };
    state.stats.pieceCounts[event.kind] += 1;
    state.stats.totalPieces += 1;
    state.sessionHistory.push({
      kind: event.kind,
      clear: event.lines,
      special: event.tSpinType,
      perfectClear: event.perfectClear,
      backToBack: event.backToBack,
      attack: event.attack,
      score: event.score,
      holes: countHoles(),
      height: currentHeight(),
      bumpiness: surfaceBumpiness(),
    });
    if (state.sessionHistory.length > 60) state.sessionHistory.shift();
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
    if (!clearEvent.isTSpin && !clearEvent.isMini && event.lines === 4) {
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
    } else if (event.lines > 0) {
      state.backToBackChain = 0;
    }
    state.bestComboRun = Math.max(state.bestComboRun, state.combo);
    state.bestClearInGame = Math.max(state.bestClearInGame, event.lines);
    state.flashes = (event.rows || []).map((row) => ({
      row,
      life: 1,
      width: 0,
    }));
    rememberBestMoment(clearEvent);
    if (event.lines > 0 || event.tSpinType) {
      playEvent(clearEvent.isTSpin || event.lines === 4 ? "tetris" : "line");
      buzz(clearEvent.isTSpin || event.lines === 4 ? "tetris" : "clear");
      showToast(formatClearEventToast(clearEvent));
      ui.announce(formatClearEventToast(clearEvent));
      sendAttackForEvent(clearEvent);
      burst(clearEvent.isTSpin || event.lines === 4 ? 34 : 18);
      shakeBoard();
    }
    checkAchievements();
    saveCurrentGame();
  }

  function dispatchEngineInput(action, pressed = true) {
    if (!canInput() && !(action === "softDrop" && pressed === false)) {
      return false;
    }
    const input = {
      tick: state.tick,
      seq: ++state.inputSeq,
      action,
      pressed: pressed !== false,
    };
    state.replayInputs.push(input);
    if (state.replayInputs.length > 100_000) state.replayInputs.shift();
    const events = [];
    const accepted = applyEngineInput(state, input, events);
    if (!accepted) return false;
    recordOnboardingAction(action);
    if (isOnlineSession() && onlineClient.authoritative) {
      onlineController.sendAuthoritativeInput(input);
    }
    if (action === "left" || action === "right") {
      state.moves += 1;
      state.stats.totalMoves += 1;
      playEvent("move");
      buzz("move");
    } else if (action === "rotateCW" || action === "rotateCCW") {
      state.rotations += 1;
      state.stats.totalRotations += 1;
      playEvent("rotate");
      buzz("rotate");
    } else if (action === "hardDrop") {
      state.hardDrops += 1;
      state.stats.totalHardDrops += 1;
      playEvent("hardDrop");
      buzz("drop");
      shakeBoard();
    } else if (action === "hold") {
      state.holds += 1;
      state.stats.totalHolds += 1;
      playEvent("hold");
      buzz("hold");
    } else if (action === "softDrop" && pressed) {
      state.softDrops += 1;
      state.stats.totalSoftDrops += 1;
      state.softDropReleaseTick = state.tick + 1;
    }
    processEngineEvents(events);
    return true;
  }

  function runEngineTick() {
    if (
      state.softDrop &&
      state.softDropReleaseTick &&
      state.tick >= state.softDropReleaseTick
    ) {
      dispatchEngineInput("softDrop", false);
      state.softDropReleaseTick = 0;
    }
    const { events } = stepEngine(state);
    processEngineEvents(events);
    if (state.running && !state.gameOver) runAiEngineTick();
  }

  function move(dx, dy) {
    if (dy > 0) return softDrop();
    if (dx < 0) return dispatchEngineInput("left");
    if (dx > 0) return dispatchEngineInput("right");
    return false;
  }

  function rotate(direction = 1) {
    return dispatchEngineInput(direction < 0 ? "rotateCCW" : "rotateCW");
  }

  function softDrop(pressed = true) {
    return dispatchEngineInput("softDrop", pressed);
  }

  function stepHorizontal(direction) {
    return move(direction, 0);
  }

  function rotateClockwise() {
    return rotate(1);
  }

  function rotateCounterClockwise() {
    return rotate(-1);
  }

  function hardDrop() {
    return dispatchEngineInput("hardDrop");
  }

  function holdPiece() {
    return dispatchEngineInput("hold");
  }

  function sendAttackForEvent(event) {
    const lines = Number(event?.attackLines) || 0;
    if (!lines || (!isOnlineSession() && !isAiSession())) return;
    if (!event.accounted) state.sentGarbage += lines;
    state.stats.totalSentGarbage += lines;
    if (isOnlineSession()) {
      if (!onlineClient.authoritative) {
        sendMatchEvent(onlineClient, state.online.room, {
          eventType: "clear",
          lines: event.lines,
          attackLines: lines,
          combo: event.combo,
          score: state.score,
          elapsedMs: Math.floor(state.elapsedMs),
        });
        sendAttack(onlineClient, state.online.room, lines);
      }
    }
    if (isAiSession()) {
      queueEngineGarbage(state.ai.engineState, lines);
    }
    playEvent("attack", { duration: 0.09 });
    burst(12);
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
        onlineText(
          `Атака +${event.attackLines}`,
          `Attack +${event.attackLines}`,
        ),
      );
    }
    return parts.join(" • ");
  }

  function bestMomentLabel() {
    if (state.bestMomentEvent)
      return formatClearEventToast(state.bestMomentEvent);
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

  function saveCompletedReplay(won) {
    if (isOnlineSession() || isReplaySession()) return null;
    const replay = createEngineReplay({
      seed: state.seed,
      mode: state.mode,
      inputs: state.replayInputs,
      externalEvents: state.replayEvents,
      finalState: state,
      metadata: {
        score: state.score,
        lines: state.lines,
        won: Boolean(won),
        sessionType: state.session.type,
        dailyDate: state.daily?.date || "",
        aiDifficulty: isAiSession() ? state.ai.difficulty : "",
      },
    });
    const verification = validateReplay(replay);
    if (!verification.ok) return null;
    state.lastCompletedReplay = verification.replay;
    if (state.daily || state.score >= state.previousBestScore) {
      state.bestReplay = verification.replay;
      storage.saveReplay(state.bestReplay);
    }
    return verification.replay;
  }

  function finish(won, text, options = {}) {
    if (state.resultFinalized) return;
    saveCompletedReplay(won);
    state.resultFinalized = true;
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
      submitDailyScore();
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
    if (!isReplaySession()) {
      const progression = applyGameProgress(state.profile, {
        score: state.score,
        lines: state.lines,
        hardDrops: state.hardDrops,
        won,
      });
      state.profile = progression.profile;
      state.settings.selectedCosmetic = state.profile.selectedCosmetic;
      storage.saveProfile(state.profile);
    }
    storage.clearSave();
    checkAchievements();
    ui.showGameOver({
      title: won
        ? onlineText("Победа!", "Victory!")
        : onlineText("Игра окончена", "Game over"),
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
    ui.announce(
      `${won ? onlineText("Победа", "Victory") : onlineText("Игра окончена", "Game over")}. ${text}. ${onlineText("Счёт", "Score")}: ${state.score}.`,
      "assertive",
    );
    renderCoachTips();
    playEvent(won ? "win" : "gameOver");
    buzz(won ? "win" : "gameOver");
    shakeBoard();
    if (won) burst(50);
    sendOnlineUpdate(true);
    if (reportOnline) sendOnlineMatchResult(won);
    submitServerRecord();
    analytics.track("game_finish", {
      mode: state.mode,
      durationMs: state.elapsedMs,
      result: won ? "win" : "loss",
    });
    if (reloadAfterMatch) requestPwaUpdate();
  }

  function sendOnlineMatchResult(won) {
    if (
      !isOnlineSession() ||
      !state.online.connected ||
      onlineClient.role === "spectator" ||
      onlineClient.authoritative
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
    state.replayPlayer?.pause();
    state.phase = FLOW_STATE.PAUSED;
    saveCurrentGame();
    ui.setPauseVisible(true);
  }

  function resume() {
    if (!state.running || state.gameOver) return;
    state.paused = false;
    state.replayPlayer?.play();
    state.phase = FLOW_STATE.PLAYING;
    state.lastTime = 0;
    ui.setPauseVisible(false);
    wakeUpdate();
  }

  function returnToMainMenu() {
    let saved = false;
    if (state.running && !state.gameOver) {
      state.paused = true;
      if (!isReplaySession()) {
        saveCurrentGame();
        saved = !isOnlineSession() && !isAiSession();
      }
    }
    hideOverlays();
    ui.showOverlay("startOverlay");
    if (isReplaySession()) {
      state.running = false;
      state.replayPlayer = null;
      ui.setReplayPlayback({ visible: false });
    }
    state.phase = FLOW_STATE.MENU;
    showToast(saved ? "Партия сохранена" : "Главное меню");
  }

  function togglePause() {
    if (state.paused) resume();
    else pause();
  }

  function canInput() {
    return (
      state.running &&
      !state.paused &&
      !state.gameOver &&
      !isReplaySession() &&
      state.active
    );
  }

  let updateScheduled = false;
  let idleUpdateTimer = 0;

  function scheduleUpdate(delay = 0) {
    if (updateScheduled) return;
    updateScheduled = true;
    if (delay > 0) {
      idleUpdateTimer = window.setTimeout(() => {
        idleUpdateTimer = 0;
        requestAnimationFrame(update);
      }, delay);
      return;
    }
    requestAnimationFrame(update);
  }

  function wakeUpdate() {
    if (idleUpdateTimer) {
      clearTimeout(idleUpdateTimer);
      idleUpdateTimer = 0;
      updateScheduled = false;
    }
    scheduleUpdate();
  }

  function update(time) {
    updateScheduled = false;
    const delta = advanceFrameClock(state, time, TIMING.MAX_FRAME_DELTA_MS);

    if (state.running && !state.paused && isReplaySession()) {
      updateReplayPlayback(delta);
    } else if (state.running && !state.paused && !state.gameOver) {
      state.tickAccumulatorMs += delta;
      let ticksProcessed = 0;
      while (
        state.tickAccumulatorMs >= FIXED_TICK_MS &&
        ticksProcessed < 8 &&
        state.running &&
        !state.gameOver
      ) {
        state.tickAccumulatorMs -= FIXED_TICK_MS;
        runEngineTick();
        ticksProcessed += 1;
      }
      if (ticksProcessed === 8) {
        state.tickAccumulatorMs = Math.min(
          state.tickAccumulatorMs,
          FIXED_TICK_MS * 2,
        );
      }
      state.elapsedMs = Math.floor(state.tick * FIXED_TICK_MS);
      rewardSurvivalStreak(delta);
      recordGhostSample();
    }

    state.flashes = decayFlashes(state.flashes, delta, UI_CONFIG);
    draw();
    syncUi();
    scheduleUpdate(state.running && !state.paused && !state.gameOver ? 0 : 250);
  }

  function aiPieceKey(aiState = state.ai.engineState) {
    if (!aiState?.active) return "";
    return [
      aiState.pieces,
      aiState.active.kind,
      aiState.active.rotation,
      aiState.active.x,
      aiState.active.y,
      aiState.hold || "",
      aiState.holdUsed ? 1 : 0,
    ].join(":");
  }

  function requestAiPlan() {
    const aiState = state.ai.engineState;
    if (
      !state.ai.enabled ||
      !aiState?.active ||
      aiState.gameOver ||
      state.ai.workerBusy ||
      state.ai.pendingActions.length ||
      aiState.tick < state.ai.nextThinkTick
    ) {
      return;
    }
    state.ai.workerBusy = true;
    state.ai.requestPiece = aiPieceKey(aiState);
    state.ai.requestId = aiController.plan(createEngineSnapshot(aiState), {
      difficulty: state.ai.difficulty,
      style: state.settings.aiStyle,
    });
  }

  function handleAiPlan(plan) {
    if (!state.ai.enabled || plan.requestId !== state.ai.requestId) return;
    state.ai.workerBusy = false;
    state.ai.lastPlan = plan;
    const aiState = state.ai.engineState;
    if (!aiState || aiPieceKey(aiState) !== state.ai.requestPiece) {
      state.ai.nextThinkTick = aiState?.tick || 0;
      return;
    }
    state.ai.pendingActions = Array.isArray(plan.actions)
      ? plan.actions.slice(0, 32)
      : ["hardDrop"];
    const pace = AI_PACE[state.settings.aiPace] || AI_PACE.fair;
    state.ai.nextThinkTick =
      aiState.tick +
      Math.max(
        4,
        Math.round((Number(plan.thinkTicks) || 58) * pace.thinkMultiplier),
      );
  }

  function handleAiError(error) {
    if (!state.ai.enabled) return;
    state.ai.workerBusy = false;
    state.ai.workerError = String(error?.message || "AI worker failed").slice(
      0,
      160,
    );
    state.ai.pendingActions = ["hardDrop"];
    state.ai.nextThinkTick = (state.ai.engineState?.tick || 0) + 90;
  }

  function runAiEngineTick() {
    const aiState = state.ai.engineState;
    if (!state.ai.enabled || !aiState || aiState.gameOver) return;
    const inputs = state.ai.pendingActions.splice(0).map((action) => ({
      tick: aiState.tick,
      seq: ++state.ai.inputSeq,
      action,
      pressed: true,
    }));
    const { events } = stepEngine(aiState, inputs);
    state.ai.score = aiState.score;
    state.ai.height = boardCurrentHeight(aiState.board);
    state.ai.elapsedMs = Math.floor(aiState.tick * FIXED_TICK_MS);
    for (const event of events) {
      if (event.type === "lock" && event.attack > 0) {
        queueEngineGarbage(state, event.attack);
        state.replayEvents.push({
          tick: state.tick,
          type: "garbage",
          lines: event.attack,
        });
        state.incomingGarbage = state.pendingGarbage;
        showToast(
          onlineText(
            `${state.ai.name}: +${event.attack} в очереди`,
            `${state.ai.name}: +${event.attack} pending`,
          ),
        );
        playEvent("attack", { duration: 0.09 });
      }
    }
    if (aiState.gameOver && state.running && !state.resultFinalized) {
      finish(
        !aiState.won,
        aiState.won
          ? onlineText(
              "AI первым выполнил цель режима.",
              "AI reached the mode goal first.",
            )
          : onlineText("AI дошёл до верхней границы.", "AI topped out."),
      );
      return;
    }
    requestAiPlan();
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
      ghostSchemaVersion: 2,
      legacyTimeline: true,
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
    const replay = state.replayPlayer?.replay;
    ui.setReplayPlayback({
      visible: isReplaySession() && Boolean(state.replayPlayer),
      paused: state.paused,
      speed: state.replaySpeed,
      tick: state.tick,
      finalTick: replay?.finalTick || 0,
      elapsed: formatTime(state.elapsedMs),
      duration: formatTime(((replay?.finalTick || 0) / TICK_RATE) * 1000),
    });
    ui.renderOnboarding({
      visible: state.onboarding.active,
      title: onlineText("Обучение", "Tutorial"),
      instruction: onboardingInstruction(),
      step: state.onboarding.step,
      total: ONBOARDING_STEPS.length,
    });
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
    const preview = state.board
      .slice(-previewRows)
      .map((row) => row.map((cell) => (cell ? 1 : 0)));
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

  function applyAuthoritativeSnapshot(payload) {
    if (payload.spectator || !payload.gameSnapshot) return;
    let authoritative;
    try {
      authoritative = restoreEngineSnapshot(payload.gameSnapshot);
    } catch {
      showToast(
        onlineText(
          "Сервер прислал несовместимое состояние",
          "Server sent an incompatible snapshot",
        ),
      );
      return;
    }
    Object.assign(state, authoritative);
    const pending = [...onlineClient.pendingInputs.values()].sort(
      (left, right) => left.seq - right.seq,
    );
    for (const input of pending) applyEngineInput(state, input, []);
    state.inputSeq = Math.max(
      state.inputSeq || 0,
      payload.ackSeq || 0,
      ...pending.map((input) => input.seq),
    );
    state.tickAccumulatorMs = 0;
    state.elapsedMs = Math.floor(state.tick * FIXED_TICK_MS);
    state.incomingGarbage = state.pendingGarbage;
    state.engineSnapshot = createEngineSnapshot(state);
    for (const opponent of payload.opponents || []) {
      const previous = state.online.peers[opponent.id] || {};
      const now = performance.now();
      const previousHeight = interpolatedPeerHeight(previous, now);
      state.online.peers[opponent.id] = {
        ...previous,
        id: opponent.id,
        board: opponent.board,
        active: opponent.active,
        score: opponent.stats?.score || 0,
        lines: opponent.stats?.lines || 0,
        level: opponent.stats?.level || 1,
        sentGarbage: opponent.stats?.sentGarbage || 0,
        receivedGarbage: opponent.stats?.receivedGarbage || 0,
        height: boardCurrentHeight(opponent.board || []),
        previousHeight,
        serverTick: payload.serverTick || 0,
        receivedAt: now,
      };
    }
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
    applyAuthoritativeSnapshot,
  });
  const {
    openOnline,
    shareRoomLink,
    copyRoomLink,
    createFriendRoom,
    joinOnlineRoom,
    disconnectOnline,
    toggleOnlineConnection,
    findRankedMatch,
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
      .sort((a, b) => b.score - a.score)
      .map((peer) => interpolatedPeerHeight(peer))[0];
    return peerHeight || ghostRunHeight();
  }

  function interpolatedPeerHeight(peer, now = performance.now()) {
    const target = Number(peer?.height) || 0;
    const previous = Number.isFinite(Number(peer?.previousHeight))
      ? Number(peer.previousHeight)
      : target;
    const elapsed = Math.max(0, now - (Number(peer?.receivedAt) || now));
    const progress = Math.min(1, elapsed / 110);
    return previous + (target - previous) * progress;
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
    if (
      !state.running ||
      state.gameOver ||
      isOnlineSession() ||
      isAiSession() ||
      isReplaySession()
    )
      return;
    state.engineSnapshot = createEngineSnapshot(state);
    storage.saveGame(buildSavePayload(state));
  }

  function loadCurrentGame() {
    const save = storage.loadSave(null);
    if (!save) {
      showToast(onlineText("Сохранения пока нет", "No saved game yet"));
      return;
    }
    const migration = migrateSaveSnapshot(save);
    if (!migration.ok) {
      storage.archiveSave(save, migration.code);
      showToast(
        onlineText(
          "Сохранение несовместимо и перенесено в архив",
          "Save is incompatible and was archived",
        ),
      );
      return;
    }
    if (state.online.connected) disconnectOnline(false);
    applySaveSnapshot(state, migration.value, FLOW_STATE.PLAYING);
    if (state.engineSnapshot) {
      Object.assign(state, restoreEngineSnapshot(state.engineSnapshot));
    }
    state.mode = normalizeModeKey(state.mode);
    state.ai.enabled = false;
    state.ghostReplay = false;
    state.difficulty = "normal";
    state.inputSeq = Math.max(state.inputSeq || 0, state.lastAckSeq || 0);
    state.tickAccumulatorMs = 0;
    state.resultFinalized = false;
    setSession({ type: "solo", source: "save" });
    hideOverlays();
    updateLayoutMetrics();
    syncUi();
    if (migration.migrated) saveCurrentGame();
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
      dailyLeaderboard: dailyLeaderboardForUi(),
      dailyLeaderboardDate: state.serverDaily.date,
      rankedLeaderboard: rankedLeaderboardForUi(),
      achievements: ACHIEVEMENTS.map(([id, title, description]) => ({
        title,
        description,
        unlocked: Boolean(state.unlocked[id]),
      })),
      profile: state.profile,
      nextLevelXp: xpForNextLevel(state.profile.level),
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

  function dailyLeaderboardForUi() {
    return (state.serverDaily.leaderboard || []).slice(0, 10).map((entry) => ({
      name: entry.name,
      score: entry.score,
      lines: entry.lines,
      time: formatTime(entry.timeMs || 0),
    }));
  }

  function rankedLeaderboardForUi() {
    return (state.serverRanked.leaderboard || []).slice(0, 20).map((entry) => ({
      name: entry.name,
      rating: Number(entry.rating) || 1000,
      wins: Number(entry.wins) || 0,
      losses: Number(entry.losses) || 0,
    }));
  }

  async function loadCapabilities() {
    if (!location.protocol.startsWith("http")) {
      ui.setOnlineCapabilities?.(state.capabilities);
      return state.capabilities;
    }
    try {
      const response = await fetch("/api/capabilities", { cache: "no-store" });
      if (!response.ok) throw new Error("Capabilities unavailable");
      state.capabilities = {
        ...state.capabilities,
        ...(await response.json()),
      };
    } catch {
      // The conservative defaults keep casual rooms usable without exposing auth.
    }
    if (!state.capabilities.authEnabled) {
      storage.clearAccountToken?.();
      storage.saveAccountName?.("");
    }
    ui.setOnlineCapabilities?.(state.capabilities);
    analytics.setEnabled(state.capabilities.analyticsEnabled);
    trackConsentScreenView();
    updateInstallButton();
    return state.capabilities;
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

  async function loadServerDaily() {
    if (!location.protocol.startsWith("http")) return null;
    try {
      const accountToken = state.capabilities.authEnabled
        ? storage.loadAccountToken?.("")
        : "";
      const response = await fetch("/api/daily", {
        cache: "no-store",
        headers: accountToken
          ? { Authorization: `Bearer ${accountToken}` }
          : undefined,
      });
      const data = await response.json();
      state.serverDaily = {
        date: String(data.date || localDateKey()),
        seed: String(data.seed || ""),
        runToken: String(data.runToken || ""),
        runSignature: String(data.runSignature || ""),
        runExpiresAt: Number(data.runExpiresAt) || 0,
        leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
      };
      syncUi();
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
      return state.serverDaily;
    } catch {
      return null;
    }
  }

  async function createServerDailyRun() {
    if (!location.protocol.startsWith("http")) return null;
    try {
      const accountToken = state.capabilities.authEnabled
        ? storage.loadAccountToken?.("")
        : "";
      const response = await fetch("/api/daily/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accountToken ? { Authorization: `Bearer ${accountToken}` } : {}),
        },
        body: JSON.stringify({
          playerId: storage.loadRankedPlayerId("") || loadOrCreatePlayerId(),
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      state.serverDaily = {
        date: String(data.date || localDateKey()),
        seed: String(data.seed || ""),
        runToken: String(data.runToken || ""),
        runSignature: String(data.runSignature || ""),
        runExpiresAt: Number(data.runExpiresAt) || 0,
        leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
      };
      return state.serverDaily;
    } catch {
      return null;
    }
  }

  async function loadServerRanked() {
    if (!location.protocol.startsWith("http")) return null;
    if (!state.capabilities.rankedEnabled) return null;
    try {
      const response = await fetch("/api/ranked", { cache: "no-store" });
      const data = await response.json();
      state.serverRanked = {
        leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
        queueWaiting: Number(data.queueWaiting) || 0,
      };
      syncUi();
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
      return state.serverRanked;
    } catch {
      return null;
    }
  }

  async function submitDailyScore() {
    if (!state.daily || !location.protocol.startsWith("http")) return;
    try {
      const accountToken = state.capabilities.authEnabled
        ? storage.loadAccountToken?.("")
        : "";
      const response = await fetch("/api/daily", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accountToken ? { Authorization: `Bearer ${accountToken}` } : {}),
        },
        body: JSON.stringify({
          playerId: storage.loadRankedPlayerId("") || loadOrCreatePlayerId(),
          runToken: state.serverDaily.runToken,
          runSignature: state.serverDaily.runSignature,
          name: storage.loadPlayerName("Игрок") || state.online.name || "Игрок",
          score: state.score,
          lines: state.lines,
          level: state.level,
          timeMs: Math.floor(state.elapsedMs),
          pieces: state.pieces,
          bestCombo: state.bestComboRun,
          tSpins: state.tSpinCount,
          perfectClears: state.perfectClearCount,
          replayChecksum: state.lastCompletedReplay?.finalChecksum || "",
          replay: state.lastCompletedReplay,
        }),
      });
      const data = await response.json();
      state.serverDaily = {
        date: String(data.date || state.daily.date),
        seed: String(data.seed || state.daily.seed || ""),
        runToken: String(data.runToken || ""),
        runSignature: String(data.runSignature || ""),
        runExpiresAt: Number(data.runExpiresAt) || 0,
        leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : [],
      };
      if (ui.isOverlayVisible("statsOverlay")) renderStats();
    } catch {
      // Keep local daily best even when the server is unavailable.
    }
  }

  async function submitAccount(action) {
    if (!state.capabilities.authEnabled) {
      showToast(
        state.settings.language === "en"
          ? "Accounts require HTTPS"
          : "Аккаунты станут доступны после подключения HTTPS",
      );
      return;
    }
    const form = ui.getAccountForm?.() || {};
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          username: form.username,
          password: form.password,
          displayName: form.displayName || form.username,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) {
        ui.setAccountStatus?.(
          state.settings.language === "en"
            ? "Account request failed"
            : "Ошибка аккаунта",
        );
        showToast(data.error || "Account error");
        return;
      }
      storage.saveAccountToken?.(data.token);
      storage.saveAccountName?.(data.account?.displayName || form.username);
      storage.savePlayerName(data.account?.displayName || form.username);
      ui.setAccountSession?.(data.account);
      showToast(
        state.settings.language === "en"
          ? `Signed in as ${data.account?.displayName || data.account?.username}`
          : `Вход: ${data.account?.displayName || data.account?.username}`,
      );
      syncUi();
    } catch {
      ui.setAccountStatus?.(
        state.settings.language === "en"
          ? "Account server unavailable"
          : "Сервер аккаунтов недоступен",
      );
    }
  }

  async function changeAccountPassword() {
    if (!state.capabilities.authEnabled) {
      showToast(
        state.settings.language === "en"
          ? "Accounts require HTTPS"
          : "Аккаунты станут доступны после подключения HTTPS",
      );
      return;
    }
    const form = ui.getAccountForm?.() || {};
    const token = storage.loadAccountToken?.("");
    if (!token) {
      showToast(
        state.settings.language === "en" ? "Login first" : "Сначала войди",
      );
      return;
    }
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "changePassword",
          currentPassword: form.password,
          newPassword: form.newPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        showToast(data.error || "Password error");
        return;
      }
      if (data.token) storage.saveAccountToken?.(data.token);
      ui.setAccountSession?.(data.account);
      showToast(
        state.settings.language === "en"
          ? "Password updated"
          : "Пароль обновлён",
      );
    } catch {
      ui.setAccountStatus?.(
        state.settings.language === "en"
          ? "Account server unavailable"
          : "Сервер аккаунтов недоступен",
      );
    }
  }

  function logoutAccount() {
    const token = storage.loadAccountToken?.("");
    storage.clearAccountToken?.();
    storage.saveAccountName?.("");
    ui.setAccountSession?.(null);
    if (token && state.capabilities.authEnabled) {
      fetch("/api/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    showToast(state.settings.language === "en" ? "Signed out" : "Вы вышли");
    syncUi();
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
        textarea.className = "clipboard-fallback";
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
      lowPower: state.settings.adaptiveLowPower,
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
    ui.updateInstallButton(
      Boolean(deferredInstallPrompt && state.capabilities.pwaInstallEnabled),
    );
  }

  async function installApp() {
    if (!deferredInstallPrompt || !state.capabilities.pwaInstallEnabled) {
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

  function requestPwaUpdate() {
    if (!pendingServiceWorker) return;
    if (state.running && !state.gameOver) {
      reloadAfterMatch = true;
      ui.setPwaUpdateAvailable(true, true);
      return;
    }
    reloadAfterMatch = false;
    pwaReloadRequested = true;
    analytics.track("pwa_update", { result: "accepted" });
    pendingServiceWorker.postMessage({ type: "SKIP_WAITING" });
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
    loadServerDaily();
    loadServerRanked();
  }

  function closeStats() {
    ui.hideOverlay("statsOverlay");
    if (statsReturnOverlay) ui.showOverlay(statsReturnOverlay);
    statsReturnOverlay = null;
  }

  function openReplay() {
    ui.renderReplay(state.ghostRun, formatTime, state.bestReplay);
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

  function beginOnboarding() {
    clearTimeout(onboardingTimer);
    state.onboarding.active = true;
    state.onboarding.step = 0;
    state.onboarding.startedAt = performance.now();
    const instruction = onboardingInstruction();
    ui.announce(instruction);
    syncUi();
    onboardingTimer = globalThis.setTimeout(() => {
      if (!state.onboarding.active) return;
      state.onboarding.active = false;
      storage.saveOnboarding({
        completed: false,
        timedOutAt: new Date().toISOString(),
        durationMs: 30_000,
      });
      syncUi();
    }, 30_000);
  }

  function onboardingInstruction() {
    const step = ONBOARDING_STEPS[state.onboarding.step];
    if (!step) return "";
    return state.settings.language === "en" ? step.en : step.ru;
  }

  function recordOnboardingAction(action) {
    if (!state.onboarding.active) return;
    const step = ONBOARDING_STEPS[state.onboarding.step];
    if (!step?.actions.includes(action)) return;
    state.onboarding.step += 1;
    if (state.onboarding.step >= ONBOARDING_STEPS.length) {
      clearTimeout(onboardingTimer);
      state.onboarding.active = false;
      state.onboarding.completed = true;
      storage.saveOnboarding({
        completed: true,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - state.onboarding.startedAt),
      });
      analytics.track("tutorial_completion", {
        durationMs: performance.now() - state.onboarding.startedAt,
      });
      const message = onlineText(
        "Обучение завершено — управление освоено!",
        "Tutorial complete — controls mastered!",
      );
      showToast(message);
      ui.announce(message, "assertive");
      return;
    }
    ui.announce(onboardingInstruction());
  }

  function skipOnboarding() {
    clearTimeout(onboardingTimer);
    state.onboarding.active = false;
    storage.saveOnboarding({
      completed: false,
      skippedAt: new Date().toISOString(),
    });
    syncUi();
  }

  function startReplayPlayback() {
    if (!state.bestReplay) {
      showToast(onlineText("Повтора пока нет", "No replay yet"));
      return;
    }
    let player;
    try {
      player = createReplayPlayer(state.bestReplay);
    } catch (error) {
      storage.archiveReplay(state.bestReplay, error.code || "invalidReplay");
      state.bestReplay = null;
      showToast(
        onlineText(
          "Повтор несовместим и перенесён в архив",
          "Replay is incompatible and was archived",
        ),
      );
      return;
    }
    state.replayPlayer = player;
    state.replaySpeed = Number(ui.replaySpeedSelect.value) || 1;
    player.setSpeed(state.replaySpeed);
    Object.assign(state, player.seek(0));
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.resultFinalized = true;
    state.elapsedMs = 0;
    state.replayCompleteNotified = false;
    state.ai.enabled = false;
    setSession({ type: "replay", source: "replay" });
    hideOverlays();
    wakeUpdate();
    syncUi();
  }

  function updateReplayPlayback(delta) {
    if (!state.replayPlayer) return;
    const result = state.replayPlayer.advance(delta);
    Object.assign(state, result.state);
    state.elapsedMs = Math.floor((state.tick / TICK_RATE) * 1000);
    if (result.complete && !state.replayCompleteNotified) {
      state.replayCompleteNotified = true;
      state.paused = true;
      state.replayPlayer.pause();
      const verification = state.replayPlayer.verification();
      showToast(
        verification.ok
          ? onlineText("Повтор проверен ✓", "Replay verified ✓")
          : onlineText(
              "Checksum повтора не совпал",
              "Replay checksum mismatch",
            ),
      );
    }
  }

  function toggleReplayPause() {
    if (!state.replayPlayer) return;
    state.paused = !state.paused;
    if (state.paused) state.replayPlayer.pause();
    else state.replayPlayer.play();
    state.lastTime = 0;
    wakeUpdate();
    syncUi();
  }

  function setReplaySpeed(value) {
    state.replaySpeed = state.replayPlayer
      ? state.replayPlayer.setSpeed(value)
      : [0.5, 1, 2, 4].includes(Number(value))
        ? Number(value)
        : 1;
    ui.replaySpeedSelect.value = String(state.replaySpeed);
    syncUi();
  }

  function seekReplay(value) {
    if (!state.replayPlayer) return;
    Object.assign(state, state.replayPlayer.seek(value));
    state.elapsedMs = Math.floor((state.tick / TICK_RATE) * 1000);
    state.replayCompleteNotified = false;
    syncUi();
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
    const key = event.key.toLowerCase();
    if (key === "arrowdown" || key === "s") softDrop(false);
    stopHorizontal(key);
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

  async function exportProfile() {
    try {
      const payload = portableProfile(state.profile);
      const response = await fetch("/api/profile-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign", payload }),
      });
      if (!response.ok) throw new Error("profileSignFailed");
      const envelope = await response.json();
      if (
        !envelope.signature ||
        envelope.payload?.kind !== "blockdrop-profile"
      ) {
        throw new Error("profileSignFailed");
      }
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `blockdrop-profile-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast(
        onlineText(
          "Подписанный профиль экспортирован",
          "Signed profile exported",
        ),
      );
    } catch {
      showToast(
        onlineText(
          "Не удалось подписать экспорт профиля",
          "Could not sign profile export",
        ),
      );
    }
  }

  async function importProfile(file) {
    try {
      if (!file || file.size > 256 * 1024) throw new Error("profileTooLarge");
      const envelope = JSON.parse(await file.text());
      if (
        Number(envelope.envelopeSchemaVersion) !== 1 ||
        envelope.algorithm !== "HMAC-SHA256-v1" ||
        envelope.payload?.kind !== "blockdrop-profile" ||
        Number(envelope.payload?.exportSchemaVersion) !== 1 ||
        !envelope.signature
      ) {
        throw new Error("invalidProfileEnvelope");
      }
      const response = await fetch("/api/profile-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          payload: envelope.payload,
          signature: envelope.signature,
        }),
      });
      const result = response.ok ? await response.json() : { verified: false };
      if (!result.verified) throw new Error("badProfileSignature");
      state.profile = normalizeProfile(envelope.payload.profile);
      state.settings.selectedCosmetic = state.profile.selectedCosmetic;
      storage.saveProfile(state.profile);
      applySettings();
      renderStats();
      showToast(onlineText("Прогресс импортирован", "Progress imported"));
    } catch {
      showToast(
        onlineText(
          "Файл профиля повреждён или подпись неверна",
          "Profile file is damaged or has an invalid signature",
        ),
      );
    }
  }

  function chooseCosmetic(cosmeticId) {
    state.profile = selectCosmetic(state.profile, cosmeticId);
    state.settings.selectedCosmetic = state.profile.selectedCosmetic;
    storage.saveProfile(state.profile);
    applySettings();
    renderStats();
  }

  async function changeAnalyticsConsent(consented) {
    state.settings.analyticsConsent = Boolean(consented);
    storage.saveAnalyticsConsent(state.settings.analyticsConsent);
    analytics.setConsent(state.settings.analyticsConsent);
    applySettings();
    if (state.settings.analyticsConsent) await loadCapabilities();
    trackConsentScreenView();
  }

  function bindUi() {
    ui.bindControls({
      startGame: () => startGame(),
      startDailyChallenge: async () => {
        await startDailyChallenge();
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
      playReplay: startReplayPlayback,
      toggleReplayPause,
      setReplaySpeed,
      seekReplay,
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
        beginOnboarding();
        showToast("Тренировка началась");
        syncUi();
      },
      skipOnboarding,
      closeCoach: () => {
        ui.hideOverlay("coachOverlay");
        syncUi();
      },
      openOnline: () => {
        openOnline();
        syncUi();
      },
      createOnlineRoom: () => {
        createFriendRoom();
        syncUi();
      },
      joinOnlineRoom: () => {
        joinOnlineRoom();
        syncUi();
      },
      toggleOnlineConnection: () => {
        if (state.online.connected) startOnlineGame();
        else {
          toggleOnlineConnection();
          syncUi();
        }
      },
      findRankedMatch: () => {
        findRankedMatch();
        syncUi();
      },
      loginAccount: () => submitAccount("login"),
      registerAccount: () => submitAccount("register"),
      changeAccountPassword,
      logoutAccount,
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
      exportProfile,
      importProfile,
      selectCosmetic: chooseCosmetic,
      changeAnalyticsConsent,
      applyPwaUpdate: requestPwaUpdate,
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
      offline: () =>
        showToast(
          onlineText(
            "Офлайн: одиночная игра доступна",
            "Offline: solo play is available",
          ),
        ),
      online: () => {
        showToast(onlineText("Сеть вернулась", "Connection restored"));
        loadServerRecords();
        loadServerDaily();
        loadServerRanked();
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
        .then((registration) => {
          showToast(
            onlineText("Офлайн-кэш готовится", "Offline cache is preparing"),
          );
          const offerUpdate = (worker) => {
            pendingServiceWorker = worker;
            ui.setPwaUpdateAvailable(true, state.running && !state.gameOver);
          };
          if (registration.waiting) offerUpdate(registration.waiting);
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                offerUpdate(worker);
              }
            });
          });
        })
        .catch(() => undefined);
      let controllerChanging = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (controllerChanging || !pwaReloadRequested) return;
        controllerChanging = true;
        location.reload();
      });
    }
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallButton();
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      updateInstallButton();
      showToast(
        onlineText("Офлайн-версия установлена", "Offline version installed"),
      );
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
  ui.setOnlineCapabilities?.(state.capabilities);
  syncUi();
  draw();
  bootPwa();
  loadCapabilities().then(() => loadServerRanked());
  loadServerRecords();
  loadServerDaily();
  scheduleUpdate();
})();
