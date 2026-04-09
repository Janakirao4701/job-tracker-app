# 🚀 Chrome Web Store Publishing Guide

This document provides a step-by-step guide to publishing the **Job Application Tracker** extension to the Chrome Web Store.

## 1. Developer Account Setup
1.  Go to the [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole/).
2.  Sign in with a Google Account.
3.  Pay the one-time **$5 USD developer registration fee**.

## 2. Prepare the Production Package
Before uploading, you need a clean version of the code.

> [!IMPORTANT]
> **DO NOT** upload the `node_modules` or `.git` folders. They will make the package too large and may cause a rejection.

### Files to Include:
*   `manifest.json` (Root)
*   `index.html` (Root)
*   `src/` (Entire folder)
*   `public/` (Entire folder)

### How to Zip (Command Line):
If you have a zip utility installed, run:
```bash
# Example for Windows (PowerShell)
Compress-Archive -Path manifest.json, index.html, src, public -DestinationPath production.zip
```

## 3. Upload to the Console
1.  In the Developer Console, click **+ New Item**.
2.  Upload the `production.zip` file.
3.  Fill in the **Store Listing** details:
    *   **Description:** Use the one from `package.json` or expand on it.
    *   **Category:** Productivity.
    *   **Language:** English.

## 4. Privacy & Permissions (Crucial)
Chrome reviewers are strict about the **"Single Purpose"** and **"Remote Code"** policies.

### Host Permissions Justification:
The extension requests `<all_urls>` and access to external APIs. You will be asked why. Use this justification:
> "The extension requires access to all URLs to show a floating sidebar for job application tracking and to enable AI-powered job detail extraction from various job boards (LinkedIn, Indeed, etc.). External API access is required to communicate with Google Gemini (AI extraction) and Supabase (Cloud Sync)."

### Privacy Policy:
You must provide a URL to your privacy policy. You can host `src/pages/privacy.html` on **GitHub Pages** or **Vercel**.

## 5. Required Branding Assets
*   **Icon:** 128x128 px (provided in `public/icons/icon128.png`).
*   **Screenshots:** At least one 1280x800 or 640x400 image.
*   **Small Tile:** 440x280 px (Mandatory).
*   **Marquee Tile:** 1400x560 px (Optional, for feature banners).

## 6. Submission & Review
1.  Click **Submit for Review**.
2.  The initial review usually takes **2–4 business days**.
3.  Check your email for any "Request for Clarification" from the Google review team.

---
**Version:** 1.0.0
**Build Date:** April 2026
