import { ATTACK_TABLE, SCORE_TABLE, SCORING_THRESHOLDS } from "./config.js";

const RANKS = [
  ["Новичок", 0],
  ["Игрок", SCORING_THRESHOLDS.PLAYER],
  ["Профи", SCORING_THRESHOLDS.PRO],
  ["Мастер", SCORING_THRESHOLDS.MASTER],
  ["Легенда", SCORING_THRESHOLDS.LEGEND],
];

function t(language, ru, en) {
  return language === "en" ? en : ru;
}

export function scoreLineClear(count, level = 1) {
  return SCORE_TABLE[Math.min(count, 4)] * level;
}

export function attackLinesForClear(count) {
  return ATTACK_TABLE[Math.min(count, 4)] || 0;
}

export function addPositiveScore(score, value) {
  return score + Math.max(0, Math.round(value));
}

export function rankTextForScore(score) {
  return rankInfo(score).current;
}

export function rankInfo(score) {
  let index = 0;
  for (let i = 0; i < RANKS.length; i += 1) {
    if (score >= RANKS[i][1]) index = i;
  }
  const current = RANKS[index][0];
  const next = RANKS[index + 1]?.[0] || "";
  if (!next) return { current, next: "", progress: 100 };
  const from = RANKS[index][1];
  const to = RANKS[index + 1][1];
  return {
    current,
    next,
    progress: Math.round(((score - from) / Math.max(1, to - from)) * 100),
  };
}

export function resultBadgeForGame({
  won,
  mode,
  daily,
  bestClearInGame,
  bestComboRun,
  bestBackToBackRun = 0,
  totalTSpins = 0,
  totalPerfectClears = 0,
  holes,
  score,
  bestScore,
  language = "ru",
}) {
  if (won && mode === "sprint")
    return t(language, "Сильный спринт", "Strong sprint");
  if (daily) return t(language, "Ежедневный челлендж", "Daily Challenge");
  if (totalPerfectClears > 0)
    return t(language, "Perfect Clear", "Perfect Clear");
  if (totalTSpins > 0) return t(language, "T-Spin серия", "T-Spin run");
  if (bestBackToBackRun >= 3) return t(language, "B2B цепь", "B2B chain");
  if (bestClearInGame >= 4) return t(language, "Момент Tetris", "Tetris moment");
  if (bestComboRun >= 4)
    return t(language, "Комбо-машина", "Combo machine");
  if (holes >= 8) return t(language, "Много дыр", "Too many holes");
  if (score >= bestScore) return t(language, "Новый рекорд", "New record");
  return t(language, "Стабильная партия", "Steady run");
}

export function resultHighlightsForGame({
  modeName,
  dailyLabel,
  bestClearInGame,
  bestComboRun,
  bestMoment = "",
  bestBackToBackRun = 0,
  totalPerfectClears = 0,
  apm,
  language = "ru",
}) {
  const moment =
    bestMoment ||
    (bestClearInGame >= 4
      ? "Tetris"
      : bestComboRun >= 2
        ? t(language, `Комбо x${bestComboRun}`, `Combo x${bestComboRun}`)
        : t(language, "Ровная партия", "Clean run"));

  return [
    { label: t(language, "Режим", "Mode"), value: modeName },
    {
      label: t(language, "Лучший момент", "Best moment"),
      value: moment,
    },
    { label: "APM", value: apm },
    {
      label: "B2B",
      value: bestBackToBackRun ? `x${bestBackToBackRun}` : "—",
    },
    {
      label: "Perfect Clear",
      value: totalPerfectClears || "—",
    },
    { label: t(language, "Дейлик", "Daily best"), value: dailyLabel },
  ];
}
