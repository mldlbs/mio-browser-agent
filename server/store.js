const fs = require("fs");
const path = require("path");

function createStore(dataDir) {
  const file = path.join(dataDir, "records.json");
  fs.mkdirSync(dataDir, { recursive: true });
  let data = {};
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { data = {}; }
  }
  return {
    list() { return Object.keys(data).map((id) => ({ id, ...data[id] })); },
    get(id) { return data[id] || null; },
    put(id, rec) { data[id] = { updatedAt: rec.updatedAt, ciphertext: rec.ciphertext, iv: rec.iv }; this.save(); },
    del(id) { if (data[id]) { delete data[id]; this.save(); } },
    save() { fs.writeFileSync(file, JSON.stringify(data)); },
  };
}

module.exports = { createStore };
