let AGENT_LOG_LEVEL = "info";

function setLogLevel(level) { AGENT_LOG_LEVEL = level; }

function log(level, tag, ...args) {
  const order = { debug: 0, info: 1, warn: 2, error: 3 };
  if (order[level] < order[AGENT_LOG_LEVEL]) return;
  const line = `[${level.toUpperCase()}] ${tag}: ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
const logDebug = (tag, ...a) => log("debug", tag, ...a);
const logInfo = (tag, ...a) => log("info", tag, ...a);
const logWarn = (tag, ...a) => log("warn", tag, ...a);
const logError = (tag, ...a) => log("error", tag, ...a);

if (typeof module !== "undefined") {
  module.exports = { setLogLevel, log, logDebug, logInfo, logWarn, logError };
}
