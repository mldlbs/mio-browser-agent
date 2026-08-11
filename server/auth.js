const crypto = require("crypto");

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function makePassword() {
  return crypto.randomBytes(16).toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  const actual = hashPassword(password, salt);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, makePassword, verifyPassword };
