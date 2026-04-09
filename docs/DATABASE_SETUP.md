# 🗄️ Supabase Database Schema

This file contains all the SQL queries required to set up the database for the **Job Application Tracker (AI Blaze)** application. 

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

## 3. Maintenance Queries

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
