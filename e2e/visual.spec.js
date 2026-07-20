import { expect, test } from "@playwright/test";

const THEMES = ["ember", "day", "candy", "mono"];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    globalThis.crypto.getRandomValues = (values) => {
      values.fill(0x2a);
      return values;
    };
    localStorage.setItem(
      "blockdrop-onboarding-v1",
      JSON.stringify({ completed: true }),
    );
    localStorage.setItem(
      "blockdrop-settings-v2",
      JSON.stringify({ theme: "ember", reducedMotion: true }),
    );
  });
});

async function setTheme(page, theme) {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
  }, theme);
}

async function capture(page, theme, scene, options = {}) {
  await setTheme(page, theme);
  await page.evaluate(() => {
    const toast = document.querySelector("#toast");
    if (toast) toast.hidden = true;
  });
  await expect(page).toHaveScreenshot(`${theme}-${scene}.png`, {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    maxDiffPixelRatio: 0.002,
    ...options,
  });
}

for (const theme of THEMES) {
  test(`visual states remain stable for ${theme}`, async ({ page }) => {
    await page.goto("/");
    await capture(page, theme, "start");

    await page.evaluate(() => {
      document.querySelector("#startButton").click();
      document.querySelector("#pauseButton").click();
      document.querySelector("#pauseOverlay").hidden = true;
    });
    await capture(page, theme, "gameplay");

    await page.evaluate(() => {
      document.querySelector("#app")?.classList.add("danger");
      const canvas = document.querySelector("#board");
      const context = canvas.getContext("2d");
      const cellWidth = canvas.width / 10;
      const cellHeight = canvas.height / 20;
      context.fillStyle = "#ff5f6d";
      for (let row = 3; row < 20; row += 1) {
        for (let col = 0; col < 10; col += 1) {
          if ((row + col) % 5 !== 0) {
            context.fillRect(
              col * cellWidth + 1,
              row * cellHeight + 1,
              cellWidth - 2,
              cellHeight - 2,
            );
          }
        }
      }
    });
    await capture(page, theme, "danger");

    await page.evaluate(() => {
      document.querySelector("#pauseOverlay").hidden = false;
    });
    await capture(page, theme, "pause");

    await page.evaluate(() => {
      document.querySelectorAll(".overlay").forEach((overlay) => {
        overlay.hidden = true;
        overlay.setAttribute("aria-hidden", "true");
      });
      const overlay = document.querySelector("#gameOverOverlay");
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
    });
    await capture(page, theme, "game-over");

    await page.goto("/");
    await page.locator("#friendButton").click();
    await expect(page.locator("#roomQr")).toHaveAttribute(
      "src",
      /\/api\/qr\?data=/,
    );
    await expect(page.locator("#roomQr")).toHaveJSProperty("complete", true);
    await page.evaluate(() => {
      document.querySelector("#onlineRoomInput").value = "ROOM42";
      document.querySelector("#roomCodeValue").textContent = "ROOM42";
      document.querySelector("#roomInviteLink").textContent =
        "http://blockdrop.local/room/ROOM42";
    });
    await capture(page, theme, "online", {
      mask: [
        page.locator("#onlineRoomInput"),
        page.locator("#onlineStatus"),
        page.locator("#onlinePanel"),
        page.locator("#roomQr"),
      ],
      maskColor: "#7d8490",
    });

    await page.locator("#closeOnlineButton").click();
    await page.locator("#menuMoreSummary").click();
    await page.locator("#replayButton").click();
    await page.evaluate(() => {
      document.querySelector("#toast")?.classList.remove("show");
    });
    await capture(page, theme, "replay");
  });
}
