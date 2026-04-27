export function loadJson(key, fallback, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value, storage = globalThis.localStorage) {
  storage?.setItem(key, JSON.stringify(value));
}

export function removeItem(key, storage = globalThis.localStorage) {
  storage?.removeItem(key);
}

export function loadText(key, fallback = "", storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? fallback : String(raw);
  } catch {
    return fallback;
  }
}

export function saveText(key, value, storage = globalThis.localStorage) {
  storage?.setItem(key, String(value));
}

export function loadNumber(key, fallback = 0, storage = globalThis.localStorage) {
  const value = Number(loadText(key, fallback, storage));
  return Number.isFinite(value) ? value : fallback;
}

export function createGameStorage(keys, storage = globalThis.localStorage) {
  return {
    loadSettings(fallback = {}) {
      return loadJson(keys.settings, fallback, storage);
    },
    saveSettings(value) {
      saveJson(keys.settings, value, storage);
    },
    loadStats(fallback = {}) {
      return loadJson(keys.stats, fallback, storage);
    },
    saveStats(value) {
      saveJson(keys.stats, value, storage);
    },
    loadScores(fallback = []) {
      return loadJson(keys.scores, fallback, storage);
    },
    saveScores(value) {
      saveJson(keys.scores, value, storage);
    },
    loadGhostRun(fallback = null) {
      return loadJson(keys.ghostRun, fallback, storage);
    },
    saveGhostRun(value) {
      saveJson(keys.ghostRun, value, storage);
    },
    loadAchievements(fallback = {}) {
      return loadJson(keys.achievements, fallback, storage);
    },
    saveAchievements(value) {
      saveJson(keys.achievements, value, storage);
    },
    loadSave(fallback = null) {
      return loadJson(keys.save, fallback, storage);
    },
    saveGame(value) {
      saveJson(keys.save, value, storage);
    },
    clearSave() {
      removeItem(keys.save, storage);
    },
    loadBestScore(fallback = 0) {
      return loadNumber(keys.high, fallback, storage);
    },
    saveBestScore(value) {
      saveText(keys.high, value, storage);
    },
    loadRoomCode(fallback = "") {
      return loadText(keys.lastRoom, fallback, storage);
    },
    saveRoomCode(value) {
      saveText(keys.lastRoom, value, storage);
    },
    loadPlayerName(fallback = "Player") {
      return loadText(keys.playerName, fallback, storage);
    },
    savePlayerName(value) {
      saveText(keys.playerName, value, storage);
    }
  };
}
