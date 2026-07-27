(function registerBlockDropAi(root, factory) {
  const engine =
    root.__blockdropEngine ||
    (typeof module !== "undefined" && module.exports
      ? require("./engine.js")
      : null);
  const ai = factory(engine);
  if (typeof module !== "undefined" && module.exports) module.exports = ai;
  root.__blockdropAi = ai;
})(
  typeof globalThis !== "undefined" ? globalThis : self,
  function createAi(engine) {
    "use strict";

    if (!engine)
      throw new Error("BlockDrop AI requires the deterministic engine");

    const AI_VERSION = 1;
    const DIFFICULTIES = Object.freeze({
      easy: Object.freeze({
        depth: 1,
        beamWidth: 6,
        thinkTicks: 90,
        mistakeRate: 0.24,
        mistakeWindow: 6,
        allowCounterClockwise: false,
        allowHold: false,
        maxNodes: 260,
      }),
      normal: Object.freeze({
        depth: 1,
        beamWidth: 14,
        thinkTicks: 58,
        mistakeRate: 0.1,
        mistakeWindow: 4,
        allowCounterClockwise: true,
        allowHold: false,
        maxNodes: 600,
      }),
      hard: Object.freeze({
        depth: 2,
        beamWidth: 20,
        thinkTicks: 34,
        mistakeRate: 0.025,
        mistakeWindow: 2,
        allowCounterClockwise: true,
        allowHold: true,
        maxNodes: 1800,
      }),
      insane: Object.freeze({
        depth: 3,
        beamWidth: 28,
        thinkTicks: 18,
        mistakeRate: 0,
        mistakeWindow: 1,
        allowCounterClockwise: true,
        allowHold: true,
        maxNodes: 4200,
      }),
    });

    const STYLES = Object.freeze({
      balanced: Object.freeze({
        aggregateHeight: -0.48,
        holes: -8.2,
        bumpiness: -0.36,
        wells: -0.22,
        lineClears: 3.8,
        attackPotential: 5.2,
        topOutRisk: -18,
      }),
      aggressive: Object.freeze({
        aggregateHeight: -0.4,
        holes: -7.1,
        bumpiness: -0.3,
        wells: -0.15,
        lineClears: 3.4,
        attackPotential: 7.4,
        topOutRisk: -15,
      }),
      defensive: Object.freeze({
        aggregateHeight: -0.62,
        holes: -10.2,
        bumpiness: -0.5,
        wells: -0.38,
        lineClears: 3.5,
        attackPotential: 3.6,
        topOutRisk: -24,
      }),
    });

    function boardMetrics(board) {
      const heights = Array(engine.COLS).fill(0);
      let holes = 0;
      let aggregateHeight = 0;
      for (let x = 0; x < engine.COLS; x += 1) {
        let found = false;
        for (let y = 0; y < engine.ROWS; y += 1) {
          if (board[y][x]) {
            if (!found) {
              heights[x] = engine.ROWS - y;
              aggregateHeight += heights[x];
              found = true;
            }
          } else if (found) {
            holes += 1;
          }
        }
      }
      let bumpiness = 0;
      let wells = 0;
      for (let x = 0; x < engine.COLS; x += 1) {
        if (x) bumpiness += Math.abs(heights[x] - heights[x - 1]);
        const left = x === 0 ? engine.ROWS : heights[x - 1];
        const right = x === engine.COLS - 1 ? engine.ROWS : heights[x + 1];
        wells += Math.max(0, Math.min(left, right) - heights[x]);
      }
      const maxHeight = Math.max(0, ...heights);
      return { heights, aggregateHeight, holes, bumpiness, wells, maxHeight };
    }

    function rotationActions(current, target, allowCounterClockwise) {
      const clockwise = (target - current + 4) % 4;
      const counterClockwise = (current - target + 4) % 4;
      if (allowCounterClockwise && counterClockwise < clockwise) {
        return Array(counterClockwise).fill("rotateCCW");
      }
      return Array(clockwise).fill("rotateCW");
    }

    function applyActions(state, actions) {
      const events = [];
      let seq = Math.max(0, Number(state.lastAckSeq) || 0);
      for (const action of actions) {
        seq += 1;
        if (
          !engine.applyInput(
            state,
            { tick: state.tick, seq, action, pressed: true },
            events,
          )
        ) {
          return { ok: false, events };
        }
      }
      return { ok: true, events };
    }

    function enumeratePlacements(sourceState, config) {
      if (!sourceState?.active || sourceState.gameOver) return [];
      const placements = [];
      const holdPrefixes =
        config.allowHold && !sourceState.holdUsed ? [[], ["hold"]] : [[]];
      for (const prefix of holdPrefixes) {
        const heldState = engine.restoreSnapshot(engine.snapshot(sourceState));
        if (prefix.length && !applyActions(heldState, prefix).ok) continue;
        if (!heldState.active || heldState.gameOver) continue;
        for (let rotation = 0; rotation < 4; rotation += 1) {
          const rotations = rotationActions(
            heldState.active.rotation,
            rotation,
            config.allowCounterClockwise,
          );
          for (let targetX = -2; targetX <= engine.COLS - 1; targetX += 1) {
            const state = engine.restoreSnapshot(engine.snapshot(heldState));
            const actions = [...rotations];
            const rotated = applyActions(state, rotations);
            if (!rotated.ok || !state.active) continue;
            const dx = targetX - state.active.x;
            actions.push(
              ...Array(Math.abs(dx)).fill(dx < 0 ? "left" : "right"),
            );
            actions.push("hardDrop");
            const applied = applyActions(
              state,
              actions.slice(rotations.length),
            );
            if (!applied.ok) continue;
            const lock = [...rotated.events, ...applied.events].find(
              (event) => event.type === "lock",
            );
            if (!lock) continue;
            placements.push({
              state,
              actions: [...prefix, ...actions],
              lock,
            });
          }
        }
      }
      return placements;
    }

    function evaluatePlacement(placement, weights, parentState) {
      const metrics = boardMetrics(placement.state.board);
      const lineClears = Math.max(0, placement.state.lines - parentState.lines);
      const attackPotential = Math.max(0, Number(placement.lock.attack) || 0);
      const topOutRisk =
        (placement.state.gameOver ? 100 : 0) +
        Math.max(0, metrics.maxHeight - 15) ** 2;
      const value =
        metrics.aggregateHeight * weights.aggregateHeight +
        metrics.holes * weights.holes +
        metrics.bumpiness * weights.bumpiness +
        metrics.wells * weights.wells +
        lineClears * weights.lineClears +
        attackPotential * weights.attackPotential +
        topOutRisk * weights.topOutRisk;
      return { value, metrics, lineClears, attackPotential, topOutRisk };
    }

    function deterministicIndex(state, difficulty, length, window) {
      if (length <= 1) return 0;
      let randomState = engine.hashSeed(
        `${state.seed}:${state.tick}:${state.pieces}:${difficulty}:choice`,
      );
      const next = () => {
        randomState ^= randomState << 13;
        randomState ^= randomState >>> 17;
        randomState ^= randomState << 5;
        randomState >>>= 0;
        return randomState / 0x100000000;
      };
      next();
      return Math.min(length - 1, 1 + Math.floor(next() * Math.max(1, window)));
    }

    function shouldMakeMistake(state, difficulty, rate) {
      if (!rate) return false;
      let randomState = engine.hashSeed(
        `${state.seed}:${state.tick}:${state.pieces}:${difficulty}:mistake`,
      );
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return (randomState >>> 0) / 0x100000000 < rate;
    }

    function search(state, config, weights) {
      let nodes = [
        {
          state,
          rootActions: [],
          score: 0,
          metrics: boardMetrics(state.board),
        },
      ];
      let visited = 0;
      for (let depth = 0; depth < config.depth; depth += 1) {
        const expanded = [];
        for (const node of nodes) {
          for (const placement of enumeratePlacements(node.state, config)) {
            visited += 1;
            const evaluation = evaluatePlacement(
              placement,
              weights,
              node.state,
            );
            expanded.push({
              state: placement.state,
              rootActions: depth === 0 ? placement.actions : node.rootActions,
              score: node.score + evaluation.value * (depth ? 0.72 : 1),
              metrics: evaluation.metrics,
              attackPotential: evaluation.attackPotential,
              lineClears: evaluation.lineClears,
            });
            if (visited >= config.maxNodes) break;
          }
          if (visited >= config.maxNodes) break;
        }
        if (!expanded.length) break;
        expanded.sort(
          (left, right) =>
            right.score - left.score ||
            left.metrics.holes - right.metrics.holes ||
            left.metrics.aggregateHeight - right.metrics.aggregateHeight ||
            left.rootActions
              .join(",")
              .localeCompare(right.rootActions.join(",")),
        );
        nodes = expanded.slice(0, config.beamWidth);
        if (visited >= config.maxNodes) break;
      }
      return { candidates: nodes, visited };
    }

    function planMove(snapshot, options = {}) {
      const state = engine.restoreSnapshot(snapshot);
      const difficulty = DIFFICULTIES[options.difficulty]
        ? options.difficulty
        : "normal";
      const style = STYLES[options.style] ? options.style : "balanced";
      const config = DIFFICULTIES[difficulty];
      const result = search(state, config, STYLES[style]);
      if (!result.candidates.length) {
        return {
          aiVersion: AI_VERSION,
          engineVersion: engine.ENGINE_VERSION,
          requestId: options.requestId || "",
          difficulty,
          style,
          actions: ["hardDrop"],
          thinkTicks: config.thinkTicks,
          visited: result.visited,
        };
      }
      const mistake = shouldMakeMistake(state, difficulty, config.mistakeRate);
      const choiceIndex = mistake
        ? deterministicIndex(
            state,
            difficulty,
            result.candidates.length,
            config.mistakeWindow,
          )
        : 0;
      const choice = result.candidates[choiceIndex];
      return {
        aiVersion: AI_VERSION,
        engineVersion: engine.ENGINE_VERSION,
        requestId: options.requestId || "",
        difficulty,
        style,
        actions: choice.rootActions,
        thinkTicks: config.thinkTicks,
        mistake,
        choiceIndex,
        visited: result.visited,
        evaluation: Math.round(choice.score * 1000) / 1000,
        metrics: choice.metrics,
      };
    }

    return Object.freeze({
      AI_VERSION,
      DIFFICULTIES,
      STYLES,
      boardMetrics,
      enumeratePlacements,
      planMove,
    });
  },
);
