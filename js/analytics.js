const ALLOWED_EVENTS = new Set([
  "screen_view",
  "game_start",
  "game_finish",
  "tutorial_completion",
  "reconnect",
  "client_error",
  "pwa_update",
]);

const ALLOWED_PAYLOAD_KEYS = new Set([
  "result",
  "locale",
  "reconnectMs",
  "errorCode",
]);

function cleanToken(value, maxLength = 64) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, maxLength);
}

export function sanitizeAnalyticsEvent(event = {}) {
  const eventName = cleanToken(event.eventName, 48);
  if (!ALLOWED_EVENTS.has(eventName)) return null;
  const payload = {};
  for (const [key, value] of Object.entries(event.payload || {})) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) continue;
    payload[key] =
      typeof value === "number"
        ? Math.max(0, Math.min(60_000, Math.floor(value)))
        : cleanToken(value, 64);
  }
  return {
    eventName,
    sessionId: cleanToken(event.sessionId) || "anonymous",
    mode: cleanToken(event.mode, 24),
    durationMs: Math.max(
      0,
      Math.min(86_400_000, Math.floor(Number(event.durationMs) || 0)),
    ),
    payload,
    consented: event.consented === true,
  };
}

export function createPrivacyAnalytics({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  endpoint = "/api/analytics",
  enabled = false,
  consented = false,
  context = () => ({}),
} = {}) {
  const sessionId =
    globalThis.crypto?.randomUUID?.() ||
    `session.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
  let featureEnabled = Boolean(enabled);
  let hasConsent = Boolean(consented);

  async function track(eventName, values = {}) {
    if (!featureEnabled || !hasConsent || !fetchImpl) return false;
    const current = context() || {};
    const event = sanitizeAnalyticsEvent({
      eventName,
      sessionId,
      mode: values.mode ?? current.mode,
      durationMs: values.durationMs,
      payload: {
        locale: current.locale,
        result: values.result,
        reconnectMs: values.reconnectMs,
        errorCode: values.errorCode,
      },
      consented: true,
    });
    if (!event) return false;
    try {
      const request = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true,
      };
      let response;
      try {
        response = await fetchImpl(endpoint, request);
      } catch {
        // Older WebKit builds can reject the keepalive option before sending.
        const compatibleRequest = { ...request };
        delete compatibleRequest.keepalive;
        response = await fetchImpl(endpoint, compatibleRequest);
      }
      return response.ok;
    } catch {
      return false;
    }
  }

  return {
    track,
    setEnabled(value) {
      featureEnabled = Boolean(value);
    },
    setConsent(value) {
      hasConsent = Boolean(value);
    },
    canTrack() {
      return featureEnabled && hasConsent;
    },
  };
}
