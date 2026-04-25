import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

let serverProcess = null;

afterEach(() => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
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

  it("closes suspicious WebSocket clients instead of accepting bad payloads", async () => {
    const port = 18902;
    await startServer(port);
    await expect(sendBadWebSocketMessage(port)).resolves.toBe(true);
  });
});
