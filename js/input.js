export function normalizeControls(settings = {}) {
  return {
    controlMode: settings.controlMode || "gestures",
    sensitivity: Math.max(12, Math.min(42, Number(settings.sensitivity) || 24)),
    dasMs: Math.max(60, Math.min(260, Number(settings.dasMs) || 140)),
    arrMs: Math.max(0, Math.min(100, Number(settings.arrMs) || 36))
  };
}

export function classifySwipe(dx, dy, threshold = 24) {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return "tap";
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  if (dy < -threshold) return "rotate";
  if (dy > threshold * 2.6) return "hardDrop";
  if (dy > threshold) return "softDrop";
  return "tap";
}
