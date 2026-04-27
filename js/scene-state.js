import { COLS, ROWS } from "./config.js";

export function currentHeight(board, rows = ROWS) {
  const first = board.findIndex((row) => row.some(Boolean));
  return first === -1 ? 0 : rows - first;
}

export function columnHeights(board, cols = COLS, rows = ROWS) {
  return Array.from({ length: cols }, (_, x) => {
    for (let y = 0; y < rows; y += 1) {
      if (board[y]?.[x]) return rows - y;
    }
    return 0;
  });
}

export function countHoles(board, cols = COLS, rows = ROWS) {
  let holes = 0;
  for (let x = 0; x < cols; x += 1) {
    let seenBlock = false;
    for (let y = 0; y < rows; y += 1) {
      if (board[y]?.[x]) seenBlock = true;
      else if (seenBlock) holes += 1;
    }
  }
  return holes;
}

export function surfaceBumpiness(board, cols = COLS, rows = ROWS) {
  const heights = columnHeights(board, cols, rows);
  return heights
    .slice(1)
    .reduce((sum, height, index) => sum + Math.abs(height - heights[index]), 0);
}

export function topDanger(board, depth = 4) {
  return board.slice(0, depth).some((row) => row.some(Boolean));
}
