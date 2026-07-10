# ModHeader

A Chrome extension to modify HTTP request and response headers, built for **Manifest V3**.

## Architecture overview

| Area | Implementation |
|---|---|
| Manifest version | **3** |
| Background | **Service worker** (`background.js`) |
| Header modification | **`declarativeNetRequest.updateDynamicRules`** |
| Storage | **`chrome.storage.local`** |
| Storage change detection | **`chrome.storage.onChanged`** |
| Toolbar action | **`action`** |
| Host permissions | **`host_permissions`** |

## Features

- Add / modify / remove request and response headers
- Filter header modification by URL pattern or resource type
- Multiple profiles with per-profile settings
- Append mode (set or append to existing header values)
- Pause all modifications with one click
- Lock modifications to a single tab
- Export / import profiles
- Cloud backup via `chrome.storage.sync`

## Install locally (developer mode)

1. Clone this repo
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `src/` folder

## Known limitations of MV3 migration

- **`appendMode` (direct concat)**: `declarativeNetRequest` only supports `set` / `append` (comma-delimited). Direct string concatenation without a separator is mapped to `append`.
- **Dynamic regex filters**: Chrome has limits on regex complexity for `regexFilter` conditions in DNR rules.
- **Service worker lifecycle**: The background service worker can be suspended by Chrome. State is persisted to `chrome.storage.local` and reloaded on each activation.

## License

See [LICENSE](LICENSE).


You may fork and redistribute ModHeader for a small group of friends / colleagues, but please do not impersonate ModHeader, or try to sell it for a profit. If  you use ModHeader in any commercial product, please let me know.

## Installation

ModHeader does not require any extra tool for building. Simply load the src directory into Chrome / Firefox to start local development.

## Selenium usage

If you need to use ModHeader for Selenium tests, please visit: https://github.com/hao1300/modheader_selenium
