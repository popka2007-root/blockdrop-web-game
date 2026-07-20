/* global importScripts */
importScripts("../shared/engine.js", "../shared/ai.js");

self.addEventListener("message", (event) => {
  const payload = event.data || {};
  if (payload.type === "simulateReplay") {
    const result = self.__blockdropEngine.simulateReplay(payload.replay);
    self.postMessage({
      type: "replayResult",
      requestId: payload.requestId || "",
      ok: result.ok,
      code: result.code,
      finalChecksum: result.finalChecksum || "",
    });
    return;
  }
  if (payload.type !== "plan") return;
  try {
    const plan = self.__blockdropAi.planMove(payload.snapshot, {
      requestId: payload.requestId,
      difficulty: payload.difficulty,
      style: payload.style,
    });
    self.postMessage({ type: "plan", ...plan });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: payload.requestId || "",
      message: String(error?.message || "AI planning failed").slice(0, 160),
    });
  }
});
