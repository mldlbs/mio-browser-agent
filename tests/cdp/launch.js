"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { connect, getBrowserWsUrl } = require("./client");

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Chrome not found. Set CHROME_PATH.");
}

async function launchChrome(options = {}) {
  const chrome = findChrome();
  const port = options.port || 9300 + Math.floor(Math.random() * 1000);
  const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "mio-cdp-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ];
  if (options.loadExtension) {
    args.push(`--load-extension=${path.resolve(options.loadExtension)}`);
  }
  if (options.browserArgs) args.push(...options.browserArgs);
  args.push(options.url || "about:blank");

  const proc = spawn(chrome, args, { stdio: "ignore" });
  const ws = await getBrowserWsUrl(port);
  const browser = await connect(ws);
  return {
    browser, ws, port, userDataDir,
    kill() {
      try { proc.kill(); } catch (_) {}
      try { browser.close(); } catch (_) {}
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

module.exports = { launchChrome, findChrome };