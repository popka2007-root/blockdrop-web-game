import { describe, expect, it } from "vitest";
import {
  HELP_CONTENT,
  LOCALIZED_OPTIONS,
  UI_TEXT,
  assertCatalogParity,
  assertI18nParity,
  formatMessage,
  translate,
} from "../js/i18n.js";

describe("RU/EN interface catalogs", () => {
  it("keeps every required catalog in structural parity", () => {
    expect(assertI18nParity()).toBe(true);
    expect(Object.keys(UI_TEXT.ru)).toEqual(Object.keys(UI_TEXT.en));
    expect(Object.keys(LOCALIZED_OPTIONS.ru)).toEqual(
      Object.keys(LOCALIZED_OPTIONS.en),
    );
    expect(HELP_CONTENT.ru.cards).toHaveLength(HELP_CONTENT.en.cards.length);
    expect(HELP_CONTENT.ru.controls).toHaveLength(
      HELP_CONTENT.en.controls.length,
    );
  });

  it("rejects a locale with a missing message", () => {
    expect(() =>
      assertCatalogParity({
        ru: { start: "Начать", close: "Закрыть" },
        en: { start: "Start" },
      }),
    ).toThrow(/does not match/);
  });

  it("falls back to RU and finally to the supplied fallback", () => {
    expect(translate("en", "start")).toBe("Start game");
    expect(translate("de", "start")).toBe(UI_TEXT.ru.start);
    expect(translate("en", "missing", "Fallback")).toBe("Fallback");
    expect(formatMessage("en", "signedIn", { name: "Player" })).toBe(
      "Signed in: Player",
    );
  });
});
