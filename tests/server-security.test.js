import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const engine = require("../shared/engine.js");
const ai = require("../shared/ai.js");

let serverProcess = null;
const databaseFiles = new Set();

function buildDailyReplay(seed) {
  const state = engine.createState({ seed: `daily:${seed}`, mode: "classic" });
  const inputs = [];
  let seq = 0;
  while (!state.gameOver && state.tick < 100) {
    const plan = ai.planMove(engine.snapshot(state), {
      difficulty: "hard",
      style: "defensive",
    });
    for (const action of plan.actions) {
      const input = {
        tick: state.tick,
        seq: ++seq,
        action,
        pressed: true,
      };
      inputs.push(input);
      engine.applyInput(state, input, []);
    }
    for (let tick = 0; tick < 12 && !state.gameOver; tick += 1) {
      engine.step(state);
    }
  }
  const replay = engine.createReplay({
    seed: state.seed,
    mode: state.mode,
    inputs,
    finalState: state,
  });
  return { state, replay };
}

afterEach(() => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  for (const databaseFile of databaseFiles) {
    for (const file of [
      databaseFile,
      `${databaseFile}-shm`,
      `${databaseFile}-wal`,
    ]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // the server process can retain a transient WAL handle on Windows
      }
    }
  }
  databaseFiles.clear();
});

function startServer(port, env = {}) {
  const databaseFile = path.join(
    os.tmpdir(),
    `blockdrop-security-${crypto.randomUUID()}.sqlite`,
  );
  databaseFiles.add(databaseFile);
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        BLOCKDROP_DB_FILE: databaseFile,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(
      () => reject(new Error("server did not start")),
      15000,
    );
    serverProcess.stdout.on("data", (chunk) => {
      if (String(chunk).includes(`localhost:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.on("error", reject);
  });
}

function requestWithHost(port, requestPath, host, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : "";
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method: options.method || "GET",
        headers: {
          Host: host,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: responseBody,
          }),
        );
      },
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function maskedTextFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function sendBadWebSocketMessage(port) {
  return sendWebSocketMessages(port, ["not-json"]);
}

function sendWebSocketMessages(port, messages, { origin = "" } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const key = crypto.randomBytes(16).toString("base64");
    let handshaken = false;
    const timeout = setTimeout(
      () => reject(new Error("websocket did not close")),
      5000,
    );

    socket.on("connect", () => {
      socket.write(
        [
          "GET / HTTP/1.1",
          "Host: 127.0.0.1",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          origin ? `Origin: ${origin}` : "",
          "",
          "",
        ]
          .filter((line) => line !== "")
          .join("\r\n") + "\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      if (handshaken) return;
      const response = String(chunk);
      if (!response.startsWith("HTTP/1.1 101")) return;
      handshaken = true;
      for (const message of messages) {
        socket.write(
          maskedTextFrame(
            typeof message === "string" ? message : JSON.stringify(message),
          ),
        );
      }
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      resolve(handshaken);
    });
    socket.on("error", reject);
  });
}

describe("server hardening", () => {
  it("serves extracted CSS with the correct content type", async () => {
    const port = 18901;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/styles.css`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("never exposes source, database, repository, or traversal paths", async () => {
    const port = 18913;
    await startServer(port);
    for (const requestPath of [
      "/server.js",
      "/server-store.js",
      "/package-lock.json",
      "/blockdrop.sqlite",
      "/.git/HEAD",
      "/.github/workflows/release-deploy.yml",
      "/js/%2e%2e/server.js",
      "/js/%5c..%5cserver.js",
    ]) {
      const response = await requestWithHost(port, requestPath, "127.0.0.1");
      expect(response.status, requestPath).toBe(404);
    }
  });

  it("disables accounts and ranked capabilities on plain public HTTP", async () => {
    const port = 18914;
    await startServer(port);
    const capabilities = await requestWithHost(
      port,
      "/api/capabilities",
      "45.148.117.119",
    );
    expect(JSON.parse(capabilities.body)).toMatchObject({
      secureTransport: false,
      authEnabled: false,
      rankedEnabled: false,
      casualOnlineEnabled: true,
    });

    const account = await requestWithHost(
      port,
      "/api/account",
      "45.148.117.119",
      {
        method: "POST",
        body: {
          action: "register",
          username: "unsafeuser",
          password: "password123",
        },
      },
    );
    expect(account.status).toBe(426);
    expect(JSON.parse(account.body).error).toBe("secureTransportRequired");
  });

  it("generates same-origin room QR codes locally", async () => {
    const port = 18915;
    await startServer(port);
    const response = await requestWithHost(
      port,
      `/api/qr?data=${encodeURIComponent(`http://127.0.0.1/room/FRIENDS`)}`,
      "127.0.0.1",
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.body).toContain("<svg");
  });

  it("rejects malformed encoded paths without crashing", async () => {
    const port = 18903;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
    expect(response.status).toBe(400);

    const health = await fetch(`http://127.0.0.1:${port}/`);
    expect(health.status).toBe(200);
  });

  it("reports service health for deployment checks", async () => {
    const port = 18904;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("blockdrop-web-game");
    expect(payload.rooms).toBe(0);
    expect(Number.isInteger(payload.uptimeSec)).toBe(true);
  });

  it("separates liveness and database readiness probes", async () => {
    const port = 18918;
    await startServer(port);

    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);

    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ ok: true, status: "live" });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      status: "ready",
      database: "ready",
    });
  });

  it("protects metrics with a bearer token when configured", async () => {
    const port = 18919;
    await startServer(port, { BLOCKDROP_METRICS_TOKEN: "test-metrics-token" });

    const denied = await fetch(`http://127.0.0.1:${port}/metrics`);
    const allowed = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { Authorization: "Bearer test-metrics-token" },
    });

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("blockdrop_rooms_active");
  });

  it("signs profile exports and requires a valid signature on import", async () => {
    const port = 18921;
    await startServer(port);
    const payload = {
      kind: "blockdrop-profile",
      exportSchemaVersion: 1,
      profile: { profileSchemaVersion: 1, xp: 900 },
    };
    const signedResponse = await fetch(
      `http://127.0.0.1:${port}/api/profile-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign", payload }),
      },
    );
    const signed = await signedResponse.json();
    expect(signedResponse.status).toBe(200);
    expect(signed).toMatchObject({
      envelopeSchemaVersion: 1,
      algorithm: "HMAC-SHA256-v1",
      payload,
    });
    expect(signed.signature).toBeTruthy();

    const verified = await fetch(
      `http://127.0.0.1:${port}/api/profile-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          payload,
          signature: signed.signature,
        }),
      },
    );
    expect(verified.status).toBe(200);
    await expect(verified.json()).resolves.toEqual({ verified: true });

    const tampered = await fetch(
      `http://127.0.0.1:${port}/api/profile-transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          payload: { ...payload, profile: { ...payload.profile, xp: 901 } },
          signature: signed.signature,
        }),
      },
    );
    expect(tampered.status).toBe(422);
  });

  it("accepts only consented analytics behind its feature flag", async () => {
    const port = 18922;
    await startServer(port, { BLOCKDROP_FEATURE_ANALYTICS: "true" });
    const denied = await fetch(`http://127.0.0.1:${port}/api/analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName: "game_finish",
        consented: false,
      }),
    });
    expect(denied.status).toBe(422);

    const accepted = await fetch(`http://127.0.0.1:${port}/api/analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName: "game_finish",
        sessionId: "session.test",
        mode: "classic",
        durationMs: 1000,
        payload: { result: "win", board: [[1]], token: "secret" },
        consented: true,
      }),
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toEqual({ accepted: true });
  });

  it("does not treat reverse-proxied metrics requests as localhost", async () => {
    const port = 18920;
    await startServer(port);

    const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { "X-Forwarded-For": "203.0.113.10" },
    });

    expect(response.status).toBe(404);
  });

  it("serves metrics and a stable server-side daily challenge seed", async () => {
    const port = 18911;
    await startServer(port);

    const dailyA = await fetch(`http://127.0.0.1:${port}/api/daily`);
    const payloadA = await dailyA.json();
    const dailyB = await fetch(`http://127.0.0.1:${port}/api/daily`);
    const payloadB = await dailyB.json();
    await fetch(`http://127.0.0.1:${port}/api/daily`, { method: "HEAD" });
    const healthBeforeRun = await fetch(`http://127.0.0.1:${port}/health`);
    const healthBeforeRunPayload = await healthBeforeRun.json();
    const runResponse = await fetch(`http://127.0.0.1:${port}/api/daily/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: "stable-guest" }),
    });
    const runPayload = await runResponse.json();
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    const metricsText = await metrics.text();

    expect(payloadA.date).toBeTruthy();
    expect(payloadA.seed).toBe(payloadB.seed);
    expect(payloadA.runToken).toBeUndefined();
    expect(payloadA.runSignature).toBeUndefined();
    expect(Array.isArray(payloadA.leaderboard)).toBe(true);
    expect(healthBeforeRunPayload.dailyRuns).toBe(0);
    expect(runResponse.status).toBe(201);
    expect(runPayload.runToken).toBeTruthy();
    expect(runPayload.runSignature).toBeTruthy();
    expect(metrics.status).toBe(200);
    expect(metricsText).toContain("blockdrop_rooms_active");
    expect(metricsText).toContain("blockdrop_records_total");
  });

  it("registers account sessions and uses account identity for daily scores", async () => {
    const port = 18912;
    await startServer(port);

    const register = await fetch(`http://127.0.0.1:${port}/api/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "register",
        username: "DailyUser",
        password: "password123",
        displayName: "Daily",
      }),
    });
    const accountPayload = await register.json();
    expect(register.status).toBe(200);
    expect(accountPayload.account.username).toBe("dailyuser");
    expect(accountPayload.token).toBeTruthy();

    const session = await fetch(`http://127.0.0.1:${port}/api/account`, {
      headers: { Authorization: `Bearer ${accountPayload.token}` },
    });
    await expect(session.json()).resolves.toMatchObject({
      account: { username: "dailyuser", displayName: "Daily" },
    });

    const passwordChange = await fetch(`http://127.0.0.1:${port}/api/account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accountPayload.token}`,
      },
      body: JSON.stringify({
        action: "changePassword",
        currentPassword: "password123",
        newPassword: "password456",
      }),
    });
    expect(passwordChange.status).toBe(200);
    const passwordPayload = await passwordChange.json();
    expect(passwordPayload.token).toBeTruthy();

    const revokedSession = await fetch(`http://127.0.0.1:${port}/api/account`, {
      headers: { Authorization: `Bearer ${accountPayload.token}` },
    });
    expect(revokedSession.status).toBe(401);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/daily/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${passwordPayload.token}`,
      },
      body: JSON.stringify({ playerId: "local" }),
    });
    expect(runResponse.status).toBe(201);
    const run = await runResponse.json();
    const dailyRun = buildDailyReplay(run.seed);
    const daily = await fetch(`http://127.0.0.1:${port}/api/daily`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${passwordPayload.token}`,
      },
      body: JSON.stringify({
        runToken: run.runToken,
        runSignature: run.runSignature,
        playerId: "local",
        name: "Local",
        score: dailyRun.state.score,
        lines: dailyRun.state.lines,
        level: dailyRun.state.level,
        timeMs: Math.floor((dailyRun.state.tick / engine.TICK_RATE) * 1000),
        pieces: dailyRun.state.pieces,
        bestCombo: dailyRun.state.combo,
        tSpins: 0,
        perfectClears: 0,
        replayChecksum: dailyRun.replay.finalChecksum,
        replay: dailyRun.replay,
      }),
    });
    const dailyPayload = await daily.json();
    expect(dailyPayload.leaderboard[0]).toMatchObject({
      name: "Daily",
      score: dailyRun.state.score,
    });
    expect(dailyPayload.leaderboard[0].playerId).toMatch(/^acct\./);

    const ranked = await fetch(`http://127.0.0.1:${port}/api/ranked`);
    const rankedPayload = await ranked.json();
    expect(ranked.status).toBe(200);
    expect(Array.isArray(rankedPayload.leaderboard)).toBe(true);
  });

  it("sends baseline browser security headers", async () => {
    const port = 18909;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("rejects impossible server records", async () => {
    const port = 18905;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/api/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cheater",
        score: 99999999,
        lines: 1,
        level: 1,
        mode: "Классика",
        time: "0:03",
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "Record rejected by server authority",
    });
  });

  it("accepts plausible server records", async () => {
    const port = 18906;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/api/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Player",
        score: 1200,
        lines: 4,
        level: 2,
        mode: "Классика",
        time: "1:05",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records[0].score).toBe(1200);
  });

  it("closes suspicious WebSocket clients instead of accepting bad payloads", async () => {
    const port = 18902;
    await startServer(port);
    await expect(sendBadWebSocketMessage(port)).resolves.toBe(true);
  });

  it("closes WebSocket clients that send invalid update payloads", async () => {
    const port = 18907;
    await startServer(port);
    await expect(
      sendWebSocketMessages(port, [
        { type: "join", room: "SAFE", name: "P1" },
        {
          type: "update",
          room: "SAFE",
          name: "P1",
          score: "not-a-score",
          lines: 0,
          level: 1,
          height: 0,
          sentGarbage: 0,
          receivedGarbage: 0,
          mode: "Classic",
          time: "0:00",
          status: "Playing",
        },
      ]),
    ).resolves.toBe(true);
  });

  it("closes WebSocket clients that send invalid attack payloads", async () => {
    const port = 18908;
    await startServer(port);
    await expect(
      sendWebSocketMessages(port, [
        { type: "join", room: "SAFE", name: "P1" },
        { type: "attack", room: "SAFE", lines: 99 },
      ]),
    ).resolves.toBe(true);
  });

  it("rejects WebSocket upgrades from unexpected browser origins", async () => {
    const port = 18910;
    await startServer(port);
    await expect(
      sendWebSocketMessages(
        port,
        [{ type: "join", room: "SAFE", name: "P1" }],
        { origin: "https://example.invalid" },
      ),
    ).resolves.toBe(false);
  });
});
