const http = require("http");
const { createStore } = require("./store.js");
const { hashPassword, makePassword, verifyPassword } = require("./auth.js");
const crypto = require("./crypto.js");

function createApp(opts) {
  crypto.loadKek();
  const store = opts && opts.store || createStore(opts && opts.dataDir || "data");

  const send = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  };

  function getEmail(req) {
    const auth = req.headers["authorization"];
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7);
    const entry = store.getTokenUser(token);
    return entry ? entry.email : null;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (_) { reject(new Error("bad json")); }
      });
      req.on("error", reject);
    });
  }

  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/v1/health" && req.method === "GET") {
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/v1/auth/register" && req.method === "POST") {
      try {
        const { email, password } = await readBody(req);
        if (!email || !password) return send(res, 400, { error: "email and password required" });
        if (store.hasUser(email)) return send(res, 409, { error: "user exists" });
        const salt = makePassword();
        const hash = hashPassword(password, salt);
        store.putUser(email, { salt, hash });
        const token = store.putToken(email);
        return send(res, 200, { token, email });
      } catch (_) { return send(res, 400, { error: "bad request" }); }
    }

    if (url.pathname === "/v1/auth/login" && req.method === "POST") {
      try {
        const { email, password } = await readBody(req);
        const user = store.getUser(email);
        if (!user || !verifyPassword(password, user.salt, user.hash)) {
          return send(res, 401, { error: "invalid credentials" });
        }
        const token = store.putToken(email);
        return send(res, 200, { token, email });
      } catch (_) { return send(res, 400, { error: "bad request" }); }
    }

    if (url.pathname === "/v1/auth/logout" && req.method === "POST") {
      const email = getEmail(req);
      if (!email) return send(res, 401, { error: "unauthorized" });
      const auth = req.headers["authorization"];
      store.revokeToken(auth.slice(7));
      return send(res, 200, { ok: true });
    }

    if (url.pathname === "/v1/auth/me" && req.method === "GET") {
      const email = getEmail(req);
      if (!email) return send(res, 401, { error: "unauthorized" });
      return send(res, 200, { email });
    }

    if (url.pathname === "/v1/records" && req.method === "GET") {
      const email = getEmail(req);
      if (!email) return send(res, 401, { error: "unauthorized" });
      const raw = store.listRecords(email);
      const records = raw.map((r) => {
        const plaintext = crypto.decrypt(r.ciphertext, r.iv);
        return { id: r.id, ...JSON.parse(plaintext) };
      });
      return send(res, 200, { records });
    }

    const m = url.pathname.match(/^\/v1\/records\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const email = getEmail(req);
      if (!email) return send(res, 401, { error: "unauthorized" });

      if (req.method === "PUT") {
        try {
          const body = await readBody(req);
          const { updatedAt, ...rest } = body;
          const plaintext = JSON.stringify(rest);
          const enc = crypto.encrypt(plaintext);
          store.putRecord(email, id, { ciphertext: enc.ciphertext, iv: enc.iv, updatedAt: updatedAt || 0 });
          return send(res, 200, { ok: true });
        } catch (_) { return send(res, 400, { error: "bad request" }); }
      }

      if (req.method === "DELETE") {
        store.delRecord(email, id);
        return send(res, 200, { ok: true });
      }

      return send(res, 405, { error: "method not allowed" });
    }

    return send(res, 404, { error: "not found" });
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8181;
  const dataDir = process.env.DATA_DIR || "data";
  http.createServer(createApp({ dataDir })).listen(port, () => {
    console.log("mio-sync-server on :" + port);
  });
}

module.exports = { createApp };
