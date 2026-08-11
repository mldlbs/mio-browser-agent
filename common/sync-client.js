function sanitizeRecord(rec) {
  const out = Object.assign({}, rec);
  delete out.resume;
  return out;
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

async function _req(serverUrl, token, path, method, body) {
  const url = apiUrl(serverUrl, path);
  const headers = { "Authorization": "Bearer " + token };
  if (body) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, {
    method: method || "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = new Error("HTTP " + resp.status);
    err.status = resp.status;
    throw err;
  }
  return resp.status === 204 ? null : resp.json();
}

async function listRemote(serverUrl, token) {
  return _req(serverUrl, token, "records", "GET");
}

async function putRecord(serverUrl, token, record) {
  return _req(serverUrl, token, "records/" + encodeURIComponent(record.id), "PUT", record);
}

async function syncHistory(serverUrl, token, localList) {
  const remote = await listRemote(serverUrl, token);
  const { merged, pulled, toPush } = mergeRecords(localList, remote);
  let pushed = 0;
  const failed = [];
  for (const rec of toPush) {
    try {
      await putRecord(serverUrl, token, sanitizeRecord(rec));
      pushed++;
    } catch (e) { failed.push(rec.id); }
  }
  return { merged, pulled: pulled.length, pushed, pushFailed: toPush.length - pushed, failed };
}

if (typeof module !== "undefined") {
  module.exports = { sanitizeRecord, apiUrl, mergeRecords, _req, listRemote, putRecord, syncHistory };
} else {
  globalThis.SyncClient = { sanitizeRecord, apiUrl, mergeRecords, _req, listRemote, putRecord, syncHistory };
}
