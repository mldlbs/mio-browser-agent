const sync = require("../common/sync-client.js");

async function run() {
  let pass = 0, fail = 0;
  function assertEq(got, want, msg) {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
    else { fail++; console.error("FAIL " + msg + " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  }
  function assertOk(cond, msg) { if (cond) pass++; else { fail++; console.error("FAIL " + msg); } }

  // deriveKey 幂等
  const k1 = await sync.deriveKey("test-key");
  const k2 = await sync.deriveKey("test-key");
  assertEq(k1, k2, "deriveKey deterministic");

  // 加密往返
  const rec = { id: "a1", goal: "任务", status: "done", finishedAt: 1000, logs: [] };
  const bundle = await sync.encryptRecord(rec, k1);
  assertOk(bundle.ciphertext && bundle.iv, "encryptRecord produces ciphertext+iv");
  assertEq(bundle.id, "a1", "bundle carries id");
  assertEq(bundle.updatedAt, 1000, "updatedAt = finishedAt");
  const back = await sync.decryptRecord(bundle, k1);
  assertEq(back.goal, "任务", "roundtrip goal");

  // 错误 key 解不开
  const k3 = await sync.deriveKey("other-key");
  let threw = false;
  try { await sync.decryptRecord(bundle, k3); } catch (_) { threw = true; }
  assertOk(threw, "wrong key fails decrypt");

  // URL 拼装
  assertEq(sync.apiUrl("https://x.com", "records"), "https://x.com/v1/records", "apiUrl join");
  assertEq(sync.apiUrl("https://x.com/", "records/a1"), "https://x.com/v1/records/a1", "apiUrl strip trailing slash");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });