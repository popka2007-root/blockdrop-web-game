export function normalizeRoomId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

export function normalizePlayerName(value) {
  return String(value || "Player").replace(/[<>]/g, "").trim().slice(0, 18) || "Player";
}

export function attackLinesForClear(count) {
  if (count < 2) return 0;
  if (count === 2) return 1;
  if (count === 3) return 2;
  return 4;
}
