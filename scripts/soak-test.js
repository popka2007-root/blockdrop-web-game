const { WebSocket } = require("ws");

const DEFAULT_CCU = 100;
const DEFAULT_DURATION_SEC = 2 * 60 * 60;
const INPUT_INTERVAL_MS = 750;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--")) {
      options[argument.slice(2)] = argv[++index];
    }
  }
  return options;
}

function integerOption(value, fallback, minimum, maximum) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Expected an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function websocketUrl(target) {
  const url = new URL(target);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

function parseMetrics(source) {
  const metrics = {};
  for (const line of String(source || "").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][\w:]*)\s+(-?[\d.eE+]+)$/);
    if (match) metrics[match[1]] = Number(match[2]);
  }
  return metrics;
}

async function readMetrics(target, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(new URL("/metrics", target), { headers });
  if (!response.ok) {
    throw new Error(`Metrics request failed with HTTP ${response.status}`);
  }
  return parseMetrics(await response.text());
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectClient(url, room, index, state) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      origin: new URL(url.replace(/^ws/, "http")).origin,
    });
    const client = {
      index,
      room,
      socket,
      matchId: "",
      serverTick: 0,
      seq: 0,
      ready: false,
    };
    const timer = setTimeout(() => {
      socket.terminate();
      reject(
        new Error(`Client ${index} timed out during protocol negotiation`),
      );
    }, 10000);

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "join",
          room,
          name: `Soak${index}`,
          maxPlayers: 2,
          durationSec: 1800,
          mode: "classic",
          ranked: false,
          protocolVersion: 2,
        }),
      );
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        state.protocolErrors += 1;
        return;
      }
      if (message.type === "protocol") {
        if (message.selectedVersion !== 2 || !message.authoritative) {
          clearTimeout(timer);
          reject(
            new Error(`Client ${index} did not negotiate authoritative v2`),
          );
          return;
        }
        if (!client.ready) {
          client.ready = true;
          clearTimeout(timer);
          state.connected += 1;
          resolve(client);
        }
      }
      if (message.type === "matchStart" || message.type === "rematchStart") {
        client.matchId = String(message.matchId || "");
        client.serverTick = 0;
        client.seq = 0;
        state.matchesStarted += 1;
      } else if (message.type === "match.snapshot") {
        client.matchId = String(message.matchId || client.matchId);
        client.serverTick = Number(message.serverTick) || 0;
        state.snapshots += 1;
      } else if (message.type === "match.result") {
        state.matchesFinished += 1;
        client.matchId = "";
        if (!state.stopping && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "rematchReady", room }));
        }
      } else if (message.type === "error") {
        state.protocolErrors += 1;
        if (state.protocolErrorMessages.length < 20) {
          state.protocolErrorMessages.push(
            String(message.message || "unknown"),
          );
        }
      }
    });
    socket.on("close", (code, reason) => {
      if (!state.stopping) {
        state.unexpectedDisconnects += 1;
        if (state.unexpectedCloseReasons.length < 20) {
          state.unexpectedCloseReasons.push({
            code,
            reason: String(reason || ""),
            room,
            index,
          });
        }
      }
    });
    socket.on("error", (error) => {
      if (!client.ready) {
        clearTimeout(timer);
        reject(error);
      } else if (!state.stopping) {
        state.socketErrors += 1;
      }
    });
  });
}

function sendInputs(clients, state) {
  for (const client of clients) {
    if (!client.matchId || client.socket.readyState !== WebSocket.OPEN)
      continue;
    client.seq += 1;
    client.socket.send(
      JSON.stringify({
        type: "input",
        matchId: client.matchId,
        seq: client.seq,
        tick: client.serverTick,
        action: client.seq % 7 === 0 ? "rotateCW" : "hardDrop",
        pressed: true,
      }),
    );
    state.inputsSent += 1;
  }
}

function metricDelta(after, before, name) {
  return Number(after[name] || 0) - Number(before[name] || 0);
}

async function runSoak(options = {}) {
  const target = String(
    options.target ||
      process.env.BLOCKDROP_SOAK_TARGET ||
      "http://127.0.0.1:8787",
  );
  const ccu = integerOption(
    options.ccu || process.env.BLOCKDROP_SOAK_CCU,
    DEFAULT_CCU,
    2,
    100,
  );
  if (ccu % 2 !== 0) throw new Error("CCU must be even for two-player rooms");
  const durationSec = integerOption(
    options.duration || process.env.BLOCKDROP_SOAK_DURATION_SEC,
    DEFAULT_DURATION_SEC,
    5,
    DEFAULT_DURATION_SEC,
  );
  const metricsToken = String(
    options["metrics-token"] || process.env.BLOCKDROP_METRICS_TOKEN || "",
  );
  const state = {
    connected: 0,
    inputsSent: 0,
    matchesStarted: 0,
    matchesFinished: 0,
    snapshots: 0,
    protocolErrors: 0,
    protocolErrorMessages: [],
    socketErrors: 0,
    unexpectedDisconnects: 0,
    unexpectedCloseReasons: [],
    stopping: false,
  };
  const before = await readMetrics(target, metricsToken);
  const clients = [];
  const wsUrl = websocketUrl(target);
  const startedAt = Date.now();
  try {
    for (let roomIndex = 0; roomIndex < ccu / 2; roomIndex += 1) {
      const room = `SOAK${String(roomIndex).padStart(4, "0")}`;
      const pair = await Promise.all([
        connectClient(wsUrl, room, roomIndex * 2, state),
        connectClient(wsUrl, room, roomIndex * 2 + 1, state),
      ]);
      clients.push(...pair);
      if (roomIndex % 5 === 4) await wait(25);
    }

    const cpuSamples = [];
    const rssSamples = [];
    const inputTimer = setInterval(
      () => sendInputs(clients, state),
      INPUT_INTERVAL_MS,
    );
    const metricTimer = setInterval(async () => {
      try {
        const sample = await readMetrics(target, metricsToken);
        cpuSamples.push(Number(sample.blockdrop_process_cpu_percent || 0));
        rssSamples.push(Number(sample.blockdrop_memory_rss_bytes || 0));
      } catch {
        state.protocolErrors += 1;
      }
    }, 5000);
    await wait(durationSec * 1000);
    clearInterval(inputTimer);
    clearInterval(metricTimer);

    const after = await readMetrics(target, metricsToken);
    cpuSamples.push(Number(after.blockdrop_process_cpu_percent || 0));
    rssSamples.push(Number(after.blockdrop_memory_rss_bytes || 0));
    const result = {
      ok: true,
      target,
      requestedCcu: ccu,
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      ...state,
      peakCpuPercent: Math.max(0, ...cpuSamples),
      peakRssBytes: Math.max(0, ...rssSamples),
      httpP95Ms: Number(after.blockdrop_http_request_ms_p95 || 0),
      matchP95Ms: Number(after.blockdrop_match_processing_ms_p95 || 0),
      dbLockErrors: metricDelta(
        after,
        before,
        "blockdrop_db_lock_errors_total",
      ),
      serverDisconnects: metricDelta(
        after,
        before,
        "blockdrop_ws_disconnect_total",
      ),
    };
    const failures = [];
    if (result.connected !== ccu)
      failures.push(`connected ${result.connected}/${ccu}`);
    if (result.snapshots < ccu)
      failures.push("authoritative snapshots were not received");
    if (
      result.unexpectedDisconnects ||
      result.socketErrors ||
      result.protocolErrors
    ) {
      failures.push("client connection or protocol errors occurred");
    }
    if (result.peakCpuPercent >= 70)
      failures.push(`CPU ${result.peakCpuPercent.toFixed(1)}%`);
    if (result.peakRssBytes >= 1024 ** 3)
      failures.push(`RSS ${result.peakRssBytes} bytes`);
    if (result.dbLockErrors !== 0)
      failures.push(`${result.dbLockErrors} SQLite lock errors`);
    if (result.httpP95Ms >= 200)
      failures.push(`HTTP p95 ${result.httpP95Ms.toFixed(1)} ms`);
    if (result.matchP95Ms >= 50)
      failures.push(`match p95 ${result.matchP95Ms.toFixed(1)} ms`);
    result.ok = failures.length === 0;
    result.failures = failures;
    return result;
  } finally {
    state.stopping = true;
    for (const client of clients) client.socket.close(1000, "soak complete");
  }
}

if (require.main === module) {
  runSoak(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  parseMetrics,
  runSoak,
  websocketUrl,
};
