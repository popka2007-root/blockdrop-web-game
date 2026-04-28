import { sanitizeBoardPreview } from "./online.js";
import {
  loadMatchHistory,
  loadOnlineStats,
  saveMatchHistoryEntry,
  saveOnlineStats,
} from "./storage.js";

(() => {
  "use strict";

  if (typeof document === "undefined" || typeof globalThis.addEventListener !== "function") {
    return;
  }

  const HISTORY_KEY = "blockdrop-online-match-history-v1";
  const STATS_KEY = "blockdrop-online-stats-v1";
  const state = {
    room: "",
    role: "player",
    selfId: "",
    pingMs: 0,
    connected: false,
    roomState: null,
    rankedProfile: null,
    rankedResult: null,
    lastMatchKey: "",
    countdown: 0,
  };

  document.addEventListener("DOMContentLoaded", () => {
    ensurePvpPanel();
    renderPvpPanel();
  });

  globalThis.addEventListener("blockdrop:online-event", (event) => {
    handleOnlineEvent(event.detail || {});
  });

  function handleOnlineEvent(detail) {
    const type = detail.type;
    if (!type) return;

    if (type === "open") {
      state.connected = true;
      state.room = detail.room || state.room;
      state.role = detail.role || state.role;
    } else if (type === "disconnect") {
      state.connected = false;
      state.countdown = 0;
      state.roomState = null;
      state.role = detail.role || "player";
    } else if (type === "hello") {
      state.selfId = detail.id || state.selfId;
    } else if (type === "ping") {
      state.pingMs = Math.max(0, Number(detail.pingMs) || 0);
    } else if (type === "rankedProfile") {
      state.rankedProfile = detail.profile || state.rankedProfile;
    } else if (type === "state") {
      state.room = detail.room || state.room;
      state.roomState = normalizeRoomState(detail.roomState);
    } else if (type === "countdown") {
      state.countdown = Number(detail.value) || 0;
      showPvpToast(`PvP: ${state.countdown}`);
    } else if (type === "matchStart") {
      state.countdown = 0;
      showPvpToast("Матч начался");
    } else if (type === "attack") {
      showPvpToast(`Атака: +${Number(detail.lines) || 0}`);
    } else if (type === "matchFinished") {
      state.rankedResult = detail.ranked || null;
      handleMatchFinished(detail);
    } else if (type === "socketError") {
      showPvpToast("Ошибка соединения");
    } else if (type === "error" && detail.message) {
      showPvpToast(detail.message);
    }

    renderPvpPanel();
  }

  function normalizeRoomState(data) {
    return {
      room: data?.room || state.room,
      players: Array.isArray(data?.players) ? data.players : [],
      spectators: Array.isArray(data?.spectators) ? data.spectators : [],
      match: data?.match || {},
      tournament: data?.tournament || {},
    };
  }

  function ensurePvpPanel() {
    if (document.getElementById("pvpEnhancements")) return;
    const host =
      document.getElementById("sidePanel") ||
      document.getElementById("onlinePanel");
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

  function renderPvpPanel() {
    ensurePvpPanel();
    const panel = document.getElementById("pvpEnhancements");
    const roleBadge = document.getElementById("pvpRoleBadge");
    const status = document.getElementById("pvpConnectionStatus");
    const boards = document.getElementById("pvpBoards");
    const summary = document.getElementById("pvpSummary");
    const history = document.getElementById("pvpHistory");
    if (!panel || !roleBadge || !status || !boards || !summary || !history)
      return;

    const shouldShowPanel = Boolean(state.connected || state.roomState);
    panel.classList.toggle("active", shouldShowPanel);
    if (!shouldShowPanel) {
      boards.innerHTML = "";
      summary.innerHTML = "";
      history.innerHTML = "";
      return;
    }

    roleBadge.textContent = state.role === "spectator" ? "Spectator" : "Player";
    roleBadge.classList.toggle("spectator", state.role === "spectator");
    const pingLabel = state.pingMs
      ? `${state.pingMs} ms${state.pingMs > 160 ? " ⚠" : ""}`
      : "ping --";
    status.textContent = state.connected
      ? `Подключено · ${pingLabel}`
      : "Отключено";
    status.dataset.quality = state.pingMs > 160 ? "warn" : "good";

    const players = state.roomState?.players || [];
    const visiblePlayers =
      state.role === "spectator"
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

    const profile = state.rankedProfile;
    const rating =
      profile?.rating ||
      state.rankedResult?.winner?.ratingAfter ||
      state.rankedResult?.loser?.ratingAfter;
    const streak =
      profile?.streak ??
      state.rankedResult?.winner?.streak ??
      state.rankedResult?.loser?.streak;
    if (rating) {
      summary.insertAdjacentHTML(
        "afterbegin",
        `<div><b>${rating}</b><span>MMR</span></div>`,
      );
    }
    if (Number.isFinite(Number(streak))) {
      summary.insertAdjacentHTML(
        "beforeend",
        `<div><b>${formatStreak(streak)}</b><span>Streak</span></div>`,
      );
    }

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
    const normalizedRows = rows.length
      ? rows
      : Array.from({ length: 10 }, () => Array(10).fill(0));
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

  function handleMatchFinished(data) {
    const winnerId = data.winnerId || "";
    const loserId = data.loserId || "";
    const key = `${winnerId}:${loserId}:${data.reason}`;
    if (key === state.lastMatchKey) return;
    state.lastMatchKey = key;

    const result =
      winnerId === state.selfId
        ? "win"
        : loserId === state.selfId
          ? "loss"
          : "spectate";
    if (result === "win" || result === "loss") {
      const opponent = (state.roomState?.players || []).find(
        (player) => player.id !== state.selfId,
      );
      const rankedSide =
        data.ranked?.winner?.id === state.selfId
          ? data.ranked.winner
          : data.ranked?.loser?.id === state.selfId
            ? data.ranked.loser
            : null;
      if (rankedSide) {
        state.rankedProfile = {
          ...state.rankedProfile,
          rating: rankedSide.ratingAfter,
          streak: rankedSide.streak,
        };
      }
      saveOnlineStats(result, STATS_KEY);
      saveMatchHistoryEntry(
        {
          result,
          opponent: opponent?.name || "Player",
          durationSec: Math.max(
            0,
            Math.round(
              (Date.now() -
                Number(state.roomState?.match?.startedAt || Date.now())) /
                1000,
            ),
          ),
          lines: Number(getTextNumber("linesValue")) || 0,
          score: Number(getTextNumber("scoreValue")) || 0,
          ratingBefore: rankedSide?.ratingBefore || 0,
          ratingAfter: rankedSide?.ratingAfter || 0,
          ratingDelta: rankedSide?.ratingDelta || 0,
          mode:
            document.getElementById("startMode")?.selectedOptions?.[0]
              ?.textContent || "Classic",
          date: new Date().toISOString(),
        },
        HISTORY_KEY,
      );
      showPvpToast(result === "win" ? "Победа в PvP" : "Поражение в PvP");
    } else {
      showPvpToast("Матч завершён");
    }
  }

  function getTextNumber(id) {
    return String(document.getElementById(id)?.textContent || "0").replace(
      /\D/g,
      "",
    );
  }

  function formatStreak(value) {
    const streak = Number(value) || 0;
    if (streak > 0) return `W${streak}`;
    if (streak < 0) return `L${Math.abs(streak)}`;
    return "0";
  }

  function showPvpToast(message) {
    if (!String(message || "").trim()) return;
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showPvpToast.timer);
    showPvpToast.timer = setTimeout(
      () => toast.classList.remove("show"),
      1800,
    );
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
