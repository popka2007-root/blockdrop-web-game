import {
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
