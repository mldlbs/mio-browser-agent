const fs = require("fs");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
console.log("manifest OK, version", manifest.version);
const refs = manifest.content_scripts.flatMap((c) => c.js).concat([manifest.background.service_worker]);
const missing = refs.filter((f) => !fs.existsSync(f));
console.log("manifest refs missing:", missing.length ? missing.join(", ") : "none");

const html = fs.readFileSync("sidepanel/sidepanel.html", "utf8");
const refs2 = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
const missing2 = refs2.filter((f) => !fs.existsSync("sidepanel/" + f));
console.log("sidepanel refs:", refs2.length, "missing:", missing2.length ? missing2.join(", ") : "none");

const sw = fs.readFileSync("background/service-worker.js", "utf8");
const block = sw.match(/importScripts\(([\s\S]*?)\);/);
if (block) {
  const swRefs = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const missing3 = swRefs.filter((f) => !fs.existsSync("background/" + f));
  console.log("SW importScripts:", swRefs.length, "missing:", missing3.length ? missing3.join(", ") : "none");
}
console.log("locales:", fs.readdirSync("_locales").join(", "));
