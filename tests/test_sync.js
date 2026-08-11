const sync = require("../common/sync-client.js");

async function run() {
  let pass = 0, fail = 0;
  function assertEq(got, want, msg) {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
    else { fail++; console.error("FAIL " + msg + " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  }
  function assertOk(cond, msg) { if (cond) pass++; else { fail++; console.error("FAIL " + msg); } }

  // URL
  assertEq(sync.apiUrl("https://x.com", "records"), "https://x.com/v1/records", "apiUrl join");
  assertEq(sync.apiUrl("https://x.com/", "records/a1"), "https://x.com/v1/records/a1", "apiUrl strip trailing slash");

  // sanitizeRecord
  const recWithResume = { id: "r9", goal: "t", status: "done", finishedAt: 9, logs: [], resume: { goal: "t", plan: [], nextStepIndex: 1, lastSummary: "s", notes: ["secret"] } };
  const sanitized = sync.sanitizeRecord(recWithResume);
  assertOk(!("resume" in sanitized), "sanitizeRecord strips resume");
  assertEq(sanitized.goal, "t", "sanitizeRecord keeps goal");
  assertOk("resume" in recWithResume, "sanitizeRecord does not mutate input");

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

  // syncHistory mock
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts && opts.method || "GET", auth: opts && opts.headers && opts.headers["Authorization"], body: opts && opts.body });
    if (opts && opts.method === "PUT") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => [{ id: "r1", goal: "new", finishedAt: 5000 }] };
  };
  const local = [
    { id: "r1", goal: "old", finishedAt: 1000 },
    { id: "r2", goal: "newlocal", finishedAt: 2000, resume: { goal: "newlocal", plan: [], nextStepIndex: 1, lastSummary: "s", notes: ["secret"] } },
  ];
  const res = await sync.syncHistory("https://srv", "my-token", local);
  assertOk(calls.some((c) => c.method === "GET"), "syncHistory lists remote");
  const puts = calls.filter((c) => c.method === "PUT");
  assertOk(puts.length >= 1, "syncHistory pushes missing local");
  assertOk(puts.every((c) => c.auth === "Bearer my-token"), "PUT carries Bearer token");
  assertOk(res.pulled >= 1, "pull reported");
  assertOk(calls.some((c) => c.method === "PUT" && c.url.endsWith("/v1/records/r2")), "PUT goes to encoded record URL");
  assertOk(calls.some((c) => c.method === "PUT" && c.body && JSON.parse(c.body).finishedAt === 2000), "PUT carries record fields");
  {
    const r2put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/v1/records/r2"));
    const body = JSON.parse(r2put.body);
    assertOk(!("resume" in body), "syncHistory upload excludes resume");
    assertEq(body.goal, "newlocal", "syncHistory upload keeps goal");
  }
  delete global.fetch;

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
