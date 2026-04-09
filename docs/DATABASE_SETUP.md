# 🚀 AI Blaze: Project Build Journey

This document serves as both a development log and a technical setup guide for the **Job Application Tracker (AI Blaze)**. It outlines the process of building this project from scratch to a production-ready Chrome Extension.

---

## 🏗️ The Build Process

The development of AI Blaze followed a structured path from a messy prototype to a secure, professional SaaS-style application.

### Phase 1: The Core Invention (AI Extraction)
*   **The Problem:** Manually copying job data from LinkedIn/Indeed into spreadsheets is slow and error-prone.
*   **The Solution:** We built a Content Script (`content.js`) that translates the visual mess of job boards into structured data.
*   **The Secret Sauce:** We integrated the **Google Gemini AI API** to intelligently identify "Company" and "Job Title" from raw text, making the extraction far smarter than basic scrapers.

### Phase 2: The Infrastructure (Supabase & Dashboard)
*   **Cloud Sync:** We integrated **Supabase** as our backend-as-a-service to enable real-time synchronization between the extension sidebar and a web dashboard.
*   **Dynamic Dashboard:** Created a high-performance, vanilla JS dashboard (`index.html`) that allows users to manage their entire career search in one place.

### Phase 3: Security Hardening (The "Stealth" Audit)
*   **Credential Safety:** Moved sensitive Supabase keys out of Git tracking and created `config.example.js` for public safety.
*   **Data Isolation (RLS):** Implemented **Row Level Security** on the database to ensure that "User A" can never see "User B's" data, even with the same public API keys.
*   **Auth Privacy:** Hardened the login/signup flows with generic error messages to prevent "User Enumeration" (protecting your users' privacy).

### Phase 4: Release Automation
*   **The Build Script:** Created `local-deploy.ps1`, a PowerShell automation engine that builds the extension, packages it for the Chrome Web Store, and syncs the GitHub repository in seconds.

---

## 🛠️ Tools & Technologies
- **Core:** HTML5, CSS3, Vanilla JavaScript (No heavy frameworks for maximum speed).
- **Backend:** Supabase (PostgreSQL, Auth, Realtime).
- **AI:** Google Gemini 1.5 Flash (via REST API).
- **DevOps:** PowerShell, Git, Chrome Extension Manifest V3.

---

## 🗄️ Supabase Database Schema

You can run these queries in the **Supabase SQL Editor** to recreate the tables and security policies.

---

## 1. Tables Creation

### 📋 `applications` Table
Stores all the job application data extracted by the extension.

```sql
CREATE TABLE IF NOT EXISTS public.applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL, -- The Supabase User ID (auth.uid())
    company TEXT,
    job_title TEXT,
    url TEXT,
    jd TEXT,
    resume TEXT,
    status TEXT DEFAULT 'Applied',
    date TEXT,
    date_raw TIMESTAMPTZ DEFAULT now(),
    date_key TEXT,
    notes TEXT,
    follow_up_date DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster queries per user
CREATE INDEX IF NOT EXISTS idx_applications_username ON applications(username);
```

### ⚙️ `user_settings` Table
Stores user-specific preferences, such as the resume profile.

```sql
CREATE TABLE IF NOT EXISTS public.user_settings (
    username TEXT PRIMARY KEY, -- The Supabase User ID
    resume_profile JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 2. Row Level Security (RLS) Policies

These policies ensure that users can **only see and modify their own data**.

### For `applications` Table
```sql
-- Enable RLS
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- Select Policy
CREATE POLICY "Users can view their own applications" 
ON applications FOR SELECT 
USING (auth.uid()::text = username);

-- Insert Policy
CREATE POLICY "Users can insert their own applications" 
ON applications FOR INSERT 
WITH CHECK (auth.uid()::text = username);

-- Update Policy
CREATE POLICY "Users can update their own applications" 
ON applications FOR UPDATE 
USING (auth.uid()::text = username);

-- Delete Policy
CREATE POLICY "Users can delete their own applications" 
ON applications FOR DELETE 
USING (auth.uid()::text = username);
```

### For `user_settings` Table
```sql
-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- All Access Policy
CREATE POLICY "Users can manage their own settings" 
ON user_settings FOR ALL 
USING (auth.uid()::text = username);
```

---

## 3. Auth Security Settings

These settings are configured in the **Supabase Dashboard**, not via SQL.

### 🔐 Leaked Password Protection
Prevents users from signing up with passwords found in known data breaches (via [HaveIBeenPwned.org](https://haveibeenpwned.com/)).

**To enable:**
1. Go to **Authentication → Settings** in the Supabase Dashboard.
2. Under the **Security** section, toggle **Leaked password protection** to **ON**.

> ⚠️ This feature requires the **Pro Plan** ($25/mo).

### 🔑 Password Strength Requirements
Set a minimum password length and character requirements for all new signups.

**Recommended settings:**
- Minimum password length: **12 characters**
- Require: uppercase, lowercase, digits, and symbols

---

## 4. Maintenance Queries

### Find rows that will be hidden by RLS
```sql
SELECT count(*) 
FROM applications 
WHERE username IS NULL;
```

### Claim orphan rows for a specific user
```sql
UPDATE applications 
SET username = 'YOUR-USER-ID' 
WHERE username IS NULL;
```

---

*Note: All `username` columns should match the `auth.uid()` of the authenticated user to ensure the RLS policies function correctly.*
