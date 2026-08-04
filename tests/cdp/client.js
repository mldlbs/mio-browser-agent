"use strict";
// Zero-dependency CDP client using Node 22 native WebSocket.
// Wraps a browser-level (or target-level) WebSocket with a promise-based send().

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}, sessionId = null) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            const msg = { id, method, params };
            if (sessionId) msg.sessionId = sessionId;
            ws.send(JSON.stringify(msg));
          });
        },
        close() { ws.close(); },
      });
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error("CDP socket error: " + e.message)));
  });
}

async function getBrowserWsUrl(port, tries = 50) {
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