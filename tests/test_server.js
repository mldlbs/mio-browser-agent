const assert = require("assert");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { createApp } = require("../server/index.js");

const dataDir = path.join(os.tmpdir(), "mio-sync-test-" + Date.now());

function req(port, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function run() {
  process.env.SYNC_API_KEY = "s3cret";
  const server = http.createServer(createApp({ dataDir }));
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;

  let r = await req(port, "GET", "/v1/health");
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.includes("ok"));

  r = await req(port, "GET", "/v1/records");
  assert.strictEqual(r.status, 401, "no key -> 401");

  r = await req(port, "GET", "/v1/records", { "X-Api-Key": "wrong" });
  assert.strictEqual(r.status, 401, "wrong key -> 401");

  const body = JSON.stringify({ updatedAt: 100, ciphertext: "ct", iv: "iv" });
  r = await req(port, "PUT", "/v1/records/a1", { "X-Api-Key": "s3cret", "Content-Type": "application/json" }, body);
  assert.strictEqual(r.status, 200, "PUT ok");
  r = await req(port, "GET", "/v1/records", { "X-Api-Key": "s3cret" });
  assert.strictEqual(r.status, 200, "GET ok");
  assert.ok(r.data.includes("a1"), "record returned");

  r = await req(port, "DELETE", "/v1/records/a1", { "X-Api-Key": "s3cret" });
  assert.strictEqual(r.status, 200, "DELETE ok");
  r = await req(port, "GET", "/v1/records", { "X-Api-Key": "s3cret" });
  assert.ok(!r.data.includes("a1"), "deleted");

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log("server tests passed");
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
