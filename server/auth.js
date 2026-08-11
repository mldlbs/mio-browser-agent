const crypto = require("crypto");

function makeAuth(apiKey) {
  if (!apiKey) throw new Error("SYNC_API_KEY env is required");
  const expected = Buffer.from(apiKey);
  return (req) => {
    const provided = req.headers["x-api-key"];
    if (!provided) return false;
    const a = Buffer.from(provided);
    return a.length === expected.length && crypto.timingSafeEqual(a, expected);
  };
}

module.exports = { makeAuth };
