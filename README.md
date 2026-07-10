# ModHeader — MV3 Fork

A personal fork of the [ModHeader](https://github.com/bewisse/modheader) Chrome extension, migrated from **Manifest V2 → Manifest V3** to work with modern Chrome (post-2023).

## What changed from the original

| Area | Original (MV2) | This fork (MV3) |
|---|---|---|
| Manifest version | 2 | **3** |
| Background | Persistent background page | **Service worker** (`background.js`) |
| Header modification | `webRequest` blocking listeners | **`declarativeNetRequest.updateDynamicRules`** |
| Storage | `localStorage` (background page) | **`chrome.storage.local`** |
| Storage change detection | `window.addEventListener('storage', ...)` | **`chrome.storage.onChanged`** |
| Toolbar action | `browser_action` | **`action`** |
| Context menus | `contexts: ['browser_action']` | **`contexts: ['action']`** |
| `<all_urls>` | Inside `permissions` | **`host_permissions`** |
| `webRequestBlocking` | In `permissions` | **Removed** (replaced by DNR) |

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

## Original project

- GitHub: [bewisse/modheader](https://github.com/bewisse/modheader)
- Chrome Web Store: [ModHeader](https://chrome.google.com/webstore/detail/modheader/idgpnmonknjnojddfkpgkljpfnnfcklj)

## License

See [LICENSE](LICENSE).


You may fork and redistribute ModHeader for a small group of friends / colleagues, but please do not impersonate ModHeader, or try to sell it for a profit. If  you use ModHeader in any commercial product, please let me know.

## Installation

ModHeader does not require any extra tool for building. Simply load the src directory into Chrome / Firefox to start local development.

## Selenium usage

If you need to use ModHeader for Selenium tests, please visit: https://github.com/hao1300/modheader_selenium
