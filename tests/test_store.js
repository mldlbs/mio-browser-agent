const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { createStore } = require("../server/store.js");

const dataDir = path.join(os.tmpdir(), "store-test-" + Date.now());

function cleanup() {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function testUsers() {
  const store = createStore(dataDir);
  assert.ok(!store.hasUser("alice@example.com"), "hasUser false for missing");
  store.putUser("alice@example.com", { name: "Alice" });
  assert.ok(store.hasUser("alice@example.com"), "hasUser true after put");
  const u = store.getUser("alice@example.com");
  assert.strictEqual(u.name, "Alice", "getUser returns stored data");
  console.log("  users: OK");
}

function testTokens() {
  const store = createStore(dataDir);
  store.putUser("bob@example.com", { name: "Bob" });
  const token = store.putToken("bob@example.com");
  assert.strictEqual(typeof token, "string", "token is string");
  assert.strictEqual(token.length, 64, "token is 32-byte hex (64 chars)");
  const user = store.getTokenUser(token);
  assert.strictEqual(user.email, "bob@example.com", "getTokenUser returns email");
  store.revokeToken(token);
  assert.strictEqual(store.getTokenUser(token), null, "getTokenUser null after revoke");
  console.log("  tokens: OK");
}

function testRecords() {
  const store = createStore(dataDir);
  store.putUser("carol@example.com", { name: "Carol" });
  store.putUser("dave@example.com", { name: "Dave" });

  store.putRecord("carol@example.com", "r1", { ciphertext: "c1", iv: "i1" });
  store.putRecord("carol@example.com", "r2", { ciphertext: "c2", iv: "i2" });
  store.putRecord("dave@example.com", "r1", { ciphertext: "dc1", iv: "di1" });

  const rec = store.getRecord("carol@example.com", "r1");
  assert.strictEqual(rec.ciphertext, "c1", "getRecord returns correct record");

  const carolRecords = store.listRecords("carol@example.com");
  assert.strictEqual(carolRecords.length, 2, "carol has 2 records");

  const daveRecords = store.listRecords("dave@example.com");
  assert.strictEqual(daveRecords.length, 1, "dave has 1 record");
  assert.strictEqual(daveRecords[0].ciphertext, "dc1", "dave's record isolated");

  store.delRecord("carol@example.com", "r1");
  assert.strictEqual(store.getRecord("carol@example.com", "r1"), null, "delRecord removes");
  assert.strictEqual(store.listRecords("carol@example.com").length, 1, "1 record left after del");

  console.log("  records: OK");
}

function testPersistence() {
  const dir = path.join(os.tmpdir(), "store-persist-" + Date.now());
  const store1 = createStore(dir);
  store1.putUser("eve@example.com", { name: "Eve" });
  store1.putRecord("eve@example.com", "x", { ciphertext: "cx", iv: "ix" });
  store1.save();

  const store2 = createStore(dir);
  assert.ok(store2.hasUser("eve@example.com"), "user persists across instances");
  const rec = store2.getRecord("eve@example.com", "x");
  assert.strictEqual(rec.ciphertext, "cx", "record persists across instances");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("  persistence: OK");
}

try {
  console.log("Running store tests...");
  testUsers();
  testTokens();
  testRecords();
  testPersistence();
  cleanup();
  console.log("All store tests passed");
  process.exit(0);
} catch (e) {
  cleanup();
  console.error("FAIL:", e.message);
  process.exit(1);
}
