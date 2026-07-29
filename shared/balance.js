(function initBlockDropBalance(root, factory) {
  const balance = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = balance;
  root.__blockdropBalance = balance;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function balanceFactory() {
    "use strict";

    const PROFILE_SCHEMA_VERSION = 2;
    const QUEST_BALANCE_VERSION = 2;
    const freezeQuests = (quests) =>
      Object.freeze(quests.map((quest) => Object.freeze({ ...quest })));
    const daily = freezeQuests([
      { id: "daily-games", type: "games", target: 2, rewardXp: 100 },
      { id: "daily-lines", type: "lines", target: 10, rewardXp: 110 },
      { id: "daily-drops", type: "hardDrops", target: 18, rewardXp: 90 },
    ]);
    const weekly = freezeQuests([
      { id: "weekly-games", type: "games", target: 10, rewardXp: 350 },
      { id: "weekly-lines", type: "lines", target: 60, rewardXp: 420 },
      { id: "weekly-wins", type: "wins", target: 3, rewardXp: 450 },
    ]);

    return Object.freeze({
      PROFILE_SCHEMA_VERSION,
      QUEST_BALANCE_VERSION,
      QUEST_BALANCE: Object.freeze({
        version: QUEST_BALANCE_VERSION,
        daily,
        weekly,
      }),
    });
  },
);
