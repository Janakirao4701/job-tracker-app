# 🚀 Job Tracker / AI Blaze — Chrome Extension

> Premium AI-powered job application tracker with cloud sync, Gemini extraction, inline copilot, and resume generation.

![Version](https://img.shields.io/badge/version-5.1.0-blue)
![Manifest](https://img.shields.io/badge/Manifest-V3-green)
![AI](https://img.shields.io/badge/AI-Gemini%202.0-orange)
![Database](https://img.shields.io/badge/DB-Supabase-purple)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tech Stack](#tech-stack)
- [Scripts & Deployment](#scripts--deployment)
- [Stable Rollback Point](#-stable-rollback-point)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

**AI Blaze** is a Chrome/Brave extension that sits as a floating sidebar on any webpage. It lets you:

1. **Extract** job details (company, title, JD) from any job portal using Google Gemini AI
2. **Track** all your applications with status management (Applied → Interview → Offer/Rejected)
3. **Generate** tailored resumes using AI-powered resume engine with DOCX export
4. **Chat** with an AI assistant for cover letters, interview prep, and career advice
5. **Sync** everything to the cloud via Supabase — access from any device

The extension also includes an **inline Copilot** that adds a floating toolbar on text selections for instant AI actions (summarize, rewrite, explain).

---

## Features

### 🤖 AI-Powered Job Extraction
- One-click extraction with **✦ Extract & Save**
- Reads clipboard OR scrapes page body text automatically
- Multi-layer extraction: DOM selectors → Structured Data (JSON-LD) → Gemini AI
- Supports LinkedIn, Indeed, Naukri, Glassdoor, Wellfound, Internshala, Greenhouse, Lever, Workday, and all ATS platforms
- Auto-detects company from URL hostname, logo, and meta tags

### 📊 Application Dashboard
- Real-time stats bar (Today's count, session target, weekly total)
- Filterable, searchable table with status badges
- Inline editing for status, notes, and follow-up dates
- Bulk operations and XLSX export
- Configurable "Work Day" start time for night-shift users

### 📝 Resume Engine
- Parses existing resume content with high fidelity
- Generates tailored resumes matched to job descriptions
- Exports to DOCX format with professional formatting
- Copy-to-clipboard for quick use

### 💬 AI Assistant
- Built-in chat interface powered by Gemini
- Context-aware responses using your application data
- Supports cover letter generation, interview prep, and career advice

### ✨ Inline Copilot (v2.0)
- Floating toolbar appears on text selection
- Actions: Summarize, Rewrite, Explain, Fix Grammar
- Shadow DOM isolation — zero interference with page styles
- Works on any webpage

### 🔔 Interview Notifications
- Background alarm checks for today's scheduled interviews
- Chrome desktop notifications with company name and role
- One notification per day per interview

### 🌗 Theme Support
- Light, Dark, and Auto (system preference) modes
- Full theme support across sidebar, dashboard, and popup

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
├────────────┬────────────────┬────────────────────┤
│  Popup     │  Content Script│  Background SW     │
│  (popup.js)│  (content.js)  │  (background.js)   │
│            │  (copilot.js)  │                    │
│  Auth UI   │  Sidebar UI    │  Session broadcast │
│  Quick     │  Extraction    │  Proxy fetch       │
│  links     │  AI Chat       │  Interview alarms  │
│            │  Resume Gen    │  Keyboard shortcuts │
├────────────┴────────────────┴────────────────────┤
│                Libraries                         │
│  config.js │ resume-engine.js │ docx-bundle.js   │
│  xlsxbuilder.js │ FileSaver.min.js               │
├──────────────────────────────────────────────────┤
│              External Services                   │
│  Google Gemini API  │  Supabase (Auth + DB)      │
│  Vercel Dashboard   │  GitHub Pages              │
└──────────────────────────────────────────────────┘
```

---

## Project Structure

```
job-tracker-app/
├── manifest.json              # Chrome Extension manifest (MV3)
├── package.json               # Node.js metadata & scripts
├── build.js                   # Syncs app.html → index.html
├── deploy.ps1                 # One-click deployment script
├── index.html                 # Dashboard (GitHub Pages / Vercel)
├── resume-pro.html            # Standalone resume builder
├── sw.js                      # PWA service worker
├── vercel.json                # Vercel routing config
│
├── src/
│   ├── scripts/
│   │   ├── content.js         # Main content script (sidebar, extraction, chat)
│   │   ├── copilot.js         # Inline AI copilot with floating toolbar
│   │   ├── background.js      # MV3 service worker (alarms, proxy, shortcuts)
│   │   ├── popup.js           # Extension popup logic
│   │   └── app.js             # Dashboard application logic
│   │
│   ├── lib/
│   │   ├── config.js          # Supabase URL & Anon key
│   │   ├── resume-engine.js   # Resume parser + DOCX generator
│   │   ├── docx-bundle.js     # docx.js library bundle
│   │   ├── FileSaver.min.js   # FileSaver.js for downloads
│   │   └── xlsxbuilder.js     # XLSX export builder (lazy-loaded)
│   │
│   ├── pages/
│   │   ├── app.html           # Full dashboard page
│   │   ├── popup.html         # Extension popup
│   │   ├── privacy.html       # Privacy policy
│   │   └── resume_maker.html  # Advanced resume maker
│   │
│   └── styles/
│       ├── sidebar.css        # Sidebar & content script styles
│       └── app.css            # Dashboard styles
│
├── public/
│   ├── icons/                 # Extension icons (16/32/48/128px)
│   └── assets/                # Images and static assets
│
└── docs/                      # Documentation
```

---

## Installation

### Load as Unpacked Extension (Development)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Janakirao4701/job-tracker-app.git
   cd job-tracker-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Load in Chrome/Brave:**
   - Navigate to `chrome://extensions` (or `brave://extensions`)
   - Enable **Developer mode** (toggle in top-right)
   - Click **"Load unpacked"**
   - Select the `job-tracker-app` folder

4. **Pin the extension** for quick access from the toolbar

### After Code Changes
- Go to `chrome://extensions`
- Click the **🔄 reload** button on the extension card
- **Close** existing tabs and **open new ones** (old tabs keep stale content scripts)

---

## Configuration

### 1. Gemini API Key
- Click the extension icon → Open Sidebar → ⚙ Settings
- Enter your [Google AI Studio API Key](https://aistudio.google.com/app/apikey)
- Select a model (default: `gemini-2.0-flash`)

### 2. Available Models
| Model | Speed | Quality | Free Tier |
|-------|-------|---------|-----------|
| `gemini-2.0-flash` | ⚡ Fast | ★★★★ | ✅ |
| `gemini-2.5-flash-lite` | ⚡⚡ Fastest | ★★★ | ✅ |
| `gemini-2.5-pro` | 🐢 Slower | ★★★★★ | Limited |

### 3. Supabase
- The extension uses Supabase for cloud storage
- Configuration is in `src/lib/config.js`
- Database is secured with **Row Level Security (RLS)**
- Users authenticate via email/password through the popup

### 4. Session Target
- Set a daily application goal in Settings
- The stats bar tracks progress toward your target

### 5. Work Day Start
- Configure when your "work day" begins (default: 6 PM)
- Applications after this hour count toward the current day's session
- Useful for night-shift job hunters

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+T` | Toggle sidebar open/close |
| `Alt+Shift+E` | Extract & Save current job |
| `Alt+Shift+N` | Open new application form |
| `Alt+Shift+S` | Open settings |

Customize in `chrome://extensions/shortcuts`

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Extension** | Chrome Manifest V3 |
| **AI Engine** | Google Gemini API (v1 + v1beta fallback) |
| **Database** | Supabase (PostgreSQL + Auth) |
| **Dashboard** | Vanilla HTML/CSS/JS (Vercel + GitHub Pages) |
| **Resume Export** | docx.js + FileSaver.js |
| **Spreadsheet Export** | Custom XLSX builder |
| **Copilot UI** | Shadow DOM injection |
| **Styling** | Custom CSS with CSS variables (dark/light themes) |

---

## Scripts & Deployment

### Build
```bash
npm run build
```
Syncs `src/pages/app.html` → `index.html` for GitHub Pages.

### Deploy
```powershell
.\deploy.ps1
```
Runs build, commits changes, and pushes to GitHub (auto-deploys via GitHub Pages).

### Full Deploy
```bash
npm run deploy
```
Runs build + deploy in one command.

---

## 🛡️ Stable Rollback Point

> [!IMPORTANT]
> **If you encounter any errors after future changes, rollback to this stable commit:**
>
> ```
> Commit: 48263181b518394d7a384c7f6a4acaa55a52fbef
> Date:   2026-04-09
> Message: fix(blaze): switch to stable v1 API and add model selector
> ```
>
> **To rollback:**
> ```bash
> git reset --hard 48263181b518394d7a384c7f6a4acaa55a52fbef
> ```
>
> Then reload the extension in `chrome://extensions`.
>
> This commit includes all security fixes, `.trim()` crash fixes, deprecated model migration, clipboard safety, and the background service worker `importScripts` path fix.

### What's Included in This Stable Build
- ✅ Gemini 2.0 Flash as default model (auto-migrates deprecated models)
- ✅ All `.trim()` crash paths fixed with defensive try-catch wrappers
- ✅ `dbLoadApps` filtered by user ID (security fix)
- ✅ Popup null-session crash fixed
- ✅ XSS protection in copilot modal
- ✅ Shadow DOM event targeting fix
- ✅ XLSX export path corrected
- ✅ Clipboard `undefined` handling
- ✅ Background service worker `importScripts` path fixed
- ✅ Silent failures replaced with diagnostic logging

---

## Troubleshooting

### "Extension context invalidated"
**Cause:** Extension was reloaded but the page still has the old content script.  
**Fix:** Refresh the page (F5 or Ctrl+R).

### "Gemini Error: model not found"
**Cause:** The configured model has been deprecated by Google.  
**Fix:** The extension auto-migrates known deprecated models. If a new model is deprecated, change it in Settings.

### Sidebar doesn't appear
**Cause:** Content script not injected on restricted pages (`chrome://`, `brave://`, `about:`).  
**Fix:** Navigate to a regular webpage.

### XLSX Export fails
**Cause:** `xlsxbuilder.js` lazy-loading path might be wrong.  
**Fix:** Verify `src/lib/xlsxbuilder.js` exists and is listed in `web_accessible_resources` in `manifest.json`.

### Blank popup for logged-out users
**Fix:** Already patched — null check added for session object.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

**Built with ❤️ by [Janakirao](https://github.com/Janakirao4701)**