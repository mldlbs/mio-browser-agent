#!/usr/bin/env python3
"""One-shot mio release: build zip -> sign crx -> create GitHub release -> upload.

Usage:
    python scripts/release.py --version 0.1.21 [--notes-file notes.md] [--draft]

Version defaults to the current manifest.json value. Release notes default to a
short auto-generated body. Requires:
    - GH_TOKEN env var (fine-grained PAT with Contents:write + Releases:write)
    - a working network path to api.github.com (set ALL_PROXY if needed)
    - a release signing key (--pem) defaulting to the shared mio-crx.pem
"""
import argparse, json, os, shutil, struct, subprocess, sys, tempfile, zipfile
import urllib.request, urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO, "manifest.json")
GITHUB_REPO = "mldlbs/mio-browser-agent"

EXCLUDE_DIRS = {".git", ".github", "tests", "docs", "diagrams", "scripts", "server"}
EXCLUDE_FILES = {".gitignore", "README.md", "LICENSE", "PRIVACY.md", "DEPLOY_SERVER.md", "server.zip"}


def manifest_version():
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)["version"]


def build_zip(repo, version, out_dir):
    out_zip = os.path.join(out_dir, f"mio-browser-agent-v{version}.zip")
    files = []
    for root, dirs, names in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for n in names:
            if n in EXCLUDE_FILES:
                continue
            full = os.path.join(root, n)
            rel = os.path.relpath(full, repo)
            files.append((full, rel))
    files.sort(key=lambda x: x[1])
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for full, rel in files:
            z.write(full, rel)
    return out_zip, len(files)


def build_crx(zip_path, pem_path, out_crx):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    with open(pem_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    with open(zip_path, "rb") as f:
        zip_data = f.read()

    pub_der = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    def varint(n):
        out = b""
        while True:
            b = n & 0x7F
            n >>= 7
            if n:
                out += bytes([b | 0x80])
            else:
                out += bytes([b])
                return out

    def ld(tag, payload):
        return varint(tag) + varint(len(payload)) + payload

    def bfield(field_no, data):
        return ld((field_no << 3) | 2, data)

    def to_id_alphabet(hexstr):
        out = []
        for ch in hexstr:
            if ch.isdigit():
                out.append(chr(ord("a") + int(ch)))
            elif "a" <= ch <= "f":
                out.append(chr(ord("k") + ord(ch) - ord("a")))
            else:
                out.append("a")
        return "".join(out)

    crx_id_bin = hashlib_sha256(pub_der)[:16]
    crx_id_str = to_id_alphabet(crx_id_bin.hex())
    signed_header_data = bfield(1, crx_id_bin)

    signature_context = b"CRX3 SignedData\x00"
    header_size_octets = struct.pack("<I", len(signed_header_data))
    verify_data = signature_context + header_size_octets + signed_header_data + zip_data
    sig = key.sign(verify_data, padding.PKCS1v15(), hashes.SHA256())

    proof = bfield(1, pub_der) + bfield(2, sig)
    header = bfield(2, proof) + bfield(10000, signed_header_data)

    crx = b"Cr24" + struct.pack("<I", 3) + struct.pack("<I", len(header)) + header + zip_data
    with open(out_crx, "wb") as f:
        f.write(crx)
    return out_crx, len(crx), crx_id_str


def hashlib_sha256(data):
    import hashlib
    return hashlib.sha256(data).digest()


def api(tok, method, path, data=None, binary=None, headers=None, base="https://api.github.com"):
    url = base + path
    h = {"Authorization": "Bearer " + tok, "User-Agent": "mio-release", "Accept": "application/vnd.github+json"}
    if headers:
        h.update(headers)
    body = None
    if isinstance(data, dict):
        body = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"
    elif binary is not None:
        body = binary
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        rawdata = resp.read()
        return resp.status, (rawdata.decode("utf-8") if rawdata else "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def default_notes(version):
    """Build release notes: auto-generated changelog from git history since the
    previous version tag, with an install section appended. Falls back to a
    minimal body when git has no tags or no commits to list."""
    body = [f"## v{version}\n"]
    commits = changelog_commits(version)
    if commits:
        body.append("### 更新内容\n")
        body.append(commits)
        body.append("\n")
    else:
        body.append("自动打包的发布构建（zip + crx）。\n")
    body.append(
        "### 安装\n"
        "- `*.zip`：解压后 `chrome://extensions` → 开发者模式 → 加载已解压扩展\n"
        "- `*.crx`：签名包，双击安装（Chrome 提示「未列入商店」属正常，自签名扩展均如此）"
    )
    return "\n".join(body)


# Ordered feature buckets; unknown prefixes fall into a generic list.
_CHANGELOG_BUCKETS = [
    ("feat", "新功能"),
    ("fix", "修复"),
    ("docs", "文档"),
    ("chore", "构建 / 工具"),
    ("refactor", "重构"),
    ("test", "测试"),
]


def _run_git(*args):
    try:
        out = subprocess.run(
            ["git", "-C", REPO, *args], capture_output=True, text=True, encoding="utf-8"
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _sorted_tags():
    tags = set()
    for line in _run_git("tag", "--list", "v*").splitlines():
        line = line.strip()
        if line.startswith("v") and line[1:].replace(".", "").isdigit():
            tags.add(line)
    return sorted(tags, key=lambda t: [int(p) for p in t[1:].split(".")])


def previous_tag(version):
    """Highest existing tag whose version is strictly less than `version`."""
    cur = [int(p) for p in version.split(".")]
    prev = None
    for t in _sorted_tags():
        tv = [int(p) for p in t[1:].split(".")]
        if tv < cur:
            prev = t
        else:
            break
    return prev


def changelog_commits(version):
    prev = previous_tag(version)
    if prev is None:
        return ""
    range_arg = f"{prev}..HEAD"
    if not _run_git("rev-list", "-n", "1", prev):
        return ""
    log = _run_git("log", "--no-merges", "--format=%s", range_arg)
    lines = [l.strip() for l in log.splitlines() if l.strip()]
    if not lines:
        return ""
    buckets = {prefix: [] for prefix, _ in _CHANGELOG_BUCKETS}
    others = []
    for line in lines:
        matched = False
        for prefix, _ in _CHANGELOG_BUCKETS:
            # match "prefix: msg" or "prefix(scope): msg" — conventional commits
            if not (line.startswith(prefix + ":") or line.startswith(prefix + "(")):
                continue
            col = line.find(":")
            msg = line[col + 1:].strip() if col >= 0 else ""
            if msg:
                buckets[prefix].append(msg)
                matched = True
                break
        if not matched:
            others.append(line)
    parts = []
    for prefix, label in _CHANGELOG_BUCKETS:
        if buckets[prefix]:
            parts.append(f"**{label}**")
            parts.extend(f"- {m}" for m in buckets[prefix])
    if others:
        parts.append("**其他**")
        parts.extend(f"- {m}" for m in others)
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default=None, help="version (default: from manifest.json)")
    ap.add_argument("--notes-file", default=None, help="path to a markdown file with release notes")
    ap.add_argument("--draft", action="store_true", help="create as a draft release")
    ap.add_argument("--pem", default=r"D:\Users\gf1913\Temp\opencode\mio-crx.pem", help="signing key")
    ap.add_argument("--out-dir", default=None, help="temp dir for artifacts (default: tempfile)")
    args = ap.parse_args()

    version = args.version or manifest_version()
    tok = os.environ.get("GH_TOKEN")
    if not tok:
        print("ERROR: GH_TOKEN env var is required")
        return 2

    out_dir = args.out_dir or tempfile.mkdtemp(prefix="mio-release-")
    print(f"Building v{version} in {out_dir}")

    zip_path, n_files = build_zip(REPO, version, out_dir)
    print(f"zip: {zip_path} ({n_files} entries)")

    crx_path, crx_len, crx_id = build_crx(zip_path, args.pem, os.path.join(out_dir, f"mio-browser-agent-v{version}.crx"))
    print(f"crx: {crx_path} ({crx_len} bytes, id {crx_id})")

    _run_git("fetch", "origin", "--tags", "--force")
    notes = default_notes(version)
    if args.notes_file:
        with open(args.notes_file, encoding="utf-8") as f:
            notes = f.read()

    tag = f"v{version}"

    # Point the tag at the commit being shipped. GitHub auto-creates a tag at
    # the DEFAULT-branch HEAD when the release API is called without an
    # existing tag — if the current commit isn't pushed yet, the tag lands on a
    # stale commit (observed: v0.1.39 tagged 1dad8f0 instead of its bump). So
    # create/push the tag locally first, then let the API attach to it.
    if _run_git("rev-parse", "-q", "--verify", f"refs/tags/{tag}"):
        _run_git("tag", "-f", tag, "HEAD")
        _run_git("push", "origin", f"{tag}:{tag}", "--force")
    else:
        _run_git("tag", tag, "HEAD")
        _run_git("push", "origin", tag)

    st, body = api(tok, "POST", f"/repos/{GITHUB_REPO}/releases", data={
        "tag_name": tag, "name": tag, "body": notes,
        "draft": args.draft, "prerelease": False,
    })
    rel = json.loads(body) if body.strip().startswith("{") else {}
    if st not in (200, 201):
        print(f"ERROR creating release {st}: {body[:500]}")
        return 3
    rid = rel["id"]
    print(f"release created: {tag} (id {rid})")

    for path, label, ctype in [
        (crx_path, f"mio-browser-agent-v{version}.crx", "application/octet-stream"),
        (zip_path, f"mio-browser-agent-v{version}.zip", "application/zip"),
    ]:
        with open(path, "rb") as f:
            content = f.read()
        upath = f"/repos/{GITHUB_REPO}/releases/{rid}/assets?name={label}"
        url = "https://uploads.github.com" + upath
        req = urllib.request.Request(url, data=content, headers={
            "Authorization": "Bearer " + tok, "User-Agent": "mio-release",
            "Accept": "application/vnd.github+json", "Content-Type": ctype,
        }, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=180)
            d = json.loads(resp.read().decode("utf-8"))
            print(f"uploaded {label} -> {d.get('browser_download_url')}")
        except urllib.error.HTTPError as e:
            print(f"upload FAIL {label} {e.code}: {e.read().decode('utf-8','ignore')[:300]}")

    print(f"DONE: https://github.com/{GITHUB_REPO}/releases/tag/{tag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
