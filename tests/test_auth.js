const SESSION_KEY = "mioSession";

function makeMockStorage() {
  const store = {};
  return {
    get: async (key) => ({ [key]: store[key] }),
    set: async (obj) => { Object.assign(store, obj); },
    remove: async (key) => { delete store[key]; },
    _store: store,
  };
}

async function run() {
  let pass = 0, fail = 0;
  function assertOk(cond, msg) { if (cond) pass++; else { fail++; console.error("FAIL " + msg); } }
  function assertEq(got, want, msg) { if (got === want) pass++; else { fail++; console.error("FAIL " + msg + " got=" + got + " want=" + want); } }

  const storage = makeMockStorage();
  global.chrome = { storage: { local: storage } };

  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts && opts.method, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    if (url.includes("/register")) return { ok: true, status: 200, json: async () => ({ token: "reg-token-123", email: "a@b.com" }) };
    if (url.includes("/login")) return { ok: true, status: 200, json: async () => ({ token: "login-token-456", email: "a@b.com" }) };
    if (url.includes("/logout")) return { ok: true, status: 204, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const auth = require("../common/auth-client.js");

  // Test: register -> stores session, isLoggedIn true
  calls.length = 0;
  const regResult = await auth.register("a@b.com", "pass123", "https://srv.com");
  assertEq(regResult.token, "reg-token-123", "register returns token");
  assertOk(storage._store[SESSION_KEY], "register stores session in chrome.storage.local");
  assertEq(storage._store[SESSION_KEY].token, "reg-token-123", "stored session has token");
  assertEq(storage._store[SESSION_KEY].email, "a@b.com", "stored session has email");
  assertOk(await auth.isLoggedIn(), "isLoggedIn true after register");
  assertOk(calls.some(c => c.url.includes("/v1/auth/register")), "register calls /v1/auth/register");

  // Test: login -> stores session
  calls.length = 0;
  await auth.clearSession();
  assertOk(!(await auth.isLoggedIn()), "isLoggedIn false after clearSession");
  const loginResult = await auth.login("a@b.com", "pass123", "https://srv.com");
  assertEq(loginResult.token, "login-token-456", "login returns token");
  assertEq(storage._store[SESSION_KEY].token, "login-token-456", "stored session has login token");
  assertOk(await auth.isLoggedIn(), "isLoggedIn true after login");
  assertOk(calls.some(c => c.url.includes("/v1/auth/login")), "login calls /v1/auth/login");

  // Test: logout -> clears session, isLoggedIn false
  calls.length = 0;
  await auth.logout("https://srv.com");
  assertOk(!(await auth.isLoggedIn()), "isLoggedIn false after logout");
  assertOk(!storage._store[SESSION_KEY], "session cleared from storage after logout");
  assertOk(calls.some(c => c.url.includes("/v1/auth/logout")), "logout calls /v1/auth/logout");

  // Test: getSession returns {token, email}
  await auth.clearSession();
  assertOk((await auth.getSession()) === null, "getSession returns null when no session");
  await auth.login("a@b.com", "pass123", "https://srv.com");
  const session = await auth.getSession();
  assertEq(session.token, "login-token-456", "getSession returns token");
  assertEq(session.email, "a@b.com", "getSession returns email");

  // Test: register throws on !ok with .status
  global.fetch = async (url, opts) => ({ ok: false, status: 409, json: async () => ({ error: "exists" }) });
  let threw = false;
  let errStatus = null;
  try { await auth.register("a@b.com", "pass123", "https://srv.com"); } catch (e) { threw = true; errStatus = e.status; }
  assertOk(threw, "register throws on !ok");
  assertEq(errStatus, 409, "thrown error has status 409");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
