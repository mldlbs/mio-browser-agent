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

  // mergeRecords: local-only
  {
    const res = sync.mergeRecords([{ id: "l1", finishedAt: 100 }], []);
    assertEq(res.toPush.map((r) => r.id), ["l1"], "local-only pushed to toPush");
    assertEq(res.pulled, [], "local-only no pulled");
    assertOk(res.merged.some((r) => r.id === "l1"), "local-only in merged");
  }

  // mergeRecords: remote-only
  {
    const res = sync.mergeRecords([], [{ id: "r1", finishedAt: 100 }]);
    assertEq(res.pulled.map((r) => r.id), ["r1"], "remote-only pulled");
    assertEq(res.toPush, [], "remote-only no toPush");
    assertOk(res.merged.some((r) => r.id === "r1"), "remote-only in merged");
  }

  // mergeRecords: remote-newer
  {
    const res = sync.mergeRecords([{ id: "x", finishedAt: 100 }], [{ id: "x", finishedAt: 200 }]);
    assertOk(res.pulled.some((r) => r.id === "x"), "remote-newer pulled");
    assertOk(!res.toPush.some((r) => r.id === "x"), "remote-newer NOT in toPush");
    assertEq(res.merged.find((r) => r.id === "x").finishedAt, 200, "remote-newer merged uses remote");
  }

  // mergeRecords: local-newer
  {
    const res = sync.mergeRecords([{ id: "x", finishedAt: 200 }], [{ id: "x", finishedAt: 100 }]);
    assertOk(res.toPush.some((r) => r.id === "x"), "local-newer pushed");
    assertOk(!res.pulled.some((r) => r.id === "x"), "local-newer NOT in pulled");
    assertEq(res.merged.find((r) => r.id === "x").finishedAt, 200, "local-newer merged uses local");
  }

  // mergeRecords: equal timestamps
  {
    const res = sync.mergeRecords([{ id: "x", finishedAt: 100 }], [{ id: "x", finishedAt: 100 }]);
    assertOk(!res.pulled.some((r) => r.id === "x"), "equal timestamps NOT in pulled");
    assertOk(!res.toPush.some((r) => r.id === "x"), "equal timestamps NOT in toPush");
    assertOk(res.merged.some((r) => r.id === "x" && r.finishedAt === 100), "equal timestamps merged keeps value");
  }

  // tampered ciphertext fails AES-GCM auth
  {
    let threw = false;
    try { await sync.decryptRecord({ id: "t1", updatedAt: 1000, ciphertext: "tampered", iv: bundle.iv }, k1); } catch (_) { threw = true; }
    assertOk(threw, "tampered ciphertext fails decrypt");
  }

  // syncHistory 编排（mock fetch）
  const historyKey = await sync.deriveKey("k");
  const remoteBundle = await sync.encryptRecord({ id: "r1", goal: "新", finishedAt: 5000 }, historyKey);
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts && opts.method || "GET", key: opts && opts.headers && opts.headers["X-Api-Key"], body: opts && opts.body });
    if (opts && opts.method === "PUT") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => [remoteBundle] };
  };
  const local = [
    { id: "r1", goal: "旧", finishedAt: 1000 },
    { id: "r2", goal: "新本地", finishedAt: 2000 },
  ];
  const res = await sync.syncHistory("https://srv", "k", local);
  assertOk(calls.some((c) => c.method === "GET"), "syncHistory lists remote");
  const puts = calls.filter((c) => c.method === "PUT");
  assertOk(puts.length >= 1, "syncHistory pushes missing local");
  assertOk(puts.every((c) => c.key === "k"), "PUT carries api key");
  assertOk(res.pulled >= 1, "pull reported");
  assertOk(calls.some((c) => c.method === "PUT" && c.url.endsWith("/v1/records/r2")), "PUT goes to encoded record URL");
  assertOk(calls.some((c) => c.method === "PUT" && c.body && JSON.parse(c.body).iv), "PUT carries ciphertext bundle (iv present)");
  assertOk(calls.some((c) => c.method === "PUT" && c.body && JSON.parse(c.body).updatedAt === 2000), "PUT carries updatedAt from local record");
  delete global.fetch;

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });