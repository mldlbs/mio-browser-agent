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

async function sendToTab(type, payload) {
  const tab = await getActiveTab();
  const tabId = tab.id;
  const describe = () => `当前页面: ${tab.url || "(无法获取 URL)"}`;
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, make(type, payload));
  } catch (e) {
    try {
      await ensureContentScript(tabId);
      res = await chrome.tabs.sendMessage(tabId, make(type, payload));
    } catch (e2) {
      throw new Error(`无法与页面通信，请刷新当前页面后重试 (${describe()} / ${e2 && e2.message || e.message})`);
    }
  }
  return res;
}

function createPageBridge() {
  return {
    async snapshot() {
      const res = await sendToTab(MSG.SNAPSHOT_REQUEST, { taskId: Date.now() });
      if (!res || res.type !== MSG.SNAPSHOT_RESPONSE) throw new Error("bad snapshot response");
      return res.payload.snapshot;
    },
    async executeAction(action) {
      const res = await sendToTab(MSG.ACTION_EXECUTE, { taskId: Date.now(), action });
      if (!res || res.type !== MSG.ACTION_RESULT) throw new Error("bad action response");
      return res.payload.result;
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
