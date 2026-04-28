const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

const version = String(packageJson.version || "").trim();
const refName = String(process.env.GITHUB_REF_NAME || "").trim();
const sha = String(process.env.GITHUB_SHA || "").trim();

if (!version) {
  console.error("package.json version is missing");
  process.exit(1);
}

if (!refName) {
  console.log(`release validation skipped: package version ${version}`);
  process.exit(0);
}

if (refName !== version) {
  console.error(
    `release validation failed: tag ${refName} does not match package version ${version}`,
  );
  process.exit(1);
}

if (!sha) {
  console.log(`release validation passed for ${version}`);
  process.exit(0);
}

console.log(`release validation passed for ${version} on ${sha.slice(0, 7)}`);
