import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

let serverProcess = null;

afterEach(() => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  for (const file of [
    "records.json",
    "ranked.json",
    "blockdrop.sqlite",
    "blockdrop.sqlite-shm",
    "blockdrop.sqlite-wal",
  ]) {
    try {
      fs.unlinkSync(path.join(process.cwd(), file));
    } catch {
      // file may not exist for every test
    }
  }
});

function startServer(port) {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(
      () => reject(new Error("server did not start")),
      5000,
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

  it("serves metrics and a stable server-side daily challenge seed", async () => {
    const port = 18911;
    await startServer(port);

    const dailyA = await fetch(`http://127.0.0.1:${port}/api/daily`);
    const payloadA = await dailyA.json();
    const dailyB = await fetch(`http://127.0.0.1:${port}/api/daily`);
    const payloadB = await dailyB.json();
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    const metricsText = await metrics.text();

    expect(payloadA.date).toBeTruthy();
    expect(payloadA.seed).toBe(payloadB.seed);
    expect(Array.isArray(payloadA.leaderboard)).toBe(true);
    expect(metrics.status).toBe(200);
    expect(metricsText).toContain("blockdrop_rooms_active");
    expect(metricsText).toContain("blockdrop_records_total");
  });

  it("sends baseline browser security headers", async () => {
    const port = 18909;
    await startServer(port);
    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
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
