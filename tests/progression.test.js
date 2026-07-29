import { describe, expect, it } from "vitest";
import {
  QUEST_BALANCE_VERSION,
  applyGameProgress,
  levelFromXp,
  normalizeProfile,
  portableProfile,
  selectCosmetic,
  weekKey,
} from "../js/progression.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("local progression", () => {
  it("creates stable daily and weekly quests", () => {
    const first = normalizeProfile({}, NOW);
    const second = normalizeProfile(first, new Date("2026-07-20T18:00:00Z"));
    expect(second.dailyQuests).toEqual(first.dailyQuests);
    expect(second.weeklyQuests).toEqual(first.weeklyQuests);
    expect(weekKey(NOW)).toMatch(/^2026-W\d{2}$/);
    expect(QUEST_BALANCE_VERSION).toBe(2);
    expect(second.dailyQuests).toHaveLength(2);
    expect(second.weeklyQuests).toHaveLength(2);
    expect(second.weeklyQuests.every((quest) => quest.target <= 60)).toBe(true);
  });

  it("awards XP, completes quests, and unlocks cosmetics", () => {
    let profile = normalizeProfile({}, NOW);
    for (let game = 0; game < 12; game += 1) {
      profile = applyGameProgress(
        profile,
        { score: 5_000, lines: 12, hardDrops: 20, won: game % 2 === 0 },
        NOW,
      ).profile;
    }
    expect(profile.games).toBe(12);
    expect(profile.level).toBe(levelFromXp(profile.xp));
    expect(profile.dailyQuests.some((quest) => quest.completed)).toBe(true);
    expect(profile.unlockedCosmetics.length).toBeGreaterThan(1);
  });

  it("only selects unlocked cosmetics and creates a portable schema", () => {
    const profile = normalizeProfile({}, NOW);
    expect(selectCosmetic(profile, "mono-ghost", NOW).selectedCosmetic).toBe(
      "mint-trail",
    );
    expect(portableProfile(profile, NOW)).toMatchObject({
      kind: "blockdrop-profile",
      exportSchemaVersion: 1,
      profile: { profileSchemaVersion: 2 },
    });
  });

  it("repairs missing and stale quest arrays with current balance values", () => {
    const broken = normalizeProfile(
      {
        profileSchemaVersion: 1,
        dailyKey: "2026-07-20",
        weeklyKey: weekKey(NOW),
        dailyQuests: [],
        weeklyQuests: [{ id: "unknown", target: 99_999 }],
      },
      NOW,
    );

    expect(broken.dailyQuests).toHaveLength(2);
    expect(broken.weeklyQuests).toHaveLength(2);
    expect(broken.dailyQuests.every((quest) => quest.periodKey === "2026-07-20")).toBe(true);
    expect(broken.weeklyQuests.every((quest) => quest.target <= 60)).toBe(true);
  });

  it("claims a completed imported quest once and never duplicates its XP", () => {
    const profile = normalizeProfile({}, NOW);
    const quest = profile.dailyQuests[0];
    quest.progress = quest.target;
    quest.completed = true;
    quest.claimed = false;
    const before = profile.xp;

    const first = applyGameProgress(profile, {}, NOW);
    const afterFirst = first.profile.xp;
    const second = applyGameProgress(first.profile, {}, NOW);

    expect(first.completedQuestIds).toContain(quest.id);
    expect(afterFirst).toBeGreaterThan(before);
    expect(second.completedQuestIds).not.toContain(quest.id);
    expect(second.profile.xp - afterFirst).toBe(0);
  });
});
