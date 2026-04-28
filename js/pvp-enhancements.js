import {
  buildRematchReadyMessage,
  sanitizeBoardPreview,
} from "./online.js";
import {
  loadMatchHistory,
  loadOnlineStats,
  saveMatchHistoryEntry,
  saveOnlineStats,
} from "./storage.js";

(() => {
  "use strict";

  const HISTORY_KEY = "blockdrop-online-match-history-v1";
  const STATS_KEY = "blockdrop-online-stats-v1";
  const state = {
    socket: null,
    room: "",
    role: "player",
    selfId: "",
    pingMs: 0,
    connected: false,
    roomState: null,
    lastMatchKey: "",
    countdown: 0,
  };

  const originalWebSocket = globalThis.WebSocket;
  if (!originalWebSocket || originalWebSocket.__blockdropPvpEnhanced) return;

  function EnhancedWebSocket(...args) {
    const socket = new originalWebSocket(...args);
    state.socket = socket;
    state.connected = false;
    const originalSend = socket.send.bind(socket);
    socket.send = (payload) => {
      originalSend(enhanceOutgoingPayload(payload));
    };
    socket.addEventListener("open", () => {
      state.connected = true;
      renderPvpPanel();
    });
    socket.addEventListener("message", (event) => handleServerMessage(event.data));
    socket.addEventListener("close", () => {
      state.connected = false;
      renderPvpPanel("disconnected");
    });
    socket.addEventListener("error", () => renderPvpPanel("error"));
    return socket;
  }

  EnhancedWebSocket.prototype = originalWebSocket.prototype;
  Object.setPrototypeOf(EnhancedWebSocket, originalWebSocket);
  EnhancedWebSocket.__blockdropPvpEnhanced = true;
  globalThis.WebSocket = EnhancedWebSocket;

  document.addEventListener("DOMContentLoaded", () => {
    ensurePvpPanel();
    attachRematchHandler();
    renderPvpPanel();
  });

  function enhanceOutgoingPayload(payload) {
    if (typeof payload !== "string") return payload;
    try {
      const data = JSON.parse(payload);
      if (data?.type === "join") state.room = data.room || state.room;
      if (data?.type === "update" && !data.boardPreview) {
        data.boardPreview = captureBoardPreview();
        return JSON.stringify(data);
      }
    } catch {
      return payload;
    }
    return payload;
  }

  function handleServerMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data.type !== "string") return;

    if (data.type === "hello") state.selfId = data.id || state.selfId;
    if (data.type === "role") state.role = data.role || "player";
    if (data.type === "pong") state.pingMs = Math.max(0, Date.now() - Number(data.ts || 0));
    if (data.type === "state" || data.type === "roomState") {
      state.room = data.room || state.room;
      state.roomState = normalizeRoomState(data);
    }
    if (data.type === "countdown") {
      state.countdown = Number(data.value) || 0;
      showPvpToast(`PvP: ${state.countdown}`);
    }
    if (data.type === "matchStart" || data.type === "rematchStart") {
      state.countdown = 0;
      startLocalOnlineGame(data.seed);
      showPvpToast(data.type === "rematchStart" ? "Реванш начался" : "Матч начался");
    }
    if (data.type === "garbage" || data.type === "attack") {
      showPvpToast(`Атака: +${Number(data.lines) || 0}`);
    }
    if (data.type === "reconnecting") {
      showPvpToast(`${data.name || "Соперник"} переподключается...`);
    }
    if (data.type === "matchFinished") handleMatchFinished(data);
    if (data.type === "notice" && data.code === "spectator") showPvpToast("Вы зритель");
    renderPvpPanel();
  }

  function normalizeRoomState(data) {
    const players = Array.isArray(data.players)
      ? data.players
      : Object.values(data.players || {});
    const spectators = Array.isArray(data.spectators)
      ? data.spectators
      : Object.values(data.spectators || {});
    return {
      room: data.room || state.room,
      players,
      spectators,
      match: data.match || {},
      tournament: data.tournament || {},
    };
  }

  function ensurePvpPanel() {
    if (document.getElementById("pvpEnhancements")) return;
    const host = document.getElementById("sidePanel") || document.getElementById("onlinePanel");
    if (!host) return;
    const panel = document.createElement("div");
    panel.id = "pvpEnhancements";
    panel.className = "pvp-enhancements panel";
    panel.innerHTML = `
      <div class="pvp-head">
        <span>Online PvP</span>
        <b id="pvpRoleBadge">Player</b>
      </div>
      <div class="pvp-connection" id="pvpConnectionStatus">Не подключено</div>
      <div class="pvp-boards" id="pvpBoards"></div>
      <div class="pvp-summary" id="pvpSummary"></div>
      <div class="pvp-history" id="pvpHistory"></div>
    `;
    host.appendChild(panel);
  }

  function renderPvpPanel(forcedStatus = "") {
    ensurePvpPanel();
    const roleBadge = document.getElementById("pvpRoleBadge");
    const status = document.getElementById("pvpConnectionStatus");
    const boards = document.getElementById("pvpBoards");
    const summary = document.getElementById("pvpSummary");
    const history = document.getElementById("pvpHistory");
    if (!roleBadge || !status || !boards || !summary || !history) return;

    roleBadge.textContent = state.role === "spectator" ? "Spectator" : "Player";
    roleBadge.classList.toggle("spectator", state.role === "spectator");
    const pingLabel = state.pingMs
      ? `${state.pingMs} ms${state.pingMs > 160 ? " ⚠" : ""}`
      : "ping --";
    status.textContent = forcedStatus
      ? statusText(forcedStatus)
      : state.connected
        ? `Подключено · ${pingLabel}`
        : "Не подключено";
    status.dataset.quality = state.pingMs > 160 ? "warn" : "good";

    const room = state.roomState;
    const players = room?.players || [];
    const visiblePlayers = state.role === "spectator"
      ? players
      : players.filter((player) => player.id !== state.selfId);
    boards.innerHTML = visiblePlayers.length
      ? visiblePlayers
          .map((player) => renderMiniBoard(player, state.role === "spectator"))
          .join("")
      : `<div class="pvp-placeholder">Соперник ещё не подключён</div>`;

    const stats = loadOnlineStats(STATS_KEY);
    summary.innerHTML = `
      <div><b>${stats.wins}</b><span>Побед</span></div>
      <div><b>${stats.losses}</b><span>Поражений</span></div>
      <div><b>${stats.winrate}%</b><span>Winrate</span></div>
    `;

    const entries = loadMatchHistory(HISTORY_KEY).slice(0, 3);
    history.innerHTML = entries.length
      ? `<b>Последние игры</b>${entries
          .map(
            (entry) => `<div class="pvp-history-row ${entry.result}">
              <span>${entry.result === "win" ? "Победа" : "Поражение"}</span>
              <small>${escapeHtml(entry.opponent)} · ${entry.lines}L · ${entry.durationSec}s</small>
            </div>`,
          )
          .join("")}`
      : "";
  }

  function renderMiniBoard(player, showName) {
    const rows = sanitizeBoardPreview(player.boardPreview || []);
    const normalizedRows = rows.length ? rows : Array.from({ length: 10 }, () => Array(10).fill(0));
    return `<div class="pvp-board-card">
      ${showName ? `<b>${escapeHtml(player.name || "Player")}</b>` : `<b>Соперник</b>`}
      <div class="pvp-mini-board">
        ${normalizedRows
          .map((row) =>
            row
              .map((cell) => `<i class="${cell ? "filled" : ""}"></i>`)
              .join(""),
          )
          .join("")}
      </div>
      <small>${Number(player.score) || 0} · ${Number(player.lines) || 0}L</small>
    </div>`;
  }

  function captureBoardPreview() {
    const canvas = document.getElementById("board");
    if (!canvas) return [];
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    const cols = 10;
    const rows = 15;
    const cellW = canvas.width / cols;
    const cellH = canvas.height / 20;
    const preview = [];
    try {
      for (let y = 20 - rows; y < 20; y += 1) {
        const row = [];
        for (let x = 0; x < cols; x += 1) {
          const px = Math.floor(x * cellW + cellW / 2);
          const py = Math.floor(y * cellH + cellH / 2);
          const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
          row.push(a > 40 && r + g + b > 90 ? 1 : 0);
        }
        preview.push(row);
      }
    } catch {
      return [];
    }
    return preview;
  }

  function attachRematchHandler() {
    document.addEventListener("click", (event) => {
      if (event.target?.id !== "rematchButton") return;
      if (state.role === "spectator") {
        showPvpToast("Зритель не может запускать реванш");
        return;
      }
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(JSON.stringify(buildRematchReadyMessage(state.room)));
      showPvpToast("Ждём реванш от соперника");
    });
  }

  function startLocalOnlineGame(seed) {
    if (state.role === "spectator") return;
    const startButton = document.getElementById("connectOnlineButton");
    const onlineOverlay = document.getElementById("onlineOverlay");
    if (onlineOverlay && !onlineOverlay.hidden && startButton) startButton.click();
    globalThis.dispatchEvent(new CustomEvent("blockdrop:pvp-start", { detail: { seed } }));
  }

  function handleMatchFinished(data) {
    const winnerId = data.winnerId || "";
    const loserId = data.loserId || "";
    const key = `${winnerId}:${loserId}:${data.reason}`;
    if (key === state.lastMatchKey) return;
    state.lastMatchKey = key;
    const result = winnerId === state.selfId ? "win" : loserId === state.selfId ? "loss" : "spectate";
    if (result === "win" || result === "loss") {
      const opponent = (state.roomState?.players || []).find((player) => player.id !== state.selfId);
      saveOnlineStats(result, STATS_KEY);
      saveMatchHistoryEntry(
        {
          result,
          opponent: opponent?.name || "Player",
          durationSec: Math.max(
            0,
            Math.round((Date.now() - Number(state.roomState?.match?.startedAt || Date.now())) / 1000),
          ),
          lines: Number(getTextNumber("linesValue")) || 0,
          score: Number(getTextNumber("scoreValue")) || 0,
          mode: document.getElementById("startMode")?.selectedOptions?.[0]?.textContent || "Classic",
          date: new Date().toISOString(),
        },
        HISTORY_KEY,
      );
      showPvpToast(result === "win" ? "Победа в PvP" : "Поражение в PvP");
    } else {
      showPvpToast("Матч завершён");
    }
    renderPvpPanel();
  }

  function getTextNumber(id) {
    return String(document.getElementById(id)?.textContent || "0").replace(/\D/g, "");
  }

  function statusText(value) {
    return {
      disconnected: "Отключено",
      error: "Ошибка соединения",
      reconnecting: "Переподключение...",
    }[value] || value;
  }

  function showPvpToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showPvpToast.timer);
    showPvpToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }
})();
