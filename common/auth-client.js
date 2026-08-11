const SESSION_KEY = "mioSession";

function apiUrl(serverUrl, path) {
  return serverUrl.replace(/\/+$/, "") + "/v1/auth/" + path;
}

async function register(email, password, serverUrl) {
  const resp = await fetch(apiUrl(serverUrl, "register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const err = new Error("HTTP " + resp.status);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const session = { token: data.token, email: data.email, serverUrl };
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

async function login(email, password, serverUrl) {
  const resp = await fetch(apiUrl(serverUrl, "login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const err = new Error("HTTP " + resp.status);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const session = { token: data.token, email: data.email, serverUrl };
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

async function logout(serverUrl) {
  try {
    await fetch(apiUrl(serverUrl, "logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (_) {}
  await chrome.storage.local.remove(SESSION_KEY);
}

async function isLoggedIn() {
  const raw = await chrome.storage.local.get(SESSION_KEY);
  return !!(raw && raw[SESSION_KEY] && raw[SESSION_KEY].token);
}

async function getSession() {
  const raw = await chrome.storage.local.get(SESSION_KEY);
  return raw && raw[SESSION_KEY] ? raw[SESSION_KEY] : null;
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

if (typeof module !== "undefined") {
  module.exports = { SESSION_KEY, register, login, logout, isLoggedIn, getSession, clearSession };
} else {
  globalThis.AuthClient = { SESSION_KEY, register, login, logout, isLoggedIn, getSession, clearSession };
}
