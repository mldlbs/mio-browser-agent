const { createStore } = require("./store.js");
const { makeAuth } = require("./auth.js");

function createApp(opts) {
  const store = opts && opts.store || createStore(opts && opts.dataDir || "data");
  const auth = makeAuth(process.env.SYNC_API_KEY);
  return (req, res) => {
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/v1/health" && req.method === "GET") return send(200, { ok: true });
    if (!url.pathname.startsWith("/v1/")) return send(404, { error: "not found" });
    if (!auth(req)) return send(401, { error: "unauthorized" });
    if (url.pathname === "/v1/records" && req.method === "GET") {
      return send(200, store.list());
    }
    const m = url.pathname.match(/^\/v1\/records\/([^/]+)$/);
    if (!m) return send(404, { error: "not found" });
    const id = decodeURIComponent(m[1]);
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        try {
          const rec = JSON.parse(body);
          if (!rec || typeof rec.ciphertext !== "string" || typeof rec.iv !== "string") {
            return send(400, { error: "bad bundle" });
          }
          store.put(id, { updatedAt: Number(rec.updatedAt) || 0, ciphertext: rec.ciphertext, iv: rec.iv });
          send(200, { ok: true });
        } catch (_) { send(400, { error: "bad json" }); }
      });
      return;
    }
    if (req.method === "DELETE") {
      store.del(id);
      return send(200, { ok: true });
    }
    send(405, { error: "method not allowed" });
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8181;
  const dataDir = process.env.DATA_DIR || "data";
  require("http").createServer(createApp({ dataDir })).listen(port, () => {
    console.log("mio-sync-server on :" + port);
  });
}

module.exports = { createApp };
