(function initBlockDropEngine(root, factory) {
  const engine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  root.__blockdropEngine = engine;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function engineFactory() {
    "use strict";

    const ENGINE_VERSION = 2;
    const SNAPSHOT_VERSION = 1;
    const REPLAY_VERSION = 1;
    const TICK_RATE = 60;
    const COLS = 10;
    const ROWS = 20;
    const PIECES = Object.freeze(["I", "O", "T", "S", "Z", "J", "L"]);
    const SHAPES = Object.freeze({
      I: [
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [3, 1],
        ],
        [
          [2, 0],
          [2, 1],
          [2, 2],
          [2, 3],
        ],
        [
          [0, 2],
          [1, 2],
          [2, 2],
          [3, 2],
        ],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [1, 3],
        ],
      ],
      O: Array.from({ length: 4 }, () => [
        [1, 0],
        [2, 0],
        [1, 1],
        [2, 1],
      ]),
      T: [
        [
          [1, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [
          [1, 0],
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        [
          [1, 0],
          [0, 1],
          [1, 1],
          [1, 2],
        ],
      ],
      S: [
        [
          [1, 0],
          [2, 0],
          [0, 1],
          [1, 1],
        ],
        [
          [1, 0],
          [1, 1],
          [2, 1],
          [2, 2],
        ],
        [
          [1, 1],
          [2, 1],
          [0, 2],
          [1, 2],
        ],
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 2],
        ],
      ],
      Z: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [2, 1],
        ],
        [
          [2, 0],
          [1, 1],
          [2, 1],
          [1, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [1, 2],
          [2, 2],
        ],
        [
          [1, 0],
          [0, 1],
          [1, 1],
          [0, 2],
        ],
      ],
      J: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [
          [1, 0],
          [2, 0],
          [1, 1],
          [1, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [2, 2],
        ],
        [
          [1, 0],
          [1, 1],
          [0, 2],
          [1, 2],
        ],
      ],
      L: [
        [
          [2, 0],
          [0, 1],
          [1, 1],
          [2, 1],
        ],
        [
          [1, 0],
          [1, 1],
          [1, 2],
          [2, 2],
        ],
        [
          [0, 1],
          [1, 1],
          [2, 1],
          [0, 2],
        ],
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [1, 2],
        ],
      ],
    });
    const SRS_KICKS = Object.freeze({
      normal: {
        "0>1": [
          [0, 0],
          [-1, 0],
          [-1, 1],
          [0, -2],
          [-1, -2],
        ],
        "1>0": [
          [0, 0],
          [1, 0],
          [1, -1],
          [0, 2],
          [1, 2],
        ],
        "1>2": [
          [0, 0],
          [1, 0],
          [1, -1],
          [0, 2],
          [1, 2],
        ],
        "2>1": [
          [0, 0],
          [-1, 0],
          [-1, 1],
          [0, -2],
          [-1, -2],
        ],
        "2>3": [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, -2],
          [1, -2],
        ],
        "3>2": [
          [0, 0],
          [-1, 0],
          [-1, -1],
          [0, 2],
          [-1, 2],
        ],
        "3>0": [
          [0, 0],
          [-1, 0],
          [-1, -1],
          [0, 2],
          [-1, 2],
        ],
        "0>3": [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, -2],
          [1, -2],
        ],
      },
      I: {
        "0>1": [
          [0, 0],
          [-2, 0],
          [1, 0],
          [-2, -1],
          [1, 2],
        ],
        "1>0": [
          [0, 0],
          [2, 0],
          [-1, 0],
          [2, 1],
          [-1, -2],
        ],
        "1>2": [
          [0, 0],
          [-1, 0],
          [2, 0],
          [-1, 2],
          [2, -1],
        ],
        "2>1": [
          [0, 0],
          [1, 0],
          [-2, 0],
          [1, -2],
          [-2, 1],
        ],
        "2>3": [
          [0, 0],
          [2, 0],
          [-1, 0],
          [2, 1],
          [-1, -2],
        ],
        "3>2": [
          [0, 0],
          [-2, 0],
          [1, 0],
          [-2, -1],
          [1, 2],
        ],
        "3>0": [
          [0, 0],
          [1, 0],
          [-2, 0],
          [1, -2],
          [-2, 1],
        ],
        "0>3": [
          [0, 0],
          [-1, 0],
          [2, 0],
          [-1, 2],
          [2, -1],
        ],
      },
    });
    const SCORE = Object.freeze({
      line: [0, 100, 300, 500, 800],
      tSpin: [400, 800, 1200, 1600],
      tSpinMini: [100, 200],
      combo: [0, 0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
      perfectClear: [0, 800, 1200, 1800, 2000],
    });
    const ATTACK = Object.freeze({
      line: [0, 0, 1, 2, 4],
      tSpin: [0, 2, 4, 6],
      tSpinMini: [0, 1],
      combo: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
      perfectClear: [0, 4, 6, 8, 10],
    });
    const ACTIONS = Object.freeze([
      "left",
      "right",
      "rotateCW",
      "rotateCCW",
      "softDrop",
      "hardDrop",
      "hold",
    ]);
    const MODE_RULES = Object.freeze({
      classic: Object.freeze({
        startLevel: 1,
        levelUpLines: 10,
        gravityEnabled: true,
        gravityRate: 1000,
        targetLines: 0,
        timeLimitTicks: 0,
        initialGarbage: 0,
      }),
      sprint: Object.freeze({
        startLevel: 1,
        levelUpLines: 10,
        gravityEnabled: true,
        gravityRate: 1000,
        targetLines: 40,
        timeLimitTicks: 0,
        initialGarbage: 0,
      }),
      hardcore: Object.freeze({
        startLevel: 6,
        levelUpLines: 4,
        gravityEnabled: true,
        gravityRate: 1300,
        targetLines: 0,
        timeLimitTicks: 0,
        initialGarbage: 2,
      }),
      timeAttack: Object.freeze({
        startLevel: 2,
        levelUpLines: 8,
        gravityEnabled: true,
        gravityRate: 1000,
        targetLines: 0,
        timeLimitTicks: 120 * TICK_RATE,
        initialGarbage: 0,
      }),
      relax: Object.freeze({
        startLevel: 1,
        levelUpLines: 10,
        gravityEnabled: false,
        gravityRate: 1000,
        targetLines: 0,
        timeLimitTicks: 0,
        initialGarbage: 0,
      }),
      chaos: Object.freeze({
        startLevel: 1,
        levelUpLines: 5,
        gravityEnabled: true,
        gravityRate: 1000,
        targetLines: 0,
        timeLimitTicks: 0,
        initialGarbage: 4,
      }),
    });

    function makeBoard() {
      return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    }

    function hashSeed(value) {
      const text = String(value || "blockdrop");
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0 || 0x9e3779b9;
    }

    function nextRandom(state) {
      let value = state.randomState >>> 0;
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      state.randomState = value >>> 0 || 0x9e3779b9;
      return state.randomState / 0x100000000;
    }

    function fillBag(state) {
      const bag = [...PIECES];
      for (let index = bag.length - 1; index > 0; index -= 1) {
        const target = Math.floor(nextRandom(state) * (index + 1));
        [bag[index], bag[target]] = [bag[target], bag[index]];
      }
      state.bag.push(...bag);
    }

    function takeKind(state) {
      if (!state.bag.length) fillBag(state);
      return state.bag.shift();
    }

    function fillQueue(state, size = 5) {
      while (state.queue.length < size) state.queue.push(takeKind(state));
    }

    function makePiece(kind) {
      return { kind, rotation: 0, x: 3, y: 0 };
    }

    function pieceCells(piece) {
      return SHAPES[piece.kind][piece.rotation].map(([x, y]) => ({
        x: piece.x + x,
        y: piece.y + y,
      }));
    }

    function isValid(board, piece) {
      return pieceCells(piece).every(
        ({ x, y }) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !board[y][x],
      );
    }

    function rotatePiece(board, piece, direction) {
      const from = piece.rotation;
      const to = (from + (direction < 0 ? -1 : 1) + 4) % 4;
      const table = piece.kind === "I" ? SRS_KICKS.I : SRS_KICKS.normal;
      const kicks =
        piece.kind === "O" ? [[0, 0]] : table[`${from}>${to}`] || [[0, 0]];
      for (const [dx, dy] of kicks) {
        const candidate = {
          ...piece,
          rotation: to,
          x: piece.x + dx,
          y: piece.y + dy,
        };
        if (isValid(board, candidate))
          return { piece: candidate, rotated: true };
      }
      return { piece, rotated: false };
    }

    function occupied(board, x, y) {
      return x < 0 || x >= COLS || y < 0 || y >= ROWS || Boolean(board[y][x]);
    }

    function detectTSpin(board, piece, lastAction) {
      if (!lastAction?.startsWith("rotate") || piece.kind !== "T") return "";
      const centerX = piece.x + 1;
      const centerY = piece.y + 1;
      const corners = [
        occupied(board, centerX - 1, centerY - 1),
        occupied(board, centerX + 1, centerY - 1),
        occupied(board, centerX - 1, centerY + 1),
        occupied(board, centerX + 1, centerY + 1),
      ];
      if (corners.filter(Boolean).length < 3) return "";
      const fronts = [
        [0, 1],
        [1, 3],
        [2, 3],
        [0, 2],
      ][piece.rotation];
      return fronts.every((index) => corners[index]) ? "full" : "mini";
    }

    function clearLines(board) {
      const rows = [];
      const remaining = [];
      for (let y = 0; y < ROWS; y += 1) {
        if (board[y].every(Boolean)) rows.push(y);
        else remaining.push(board[y]);
      }
      const count = rows.length;
      while (remaining.length < ROWS) remaining.unshift(Array(COLS).fill(null));
      return { board: remaining, count, rows };
    }

    function tableValue(table, index) {
      if (index <= 0) return table[0] || 0;
      if (index < table.length) return table[index] || 0;
      return table.at(-1) + index - (table.length - 1);
    }

    function clearResult({
      lines,
      level,
      combo,
      tSpinType,
      perfectClear,
      backToBack,
    }) {
      const baseScore =
        tSpinType === "full"
          ? SCORE.tSpin[lines] || 0
          : tSpinType === "mini"
            ? SCORE.tSpinMini[lines] || 0
            : SCORE.line[lines] || 0;
      const baseAttack =
        tSpinType === "full"
          ? ATTACK.tSpin[lines] || 0
          : tSpinType === "mini"
            ? ATTACK.tSpinMini[lines] || 0
            : ATTACK.line[lines] || 0;
      const difficult = lines === 4 || (tSpinType === "full" && lines > 0);
      return {
        difficult,
        score:
          Math.round(baseScore * level * (difficult && backToBack ? 1.5 : 1)) +
          tableValue(SCORE.combo, combo) +
          (perfectClear
            ? (SCORE.perfectClear[lines] || SCORE.perfectClear[4]) * level
            : 0),
        attack:
          baseAttack +
          tableValue(ATTACK.combo, combo) +
          (difficult && backToBack ? 1 : 0) +
          (perfectClear
            ? ATTACK.perfectClear[lines] || ATTACK.perfectClear[4]
            : 0),
      };
    }

    function createState(options = {}) {
      const seed = String(options.seed || "blockdrop").slice(0, 128);
      const mode = String(options.mode || "classic").slice(0, 24);
      const rules = MODE_RULES[mode] || MODE_RULES.classic;
      const state = {
        engineVersion: ENGINE_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        seed,
        mode,
        tick: 0,
        randomState: hashSeed(seed),
        board: makeBoard(),
        active: null,
        queue: [],
        bag: [],
        hold: null,
        holdUsed: false,
        score: 0,
        lines: 0,
        level: Math.max(
          1,
          Math.min(
            99,
            Math.floor(Number(options.startLevel) || rules.startLevel),
          ),
        ),
        combo: 0,
        backToBack: false,
        pieces: 0,
        pendingGarbage: 0,
        sentGarbage: 0,
        receivedGarbage: 0,
        gravityCounter: 0,
        lockCounter: 0,
        softDrop: false,
        lastAction: "",
        lastAckSeq: 0,
        gameOver: false,
        won: false,
        startLevel: Math.max(
          1,
          Math.min(
            99,
            Math.floor(Number(options.startLevel) || rules.startLevel),
          ),
        ),
        levelUpLines: Math.max(
          1,
          Math.floor(Number(options.levelUpLines) || rules.levelUpLines),
        ),
        gravityEnabled:
          options.gravityEnabled == null
            ? rules.gravityEnabled
            : Boolean(options.gravityEnabled),
        gravityRate: Math.max(
          100,
          Math.min(
            4000,
            Math.floor(Number(options.gravityRate) || rules.gravityRate),
          ),
        ),
        targetLines: Math.max(
          0,
          Math.floor(Number(options.targetLines) || rules.targetLines),
        ),
        timeLimitTicks: Math.max(
          0,
          Math.floor(Number(options.timeLimitTicks) || rules.timeLimitTicks),
        ),
      };
      fillQueue(state);
      spawn(state);
      const initialGarbage = Math.max(
        0,
        Math.min(
          12,
          options.initialGarbage == null
            ? rules.initialGarbage
            : Number(options.initialGarbage) || 0,
        ),
      );
      if (initialGarbage) addGarbage(state, initialGarbage);
      return state;
    }

    function spawn(state, forcedKind = "") {
      fillQueue(state);
      const kind = forcedKind || state.queue.shift();
      fillQueue(state);
      state.active = makePiece(kind);
      state.holdUsed = false;
      state.gravityCounter = 0;
      state.lockCounter = 0;
      state.lastAction = "";
      if (!isValid(state.board, state.active)) state.gameOver = true;
    }

    function move(state, dx, dy) {
      const candidate = {
        ...state.active,
        x: state.active.x + dx,
        y: state.active.y + dy,
      };
      if (!isValid(state.board, candidate)) return false;
      state.active = candidate;
      state.lockCounter = 0;
      return true;
    }

    function addGarbage(state, count) {
      const safeCount = Math.max(
        0,
        Math.min(20, Math.floor(Number(count) || 0)),
      );
      for (let index = 0; index < safeCount; index += 1) {
        const hole = Math.floor(nextRandom(state) * COLS);
        state.board.shift();
        state.board.push(
          Array.from({ length: COLS }, (_, x) => (x === hole ? null : "X")),
        );
        state.receivedGarbage += 1;
      }
      if (state.active && !isValid(state.board, state.active))
        state.gameOver = true;
    }

    function queueGarbage(state, count) {
      state.pendingGarbage = Math.max(
        0,
        Math.min(40, state.pendingGarbage + Math.floor(Number(count) || 0)),
      );
    }

    function lockPiece(state, events) {
      if (!state.active || state.gameOver) return;
      const piece = { ...state.active };
      const tSpinType = detectTSpin(state.board, piece, state.lastAction);
      for (const cell of pieceCells(piece))
        state.board[cell.y][cell.x] = piece.kind;
      state.active = null;
      const cleared = clearLines(state.board);
      state.board = cleared.board;
      state.combo = cleared.count ? state.combo + 1 : 0;
      const wasBackToBack = state.backToBack;
      const perfectClear = state.board.every((row) =>
        row.every((cell) => !cell),
      );
      const result = clearResult({
        lines: cleared.count,
        level: state.level,
        combo: state.combo,
        tSpinType,
        perfectClear,
        backToBack: wasBackToBack,
      });
      state.score += result.score;
      state.lines += cleared.count;
      state.level = Math.min(
        99,
        Math.floor(state.lines / state.levelUpLines) + state.startLevel,
      );
      state.pieces += 1;
      state.backToBack = result.difficult
        ? true
        : cleared.count
          ? false
          : state.backToBack;
      const cancelled = Math.min(result.attack, state.pendingGarbage);
      state.pendingGarbage -= cancelled;
      const outgoing = result.attack - cancelled;
      state.sentGarbage += outgoing;
      events.push({
        type: "lock",
        tick: state.tick,
        kind: piece.kind,
        rows: cleared.rows,
        lines: cleared.count,
        score: result.score,
        attack: outgoing,
        cancelled,
        combo: state.combo,
        tSpinType,
        perfectClear,
        difficult: result.difficult,
        backToBack: result.difficult && wasBackToBack,
      });
      if (state.targetLines && state.lines >= state.targetLines) {
        state.won = true;
        state.gameOver = true;
        events.push({ type: "gameResult", tick: state.tick, won: true });
        return;
      }
      if (state.pendingGarbage && !cleared.count) {
        const incoming = state.pendingGarbage;
        state.pendingGarbage = 0;
        addGarbage(state, incoming);
        events.push({
          type: "garbageApplied",
          tick: state.tick,
          lines: incoming,
        });
      }
      if (state.mode === "chaos" && state.pieces % 14 === 0) {
        addGarbage(state, 1);
        events.push({ type: "chaosGarbage", tick: state.tick, lines: 1 });
      }
      spawn(state);
    }

    function hardDrop(state, events) {
      let distance = 0;
      while (move(state, 0, 1)) distance += 1;
      state.score += distance * 2;
      lockPiece(state, events);
    }

    function applyInput(state, input, events) {
      if (
        state.gameOver ||
        !state.active ||
        !input ||
        !ACTIONS.includes(input.action)
      )
        return false;
      const seq = Math.max(0, Math.floor(Number(input.seq) || 0));
      if (seq && seq <= state.lastAckSeq) return false;
      if (seq) state.lastAckSeq = seq;
      let accepted = false;
      if (input.action === "left")
        accepted = input.pressed !== false && move(state, -1, 0);
      if (input.action === "right")
        accepted = input.pressed !== false && move(state, 1, 0);
      if (input.action === "rotateCW" || input.action === "rotateCCW") {
        if (input.pressed !== false) {
          const rotated = rotatePiece(
            state.board,
            state.active,
            input.action === "rotateCW" ? 1 : -1,
          );
          state.active = rotated.piece;
          accepted = rotated.rotated;
          if (accepted) state.lockCounter = 0;
        }
      }
      if (input.action === "softDrop") {
        state.softDrop = input.pressed !== false;
        accepted = true;
      }
      if (input.action === "hardDrop" && input.pressed !== false) {
        hardDrop(state, events);
        accepted = true;
      }
      if (
        input.action === "hold" &&
        input.pressed !== false &&
        !state.holdUsed
      ) {
        const current = state.active.kind;
        if (state.hold) {
          const held = state.hold;
          state.hold = current;
          spawn(state, held);
        } else {
          state.hold = current;
          spawn(state);
        }
        state.holdUsed = true;
        accepted = true;
      }
      if (accepted && input.action !== "softDrop")
        state.lastAction = input.action;
      return accepted;
    }

    function gravityTicks(state) {
      return Math.max(4, 46 - (state.level - 1) * 3);
    }

    function step(state, inputs = []) {
      const events = [];
      if (state.gameOver) return { state, events };
      const ordered = [...inputs].sort(
        (left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0),
      );
      for (const input of ordered) applyInput(state, input, events);
      if (state.gameOver) return { state, events };
      state.tick += 1;
      const gravityThreshold = gravityTicks(state) * 1000;
      if (state.gravityEnabled) {
        state.gravityCounter += state.softDrop
          ? gravityThreshold
          : state.gravityRate;
      }
      if (state.gravityEnabled && state.gravityCounter >= gravityThreshold) {
        state.gravityCounter = 0;
        if (move(state, 0, 1) && state.softDrop) state.score += 1;
      }
      const grounded = !isValid(state.board, {
        ...state.active,
        y: state.active.y + 1,
      });
      if (grounded) state.lockCounter += 1;
      else state.lockCounter = 0;
      if (state.lockCounter >= 29) lockPiece(state, events);
      if (
        !state.gameOver &&
        state.timeLimitTicks &&
        state.tick >= state.timeLimitTicks
      ) {
        state.won = true;
        state.gameOver = true;
        events.push({ type: "gameResult", tick: state.tick, won: true });
      } else if (
        state.gameOver &&
        !events.some((event) => event.type === "gameResult")
      ) {
        events.push({
          type: "gameResult",
          tick: state.tick,
          won: Boolean(state.won),
        });
      }
      return { state, events };
    }

    function snapshot(state) {
      return {
        engineVersion: ENGINE_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        seed: state.seed,
        mode: state.mode,
        tick: state.tick,
        randomState: state.randomState,
        board: state.board.map((row) => [...row]),
        active: state.active ? { ...state.active } : null,
        queue: [...state.queue],
        bag: [...state.bag],
        hold: state.hold,
        holdUsed: state.holdUsed,
        score: state.score,
        lines: state.lines,
        level: state.level,
        combo: state.combo,
        backToBack: state.backToBack,
        pieces: state.pieces,
        pendingGarbage: state.pendingGarbage,
        sentGarbage: state.sentGarbage,
        receivedGarbage: state.receivedGarbage,
        gravityCounter: state.gravityCounter,
        lockCounter: state.lockCounter,
        softDrop: state.softDrop,
        lastAction: state.lastAction,
        lastAckSeq: state.lastAckSeq,
        gameOver: state.gameOver,
        won: state.won,
        startLevel: state.startLevel,
        levelUpLines: state.levelUpLines,
        gravityEnabled: state.gravityEnabled,
        gravityRate: state.gravityRate,
        targetLines: state.targetLines,
        timeLimitTicks: state.timeLimitTicks,
      };
    }

    function restoreSnapshot(value) {
      if (
        !value ||
        Number(value.engineVersion) !== ENGINE_VERSION ||
        Number(value.snapshotVersion) !== SNAPSHOT_VERSION ||
        !Array.isArray(value.board) ||
        value.board.length !== ROWS ||
        value.board.some((row) => !Array.isArray(row) || row.length !== COLS)
      ) {
        throw new Error("Unsupported or invalid BlockDrop snapshot");
      }
      const integer = (input, fallback, min, max) => {
        const number = Number(input);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, Math.floor(number)));
      };
      const kind = (input, allowGarbage = false) => {
        const candidate = typeof input === "object" ? input?.kind : input;
        if (PIECES.includes(candidate) || (allowGarbage && candidate === "X")) {
          return candidate;
        }
        throw new Error("Unsupported or invalid BlockDrop snapshot");
      };
      const board = value.board.map((row) =>
        row.map((cell) =>
          cell == null || cell === 0 ? null : kind(cell, true),
        ),
      );
      let active = null;
      if (value.active != null) {
        active = {
          kind: kind(value.active.kind),
          rotation: integer(value.active.rotation, 0, 0, 3),
          x: integer(value.active.x, 3, -4, COLS + 3),
          y: integer(value.active.y, 0, -4, ROWS + 3),
        };
      }
      const queue = Array.isArray(value.queue)
        ? value.queue.slice(0, 14).map((entry) => kind(entry))
        : [];
      const bag = Array.isArray(value.bag)
        ? value.bag.slice(0, 14).map((entry) => kind(entry))
        : [];
      const mode = Object.hasOwn(MODE_RULES, value.mode)
        ? value.mode
        : "classic";
      const restored = {
        engineVersion: ENGINE_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        seed: String(value.seed || "blockdrop").slice(0, 128),
        mode,
        tick: integer(value.tick, 0, 0, TICK_RATE * 60 * 60 * 24),
        randomState: integer(value.randomState, 1, 0, 0xffffffff) >>> 0,
        board,
        active,
        queue,
        bag,
        hold: value.hold == null ? null : kind(value.hold),
        holdUsed: Boolean(value.holdUsed),
        score: integer(value.score, 0, 0, 1_000_000_000),
        lines: integer(value.lines, 0, 0, 1_000_000),
        level: integer(value.level, 1, 1, 99),
        combo: integer(value.combo, 0, 0, 1_000_000),
        backToBack: Boolean(value.backToBack),
        pieces: integer(value.pieces, 0, 0, 1_000_000),
        pendingGarbage: integer(value.pendingGarbage, 0, 0, 40),
        sentGarbage: integer(value.sentGarbage, 0, 0, 1_000_000),
        receivedGarbage: integer(value.receivedGarbage, 0, 0, 1_000_000),
        gravityCounter: integer(value.gravityCounter, 0, 0, 1_000_000),
        lockCounter: integer(value.lockCounter, 0, 0, 10_000),
        softDrop: Boolean(value.softDrop),
        lastAction: ACTIONS.includes(value.lastAction) ? value.lastAction : "",
        lastAckSeq: integer(value.lastAckSeq, 0, 0, 1_000_000_000),
        gameOver: Boolean(value.gameOver),
        won: Boolean(value.won),
        startLevel: integer(value.startLevel, 1, 1, 99),
        levelUpLines: integer(value.levelUpLines, 10, 1, 1000),
        gravityEnabled: value.gravityEnabled !== false,
        gravityRate: integer(value.gravityRate, 1000, 100, 4000),
        targetLines: integer(value.targetLines, 0, 0, 10000),
        timeLimitTicks: integer(
          value.timeLimitTicks,
          0,
          0,
          TICK_RATE * 60 * 60 * 24,
        ),
      };
      if (!restored.gameOver && !restored.active) {
        throw new Error("Unsupported or invalid BlockDrop snapshot");
      }
      return snapshot(restored);
    }

    function checksum(value) {
      const text = JSON.stringify(value);
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function normalizeReplayInputs(inputs) {
      if (!Array.isArray(inputs) || inputs.length > 100000) {
        throw new Error("Invalid replay input stream");
      }
      return inputs
        .map((input) => ({
          tick: Math.max(0, Math.floor(Number(input?.tick) || 0)),
          seq: Math.max(0, Math.floor(Number(input?.seq) || 0)),
          action: String(input?.action || ""),
          pressed: input?.pressed !== false,
        }))
        .filter((input) => ACTIONS.includes(input.action))
        .sort((left, right) => left.tick - right.tick || left.seq - right.seq);
    }

    function replayInputsByTick(inputs) {
      const result = new Map();
      for (const input of inputs) {
        const list = result.get(input.tick) || [];
        list.push(input);
        result.set(input.tick, list);
      }
      return result;
    }

    function normalizeReplayEvents(events = []) {
      if (!Array.isArray(events) || events.length > 10000) {
        throw new Error("Invalid replay event stream");
      }
      return events
        .map((event) => ({
          tick: Math.max(0, Math.floor(Number(event?.tick) || 0)),
          type: String(event?.type || ""),
          lines: Math.max(
            0,
            Math.min(40, Math.floor(Number(event?.lines) || 0)),
          ),
        }))
        .filter((event) => event.type === "garbage" && event.lines > 0)
        .sort((left, right) => left.tick - right.tick);
    }

    function replayEventsByTick(events) {
      const result = new Map();
      for (const event of events) {
        const list = result.get(event.tick) || [];
        list.push(event);
        result.set(event.tick, list);
      }
      return result;
    }

    function advanceReplayState(
      state,
      inputsByTick,
      targetTick,
      eventsByTick = new Map(),
      includeCurrentTick = true,
    ) {
      const safeTarget = Math.max(
        state.tick,
        Math.floor(Number(targetTick) || 0),
      );
      let firstTick = true;
      while (!state.gameOver && state.tick <= safeTarget) {
        if (includeCurrentTick || !firstTick) {
          for (const event of eventsByTick.get(state.tick) || []) {
            if (event.type === "garbage") queueGarbage(state, event.lines);
          }
          const tickInputs = inputsByTick.get(state.tick) || [];
          if (tickInputs.length) {
            const events = [];
            for (const input of tickInputs) applyInput(state, input, events);
          }
        }
        if (state.gameOver || state.tick >= safeTarget) break;
        step(state);
        firstTick = false;
      }
      return state;
    }

    function buildReplayCheckpoints(replay, intervalTicks = TICK_RATE * 10) {
      const finalTick = Math.max(0, Math.floor(Number(replay.finalTick) || 0));
      const interval = Math.max(1, Math.floor(Number(intervalTicks) || 0));
      const inputs = normalizeReplayInputs(replay.inputs);
      const inputsByTick = replayInputsByTick(inputs);
      const eventsByTick = replayEventsByTick(
        normalizeReplayEvents(replay.externalEvents),
      );
      const state = createState({ seed: replay.seed, mode: replay.mode });
      const checkpoints = [
        {
          tick: 0,
          processedCurrentTick: false,
          snapshot: snapshot(state),
          checksum: checksum(snapshot(state)),
        },
      ];
      let nextTick = interval;
      let includeCurrentTick = true;
      while (!state.gameOver && nextTick < finalTick) {
        advanceReplayState(
          state,
          inputsByTick,
          nextTick,
          eventsByTick,
          includeCurrentTick,
        );
        includeCurrentTick = false;
        const saved = snapshot(state);
        checkpoints.push({
          tick: state.tick,
          processedCurrentTick: true,
          snapshot: saved,
          checksum: checksum(saved),
        });
        nextTick += interval;
      }
      return checkpoints;
    }

    function createReplay({
      seed,
      mode = "classic",
      inputs = [],
      finalState,
      checkpointIntervalTicks = TICK_RATE * 10,
      metadata = {},
      externalEvents = [],
    }) {
      const replay = {
        replayVersion: REPLAY_VERSION,
        engineVersion: ENGINE_VERSION,
        seed: String(seed || "blockdrop"),
        mode: String(mode || "classic"),
        createdAt: new Date().toISOString(),
        inputs: normalizeReplayInputs(inputs),
        externalEvents: normalizeReplayEvents(externalEvents),
        finalTick: Math.max(0, Math.floor(Number(finalState?.tick) || 0)),
        finalChecksum: finalState ? checksum(snapshot(finalState)) : "",
        metadata:
          metadata && typeof metadata === "object"
            ? JSON.parse(JSON.stringify(metadata))
            : {},
      };
      replay.checkpoints = buildReplayCheckpoints(
        replay,
        checkpointIntervalTicks,
      );
      return replay;
    }

    function simulateReplay(replay, maxTicks = 60 * 60 * 60) {
      if (
        Number(replay?.replayVersion) !== REPLAY_VERSION ||
        Number(replay?.engineVersion) !== ENGINE_VERSION ||
        !Array.isArray(replay.inputs)
      ) {
        return { ok: false, code: "incompatibleReplay" };
      }
      let inputs;
      let externalEvents;
      try {
        inputs = normalizeReplayInputs(replay.inputs);
        externalEvents = normalizeReplayEvents(replay.externalEvents);
      } catch {
        return { ok: false, code: "corruptInputStream" };
      }
      if (
        inputs.length !== replay.inputs.length ||
        externalEvents.length !== (replay.externalEvents || []).length
      ) {
        return { ok: false, code: "corruptInputStream" };
      }
      const state = createState({ seed: replay.seed, mode: replay.mode });
      const inputsByTick = replayInputsByTick(inputs);
      const eventsByTick = replayEventsByTick(externalEvents);
      const finalTick = Math.min(
        maxTicks,
        Math.max(0, Math.floor(Number(replay.finalTick) || 0)),
      );
      advanceReplayState(state, inputsByTick, finalTick, eventsByTick);
      const finalChecksum = checksum(snapshot(state));
      return {
        ok: !replay.finalChecksum || replay.finalChecksum === finalChecksum,
        code:
          replay.finalChecksum && replay.finalChecksum !== finalChecksum
            ? "checksumMismatch"
            : "ok",
        state,
        finalChecksum,
      };
    }

    return Object.freeze({
      ACTIONS,
      ATTACK,
      COLS,
      ENGINE_VERSION,
      MODE_RULES,
      PIECES,
      REPLAY_VERSION,
      ROWS,
      SCORE,
      SHAPES,
      SNAPSHOT_VERSION,
      SRS_KICKS,
      TICK_RATE,
      addGarbage,
      advanceReplayState,
      applyInput,
      buildReplayCheckpoints,
      checksum,
      clearLines,
      createReplay,
      createState,
      hashSeed,
      isValid,
      makeBoard,
      nextRandom,
      pieceCells,
      queueGarbage,
      restoreSnapshot,
      rotatePiece,
      simulateReplay,
      snapshot,
      step,
    });
  },
);
