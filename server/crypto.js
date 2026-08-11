const crypto = require("crypto");
const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;

function randomHex() {
  return crypto.randomBytes(32).toString("hex");
}

let _kek = null;
function loadKek() {
  if (_kek) return _kek;
  const hex = process.env.SYNC_KEK;
  if (!hex) throw new Error("SYNC_KEK env is required (64 hex chars = 32 bytes)");
  _kek = Buffer.from(hex, "hex");
  if (_kek.length !== 32) throw new Error("SYNC_KEK must be 64 hex chars (AES-256)");
  return _kek;
}

function encrypt(plaintext) {
  const kek = loadKek();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, kek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ct, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

function decrypt(ciphertext, iv) {
  const kek = loadKek();
  const raw = Buffer.from(ciphertext, "base64");
  const ct = raw.slice(0, raw.length - TAG_LEN);
  const tag = raw.slice(raw.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, kek, Buffer.from(iv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

module.exports = { randomHex, loadKek, encrypt, decrypt, ALGO };
