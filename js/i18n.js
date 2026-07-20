// The only source of static RU/EN interface copy. Keep both locales in parity.
// Runtime interpolation belongs in callers; untranslated keys fail tests.
export const UI_TEXT = {
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
    mute: "Выключить звук",
    unmute: "Включить звук",
    sidePanelLabel: "Игровая статистика и следующие фигуры",
    rotate: "Поворот",
    down: "Вниз",
    drop: "Сброс",
    modeLabel: "Режим",
    aiDifficulty: "Сложность AI",
    aiStyle: "Стиль AI",
    aiPace: "Темп AI",
    dailyChallenge: "Испытание дня",
    aiDescription: "Выбери поведение бота для партии в текущем режиме.",
    bestReplay: "Повтор лучшей",
    account: "Аккаунт",
    password: "Пароль",
    passwordHint: "8+ символов",
    findRanked: "Ranked матч",
    login: "Войти",
    register: "Создать",
    logout: "Выйти",
    roomQrAlt: "QR комнаты",
    roomExample: "Например: FRIENDS",
    player: "Игрок",
    createRoom: "Создать комнату",
    joinByCode: "Войти по коду",
    copy: "Скопировать",
    playGhost: "Играть против призрака",
    watchReplay: "Смотреть повтор",
    replaySpeed: "Скорость повтора",
    speed: "Скорость",
    skip: "Пропустить",
    noPlayers: "Игроков пока нет",
    noResults: "Нет результатов",
    noGames: "Пока пусто",
    noServerRecords: "Пока нет связи с сервером",
    noDailyRuns: "Пока нет ежедневных результатов",
    noRankedMatches: "Пока нет ranked матчей",
    replayMissing: "Повтор появится после нового локального рекорда.",
    securityNotice:
      "Аккаунты и рейтинговые матчи включатся после подключения HTTPS. Обычные комнаты уже доступны по текущему адресу.",
    guest: "Гость",
    signedIn: "Аккаунт: {name}",
    linkPending: "Ссылка появится после генерации",
    again: "Сначала",
    last: "Последняя",
    emptyBoard: "поле пустое",
    empty: "пусто",
    none: "нет",
    boardLabel: "Игровое поле BlockDrop",
    boardState:
      "Активная фигура {active}. Далее {next}. Запас {hold}. Занятые клетки по строкам: {rows}.",
    analyticsConsent: "Анонимная аналитика",
    analyticsHint:
      "Только события экранов и партий, без поля, действий, паролей и IP.",
    masteryProfile: "Профиль мастерства",
    masteryLevel: "Уровень",
    xp: "Опыт",
    gamesPlayed: "Игр",
    quests: "Задания",
    cosmetic: "Косметика",
    exportProgress: "Экспорт прогресса",
    importProgress: "Импорт прогресса",
    dailyQuest: "Ежедневное",
    weeklyQuest: "Еженедельное",
    questGames: "Сыграть партии",
    questLines: "Очистить линии",
    questHardDrops: "Сделать резкие сбросы",
    questWins: "Победить",
    cosmeticMintTrail: "Мятный след",
    cosmeticAmberBlocks: "Янтарное свечение",
    cosmeticCandySpark: "Аркадная искра",
    cosmeticMonoGhost: "Моно-призрак",
    updateAvailable: "Доступна новая версия",
    updateSafely: "Обновить безопасно",
    updateAfterMatch: "Обновление установится после партии",
    privacy: "Конфиденциальность",
    betaTerms: "Условия beta",
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
    mute: "Mute",
    unmute: "Unmute",
    sidePanelLabel: "Game statistics and upcoming pieces",
    rotate: "Rotate",
    down: "Down",
    drop: "Drop",
    modeLabel: "Mode",
    aiDifficulty: "AI difficulty",
    aiStyle: "AI style",
    aiPace: "AI pace",
    dailyChallenge: "Daily Challenge",
    aiDescription: "Choose bot behavior for the selected mode.",
    bestReplay: "Best replay",
    account: "Account",
    password: "Password",
    passwordHint: "8+ characters",
    findRanked: "Find ranked",
    login: "Login",
    register: "Register",
    logout: "Logout",
    roomQrAlt: "Room QR code",
    roomExample: "Example: FRIENDS",
    player: "Player",
    createRoom: "Create room",
    joinByCode: "Join by code",
    copy: "Copy",
    playGhost: "Play ghost run",
    watchReplay: "Watch replay",
    replaySpeed: "Replay speed",
    speed: "Speed",
    skip: "Skip",
    noPlayers: "No players yet",
    noResults: "No results",
    noGames: "No games yet",
    noServerRecords: "No server records yet",
    noDailyRuns: "No daily runs yet",
    noRankedMatches: "No ranked matches yet",
    replayMissing: "Replay appears after a new local best.",
    securityNotice:
      "Accounts and ranked matches will become available over HTTPS. Casual rooms work on this address.",
    guest: "Guest",
    signedIn: "Signed in: {name}",
    linkPending: "The link appears after room creation",
    again: "Again",
    last: "Last",
    emptyBoard: "empty board",
    empty: "empty",
    none: "none",
    boardLabel: "BlockDrop game board",
    boardState:
      "Active {active}. Next {next}. Hold {hold}. Occupied cells by row: {rows}.",
    analyticsConsent: "Anonymous analytics",
    analyticsHint:
      "Screen and game events only; never boards, inputs, passwords, or IP addresses.",
    masteryProfile: "Mastery profile",
    masteryLevel: "Level",
    xp: "XP",
    gamesPlayed: "Games",
    quests: "Quests",
    cosmetic: "Cosmetic",
    exportProgress: "Export progress",
    importProgress: "Import progress",
    dailyQuest: "Daily",
    weeklyQuest: "Weekly",
    questGames: "Play games",
    questLines: "Clear lines",
    questHardDrops: "Use hard drops",
    questWins: "Win games",
    cosmeticMintTrail: "Mint trail",
    cosmeticAmberBlocks: "Amber glow",
    cosmeticCandySpark: "Candy spark",
    cosmeticMonoGhost: "Mono ghost",
    updateAvailable: "A new version is available",
    updateSafely: "Update safely",
    updateAfterMatch: "The update will install after this game",
    privacy: "Privacy",
    betaTerms: "Beta terms",
  },
};

export const LOCALIZED_OPTIONS = {
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

export const HELP_CONTENT = {
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
    tutorial: [
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
    ],
    tutorialStep: "Шаг {step} из {total}: {body}",
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
    tutorial: [
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
    ],
    tutorialStep: "Step {step} of {total}: {body}",
  },
};

export function assertCatalogParity(catalog = UI_TEXT) {
  const reference = Object.keys(catalog.ru || {}).sort();
  for (const [locale, messages] of Object.entries(catalog)) {
    const keys = Object.keys(messages || {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(reference)) {
      throw new Error(`Locale ${locale} does not match the RU catalog`);
    }
  }
  return true;
}

function catalogShape(value) {
  if (Array.isArray(value)) {
    return value.map(catalogShape);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, catalogShape(child)]),
    );
  }
  return typeof value;
}

export function assertI18nParity() {
  assertCatalogParity(UI_TEXT);
  const catalogs = {
    options: LOCALIZED_OPTIONS,
    help: HELP_CONTENT,
  };
  for (const [name, catalog] of Object.entries(catalogs)) {
    const ruShape = JSON.stringify(catalogShape(catalog.ru));
    const enShape = JSON.stringify(catalogShape(catalog.en));
    if (ruShape !== enShape) {
      throw new Error(`RU/EN ${name} catalog structures do not match`);
    }
  }

  for (const [selectId, ruOptions] of Object.entries(LOCALIZED_OPTIONS.ru)) {
    const enOptions = LOCALIZED_OPTIONS.en[selectId];
    const ruValues = ruOptions.map(([value]) => value);
    const enValues = enOptions.map(([value]) => value);
    if (JSON.stringify(ruValues) !== JSON.stringify(enValues)) {
      throw new Error(`RU/EN option values differ for ${selectId}`);
    }
  }
  return true;
}

export function translate(locale, key, fallback = key) {
  return UI_TEXT[locale]?.[key] ?? UI_TEXT.ru?.[key] ?? fallback;
}

export function formatMessage(locale, key, values = {}, fallback = key) {
  return translate(locale, key, fallback).replace(
    /\{([a-zA-Z0-9_]+)\}/g,
    (_match, name) => String(values[name] ?? `{${name}}`),
  );
}
