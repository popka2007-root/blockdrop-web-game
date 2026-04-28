export function loadJson(key, fallback, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private mode or strict browser settings.
  }
}

export function removeItem(key, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore storage failures; gameplay should continue.
  }
}

export function loadText(
  key,
  fallback = "",
  storage = globalThis.localStorage,
) {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? fallback : String(raw);
  } catch {
    return fallback;
  }
}

export function saveText(key, value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(key, String(value));
  } catch {
    // Ignore storage failures; gameplay should continue.
  }
}

export function loadNumber(
  key,
  fallback = 0,
  storage = globalThis.localStorage,
) {
  const value = Number(loadText(key, fallback, storage));
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeMatchHistoryEntry(entry = {}) {
  const result = entry.result === "win" ? "win" : "loss";
  return {
    result,
    opponent: String(entry.opponent || "Player")
      .replace(/[<>]/g, "")
      .slice(0, 18),
    durationSec: Math.max(0, Math.floor(Number(entry.durationSec) || 0)),
    lines: Math.max(0, Math.floor(Number(entry.lines) || 0)),
    score: Math.max(0, Math.floor(Number(entry.score) || 0)),
    ratingBefore: Math.max(0, Math.floor(Number(entry.ratingBefore) || 0)),
    ratingAfter: Math.max(0, Math.floor(Number(entry.ratingAfter) || 0)),
    ratingDelta: Math.floor(Number(entry.ratingDelta) || 0),
    date: entry.date || new Date().toISOString(),
    mode: String(entry.mode || "Classic")
      .replace(/[<>]/g, "")
      .slice(0, 24),
  };
}

export function loadMatchHistory(
  key = "blockdrop-online-match-history-v1",
  storage = globalThis.localStorage,
) {
  const history = loadJson(key, [], storage);
  return Array.isArray(history)
    ? history.slice(0, 10).map(normalizeMatchHistoryEntry)
    : [];
}

export function saveMatchHistoryEntry(
  entry,
  key = "blockdrop-online-match-history-v1",
  storage = globalThis.localStorage,
) {
  const history = [normalizeMatchHistoryEntry(entry), ...loadMatchHistory(key, storage)]
    .slice(0, 10);
  saveJson(key, history, storage);
  return history;
}

export function loadOnlineStats(
  key = "blockdrop-online-stats-v1",
  storage = globalThis.localStorage,
) {
  const raw = loadJson(key, {}, storage);
  const wins = Math.max(0, Math.floor(Number(raw.wins) || 0));
  const losses = Math.max(0, Math.floor(Number(raw.losses) || 0));
  const totalMatches = wins + losses;
  return {
    wins,
    losses,
    totalMatches,
    winrate: totalMatches ? Math.round((wins / totalMatches) * 100) : 0,
  };
}

export function saveOnlineStats(
  result,
  key = "blockdrop-online-stats-v1",
  storage = globalThis.localStorage,
) {
  const stats = loadOnlineStats(key, storage);
  if (result === "win") stats.wins += 1;
  else if (result === "loss") stats.losses += 1;
  stats.totalMatches = stats.wins + stats.losses;
  stats.winrate = stats.totalMatches
    ? Math.round((stats.wins / stats.totalMatches) * 100)
    : 0;
  saveJson(key, stats, storage);
  return stats;
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
    },
    loadRankedPlayerId(fallback = "") {
      return loadText(keys.rankedPlayerId, fallback, storage);
    },
    saveRankedPlayerId(value) {
      saveText(keys.rankedPlayerId, value, storage);
    },
    loadRankedIdentityToken(fallback = "") {
      return loadText(keys.rankedIdentityToken, fallback, storage);
    },
    saveRankedIdentityToken(value) {
      saveText(keys.rankedIdentityToken, value, storage);
    },
    loadMatchHistory(fallback = []) {
      return loadMatchHistory(keys.matchHistory, storage) || fallback;
    },
    saveMatchHistoryEntry(value) {
      return saveMatchHistoryEntry(value, keys.matchHistory, storage);
    },
    loadOnlineStats() {
      return loadOnlineStats(keys.onlineStats, storage);
    },
    saveOnlineStats(result) {
      return saveOnlineStats(result, keys.onlineStats, storage);
    },
  };
}
