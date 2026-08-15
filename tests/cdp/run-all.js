"use strict";
// Runs all automated browser tests in sequence. Exits nonzero on any failure.
const { spawnSync } = require("child_process");
const path = require("path");

const scripts = ["smoke.js", "run-page-tests.js", "onboarding-check.js", "layout-check.js", "run-extension-tests.js"];
let failed = 0;
for (const s of scripts) {
  console.log("\n=== " + s + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log(s + " FAILED (exit " + r.status + ")"); }
  else console.log(s + " PASSED");
}
if (failed > 0) { console.log("\n" + failed + " suite(s) failed"); process.exit(1); }
console.log("\n=== ALL BROWSER SUITES PASS ===");