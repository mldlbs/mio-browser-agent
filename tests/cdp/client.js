"use strict";
// Zero-dependency CDP client using Node 22 native WebSocket.
// Wraps a browser-level (or target-level) WebSocket with a promise-based send().

const REQUEST_TIMEOUT_MS = 15000;

function connect(wsUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
    let nextId = 0;
    const pending = new Map();
    const eventHandlers = new Map();

    function failAllPending(err) {
      for (const { rej, timer } of pending.values()) {
        clearTimeout(timer);
        rej(err);
      }
      pending.clear();
    }

    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}, sessionId = null) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error("CDP timeout: " + method));
            }, timeoutMs);
            pending.set(id, { res, rej, timer });
            const msg = { id, method, params };
            if (sessionId) msg.sessionId = sessionId;
            ws.send(JSON.stringify(msg));
          });
        },
        on(method, cb) {
          let list = eventHandlers.get(method);
          if (!list) { list = new Set(); eventHandlers.set(method, list); }
          list.add(cb);
          return () => list.delete(cb);
        },
        close() { ws.close(); },
      });
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method && eventHandlers.has(msg.method)) {
        eventHandlers.get(msg.method).forEach((cb) => {
          try { cb(msg.params, msg.sessionId); } catch (_) {}
        });
      }
    });
    ws.addEventListener("error", (e) => reject(new Error("CDP socket error: " + e.message)));
    ws.addEventListener("close", () => failAllPending(new Error("CDP socket closed")));
  });
}

async function getBrowserWsUrl(port, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      const json = await resp.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`CDP endpoint on port ${port} not reachable`);
}

module.exports = { connect, getBrowserWsUrl };
