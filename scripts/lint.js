const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TARGETS = ["index.html", "server.js", "sw.js", "js", "tests", "e2e"];
const errors = [];

function walk(entry) {
  const full = path.join(ROOT, entry);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    return fs.readdirSync(full).flatMap((name) => walk(path.join(entry, name)));
  }
  return /\.(html|css|js|mjs|cjs)$/.test(entry) ? [full] : [];
}

for (const file of TARGETS.flatMap(walk)) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\t")) errors.push(`${path.relative(ROOT, file)} contains tabs`);
  if (/[ \t]+$/m.test(text)) errors.push(`${path.relative(ROOT, file)} contains trailing whitespace`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("lint ok");
