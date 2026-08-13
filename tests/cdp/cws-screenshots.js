"use strict";
// Generate Chrome Web Store listing screenshots by rendering the real
// sidepanel.html in headless Chrome with an injected chrome.* mock.
// Usage: node tests/cdp/cws-screenshots.js [outDir] [--headful]
const path = require("path");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./launch");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.resolve(process.argv[2] || "D:\\Users\\gf1913\\Temp\\opencode\\cws-assets");
const HEADFUL = process.argv.includes("--headful");

const SIDEPANEL = pathToFileURL(path.join(ROOT, "sidepanel", "sidepanel.html")).href;

// chrome.* mock injected before sidepanel scripts run. Uses a page whose
// snapshot looks like a search-result page so the "本页可做" panel has content.
// chrome.* mock injected before sidepanel scripts run. Uses a page whose
// snapshot looks like a search-result page so the "本页可做" panel has content.
// NOTE: keep this PURE (no DOM access) — it runs at document-start where
// documentElement may not exist yet. Font inflation happens in setup scripts.
const CHROME_MOCK = `
(() => {
  const store = {
    agentSettings: {
      provider: "openai", model: "gpt-4o-mini",
      baseURL: "https://api.openai.com/v1", apiKey: "sk-••••••••••••••••",
      maxSteps: 30, enableVision: true,
      vision: { provider: "openai", model: "glm-4v-flash", baseURL: "https://open.bigmodel.cn/api/paas/v4", apiKey: "sk-••••••" },
      sync: { enabled: false, serverUrl: "", lastSyncAt: 0 },
    },
    mioCustomTemplates: [],
    mioTaskHistory: [],
    mioSession: null,
  };
  const FAKE_SNAPSHOT = {
    type: "SNAPSHOT_RESPONSE",
    payload: { snapshot: {
      title: "搜索结果 · 示例商店",
      elements: [
        { role: "textbox", name: "搜索", inputType: "text", placeholder: "输入商品名称", value: "", tag: "input", href: "", text: "" },
        { role: "button", name: "搜索", inputType: "", placeholder: "", value: "", tag: "button", href: "", text: "搜索" },
        { role: "link", name: "无线耳机 Pro", inputType: "", placeholder: "", value: "", tag: "a", href: "https://example.com/earbuds", text: "无线耳机 Pro  ¥299" },
        { role: "link", name: "机械键盘 87", inputType: "", placeholder: "", value: "", tag: "a", href: "https://example.com/kb87", text: "机械键盘 87  ¥459" },
        { role: "link", name: "显示器 27寸 4K", inputType: "", placeholder: "", value: "", tag: "a", href: "https://example.com/monitor", text: "显示器 27寸 4K  ¥1899" },
        { role: "link", name: "下一页", inputType: "", placeholder: "", value: "", tag: "a", href: "https://example.com/search?p=2", text: "下一页" },
        { role: "table", name: "", inputType: "", placeholder: "", value: "", tag: "table", href: "", text: "" },
      ],
    } },
  };
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "0.1.46" }) },
    storage: {
      local: {
        async get(key) { return { [key]: store[key] }; },
        async set(obj) { Object.assign(store, obj); },
        async remove(key) { delete store[key]; },
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://example.com/search?q=keyboard", title: "搜索结果 · 示例商店", index: 0, windowId: 1, active: true }],
      sendMessage: async () => FAKE_SNAPSHOT,
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    webNavigation: { getAllFrames: async () => [{ frameId: 0 }] },
    sidePanel: { close() {} },
    windows: { WINDOW_ID_CURRENT: -1, update() {} },
    scripting: {},
    action: {},
  };
})();`;

async function openSidepanel(browser) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: CHROME_MOCK }, sessionId);
  await browser.send("Page.navigate", { url: SIDEPANEL }, sessionId);
  await browser.send("Page.loadEventFired", {}, sessionId).catch(() => {});
  // wait for init() + renderSuggestions() async work
  for (let i = 0; i < 50; i++) {
    const { result } = await browser.send("Runtime.evaluate", {
      expression: "document.getElementById('suggestPanel') && !document.getElementById('suggestPanel').hidden",
      returnByValue: true,
    }, sessionId);
    if (result && result.value) return sessionId;
    await new Promise((r) => setTimeout(r, 200));
  }
  return sessionId;
}

async function screenshot(browser, sessionId, file) {
  await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
  // Emulation.setDeviceMetricsOverride then capture again ensures 1280x800.
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const launched = await launchChrome({ loadExtension: false, headful: HEADFUL });
  try {
    // ── promo images (pure HTML/CSS design, rendered at exact store sizes) ──
    const promos = [
      ["promo-marquee.png", "promo-marquee.html", 1400, 560],
      ["promo-small.png", "promo-small.html", 440, 280],
    ];
    for (const [file, html, w, h] of promos) {
      const url = pathToFileURL(path.join(OUT_DIR, html)).href;
      const { targetId } = await launched.browser.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await launched.browser.send("Target.attachToTarget", { targetId, flatten: true });
      await launched.browser.send("Page.enable", {}, sessionId);
      await launched.browser.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
      await launched.browser.send("Page.navigate", { url }, sessionId);
      for (let i = 0; i < 50; i++) {
        const { result } = await launched.browser.send("Runtime.evaluate", {
          expression: "document.readyState === 'complete'",
          returnByValue: true,
        }, sessionId);
        if (result && result.value) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 400));
      const { data } = await launched.browser.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const out = path.join(OUT_DIR, file);
      fs.writeFileSync(out, Buffer.from(data, "base64"));
      console.log("saved", out);
    }

    const { targetId } = await launched.browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await launched.browser.send("Target.attachToTarget", { targetId, flatten: true });
    await launched.browser.send("Page.enable", {}, sessionId);
    await launched.browser.send("Runtime.enable", {}, sessionId);
    await launched.browser.send("Page.addScriptToEvaluateOnNewDocument", { source: CHROME_MOCK }, sessionId);
    // 1280x800 fixed viewport
    await launched.browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await launched.browser.send("Page.navigate", { url: SIDEPANEL }, sessionId);

    // wait until suggest panel rendered (proves init finished)
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const { result } = await launched.browser.send("Runtime.evaluate", {
        expression: "!!document.getElementById('suggestPanel') && !document.getElementById('suggestPanel').hidden && !!document.querySelector('.suggest-task')",
        returnByValue: true,
      }, sessionId);
      if (result && result.value) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) console.warn("WARN: suggest panel did not render (init may have failed); capturing anyway");

    // Screenshot-only font inflation: sidepanel is ~360px wide with 10-13px
    // type; override each size so it reads clearly at store size (1280x800).
    const FONT_STYLE = [
      'body { font-size: 19px !important; }',
      '#goal { font-size: 19px !important; min-height: 64px !important; }',
      '.template-chip { font-size: 15px !important; padding: 6px 14px !important; }',
      '.suggest-task .label { font-size: 17px !important; }',
      '.suggest-task .hint { font-size: 13px !important; }',
      '.suggest-head { font-size: 15px !important; }',
      '.log-line { font-size: 15px !important; }',
      '.plan-step { font-size: 15px !important; }',
      '.plan-head { font-size: 14px !important; }',
      '.status-pill { font-size: 14px !important; padding: 6px 12px !important; }',
      '.brand .name { font-size: 20px !important; }',
      '.brand .tagline { font-size: 13px !important; }',
      'button { font-size: 15px !important; padding: 10px 16px !important; }',
      'label { font-size: 14px !important; }',
      'input { font-size: 15px !important; padding: 9px 11px !important; }',
      'summary { font-size: 15px !important; }',
      '.auth-btn { font-size: 14px !important; padding: 6px 12px !important; }',
      '#collapsePanel { font-size: 13px !important; }',
    ].join('\n');
    await launched.browser.send("Runtime.evaluate", {
      expression: `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(FONT_STYLE)}; document.head.appendChild(s); })()`,
      returnByValue: true,
    }, sessionId);

    const shots = [
      ["screenshot-main.png", `(async () => {
        const p = document.getElementById('suggestPanel'); if (p) p.hidden = false;
        document.getElementById('goal').value = '在搜索框输入 机械键盘 并点击搜索，打开第一条结果';
        document.getElementById('status').textContent = 'idle';
      })()`],
      ["screenshot-running.png", `(async () => {
        document.getElementById('status').textContent = 'running';
        const log = document.getElementById('log');
        const lines = [
          ['plan', '规划完成：3 步（搜索 → 打开结果 → 提取）'],
          ['step', '步骤 1/3 开始：在搜索框输入「机械键盘」并点击搜索'],
          ['tool', 'click → 搜索框 index 0'],
          ['tool', 'type → 输入「机械键盘」'],
          ['tool', 'click → 搜索按钮 index 1'],
          ['step', '步骤 1/3 完成（恢复 0 / 重规划 0）'],
          ['step', '步骤 2/3 开始：打开第一条结果'],
          ['tool', 'click → 链接「机械键盘 87」index 2'],
          ['step', '步骤 2/3 完成'],
          ['step', '步骤 3/3 开始：提取商品信息'],
          ['tool', 'extract_text → 返回 86 个字符'],
          ['finish', '任务完成：已提取商品名称与价格'],
        ];
        log.innerHTML = '';
        for (const [tag, text] of lines) {
          const d = document.createElement('div'); d.className = 'log-line t-' + tag;
          const s = document.createElement('span'); s.className = 'tag'; s.textContent = tag + ':';
          d.appendChild(s); d.appendChild(document.createTextNode(text)); log.appendChild(d);
        }
      })()`],
      ["screenshot-recovery.png", `(async () => {
        document.getElementById('status').textContent = 'running';
        const log = document.getElementById('log');
        const lines = [
          ['step', '步骤 2/3 开始：点击「下一页」按钮'],
          ['tool', 'click → 链接「下一页」index 5'],
          ['recover', '步骤 2 ❌ ELEMENT_NOT_FOUND: no element at index 5'],
          ['recover', '→ 恢复动作 retry_snapshot：重新获取页面快照'],
          ['tool', 'click → 链接「下一页」index 4'],
          ['step', '步骤 2/3 完成（恢复 1 / 重规划 0）'],
        ];
        log.innerHTML = '';
        for (const [tag, text] of lines) {
          const d = document.createElement('div'); d.className = 'log-line t-' + tag;
          const s = document.createElement('span'); s.className = 'tag'; s.textContent = tag + ':';
          d.appendChild(s); d.appendChild(document.createTextNode(text)); log.appendChild(d);
        }
      })()`],
      ["screenshot-settings.png", `(async () => {
        const det = document.querySelector('details.settings');
        if (det) det.open = true;
        document.getElementById('goal').value = '';
        const log = document.getElementById('log'); log.innerHTML = '';
      })()`],
      ["screenshot-history.png", `(async () => {
        document.getElementById('historyToggle').click();
      })()`],
    ];

    for (const [file, setup] of shots) {
      await launched.browser.send("Runtime.evaluate", { expression: setup, returnByValue: true, awaitPromise: true }, sessionId);
      await new Promise((r) => setTimeout(r, 600));
      const { data } = await launched.browser.send("Page.captureScreenshot", { format: "png" }, sessionId);
      const out = path.join(OUT_DIR, file);
      fs.writeFileSync(out, Buffer.from(data, "base64"));
      console.log("saved", out);
    }
  } finally {
    launched.kill();
  }
}

main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
