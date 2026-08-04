"use strict";
const http = require("http");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./launch");
const { openTab } = require("./page-runner");

const ROOT = path.resolve(__dirname, "..", "..");
const TEST_PAGE = path.resolve(__dirname, "..", "test-page.html");
const FILE_URL = pathToFileURL(TEST_PAGE).href;
const READY_EXPR = "document.readyState === 'complete'";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function startStaticServer(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(root, urlPath);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/tests/test-page.html` });
    });
  });
}

async function probeInjection(browser, url) {
  const isolated = [];
  const off = browser.on("Runtime.executionContextCreated", (params) => {
    const ctx = params && params.context;
    if (ctx && ctx.auxData && ctx.auxData.isDefault === false) isolated.push(ctx);
  });
  const { sessionId } = await openTab(browser, url, READY_EXPR);
  await new Promise((r) => setTimeout(r, 1000));
  const evaluate = async (expression, contextId) => {
    try {
      const { result, exceptionDetails } = await browser.send("Runtime.evaluate", {
        expression,
        contextId: contextId || undefined,
        returnByValue: true,
      }, sessionId);
      if (exceptionDetails) {
        return "ERR:" + String((exceptionDetails.exception && exceptionDetails.exception.description) || exceptionDetails.text).slice(0, 200);
      }
      return result.value;
    } catch (e) {
      return "CDP:" + e.message;
    }
  };
  const domMarker = await evaluate(`document.documentElement ? document.documentElement.getAttribute("data-mio-content") : null`);
  const mainWorldWindow = await evaluate(`typeof window.__mioContentLoaded`);
  const worldProbes = [];
  for (const ctx of isolated) {
    const probe = await evaluate(
      `({ counter: (window.__mioContentLoaded || 0), hasCaptureSnapshot: typeof captureSnapshot === "function", hasExecuteAction: typeof executeAction === "function", hasRuntime: !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) })`,
      ctx.id
    );
    worldProbes.push({ name: ctx.name, auxData: ctx.auxData, probe });
  }
  off();
  return {
    url,
    domMarker,
    mainWorldWindow,
    isolatedWorldCount: isolated.length,
    worldProbes,
    injected: domMarker === "1",
  };
}

(async () => {
  const launched = await launchChrome({
    loadExtension: ROOT,
  });
  try {
    const targets = await launched.browser.send("Target.getTargets");
    const extensionTargets = targets.targetInfos.filter((t) =>
      t.url.startsWith("chrome-extension://") && (t.type === "service_worker" || t.type === "background_page")
    );
    const out = {
      extensionLoadedTargets: extensionTargets.map((t) => ({ type: t.type, url: t.url })),
      allTargetTypes: targets.targetInfos.map((t) => t.type),
      fileUrl: FILE_URL,
    };
    out.file = await probeInjection(launched.browser, FILE_URL);
    if (!out.file.injected) {
      const { server, url } = await startStaticServer(ROOT);
      try {
        out.http = await probeInjection(launched.browser, url);
      } finally {
        server.close();
      }
    }
    console.log("=== PROBE RESULT ===");
    console.log(JSON.stringify(out, null, 2));
    console.log("HEADLESS_INJECTION_WORKS=" + (out.http && out.http.injected ? "YES (http)" : out.file.injected ? "YES (file)" : "NO"));
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("PROBE FAIL: " + e.stack); process.exit(1); });
