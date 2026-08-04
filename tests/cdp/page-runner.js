"use strict";
// Drives a Chrome tab to a URL, injects an assertion script, collects results.

async function openTab(browser, url, readyExpr) {
  const expr = readyExpr || "document.readyState === 'complete' && typeof captureSnapshot === 'function'";
  const { targetId } = await browser.send("Target.createTarget", { url });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  for (let i = 0; i < 100; i++) {
    const { result } = await browser.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    }, sessionId);
    if (result && result.value) return { targetId, sessionId };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("page did not become ready: " + url);
}

async function runInPage(browser, sessionId, script) {
  const { result, exceptionDetails } = await browser.send("Runtime.evaluate", {
    expression: `(async () => { ${script} })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (exceptionDetails) {
    const detail = (exceptionDetails.exception && exceptionDetails.exception.description)
      || exceptionDetails.text || JSON.stringify(exceptionDetails);
    throw new Error("page script threw: " + String(detail).slice(0, 500));
  }
  return result.value !== undefined ? result.value : [];
}

function report(results) {
  let fails = 0;
  for (const r of results) {
    if (r.ok) console.log("PASS: " + r.name);
    else { fails++; console.log("FAIL: " + r.name + (r.detail ? " (" + r.detail + ")" : "")); }
  }
  console.log(fails === 0 ? "=== ALL PASS ===" : fails + " FAILURE(S)");
  return fails;
}

module.exports = { openTab, runInPage, report };
