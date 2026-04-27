import { ATTACK_TABLE, SCORE_TABLE, SCORING_THRESHOLDS } from "./config.js";

const RANKS = [
  ["Новичок", 0],
  ["Игрок", SCORING_THRESHOLDS.PLAYER],
  ["Профи", SCORING_THRESHOLDS.PRO],
  ["Мастер", SCORING_THRESHOLDS.MASTER],
  ["Легенда", SCORING_THRESHOLDS.LEGEND],
];

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
  holes,
  score,
  bestScore,
}) {
  if (won && mode === "sprint") return "Сильный спринт";
  if (daily) return "Daily Challenge";
  if (bestClearInGame >= 4) return "Tetris-момент";
  if (bestComboRun >= 4) return "Комбо-машина";
  if (holes >= 8) return "Много дыр";
  if (score >= bestScore) return "Новый рекорд";
  return "Стабильная партия";
}

export function resultHighlightsForGame({
  modeName,
  dailyLabel,
  bestClearInGame,
  bestComboRun,
  apm,
}) {
  return [
    { label: "Режим", value: modeName },
    {
      label: "Лучший момент",
      value: bestClearInGame >= 4 ? "Tetris" : `Комбо x${bestComboRun}`,
    },
    { label: "APM", value: apm },
    { label: "Daily best", value: dailyLabel },
  ];
}
