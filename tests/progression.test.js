import { describe, expect, it } from "vitest";
import {
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
      profile: { profileSchemaVersion: 1 },
    });
  });
});
