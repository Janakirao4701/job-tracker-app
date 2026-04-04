# 📋 Job Application Tracker

A premium, AI-powered Chrome extension and centralized web dashboard that redefines how you track your job hunt. Say goodbye to messy spreadsheets and manual data entry.

![Job Tracker UI](https://via.placeholder.com/800x400.png?text=Job+Application+Tracker+Dashboard)

## 🚀 Features

- **AI-Powered Data Extraction:** Use Google's Gemini AI to instantly pull the company name, job title, and full job description from any recruitment webpage or LinkedIn job post with a single click.
- **Unified Cloud Sync:** Seamlessly syncs your applications across devices instantly using Supabase real-time databases. 
- **Universal Extension Sidebar:** Inject an elegant Glassmorphism sidebar into any webpage with a simple hotkey (`Alt+Shift+T`). Add, edit, and track jobs without ever leaving the page.
- **Beautiful Dashboard:** Manage your full pipeline through a stunning, dependency-free vanilla JS/CSS Web UI with full system-synced Dark Mode.
- **Offline Resumes to `.docx`:** Build, paste, and download ATS-friendly resumes dynamically. 
- **High-Performance Architecture:** No heavy JS frameworks. No slow loading times. Pure, optimized, lightweight vanilla Javascript and CSS.

## 🛠️ Setup & Installation

### Option 1: Chrome Extension
1. Download or clone this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing this repository.
5. Pin the extension to your toolbar!

### Option 2: Web Dashboard
Access the unified, responsive web dashboard directly via the deployed Web App:
[Launch Dashboard](https://job-tracker-app-iota-beryl.vercel.app/)

## ⌨️ Keyboard Shortcuts
- `Alt + Shift + T`: Toggle Sidebar Tracker
- `Alt + Shift + E`: Quick AI Extract & Save Application
- `Alt + Shift + N`: Open New Application Form
- `Cmd/Ctrl + S`: Save active modal/panel details
- `Alt + S`: Cycle status (Applied, Interview Scheduled, Offer, etc.) in an active detail modal.

## 💻 Tech Stack
- **Frontend:** Vanilla HTML, CSS (`styles/`), JS (`scripts/`)
- **Backend/Database:** Supabase (PostgreSQL)
- **AI Integrations:** Google Gemini Pro (`generativelanguage.googleapis.com`)
- **Document Export:** Docx (`lib/docxbuilder.js`), Excel (`lib/xlsxbuilder.js`)

## 🔒 Privacy & Permissions
This extension requests access to external APIs explicitly for **your** workflows. Applications and data are stored securely in Supabase under Row-Level Security policies tied only to your authenticated account.