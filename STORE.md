# Store metadata — Quick Reward

Last updated: 2026-09-29

## Listing

- Name: Quick Reward
- Summary: Tự đổi gift code Delta Force từ OCR / URL trên trang Garena.
- Description: TODO user-facing paragraphs before store submit.
- Category: Productivity (suggested)
- Screenshots: TODO 1280×800

## Privacy and data use

- Code lists and redeem history stay in `chrome.storage.local` on the user's device only.
- No remote analytics or third-party APIs from the extension UI pages.
- Content scripts run only on `https://redeem.df.garena.sg/*`.
- Privacy policy URL: TODO if required by store.

## Chrome Web Store

### Single purpose

Automate sequential Delta Force gift-code redemption on the official Garena redeem page when opened with a `#qr=` URL hash payload (e.g. from a local OCR workflow).

### Permissions justification

- **storage**: Persist in-progress jobs and redeem history locally.
- **sidePanel** (Chromium): Sidebar for history and current job status.
- **host_permissions `https://redeem.df.garena.sg/*`**: Content scripts inject only on the official redeem site to fill the form and show progress overlay.

## Firefox Add-ons

### Reviewer notes

1. Load unpacked from `dist/firefox` after `npm run build:firefox`.
2. Open `https://redeem.df.garena.sg/vi/cdkgarena.html#qr=TESTCODE12` (use a valid test code if available). Do not use `?code=` — Garena treats it as OAuth callback and may return HTTP 400.
3. Log in to Garena if prompted; overlay should appear. Open sidebar from toolbar for history.

Build: `npm install && npm run build:firefox`.

## Version history

- 1.0.0: Quick Reward auto-redeem from URL/OCR workflow.
