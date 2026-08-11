const assert = require("assert");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

process.env.SYNC_KEK = crypto.randomBytes(32).toString("hex");

const { createApp } = require("../server/index.js");

const dataDir = path.join(os.tmpdir(), "mio-sync-test-" + Date.now());

function req(port, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function run() {
  const server = http.createServer(createApp({ dataDir }));
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;

  // health check (no auth)
  let r = await req(port, "GET", "/v1/health");
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);

  // register
  r = await req(port, "POST", "/v1/auth/register", { "Content-Type": "application/json" }, JSON.stringify({ email: "a@test.com", password: "pw123456" }));
  assert.strictEqual(r.status, 200, "register ok");
  assert.ok(r.body.token, "register returns token");
  assert.strictEqual(r.body.email, "a@test.com");
  const tokenA = r.body.token;

  // duplicate register -> 409
  r = await req(port, "POST", "/v1/auth/register", { "Content-Type": "application/json" }, JSON.stringify({ email: "a@test.com", password: "pw123456" }));
  assert.strictEqual(r.status, 409, "duplicate register -> 409");

  // login wrong password -> 401
  r = await req(port, "POST", "/v1/auth/login", { "Content-Type": "application/json" }, JSON.stringify({ email: "a@test.com", password: "wrong" }));
  assert.strictEqual(r.status, 401, "wrong password -> 401");

  // login success
  r = await req(port, "POST", "/v1/auth/login", { "Content-Type": "application/json" }, JSON.stringify({ email: "a@test.com", password: "pw123456" }));
  assert.strictEqual(r.status, 200, "login ok");
  assert.ok(r.body.token, "login returns token");

  // /v1/auth/me with Bearer token
  r = await req(port, "GET", "/v1/auth/me", { "Authorization": "Bearer " + tokenA });
  assert.strictEqual(r.status, 200, "me ok");
  assert.strictEqual(r.body.email, "a@test.com");

  // PUT /v1/records/:id with Bearer token
  r = await req(port, "PUT", "/v1/records/r1", { "Authorization": "Bearer " + tokenA, "Content-Type": "application/json" }, JSON.stringify({ foo: "bar", n: 42 }));
  assert.strictEqual(r.status, 200, "PUT ok");

  // GET /v1/records with Bearer token -> user's records only
  r = await req(port, "GET", "/v1/records", { "Authorization": "Bearer " + tokenA });
  assert.strictEqual(r.status, 200, "GET records ok");
  assert.ok(Array.isArray(r.body.records), "records is array");
  assert.strictEqual(r.body.records.length, 1);
  assert.strictEqual(r.body.records[0].foo, "bar");
  assert.strictEqual(r.body.records[0].n, 42);

  // User isolation: user B cannot see user A's records
  r = await req(port, "POST", "/v1/auth/register", { "Content-Type": "application/json" }, JSON.stringify({ email: "b@test.com", password: "pw654321" }));
  assert.strictEqual(r.status, 200, "register B ok");
  const tokenB = r.body.token;

  r = await req(port, "GET", "/v1/records", { "Authorization": "Bearer " + tokenB });
  assert.strictEqual(r.status, 200, "B GET ok");
  assert.strictEqual(r.body.records.length, 0, "B sees no records");

  // Logout -> token revoked -> 401 on subsequent use
  r = await req(port, "POST", "/v1/auth/logout", { "Authorization": "Bearer " + tokenA });
  assert.strictEqual(r.status, 200, "logout ok");

  r = await req(port, "GET", "/v1/auth/me", { "Authorization": "Bearer " + tokenA });
  assert.strictEqual(r.status, 401, "after logout -> 401");

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("server tests passed");
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
