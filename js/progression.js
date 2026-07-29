import "../shared/balance.js";

const balance = globalThis.__blockdropBalance;

if (!balance) throw new Error("BlockDrop balance configuration failed to load");

export const {
  PROFILE_SCHEMA_VERSION,
  QUEST_BALANCE,
  QUEST_BALANCE_VERSION,
} = balance;

export const COSMETICS = Object.freeze([
  { id: "mint-trail", unlockLevel: 1 },
  { id: "amber-blocks", unlockLevel: 3 },
  { id: "candy-spark", unlockLevel: 6 },
  { id: "mono-ghost", unlockLevel: 10 },
]);

const DAILY_QUESTS = QUEST_BALANCE.daily;
const WEEKLY_QUESTS = QUEST_BALANCE.weekly;

function clampInteger(value, min = 0, max = 1_000_000_000) {
  return Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
}

export function dateKey(now = new Date()) {
  const date = new Date(now);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function weekKey(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((date - firstThursday) / 86_400_000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7,
    );
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function hashKey(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeQuest(template, periodKey) {
  return {
    ...template,
    periodKey,
    progress: 0,
    completed: false,
    claimed: false,
  };
}

function questsForPeriod(templates, periodKey, count) {
  const offset = hashKey(periodKey) % templates.length;
  return Array.from({ length: count }, (_unused, index) =>
    makeQuest(templates[(offset + index) % templates.length], periodKey),
  );
}

function reconcileQuests(rawQuests, templates, periodKey, count) {
  const previous = new Map(
    (Array.isArray(rawQuests) ? rawQuests : [])
      .filter((quest) => quest && typeof quest === "object")
      .map((quest) => [String(quest.id || ""), quest]),
  );
  return questsForPeriod(templates, periodKey, count).map((quest) => {
    const saved = previous.get(quest.id);
    return normalizeQuest(
      saved
        ? {
            ...quest,
            progress: saved.progress,
            claimed: saved.claimed,
          }
        : quest,
    );
  });
}

export function levelFromXp(xp) {
  return Math.max(1, Math.floor(Math.sqrt(clampInteger(xp) / 250)) + 1);
}

export function xpForNextLevel(level) {
  const next = Math.max(2, clampInteger(level, 1) + 1);
  return (next - 1) ** 2 * 250;
}

export function normalizeProfile(raw = {}, now = new Date()) {
  const xp = clampInteger(raw.xp);
  const level = levelFromXp(xp);
  const currentDailyKey = dateKey(now);
  const currentWeekKey = weekKey(now);
  const daily = reconcileQuests(
    raw.dailyKey === currentDailyKey ? raw.dailyQuests : [],
    DAILY_QUESTS,
    currentDailyKey,
    2,
  );
  const weekly = reconcileQuests(
    raw.weeklyKey === currentWeekKey ? raw.weeklyQuests : [],
    WEEKLY_QUESTS,
    currentWeekKey,
    2,
  );
  const unlocked = new Set(
    Array.isArray(raw.unlockedCosmetics) ? raw.unlockedCosmetics : [],
  );
  for (const cosmetic of COSMETICS) {
    if (level >= cosmetic.unlockLevel) unlocked.add(cosmetic.id);
  }
  unlocked.add("mint-trail");
  const unlockedCosmetics = COSMETICS.map(({ id }) => id).filter((id) =>
    unlocked.has(id),
  );
  const selectedCosmetic = unlockedCosmetics.includes(raw.selectedCosmetic)
    ? raw.selectedCosmetic
    : unlockedCosmetics[0];
  return {
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    xp,
    level,
    games: clampInteger(raw.games),
    wins: clampInteger(raw.wins),
    totalLines: clampInteger(raw.totalLines),
    totalHardDrops: clampInteger(raw.totalHardDrops),
    unlockedCosmetics,
    selectedCosmetic,
    dailyKey: currentDailyKey,
    weeklyKey: currentWeekKey,
    dailyQuests: daily,
    weeklyQuests: weekly,
    updatedAt: String(raw.updatedAt || new Date(now).toISOString()),
  };
}

function normalizeQuest(quest = {}) {
  const target = Math.max(1, clampInteger(quest.target, 1, 100_000));
  const progress = Math.min(target, clampInteger(quest.progress));
  return {
    id: String(quest.id || "quest").slice(0, 48),
    type: ["games", "lines", "hardDrops", "wins"].includes(quest.type)
      ? quest.type
      : "games",
    target,
    rewardXp: clampInteger(quest.rewardXp, 0, 10_000),
    periodKey: String(quest.periodKey || "").slice(0, 16),
    progress,
    completed: progress >= target,
    claimed: progress >= target && Boolean(quest.claimed),
  };
}

function gameContribution(game, type) {
  if (type === "games") return 1;
  if (type === "wins") return game.won ? 1 : 0;
  return clampInteger(game[type]);
}

export function applyGameProgress(rawProfile, game = {}, now = new Date()) {
  const profile = normalizeProfile(rawProfile, now);
  const previousUnlocked = new Set(profile.unlockedCosmetics);
  const lines = clampInteger(game.lines, 0, 10_000);
  const hardDrops = clampInteger(game.hardDrops, 0, 100_000);
  const score = clampInteger(game.score);
  profile.games += 1;
  profile.wins += game.won ? 1 : 0;
  profile.totalLines += lines;
  profile.totalHardDrops += hardDrops;
  profile.xp += Math.min(
    2_000,
    Math.floor(score / 100) + lines * 10 + hardDrops * 2 + (game.won ? 50 : 0),
  );

  const completedQuestIds = [];
  for (const quest of [...profile.dailyQuests, ...profile.weeklyQuests]) {
    if (!quest.completed) {
      quest.progress = Math.min(
        quest.target,
        quest.progress +
          gameContribution({ ...game, lines, hardDrops }, quest.type),
      );
      quest.completed = quest.progress >= quest.target;
    }
    if (quest.completed && !quest.claimed) {
      quest.claimed = true;
      profile.xp += quest.rewardXp;
      completedQuestIds.push(quest.id);
    }
  }

  profile.level = levelFromXp(profile.xp);
  for (const cosmetic of COSMETICS) {
    if (profile.level >= cosmetic.unlockLevel) {
      profile.unlockedCosmetics.push(cosmetic.id);
    }
  }
  profile.unlockedCosmetics = [...new Set(profile.unlockedCosmetics)];
  profile.updatedAt = new Date(now).toISOString();
  return {
    profile: normalizeProfile(profile, now),
    completedQuestIds,
    unlockedCosmeticIds: profile.unlockedCosmetics.filter(
      (id) => !previousUnlocked.has(id),
    ),
  };
}

export function selectCosmetic(rawProfile, cosmeticId, now = new Date()) {
  const profile = normalizeProfile(rawProfile, now);
  if (!profile.unlockedCosmetics.includes(cosmeticId)) return profile;
  return { ...profile, selectedCosmetic: cosmeticId };
}

export function portableProfile(rawProfile, now = new Date()) {
  return {
    kind: "blockdrop-profile",
    exportSchemaVersion: 1,
    exportedAt: new Date(now).toISOString(),
    profile: normalizeProfile(rawProfile, now),
  };
}
