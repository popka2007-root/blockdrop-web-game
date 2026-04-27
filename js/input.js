const SENSITIVITY_PRESETS = {
  low: 30,
  medium: 24,
  high: 18,
};

export function swipeThresholdForPreset(preset = "medium") {
  return SENSITIVITY_PRESETS[preset] || SENSITIVITY_PRESETS.medium;
}

export function normalizeControls(settings = {}) {
  const preset = ["low", "medium", "high"].includes(settings.sensitivityPreset)
    ? settings.sensitivityPreset
    : Number.isFinite(Number(settings.sensitivity))
      ? Number(settings.sensitivity) <= 19
        ? "high"
        : Number(settings.sensitivity) >= 28
          ? "low"
          : "medium"
      : "medium";

  return {
    controlMode: settings.controlMode || "gestures",
    sensitivityPreset: preset,
    sensitivity: swipeThresholdForPreset(preset),
    handedness: settings.handedness === "left" ? "left" : "right",
    dasMs: Math.max(60, Math.min(260, Number(settings.dasMs) || 140)),
    arrMs: Math.max(0, Math.min(100, Number(settings.arrMs) || 36)),
  };
}

export function gestureProfile({ dx, dy, elapsedMs, threshold }) {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const duration = Math.max(1, elapsedMs || 1);
  const speedY = absY / duration;
  const horizontal = absX >= threshold && absX > absY * 0.72;
  const downward = dy > threshold && absY > absX * 1.08;

  return {
    isTap: absX < threshold * 0.45 && absY < threshold * 0.45 && duration < 240,
    horizontal,
    direction: horizontal ? (dx < 0 ? "left" : "right") : null,
    shouldSoftDrop: downward,
    shouldHardDrop: downward && (speedY >= 1.15 || dy >= threshold * 3.1),
    speedY,
  };
}
