const crypto = require("crypto");

const PASSWORD_MIN_LENGTH = 8;

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 24);
}

function cleanDisplayName(value) {
  return (
    String(value || "Player")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 18) || "Player"
  );
}

function normalizeSessionToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 160);
}

function validateCredentials({ username, password }) {
  const safeUsername = cleanUsername(username);
  const rawPassword = String(password || "");
  if (safeUsername.length < 3) {
    return { ok: false, code: "badUsername" };
  }
  if (rawPassword.length < PASSWORD_MIN_LENGTH || rawPassword.length > 128) {
    return { ok: false, code: "badPassword" };
  }
  return { ok: true, username: safeUsername, password: rawPassword };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [scheme, salt, expected] = String(passwordHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  cleanUsername,
  cleanDisplayName,
  normalizeSessionToken,
  validateCredentials,
  hashPassword,
  verifyPassword,
  createSessionToken,
};
