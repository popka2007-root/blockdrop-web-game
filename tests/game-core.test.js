import { describe, expect, it } from "vitest";
import {
  buildClearEvent,
  detectTSpinType,
  SevenBag,
  addGarbage,
  attackLinesForClear,
  cells,
  clearLines,
  holdPiece,
  isGameOver,
  isBoardEmpty,
  isValid,
  lineScore,
  makeBoard,
  makePiece,
  rotateWithSrs,
} from "../js/game-core.js";
import { COLS, PIECES, ROWS } from "../js/config.js";

describe("piece generation", () => {
  it("creates pieces with four occupied cells", () => {
    for (const kind of PIECES) {
      expect(cells(makePiece(kind))).toHaveLength(4);
    }
  });

  it("uses a 7-bag randomizer without duplicates inside a bag", () => {
    const bag = new SevenBag(() => 0.5);
    const firstBag = Array.from({ length: 7 }, () => bag.next());
    expect(new Set(firstBag)).toEqual(new Set(PIECES));
  });
});

describe("board physics", () => {
  it("detects collisions against walls and existing blocks", () => {
    const board = makeBoard();
    expect(isValid(board, makePiece("T"))).toBe(true);
    expect(isValid(board, { ...makePiece("T"), x: -2 })).toBe(false);
    board[1][4] = "X";
    expect(isValid(board, makePiece("T"))).toBe(false);
  });

  it("rotates with SRS wall kicks", () => {
    const board = makeBoard();
    const piece = { ...makePiece("I"), x: -1, rotation: 0 };
    const rotated = rotateWithSrs(board, piece);
    expect(rotated.rotation).toBe(1);
    expect(isValid(board, rotated)).toBe(true);
  });

  it("clears filled lines", () => {
    const board = makeBoard();
    board[ROWS - 1] = Array(COLS).fill("I");
    const result = clearLines(board);
    expect(result.count).toBe(1);
    expect(result.board[ROWS - 1].every(Boolean)).toBe(false);
  });

  it("detects game over on invalid spawn", () => {
    const board = makeBoard();
    board[1][4] = "X";
    expect(isGameOver(board, makePiece("T"))).toBe(true);
  });
});

describe("scoring and side systems", () => {
  it("scores line clears by level", () => {
    expect(lineScore(4, 3)).toBe(2400);
  });

  it("handles hold with an existing queue", () => {
    const state = {
      active: makePiece("T"),
      hold: null,
      holdUsed: false,
      queue: ["I", "O"],
    };
    const next = holdPiece(state);
    expect(next.hold).toBe("T");
    expect(next.active.kind).toBe("I");
    expect(next.holdUsed).toBe(true);
  });

  it("maps clears to garbage attacks", () => {
    expect(attackLinesForClear(1)).toBe(0);
    expect(attackLinesForClear(2)).toBe(1);
    expect(attackLinesForClear(4)).toBe(4);
  });

  it("adds garbage with a safe hole", () => {
    const board = makeBoard();
    const next = addGarbage(board, 1, () => 0);
    expect(next[ROWS - 1][0]).toBe(null);
    expect(next[ROWS - 1].filter(Boolean)).toHaveLength(COLS - 1);
  });

  it("detects full and mini T-Spins from the locked board state", () => {
    const fullBoard = makeBoard();
    fullBoard[4][4] = "X";
    fullBoard[4][6] = "X";
    fullBoard[6][6] = "X";
    const piece = { ...makePiece("T"), x: 4, y: 4, rotation: 1 };

    expect(detectTSpinType(fullBoard, piece, { active: true })).toBe("full");

    const miniBoard = makeBoard();
    miniBoard[4][4] = "X";
    miniBoard[4][6] = "X";
    miniBoard[6][4] = "X";

    expect(detectTSpinType(miniBoard, piece, { active: true })).toBe("mini");
    expect(detectTSpinType(makeBoard(), piece, { active: false })).toBe("");
  });

  it("builds advanced clear events for score and PvP attack math", () => {
    expect(
      buildClearEvent({
        lines: 4,
        level: 2,
        combo: 3,
        perfectClear: true,
        backToBackActive: true,
      }),
    ).toMatchObject({
      difficult: true,
      backToBack: true,
      score: 6500,
      attackLines: 16,
    });

    expect(
      buildClearEvent({
        lines: 2,
        combo: 2,
        tSpinType: "full",
      }),
    ).toMatchObject({
      isTSpin: true,
      score: 1250,
      attackLines: 5,
    });

    expect(
      buildClearEvent({
        lines: 1,
        combo: 4,
      }),
    ).toMatchObject({
      comboAttack: 2,
      attackLines: 2,
    });
  });

  it("recognizes perfect clears", () => {
    const board = makeBoard();
    expect(isBoardEmpty(board)).toBe(true);
    board[ROWS - 1][0] = "I";
    expect(isBoardEmpty(board)).toBe(false);
  });
});
