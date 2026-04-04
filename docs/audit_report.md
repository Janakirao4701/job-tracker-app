# 🔍 Full Extension Audit — Job Tracker v5.0

---

## 🔴 Critical Issues (Broken / Wrong)

### 1. `popup.js` — "Open Sidebar" button BROKEN for new floating button
The popup's "⚡ Open Sidebar" button does:
```js
const t = document.getElementById('rjd-toggle');
if (t) t.click();
```
The old toggle was a `<button>` — `.click()` worked. The new toggle is a `<div>` with custom `mousedown` logic — `.click()` now does nothing. The sidebar won't open from the popup.

**Fix:** Dispatch a real `mouseup` event, or expose a global `window.__rjdOpen()` function from content.js.

---

### 2. `sidebar.css` — Dead class `.rjd-status-sel` still exists (lines 431–443)
The status `<select>` was replaced with `.rjd-status-chip-btn` but the old CSS selector `.rjd-status-sel` is still in sidebar.css. It's unused dead code.

---

### 3. `sidebar.css` — `.rjd-extract-status` and `.rjd-extract-btn` CSS (lines 506–533)
The new Extract button panel uses **inline styles only** (hardcoded in JS). These CSS classes are now unused dead code.

---

### 4. `sidebar.css` — `.rjd-panel-header`, `.rjd-back-btn`, `.rjd-panel-body` (lines 471–504)
The new app panel rebuilt its header inline. These classes are only used by the **detail panel** and **resume panel** — but not new-app panel anymore. Keep them for detail/resume, remove unused duplicates.

---

### 5. `app.js` — Toast position broken when sidebar is closed
Toast is fixed at `right: 540px` (sidebar width) in `sidebar.css line 697`. When sidebar is not open, toast appears off-screen to the left. Should be `right: 24px` always and toast should shift when sidebar opens.

---

### 6. `content.js` — `rjd-new-back` button has TWO event listeners
`bindTrackerEvents()` adds a listener on `rjd-new-back` (line 1186), AND `showNewAppPanel()` uses the same id for the button built inline (line 1039 of old HTML). After the rebuild, the `id="rjd-new-back"` button in the new panel header has its listener added BOTH in `buildTrackerEvents` AND was set as inline. Check for double-fire.

---

## 🟠 UI/UX Problems

### 7. Stats bar in sidebar — Numbers not gradient
The popup's stat numbers use beautiful gradient text (`-webkit-background-clip: text`). The **sidebar stats** (`rjd-stat-num`) use plain `color: var(--accent-primary)` — flat and less premium.

### 8. Sidebar table — "Date" column shows full date like `Apr 2, 2026`
In a 520px sidebar this is precious space. Should show just `Apr 2` or even `02/04`.

### 9. Status chip in table too wide for sidebar
`'Interview Scheduled'` → `'Interview'` (shortened) — ✅ good. But `'Interview Done'` → `'Done'` could be confused with task completion. Consider: `'IV Done'`.

### 10. Session bar — Target dropdown takes too much vertical space
The working date + session progress bar area has 3 rows of UI. On a 720p screen this leaves very little space for the table. The session bar should be collapsible (click to expand/collapse).

### 11. App.html modal — Status still uses `<select>` dropdown
The sidebar now has chip cycling for status. The dashboard `app.html` modal still uses a raw `<select>` dropdown. Inconsistent UX.

### 12. Footer in popup — "v5.0.0" appears TWICE
The header has a `version-badge` showing "v5.0" AND the footer shows "v5.0.0". One is enough — remove from footer.

### 13. `app.html` sidebar — `🚀` emoji as logo not professional
Both the sidebar and auth card use 🚀 as the logo icon. The content.js floating button uses 📋. Three different icons for the same product. Pick one and use it everywhere.

### 14. Popup recent list — Shows last 4 by `slice(0, 4)` but no date context
Recent applications have no date shown. If I applied 3 weeks ago, it's misleading in the "Recent" section. Should either show relative date or filter to last 7 days.

### 15. Dark mode — `app.html` has no dark mode support
`sidebar.css` has full dark mode via CSS variables. `app.html`/`app.js` has NO dark mode at all. Complete visual mismatch if OS is in dark mode.

---

## 🟡 Code Quality Issues

### 16. `content.js` is 1730 lines — Needs splitting
The entire sidebar UI, extraction logic, DB calls, settings, and keyboard handlers are all in one IIFE. Hard to maintain. Should split into logical sections.

### 17. `app.js` — 1395 lines of innerHTML template strings
The entire dashboard is built by injecting long template literals. Makes it hard to read and debug. High-priority refactor.

### 18. `popup.js` — `renderLoggedIn()` called twice on load
On line 144: `renderLoggedIn(session.user, [])` — renders with empty apps. Then on line 151: `renderLoggedIn(session.user, apps)` — re-renders again. This causes a visible flash of "0 0 0 0" counters before real data loads. Should show a skeleton/loading state instead.

### 19. `config.js` — Supabase credentials hardcoded
Still in plaintext. Minimum fix: store in `chrome.storage.local` encrypted or use a server proxy for the key.

### 20. Orphaned `index.html` file (27KB!)
There's an `index.html` in the project root (27KB) that isn't referenced in `manifest.json` at all. This appears to be an old version of `app.html`. Should be deleted.

### 21. `implementation_plan.md` committed to the project root
This is a development artifact — shouldn't be in the extension package (`manifest.json` doesn't reference it but it ships with the extension).

### 22. `README.md` — Just 17 bytes
The README contains almost nothing. Should document setup, config, and features.

---

## 🟢 Missing Features (High Value)

### A. Keyboard shortcut to cycle status
`Alt+Shift+S` opens settings. There's no shortcut to quickly mark the current app as "Rejected" or "Interview". A shortcut on the row would be great.

### B. Duplicate detection on Extract is only in sidebar
The dashboard `app.html` Add Modal has no duplicate detection. You can add the same job twice from the dashboard.

### C. No confirmation before Delete
`rjd-delete-app-btn` deletes immediately with no confirmation dialog. Very easy to accidentally delete an application.

### D. Session bar target select — Options are fixed (10, 15, 20, 30, 50)
If someone wants to apply to 100/day (mass applying), the max is 50. Should allow a custom number input.

### E. No way to bulk-delete or bulk-export selected rows
The bulk action bar only supports bulk "Reassign session date". Should add bulk delete and bulk status change.

---

## 📋 Priority Fix List

| # | File | Issue | Effort |
|---|------|-------|--------|
| 1 | popup.js | Sidebar open button broken | Low |
| 2 | sidebar.css | Dead CSS classes | Low |
| 3 | sidebar.css | Toast position | Low |
| 4 | popup.js | Double render flash | Low |
| 5 | app.html | Dark mode | Medium |
| 6 | content.js | No delete confirmation | Low |
| 7 | app.html | Inconsistent logo icon | Low |
| 8 | popup.js | Duplicate version badge | Low |
| 9 | project root | Delete index.html | Trivial |
| 10 | Background.js | Nothing to fix, clean ✅ | — |

---

## ✅ Things That Are Good

- `background.js` — Clean, correct MV3 alarm-based notifications
- `sidebar.css` — CSS variable system is well-structured
- `extraction logic` — Multi-signal approach is solid after the JD-first fix
- `popup.html` — Glassmorphism design looks great
- Status chip cycling — Clean pattern
- Offline queue — Well designed
- Supabase pagination — Correctly handles >1000 rows
