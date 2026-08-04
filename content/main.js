window.__mioContentLoaded = (window.__mioContentLoaded || 0) + 1;
try { if (document.documentElement) document.documentElement.setAttribute("data-mio-content", "1"); } catch (e) {}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.type) return;
  const payload = request.payload || {};
  try {
    switch (request.type) {
      case MSG.SNAPSHOT_REQUEST:
        sendResponse({ type: MSG.SNAPSHOT_RESPONSE, payload: { taskId: payload.taskId, snapshot: captureSnapshot() } });
        return;
      case MSG.ACTION_EXECUTE: {
        const result = executeAction(payload.action);
        if (result && typeof result.then === "function") {
          result.then((r) => sendResponse({ type: MSG.ACTION_RESULT, payload: { taskId: payload.taskId, action: payload.action, result: r } }));
          return true; // keep the message channel open for async results
        }
        sendResponse({ type: MSG.ACTION_RESULT, payload: { taskId: payload.taskId, action: payload.action, result } });
        return;
      }
    }
  } catch (e) {
    sendResponse({ type: MSG.ACTION_RESULT, payload: { taskId: payload.taskId, action: payload.action, result: { ok: false, error: String((e && e.message) || e) } } });
  }
});
