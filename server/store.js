const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createStore(dataDir) {
  const file = path.join(dataDir, "store.json");
  fs.mkdirSync(dataDir, { recursive: true });
  let data = { users: {}, tokens: {}, records: {} };
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { data = { users: {}, tokens: {}, records: {} }; }
  }
  return {
    getUser(email) { return data.users[email] || null; },
    hasUser(email) { return !!data.users[email]; },
    putUser(email, rec) { data.users[email] = rec; this.save(); },
    putToken(email) {
      const token = crypto.randomBytes(32).toString("hex");
      data.tokens[token] = { email };
      this.save();
      return token;
    },
    getTokenUser(token) { return data.tokens[token] ? { email: data.tokens[token].email } : null; },
    revokeToken(token) { delete data.tokens[token]; this.save(); },
    getRecord(email, id) {
      const rec = data.records[email + ":" + id];
      return rec ? { ...rec } : null;
    },
    putRecord(email, id, rec) {
      data.records[email + ":" + id] = { ciphertext: rec.ciphertext, iv: rec.iv, updatedAt: rec.updatedAt || 0 };
      this.save();
    },
    delRecord(email, id) { delete data.records[email + ":" + id]; this.save(); },
    listRecords(email) {
      const prefix = email + ":";
      return Object.keys(data.records)
        .filter((k) => k.startsWith(prefix))
        .map((k) => {
          const id = k.slice(prefix.length);
          const rec = data.records[k];
          return { id, ciphertext: rec.ciphertext, iv: rec.iv, updatedAt: rec.updatedAt };
        });
    },
    save() { fs.writeFileSync(file, JSON.stringify(data)); },
  };
}

module.exports = { createStore };
