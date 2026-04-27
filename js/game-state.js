import { ROWS, COLS } from "./config.js";
import { bus } from "./event-bus.js";
import { getModeConfig } from "./modes.js";

function makeBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

export class GameState {
  constructor(modeConfig = getModeConfig("classic")) {
    this.reset(modeConfig);
  }

  reset(modeConfig = this.mode) {
    this.mode = modeConfig;
    this.score = 0;
    this.level = modeConfig.startLevel;
    this.lines = modeConfig.startLines;
    this.board = makeBoard();
    this.active = null;
    this.queue = [];
    this.hold = null;
    this.holdUsed = false;
    this.combo = 0;
    this.isPaused = false;
    this.isGameOver = false;
    this.stats = {
      pieces: 0,
      time: 0,
      maxHeight: 0,
      lineClears: 0,
    };
    bus.emit("game:stateReset", this.snapshot());
    return this;
  }

  updateScore(delta) {
    const oldScore = this.score;
    this.score = Math.max(0, this.score + delta);
    if (this.score !== oldScore) {
      bus.emit("game:scoreChanged", {
        score: this.score,
        delta: this.score - oldScore,
      });
    }
    return this;
  }

  updateLines(count) {
    this.lines += count;
    this.stats.lineClears += count;
    bus.emit("game:linesCleared", { count, totalLines: this.lines });
    return this;
  }

  levelUp() {
    this.level += 1;
    bus.emit("game:levelUp", { level: this.level });
    return this;
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    bus.emit(this.isPaused ? "game:paused" : "game:resumed", this.snapshot());
    return this;
  }

  setGameOver() {
    this.isGameOver = true;
    bus.emit("game:gameOver", this.snapshot());
    return this;
  }

  snapshot() {
    return {
      mode: this.mode.key,
      score: this.score,
      level: this.level,
      lines: this.lines,
      stats: { ...this.stats },
    };
  }

  toJSON() {
    return {
      ...this.snapshot(),
      board: this.board,
      active: this.active,
      queue: this.queue,
      hold: this.hold,
      holdUsed: this.holdUsed,
      combo: this.combo,
      savedAt: new Date().toISOString(),
    };
  }

  static fromJSON(data, modeConfig = getModeConfig(data?.mode || "classic")) {
    const state = new GameState(modeConfig);
    Object.assign(state, data, { mode: modeConfig });
    return state;
  }
}
