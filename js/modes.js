const MODE_COPY = {
  classic: {
    ru: { name: "\u041a\u043b\u0430\u0441\u0441\u0438\u043a\u0430", goal: "\u0412\u044b\u0436\u0438\u0442\u044c", description: "\u041a\u043b\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043a\u0430\u044f \u043f\u0430\u0440\u0442\u0438\u044f \u043d\u0430 \u0440\u0435\u043a\u043e\u0440\u0434." },
    en: { name: "Classic", goal: "Survive", description: "Classic high-score run." }
  },
  sprint: {
    ru: { name: "40 \u043b\u0438\u043d\u0438\u0439", goal: "\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c 40 \u043b\u0438\u043d\u0438\u0439", description: "\u0421\u043f\u0440\u0438\u043d\u0442 \u0434\u043e 40 \u043e\u0447\u0438\u0449\u0435\u043d\u043d\u044b\u0445 \u043b\u0438\u043d\u0438\u0439." },
    en: { name: "40 Lines", goal: "Clear 40 lines", description: "Sprint to 40 cleared lines." }
  },
  relax: {
    ru: { name: "\u0414\u0437\u0435\u043d", goal: "\u0411\u0435\u0437 \u0441\u043f\u0435\u0448\u043a\u0438", description: "\u0420\u0435\u0436\u0438\u043c \u0431\u0435\u0437 \u0434\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0438 \u0443\u0441\u043a\u043e\u0440\u0435\u043d\u0438\u044f." },
    en: { name: "Zen", goal: "No rush", description: "Relaxed play without pressure." }
  },
  chaos: {
    ru: { name: "\u0425\u0430\u043e\u0441", goal: "\u041f\u0435\u0440\u0435\u0436\u0438\u0442\u044c \u0430\u0442\u0430\u043a\u0438", description: "\u041f\u0430\u0440\u0442\u0438\u044f \u0441 \u043f\u0435\u0440\u0438\u043e\u0434\u0438\u0447\u0435\u0441\u043a\u0438\u043c\u0438 \u043c\u0443\u0441\u043e\u0440\u043d\u044b\u043c\u0438 \u043b\u0438\u043d\u0438\u044f\u043c\u0438." },
    en: { name: "Chaos", goal: "Survive attacks", description: "Survive periodic garbage attacks." }
  }
};

export const GAME_MODES = {
  classic: {
    key: "classic",
    statKey: "classic",
    name: MODE_COPY.classic.ru.name,
    nameEn: MODE_COPY.classic.en.name,
    goal: 0,
    goalText: MODE_COPY.classic.ru.goal,
    goalTextEn: MODE_COPY.classic.en.goal,
    levelUp: 10,
    startLevel: 1,
    startLines: 0,
    gravity: true,
    garbageAttacks: false,
    timeLimit: null,
    targetLines: null,
    description: MODE_COPY.classic.ru.description,
    descriptionEn: MODE_COPY.classic.en.description,
    relaxed: false,
    chaos: false
  },
  sprint: {
    key: "sprint",
    statKey: "sprint",
    name: MODE_COPY.sprint.ru.name,
    nameEn: MODE_COPY.sprint.en.name,
    goal: 40,
    goalText: MODE_COPY.sprint.ru.goal,
    goalTextEn: MODE_COPY.sprint.en.goal,
    levelUp: 10,
    startLevel: 1,
    startLines: 0,
    gravity: true,
    garbageAttacks: false,
    timeLimit: null,
    targetLines: 40,
    description: MODE_COPY.sprint.ru.description,
    descriptionEn: MODE_COPY.sprint.en.description,
    relaxed: false,
    chaos: false
  },
  relax: {
    key: "relax",
    statKey: "relax",
    name: MODE_COPY.relax.ru.name,
    nameEn: MODE_COPY.relax.en.name,
    goal: 0,
    goalText: MODE_COPY.relax.ru.goal,
    goalTextEn: MODE_COPY.relax.en.goal,
    levelUp: 10,
    startLevel: 1,
    startLines: 0,
    gravity: false,
    garbageAttacks: false,
    timeLimit: null,
    targetLines: null,
    description: MODE_COPY.relax.ru.description,
    descriptionEn: MODE_COPY.relax.en.description,
    relaxed: true,
    chaos: false
  },
  chaos: {
    key: "chaos",
    statKey: "chaos",
    name: MODE_COPY.chaos.ru.name,
    nameEn: MODE_COPY.chaos.en.name,
    goal: 0,
    goalText: MODE_COPY.chaos.ru.goal,
    goalTextEn: MODE_COPY.chaos.en.goal,
    levelUp: 5,
    startLevel: 1,
    startLines: 0,
    gravity: true,
    garbageAttacks: true,
    timeLimit: null,
    targetLines: null,
    description: MODE_COPY.chaos.ru.description,
    descriptionEn: MODE_COPY.chaos.en.description,
    relaxed: false,
    chaos: true
  }
};

const MODE_ALIASES = {
  zen: "relax"
};

export const GAME_MODE_KEYS = ["classic", "sprint", "relax", "chaos"];

export function normalizeModeKey(modeKey) {
  const key = MODE_ALIASES[modeKey] || modeKey;
  return GAME_MODES[key] ? key : "classic";
}

export function getModeConfig(modeKey) {
  return GAME_MODES[normalizeModeKey(modeKey)];
}

export function getModeOptions(language = "ru") {
  const useEnglish = language === "en";
  return GAME_MODE_KEYS.map((key) => {
    const mode = GAME_MODES[key];
    return {
      key,
      name: useEnglish ? mode.nameEn : mode.name,
      goal: useEnglish ? mode.goalTextEn : mode.goalText,
      description: useEnglish ? mode.descriptionEn : mode.description
    };
  });
}
