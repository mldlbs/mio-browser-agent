const SALT = "mio-sync-v1";
const PBKDF2_ITERATIONS = 100000;

function b64u(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "====".slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(apiKey) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(apiKey), "PBKDF2", false, ["deriveKey"]);
  const material = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(SALT), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const raw = await crypto.subtle.exportKey("raw", material);
  return b64u(new Uint8Array(raw));
}

async function _rawKey(b64) {
  return crypto.subtle.importKey("raw", unb64u(b64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptRecord(rec, keyB64) {
  const k = await _rawKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(rec));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, data);
  return {
    id: rec.id,
    updatedAt: rec.finishedAt || 0,
    ciphertext: b64u(new Uint8Array(ct)),
    iv: b64u(iv),
  };
}

async function decryptRecord(bundle, keyB64) {
  const k = await _rawKey(keyB64);
  const iv = unb64u(bundle.iv);
  const ct = unb64u(bundle.ciphertext);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

function apiUrl(serverUrl, path) {
  return serverUrl.replace(/\/+$/, "") + "/v1/" + path;
}

function mergeRecords(localList, remoteList) {
  const localMap = new Map(localList.map((r) => [r.id, r]));
  const remoteMap = new Map(remoteList.map((r) => [r.id, r]));
  const toPush = [];
  const pulled = [];
  for (const [id, r] of remoteMap) {
    const l = localMap.get(id);
    if (!l) { pulled.push(r); localMap.set(id, r); }
    else if ((r.finishedAt || 0) > (l.finishedAt || 0)) { localMap.set(id, r); pulled.push(r); }
  }
  for (const [id, l] of localMap) {
    const r = remoteMap.get(id);
    if (!r) toPush.push(l);
    else if ((l.finishedAt || 0) > (r.finishedAt || 0)) toPush.push(l);
  }
  const merged = Array.from(localMap.values());
  return { merged, pulled, toPush };
}

if (typeof module !== "undefined") {
  module.exports = { SALT, deriveKey, encryptRecord, decryptRecord, apiUrl, mergeRecords };
} else {
  globalThis.SyncClient = { SALT, deriveKey, encryptRecord, decryptRecord, apiUrl, mergeRecords };
}