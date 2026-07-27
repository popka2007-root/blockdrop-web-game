export function createAiController({ onPlan, onError } = {}) {
  let worker = null;
  let requestCounter = 0;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./ai-worker.js", import.meta.url));
    worker.addEventListener("message", (event) => {
      const payload = event.data || {};
      if (payload.type === "plan") onPlan?.(payload);
      if (payload.type === "error") onError?.(payload);
    });
    worker.addEventListener("error", (event) => {
      onError?.({ message: event.message || "AI worker stopped" });
    });
    return worker;
  }

  function plan(snapshot, options = {}) {
    const requestId = `ai:${++requestCounter}`;
    ensureWorker().postMessage({
      type: "plan",
      requestId,
      snapshot,
      difficulty: options.difficulty || "normal",
      style: options.style || "balanced",
    });
    return requestId;
  }

  function dispose() {
    worker?.terminate();
    worker = null;
  }

  return { plan, dispose };
}
