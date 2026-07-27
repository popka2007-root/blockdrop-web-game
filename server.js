const http = require("http");
const { WebSocketServer } = require("ws");
const { createMetrics, createLogger } = require("./server-observability");
const { createServerStore } = require("./server-store");
const { createHttpRouter } = require("./server-http");
const { createGameManager } = require("./server-game");
const { createWsHandler } = require("./server-ws");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const MAX_WS_FRAME_BYTES = 4096;

const rooms = new Map();
const rankedQueue = [];
const startedAt = Date.now();

const store = createServerStore({
  root: ROOT,
  dbFile: process.env.BLOCKDROP_DB_FILE || undefined,
});

const logger = createLogger({ service: "blockdrop-web-game" });
const metrics = createMetrics();

metrics.increment("blockdrop_http_5xx_total", 0);
metrics.increment("blockdrop_ws_disconnect_total", 0);
metrics.increment("blockdrop_match_abort_total", 0);
metrics.increment("blockdrop_db_errors_total", 0);
metrics.increment("blockdrop_db_lock_errors_total", 0);

let eventLoopExpectedAt = performance.now() + 1000;
let previousCpuUsage = process.cpuUsage();
let previousCpuMeasuredAt = performance.now();

const operationalMetricsTimer = setInterval(() => {
  const now = performance.now();
  metrics.set(
    "blockdrop_event_loop_lag_ms",
    Math.max(0, now - eventLoopExpectedAt),
  );
  eventLoopExpectedAt = now + 1000;
  const memory = process.memoryUsage();
  metrics.set("blockdrop_memory_rss_bytes", memory.rss);
  metrics.set("blockdrop_memory_heap_used_bytes", memory.heapUsed);
  const cpuUsage = process.cpuUsage(previousCpuUsage);
  const elapsedMicroseconds = Math.max(1, (now - previousCpuMeasuredAt) * 1000);
  metrics.set(
    "blockdrop_process_cpu_percent",
    ((cpuUsage.user + cpuUsage.system) / elapsedMicroseconds) * 100,
  );
  previousCpuUsage = process.cpuUsage();
  previousCpuMeasuredAt = now;
}, 1000);
operationalMetricsTimer.unref();

const gameManager = createGameManager({
  store,
  logger,
  metrics,
  rooms,
  rankedQueue,
});

const httpRouter = createHttpRouter({
  store,
  logger,
  metrics,
  rooms,
  rankedQueue,
  startedAt,
  rootDir: ROOT,
});

const server = http.createServer((req, res) => {
  httpRouter.handleHttpRequest(req, res);
});

const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_FRAME_BYTES,
  perMessageDeflate: false,
});

const wsHandler = createWsHandler({
  webSocketServer,
  gameManager,
  metrics,
  logger,
  rooms,
  isFeatureEnabled: httpRouter.isFeatureEnabled,
});

server.on("upgrade", (req, socket, head) => {
  wsHandler.handleUpgrade(req, socket, head);
});

webSocketServer.on("connection", (socket, req) => {
  wsHandler.handleConnection(socket, req);
});

function shutdown() {
  logger.info("server_shutdown_starting");
  clearInterval(operationalMetricsTimer);
  closeStoreAndExit(0);
}

function closeStoreAndExit(exitCode) {
  try {
    store.close();
  } catch (err) {
    logger.error("store_close_error", { error: String(err?.message || err) });
  } finally {
    process.exit(exitCode);
  }
}

function pruneProductData() {
  const dailyDate = httpRouter.serverDateKey();
  store.pruneDailyRuns(dailyDate);
  store.pruneAnalytics(7);
  store.pruneReplays();
}

const productPruneTimer = setInterval(pruneProductData, 60 * 60 * 1000);
productPruneTimer.unref();
pruneProductData();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (require.main === module) {
  server.listen(PORT, () => {
    logger.info("server_started", { port: PORT });
  });
}

module.exports = {
  server,
  webSocketServer,
  store,
  metrics,
  logger,
  rooms,
  rankedQueue,
  gameManager,
  httpRouter,
  wsHandler,
};
