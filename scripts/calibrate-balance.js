const engine = require("../shared/engine.js");
const ai = require("../shared/ai.js");
const progressionBalance = require("../shared/balance.js");

const DIFFICULTY_ORDER = ["easy", "normal", "hard", "insane"];

function numberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * fraction) - 1),
  );
  return ordered[index] || 0;
}

function simulateAi({
  difficulty,
  seed,
  maxPieces,
  garbageEveryPieces,
  garbageLines,
}) {
  const state = engine.createState({ seed: `balance:${seed}` });
  const planTimes = [];
  let nextThinkTick = 0;
  let lastPressurePiece = 0;
  let attack = 0;
  let illegalActions = 0;
  let mistakes = 0;
  let visited = 0;

  while (
    !state.gameOver &&
    state.pieces < maxPieces &&
    state.tick < engine.TICK_RATE * 60 * 20
  ) {
    const events = [];
    if (state.active && state.tick >= nextThinkTick) {
      const startedAt = performance.now();
      const plan = ai.planMove(engine.snapshot(state), {
        difficulty,
        style: "balanced",
      });
      planTimes.push(performance.now() - startedAt);
      mistakes += plan.mistake ? 1 : 0;
      visited += Number(plan.visited) || 0;
      for (const action of plan.actions) {
        const accepted = engine.applyInput(
          state,
          {
            tick: state.tick,
            seq: state.lastAckSeq + 1,
            action,
            pressed: true,
          },
          events,
        );
        if (!accepted) {
          illegalActions += 1;
          break;
        }
      }
      nextThinkTick = state.tick + plan.thinkTicks;
    }

    const stepped = engine.step(state);
    events.push(...stepped.events);
    for (const event of events) {
      if (event.type === "lock") attack += event.attack;
    }

    if (
      state.pieces > lastPressurePiece &&
      state.pieces > 0 &&
      state.pieces % garbageEveryPieces === 0
    ) {
      engine.queueGarbage(state, garbageLines);
      lastPressurePiece = state.pieces;
    }
  }

  const board = ai.boardMetrics(state.board);
  return {
    seed,
    pieces: state.pieces,
    lines: state.lines,
    attack,
    score: state.score,
    topOut: state.gameOver,
    mistakes,
    illegalActions,
    visited,
    plans: planTimes.length,
    planP95Ms: percentile(planTimes, 0.95),
    planMaxMs: Math.max(0, ...planTimes),
    holes: board.holes,
    maxHeight: board.maxHeight,
  };
}

function summarizeDifficulty(difficulty, runs, maxPieces) {
  return {
    difficulty,
    runs: runs.length,
    survival: Number((average(runs.map((run) => run.pieces)) / maxPieces).toFixed(3)),
    averagePieces: Number(average(runs.map((run) => run.pieces)).toFixed(1)),
    averageLines: Number(average(runs.map((run) => run.lines)).toFixed(1)),
    averageAttack: Number(average(runs.map((run) => run.attack)).toFixed(1)),
    topOutRate: Number(
      (runs.filter((run) => run.topOut).length / runs.length).toFixed(3),
    ),
    mistakeRate: Number(
      (
        runs.reduce((total, run) => total + run.mistakes, 0) /
        Math.max(1, runs.reduce((total, run) => total + run.plans, 0))
      ).toFixed(3),
    ),
    planP95Ms: Number(
      percentile(
        runs.flatMap((run) => [run.planP95Ms]),
        0.95,
      ).toFixed(1),
    ),
    illegalActions: runs.reduce(
      (total, run) => total + run.illegalActions,
      0,
    ),
  };
}

function verifyCalibration(summaries) {
  const failures = [];
  for (const summary of summaries) {
    if (summary.illegalActions) {
      failures.push(`${summary.difficulty}: ${summary.illegalActions} illegal actions`);
    }
    const configuredRate = ai.DIFFICULTIES[summary.difficulty].mistakeRate;
    const maximumObservedRate = Math.min(1, configuredRate * 3 + 0.05);
    if (summary.mistakeRate > maximumObservedRate) {
      failures.push(
        `${summary.difficulty} mistake rate ${summary.mistakeRate} exceeds ${maximumObservedRate}`,
      );
    }
  }
  for (let index = 1; index < summaries.length; index += 1) {
    const weaker = summaries[index - 1];
    const stronger = summaries[index];
    if (stronger.averagePieces < weaker.averagePieces) {
      failures.push(
        `${stronger.difficulty} survival ${stronger.averagePieces} < ${weaker.difficulty} ${weaker.averagePieces}`,
      );
    }
  }
  return failures;
}

async function run() {
  const quick = process.argv.includes("--quick");
  const seeds = numberArg("--seeds", quick ? 1 : 5);
  const maxPieces = numberArg("--pieces", quick ? 40 : 90);
  const garbageEveryPieces = numberArg("--garbage-every", 10);
  const garbageLines = numberArg("--garbage-lines", 2);
  const rows = [];
  const runs = {};

  for (const difficulty of DIFFICULTY_ORDER) {
    runs[difficulty] = Array.from({ length: seeds }, (_unused, index) =>
      simulateAi({
        difficulty,
        seed: index,
        maxPieces,
        garbageEveryPieces,
        garbageLines,
      }),
    );
    rows.push(summarizeDifficulty(difficulty, runs[difficulty], maxPieces));
  }

  const scoringSamples = {
    tetris: engine.calculateClearResult({ lines: 4, level: 1, combo: 1 }),
    backToBackTetris: engine.calculateClearResult({
      lines: 4,
      level: 1,
      combo: 2,
      backToBack: true,
    }),
    perfectClearDouble: engine.calculateClearResult({
      lines: 2,
      level: 1,
      combo: 1,
      perfectClear: true,
    }),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    engineVersion: engine.ENGINE_VERSION,
    aiVersion: ai.AI_VERSION,
    questBalanceVersion: progressionBalance.QUEST_BALANCE_VERSION,
    pressure: { seeds, maxPieces, garbageEveryPieces, garbageLines },
    ai: rows,
    scoringSamples,
    quests: progressionBalance.QUEST_BALANCE,
  };
  const failures = verifyCalibration(rows);

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ...report, runs }, null, 2)}\n`);
  } else {
    console.table(rows);
    console.log("Scoring:", scoringSamples);
    console.log("Quests:", progressionBalance.QUEST_BALANCE);
  }

  if (failures.length) {
    console.error(`Balance calibration failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else if (!process.argv.includes("--json")) {
    console.log("Balance calibration passed.");
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  simulateAi,
  summarizeDifficulty,
  verifyCalibration,
};
