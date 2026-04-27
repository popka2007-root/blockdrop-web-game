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
  try {
    fs.unlinkSync(path.join(process.cwd(), "records.json"));
  } catch {
    // no records were written
  }
});

function startServer(port) {
  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => reject(new Error("server did not start")), 5000);
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
  const header = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function sendBadWebSocketMessage(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const key = crypto.randomBytes(16).toString("base64");
    let handshaken = false;
    const timeout = setTimeout(() => reject(new Error("websocket did not close")), 5000);

    socket.on("connect", () => {
      socket.write([
        "GET / HTTP/1.1",
        "Host: 127.0.0.1",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        ""
      ].join("\r\n"));
    });
    socket.on("data", () => {
      if (handshaken) return;
      handshaken = true;
      socket.write(maskedTextFrame("not-json"));
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
        time: "0:03"
      })
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "Record rejected by server authority" });
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
        time: "1:05"
      })
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
});
