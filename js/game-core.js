import {
  ADVANCED_ATTACK,
  ADVANCED_SCORING,
  ATTACK_TABLE,
  COLS,
  PIECES,
  ROWS,
  SCORE_TABLE,
  SHAPES,
  SRS_KICKS,
} from "./config.js";

export function makeBoard(rows = ROWS, cols = COLS) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

export function createBag(random = Math.random, pieces = PIECES) {
  const bag = [...pieces];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export class SevenBag {
  constructor(random = Math.random) {
    this.random = random;
    this.bag = [];
  }

  next() {
    if (this.bag.length === 0) this.bag = createBag(this.random);
    return this.bag.shift();
  }
}

export function makePiece(kind, x = 3, y = 0) {
  return { kind, rotation: 0, x, y };
}

export function cells(piece) {
  return SHAPES[piece.kind][piece.rotation].map(([x, y]) => ({
    x: piece.x + x,
    y: piece.y + y,
  }));
}

export function isValid(board, piece) {
  for (const c of cells(piece)) {
    if (c.x < 0 || c.x >= COLS || c.y < 0 || c.y >= ROWS) return false;
    if (board[c.y][c.x]) return false;
  }
  return true;
}

export function rotateWithSrs(board, piece, direction = 1) {
  const from = piece.rotation;
  const to = (from + direction + 4) % 4;
  const key = `${from}>${to}`;
  const table = piece.kind === "I" ? SRS_KICKS.I : SRS_KICKS.normal;
  const kicks = piece.kind === "O" ? [[0, 0]] : table[key] || [[0, 0]];
  for (const [dx, dy] of kicks) {
    const candidate = {
      ...piece,
      rotation: to,
      x: piece.x + dx,
      y: piece.y + dy,
    };
    if (isValid(board, candidate)) return candidate;
  }
  return piece;
}

export function clearLines(board) {
  const clearedRows = [];
  const remaining = [];
  for (let y = 0; y < ROWS; y += 1) {
    if (board[y].every(Boolean)) clearedRows.push(y);
    else remaining.push([...board[y]]);
  }
  while (remaining.length < ROWS) remaining.unshift(Array(COLS).fill(null));
  return { board: remaining, count: clearedRows.length, rows: clearedRows };
}

export function lineScore(count, level = 1) {
  return SCORE_TABLE[Math.min(count, 4)] * level;
}

export function attackLinesForClear(count) {
  return ATTACK_TABLE[Math.min(count, 4)] || 0;
}

function occupiedOrBlocked(board, x, y) {
  return x < 0 || x >= COLS || y < 0 || y >= ROWS || Boolean(board[y][x]);
}

export function detectTSpinType(board, piece, lastRotation = null) {
  if (!lastRotation?.active || piece?.kind !== "T") return "";
  const center = { x: piece.x + 1, y: piece.y + 1 };
  const corners = {
    nw: occupiedOrBlocked(board, center.x - 1, center.y - 1),
    ne: occupiedOrBlocked(board, center.x + 1, center.y - 1),
    sw: occupiedOrBlocked(board, center.x - 1, center.y + 1),
    se: occupiedOrBlocked(board, center.x + 1, center.y + 1),
  };
  const occupied = Object.values(corners).filter(Boolean).length;
  if (occupied < 3) return "";

  const frontCornerKeys =
    {
      0: ["nw", "ne"],
      1: ["ne", "se"],
      2: ["sw", "se"],
      3: ["nw", "sw"],
    }[piece.rotation] || ["nw", "ne"];
  const frontFilled = frontCornerKeys.filter((key) => corners[key]).length;

  return frontFilled === 2 ? "full" : "mini";
}

export function isBoardEmpty(board) {
  return board.every((row) => row.every((cell) => !cell));
}

function lookupCombo(table, combo) {
  if (combo <= 0) return 0;
  if (combo < table.length) return table[combo];
  return table[table.length - 1] + (combo - (table.length - 1));
}

export function buildClearEvent({
  lines = 0,
  level = 1,
  combo = 0,
  perfectClear = false,
  backToBackActive = false,
  tSpinType = "",
  streakBonus = 0,
} = {}) {
  const safeLines = Math.max(0, Math.min(4, Math.floor(Number(lines) || 0)));
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const safeCombo = Math.max(0, Math.floor(Number(combo) || 0));
  const spinType = tSpinType === "mini" ? "mini" : tSpinType === "full" ? "full" : "";
  const isTSpin = spinType === "full";
  const isMini = spinType === "mini";
  const difficult = safeLines === 4 || (isTSpin && safeLines > 0);
  const backToBack = difficult && backToBackActive;

  const baseValue = isTSpin
    ? ADVANCED_SCORING.tSpin[safeLines] || 0
    : isMini
      ? ADVANCED_SCORING.tSpinMini[safeLines] || 0
      : ADVANCED_SCORING.line[safeLines] || 0;
  const baseScore = baseValue * safeLevel;
  const backToBackScore = backToBack ? Math.round(baseScore * (ADVANCED_SCORING.backToBackMultiplier - 1)) : 0;
  const perfectClearScore = perfectClear
    ? (ADVANCED_SCORING.perfectClear[safeLines] || ADVANCED_SCORING.perfectClear[4]) *
      safeLevel
    : 0;
  const comboScore = lookupCombo(ADVANCED_SCORING.combo, safeCombo);
  const score = baseScore + backToBackScore + perfectClearScore + comboScore + Math.max(0, Math.round(streakBonus));

  const baseAttack = isTSpin
    ? ADVANCED_ATTACK.tSpin[safeLines] || 0
    : isMini
      ? ADVANCED_ATTACK.tSpinMini[safeLines] || 0
      : ADVANCED_ATTACK.line[safeLines] || 0;
  const comboAttack = lookupCombo(ADVANCED_ATTACK.combo, safeCombo);
  const backToBackAttack = backToBack ? ADVANCED_ATTACK.backToBackBonus : 0;
  const perfectClearAttack = perfectClear
    ? ADVANCED_ATTACK.perfectClear[safeLines] || ADVANCED_ATTACK.perfectClear[4]
    : 0;

  return {
    lines: safeLines,
    level: safeLevel,
    combo: safeCombo,
    tSpinType: spinType,
    isTSpin,
    isMini,
    difficult,
    backToBack,
    backToBackEligible: difficult,
    perfectClear,
    baseScore,
    comboScore,
    backToBackScore,
    perfectClearScore,
    streakBonus: Math.max(0, Math.round(streakBonus)),
    score,
    baseAttack,
    comboAttack,
    backToBackAttack,
    perfectClearAttack,
    attackLines:
      baseAttack + comboAttack + backToBackAttack + perfectClearAttack,
  };
}

export function holdPiece(state) {
  if (state.holdUsed || !state.active) return state;
  const current = state.active.kind;
  if (state.hold) {
    return {
      ...state,
      active: makePiece(state.hold),
      hold: current,
      holdUsed: true,
    };
  }
  const [next, ...queue] = state.queue;
  return {
    ...state,
    active: makePiece(next),
    queue,
    hold: current,
    holdUsed: true,
  };
}

export function addGarbage(board, count, random = Math.random) {
  const next = board.map((row) => [...row]);
  for (let i = 0; i < count; i += 1) {
    const hole = Math.floor(random() * COLS);
    next.shift();
    next.push(
      Array.from({ length: COLS }, (_, x) => (x === hole ? null : "X")),
    );
  }
  return next;
}

export function isGameOver(board, piece) {
  return !isValid(board, piece);
}
