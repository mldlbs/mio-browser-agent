async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  return tab;
}

async function getActiveTabId() {
  return (await getActiveTab()).id;
}

const CONTENT_FILES = [
  "common/protocol.js",
  "content/snapshot.js",
  "content/locator.js",
  "content/executor.js",
  "content/main.js",
];

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
}

async function sendToTab(type, payload, frameId) {
  const tab = await getActiveTab();
  const tabId = tab.id;
  const describe = () => `当前页面: ${tab.url || "(无法获取 URL)"}`;
  const opts = frameId != null ? { frameId } : {};
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, make(type, payload), opts);
  } catch (e) {
    try {
      await ensureContentScript(tabId);
      res = await chrome.tabs.sendMessage(tabId, make(type, payload), opts);
    } catch (e2) {
      throw new Error(`无法与页面通信，请刷新当前页面后重试 (${describe()} / ${e2 && e2.message || e.message})`);
    }
  }
  return res;
}

// Enumerate every frame (including cross-origin iframes) of the active tab.
async function listFrames() {
  const tab = await getActiveTab();
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
  return frames || [];
}

function createPageBridge() {
  return {
    async snapshot() {
      const frames = await listFrames();
      const main = frames.find((f) => f.frameId === 0);
      const mainTab = await getActiveTab();
      const res = await sendToTab(MSG.SNAPSHOT_REQUEST, { taskId: Date.now(), frameOnly: true });
      if (!res || res.type !== MSG.SNAPSHOT_RESPONSE) throw new Error("bad snapshot response");
      const tabs = await chrome.tabs.query({ windowId: mainTab.windowId });
      const tabIndex = tabs.findIndex((t) => t.active && t.windowId === mainTab.windowId);
      const merged = {
        url: (main && main.url) || mainTab.url || "",
        title: res.payload.snapshot.title,
        timestamp: Date.now(),
        tabs: tabs.map((t) => ({ index: t.index, title: t.title || "", url: t.url || "", active: !!t.active })),
        tabIndex: tabIndex >= 0 ? tabIndex : mainTab.index,
        tabCount: tabs.length,
        tabActiveTitle: mainTab.title || "",
        elements: [],
      };
      // frameOnly snapshot already covers the main document; reindex with frameId 0.
      merged.elements = res.payload.snapshot.elements.map((e, i) => ({ ...e, index: i, frameId: 0 }));
      // Collect each sub-frame (same- or cross-origin) independently.
      for (const f of frames) {
        if (f.frameId === 0) continue;
        let fres;
        try {
          fres = await sendToTab(MSG.SNAPSHOT_REQUEST, { taskId: Date.now(), frameOnly: true }, f.frameId);
        } catch (_) { continue; } // frame may have navigated away; skip it
        if (!fres || fres.type !== MSG.SNAPSHOT_RESPONSE) continue;
        const elems = fres.payload.snapshot.elements || [];
        elems.forEach((e) => {
          e.index = merged.elements.length;
          e.frameId = f.frameId;
          e.framePath = [];
          merged.elements.push(e);
        });
      }
      return merged;
    },
    async executeAction(action) {
      const target = action.target || {};
      const frameId = target.frameId;
      const res = await sendToTab(MSG.ACTION_EXECUTE, { taskId: Date.now(), action }, frameId);
      if (!res || res.type !== MSG.ACTION_RESULT) throw new Error("bad action response");
      return res.payload.result;
    },
    // Screenshot the active tab as a base64 data URL (for vision-based recovery).
    async capture() {
      const tab = await getActiveTab();
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        return dataUrl || null;
      } catch (_) {
        return null; // requires "activeTab" or host permission; caller degrades gracefully
      }
    },
    // Read the exact bitmap of a captcha canvas/img as a PNG data URL (much
    // crisper than a full-page screenshot for small verification codes).
    async captureCanvas(target) {
      const frameId = target && target.frameId;
      const res = await sendToTab(MSG.CANVAS_READ_REQUEST, { taskId: Date.now(), target: target || null }, frameId);
      if (!res || res.type !== MSG.CANVAS_READ_RESPONSE) return null;
      const result = res.payload && res.payload.result;
      return result && result.ok ? result.value : null;
    },
    // ── tab management (browser-level, no content script needed) ──
    async tabList() {
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({ index: t.index, id: t.id, title: t.title || "", url: t.url || "", active: !!t.active }));
    },
    async tabNew(url) {
      const tab = await chrome.tabs.create({ url, active: true });
      return { id: tab.id, index: tab.index, url: tab.url || url };
    },
    async tabSwitch(indexOrId) {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((t) => t.index === indexOrId || t.id === indexOrId);
      if (!target) return { ok: false, error: `no tab at index/id ${indexOrId}` };
      await chrome.tabs.update(target.id, { active: true });
      await chrome.windows.update(target.windowId, { focused: true });
      return { ok: true, title: target.title, url: target.url };
    },
    async tabClose(indexOrId) {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((t) => t.index === indexOrId || t.id === indexOrId);
      if (!target) return { ok: false, error: `no tab at index/id ${indexOrId}` };
      await chrome.tabs.remove(target.id);
      return { ok: true, closed: target.title };
    },
  };
}
