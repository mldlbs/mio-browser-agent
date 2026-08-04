"use strict";
// Drives a Chrome tab to a URL, injects an assertion script, collects results.

async function openTab(browser, url) {
  const { targetId } = await browser.send("Target.createTarget", { url });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await new Promise((r) => setTimeout(r, 800));
  return { targetId, sessionId };
}

async function runInPage(browser, sessionId, script) {
  const { result, exceptionDetails } = await browser.send("Runtime.evaluate", {
    expression: `(async () => { ${script} })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (exceptionDetails) throw new Error("page script threw: " + JSON.stringify(exceptionDetails).slice(0, 300));
  return result && result.value ? result.value : [];
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
