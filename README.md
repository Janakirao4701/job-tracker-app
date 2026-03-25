# Job Application Tracker — Chrome Extension

## First-Time Setup

After installing the extension, open `app.html` (the extension's main page) and
complete the sign-in flow. The extension reads the Supabase anon key from
`chrome.storage.local` under the key `rjd_anon_key`. You must set this once:

```js
// Run in the browser console on the extension page, or add a setup step in app.html:
chrome.storage.local.set({ rjd_anon_key: 'YOUR_SUPABASE_ANON_KEY' });
```

## Known Security Limitations

- **Gemini API key**: Stored in plain text in Supabase `user_settings`. Treat it
  as sensitive. A server-side proxy is the recommended long-term solution.
- **Supabase anon key**: Stored in `chrome.storage.local` — not in source code.
  It is still visible to any script with `storage` permission, so RLS policies
  on your Supabase project are essential.

## Changelog (v4.2.0 security/quality pass)

- Removed hardcoded Supabase anon key from all JS files
- Replaced `setTimeout`/`setInterval` in background service worker with `chrome.alarms`
- Added `icons/` folder (extension was unloadable without it)
- Added `alarms` permission to manifest
- Added `content_security_policy` to manifest
- Added `web_accessible_resources` for xlsxbuilder.js and privacy.html
- Removed xlsxbuilder.js from content_scripts (now loaded on-demand)
- Fixed `refreshToken` / `refresh_token` key mismatch across files
- Added `try/catch` to `dbSaveApp`, `dbUpdateApp`, `dbDeleteApp`
- Removed duplicate `index.html`
- Added user filter (`username=eq.`) to popup.js applications fetch
- Updated Gemini model slug to `gemini-2.0-flash`
- Blocked `javascript:` URL injection in anchor href assignment
- Replaced `Date.now().toString()` IDs with `crypto.randomUUID()`
- Added pagination (1000-row pages) to `dbLoadApps` / `loadApps`
- Fixed token refresh race condition with singleton promise guard
- Added double-submit guard on Save Application button
- Removed `landing.html` and `landing.js` (web-only, not needed in extension)
