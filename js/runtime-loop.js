export function advanceFrameClock(state, time, maxFrameDeltaMs) {
  if (!state.lastTime) state.lastTime = time;
  const delta = Math.min(maxFrameDeltaMs, time - state.lastTime);
  state.lastTime = time;
  return delta;
}

export function decayFlashes(flashes, delta, uiConfig) {
  return flashes
    .map((flash) => ({
      ...flash,
      life: flash.life - delta / uiConfig.FLASH_DECAY_MS,
      width: Math.min(1, flash.width + delta / uiConfig.FLASH_GROW_MS),
    }))
    .filter((flash) => flash.life > 0);
}
