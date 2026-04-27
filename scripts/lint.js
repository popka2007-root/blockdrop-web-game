const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TARGETS = [
  "index.html",
  "styles.css",
  "server.js",
  "sw.js",
  "js",
  "tests",
  "e2e",
  ".github",
];
const errors = [];

function walk(entry) {
  const full = path.join(ROOT, entry);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    return fs.readdirSync(full).flatMap((name) => walk(path.join(entry, name)));
  }
  return /\.(html|css|js|mjs|cjs|ya?ml)$/.test(entry) ? [full] : [];
}

for (const file of TARGETS.flatMap(walk)) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\t"))
    errors.push(`${path.relative(ROOT, file)} contains tabs`);
  if (/[ \t]+$/m.test(text))
    errors.push(`${path.relative(ROOT, file)} contains trailing whitespace`);
}

const ciPath = path.join(ROOT, ".github", "workflows", "ci.yml");
if (fs.existsSync(ciPath)) {
  const ciText = fs.readFileSync(ciPath, "utf8");
  const ciLines = ciText.split(/\r?\n/).filter(Boolean);
  if (ciLines.length < 12)
    errors.push(
      "ci.yml looks collapsed; expected a multiline GitHub Actions workflow",
    );
  for (const required of [
    "name: CI",
    "npm install",
    "npm run lint",
    "npm test",
    "npm run test:e2e",
  ]) {
    if (!ciText.includes(required))
      errors.push(`ci.yml is missing ${required}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("lint ok");
