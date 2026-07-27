module.exports = function setupHttp(context) {
  const { crypto, fs, zlib, http, path, QRCode, WebSocket, WebSocketServer, createMetrics, createLogger, clientAddress, isSensitiveTransportAllowed, RANKED_MAX_RATING, RANKED_MIN_RATING, createServerStore, protocol, engine, PORT, ROOT, MAX_WS_FRAME_BYTES, MAX_MESSAGES_PER_10S, MAX_UPDATES_PER_SECOND, MAX_ATTACKS_PER_SECOND, MAX_ATTACK_LINES_PER_10S, MAX_PAYLOAD_KEYS, HTTP_RATE_WINDOW_MS, RECONNECT_GRACE_MS, COUNTDOWN_STEP_MS, MATCH_TICK_MS, SNAPSHOT_INTERVAL_TICKS, RANKED_K_FACTOR, ATTACK_KEY_LIST, MAX_BOARD_PREVIEW_COLS, MAX_BOARD_PREVIEW_ROWS, JOIN_KEY_LIST, INPUT_ACTIONS, INPUT_KEY_LIST, MATCH_OVER_KEY_LIST, MAX_RECORD_SCORE, PING_KEY_LIST, PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, REMATCH_KEY_LIST, MATCH_EVENT_KEY_LIST, ROOM_PLAYER_LIMIT, TOURNAMENT_KEY_LIST, UPDATE_KEY_LIST, normalizeIdentityToken, normalizeMatchMode, normalizePlayerId, normalizePlayerName, normalizeRoomId, sanitizeBoardPreview, UPDATE_KEYS, ATTACK_KEYS, REMATCH_KEYS, MATCH_EVENT_KEYS, MATCH_OVER_KEYS, PING_KEYS, JOIN_KEYS, INPUT_KEYS, TOURNAMENT_KEYS, rooms, rankedQueue, httpRateBuckets, startedAt, cachedPackageMeta, store, logger, metrics, eventLoopExpectedAt, previousCpuUsage, previousCpuMeasuredAt, operationalMetricsTimer, mime, securityHeaders, PUBLIC_ROOT_FILES, PUBLIC_PREFIXES } = context;

  const { createClient, isAllowedWebSocketOrigin, allowedWebSocketOrigins, emptyState, createRoom, handleMessage, validateInputShape, inputTargetsActiveMatch, isSafePayload, hasOnlyKeys, isIntegerInRange, isSafeShortText, hasUnsafeTextChars, matchesClientRoom, validateJoinPayload, validateTournamentPayload, validateUpdatePayload, validateAttackPayload, isSafeBoardPreview, joinRoom, validateMatchEventPayload, joinRankedQueue, removeQueuedClient, findReconnectSlot, clearReconnect, updateClientState, startTournament, maybeAutoStart, startRankedSeries, startCountdown, startAuthoritativeMatch, stopAuthoritativeMatch, queueAuthoritativeInput, drainAuthoritativeInputs, tickAuthoritativeMatch, finishAuthoritativeResult, updateClientFromEngine, formatTickTime, authoritativeOpponentPayload, sendAuthoritativeSnapshot, sendAuthoritativeSnapshots, markRematchReady, finishMatchFromClient, finishMatch, persistAuthoritativeReplays, finalizeRankedMatch, recordMatchEvent, maxAttackForEvent, rankedParticipant, applyRankedProfileToParticipant, rankedResultPayload, allowMessage, allowTypedMessage, allowAttackLines, consumeAttackCredit, safeClose, scheduleTournamentEnd, broadcastAttack, broadcastRoom, broadcast, send, tournamentPayload, matchPayload, seriesPayload, playersPayload, spectatorsPayload, removeClient, cleanPlayerId, cleanName, safeNumber, clamp, pruneProductData, closeStoreAndExit, shutdown } = context;

function safeDecodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "";
  }
}

function handleHealth(req, res) {
  handleReadiness(req, res, true);
}

function handleLiveness(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  const payload = {
    ok: true,
    status: "live",
    service: "blockdrop-web-game",
    version: readPackageMeta().version,
    revision: readRevision(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
  sendHealthPayload(req, res, payload, 200);
}

function handleReadiness(req, res, includeDetails) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  const readiness = store.checkReady();
  if (!readiness.ok) {
    metrics.increment("blockdrop_db_errors_total");
    sendHealthPayload(
      req,
      res,
      {
        ok: false,
        status: "not-ready",
        service: "blockdrop-web-game",
        version: readPackageMeta().version,
        revision: readRevision(),
      },
      503,
    );
    return;
  }

  if (!includeDetails) {
    sendHealthPayload(
      req,
      res,
      {
        ok: true,
        status: "ready",
        service: "blockdrop-web-game",
        version: readPackageMeta().version,
        revision: readRevision(),
        database: "ready",
      },
      200,
    );
    return;
  }

  const dailyDate = serverDateKey();
  const counts = store.getHealthCounts(dailyDate);
  updateLiveMetrics();
  const payload = {
    ok: true,
    app: "BlockDrop",
    service: "blockdrop-web-game",
    version: readPackageMeta().version,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    rooms: rooms.size,
    players: livePlayersCount(),
    spectators: liveSpectatorsCount(),
    records: counts.records,
    rankedPlayers: counts.rankedPlayers,
    accounts: counts.accounts,
    dailyDate,
    dailyEntries: counts.dailyEntries,
    dailyRuns: counts.dailyRuns,
    rankedMatches: counts.rankedMatches,
    rankedEvents: counts.rankedEvents,
    revision: readRevision(),
    backupAgeSec: counts.latestBackupAt
      ? Math.max(0, Math.floor((Date.now() - counts.latestBackupAt) / 1000))
      : null,
  };

  sendHealthPayload(req, res, payload, 200);
}

function sendHealthPayload(req, res, payload, status) {
  if (req.method === "HEAD") {
    writeHead(res, status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }
  sendJson(res, payload, status);
}

function handleMetrics(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!hasMetricsAccess(req)) {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }
  const counts = store.getHealthCounts(serverDateKey());
  updateLiveMetrics();
  writeHead(res, 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(
    metrics.render({
      blockdrop_records_total: counts.records,
      blockdrop_ranked_players_total: counts.rankedPlayers,
      blockdrop_daily_entries_total: counts.dailyEntries,
      blockdrop_daily_runs_total: counts.dailyRuns,
      blockdrop_ranked_matches_stored_total: counts.rankedMatches,
      blockdrop_ranked_events_total: counts.rankedEvents,
      blockdrop_ranked_queue_waiting: rankedQueue.length,
      blockdrop_backup_age_seconds: counts.latestBackupAt
        ? Math.max(0, Math.floor((Date.now() - counts.latestBackupAt) / 1000))
        : -1,
    }),
  );
}

function hasMetricsAccess(req) {
  const configuredToken = String(process.env.BLOCKDROP_METRICS_TOKEN || "");
  if (configuredToken) {
    const header = String(req.headers.authorization || "");
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    return timingSafeEqualText(token, configuredToken);
  }
  if (req.headers.forwarded || req.headers["x-forwarded-for"]) return false;
  const address = String(req.socket?.remoteAddress || "").toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function timingSafeEqualText(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function serverDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function livePlayersCount() {
  let total = 0;
  for (const room of rooms.values()) total += room.players.size;
  return total;
}

function liveSpectatorsCount() {
  let total = 0;
  for (const room of rooms.values()) total += room.spectators.size;
  return total;
}

function updateLiveMetrics() {
  metrics.set("blockdrop_rooms_active", rooms.size);
  metrics.set("blockdrop_players_active", livePlayersCount());
  metrics.set("blockdrop_spectators_active", liveSpectatorsCount());
}

function readRevision() {
  if (process.env.BLOCKDROP_REVISION) return process.env.BLOCKDROP_REVISION;
  try {
    return (
      fs
        .readFileSync(path.join(ROOT, "REVISION"), "utf8")
        .trim()
        .slice(0, 64) || "unknown"
    );
  } catch {
    return "unknown";
  }
}

function readPackageMeta() {
  if (cachedPackageMeta) return cachedPackageMeta;
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    cachedPackageMeta = {
      version: String(meta.version || "0.0.0").slice(0, 32),
    };
    return cachedPackageMeta;
  } catch {
    cachedPackageMeta = { version: "0.0.0" };
    return cachedPackageMeta;
  }
}

function handleCapabilitiesApi(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  const secureTransport = isSensitiveTransportAllowed(req);
  const bucket = clientAddress(req);
  const authEnabled = isFeatureEnabled("accounts", secureTransport, bucket);
  const payload = {
    secureTransport,
    authEnabled,
    rankedEnabled:
      authEnabled && isFeatureEnabled("ranked", secureTransport, bucket),
    casualOnlineEnabled: true,
    casualV2Enabled: isFeatureEnabled("casualV2", secureTransport, bucket),
    analyticsEnabled: isFeatureEnabled("analytics", secureTransport, bucket),
    pwaInstallEnabled: isFeatureEnabled("pwaInstall", secureTransport, bucket),
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: engine.ENGINE_VERSION,
    maxPlayers: ROOM_PLAYER_LIMIT,
    localQrEnabled: true,
    version: readPackageMeta().version,
  };
  if (req.method === "HEAD") {
    writeHead(res, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }
  sendJson(res, payload);
}

function isFeatureEnabled(key, secureTransport, bucket = "") {
  const environmentKey = `BLOCKDROP_FEATURE_${String(key)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase()}`;
  const environmentValue = process.env[environmentKey];
  const flag = store.getFeatureFlag(key);
  const hasEnvironmentOverride = environmentValue != null;
  const enabled = hasEnvironmentOverride
    ? environmentValue === "true" || environmentValue === "1"
    : Boolean(flag?.enabled);
  if (!enabled) return false;
  if (flag?.secureTransportRequired && !secureTransport) return false;
  if (hasEnvironmentOverride) return true;
  const rollout = clamp(Number(flag?.rolloutPercentage) || 0, 0, 100);
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;
  const digest = crypto
    .createHash("sha256")
    .update(`${key}:${bucket}`)
    .digest()
    .readUInt32BE(0);
  return digest % 100 < rollout;
}

function handleRecordsApi(req, res) {
  if (req.method === "GET") {
    sendJson(res, { records: store.listRecords() });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  if (!allowHttpRequest(req, "records", 30, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }

    const record = sanitizeRecord(data);
    if (record.score <= 0) {
      sendJson(res, { records: store.listRecords() });
      return;
    }

    if (!isPlausibleRecord(record)) {
      logger.warn("record_rejected", {
        name: record.name,
        score: record.score,
        lines: record.lines,
      });
      sendJson(
        res,
        {
          error: "Record rejected by server authority",
          records: store.listRecords(),
        },
        422,
      );
      return;
    }

    const records = store.saveRecord(record);
    sendJson(res, { records });
  });
}

function handleDailyApi(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const dateKey = serverDateKey();
    if (!allowHttpRequest(req, "daily-read", 120, HTTP_RATE_WINDOW_MS)) {
      sendRateLimited(res);
      return;
    }
    const payload = {
      date: dateKey,
      seed: store.getOrCreateDailySeed(dateKey),
      leaderboard: store.listDailyLeaderboard(dateKey),
    };
    if (req.method === "HEAD") {
      writeHead(res, 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end();
      return;
    }
    sendJson(res, payload);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  if (!allowHttpRequest(req, "daily-submit", 40, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }

    const dateKey = serverDateKey();
    const account = isSensitiveTransportAllowed(req)
      ? accountFromRequest(req, data.accountToken)
      : null;
    const entry = sanitizeDailyScore(data, dateKey, account);
    const runCheck = store.verifyDailyRun({
      token: data.runToken,
      signature: data.runSignature,
      dateKey,
    });
    const replayCheck = runCheck.ok
      ? verifyDailyReplay(data, entry, runCheck.run)
      : { ok: false, code: runCheck.code };
    if (
      !runCheck.ok ||
      !isPlausibleDailyScore(entry, data, runCheck.run) ||
      !replayCheck.ok
    ) {
      metrics.increment("blockdrop_daily_rejected_total");
      sendJson(
        res,
        {
          error: runCheck.code || replayCheck.code || "Daily score rejected",
          date: dateKey,
          seed: store.getOrCreateDailySeed(dateKey),
          leaderboard: store.listDailyLeaderboard(dateKey),
        },
        422,
      );
      return;
    }
    entry.playerId = runCheck.run.playerId;
    const leaderboard = store.saveDailyScore(entry);
    store.saveReplay({
      id: `daily:${dateKey}:${data.runToken}`,
      playerId: entry.playerId,
      mode: replayCheck.replay.mode,
      engineVersion: replayCheck.replay.engineVersion,
      replaySchemaVersion: replayCheck.replay.replayVersion,
      seed: replayCheck.replay.seed,
      inputStream: {
        inputs: replayCheck.replay.inputs,
        externalEvents: replayCheck.replay.externalEvents || [],
        finalTick: replayCheck.replay.finalTick,
        metadata: replayCheck.replay.metadata || {},
      },
      checkpoints: replayCheck.replay.checkpoints || [],
      result: entry,
      checksum: replayCheck.replay.finalChecksum,
      verificationStatus: "verified",
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    store.markDailyRunSubmitted(data.runToken);
    metrics.increment("blockdrop_daily_submissions_total");
    sendJson(res, {
      date: dateKey,
      seed: store.getOrCreateDailySeed(dateKey),
      leaderboard,
    });
  });
}

function handleDailyRunApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!allowHttpRequest(req, "daily-start", 40, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  readJsonRequest(req, res, 16 * 1024, (data) => {
    const dateKey = serverDateKey();
    const account = isSensitiveTransportAllowed(req)
      ? accountFromRequest(req, data.accountToken)
      : null;
    const playerId = cleanPlayerId(data.playerId);
    const run = store.createDailyRun({ dateKey, account, playerId });
    sendJson(
      res,
      {
        date: dateKey,
        seed: store.getOrCreateDailySeed(dateKey),
        runToken: run.token,
        runSignature: run.signature,
        runExpiresAt: run.expiresAt,
        leaderboard: store.listDailyLeaderboard(dateKey),
      },
      201,
    );
  });
}

function handleAccountApi(req, res) {
  if (!isSensitiveTransportAllowed(req)) {
    sendJson(
      res,
      {
        error: "secureTransportRequired",
        message: "Accounts and ranked play require HTTPS",
      },
      426,
    );
    return;
  }
  if (req.method === "GET") {
    const account = accountFromRequest(req);
    if (!account) {
      sendJson(res, { account: null }, 401);
      return;
    }
    sendJson(res, { account: store.publicAccount(account) });
    return;
  }

  if (req.method === "DELETE") {
    const token = authTokenFromRequest(req);
    store.logoutAccount(token);
    sendJson(res, { ok: true });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body || "{}");
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
      return;
    }
    const action = String(data.action || "login");
    const usernameKey = String(data.username || "anonymous")
      .trim()
      .toLowerCase()
      .slice(0, 32);
    if (
      !allowHttpRequest(req, `account:${action}`, 20, HTTP_RATE_WINDOW_MS) ||
      !allowHttpRequest(
        req,
        `account:${action}:${usernameKey}`,
        8,
        HTTP_RATE_WINDOW_MS,
      )
    ) {
      sendRateLimited(res);
      return;
    }
    const result =
      action === "register"
        ? store.createAccount(data)
        : action === "changePassword"
          ? store.changeAccountPassword({
              token: data.token || authTokenFromRequest(req),
              currentPassword: data.currentPassword,
              newPassword: data.newPassword,
            })
          : store.loginAccount(data);
    if (!result.ok) {
      sendJson(res, { error: result.code || "accountError" }, 400);
      return;
    }
    sendJson(res, {
      account: store.publicAccount(result.account),
      token:
        result.token ||
        normalizeIdentityToken(data.token) ||
        authTokenFromRequest(req),
    });
  });
}

function handleRankedApi(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  const payload = {
    leaderboard: store.listRankedLeaderboard(20),
    queueWaiting: rankedQueue.length,
  };
  if (req.method === "HEAD") {
    writeHead(res, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end();
    return;
  }
  sendJson(res, payload);
}

function readJsonRequest(req, res, limitBytes, callback) {
  let body = "";
  let rejected = false;
  req.on("data", (chunk) => {
    if (rejected) return;
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > limitBytes) {
      rejected = true;
      sendJson(res, { error: "Payload too large" }, 413);
    }
  });
  req.on("end", () => {
    if (rejected) return;
    try {
      callback(JSON.parse(body || "{}"));
    } catch {
      sendJson(res, { error: "Bad JSON" }, 400);
    }
  });
}

function handleProfileTransferApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  if (!allowHttpRequest(req, "profile-transfer", 20, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  readJsonRequest(req, res, 256 * 1024, (data) => {
    const action = data.action === "verify" ? "verify" : "sign";
    const payload = data.payload;
    if (
      !payload ||
      payload.kind !== "blockdrop-profile" ||
      Number(payload.exportSchemaVersion) !== 1 ||
      !payload.profile ||
      Number(payload.profile.profileSchemaVersion) !== 1
    ) {
      sendJson(res, { error: "invalidProfile" }, 422);
      return;
    }
    if (action === "verify") {
      const verified = store.verifyPortablePayload(payload, data.signature);
      sendJson(res, { verified }, verified ? 200 : 422);
      return;
    }
    sendJson(res, {
      envelopeSchemaVersion: 1,
      algorithm: "HMAC-SHA256-v1",
      payload,
      signature: store.signPortablePayload(payload),
    });
  });
}

function handleAnalyticsApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, { error: "Method not allowed" }, 405);
    return;
  }
  const bucket = clientAddress(req);
  if (
    !isFeatureEnabled("analytics", isSensitiveTransportAllowed(req), bucket)
  ) {
    sendJson(res, { accepted: false }, 404);
    return;
  }
  if (!allowHttpRequest(req, "analytics", 120, HTTP_RATE_WINDOW_MS)) {
    sendRateLimited(res);
    return;
  }
  readJsonRequest(req, res, 4096, (data) => {
    const accepted = store.saveAnalyticsEvent(data);
    if (accepted) metrics.increment("blockdrop_analytics_events_total");
    sendJson(res, { accepted }, accepted ? 202 : 422);
  });
}

function authTokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? normalizeIdentityToken(match[1]) : "";
}

function accountFromRequest(req, explicitToken = "") {
  const token =
    normalizeIdentityToken(explicitToken) || authTokenFromRequest(req);
  return token ? store.getAccountBySession(token) : null;
}

function sanitizeRecord(data) {
  return {
    name: cleanName(data.name || "\u0418\u0433\u0440\u043e\u043a"),
    score: clamp(safeNumber(data.score), 0, MAX_RECORD_SCORE),
    lines: clamp(safeNumber(data.lines), 0, 9999),
    level: clamp(safeNumber(data.level), 1, 99),
    mode: String(
      data.mode || "\u041a\u043b\u0430\u0441\u0441\u0438\u043a\u0430",
    )
      .replace(/[<>]/g, "")
      .slice(0, 24),
    time: String(data.time || "0:00")
      .replace(/[<>]/g, "")
      .slice(0, 12),
    date: new Date().toISOString(),
  };
}

function sanitizeDailyScore(data, dateKey, account = null) {
  return {
    dateKey,
    playerId: account?.id
      ? `acct.${cleanPlayerId(account.id)}`
      : cleanPlayerId(data.playerId),
    name:
      account?.displayName ||
      cleanName(data.name || "\u0418\u0433\u0440\u043e\u043a"),
    score: clamp(safeNumber(data.score), 0, MAX_RECORD_SCORE),
    lines: clamp(safeNumber(data.lines), 0, 9999),
    level: clamp(safeNumber(data.level), 1, 99),
    timeMs: clamp(safeNumber(data.timeMs), 0, 60 * 60 * 1000 * 3),
  };
}

function isPlausibleRecord(record) {
  if (!record.score || record.score > MAX_RECORD_SCORE) return false;
  if (!record.time || !/^\d{1,3}:\d{2}$/.test(record.time)) return false;
  const seconds = parseTimeSeconds(record.time);
  if (seconds < 2 || seconds > 60 * 60 * 3) return false;
  if (record.level > Math.max(1, Math.floor(record.lines / 8) + 14))
    return false;

  const mode = record.mode.toLowerCase();
  const sprintCap = mode.includes("40") || mode.includes("sprint") ? 40 : 9999;
  if (record.lines > sprintCap) return false;

  const lineScoreCap =
    Math.max(1, record.lines) * Math.max(1, record.level) * 1100;
  const timeScoreCap = seconds * 520;
  const modifierCap = 9000 + record.level * 900;
  return record.score <= lineScoreCap + timeScoreCap + modifierCap;
}

function isPlausibleDailyScore(entry, data, run) {
  if (!entry.score || !entry.timeMs || entry.timeMs < 1500) return false;
  if (Number(run.startedAt) > Date.now() + 1000) return false;
  const wallElapsed = Date.now() - Number(run.startedAt);
  if (entry.timeMs > wallElapsed + 15000) return false;
  if (entry.timeMs < wallElapsed - 6 * 60 * 60 * 1000) return false;
  const pieces = clamp(safeNumber(data.pieces), 0, 20000);
  const bestCombo = clamp(safeNumber(data.bestCombo), 0, 999);
  const tSpins = clamp(safeNumber(data.tSpins), 0, 999);
  const perfectClears = clamp(safeNumber(data.perfectClears), 0, 999);
  if (pieces && entry.lines > pieces * 4) return false;
  if (bestCombo > entry.lines + 1) return false;
  if (tSpins > pieces) return false;
  if (perfectClears > Math.max(1, Math.floor(entry.lines / 4) + 1))
    return false;
  const seconds = Math.max(1, entry.timeMs / 1000);
  const lineRateCap = seconds * 3.2 + 8;
  if (entry.lines > lineRateCap) return false;
  const scoreCap =
    Math.max(1, entry.lines) * Math.max(1, entry.level) * 1800 +
    seconds * 900 +
    bestCombo * 650 +
    tSpins * 4500 +
    perfectClears * 5000 +
    12000;
  return entry.score <= scoreCap;
}

function verifyDailyReplay(data, entry, run) {
  const submitted = data?.replay;
  if (!submitted || typeof submitted !== "object") {
    return { ok: false, code: "replayRequired" };
  }
  if (
    Number(submitted.engineVersion) !== engine.ENGINE_VERSION ||
    Number(submitted.replayVersion) !== engine.REPLAY_VERSION ||
    submitted.seed !== `daily:${run.seed}` ||
    submitted.mode !== "classic" ||
    !Array.isArray(submitted.inputs) ||
    submitted.inputs.length > 100000 ||
    (submitted.externalEvents || []).length
  ) {
    return { ok: false, code: "invalidDailyReplay" };
  }
  const verified = engine.simulateReplay(submitted, engine.TICK_RATE * 60 * 60);
  if (!verified.ok) return { ok: false, code: verified.code };
  const replayTimeMs = Math.floor(
    (Number(verified.state.tick) / engine.TICK_RATE) * 1000,
  );
  if (
    verified.state.score !== entry.score ||
    verified.state.lines !== entry.lines ||
    verified.state.level !== entry.level ||
    Math.abs(replayTimeMs - entry.timeMs) > 20 ||
    String(data.replayChecksum || "") !== verified.finalChecksum
  ) {
    return { ok: false, code: "dailyReplayResultMismatch" };
  }
  const replay = engine.createReplay({
    seed: submitted.seed,
    mode: submitted.mode,
    inputs: submitted.inputs,
    finalState: verified.state,
    metadata: {
      date: run.dateKey,
      playerId: run.playerId,
      score: entry.score,
      lines: entry.lines,
    },
  });
  return { ok: true, code: "ok", replay };
}

function parseTimeSeconds(value) {
  return store.parseTimeSeconds(value);
}

function sendJson(res, payload, status = 200) {
  writeHead(res, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(payload));
}

function writeHead(res, status, headers = {}) {
  if (status >= 500) metrics.increment("blockdrop_http_5xx_total");
  res.writeHead(status, {
    ...securityHeaders,
    "X-Request-Id": res.blockdropRequestId || crypto.randomUUID(),
    ...headers,
  });
}

function allowHttpRequest(req, bucketName, max, windowMs) {
  const now = Date.now();
  const key = `${clientAddress(req)}:${bucketName}`;
  const bucket = httpRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    httpRateBuckets.set(key, { startedAt: now, count: 1 });
    if (httpRateBuckets.size > 5000) {
      let checked = 0;
      for (const [entryKey, entry] of httpRateBuckets) {
        if (now - entry.startedAt >= windowMs) httpRateBuckets.delete(entryKey);
        if (++checked >= 100) break;
      }
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function sendRateLimited(res) {
  writeHead(res, 429, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": String(Math.ceil(HTTP_RATE_WINDOW_MS / 1000)),
  });
  res.end(JSON.stringify({ error: "rateLimited" }));
}

  return {
    safeDecodePath,
    handleHealth,
    handleLiveness,
    handleReadiness,
    sendHealthPayload,
    handleMetrics,
    hasMetricsAccess,
    timingSafeEqualText,
    serverDateKey,
    livePlayersCount,
    liveSpectatorsCount,
    updateLiveMetrics,
    readRevision,
    readPackageMeta,
    handleCapabilitiesApi,
    isFeatureEnabled,
    handleQrApi,
    handleRecordsApi,
    handleDailyApi,
    handleDailyRunApi,
    handleAccountApi,
    handleRankedApi,
    readJsonRequest,
    handleProfileTransferApi,
    handleAnalyticsApi,
    authTokenFromRequest,
    accountFromRequest,
    sanitizeRecord,
    sanitizeDailyScore,
    isPlausibleRecord,
    isPlausibleDailyScore,
    verifyDailyReplay,
    parseTimeSeconds,
    sendJson,
    writeHead,
    allowHttpRequest,
    sendRateLimited,
  };
};
