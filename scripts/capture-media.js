const { chromium } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "screenshots");
const baseUrl = "http://127.0.0.1:8787";

const palette = [
  [10, 15, 25], [22, 31, 48], [38, 49, 73], [78, 91, 120],
  [33, 211, 245], [255, 209, 102], [155, 108, 255], [34, 214, 153],
  [255, 107, 107], [79, 120, 255], [255, 154, 61], [223, 230, 238],
  [94, 234, 212], [255, 194, 87], [255, 255, 255], [0, 0, 0]
];

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const response = await fetch(baseUrl);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // retry
      }
      if (Date.now() - started > 8000) {
        reject(new Error("server did not start"));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

function byte(value) {
  return String.fromCharCode(value & 255);
}

function word(value) {
  return byte(value) + byte(value >> 8);
}

function blocks(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    output += byte(chunk.length) + String.fromCharCode(...chunk);
  }
  return output + "\0";
}

function lzw(indices, minCodeSize = 4) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map();
  const output = [];
  let buffer = 0;
  let bits = 0;

  const reset = () => {
    dict = new Map();
    for (let i = 0; i < clearCode; i += 1) dict.set(String(i), i);
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };
  const write = (code) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      output.push(buffer & 255);
      buffer >>= 8;
      bits -= 8;
    }
  };

  reset();
  write(clearCode);
  let phrase = String(indices[0] || 0);
  for (let i = 1; i < indices.length; i += 1) {
    const current = String(indices[i]);
    const joined = `${phrase},${current}`;
    if (dict.has(joined)) {
      phrase = joined;
      continue;
    }
    write(dict.get(phrase));
    if (nextCode < 4096) {
      dict.set(joined, nextCode);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    } else {
      write(clearCode);
      reset();
    }
    phrase = current;
  }
  write(dict.get(phrase));
  write(endCode);
  if (bits > 0) output.push(buffer & 255);
  return output;
}

function encodeGif(frames, width, height, delay = 12) {
  const colorTable = palette.map(([r, g, b]) => byte(r) + byte(g) + byte(b)).join("");
  let gif = "GIF89a" + word(width) + word(height) + byte(0xf3) + "\0\0" + colorTable;
  gif += "!\xff\u000bNETSCAPE2.0\u0003\u0001" + word(0) + "\0";
  for (const frame of frames) {
    gif += "!\xf9\u0004\u0004" + word(delay) + "\0\0";
    gif += "," + word(0) + word(0) + word(width) + word(height) + "\0";
    gif += byte(4) + blocks(lzw(frame, 4));
  }
  return Buffer.from(gif + ";", "binary");
}

async function captureBoardFrame(page, width = 120, height = 240) {
  return page.evaluate(({ width, height, palette }) => {
    const source = document.getElementById("board");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const indices = [];
    for (let i = 0; i < data.length; i += 4) {
      let best = 0;
      let bestDistance = Infinity;
      for (let p = 0; p < palette.length; p += 1) {
        const color = palette[p];
        const dr = data[i] - color[0];
        const dg = data[i + 1] - color[1];
        const db = data[i + 2] - color[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          best = p;
          bestDistance = distance;
        }
      }
      indices.push(best);
    }
    return indices;
  }, { width, height, palette });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: "8787" }, stdio: "ignore" });
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    await page.goto(baseUrl);
    await page.waitForTimeout(1900);
    await page.screenshot({ path: path.join(outDir, "menu-mobile.png"), fullPage: true });
    await page.locator("#startButton").click();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
    await page.screenshot({ path: path.join(outDir, "game-mobile.png"), fullPage: true });

    const frames = [];
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press(i % 2 ? "ArrowRight" : "ArrowLeft");
      await page.keyboard.press("Space");
      await page.waitForTimeout(90);
      frames.push(await captureBoardFrame(page));
    }
    fs.writeFileSync(path.join(outDir, "gameplay.gif"), encodeGif(frames, 120, 240));
    await browser.close();
  } finally {
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
