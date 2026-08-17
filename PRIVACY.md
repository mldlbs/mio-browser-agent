# mio — Privacy Policy / 隐私政策

Last updated / 最后更新: 2026-08-17

---

## English

### 1. Overview

mio ("mio", "we", "the extension") is an open-source (MIT), local-first browser automation agent. You describe a task in natural language, and mio plans and executes it on the live page — clicking, typing, scrolling, navigating, and extracting content.

By default, everything stays on your device. Data leaves your browser only (a) to the AI (LLM) provider you configure in Settings, and (b) if you opt in to cloud sync, to the sync server. We do not sell data, and we do not use your data for advertising, analytics, or profiling.

This policy explains what data the extension collects, how it is used, how it is stored, and who it is shared with.

### 2. Data We Collect

**2.1 Page content and browsing activity (web content).** When you run a task, mio reads the page you are automating to build a "snapshot": the page URL, title, visible elements and text, form-field values, link destinations, and the content of pages inside iframes or shadow DOM. This snapshot is sent to the LLM endpoint you configure so the model can decide the next action. We do not collect your browsing history, passwords, cookies, or other personal data beyond what is needed to execute the task you requested.

**2.2 Your task instructions.** The natural-language instructions (the task "goal") you type in the side panel, and the intermediate planning and execution data, are processed locally and sent to your LLM provider while a task runs.

**2.3 Screenshots (optional vision feature).** If you enable the optional vision features (off by default), mio may capture a screenshot of the current page and send it to your configured vision-model endpoint to locate elements or verify that an action succeeded. Screenshots are used only for the task at hand and are not stored by the extension author.

**2.4 Task history.** mio records each task you run — goal, status, summary, timestamps, recovery/replan counts, logs, step events, tags, and pinned flags — and stores it in your browser's local extension storage. This history is used to show results, retry and recover tasks, and suggest common tasks.

**2.5 Task memory.** To surface frequent tasks, mio stores the goal text and the domain of the pages where you run tasks. This is kept only in local storage on your device and is never synchronized to the cloud.

**2.6 Account information (only if you use cloud sync).** Cloud sync is optional and off by default. If you register an account, we receive and store the email address you provide and a salted, hashed form of the password you choose. Plaintext passwords are never stored.

**2.7 Configuration and API keys.** Your LLM provider settings (base URL, model) and API key are stored locally in your browser. Your API key is sent only to the provider you configured, as authentication, and is never sent to the extension author.

### 3. How We Use the Data We Collect

- Execute the tasks you request on live web pages
- Recover from failures and re-plan steps when the page changes
- Keep a history of completed tasks for your review
- Suggest tasks you may want to run on the current page
- Back up and restore your task history across devices when you opt into cloud sync

We do not use your data for advertising, profiling, or training.

### 4. How We Share Your Data

**4.1 Your LLM provider (third party).** When you run a task, the page snapshot, your instructions, and (if enabled) screenshots are sent to the AI provider you selected in Settings — for example OpenAI, Anthropic, DeepSeek, Zhipu AI, Moonshot AI, or a server you run yourself (such as Ollama or LM Studio). These are third parties; the data you send to them is governed by their own privacy policies. The extension author does not receive this traffic.

**4.2 The sync server (developer-operated, optional).** Only when you opt in to cloud sync are task history records uploaded to a sync server operated by the developer at `https://sync.crlkcloud.cyou`. Records are encrypted at rest (AES-256-GCM). The server is accessed only to operate the sync service, and records are not shared with any other party.

**4.3 No advertising, no analytics, no other third parties.** mio contains no third-party SDKs, no advertising, no tracking pixels, and no analytics. We do not sell or rent your data.

### 5. How We Store and Retain Data

- **Local data.** Settings, task history, task memory, and templates are stored in Chrome's extension storage (`chrome.storage.local`) on your device. Local data is retained until you clear it or uninstall the extension.
- **Synced data.** When cloud sync is enabled, task history records are stored on the sync server. They are retained while your account exists, and you can delete them at any time (see Section 7).
- **LLM provider traffic.** Snapshots and instructions sent to your LLM provider are retained according to that provider's own policy, not ours.

### 6. Data Security

- Local data is protected by Chrome's extension storage.
- Traffic to the sync server and to cloud LLM providers uses HTTPS. If you configure a local provider (for example Ollama or LM Studio), requests stay on your own machine over loopback HTTP.
- Passwords are stored as salted scrypt hashes; synced records are encrypted at rest with AES-256-GCM.
- No method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.

### 7. Your Choices and Controls

- **Clear local data.** `chrome://extensions` → mio → "Clear data", or uninstall the extension.
- **Delete individual records.** Remove tasks from the history panel.
- **Disable cloud sync.** Log out or delete your account; deleting your account removes your records from the sync server.
- **Important:** do not type passwords, financial details, or other sensitive information into task instructions. As with any automation tool, the page content you ask mio to work on is sent to the LLM provider you configured.

### 8. Children's Privacy

mio is not directed at children under 13, and we do not knowingly collect personal information from children.

### 9. Changes to This Policy

We may update this policy from time to time. The "Last updated" date at the top of this document reflects the latest revision.

### 10. Contact Us

Questions about this policy can be directed to:

- GitHub issues: https://github.com/mldlbs/mio-browser-agent/issues
- Email: 903288675@qq.com

---

## 中文

### 1. 概述

mio（「mio」「我们」「本扩展」）是一款开源（MIT）、本地优先的浏览器自动化 Agent。您用自然语言描述任务，mio 会在真实网页上规划并执行——包括点击、输入、滚动、导航和内容提取。

默认情况下，一切数据都保存在您的设备上。只有在以下两种情况下数据才会离开您的浏览器：(a) 发送到您在设置中配置的 AI（LLM）服务商；(b) 您主动启用云同步后，发送到同步服务器。我们不出售数据，也不将您的数据用于广告、统计分析或个人画像。

本政策说明了本扩展收集哪些数据、如何使用、如何存储，以及会与哪些相关方共享。

### 2. 我们收集的数据

**2.1 网页内容与浏览行为（网页内容）。** 当您运行任务时，mio 会读取您正在自动化的页面以构建「快照」：页面 URL、标题、可见元素与文本、表单字段值、链接目标，以及 iframe 或 Shadow DOM 内的页面内容。该快照会发送到您配置的 LLM 服务端，以便模型决定下一步动作。除执行您所请求任务所需的数据外，我们不会收集您的浏览历史、密码、Cookie 或其他个人信息。

**2.2 您的任务指令。** 您在侧边面板输入的自然语言指令（任务「目标」）以及中间产生的规划与执行数据，会在任务运行时于本地处理，并发送给您的 LLM 服务商。

**2.3 截图（可选的视觉功能）。** 若您启用了可选的视觉功能（默认关闭），mio 可能会截取当前页面截图，并发送到您配置的视觉模型服务端，用于定位元素或确认操作是否成功。截图仅用于当前任务，扩展开发者不会存储这些截图。

**2.4 任务历史。** mio 会记录您运行过的每个任务——目标、状态、摘要、时间戳、恢复/重规划次数、日志、步骤事件、标签与置顶标记——并保存在您浏览器的本地扩展存储中。这些历史用于展示结果、失败重试与恢复，以及推荐常用任务。

**2.5 任务记忆。** 为推荐高频任务，mio 会保存任务的 goal 文本及运行过该任务的域名。此数据仅保存在您设备的本地存储中，绝不会同步到云端。

**2.6 账户信息（仅在使用云同步时）。** 云同步为可选功能，默认关闭。若您注册账户，我们会接收并存储您提供的邮箱地址，以及您所选密码的加盐哈希形式。我们从不存储明文密码。

**2.7 配置与 API 密钥。** 您的 LLM 服务商设置（Base URL、模型）与 API 密钥保存在您浏览器的本地存储中。您的 API 密钥仅作为身份验证发送给您所配置的服务商，绝不会发送给扩展开发者。

### 3. 我们如何使用收集的数据

- 在真实网页上执行您请求的任务
- 在页面变化时进行失败恢复与步骤重规划
- 保存已完成任务的历史供您查看
- 针对当前页面推荐您可能想执行的任务
- 在您启用云同步时，跨设备备份与恢复任务历史

我们不会将您的数据用于广告、个人画像或模型训练。

### 4. 我们如何共享您的数据

**4.1 您配置的 LLM 服务商（第三方）。** 当您运行任务时，页面快照、您的指令以及（若启用）截图会发送到您在设置中选择的 AI 服务商——例如 OpenAI、Anthropic、DeepSeek、智谱 AI、月之暗面，或您自行运行的本地服务（如 Ollama、LM Studio）。这些均为第三方，您发送给它们的数据受其自身隐私政策约束。扩展开发者不会收到这部分流量。

**4.2 同步服务器（开发者运营，可选）。** 仅在您主动启用云同步时，任务历史记录才会上传至开发者运营的同步服务器 `https://sync.crlkcloud.cyou`。记录在服务器上加密存储（AES-256-GCM）。该服务器仅用于提供同步服务，记录不会与任何其他方共享。

**4.3 无广告、无统计分析、无其他第三方。** mio 不含任何第三方 SDK、无广告、无追踪像素、无统计分析。我们不出售或出租您的数据。

### 5. 数据的存储与保留

- **本地数据。** 设置、任务历史、任务记忆与模板保存在您设备的 Chrome 扩展存储（`chrome.storage.local`）中。本地数据将一直保留，直到您主动清除或卸载扩展。
- **云端数据。** 启用云同步后，任务历史记录会存储在同步服务器上。只要您的账户存在，记录即被保留；您可随时删除（见第 7 节）。
- **LLM 服务商流量。** 发送给您 LLM 服务商的快照与指令，其保留规则遵循该服务商自身的政策，而非我们的政策。

### 6. 数据安全

- 本地数据受 Chrome 扩展存储机制保护。
- 与同步服务器及云端 LLM 服务商的通信使用 HTTPS；若您配置的是本地服务商（如 Ollama、LM Studio），请求仅在本机回环 HTTP 上进行。
- 密码以加盐 scrypt 哈希形式存储；同步记录在服务器上以 AES-256-GCM 加密存储。
- 互联网传输无法做到绝对安全，我们无法保证绝对安全。

### 7. 您的选择与控制

- **清除本地数据。** 进入 `chrome://extensions` → mio → 「清除数据」，或直接卸载扩展。
- **删除单条记录。** 在历史面板中删除对应任务。
- **关闭云同步。** 退出登录或删除账户；删除账户即会从同步服务器移除您的记录。
- **重要提示：** 请勿将密码、财务信息等敏感内容写入任务指令。与任何自动化工具一样，您让 mio 处理的网页内容会发送给您所配置的 LLM 服务商。

### 8. 未成年人隐私

mio 并非面向 13 岁以下儿童，我们不会在知情情况下收集儿童的个人信息。

### 9. 政策变更

我们可能不时更新本政策。本文档顶部的「最后更新」日期反映最新修订版本。

### 10. 联系我们

如有任何关于本政策的问题，可通过以下方式联系：

- GitHub Issues：https://github.com/mldlbs/mio-browser-agent/issues
- 邮箱：903288675@qq.com
