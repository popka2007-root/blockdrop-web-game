const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "www");

const FILES_TO_COPY = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "PRIVACY.md",
  "TERMS.md",
  "SECURITY.md",
  "LICENSE",
];

const DIRS_TO_COPY = ["js", "styles", "icons", "shared"];

function copyRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else if (exists) {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

for (const file of FILES_TO_COPY) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, file));
  }
}

for (const dir of DIRS_TO_COPY) {
  const src = path.join(ROOT, dir);
  if (fs.existsSync(src)) {
    copyRecursive(src, path.join(DIST, dir));
  }
}

console.log("Web assets built successfully to ./www");
