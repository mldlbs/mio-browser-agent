"use strict";
const { launchChrome } = require("./launch");

(async () => {
  const launched = await launchChrome();
  try {
    const { targetId } = await launched.browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await launched.browser.send("Target.attachToTarget", { targetId, flatten: true });
    await launched.browser.send("Page.enable", {}, sessionId);
    await launched.browser.send("Page.navigate", { url: "data:text/html,<h1 id=h>smoke</h1>" }, sessionId);
    await new Promise((r) => setTimeout(r, 500));
    const { result } = await launched.browser.send("Runtime.evaluate", {
      expression: "document.querySelector('#h').textContent", returnByValue: true,
    }, sessionId);
    if (result.value !== "smoke") throw new Error("evaluate mismatch: " + result.value);
    console.log("SMOKE OK: " + result.value);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("SMOKE FAIL: " + e.message); process.exit(1); });
