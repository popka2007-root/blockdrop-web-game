import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let serverProcess = null;
const openClients = new Set();

afterEach(async () => {
  await Promise.all([...openClients].map((client) => closeClient(client)));
  openClients.clear();
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
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 0xff]);
  }

  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeTextFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const opcode = first & 0x0f;
    const second = buffer[offset + 1];
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let header = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      header = 10;
    }

    const maskOffset = offset + header;
    const dataOffset = maskOffset + (masked ? 4 : 0);
    const frameEnd = dataOffset + length;
    if (frameEnd > buffer.length) break;

    if (opcode === 0x08) {
      offset = frameEnd;
      continue;
    }
    if (opcode !== 0x01) {
      throw new Error(`Unsupported frame opcode ${opcode}`);
    }

    const payload = Buffer.from(buffer.subarray(dataOffset, frameEnd));
    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }

    messages.push(payload.toString("utf8"));
    offset = frameEnd;
  }

  return { messages, rest: buffer.subarray(offset) };
}

function connectClient(
  port,
  { room = "DUEL", name = "Player", maxPlayers = 2, durationSec = 180 } = {},
) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const client = {
      socket,
      messages: [],
      waiters: new Set(),
      buffer: Buffer.alloc(0),
      handshaken: false,
      send(payload) {
        socket.write(
          maskedTextFrame(
            typeof payload === "string" ? payload : JSON.stringify(payload),
          ),
        );
      },
      waitFor(predicate, timeoutMs = 5000, label = "message") {
        return waitForMessage(this, predicate, timeoutMs, label);
      },
      waitForType(type, predicate = () => true, timeoutMs = 5000) {
        return waitForMessage(
          this,
          (message) => message.type === type && predicate(message),
          timeoutMs,
          type,
        );
      },
      resetMessages() {
        this.messages.length = 0;
      },
    };
    openClients.add(client);

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("websocket handshake timed out"));
    }, 5000);

    socket.on("connect", () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          "GET / HTTP/1.1",
          "Host: 127.0.0.1",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, Buffer.from(chunk)]);

      if (!client.handshaken) {
        const headerEnd = client.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const response = client.buffer.subarray(0, headerEnd).toString("utf8");
        if (!response.startsWith("HTTP/1.1 101")) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`unexpected handshake response: ${response}`));
          }
          return;
        }
        client.handshaken = true;
        client.buffer = client.buffer.subarray(headerEnd + 4);
        client.send({
          type: "join",
          room,
          name,
          maxPlayers,
          durationSec,
        });
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(client);
        }
      }

      if (!client.handshaken || client.buffer.length === 0) return;
      const { messages, rest } = decodeTextFrames(client.buffer);
      client.buffer = rest;
      for (const raw of messages) {
        const payload = JSON.parse(raw);
        client.messages.push(payload);
        for (const waiter of [...client.waiters]) {
          if (!waiter.predicate(payload)) continue;
          clearTimeout(waiter.timer);
          client.waiters.delete(waiter);
          waiter.resolve(payload);
        }
      }
    });

    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

function waitForMessage(client, predicate, timeoutMs, label) {
  const existing = client.messages.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      timer: setTimeout(() => {
        client.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${label}`));
      }, timeoutMs),
    };
    client.waiters.add(waiter);
  });
}

function expectNoMessage(client, predicate, durationMs = 500) {
  const startIndex = client.messages.length;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const unexpected = client.messages.slice(startIndex).find(predicate);
      if (unexpected) {
        reject(
          new Error(`Unexpected message: ${JSON.stringify(unexpected)}`),
        );
        return;
      }
      resolve();
    }, durationMs);
  });
}

async function closeClient(client) {
  if (!client?.socket || client.socket.destroyed) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 250);
    client.socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    client.socket.destroy();
  });
}

describe("online PvP room flow", () => {
  it("keeps rooms at 1v1, auto-starts, and moves extra clients to spectator mode", async () => {
    const port = 18921;
    await startServer(port);

    const first = await connectClient(port, {
      room: "duel",
      name: "Alpha",
      maxPlayers: 8,
    });
    const firstHello = await first.waitForType("hello");
    expect(firstHello.id).toBeTruthy();
    await expect(first.waitForType("role")).resolves.toMatchObject({
      role: "player",
    });

    const second = await connectClient(port, {
      room: "duel",
      name: "Bravo",
      maxPlayers: 8,
    });
    await expect(second.waitForType("role")).resolves.toMatchObject({
      role: "player",
    });

    const state = await first.waitForType(
      "roomState",
      (message) =>
        message.players?.length === 2 &&
        message.tournament?.maxPlayers === 2,
    );
    expect(state.players).toHaveLength(2);
    expect(state.spectators).toHaveLength(0);
    await expect(first.waitForType("state")).resolves.toMatchObject({
      room: "DUEL",
    });
    await expect(first.waitForType("countdown")).resolves.toMatchObject({
      value: 3,
    });

    const third = await connectClient(port, {
      room: "duel",
      name: "Charlie",
      maxPlayers: 8,
    });
    await expect(third.waitForType("role")).resolves.toMatchObject({
      role: "spectator",
    });
    await expect(third.waitForType("notice")).resolves.toMatchObject({
      code: "spectator",
    });
    await expect(
      third.waitForType(
        "roomState",
        (message) =>
          message.players?.length === 2 && message.spectators?.length === 1,
      ),
    ).resolves.toMatchObject({
      spectators: [expect.objectContaining({ name: "Charlie", role: "spectator" })],
    });
  });

  it("answers ping and ignores spectator attacks", async () => {
    const port = 18922;
    await startServer(port);

    const first = await connectClient(port, { room: "duel", name: "Alpha" });
    await first.waitForType("role", (message) => message.role === "player");
    const second = await connectClient(port, { room: "duel", name: "Bravo" });
    await second.waitForType("role", (message) => message.role === "player");
    const spectator = await connectClient(port, {
      room: "duel",
      name: "Charlie",
      maxPlayers: 8,
    });
    await spectator.waitForType("role", (message) => message.role === "spectator");
    await first.waitForType("matchStart", () => true, 6000);

    first.resetMessages();
    spectator.send({ type: "ping", ts: 12345 });
    await expect(spectator.waitForType("pong")).resolves.toMatchObject({
      ts: 12345,
    });

    spectator.send({ type: "attack", room: "duel", lines: 4 });
    await expectNoMessage(
      first,
      (message) => message.type === "attack" || message.type === "garbage",
      700,
    );
  });

  it(
    "restores a disconnected player who rejoins within the grace window",
    async () => {
      const port = 18923;
      await startServer(port);

      const first = await connectClient(port, { room: "duel", name: "Alpha" });
      const firstHello = await first.waitForType("hello");
      const second = await connectClient(port, { room: "duel", name: "Bravo" });
      await second.waitForType("role", (message) => message.role === "player");
      await first.waitForType("matchStart", () => true, 6000);

      await closeClient(first);
      await expect(second.waitForType("reconnecting")).resolves.toMatchObject({
        name: "Alpha",
        playerId: firstHello.id,
      });

      const rejoined = await connectClient(port, { room: "duel", name: "Alpha" });
      await expect(
        rejoined.waitForType("hello", (message) => message.id === firstHello.id),
      ).resolves.toMatchObject({
        id: firstHello.id,
      });
      await expect(rejoined.waitForType("role")).resolves.toMatchObject({
        role: "player",
      });
      await expect(
        rejoined.waitForType(
          "roomState",
          (message) =>
            message.players?.length === 2 &&
            (message.match?.reconnecting || []).length === 0,
        ),
      ).resolves.toBeTruthy();
      await expectNoMessage(
        second,
        (message) =>
          message.type === "matchFinished" && message.reason === "disconnect",
        1200,
      );
    },
    12000,
  );

  it(
    "finishes the match after the disconnect grace window expires",
    async () => {
      const port = 18924;
      await startServer(port);

      const first = await connectClient(port, { room: "duel", name: "Alpha" });
      const firstHello = await first.waitForType("hello");
      const second = await connectClient(port, { room: "duel", name: "Bravo" });
      const secondHello = await second.waitForType("hello");
      await second.waitForType("role", (message) => message.role === "player");
      await first.waitForType("matchStart", () => true, 6000);

      await closeClient(first);
      await expect(
        second.waitForType(
          "matchFinished",
          (message) => message.reason === "disconnect",
          15000,
        ),
      ).resolves.toMatchObject({
        reason: "disconnect",
        winnerId: secondHello.id,
        loserId: firstHello.id,
      });
    },
    22000,
  );

  it(
    "requires both players for rematch and ignores spectator rematchReady",
    async () => {
      const port = 18925;
      await startServer(port);

      const first = await connectClient(port, { room: "duel", name: "Alpha" });
      const firstHello = await first.waitForType("hello");
      const second = await connectClient(port, { room: "duel", name: "Bravo" });
      const secondHello = await second.waitForType("hello");
      const spectator = await connectClient(port, {
        room: "duel",
        name: "Charlie",
        maxPlayers: 8,
      });
      await spectator.waitForType("role", (message) => message.role === "spectator");
      await first.waitForType("matchStart", () => true, 6000);

      first.send({ type: "matchOver", room: "duel", result: "win" });
      await expect(
        first.waitForType(
          "matchFinished",
          (message) => message.winnerId === firstHello.id,
        ),
      ).resolves.toBeTruthy();

      first.resetMessages();
      second.resetMessages();
      spectator.resetMessages();

      first.send({ type: "rematchReady", room: "duel" });
      spectator.send({ type: "rematchReady", room: "duel" });

      const waitingState = await first.waitForType(
        "roomState",
        (message) => message.match?.rematchReady?.length === 1,
      );
      expect(waitingState.match.rematchReady).toEqual([firstHello.id]);
      expect(waitingState.match.rematchReady).not.toContain(secondHello.id);
      await expectNoMessage(
        first,
        (message) => message.type === "rematchStart",
        1000,
      );

      second.send({ type: "rematchReady", room: "duel" });
      await expect(first.waitForType("countdown")).resolves.toMatchObject({
        value: 3,
      });
      await expect(
        second.waitForType("rematchStart", () => true, 5000),
      ).resolves.toBeTruthy();
    },
    12000,
  );
});
