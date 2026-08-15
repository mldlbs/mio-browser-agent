async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  return tab;
}

async function getActiveTabId() {
  return (await getActiveTab()).id;
}

// Resolve the target tab for a bridge: a pinned tabId (scheduled tasks run on a
// specific tab even when it is not active) or the active tab otherwise.
async function resolveTargetTab(tabId) {
  if (tabId != null) return chrome.tabs.get(tabId);
  return getActiveTab();
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

async function sendToTab(type, payload, frameId, tabId) {
  const tab = await resolveTargetTab(tabId);
  const describe = () => `当前页面: ${tab.url || "(无法获取 URL)"}`;
  const opts = frameId != null ? { frameId } : {};
  const tabIdFor = tab.id;
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabIdFor, make(type, payload), opts);
  } catch (e) {
    try {
      await ensureContentScript(tabIdFor);
      res = await chrome.tabs.sendMessage(tabIdFor, make(type, payload), opts);
    } catch (e2) {
      throw new Error(`无法与页面通信，请刷新当前页面后重试 (${describe()} / ${e2 && e2.message || e.message})`);
    }
  }
  return res;
}

function createPageBridge({ tabId } = {}) {
  return {
    // Lightweight main-frame-only snapshot for UI hints (task suggestions).
    // Much faster than the full multi-frame snapshot; element indexes are
    // NOT meant for action targeting (use snapshot() for that).
    async snapshotPeek() {
      const mainTab = await resolveTargetTab(tabId);
      const res = await sendToTab(MSG.SNAPSHOT_REQUEST, { taskId: Date.now(), frameOnly: true }, null, mainTab.id);
      if (!res || res.type !== MSG.SNAPSHOT_RESPONSE) throw new Error("bad snapshot response");
      const snap = res.payload.snapshot || {};
      return {
        url: mainTab.url || snap.url || "",
        title: snap.title || mainTab.title || "",
        elements: (snap.elements || []).map((e) => ({
          role: e.role, name: e.name, inputType: e.inputType || "",
          placeholder: e.placeholder || "", value: e.value || "",
          tag: e.tag || "", href: e.href || "", text: e.text || "",
        })),
      };
    },
    async snapshot() {
      const mainTab = await resolveTargetTab(tabId);
      const frames = await chrome.webNavigation.getAllFrames({ tabId: mainTab.id });
      const main = frames.find((f) => f.frameId === 0);
      const res = await sendToTab(MSG.SNAPSHOT_REQUEST, { taskId: Date.now(), frameOnly: true }, null, mainTab.id);
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
          fres = await sendToTab(MSG.SNAPSHOT_REQUEST, { taskId: Date.now(), frameOnly: true }, f.frameId, mainTab.id);
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
      const mainTab = await resolveTargetTab(tabId);
      const res = await sendToTab(MSG.ACTION_EXECUTE, { taskId: Date.now(), action }, frameId, mainTab.id);
      if (!res || res.type !== MSG.ACTION_RESULT) throw new Error("bad action response");
      return res.payload.result;
    },
    // Screenshot the target tab as a base64 data URL (for vision-based recovery).
    async capture() {
      const tab = await resolveTargetTab(tabId);
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        return dataUrl || null;
      } catch (e) {
        // captureVisibleTab fails for data:/chrome:///extension pages and when
        // activeTab was never granted. Surface WHY so the agent can react
        // (e.g. navigate to a real page) instead of retrying blindly.
        const msg = (e && e.message) || String(e);
        const tabUrl = (tab && tab.url) || "";
        if (/data:|chrome:\/\/|^extension/i.test(tabUrl)) {
          throw new Error("当前页面无法截图（浏览器限制 data:/chrome:// 页面）：" + tabUrl.slice(0, 80));
        }
        throw new Error("截图失败: " + msg.slice(0, 120));
      }
    },
    // Navigate at the BROWSER level (chrome.tabs.update) so it works even when
    // the current page's content script is unavailable (e.g. chrome://new-tab,
    // view-source, PDF viewer). Returns once the update is issued; the caller
    // waits for the new page's content script to become ready.
    async navigate(url) {
      const tab = await resolveTargetTab(tabId);
      await chrome.tabs.update(tab.id, { url });
      return { ok: true, value: `navigating to ${url}`, pendingNavigation: true };
    },
    // Read the exact bitmap of a captcha canvas/img as a PNG data URL (much
    // crisper than a full-page screenshot for small verification codes).
    async captureCanvas(target) {
      const frameId = target && target.frameId;
      const mainTab = await resolveTargetTab(tabId);
      const res = await sendToTab(MSG.CANVAS_READ_REQUEST, { taskId: Date.now(), target: target || null }, frameId, mainTab.id);
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
