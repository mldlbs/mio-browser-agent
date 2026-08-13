# mio — Privacy Policy

Last updated: 2026-08-13

## What mio is

mio is a browser extension that performs web automation tasks from natural-language instructions you type in the side panel. It runs in your browser and is open source (MIT).

## What data mio collects

mio **does not collect, store, or transmit any data to the extension author for advertising or analytics**. There is no telemetry, no analytics, no third-party SDKs, no advertising.

The only outbound network activity is:

- **Your LLM provider (by your choice)**: When you run a task, mio sends the visible snapshot of the current page plus your instructions to the LLM endpoint you configured in the side panel Settings (`Base URL` + `API Key`). This is **your** provider — e.g. `https://api.openai.com/v1`, or a fully local endpoint such as `http://localhost:11434/v1` (Ollama). None of this traffic touches mio's infrastructure.
- **Cloud sync (opt-in, account required)**: If you choose to register an account and enable cloud sync, task history records are uploaded to the sync server so they can be restored on other devices. This feature is **off by default** and requires explicit sign-in. Records are stored on the sync server and can be deleted by logging out / deleting your account.
- **GitHub (opt-in, manual)**: The extension checks for updates against the public `mldlbs/mio-browser-agent` repository only when you trigger the update check.

## What data mio stores

All state is kept in Chrome's local extension storage (`chrome.storage.local`) on your device:

- Your `API Key` and `Base URL` — stored locally only, never sent to the author
- Task history and snapshots you generate during a session
- Page memory used to keep context across steps
- Per-site task suggestions and task memory used to surface frequent tasks

When cloud sync is enabled, task history records (goal, status, summary, timestamps, logs) are additionally stored on the sync server. Your API keys never leave your device.

You can wipe everything at any time: `chrome://extensions` → mio → "Clear data", or uninstall the extension.

## Permissions and why

| Permission | Why |
| --- | --- |
| `<all_urls>` + `tabs` + `activeTab` | Read the page you are automating so mio can click, type, scroll and extract |
| `scripting` | Inject the content scripts that perform actions on pages |
| `storage` | Persist your settings and task history locally |
| `sidePanel` | Render the mio control panel |
| `webNavigation` | Track page transitions during multi-step tasks |

## Third parties

mio is zero-dependency: no bundled libraries, no CDN calls, no advertising, no tracking pixels. Outbound requests go only to (a) the LLM endpoint you configure, and (b) the sync server when you opt in.

## Contact

Open an issue at [https://github.com/mldlbs/mio-browser-agent/issues](https://github.com/mldlbs/mio-browser-agent/issues).
