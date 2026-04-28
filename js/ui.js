import { getModeOptions, normalizeModeKey } from "./modes.js";

export function byId(id, root = document) {
  return root.getElementById(id);
}

export function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

const UI_IDS = [
  "app",
  "topbar",
  "statusStrip",
  "gameLayout",
  "sidePanel",
  "controls",
  "nextPanel",
  "holdPanel",
  "statsPanel",
  "board",
  "boardShell",
  "next1",
  "next2",
  "next3",
  "hold",
  "scoreValue",
  "levelValue",
  "linesValue",
  "recordValue",
  "comboValue",
  "piecesValue",
  "timeValue",
  "goalValue",
  "progressFill",
  "rankValue",
  "apmValue",
  "heightValue",
  "onlinePanel",
  "startOverlay",
  "pauseOverlay",
  "settingsOverlay",
  "statsOverlay",
  "gameOverOverlay",
  "startButton",
  "dailyButton",
  "continueButton",
  "friendButton",
  "aiButton",
  "menuMoreSummary",
  "aiOverlay",
  "aiDifficultySelect",
  "aiStyleSelect",
  "aiPaceSelect",
  "startAiButton",
  "closeAiButton",
  "modeSummary",
  "menuRecords",
  "startSettingsButton",
  "installButton",
  "openStatsButton",
  "replayButton",
  "resumeButton",
  "playAgainButton",
  "pauseButton",
  "mainMenuButton",
  "pauseMenuButton",
  "gameOverMenuButton",
  "pauseRestartButton",
  "pauseSettingsButton",
  "holdButton",
  "leftButton",
  "rightButton",
  "rotateButton",
  "downButton",
  "dropButton",
  "startMode",
  "themeSelect",
  "themeSwatches",
  "languageSelect",
  "controlModeSelect",
  "vibrationToggle",
  "sensitivitySelect",
  "handednessSelect",
  "performanceSelect",
  "volumeRange",
  "volumeValue",
  "muteButton",
  "closeSettingsButton",
  "closeStatsButton",
  "shareStatsButton",
  "gameOverStatsButton",
  "statsGrid",
  "leaderboard",
  "serverLeaderboard",
  "dailyLeaderboardTitle",
  "dailyLeaderboard",
  "rankedLeaderboardTitle",
  "rankedLeaderboard",
  "achievementsList",
  "helpButton",
  "helpOverlay",
  "coachOverlay",
  "coachTips",
  "closeCoachButton",
  "onlineOverlay",
  "onlineServerInput",
  "onlineAdvancedSummary",
  "onlineRoomInput",
  "onlineNameInput",
  "onlineRankedToggle",
  "onlineRankedLabel",
  "findRankedButton",
  "accountUsernameInput",
  "accountPasswordInput",
  "accountStatus",
  "accountLoginButton",
  "accountRegisterButton",
  "accountPasswordButton",
  "accountLogoutButton",
  "onlineMaxPlayersSelect",
  "onlineDurationSelect",
  "onlinePlayers",
  "onlineStatus",
  "roomCodeValue",
  "roomInviteLink",
  "roomQr",
  "connectOnlineButton",
  "copyRoomButton",
  "shareRoomButton",
  "startTournamentButton",
  "closeOnlineButton",
  "tournamentOverlay",
  "tournamentResults",
  "closeTournamentButton",
  "rematchButton",
  "replayOverlay",
  "replaySummary",
  "replayTimeline",
  "startGhostButton",
  "closeReplayButton",
  "closeHelpButton",
  "shareResultButton",
  "finalScore",
  "finalLevel",
  "finalLines",
  "finalCombo",
  "finalRecord",
  "resultBadge",
  "resultHighlights",
  "gameOverTitle",
  "gameOverText",
  "gameOverInsight",
  "gameOverCoachButton",
  "gameOverReplayButton",
  "serverRecordStatus",
  "tutorialButton",
  "tutorialOverlay",
  "tutorialText",
  "tutorialSteps",
  "tutorialNextButton",
  "tutorialPlayButton",
  "closeTutorialButton",
  "toast",
  "fxLayer",
];

export function createDomCache(root = document) {
  return Object.fromEntries(UI_IDS.map((id) => [id, byId(id, root)]));
}

export const DOM =
  typeof document === "undefined" ? {} : createDomCache(document);

const UI_TEXT = {
  ru: {
    score: "Счёт",
    level: "Уровень",
    lines: "Линии",
    pause: "Пауза",
    goal: "Цель",
    rank: "Ранг",
    next: "Дальше",
    hold: "Запас",
    record: "Рекорд",
    pieces: "Фигур",
    time: "Время",
    height: "Высота",
    title: "BlockDrop",
    intro:
      "Готовая веб-версия: запускаешь и играешь. Есть сохранение, темы, рекорды, офлайн-режим и онлайн-комнаты.",
    start: "Начать игру",
    continue: "Продолжить",
    friend: "Играть с другом",
    ai: "AI соперник",
    more: "Ещё",
    aiStart: "Начать с AI",
    settings: "Настройки",
    install: "Установить офлайн",
    online: "Онлайн-комната",
    stats: "Статистика",
    help: "Как играть",
    done: "Готово",
    close: "Закрыть",
    language: "Язык",
    theme: "Тема",
    controls: "Управление",
    sensitivity: "Чувствительность",
    hand: "Рука",
    performance: "Производительность",
    vibration: "Вибрация",
    sound: "Звук",
    tutorial: "Обучение",
    tutorialNext: "Дальше",
    tutorialPlay: "Попробовать",
    understood: "Понятно",
    pauseTitle: "Пауза",
    pauseText:
      "Партия сохранена автоматически. Можно закрыть вкладку и вернуться позже.",
    restart: "Рестарт",
    mainMenu: "Главное меню",
    bestGames: "Лучшие игры",
    serverRecords: "Серверные рекорды",
    dailyLeaderboard: "Испытание дня",
    achievements: "Достижения",
    shareStats: "Поделиться статистикой",
    coach: "Бот-тренер",
    coachText: "Короткий разбор партии и 2-3 совета для следующей попытки.",
    roomCode: "Код комнаты",
    room: "Комната",
    name: "Имя",
    ranked: "Ranked PvP",
    notConnected: "Не подключено",
    tournamentServer: "Турнир",
    server: "Сервер",
    players: "Игроков",
    timer: "Таймер",
    startTournament: "Старт турнира",
    connect: "Подключиться",
    startOnlineGame: "Начать игру",
    disconnect: "Отключиться",
    copied: "Скопировано",
    roomLink: "Ссылка другу",
    tournamentDone: "Турнир завершён",
    tournamentText: "Финальная таблица комнаты.",
    rematch: "Реванш",
    gameOver: "Игра окончена",
    gameOverText: "Башня дошла до верхней границы.",
    playAgain: "Играть снова",
    coachTips: "Советы тренера",
    shareResult: "Поделиться результатом",
  },
  en: {
    score: "Score",
    level: "Level",
    lines: "Lines",
    pause: "Pause",
    goal: "Goal",
    rank: "Rank",
    next: "Next",
    hold: "Hold",
    record: "Best",
    pieces: "Pieces",
    time: "Time",
    height: "Height",
    title: "BlockDrop",
    intro:
      "A fast web version with saves, themes, records, offline mode, online rooms, and AI practice.",
    start: "Start game",
    continue: "Continue",
    friend: "Play with friend",
    ai: "AI opponent",
    more: "More",
    aiStart: "Start with AI",
    settings: "Settings",
    install: "Install offline",
    online: "Online room",
    stats: "Stats",
    help: "How to play",
    done: "Done",
    close: "Close",
    language: "Language",
    theme: "Theme",
    controls: "Controls",
    sensitivity: "Sensitivity",
    hand: "Hand",
    performance: "Performance",
    vibration: "Vibration",
    sound: "Sound",
    tutorial: "Tutorial",
    tutorialNext: "Next",
    tutorialPlay: "Try it",
    understood: "Got it",
    pauseTitle: "Paused",
    pauseText:
      "The game is saved automatically. You can close the tab and return later.",
    restart: "Restart",
    mainMenu: "Main menu",
    bestGames: "Best games",
    serverRecords: "Server records",
    dailyLeaderboard: "Daily challenge",
    achievements: "Achievements",
    shareStats: "Share stats",
    coach: "Coach bot",
    coachText: "A short review and 2-3 tips for your next attempt.",
    roomCode: "Room code",
    room: "Room",
    name: "Name",
    ranked: "Ranked PvP",
    notConnected: "Not connected",
    tournamentServer: "Tournament",
    server: "Server",
    players: "Players",
    timer: "Timer",
    startTournament: "Start tournament",
    connect: "Connect",
    startOnlineGame: "Start game",
    disconnect: "Disconnect",
    copied: "Copied",
    roomLink: "Invite link",
    tournamentDone: "Tournament finished",
    tournamentText: "Final room leaderboard.",
    rematch: "Rematch",
    gameOver: "Game over",
    gameOverText: "The stack reached the top.",
    playAgain: "Play again",
    coachTips: "Coach tips",
    shareResult: "Share result",
  },
};

const LOCALIZED_OPTIONS = {
  ru: {
    themeSelect: [
      ["ember", "Графит и мята"],
      ["day", "Светлая"],
      ["candy", "Аркада"],
      ["mono", "Минимализм"],
    ],
    languageSelect: [
      ["ru", "Русский"],
      ["en", "English"],
    ],
    controlModeSelect: [
      ["gestures", "Свайпы"],
      ["hybrid", "Свайпы + кнопки"],
      ["buttons", "Только кнопки"],
    ],
    sensitivitySelect: [
      ["low", "Низкая"],
      ["medium", "Средняя"],
      ["high", "Высокая"],
    ],
    handednessSelect: [
      ["right", "Правая"],
      ["left", "Левая"],
    ],
    performanceSelect: [
      ["auto", "Авто"],
      ["battery", "Экономия"],
      ["quality", "Качество"],
    ],
    aiDifficultySelect: [
      ["easy", "Лёгкий"],
      ["normal", "Нормальный"],
      ["hard", "Сильный"],
      ["insane", "Безумный"],
    ],
    aiStyleSelect: [
      ["balanced", "Баланс"],
      ["aggressive", "Атака"],
      ["defensive", "Защита"],
    ],
    aiPaceSelect: [
      ["calm", "Спокойный"],
      ["fair", "Ровный"],
      ["fast", "Быстрый"],
    ],
    onlineMaxPlayersSelect: [
      ["2", "1 на 1"],
      ["3", "3 игрока"],
      ["4", "4 игрока"],
      ["5", "5 игроков"],
      ["6", "6 игроков"],
      ["7", "7 игроков"],
      ["8", "8 игроков"],
    ],
    onlineDurationSelect: [
      ["120", "2 минуты"],
      ["180", "3 минуты"],
      ["300", "5 минут"],
      ["600", "10 минут"],
    ],
  },
  en: {
    themeSelect: [
      ["ember", "Graphite and mint"],
      ["day", "Light"],
      ["candy", "Arcade"],
      ["mono", "Minimal"],
    ],
    languageSelect: [
      ["ru", "Russian"],
      ["en", "English"],
    ],
    controlModeSelect: [
      ["gestures", "Swipes"],
      ["hybrid", "Swipes + buttons"],
      ["buttons", "Buttons only"],
    ],
    sensitivitySelect: [
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
    ],
    handednessSelect: [
      ["right", "Right"],
      ["left", "Left"],
    ],
    performanceSelect: [
      ["auto", "Auto"],
      ["battery", "Battery saver"],
      ["quality", "Quality"],
    ],
    aiDifficultySelect: [
      ["easy", "Easy"],
      ["normal", "Normal"],
      ["hard", "Hard"],
      ["insane", "Insane"],
    ],
    aiStyleSelect: [
      ["balanced", "Balanced"],
      ["aggressive", "Attack"],
      ["defensive", "Defense"],
    ],
    aiPaceSelect: [
      ["calm", "Calm"],
      ["fair", "Fair"],
      ["fast", "Fast"],
    ],
    onlineMaxPlayersSelect: [
      ["2", "1v1"],
      ["3", "3 players"],
      ["4", "4 players"],
      ["5", "5 players"],
      ["6", "6 players"],
      ["7", "7 players"],
      ["8", "8 players"],
    ],
    onlineDurationSelect: [
      ["120", "2 minutes"],
      ["180", "3 minutes"],
      ["300", "5 minutes"],
      ["600", "10 minutes"],
    ],
  },
};

const HELP_CONTENT = {
  ru: {
    cards: [
      [
        "Быстрый старт",
        "Обычная игра запускает выбранный режим. Daily Challenge каждый день даёт одинаковую последовательность фигур.",
      ],
      [
        "Против AI-бота",
        "Открой AI, выбери сложность, стиль и темп. Бот играет рядом, набирает очки и периодически отправляет мусорные линии.",
      ],
      [
        "С другом онлайн",
        "Нажми «Играть с другом»: комната создастся, подключится и скопирует ссылку. Друг открывает ссылку или сканирует QR.",
      ],
      [
        "Режимы",
        "Классика — рекорд. 40 линий — спринт. Дзен — спокойная игра. Хаос — периодические мусорные линии.",
      ],
    ],
    controls: [
      ["Двигать", "Свайп / ← → / A D / кнопки"],
      ["Повернуть", "Тап / ↑ / W / X / кнопка"],
      ["Поворот назад", "Двойной тап / Q"],
      ["Мягко вниз", "Свайп вниз / ↓ / S / кнопка"],
      ["Сброс", "Быстрый свайп вниз / Space / Z"],
      ["Запас", "Долгое нажатие / C / H / E / Shift"],
      ["Пауза", "P / Esc"],
    ],
  },
  en: {
    cards: [
      [
        "Quick start",
        "Standard play starts the selected mode. Daily Challenge uses the same piece sequence for everyone each day.",
      ],
      [
        "Against AI",
        "Open AI, choose difficulty, style, and pace. The bot plays beside you, scores points, and sends garbage lines.",
      ],
      [
        "Online with a friend",
        "Press Play with friend: the room is created, connected, and copied. Your friend opens the link or scans the QR.",
      ],
      [
        "Modes",
        "Classic is for high score. 40 Lines is a sprint. Zen is relaxed. Chaos adds periodic garbage lines.",
      ],
    ],
    controls: [
      ["Move", "Swipe / ← → / A D / buttons"],
      ["Rotate", "Tap / ↑ / W / X / button"],
      ["Rotate back", "Double tap / Q"],
      ["Soft drop", "Swipe down / ↓ / S / button"],
      ["Hard drop", "Fast swipe down / Space / Z"],
      ["Hold", "Long press / C / H / E / Shift"],
      ["Pause", "P / Esc"],
    ],
  },
};

export function createUi(options = {}) {
  const root = options.root || document;
  const documentRef = options.documentRef || document;
  const windowRef = options.windowRef || window;
  const performanceRef = options.performanceRef || performance;
  const refs = root === documentRef && DOM.board ? DOM : createDomCache(root);
  const ctx = refs.board.getContext("2d");
  const previews = [
    refs.next1.getContext("2d"),
    refs.next2.getContext("2d"),
    refs.next3.getContext("2d"),
  ];
  const holdCtx = refs.hold.getContext("2d");
  let toastTimer = 0;
  let tutorialIndex = 0;
  const canvasSizes = new WeakMap();

  function applySettings(settings) {
    documentRef.documentElement.dataset.theme =
      settings.theme === "ember" ? "" : settings.theme;
    documentRef.body.classList.toggle("big-buttons", settings.bigButtons);
    documentRef.body.classList.toggle("reduced-motion", settings.reducedMotion);
    documentRef.body.classList.toggle(
      "controls-hybrid",
      settings.controlMode === "hybrid",
    );
    documentRef.body.classList.toggle(
      "controls-buttons",
      settings.controlMode === "buttons",
    );
    documentRef.body.classList.toggle(
      "handed-left",
      settings.handedness === "left",
    );

    refs.themeSelect.value = settings.theme;
    refs.aiDifficultySelect.value = settings.aiDifficulty || "normal";
    refs.aiStyleSelect.value = settings.aiStyle || "balanced";
    refs.aiPaceSelect.value = settings.aiPace || "fair";
    refs.languageSelect.value = settings.language;
    refs.controlModeSelect.value = settings.controlMode;
    refs.vibrationToggle.checked = settings.vibration;
    refs.sensitivitySelect.value = settings.sensitivityPreset;
    refs.handednessSelect.value = settings.handedness;
    refs.performanceSelect.value = settings.performanceMode;
    refs.volumeRange.value = settings.volume;
    refs.volumeValue.textContent = settings.volume;
    updateThemeSwatches(settings.theme);
    applyLanguage(settings.language);
    refs.muteButton.textContent = settings.muted
      ? settings.language === "en"
        ? "Unmute"
        : "Включить звук"
      : settings.language === "en"
        ? "Mute"
        : "Выключить звук";
    refs.muteButton.classList.toggle("warn", settings.muted);
  }

  function textFor(language) {
    return UI_TEXT[language] || UI_TEXT.ru;
  }

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function setLabel(selector, value) {
    const element = documentRef.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setPlaceholder(element, value) {
    if (element) element.setAttribute("placeholder", value);
  }

  function setSelectOptions(select, options) {
    if (!select || !Array.isArray(options)) return;
    const selected = select.value;
    select.innerHTML = options
      .map(
        ([value, label]) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`,
      )
      .join("");
    if (options.some(([value]) => value === selected)) select.value = selected;
  }

  function applyLocalizedOptions(language) {
    const optionSets = LOCALIZED_OPTIONS[language] || LOCALIZED_OPTIONS.ru;
    for (const [id, options] of Object.entries(optionSets)) {
      setSelectOptions(refs[id], options);
    }
    for (const [value, label] of optionSets.themeSelect) {
      refs.themeSwatches
        .querySelector(`[data-theme-choice="${value}"]`)
        ?.setAttribute("aria-label", label);
    }
  }

  function renderHelp(language) {
    const content = HELP_CONTENT[language] || HELP_CONTENT.ru;
    const stack = documentRef.querySelector("#helpOverlay .help-stack");
    const controls = documentRef.querySelector("#helpOverlay .compact-help");
    if (stack) {
      stack.innerHTML = content.cards
        .map(
          ([title, body]) =>
            `<div class="help-card"><b>${escapeHtml(title)}</b><small>${escapeHtml(body)}</small></div>`,
        )
        .join("");
    }
    if (controls) {
      controls.innerHTML = content.controls
        .map(
          ([label, value]) =>
            `<div class="result-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`,
        )
        .join("");
    }
  }

  function applyLanguage(language = "ru") {
    const text = textFor(language);
    applyLocalizedOptions(language);
    documentRef.documentElement.lang = language;
    documentRef.title = text.title;
    const titleMeta = documentRef.querySelector(
      'meta[name="apple-mobile-web-app-title"]',
    );
    if (titleMeta) titleMeta.setAttribute("content", text.title);

    setText(
      documentRef.querySelector(".stat:nth-child(1) .stat-label"),
      text.score,
    );
    setText(
      documentRef.querySelector(".stat:nth-child(2) .stat-label"),
      text.level,
    );
    setText(
      documentRef.querySelector(".stat:nth-child(3) .stat-label"),
      text.lines,
    );
    refs.pauseButton.setAttribute("aria-label", text.pause);
    setText(
      documentRef.querySelector(".status-card:nth-child(1) > span"),
      text.goal,
    );
    setText(
      documentRef.querySelector(".status-card:nth-child(2) > span"),
      text.rank,
    );
    setText(documentRef.querySelector("#nextPanel .panel-title"), text.next);
    setText(documentRef.querySelector("#holdPanel .panel-title"), text.hold);
    setText(documentRef.querySelector("#recordValue + span"), text.record);
    setText(documentRef.querySelector("#piecesValue + span"), text.pieces);
    setText(documentRef.querySelector("#timeValue + span"), text.time);
    setText(documentRef.querySelector("#heightValue + span"), text.height);
    setText(refs.holdButton, text.hold);
    setText(refs.mainMenuButton, text.mainMenu);
    setText(refs.rotateButton, language === "en" ? "Rotate" : "Поворот");
    setText(refs.downButton, language === "en" ? "Down" : "Вниз");
    setText(refs.dropButton, language === "en" ? "Drop" : "Сброс");

    setText(documentRef.querySelector("#startOverlay h1"), text.title);
    setText(documentRef.querySelector("#startOverlay .muted"), text.intro);
    setLabel('label[for="startMode"]', language === "en" ? "Mode" : "Режим");
    setLabel(
      'label[for="aiDifficultySelect"]',
      language === "en" ? "AI difficulty" : "AI сложность",
    );
    setLabel(
      'label[for="aiStyleSelect"]',
      language === "en" ? "AI style" : "Стиль AI",
    );
    setLabel(
      'label[for="aiPaceSelect"]',
      language === "en" ? "AI pace" : "Темп AI",
    );
    setText(refs.startButton, text.start);
    setText(
      refs.dailyButton,
      language === "en" ? "Daily Challenge" : "Испытание дня",
    );
    setText(refs.continueButton, text.continue);
    setText(refs.friendButton, text.friend);
    setText(refs.aiButton, text.ai);
    setText(refs.menuMoreSummary, text.more);
    setText(documentRef.querySelector("#aiOverlay h2"), text.ai);
    setText(
      documentRef.querySelector("#aiOverlay .muted"),
      language === "en"
        ? "Choose bot behavior for the selected mode."
        : "Выбери поведение бота для партии в текущем режиме.",
    );
    setText(refs.startAiButton, text.aiStart);
    setText(refs.closeAiButton, text.mainMenu);
    setText(refs.startSettingsButton, text.settings);
    setText(refs.installButton, text.install);
    setText(refs.openStatsButton, text.stats);
    setText(
      refs.replayButton,
      language === "en" ? "Best replay" : "Повтор лучшей",
    );
    setText(refs.helpButton, text.help);

    setText(documentRef.querySelector("#settingsOverlay h2"), text.settings);
    setLabel('label[for="themeSelect"]', text.theme);
    setLabel('label[for="languageSelect"]', text.language);
    setLabel('label[for="controlModeSelect"]', text.controls);
    setLabel('label[for="sensitivitySelect"]', text.sensitivity);
    setLabel('label[for="handednessSelect"]', text.hand);
    setLabel('label[for="performanceSelect"]', text.performance);
    const vibrationRow = documentRef.querySelector(
      "#settingsOverlay .check-row",
    );
    if (vibrationRow) {
      vibrationRow.textContent = `${text.vibration} `;
      vibrationRow.appendChild(refs.vibrationToggle);
    }
    setLabel('label[for="volumeRange"]', text.sound);
    setText(refs.muteButton, language === "en" ? "Mute" : "Выключить звук");
    setText(refs.closeSettingsButton, text.done);

    setText(documentRef.querySelector("#pauseOverlay h2"), text.pauseTitle);
    setText(documentRef.querySelector("#pauseOverlay .muted"), text.pauseText);
    setText(refs.resumeButton, text.continue);
    setText(refs.pauseSettingsButton, text.settings);
    setText(refs.pauseRestartButton, text.restart);
    setText(refs.pauseMenuButton, text.mainMenu);

    setText(documentRef.querySelector("#statsOverlay h2"), text.stats);
    setText(
      documentRef.querySelector("#statsOverlay h3:nth-of-type(1)"),
      text.bestGames,
    );
    setText(
      documentRef.querySelector("#statsOverlay h3:nth-of-type(2)"),
      text.serverRecords,
    );
    setText(
      documentRef.querySelector("#statsOverlay h3:nth-of-type(3)"),
      text.dailyLeaderboard,
    );
    setText(
      documentRef.querySelector("#statsOverlay h3:nth-of-type(4)"),
      language === "en" ? "Ranked PvP" : "Ranked PvP",
    );
    setText(
      documentRef.querySelector("#statsOverlay h3:nth-of-type(5)"),
      text.achievements,
    );
    setText(refs.closeStatsButton, text.close);
    setText(refs.shareStatsButton, text.shareStats);

    setText(documentRef.querySelector("#helpOverlay h2"), text.help);
    renderHelp(language);
    setText(refs.tutorialButton, text.tutorial);
    setText(refs.closeHelpButton, text.understood);
    setText(documentRef.querySelector("#tutorialOverlay h2"), text.tutorial);
    setText(refs.tutorialNextButton, text.tutorialNext);
    setText(refs.tutorialPlayButton, text.tutorialPlay);
    setText(refs.closeTutorialButton, text.close);
    renderTutorial(language, tutorialIndex);

    setText(documentRef.querySelector("#coachOverlay h2"), text.coach);
    setText(documentRef.querySelector("#coachOverlay .muted"), text.coachText);
    setText(refs.closeCoachButton, text.understood);
    setText(documentRef.querySelector("#onlineOverlay h2"), text.online);
    setLabel('label[for="onlineRoomInput"]', text.room);
    setLabel('label[for="onlineNameInput"]', text.name);
    setText(refs.onlineRankedLabel, text.ranked);
    setLabel(
      'label[for="accountUsernameInput"]',
      language === "en" ? "Account" : "Аккаунт",
    );
    setLabel(
      'label[for="accountPasswordInput"]',
      language === "en" ? "Password" : "Пароль",
    );
    setPlaceholder(refs.accountUsernameInput, "username");
    setPlaceholder(
      refs.accountPasswordInput,
      language === "en" ? "8+ characters" : "8+ символов",
    );
    setText(refs.findRankedButton, language === "en" ? "Find ranked" : "Ranked матч");
    setText(refs.accountLoginButton, language === "en" ? "Login" : "Войти");
    setText(refs.accountRegisterButton, language === "en" ? "Register" : "Создать");
    setText(refs.accountPasswordButton, language === "en" ? "Password" : "Пароль");
    setText(refs.accountLogoutButton, language === "en" ? "Logout" : "Выйти");
    setText(documentRef.querySelector(".room-card span"), text.roomCode);
    refs.roomQr.setAttribute(
      "alt",
      language === "en" ? "Room QR code" : "QR комнаты",
    );
    setPlaceholder(
      refs.onlineRoomInput,
      language === "en" ? "Example: FRIENDS" : "Например: FRIENDS",
    );
    setPlaceholder(
      refs.onlineNameInput,
      language === "en" ? "Player" : "Игрок",
    );
    setText(refs.onlineAdvancedSummary, text.tournamentServer);
    setLabel('label[for="onlineServerInput"]', text.server);
    setLabel('label[for="onlineMaxPlayersSelect"]', text.players);
    setLabel('label[for="onlineDurationSelect"]', text.timer);
    setText(refs.startTournamentButton, text.startTournament);
    setOnlineButtonState(refs.connectOnlineButton.dataset.connected === "true");
    setText(refs.copyRoomButton, language === "en" ? "Copy" : "Скопировать");
    setText(refs.shareRoomButton, text.roomLink);
    setText(refs.closeOnlineButton, text.close);
    if (
      refs.onlineStatus.textContent === UI_TEXT.ru.notConnected ||
      refs.onlineStatus.textContent === UI_TEXT.en.notConnected
    ) {
      setText(refs.onlineStatus, text.notConnected);
    }

    setText(
      documentRef.querySelector("#tournamentOverlay h2"),
      text.tournamentDone,
    );
    setText(
      documentRef.querySelector("#tournamentOverlay .muted"),
      text.tournamentText,
    );
    setText(refs.closeTournamentButton, text.close);
    setText(refs.rematchButton, text.rematch);
    setText(refs.gameOverTitle, text.gameOver);
    setText(refs.gameOverText, text.gameOverText);
    setText(refs.playAgainButton, text.playAgain);
    setText(refs.gameOverMenuButton, text.mainMenu);
    setText(refs.gameOverCoachButton, text.coachTips);
    setText(
      refs.gameOverReplayButton,
      language === "en" ? "Best replay" : "Повтор лучшей",
    );
    setText(refs.shareResultButton, text.shareResult);
    setText(refs.gameOverStatsButton, text.stats);
    setText(
      documentRef.querySelector("#replayOverlay h2"),
      language === "en" ? "Best replay" : "Повтор лучшей",
    );
    setText(
      refs.startGhostButton,
      language === "en" ? "Play ghost run" : "Играть против призрака",
    );
    setText(refs.closeReplayButton, text.close);
    populateModeSelect(language);
  }

  function updateThemeSwatches(theme) {
    for (const button of refs.themeSwatches.querySelectorAll(
      "[data-theme-choice]",
    )) {
      button.classList.toggle("active", button.dataset.themeChoice === theme);
    }
  }

  function populateModeSelect(language = "ru") {
    const selected = normalizeModeKey(refs.startMode.value);
    refs.startMode.innerHTML = getModeOptions(language)
      .map(
        (mode) =>
          `<option value="${mode.key}">${escapeHtml(mode.name)}</option>`,
      )
      .join("");
    refs.startMode.value = selected;
    renderModeSummary(language);
  }

  function renderModeSummary(language = refs.languageSelect.value || "ru") {
    const mode = getModeOptions(language).find(
      (item) => item.key === normalizeModeKey(refs.startMode.value),
    );
    if (!mode) return;
    refs.modeSummary.innerHTML = `<b>${escapeHtml(mode.goal)}</b><small>${escapeHtml(mode.description)}</small>`;
  }

  function tutorialItems(language = "ru") {
    if (language === "en") {
      return [
        ["Move", "Swipe left/right or use arrow keys to place the piece."],
        ["Rotate", "Tap to rotate clockwise. Double tap rotates back."],
        ["Drop", "Swipe down to speed up. Fast swipe down hard drops."],
        [
          "Hold",
          "Long press, right-click the board, or press C / H / E / Shift to save a useful piece.",
        ],
        [
          "Plan",
          "Keep one side well open for the long I piece and clear 2+ lines for attacks.",
        ],
      ];
    }
    return [
      ["Движение", "Свайп влево/вправо или стрелки двигают фигуру."],
      [
        "Поворот",
        "Тап поворачивает по часовой стрелке. Двойной тап крутит назад.",
      ],
      [
        "Падение",
        "Свайп вниз ускоряет, быстрый свайп вниз делает резкий сброс.",
      ],
      ["Запас", "Долгое нажатие или кнопка Запас сохраняет полезную фигуру."],
      [
        "План",
        "Держи один край открытым под I-фигуру и чисти 2+ линии для атак.",
      ],
    ];
  }

  function renderTutorial(language = "ru", index = 0) {
    const items = tutorialItems(language);
    const safeIndex = Math.max(0, Math.min(items.length - 1, index));
    tutorialIndex = safeIndex;
    const [, body] = items[safeIndex];
    refs.tutorialText.textContent =
      language === "en"
        ? `Step ${safeIndex + 1} of ${items.length}: ${body}`
        : `Шаг ${safeIndex + 1} из ${items.length}: ${body}`;
    refs.tutorialSteps.innerHTML = items
      .map(([itemTitle], itemIndex) => {
        const active = itemIndex === safeIndex ? " active" : "";
        return `<div class="tutorial-step${active}"><b>${itemIndex + 1}</b><span>${escapeHtml(itemTitle)}</span></div>`;
      })
      .join("");
    refs.tutorialNextButton.textContent =
      safeIndex === items.length - 1
        ? language === "en"
          ? "Again"
          : "Сначала"
        : textFor(language).tutorialNext;
  }

  function updateLayoutMetrics({ cols, rows, onlineConnected }) {
    const appRect = refs.app.getBoundingClientRect();
    if (!appRect.width || !appRect.height) return null;

    const gap = appRect.width <= 420 ? 6 : appRect.width >= 760 ? 12 : 8;
    const topbarHeight = refs.topbar.offsetHeight;
    const statusHeight = refs.statusStrip.offsetHeight;
    const controlsHeight = refs.controls.offsetHeight;
    const availableHeight = Math.max(
      240,
      appRect.height - topbarHeight - statusHeight - controlsHeight - gap * 3,
    );
    const isLandscape = appRect.width / Math.max(1, appRect.height) > 1.15;
    const stacked =
      appRect.width < 500 || (isLandscape && appRect.height < 620);
    const wide = appRect.width >= 760;
    const short = appRect.height < 700;

    documentRef.body.classList.toggle("layout-stacked", stacked);
    documentRef.body.classList.toggle("layout-wide", wide);
    documentRef.body.classList.toggle("layout-short", short);

    const sideWidth = stacked
      ? Math.max(
          84,
          Math.min(
            appRect.width <= 420 ? 104 : 116,
            Math.round(appRect.width * 0.27),
          ),
        )
      : Math.max(
          74,
          Math.min(
            wide ? 156 : 108,
            Math.round(appRect.width * (wide ? 0.2 : 0.23)),
          ),
        );
    const boardAvailWidth = appRect.width - sideWidth - gap - 14;
    const widthCell = boardAvailWidth / cols;
    const onlineReserve = stacked && onlineConnected ? 32 : 0;
    const boardAvailHeight = availableHeight - onlineReserve - 14;
    const cellFloor = stacked && appRect.width <= 420 ? 10 : 12;
    const cell = Math.max(
      cellFloor,
      Math.floor(Math.min(widthCell, boardAvailHeight / rows)),
    );
    const boardWidth = cell * cols;
    const boardHeight = cell * rows;
    const boardPad = cell <= 18 ? 5 : cell <= 26 ? 6 : 8;
    const previewMain = Math.max(
      34,
      Math.min(
        stacked ? 72 : wide ? 104 : 86,
        Math.round(sideWidth - boardPad * 2 - 8),
      ),
    );
    const previewSmall = Math.max(
      34,
      Math.min(72, Math.round(previewMain * 0.76)),
    );

    documentRef.documentElement.style.setProperty("--layout-gap", `${gap}px`);
    documentRef.documentElement.style.setProperty(
      "--side-width",
      `${sideWidth}px`,
    );
    documentRef.documentElement.style.setProperty(
      "--board-width",
      `${boardWidth}px`,
    );
    documentRef.documentElement.style.setProperty(
      "--board-height",
      `${boardHeight}px`,
    );
    documentRef.documentElement.style.setProperty(
      "--board-pad",
      `${boardPad}px`,
    );
    documentRef.documentElement.style.setProperty(
      "--preview-main",
      `${previewMain}px`,
    );
    documentRef.documentElement.style.setProperty(
      "--preview-small",
      `${previewSmall}px`,
    );
    documentRef.documentElement.style.setProperty(
      "--game-area-height",
      `${boardHeight + boardPad * 2}px`,
    );

    return { stacked, wide, short, cell, boardWidth, boardHeight };
  }

  function resizeCanvas(canvas, width, height) {
    const ratio = Math.max(1, Math.min(3, windowRef.devicePixelRatio || 1));
    const targetWidth = Math.max(1, Math.floor(width * ratio));
    const targetHeight = Math.max(1, Math.floor(height * ratio));
    const cached = canvasSizes.get(canvas);
    if (
      cached?.width === targetWidth &&
      cached?.height === targetHeight &&
      cached?.ratio === ratio
    ) {
      return canvas.getContext("2d");
    }
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvasSizes.set(canvas, {
      width: targetWidth,
      height: targetHeight,
      ratio,
    });
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
    return context;
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

  function chamfer(context, x, y, w, h, cut, fill, stroke) {
    context.beginPath();
    context.moveTo(x + cut, y);
    context.lineTo(x + w - cut, y);
    context.lineTo(x + w, y + cut);
    context.lineTo(x + w, y + h - cut);
    context.lineTo(x + w - cut, y + h);
    context.lineTo(x + cut, y + h);
    context.lineTo(x, y + h - cut);
    context.lineTo(x, y + cut);
    context.closePath();
    if (fill) context.fill();
    if (stroke) context.stroke();
  }

  function drawBlockShape(context, theme, x, y, side, radius, fill, stroke) {
    if (theme === "day") {
      chamfer(
        context,
        x,
        y,
        side,
        side,
        Math.max(3, side * 0.13),
        fill,
        stroke,
      );
      return;
    }
    if (theme === "mono") {
      round(context, x, y, side, side, Math.max(1, side * 0.03), fill, stroke);
      return;
    }
    round(context, x, y, side, side, radius, fill, stroke);
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

  function normalizeCell(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    return value.kind || null;
  }

  function drawCell(context, x, y, size, value, alpha, renderConfig) {
    const { settings, palettes } = renderConfig;
    const kind = normalizeCell(value);
    const palette = settings.colorBlind
      ? palettes.safe
      : palettes.themes[settings.theme] || palettes.base;
    const color = palette[kind] || palette.X || palettes.base.X;
    const theme = settings.theme;
    const pad = Math.max(
      1,
      size *
        (theme === "mono"
          ? 0.12
          : theme === "candy"
            ? 0.04
            : theme === "day"
              ? 0.08
              : 0.06),
    );
    const side = size - pad * 2;
    const radius =
      theme === "mono"
        ? Math.max(1, size * 0.03)
        : theme === "candy"
          ? Math.max(6, size * 0.28)
          : Math.max(3, size * 0.15);
    context.globalAlpha = alpha;
    if (!kind) {
      context.fillStyle = "rgba(255,255,255,0.035)";
      drawBlockShape(
        context,
        theme,
        x + pad,
        y + pad,
        side,
        radius,
        true,
        false,
      );
      context.globalAlpha = 1;
      return;
    }

    const gradient = context.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, shade(color, theme === "day" ? -12 : -22));
    context.fillStyle = gradient;
    drawBlockShape(context, theme, x + pad, y + pad, side, radius, true, false);
    if (theme !== "mono") {
      context.fillStyle =
        theme === "candy"
          ? "rgba(255,255,255,0.30)"
          : theme === "day"
            ? "rgba(255,255,255,0.12)"
            : "rgba(255,255,255,0.16)";
      if (theme === "day") {
        chamfer(
          context,
          x + pad + side * 0.22,
          y + pad + side * 0.22,
          side * 0.56,
          side * 0.56,
          Math.max(2, side * 0.08),
          true,
          false,
        );
      } else {
        round(
          context,
          x + pad + 3,
          y + pad + 3,
          Math.max(2, side - 6),
          Math.max(5, side * 0.22),
          Math.max(2, size * 0.08),
          true,
          false,
        );
      }
    }
    context.strokeStyle =
      theme === "mono"
        ? "rgba(255,255,255,0.40)"
        : theme === "day"
          ? "rgba(23,32,51,0.18)"
          : "rgba(255,255,255,0.18)";
    drawBlockShape(context, theme, x + pad, y + pad, side, radius, false, true);
    context.globalAlpha = 1;
  }

  function drawPreview(context, canvas, value, renderConfig) {
    const kind = normalizeCell(value);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    const size = Math.min(width, height) / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const filled =
          kind &&
          renderConfig.shapes[kind][0].some(([sx, sy]) => sx === x && sy === y);
        drawCell(
          context,
          x * size + 2,
          y * size + 2,
          size - 2,
          filled ? kind : null,
          filled ? 1 : 0.5,
          renderConfig,
        );
      }
    }
  }

  function renderGame(renderState, renderConfig) {
    const {
      cols,
      rows,
      board,
      active,
      ghost,
      queue,
      hold,
      flashes,
      opponentHeight,
    } = renderState;
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
    ctx.fillStyle = "rgba(24, 31, 39, 0.92)";
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
        drawCell(
          ctx,
          x0 + x * cell,
          y * cell,
          cell,
          board[y][x],
          1,
          renderConfig,
        );
      }
    }

    if (renderConfig.settings.ghost && ghost) {
      for (const cellData of ghost)
        drawCell(
          ctx,
          x0 + cellData.x * cell,
          cellData.y * cell,
          cell,
          active,
          0.22,
          renderConfig,
        );
    }

    if (active) {
      for (const cellData of active.cells)
        drawCell(
          ctx,
          x0 + cellData.x * cell,
          cellData.y * cell,
          cell,
          active,
          1,
          renderConfig,
        );
    }

    if (renderConfig.settings.grid) {
      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= cols; x += 1)
        line(ctx, x0 + x * cell, 0, x0 + x * cell, rows * cell);
      for (let y = 0; y <= rows; y += 1)
        line(ctx, x0, y * cell, x0 + boardWidth, y * cell);
    }

    for (const flash of flashes) {
      const stripWidth = boardWidth * flash.width;
      const stripX = x0 + (boardWidth - stripWidth) / 2;
      const gradient = ctx.createLinearGradient(
        stripX,
        0,
        stripX + stripWidth,
        0,
      );
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      const flashColors = {
        ember: [86, 223, 186],
        day: [22, 127, 114],
        candy: [255, 207, 86],
        mono: [217, 208, 189],
      };
      const [fr, fg, fb] =
        flashColors[renderConfig.settings.theme] || flashColors.ember;
      gradient.addColorStop(
        0.5,
        `rgba(${fr},${fg},${fb},${0.68 * flash.life})`,
      );
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(stripX, flash.row * cell, stripWidth, cell);
      ctx.fillStyle = `rgba(${fr},${fg},${fb},${0.24 * flash.life})`;
      ctx.fillRect(
        x0,
        flash.row * cell + cell * 0.42,
        boardWidth,
        Math.max(2, cell * 0.16),
      );
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
    refs.comboValue.textContent = payload.streak
      ? `${payload.combo}/${payload.streak}`
      : payload.combo;
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
    refs.resultBadge.textContent = payload.badge || "";
    refs.resultHighlights.innerHTML = (payload.highlights || [])
      .map(
        (item) =>
          `<div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`,
      )
      .join("");
    refs.gameOverInsight.innerHTML = payload.insight;
    refs.serverRecordStatus.textContent = payload.serverStatus;
    refs.gameOverOverlay.hidden = false;
  }

  function setPauseVisible(visible) {
    refs.pauseOverlay.hidden = !visible;
  }

  function hideOverlays() {
    refs.startOverlay.hidden = true;
    refs.aiOverlay.hidden = true;
    refs.pauseOverlay.hidden = true;
    refs.settingsOverlay.hidden = true;
    refs.statsOverlay.hidden = true;
    refs.helpOverlay.hidden = true;
    refs.coachOverlay.hidden = true;
    refs.onlineOverlay.hidden = true;
    refs.tournamentOverlay.hidden = true;
    refs.replayOverlay.hidden = true;
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
    return normalizeModeKey(refs.startMode.value);
  }

  function setStartMode(mode) {
    refs.startMode.value = normalizeModeKey(mode);
  }

  function getVisiblePrimaryOverlay() {
    if (!refs.gameOverOverlay.hidden) return "gameOverOverlay";
    if (!refs.startOverlay.hidden) return "startOverlay";
    if (!refs.pauseOverlay.hidden) return "pauseOverlay";
    return null;
  }

  function renderOnlinePlayers(players, tournament, formatTime) {
    const language = refs.languageSelect.value;
    const text = textFor(language);
    refs.onlinePlayers.innerHTML = players.length
      ? players
          .map(
            (player) =>
              `<div class="result-row"><span>${escapeHtml(player.name)} · ${escapeHtml(player.status)}</span><span>${player.score}</span></div>`,
          )
          .join("")
      : `<div class="result-row"><span>${escapeHtml(language === "en" ? "No players yet" : "Игроков пока нет")}</span><span>0</span></div>`;
    if (tournament?.active) {
      refs.onlineStatus.textContent = `${text.tournamentServer}: ${formatTime(tournament.timeLeftMs)} · ${players.length}/${tournament.maxPlayers}`;
    }
  }

  function renderOnlinePanel({
    connected,
    room,
    tournament,
    players,
    formatTime,
  }) {
    if (!connected) {
      refs.onlinePanel.classList.remove("active");
      refs.onlinePanel.innerHTML = "";
      return;
    }
    refs.onlinePanel.classList.add("active");
    const text = textFor(refs.languageSelect.value);
    const timer = tournament?.active
      ? `<div class="online-timer">${escapeHtml(text.tournamentServer)}: ${formatTime(tournament.timeLeftMs)}</div>`
      : "";
    const label =
      room === "AI"
        ? text.ai
        : `${refs.languageSelect.value === "en" ? "Online" : "Онлайн"} ${escapeHtml(room)}`;
    refs.onlinePanel.innerHTML =
      timer +
      `<div class="mission done"><span>${label}</span><b>${players.length}</b></div>` +
      players
        .map(
          (player) =>
            `<div class="online-player"><span>${escapeHtml(player.name)}</span><b>${player.score}</b></div>`,
        )
        .join("");
  }

  function renderTournamentResults(players, stateWasRunning) {
    const noResults =
      refs.languageSelect.value === "en" ? "No results" : "Нет результатов";
    refs.tournamentResults.innerHTML = players.length
      ? players
          .map(
            (player, index) =>
              `<div class="result-row"><span>${index + 1}. ${escapeHtml(player.name)} · ${escapeHtml(player.status)}</span><span>${player.score}</span></div>`,
          )
          .join("")
      : `<div class="result-row"><span>${escapeHtml(noResults)}</span><span>0</span></div>`;
    refs.tournamentOverlay.hidden = false;
    return stateWasRunning;
  }

  function renderStats({
    statsRows,
    scores,
    serverRecords,
    dailyLeaderboard = [],
    dailyLeaderboardDate = "",
    rankedLeaderboard = [],
    achievements,
  }) {
    const language = refs.languageSelect.value;
    refs.statsGrid.classList.add("stats-cards");
    refs.statsGrid.innerHTML = statsRows
      .map((item) => {
        const progress = Number.isFinite(item.progress)
          ? `<i style="width:${Math.max(0, Math.min(100, item.progress))}%"></i>`
          : "";
        const note = item.note ? `<small>${escapeHtml(item.note)}</small>` : "";
        const track = progress
          ? `<div class="stats-progress">${progress}</div>`
          : "";
        return `<div class="stats-card"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b>${note}${track}</div>`;
      })
      .join("");
    refs.leaderboard.innerHTML = scores.length
      ? scores
          .map(
            (entry, index) =>
              `<div class="score-row"><span>${index + 1}. ${escapeHtml(entry.mode)}, ${escapeHtml(entry.date)}</span><span>${entry.score}</span></div>`,
          )
          .join("")
      : `<div class="score-row"><span>${language === "en" ? "No games yet" : "Пока пусто"}</span><span>0</span></div>`;
    refs.serverLeaderboard.innerHTML = serverRecords.length
      ? serverRecords
          .map(
            (entry, index) =>
              `<div class="score-row"><span>${index + 1}. ${escapeHtml(entry.name)} · ${escapeHtml(entry.mode)} · ${escapeHtml(entry.date)}</span><span>${entry.score}</span></div>`,
          )
          .join("")
      : `<div class="score-row"><span>${language === "en" ? "No server records yet" : "Пока нет связи с сервером"}</span><span>—</span></div>`;
    refs.dailyLeaderboardTitle.textContent = dailyLeaderboardDate
      ? `${
          language === "en" ? "Daily challenge" : "Испытание дня"
        } ${dailyLeaderboardDate}`
      : language === "en"
        ? "Daily challenge"
        : "Испытание дня";
    refs.dailyLeaderboard.innerHTML = dailyLeaderboard.length
      ? dailyLeaderboard
          .map(
            (entry, index) =>
              `<div class="score-row"><span>${index + 1}. ${escapeHtml(entry.name)} В· ${entry.lines}L В· ${escapeHtml(entry.time)}</span><span>${entry.score}</span></div>`,
          )
          .join("")
      : `<div class="score-row"><span>${language === "en" ? "No daily runs yet" : "Пока нет ежедневных результатов"}</span><span>—</span></div>`;
    refs.rankedLeaderboardTitle.textContent =
      language === "en" ? "Ranked PvP" : "Ranked PvP";
    refs.rankedLeaderboard.innerHTML = rankedLeaderboard.length
      ? rankedLeaderboard
          .map(
            (entry, index) =>
              `<div class="score-row"><span>#${index + 1} ${escapeHtml(entry.name)}</span><span>${entry.rating} MMR · ${entry.wins}-${entry.losses}</span></div>`,
          )
          .join("")
      : `<div class="score-row"><span>${language === "en" ? "No ranked matches yet" : "Пока нет ranked матчей"}</span><span>—</span></div>`;
    refs.achievementsList.innerHTML = achievements
      .map((item) => {
        const prefix = item.unlocked ? "✓ " : "";
        return `<div class="achievement"><b>${prefix}${escapeHtml(item.title)}</b><small>${escapeHtml(item.description)}</small></div>`;
      })
      .join("");
  }

  function renderReplay(ghostRun, formatTime) {
    if (
      !ghostRun ||
      !Array.isArray(ghostRun.samples) ||
      ghostRun.samples.length === 0
    ) {
      refs.replaySummary.textContent =
        refs.languageSelect.value === "en"
          ? "Replay appears after a new local best."
          : "Запись появится после нового локального рекорда.";
      refs.replayTimeline.innerHTML = "";
      refs.startGhostButton.disabled = true;
      refs.replayOverlay.hidden = false;
      return;
    }

    refs.startGhostButton.disabled = false;
    const summaryParts = [];
    if (ghostRun.summary?.bestMoment) summaryParts.push(ghostRun.summary.bestMoment);
    if (ghostRun.summary?.bestBackToBack)
      summaryParts.push(`B2B x${ghostRun.summary.bestBackToBack}`);
    if (ghostRun.summary?.perfectClears)
      summaryParts.push(`PC ${ghostRun.summary.perfectClears}`);
    refs.replaySummary.textContent = [
      ghostRun.score,
      ghostRun.mode,
      new Date(ghostRun.date).toLocaleDateString("ru-RU"),
      ...summaryParts,
    ].join(" · ");
    const maxHeight = Math.max(
      1,
      ...ghostRun.samples.map((sample) => Number(sample.height) || 0),
    );
    const maxScore = Math.max(
      1,
      ...ghostRun.samples.map((sample) => Number(sample.score) || 0),
    );
    refs.replayTimeline.innerHTML = ghostRun.samples
      .slice(-32)
      .map((sample) => {
        const height = Math.max(
          4,
          Math.round(((Number(sample.height) || 0) / maxHeight) * 100),
        );
        const score = Math.max(
          4,
          Math.round(((Number(sample.score) || 0) / maxScore) * 100),
        );
        return `<div class="replay-step"><span>${escapeHtml(formatTime(sample.time))}</span><i style="height:${height}%"></i><b style="height:${score}%"></b></div>`;
      })
      .join("");
    refs.replayOverlay.hidden = false;
  }

  function renderMenuRecords({
    bestScore,
    lastGame,
    sprintBest,
    dailyBest,
    serverTop,
  }) {
    const text = textFor(refs.languageSelect.value);
    const empty = "—";
    refs.menuRecords.innerHTML = [
      [text.record, bestScore || 0],
      [
        refs.languageSelect.value === "en" ? "Last" : "Последняя",
        lastGame ? `${lastGame.score} · ${lastGame.mode}` : empty,
      ],
      ["Sprint", sprintBest || empty],
      ["Daily", dailyBest || empty],
      [
        refs.languageSelect.value === "en" ? "Server" : "Сервер",
        serverTop ? `${serverTop.score} · ${serverTop.name}` : empty,
      ],
    ]
      .map(
        ([label, value]) =>
          `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`,
      )
      .join("");
  }

  function renderCoachTips(items) {
    refs.coachTips.innerHTML = items
      .map(
        ([title, body]) =>
          `<div class="achievement"><b>${title}</b><small>${body}</small></div>`,
      )
      .join("");
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
      ranked: Boolean(refs.onlineRankedToggle?.checked),
      maxPlayers: Number(refs.onlineMaxPlayersSelect.value),
      durationSec: Number(refs.onlineDurationSelect.value),
    };
  }

  function setOnlineRoom(room) {
    refs.onlineRoomInput.value = room;
  }

  function setOnlineRanked(ranked) {
    if (refs.onlineRankedToggle) refs.onlineRankedToggle.checked = Boolean(ranked);
  }

  function renderRoomInvite({ room, url }) {
    refs.roomCodeValue.textContent = room || "----";
    refs.roomInviteLink.textContent =
      url ||
      (refs.languageSelect.value === "en"
        ? "The link appears after room creation"
        : "Ссылка появится после генерации");
    refs.roomQr.hidden = !url;
    if (url)
      refs.roomQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=128x128&margin=8&data=${encodeURIComponent(url)}`;
  }

  function setOnlineStatus(text) {
    refs.onlineStatus.textContent = text;
  }

  function setOnlineButtonState(connected) {
    const text = textFor(refs.languageSelect.value);
    refs.connectOnlineButton.dataset.connected = connected ? "true" : "false";
    refs.connectOnlineButton.dataset.action = connected ? "start" : "connect";
    refs.connectOnlineButton.textContent = connected
      ? text.startOnlineGame
      : text.connect;
    refs.connectOnlineButton.classList.add("primary");
  }

  function getAccountForm() {
    return {
      username: refs.accountUsernameInput.value.trim(),
      password: refs.accountPasswordInput.value,
      displayName: refs.onlineNameInput.value.trim(),
    };
  }

  function setAccountStatus(text) {
    refs.accountStatus.textContent = text;
  }

  function setAccountSession(account) {
    const language = refs.languageSelect.value;
    if (!account) {
      refs.accountStatus.textContent = language === "en" ? "Guest" : "Гость";
      return;
    }
    refs.accountUsernameInput.value = account.username || "";
    refs.onlineNameInput.value = account.displayName || account.username || "";
    refs.accountStatus.textContent =
      language === "en"
        ? `Signed in: ${account.displayName || account.username}`
        : `Аккаунт: ${account.displayName || account.username}`;
  }

  function updateInstallButton(visible) {
    refs.installButton.classList.toggle("hidden", !visible);
  }

  function showToast(text) {
    if (!String(text || "").trim()) return;
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

  function pulseScore(reducedMotion) {
    if (reducedMotion) return;
    refs.scoreValue.classList.remove("score-pop");
    void refs.scoreValue.offsetWidth;
    refs.scoreValue.classList.add("score-pop");
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
      particle.style.setProperty(
        "--dx",
        `${Math.cos(i * 1.7) * (60 + Math.random() * 110)}px`,
      );
      particle.style.setProperty(
        "--dy",
        `${Math.sin(i * 1.7) * (60 + Math.random() * 110)}px`,
      );
      refs.fxLayer.appendChild(particle);
      setTimeout(() => particle.remove(), 760);
    }
  }

  function bindPress(element, handler) {
    const TAP_MOVE_LIMIT_PX = 12;
    let ignoreClickUntil = 0;
    let pointerPress = null;
    const run = (event) => {
      event.preventDefault();
      handler();
    };
    element.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) return;
      pointerPress = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
    });
    element.addEventListener("pointermove", (event) => {
      if (!pointerPress || pointerPress.id !== event.pointerId) return;
      const moved = Math.hypot(
        event.clientX - pointerPress.x,
        event.clientY - pointerPress.y,
      );
      if (moved > TAP_MOVE_LIMIT_PX) pointerPress.moved = true;
    });
    element.addEventListener("pointerup", (event) => {
      if (!pointerPress || pointerPress.id !== event.pointerId) return;
      const shouldRun = !pointerPress.moved;
      pointerPress = null;
      ignoreClickUntil = performanceRef.now() + 450;
      if (shouldRun) run(event);
      else event.preventDefault();
    });
    element.addEventListener("pointercancel", () => {
      pointerPress = null;
    });
    element.addEventListener("pointerleave", () => {
      if (pointerPress) pointerPress.moved = true;
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
    bindPress(refs.dailyButton, callbacks.startDailyChallenge);
    bindPress(refs.continueButton, callbacks.loadCurrentGame);
    bindPress(refs.friendButton, callbacks.playWithFriend);
    bindPress(refs.aiButton, callbacks.openAiSettings);
    bindPress(refs.startAiButton, callbacks.startAiGame);
    bindPress(refs.closeAiButton, callbacks.closeAiSettings);
    bindPress(refs.startSettingsButton, callbacks.openSettings);
    bindPress(refs.installButton, callbacks.installApp);
    bindPress(refs.openStatsButton, callbacks.openStats);
    bindPress(refs.replayButton, callbacks.openReplay);
    bindPress(refs.helpButton, callbacks.openHelp);
    bindPress(refs.closeHelpButton, callbacks.closeHelp);
    bindPress(refs.tutorialButton, callbacks.openTutorial);
    bindPress(refs.tutorialNextButton, () => {
      const language = refs.languageSelect.value || "ru";
      const nextIndex = (tutorialIndex + 1) % tutorialItems(language).length;
      renderTutorial(language, nextIndex);
    });
    bindPress(refs.tutorialPlayButton, callbacks.startTutorialGame);
    bindPress(refs.closeTutorialButton, callbacks.closeTutorial);
    bindPress(refs.closeCoachButton, callbacks.closeCoach);
    bindPress(refs.connectOnlineButton, callbacks.toggleOnlineConnection);
    bindPress(refs.findRankedButton, callbacks.findRankedMatch);
    bindPress(refs.accountLoginButton, callbacks.loginAccount);
    bindPress(refs.accountRegisterButton, callbacks.registerAccount);
    bindPress(refs.accountPasswordButton, callbacks.changeAccountPassword);
    bindPress(refs.accountLogoutButton, callbacks.logoutAccount);
    bindPress(refs.copyRoomButton, callbacks.copyRoomLink);
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
    bindPress(refs.muteButton, callbacks.toggleMute);
    bindPress(refs.closeStatsButton, callbacks.closeStats);
    bindPress(refs.shareStatsButton, callbacks.shareStats);
    bindPress(refs.gameOverStatsButton, callbacks.openStats);
    bindPress(refs.gameOverCoachButton, callbacks.openCoach);
    bindPress(refs.gameOverReplayButton, callbacks.openReplay);
    bindPress(refs.shareResultButton, callbacks.shareResult);
    bindPress(refs.startGhostButton, callbacks.startGhostRun);
    bindPress(refs.closeReplayButton, callbacks.closeReplay);
    bindPress(refs.holdButton, callbacks.holdPiece);
    bindRepeat(refs.leftButton, callbacks.moveLeft);
    bindRepeat(refs.rightButton, callbacks.moveRight);
    bindRepeat(refs.downButton, callbacks.softDrop, 58);
    bindPress(refs.rotateButton, callbacks.rotate);
    bindPress(refs.dropButton, callbacks.hardDrop);

    refs.themeSelect.addEventListener("change", () =>
      callbacks.changeSetting("theme", refs.themeSelect.value),
    );
    refs.themeSwatches.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-choice]");
      if (!button) return;
      refs.themeSelect.value = button.dataset.themeChoice;
      callbacks.changeSetting("theme", refs.themeSelect.value);
    });
    refs.aiDifficultySelect.addEventListener("change", () =>
      callbacks.changeSetting("aiDifficulty", refs.aiDifficultySelect.value),
    );
    refs.aiStyleSelect.addEventListener("change", () =>
      callbacks.changeSetting("aiStyle", refs.aiStyleSelect.value),
    );
    refs.aiPaceSelect.addEventListener("change", () =>
      callbacks.changeSetting("aiPace", refs.aiPaceSelect.value),
    );
    refs.startMode.addEventListener("change", () => {
      renderModeSummary(refs.languageSelect.value || "ru");
      callbacks.changeSetting("lastMode", refs.startMode.value);
    });
    refs.languageSelect.addEventListener("change", () =>
      callbacks.changeSetting("language", refs.languageSelect.value),
    );
    refs.controlModeSelect.addEventListener("change", () =>
      callbacks.changeSetting("controlMode", refs.controlModeSelect.value),
    );
    refs.sensitivitySelect.addEventListener("change", () =>
      callbacks.changeSetting(
        "sensitivityPreset",
        refs.sensitivitySelect.value,
      ),
    );
    refs.handednessSelect.addEventListener("change", () =>
      callbacks.changeSetting("handedness", refs.handednessSelect.value),
    );
    refs.performanceSelect.addEventListener("change", () =>
      callbacks.changeSetting("performanceMode", refs.performanceSelect.value),
    );
    refs.vibrationToggle.addEventListener("change", () =>
      callbacks.changeSetting("vibration", refs.vibrationToggle.checked),
    );
    refs.volumeRange.addEventListener("input", () =>
      callbacks.changeSetting("volume", Number(refs.volumeRange.value)),
    );
  }

  function bindWindowEvents(callbacks) {
    documentRef.addEventListener(
      "visibilitychange",
      callbacks.visibilityChange,
    );
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
    refs.board.addEventListener("touchstart", callbacks.touchstart, {
      passive: false,
    });
    refs.board.addEventListener("touchmove", callbacks.touchmove, {
      passive: false,
    });
    refs.board.addEventListener("touchend", callbacks.touchend, {
      passive: false,
    });
    refs.board.addEventListener("touchcancel", callbacks.touchcancel, {
      passive: false,
    });
  }

  function bindBoardPointer(callbacks) {
    const target = refs.boardShell;
    target.addEventListener("pointerdown", callbacks.pointerdown, {
      passive: false,
    });
    target.addEventListener("pointermove", callbacks.pointermove, {
      passive: false,
    });
    target.addEventListener("pointerup", callbacks.pointerup, {
      passive: false,
    });
    target.addEventListener("pointercancel", callbacks.pointercancel, {
      passive: false,
    });
    target.addEventListener("contextmenu", callbacks.contextmenu);
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
    renderReplay,
    renderMenuRecords,
    renderCoachTips,
    setServerRecordStatus,
    setOnlineDefaults,
    getOnlineForm,
    getAccountForm,
    setAccountStatus,
    setAccountSession,
    setOnlineRoom,
    setOnlineRanked,
    renderRoomInvite,
    setOnlineStatus,
    setOnlineButtonState,
    updateInstallButton,
    showToast,
    shakeBoard,
    pulseScore,
    burst,
    bindControls,
    bindWindowEvents,
    bindBoardTouch,
    bindBoardPointer,
  };
}
