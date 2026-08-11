const assert = require("assert");
const crypto = require("../server/crypto.js");

async function run() {
  process.env.SYNC_KEK = require("crypto").randomBytes(32).toString("hex");
  const kek = crypto.loadKek();
  assert.strictEqual(kek.length, 32, "KEK is 32 bytes");

  const plaintext = JSON.stringify({ id: "a1", goal: "任务", status: "done", finishedAt: 1000 });
  const enc = crypto.encrypt(plaintext);
  assert.ok(enc.ciphertext && enc.iv, "encrypt produces ciphertext+iv");
  const dec = crypto.decrypt(enc.ciphertext, enc.iv);
  assert.strictEqual(dec, plaintext, "roundtrip");

  let threw = false;
  const flip = enc.ciphertext[0] === "A" ? "B" : "A";
  const tampered = flip + enc.ciphertext.slice(1);
  try { crypto.decrypt(tampered, enc.iv); } catch (_) { threw = true; }
  assert.ok(threw, "tampered ciphertext fails");

  console.log("crypto tests passed");
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
