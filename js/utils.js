export const format = {
  score: (value, locale = "ru-RU") => Number(value || 0).toLocaleString(locale),
  time: (ms) => {
    const totalSec = Math.floor(Number(ms || 0) / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  },
  level: (value, language = "ru") =>
    language === "en"
      ? `Level ${value}`
      : `\u0423\u0440\u043e\u0432\u0435\u043d\u044c ${value}`,
  lines: (value, language = "ru") =>
    language === "en"
      ? `${value} lines`
      : `${value} \u043b\u0438\u043d\u0438\u0439`,
  combo: (value, language = "ru") =>
    value > 1
      ? language === "en"
        ? `${value}x combo!`
        : `${value}x \u043a\u043e\u043c\u0431\u043e!`
      : "",
  percentage: (value) => `${Math.round(Number(value || 0) * 100)}%`,
  truncate: (value, length) => {
    const text = String(value || "");
    return text.length > length
      ? `${text.slice(0, Math.max(0, length - 3))}...`
      : text;
  },
};

export const validate = {
  roomName: (name) => /^[A-Z0-9]{1,16}$/.test(String(name || "")),
  playerName: (name) => {
    const text = String(name || "").trim();
    return text.length >= 1 && text.length <= 18;
  },
  score: (value) => Number.isInteger(value) && value >= 0,
};

export const calc = {
  progress: (current, target) =>
    target > 0 ? Math.min(current / target, 1) : 0,
  nextLevel: (currentLines, threshold) => {
    const remainder = currentLines % threshold;
    return remainder === 0 ? threshold : threshold - remainder;
  },
  comboMultiplier: (combo) => Math.min(1 + combo * 0.1, 3),
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
};
