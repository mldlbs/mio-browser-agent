# mio — Privacy Policy

Last updated: 2026-08-10

## What mio is

mio is a browser extension that performs web automation tasks from natural-language instructions you type in the side panel. It runs **fully on your local machine** and is open source (MIT).

## What data mio collects

mio **does not collect, store, or transmit any data to the extension author**. There is no telemetry, no analytics, no third-party SDKs, no remote servers owned by the project.

The only outbound network activity is:

- **Your LLM provider (by your choice)**: When you run a task, mio sends the visible snapshot of the current page plus your instructions to the LLM endpoint you configured in the side panel Settings (`Base URL` + `API Key`). This is **your** provider — e.g. `https://api.openai.com/v1`, or a fully local endpoint such as `http://localhost:11434/v1` (Ollama). None of this traffic touches mio's infrastructure.
- **GitHub (opt-in, manual)**: The extension checks for updates against the public `mldlbs/mio-browser-agent` repository only when you trigger the update check. No version data is sent otherwise.

## What data mio stores

All state is kept in Chrome's local extension storage (`chrome.storage.local`) on your device:

- Your `API Key` and `Base URL` — stored locally only, never sent to the author
- Task history and snapshots you generate during a session
- Page memory used to keep context across steps

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

None. mio is zero-dependency: no bundled libraries, no CDN calls, no advertising, no tracking pixels.

## Contact

Open an issue at [https://github.com/mldlbs/mio-browser-agent/issues](https://github.com/mldlbs/mio-browser-agent/issues).
