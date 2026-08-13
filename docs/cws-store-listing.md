# Chrome Web Store 上架清单

> 目标：把 mio 从「自签名 crx 手动装」变成「商店可搜到、可一键安装」，这是 1000+ 日活的硬门槛。

## 前置

- [ ] 注册 Google 开发者账号，一次性付费 **$5** → https://chrome.google.com/webstore/devconsole
- [x] 公开 GitHub 仓库 `mldlbs/mio-browser-agent`（已存在）
- [x] 隐私政策已托管：`https://github.com/mldlbs/mio-browser-agent/blob/main/PRIVACY.md`（需 commit + push 后生效）

## 代码侧

- [x] `manifest.json`：补 `icons`（16/48/128）+ `action.default_icon` + `homepage_url` + `minimum_chrome_version`
- [x] 名称改为 `mio — Browser Agent`（商店搜索可用）
- [x] 描述改英文（商店面向全球）
- [x] 零 eval / 零远程代码 / 无 webRequest 拦截 → 满足 MV3 审核
- [x] `PRIVACY.md` 已如实披露可选云同步（`sync.crlkcloud.cyou`）——审核必查隐私政策与实现一致性

## 商店素材（生成于 `D:\Users\gf1913\Temp\opencode\cws-assets\`）

- [x] `promo-small.png` 440x280（必填）
- [x] `promo-marquee.png` 1400x560（选填，建议传）
- [ ] 截图 x5：1280x800 或 640x400，需真实浏览器截图（建议抓 4 张：侧边面板 + 本页可做推荐、任务执行日志、恢复引擎场景、设置页）

## 商店文案

### 名称
`mio — Browser Agent`

### 简短描述（132 字符内，商店将展示）
```
A natural-language browser agent that clicks, types, scrolls and extracts on live pages. Local-first, zero third-party deps.
```

### 详细描述（商店页面）

```
mio is a browser agent you talk to. Open the side panel, type what you want —
"search for hello and click submit", "fill this form", "scroll and extract the
article" — and mio plans the steps and executes them on the real page.

When you open a page, mio suggests what can be done on it ("本页可做"), so you
don't even have to describe a task to get started.

It runs entirely in your browser:
- Zero third-party dependencies (no SDKs, no bundles, all hand-written JS)
- Bring your own LLM (OpenAI-compatible endpoint; point it at a local Ollama to stay fully offline)
- No account required, no phone-home, no analytics. Page data goes only to the endpoint you configure.
- Optional cloud sync (opt-in, account required) to back up task history across devices
- Open source (MIT) on GitHub

Built for:
- Anyone automating repetitive web tasks (filling forms, checking pages, extracting data)
- Developers and QA scripting multi-step flows
- Privacy-conscious users who want a local agent

What it can do:
- Click, type, paste, scroll, navigate, switch tabs, extract text
- Suggest tasks from the current page with one-click cards
- Plan multi-step tasks with a recovery engine (finds alternate elements and retries instead of failing)
- Remember context across steps and pages
- Read CAPTCHAs by asking the human (never solves them in the background)
```

### 类别
`Productivity` 或 `Developer Tools`（二选一，建议 Productivity——面向小白）

### 隐私政策 URL
```
https://github.com/mldlbs/mio-browser-agent/blob/main/PRIVACY.md
```

### 单一用途声明（审核必填）
```
mio automates web pages from natural-language instructions. It has a single
purpose: executing the user's requested browsing actions on live pages using
the user's own LLM endpoint.
```

### 权限说明（审核必填）
```
- <all_urls> + tabs + activeTab: read the current page so mio can act on it
- scripting: inject the content scripts that perform actions
- storage: keep settings + task history locally
- sidePanel: render the mio control panel
- webNavigation: track page transitions during tasks
All data stays local or goes to the user-configured LLM endpoint. See PRIVACY.md.
```

## 上传步骤

1. 打开 devconsole → New Item → 上传 zip（**商店上传用**未签名 **zip，不是自签名 crx**）
   ```bash
   python scripts/release.py --help  # 或直接用 build_zip 逻辑
   python -c "
   import sys; sys.path.insert(0, 'scripts')
   from release import build_zip
   z, n = build_zip('.', '0.1.46', r'D:\Users\gf1913\Temp\opencode')
   print(z, n)
   "
   ```
2. 填名称 / 描述 / 类别 / 隐私政策 URL（上方文案）
3. 上传推广图 + 截图
4. 确认权限理由 → Submit for review
5. 审核通常 1-3 个工作日，首次可能需补充截图

## 发布后

- 在 README 顶部加「[安装于 Chrome Web Store](链接)」按钮
- GitHub Release 的安装说明更新为「优先走商店安装」
- 用商店链接替代自签名 crx 作为默认安装路径
