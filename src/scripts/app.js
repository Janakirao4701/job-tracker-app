
const SUPABASE_URL = CONFIG.SUPABASE_URL;
// Extension ID - update this after publishing to Chrome Web Store
// For now using runtime detection
// Extension ID - this is set after the extension is installed
// chrome.runtime.id works when page is opened FROM the extension
// For external pages (Vercel), we use externally_connectable messaging
const EXT_ID = new URLSearchParams(window.location.search).get('ext_id') || null;
const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

const STATUS_COLORS = {
  'Applied':             's-applied',
  'Interview Scheduled': 's-interview',
  'Interview Done':      's-done',
  'Offer':               's-offer',
  'Rejected':            's-rejected',
  'Skipped':             's-skipped',
};
const STATUS_BG = {
  'Applied':             { bg:'#eef2ff', color:'#4f46e5' },
  'Interview Scheduled': { bg:'#ecfdf5', color:'#059669' },
  'Interview Done':      { bg:'#fffbeb', color:'#d97706' },
  'Offer':               { bg:'#d1fae5', color:'#065f46' },
  'Rejected':            { bg:'#fef2f2', color:'#dc2626' },
  'Skipped':             { bg:'#f1f5f9', color:'#94a3b8' },
};
const STATUSES = ['Applied','Interview Scheduled','Interview Done','Offer','Rejected','Skipped'];

let session     = null;
let currentUser = null;
let apps        = [];
let currentPage = 'dashboard';
let authMode    = 'signin';

// ── THEME LOGIC ──
let isDarkMode = localStorage.getItem('rjd_theme') === 'dark';
if (isDarkMode) document.documentElement.setAttribute('data-theme', 'dark');

function toggleTheme() {
  isDarkMode = !isDarkMode;
  if (isDarkMode) {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('rjd_theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('rjd_theme', 'light');
  }
}
let filterStatus = 'all';
let filterSearch = '';
let filterDate   = workTodayISO();
let isBulkMode   = false;
let currentDetailApp = null;

// ── UTILS ──
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}
function today() { return new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function todayISO() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ── WORK DAY LOGIC ──
// Your work day STARTS in the evening (default 6pm) and runs until the next evening.
// So 6pm Mon → 5:59pm Tue = all labelled as "Mon" (the day it started).
// Apps at 11pm Mon, 2am Tue, 9am Tue, 4pm Tue → all count as Mon's work day.
function getWorkDayStart() {
  return parseInt(localStorage.getItem('rjd_workday_start') || '18', 10); // default 6pm
}
function saveWorkDayStart(hour) {
  localStorage.setItem('rjd_workday_start', String(hour));
}
// Aliases used by the Settings UI (Night Shift Cutoff)
function getWorkDayCutoff() { return parseInt(localStorage.getItem('rjd_workday_cutoff') || '0', 10); }
function saveWorkDayCutoff(hour) { localStorage.setItem('rjd_workday_cutoff', String(hour)); }
// Returns the ISO work-day string (YYYY-MM-DD) for a given dateRaw timestamp
// Logic: if hour >= workDayStart → work day = today (the session just started)
//        if hour <  workDayStart → work day = yesterday (still in last night's session)
function getWorkDayISO(dateRaw) {
  if (!dateRaw) return '';
  const d = new Date(dateRaw);
  const startHour = getWorkDayStart();
  if (d.getHours() < startHour) {
    // Before today's session start → belongs to yesterday's work day
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Work-day ISO for right now
function workTodayISO() {
  return getWorkDayISO(new Date().toISOString());
}

// Fix #22: Verify if the JWT token belongs to the current Supabase project
function verifyTokenProject(token) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // The 'ref' or 'iss' usually contains the project identifier
    const projectRef = payload.ref || (payload.iss && payload.iss.includes('supabase') ? payload.iss.split('/')[2].split('.')[0] : null);
    if (projectRef && !SUPABASE_URL.includes(projectRef)) {
      console.warn('AI Blaze (Dashboard): Session token project mismatch detected!', { tokenProj: projectRef, currentProj: SUPABASE_URL });
      return false;
    }
  } catch (e) { return false; }
  return true;
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── SECURITY LOGGING (Rule 8) ──
const SecurityLogger = {
  log(event, details = {}) {
    console.info(`[SECURITY] ${event}`, {
      timestamp: new Date().toISOString(),
      ...details
    });
  },
  warn(event, details = {}) {
    console.warn(`[SECURITY-ALERT] ${event}`, {
      timestamp: new Date().toISOString(),
      ...details
    });
  }
};

function headers(extra) {
  const token = session?.access_token || session?.token || SUPABASE_KEY;
  return { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+token, ...extra };
}

// ── SUPABASE AUTH ──
async function signIn(email, password) {
  const r = await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password', {
    method:'POST', headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
    body: JSON.stringify({email, password})
  });
  try { return await r.json(); } catch(e) { return { error: 'Server error ('+r.status+')' }; }
}
async function signUp(email, password, name) {
  const r = await fetch(SUPABASE_URL+'/auth/v1/signup', {
    method:'POST', headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
    body: JSON.stringify({email, password, data:{full_name:name}})
  });
  try { return await r.json(); } catch(e) { return { error: 'Server error ('+r.status+')' }; }
}
async function forgotPassword(email) {
  const r = await fetch(SUPABASE_URL+'/auth/v1/recover', {
    method:'POST', headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
    body: JSON.stringify({email})
  });
  return r.ok;
}
async function signOut() {
  await fetch(SUPABASE_URL+'/auth/v1/logout', { method:'POST', headers:headers() });
}

// ── SUPABASE DB ──
let totalAppCount = 0;
let hasFullHistory = false;

async function fetchTotalCount() {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?select=count&username=eq.${currentUser.id}`,
      { headers: headers({ 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }) }
    );
    const countRange = r.headers.get('content-range');
    if (countRange && countRange.includes('/')) {
      totalAppCount = parseInt(countRange.split('/')[1]) || 0;
    }
  } catch(e) { console.error('Count fetch failed', e); }
}

async function loadApps(days = 30) {
  const PAGE_SIZE = 1000;
  let allRows = [];
  let offset  = 0;
  let fetchSuccess = false;
  const LIST_FIELDS = 'id,company,job_title,url,status,date,date_raw,date_key,notes,follow_up_date';
  
  // First, get the total count for the badges
  await fetchTotalCount();

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceISO = since.toISOString().split('T')[0];

  while (true) {
    let url = `${SUPABASE_URL}/rest/v1/applications?select=${LIST_FIELDS}&username=eq.${currentUser.id}&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`;
    if (days !== 'all') {
      url += `&created_at=gte.${sinceISO}`;
    }

    let r = await fetch(url, { headers: headers({ 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE_SIZE - 1}` }) });
    
    if (r.status === 401) {
      let refreshed = false;
      if (session?.refresh_token && offset === 0) {
        refreshed = await refreshToken();
      }
      if (refreshed) {
        r = await fetch(url, { headers: headers({ 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE_SIZE - 1}` }) });
      } else {
        clearStoredSession();
        session = null; currentUser = null; apps = [];
        showSection('auth-section'); setMode('signin');
        return [];
      }
    }
    if (!r.ok) break;
    fetchSuccess = true;
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  
  hasFullHistory = (days === 'all');
  
  if (allRows.length === 0) {
    try {
      const cached = JSON.parse(localStorage.getItem(`rjd_apps_cache_${currentUser.id}`) || '[]');
      if (cached.length > 0) {
        if (!fetchSuccess) {
          console.warn('AI Blaze: DB fetch failed; using local cache.');
        } else {
          console.log('AI Blaze: DB empty; using local cache.');
        }
        return cached;
      }
    } catch(e) {}
  }
  
  const mapped = allRows.map(mapRow);
  if (mapped.length > 0) {
    localStorage.setItem(`rjd_apps_cache_${currentUser.id}`, JSON.stringify(mapped));
  }
  return mapped;
}

// Fix #15: Single in-flight promise prevents multiple simultaneous refresh calls
let _refreshPromise = null;
async function refreshToken() {
  if (!session?.refresh_token) return false;
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      const data = await r.json();
      if (data.access_token) {
        session = { access_token: data.access_token, refresh_token: data.refresh_token || session.refresh_token };
        // Fix #16: keep chrome.storage as the single source of truth; update localStorage as a mirror only
        const stored = loadStoredSession();
        if (stored) {
          stored.token = data.access_token;
          stored.access_token = data.access_token;
          if (data.refresh_token) stored.refreshToken = data.refresh_token;
          localStorage.setItem('rjd_web_session', JSON.stringify(stored));
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get('rjd_session', (res) => {
            const sess = res.rjd_session || {};
            sess.token = data.access_token;
            if (data.refresh_token) sess.refreshToken = data.refresh_token;
            chrome.storage.local.set({ rjd_session: sess });
          });
        }
        return true;
      }
    } catch(e) {}
    return false;
  })();
  try { return await _refreshPromise; } finally { _refreshPromise = null; }
}
function mapRow(r) {
  return { id:r.id, company:r.company||'', jobTitle:r.job_title||'', url:r.url||'',
    jd:r.jd||'', resume:r.resume||'', status:r.status||'Applied',
    date:r.date||'', dateRaw:r.date_raw||'', dateKey:r.date_key||'', notes:r.notes||'',
    followUpDate:r.follow_up_date||'' };
}
async function dbLoadAppDetails(id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/applications?username=eq.${currentUser.id}&id=eq.${id}&select=jd,resume`, { headers: headers() });
    const data = await res.json();
    if (Array.isArray(data) && data[0]) return data[0];
  } catch(e) {}
  return null;
}
async function dbCheckForChanges() {
  if (!currentUser) return [];
  try {
    let url = `${SUPABASE_URL}/rest/v1/applications?username=eq.${currentUser.id}&select=id,status&order=created_at.asc`;
    if (!hasFullHistory) {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      url += `&created_at=gte.${since.toISOString().split('T')[0]}`;
    }
    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch(e) { return []; }
}
async function saveApp(app) {
  const r = await fetch(SUPABASE_URL+'/rest/v1/applications', {
    method:'POST', headers:headers({'Prefer':'return=minimal'}),
    body: JSON.stringify({
      id:app.id, username:currentUser.id,
      company:app.company, job_title:app.jobTitle, url:app.url,
      jd:app.jd, resume:app.resume||'', status:app.status,
      date:app.date, date_raw:app.dateRaw, date_key:app.dateKey,
      notes:app.notes||'', follow_up_date:app.followUpDate||null
    })
  });
  return r.ok;
}
async function updateApp(app) {
  const r = await fetch(SUPABASE_URL+'/rest/v1/applications?id=eq.'+app.id, {
    method:'PATCH', headers:headers({'Prefer':'return=minimal'}),
    body: JSON.stringify({
      company:app.company, job_title:app.jobTitle, url:app.url,
      jd:app.jd, resume:app.resume||'', status:app.status,
      date:app.date||'', date_key:app.dateKey||'',
      notes:app.notes||'', follow_up_date:app.followUpDate||null
    })
  });
  return r.ok;
}
async function deleteApp(id) {
  const r = await fetch(SUPABASE_URL+'/rest/v1/applications?id=eq.'+id, {
    method:'DELETE', headers:headers()
  });
  return r.ok;
}

// ── SESSION ──
// ── AI KEY — multi-provider (Gemini/OpenAI) ──
async function saveAIKeyDB(provider, key) {
  const storageSuffix = provider === 'google' ? 'gemini' : provider;
  
  // Security Fix: Save ONLY to local browser storage to avoid cloud exposure
  localStorage.setItem(`rjd_${storageSuffix}_key_` + currentUser.id, key);
  
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const syncObj = {}; 
    syncObj[`rjd_${storageSuffix}_key`] = key;
    chrome.storage.local.set(syncObj);
  }
  
  console.log(`AI Config: ${provider} key saved locally.`);
  return { ok: true, provider };
}

async function loadAIKeyDB(provider) {
  const storageSuffix = provider === 'google' ? 'gemini' : provider;
  const localKey = localStorage.getItem(`rjd_${storageSuffix}_key_` + currentUser.id);
  // Also check legacy shared key
  const globalKey = localStorage.getItem(`rjd_${storageSuffix}_key`);
  
  if (localKey) return localKey;
  if (globalKey) return globalKey;
  
  return '';
}

// Backward compatibility or internal aliases
async function saveGeminiKeyDB(key) { return saveAIKeyDB('google', key); }
async function loadGeminiKeyDB() { return loadAIKeyDB('google'); }

async function saveAIModelDB(provider, model) {
  const storageSuffix = provider === 'google' ? 'gemini' : provider;
  localStorage.setItem(`rjd_${storageSuffix}_model`, model);
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const syncObj = {}; 
    syncObj[`rjd_${storageSuffix}_model`] = model;
    chrome.storage.local.set(syncObj);
  }
  return true;
}

async function loadAIModelDB(provider) {
  const storageSuffix = provider === 'google' ? 'gemini' : provider;
  return localStorage.getItem(`rjd_${storageSuffix}_model`) || 'gemini-1.5-flash';
}

// ── RESUME PROFILE DB SYNC ──
async function saveResumeProfileDB(profile) {
  try {
    // 1. Attempt PATCH (Update only specific column)
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?username=eq.${currentUser.id}`, {
      method: 'PATCH',
      headers: headers({'Prefer': 'return=representation'}),
      body: JSON.stringify({ resume_profile: profile })
    });
    
    // 2. If no record was updated, attempt POST (Insert)
    const patchData = await patchRes.json().catch(() => []);
    if (!patchRes.ok || (patchData && patchData.length === 0)) {
       await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: 'POST',
        headers: headers({'Prefer': 'resolution=merge-duplicates'}),
        body: JSON.stringify({
          username: currentUser.id,
          resume_profile: profile 
        })
      });
    }
    
    localStorage.setItem('rjd_resume_profile', JSON.stringify(profile));
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ rjd_resume_profile: profile });
    }
    return true;
  } catch(e) {}
  // Fallback to local
  localStorage.setItem('rjd_resume_profile', JSON.stringify(profile));
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.set({ rjd_resume_profile: profile });
  }
  return false;
}

async function loadResumeProfileDB() {
  // Load from Supabase
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?username=eq.${currentUser.id}&select=resume_profile`,
      { headers: headers() }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && data[0].resume_profile) {
        const p = data[0].resume_profile;
        localStorage.setItem('rjd_resume_profile', JSON.stringify(p));
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ rjd_resume_profile: p });
        }
        return p;
      }
    }
  } catch(e) {}
  // Fallback to local
  try { return JSON.parse(localStorage.getItem('rjd_resume_profile') || '{}'); } catch(e) { return {}; }
}

// ── BLAZE SHORTCUTS DB SYNC ──
async function saveBlazeShortcutsDB(shortcuts) {
  try {
    // 1. Attempt PATCH (Update only specific column)
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?username=eq.${currentUser.id}`, {
      method: 'PATCH',
      headers: headers({'Prefer': 'return=representation'}),
      body: JSON.stringify({ blaze_shortcuts: shortcuts })
    });
    
    // 2. If no record was updated (404-like behavior or empty representation), attempt POST (Insert)
    const patchData = await patchRes.json().catch(() => []);
    if (!patchRes.ok || (patchData && patchData.length === 0)) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: 'POST',
        headers: headers({'Prefer': 'resolution=merge-duplicates'}),
        body: JSON.stringify({
          username: currentUser.id,
          blaze_shortcuts: shortcuts 
        })
      });
    }
    
    localStorage.setItem('rjd_blaze_shortcuts', JSON.stringify(shortcuts));
    return true;
  } catch(e) { console.error('Blaze save error:', e); }
  localStorage.setItem('rjd_blaze_shortcuts', JSON.stringify(shortcuts));
  return false;
}

async function loadBlazeShortcutsDB() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?username=eq.${currentUser.id}&select=blaze_shortcuts`,
      { headers: headers() }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && data[0].blaze_shortcuts) {
        const s = data[0].blaze_shortcuts;
        localStorage.setItem('rjd_blaze_shortcuts', JSON.stringify(s));
        return s;
      }
    }
  } catch(e) { console.error('Blaze load error:', e); }
  try { return JSON.parse(localStorage.getItem('rjd_blaze_shortcuts') || 'null'); } catch(e) { return null; }
}

function saveSession(data) {
  const payload = {
    token: data.access_token,
    refreshToken: data.refresh_token || '',
    user: {
      id:    data.user.id,
      email: data.user.email,
      name:  data.user.user_metadata?.full_name || data.user.email.split('@')[0]
    }
  };

  // Save to localStorage for web app
  localStorage.setItem('rjd_web_session', JSON.stringify(payload));

  // Save to chrome.storage — works because app.html is an extension page
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ rjd_session: payload }, () => {
      // Tell background to push to all tabs
      chrome.runtime.sendMessage({ action: 'session_saved', payload }, () => {
        if (chrome.runtime.lastError) {} // ignore
      });
    });
  }
}
function loadStoredSession() {
  try { return JSON.parse(localStorage.getItem('rjd_web_session')); } catch { return null; }
}
function clearStoredSession() {
  localStorage.removeItem('rjd_web_session');
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('rjd_session', () => {
      chrome.runtime.sendMessage({ action: 'session_cleared' }, () => {
        if (chrome.runtime.lastError) { /* ignore No SW errors */ }
      });
    });
  }
}

// ── AUTH SETUP ──
function setupAuth() {
  const stored = loadStoredSession();
  if (stored && (stored.access_token || stored.token)) {
    // Support both old format (access_token) and new format (token)
    session = stored.access_token
      ? { access_token: stored.access_token, refresh_token: stored.refresh_token }
      : { access_token: stored.token, refresh_token: stored.refreshToken };
    currentUser = stored.user
      ? { id: stored.user.id, email: stored.user.email, name: stored.user.name || stored.user.email.split('@')[0] }
      : null;
    if (currentUser) { showApp(); return; }
  }
  showSection('auth-section');
}

document.getElementById('tab-signin').addEventListener('click', () => setMode('signin'));
document.getElementById('tab-signup').addEventListener('click', () => setMode('signup'));
document.getElementById('auth-switch-btn').addEventListener('click', () => setMode(authMode === 'signin' ? 'signup' : 'signin'));

function setMode(mode) {
  authMode = mode;
  const isSignIn = mode === 'signin';
  document.getElementById('tab-signin').classList.toggle('active', isSignIn);
  document.getElementById('tab-signup').classList.toggle('active', !isSignIn);
  document.getElementById('auth-title').textContent = isSignIn ? 'Welcome back' : 'Create account';
  document.getElementById('auth-sub').textContent   = isSignIn ? 'Sign in to your account' : 'Start tracking your job search';
  document.getElementById('field-name').classList.toggle('hidden', isSignIn);
  document.getElementById('forgot-row').classList.toggle('hidden', !isSignIn);
  document.getElementById('auth-submit').textContent = isSignIn ? 'Sign in' : 'Create account';
  document.getElementById('auth-switch-text').textContent = isSignIn ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('auth-switch-btn').textContent  = isSignIn ? 'Sign up' : 'Sign in';
  document.getElementById('auth-msg').innerHTML = '';
}

document.getElementById('auth-submit').addEventListener('click', async () => {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name     = document.getElementById('auth-name').value.trim();
  const btn      = document.getElementById('auth-submit');

  if (!email || !password) { showAuthMsg('Please fill in all fields', true); return; }
  if (authMode === 'signup' && password.length < 6) { showAuthMsg('Password must be at least 6 characters', true); return; }

  btn.disabled = true;
  btn.textContent = authMode === 'signin' ? 'Signing in...' : 'Creating account...';

  try {
    const data = authMode === 'signin' ? await signIn(email, password) : await signUp(email, password, name);

    if (data.error || data.error_description || data.msg || data.message) {
      const raw = data.error_description || data.error_code || data.error || data.msg || data.message || '';
      SecurityLogger.warn(authMode === 'signin' ? 'Login Failed' : 'Signup Failed', { email, rawError: raw });

      let friendly = 'Something went wrong. Please try again.';
      if (/invalid.*(login|credentials)/i.test(raw))               friendly = 'Incorrect email or password.';
      // Rule 2 & 4: Use generic response for existing users to prevent enumeration
      else if (/already.*registered|user.*exists/i.test(raw))      {
        friendly = 'If an account with this email exists, a verification link has been sent.';
        showAuthMsg(friendly, false); // Show as success/neutral
        btn.disabled = false; btn.textContent = 'Create account';
        return;
      }
      else if (/password.*weak|weak.*password|should contain/i.test(raw)) friendly = 'Password is too weak. Use a mix of letters, numbers and symbols.';
      else if (/password.*characters|at least/i.test(raw))         friendly = 'Password must be at least 6 characters.';
      else if (/invalid.*email/i.test(raw))                        friendly = 'Please enter a valid email address.';
      else if (raw)                                                  friendly = raw;
      showAuthMsg(friendly, true);
      btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
      return;
    }

    if (!data.access_token || !data.user || !data.user.id) {
      showAuthMsg('Sign in failed. Please check your email and password.', true);
      btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
      return;
    }

    session     = data;
    currentUser = {
      id:    data.user.id,
      email: data.user.email,
      name:  data.user.user_metadata?.full_name || data.user.email.split('@')[0]
    };
    saveSession(data);
    showApp();
  } catch(e) {
    if (!navigator.onLine) {
      showAuthMsg('No internet connection. Please check your network and try again.', true);
    } else {
      showAuthMsg('Could not connect to the server. Please try again.', true);
    }
    btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  }
});

document.getElementById('auth-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('auth-submit').click();
});

const showPwdBtn = document.getElementById('auth-show-password');
if (showPwdBtn) {
  let isPwdShown = false;
  showPwdBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isPwdShown = !isPwdShown;
    document.getElementById('auth-password').type = isPwdShown ? 'text' : 'password';
    showPwdBtn.textContent = isPwdShown ? '🙈' : '👁️';
  });
}

function showAuthMsg(msg, isError) {
  document.getElementById('auth-msg').innerHTML =
    `<div class="auth-msg ${isError?'error':'success'}">${esc(msg)}</div>`;
}

// Forgot password
document.getElementById('forgot-btn').addEventListener('click', () => {
  showSection('forgot-section');
});
document.getElementById('back-to-signin').addEventListener('click', () => {
  showSection('auth-section');
});
document.getElementById('forgot-submit').addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { document.getElementById('forgot-msg').innerHTML = '<div class="auth-msg error">Enter your email</div>'; return; }
  const ok = await forgotPassword(email);
  document.getElementById('forgot-msg').innerHTML = ok
    ? '<div class="auth-msg success">Reset link sent! Check your inbox.</div>'
    : '<div class="auth-msg error">Something went wrong. Try again.</div>';
});

// ── SHOW APP ──
async function showApp() {
  showSection('app-section');
  // Topbar user info
  function updateUserInfo(u) {
    const ta = document.getElementById('topbar-avatar');
    const tn = document.getElementById('topbar-name');
    const te = document.getElementById('topbar-email');
    const ma = document.getElementById('m-avatar');
    const mn = document.getElementById('m-name');
    const me = document.getElementById('m-email');
    const init = initials(u.name);
    if (ta) ta.textContent = init;
    if (tn) tn.textContent = u.name;
    if (te) te.textContent = u.email;
    if (ma) ma.textContent = init;
    if (mn) mn.textContent = u.name;
    if (me) me.textContent = u.email;
  }
  updateUserInfo(currentUser);

  // Click topbar user → go to settings
  const tb = document.getElementById('topbar-user-btn');
  if (tb) tb.addEventListener('click', () => navigateTo('settings'));
  
  // Set max date for static date inputs (past/today only)
  const todayVal = todayISO();
  const sDateInp = document.getElementById('detail-session-date-input');
  if (sDateInp) sDateInp.setAttribute('max', todayVal);
  
  // ── MOBILE DRAWER LOGIC ──
  const drawer = document.getElementById('mobile-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const toggleBtn = document.getElementById('menu-toggle-btn');
  const closeBtn = document.getElementById('drawer-close-btn');

  function toggleDrawer(open) {
    if (!drawer || !overlay) return;
    drawer.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (toggleBtn) toggleBtn.addEventListener('click', () => toggleDrawer(true));
  if (closeBtn) closeBtn.addEventListener('click', () => toggleDrawer(false));
  if (overlay) overlay.addEventListener('click', () => toggleDrawer(false));
  
  // Theme buttons
  const themeBtn = document.getElementById('theme-btn');
  const mThemeBtn = document.getElementById('m-theme-btn');
  const updateThemeBtns = () => {
    const text = isDarkMode ? '☀️ Light' : '🌙 Dark';
    if (themeBtn) themeBtn.textContent = text;
    if (mThemeBtn) mThemeBtn.textContent = text;
  };
  updateThemeBtns();
  [themeBtn, mThemeBtn].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      toggleTheme();
      updateThemeBtns();
    });
  });
  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '↻ Refreshing...';
      refreshBtn.disabled = true;
      apps = await loadApps();
      updateBadge();
      renderPage(currentPage);
      refreshBtn.textContent = '↻ Refresh';
      refreshBtn.disabled = false;
      showToast('Refreshed ✓');
    });
  }
  showLoading();
  apps = await loadApps();
  // Auto-refresh token every 50 minutes
  if (!window._appRefreshTimer) {
    window._appRefreshTimer = setInterval(async () => {
      await refreshToken();
    }, 50 * 60 * 1000);
  }
  // ── BACKGROUND SYNC: poll for changes from other browsers/sessions ──
  if (!window._appSyncTimer) {
    window._appSyncTimer = setInterval(async () => {
      if (!session || !currentUser || document.hidden) return; 
      try {
        const lightApps = await dbCheckForChanges();
        if (!lightApps.length && apps.length) return; // ignore if empty/fail

        // Fast signature check on ID and Status only
        const newSig = lightApps.length + '|' + lightApps.map(a => a.id + a.status).join('|');
        if (window._lastAppSig !== newSig) {
          window._lastAppSig = newSig;
          // If something changed, do a full lightweight load (still excludes JD/Resume)
          apps = await loadApps();
          updateBadge();
          renderPage(currentPage);
        }
      } catch(e) {}
    }, 60000); 
  }
  // Load and sync Gemini key to extension (non-blocking)
  loadGeminiKeyDB().then(key => {
    if (key && typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ rjd_gemini_key: key });
    }
  }).catch(() => {});
  // Signout buttons
  const signoutBtn = document.getElementById('signout-btn');
  const mSignoutBtn = document.getElementById('m-signout-btn');
  [signoutBtn, mSignoutBtn].forEach(btn => {
    if (btn) btn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to exit?')) return;
      await signOut();
      clearStoredSession();
      window.location.reload();
    });
  });

  // Restore last page from URL hash (persist across refresh)
  const validPages = ['dashboard','applications','aiblaze','settings','export','privacy','about'];
  const hashPage = window.location.hash.replace('#','');
  navigateTo(validPages.includes(hashPage) ? hashPage : 'dashboard');

  // ✨ CSP COMPLIANCE: Global Event Delegation for Dynamic Content
  document.getElementById('page-content').addEventListener('click', e => {
    const target = e.target;
    // 1. AI-Blaze Manage Keys Shortcut
    if (target.closest('.blaze-manage-btn')) {
      navigateTo('settings'); settingsSection = 'apikey'; renderSettings();
      return;
    }
    // 2. Settings Password Toggle
    if (target.dataset.togglePassword) {
      const input = document.getElementById(target.dataset.togglePassword);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        target.textContent = input.type === 'password' ? 'Show' : 'Hide';
      }
      return;
    }
  });
}

function showSection(id) {
  ['auth-section','forgot-section','app-section'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function showLoading() {
  document.getElementById('page-content').innerHTML = '<div style="padding:60px;text-align:center"><div class="spinner"></div></div>';
}

// ── NAVIGATION ──
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    navigateTo(item.dataset.page);
    // Close mobile drawer on nav
    const drawer = document.getElementById('mobile-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  });
});

function navigateTo(page) {
  currentPage = page;
  // Persist current page in URL hash so refresh stays on same page
  try { window.location.hash = page; } catch(e) {}
  // Remove mobile FAB when changing pages
  const fab = document.getElementById('mobile-fab');
  if (fab && page !== 'applications') fab.remove();
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  const titles = { dashboard:'Overview', applications:'Applications', aiblaze:'Ai-Blaze', settings:'Settings', export:'Export', privacy:'Privacy Policy' };
  document.getElementById('page-title').textContent = titles[page] || page;
  const addBtn = document.getElementById('add-app-btn');
  if (addBtn) addBtn.classList.toggle('hidden', page !== 'applications');
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.style.display = '';

  // Toggle full-page class for AI-Blaze to remove padding/topbar
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.classList.toggle('full-page', page === 'aiblaze');

  renderPage(page);
}

function renderPage(page) {
  updateBadge();
  if (page === 'dashboard')    renderDashboard();
  else if (page === 'applications') renderApplications();
  else if (page === 'aiblaze')  renderAiBlaze();
  else if (page === 'settings') renderSettings();
  else if (page === 'export')  renderExport();
  else if (page === 'privacy') renderPrivacy();
  else if (page === 'about')   renderAbout();
}

function updateBadge() {
  const count = (hasFullHistory || totalAppCount > apps.length) ? totalAppCount : apps.length;
  document.getElementById('total-badge').textContent = count + ' application' + (count !== 1 ? 's' : '') + ' tracked';
}

// ── DASHBOARD ──
function renderDashboard() {
  const dashHTML = `
    <div style="max-width: 800px; margin: 0 auto; padding-top: 20px;">
      <div class="stats-grid" style="grid-template-columns: 1fr; margin-bottom: 32px;">
        <div class="stat-card" style="text-align: center; padding: 40px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; border: none;">
          <div class="stat-card-label" style="color: rgba(255,255,255,0.8); font-size: 14px;">Total Applications Tracked</div>
          <div class="stat-card-value" style="color: #fff; font-size: 64px; margin: 12px 0;">${totalAppCount}</div>
          <div class="stat-card-sub" style="color: rgba(255,255,255,0.7); font-size: 13px;">Manage your career journey with precision</div>
        </div>
      </div>

      <div class="section-card" style="padding: 32px; border-radius: 20px; box-shadow: var(--shadow-md);">
        <h2 style="font-size: 24px; font-weight: 800; color: var(--text); margin-bottom: 16px; letter-spacing: -0.5px;">Welcome to Job Tracker</h2>
        <p style="font-size: 15px; color: var(--text2); line-height: 1.7; margin-bottom: 20px;">
          Job Tracker is your premium AI-powered career assistant. We help you stay organized during your job search by extracting details from job postings, tailored resumes, and tracking every step of your application process.
        </p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
          <div style="background: var(--bg-inset); padding: 16px; border-radius: 12px;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: var(--accent);">🚀 Fast Selection</div>
            <div style="font-size: 12px; color: var(--text-muted);">Use the extension sidebar to track jobs in 1-click.</div>
          </div>
          <div style="background: var(--bg-inset); padding: 16px; border-radius: 12px;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: var(--success);">📄 AI Tailoring</div>
            <div style="font-size: 12px; color: var(--text-muted);">Generate resumes that match exact job descriptions.</div>
          </div>
        </div>
        
        <div style="border-top: 1px solid var(--border); padding-top: 24px; display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 13px; color: var(--text-muted);">Signed in as <strong>${currentUser.name || currentUser.email}</strong></div>
          <button class="signout-btn" id="dash-signout-btn" style="width: auto; padding: 10px 24px; font-weight: 700;">Sign Out</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('page-content').innerHTML = dashHTML;
  document.getElementById('dash-signout-btn').addEventListener('click', () => {
    document.getElementById('signout-btn').click();
  });
}

// ── AI BLAZE ──
let blazeSelectedAppId = null;
let blazeTemplates = [
  { key: '-ans', label: 'Answer Question', icon: '📝', prompt: 'Please answer the following application question based on my resume and personal details. Keep it professional, concise, and highlight my relevant skills.' },
  { key: '-cover', label: 'Cover Letter', icon: '✉️', prompt: 'Write a cover letter for the role described in the job title and company, using my resume and personal details as context. Ensure it is tailored and persuasive.' },
  { key: '-sum', label: 'Short Summary', icon: '✨', prompt: 'Provide a 2-sentence summary of why I am a good fit for this role based on my resume.' }
];
let blazeSelectedProvider = 'google';
let blazeSelectedModel    = 'gemini-3.1-flash-lite';

const BLAZE_PROVIDERS = {
  google: { 
    label: 'Google Gemini', 
    icon: '💎',
    models: [
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Standard)' }
    ]
  }
};

async function renderAiBlaze() {
  const content = document.getElementById('page-content');
  if (!content) return;
  content.innerHTML = '<div style="padding:60px;text-align:center"><div class="spinner"></div></div>';

  const dbTemplates = await loadBlazeShortcutsDB();
  if (dbTemplates) blazeTemplates = dbTemplates;

  if (!blazeSelectedAppId && apps.length > 0) blazeSelectedAppId = apps[apps.length-1].id;

  const selectedApp = apps.find(a => String(a.id) === String(blazeSelectedAppId));
  const personalProfile = await loadResumeProfileDB();

  const provider = BLAZE_PROVIDERS[blazeSelectedProvider] || BLAZE_PROVIDERS.google;

  content.innerHTML = `
    <div class="blaze-animated-page">
      <!-- Animated Gradient Orbs -->
      <div class="blaze-orb blaze-orb-1"></div>
      <div class="blaze-orb blaze-orb-2"></div>
      <div class="blaze-orb blaze-orb-3"></div>

      <div class="blaze-center-col">
        <!-- Gradient Heading -->
        <div style="text-align:center; margin-bottom:8px;">
          <h1 class="blaze-gradient-heading">How can AI Blaze help?</h1>
          <div class="blaze-header-line"></div>
          <p class="blaze-chat-subtitle">
            ${selectedApp
              ? `Context: <strong>${esc(selectedApp.company || '—')}</strong> — ${esc(selectedApp.jobTitle || 'Role')}`
              : 'Select an application or ask a general question'}
          </p>
        </div>

        <!-- Compact App Selector -->
        <div class="blaze-compact-selector">
          <select class="blaze-select-mini" id="blaze-app-select">
            <option value="">No specific app (Profile only)</option>
            ${apps.slice().reverse().map(a => `
              <option value="${a.id}" ${blazeSelectedAppId === a.id ? 'selected' : ''}>
                ${esc(a.company || '—')} — ${esc(a.jobTitle || '')}
              </option>
            `).join('')}
          </select>
        </div>

        <!-- Glass Input Card -->
        <div class="blaze-glass-card">
          <div class="blaze-input-area">
            <textarea id="blaze-query" class="blaze-textarea-new" placeholder="Ask AI Blaze a question..." rows="3"></textarea>
          </div>
          <div class="blaze-input-toolbar">
            <div class="blaze-toolbar-left">
              <div class="blaze-status-pill" id="blaze-status">Ready</div>
            </div>
            <div class="blaze-toolbar-right">
              <button class="blaze-icon-btn" id="blaze-clear-btn" title="Clear">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
              </button>
              <button class="blaze-send-modern active" id="blaze-go-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Quick Action Pills -->
        <div class="blaze-quick-actions">
          ${blazeTemplates.map((t, i) => `
            <button class="blaze-action-pill blaze-shortcut-card" data-key="${t.key}" style="animation-delay: ${i * 0.08}s">
              <span class="blaze-pill-icon">${t.icon || '⚡'}</span>
              <span>${esc(t.label)}</span>
            </button>
          `).join('')}
        </div>

        <!-- Response Area -->
        <div class="blaze-response-glass hidden" id="blaze-result-wrap">
          <div class="blaze-response-top">
            <span class="blaze-ai-tag">✨ AI BLAZE</span>
            <button class="blaze-copy-pill" id="blaze-copy-btn">Copy</button>
          </div>
          <div class="blaze-response-body" id="blaze-result-text"></div>
        </div>
      </div>
    </div>
  `;

  // --- Listeners ---
  const handleNav = (id, callback) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', callback);
  };

  handleNav('blaze-app-select', e => { blazeSelectedAppId = e.target.value; renderAiBlaze(); });

  document.querySelectorAll('.blaze-shortcut-card').forEach(card => {
    card.onclick = () => {
      const template = blazeTemplates.find(t => t.key === card.dataset.key);
      if (template) {
        document.getElementById('blaze-query').value = template.prompt;
        document.getElementById('blaze-query').focus();
        card.classList.add('pulse-active');
        setTimeout(() => card.classList.remove('pulse-active'), 300);
      }
    };
  });

  document.getElementById('blaze-clear-btn').onclick = () => {
    document.getElementById('blaze-query').value = '';
    document.getElementById('blaze-result-wrap').classList.add('hidden');
    document.getElementById('blaze-result-text').innerHTML = '';
  };

  document.getElementById('blaze-copy-btn').onclick = () => {
    const text = document.getElementById('blaze-result-text').innerText;
    navigator.clipboard.writeText(text);
    showToast('Copied to clipboard ✓');
  };

  const goBtn = document.getElementById('blaze-go-btn');
  goBtn.onclick = async () => {
    const query = document.getElementById('blaze-query').value.trim();
    if (!query) { showToast('Please enter a question or prompt', true); return; }

    const key = await loadAIKeyDB('google');
    if (!key) {
      showToast(`Gemini API Key missing. Check Settings.`, true);
      return;
    }

    goBtn.disabled = true;
    goBtn.classList.add('blazing');
    const statusText = document.getElementById('blaze-status');
    statusText.textContent = 'Thinking...';
    statusText.classList.add('working');

    const resultWrap = document.getElementById('blaze-result-wrap');
    const resultText = document.getElementById('blaze-result-text');
    resultWrap.classList.remove('hidden');
    resultText.innerHTML = '<div class="blaze-loader-wrap"><div class="blaze-pulse-core"></div> Analyzing Context...</div>';

    try {
      const response = await callAIBlaze(query, { profile: personalProfile, application: selectedApp }, key, blazeSelectedProvider, blazeSelectedModel);
      
      resultText.innerText = '';
      let i = 0; const speed = 8;
      function type() {
        if (i < response.length) {
          resultText.innerText += response.charAt(i); i++;
          setTimeout(type, speed);
          resultWrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
          goBtn.disabled = false; goBtn.classList.remove('blazing');
          statusText.textContent = 'Ready'; statusText.classList.remove('working');
        }
      }
      type();
    } catch (err) {
      showToast('AI error: ' + err.message, true);
      resultText.innerHTML = `<div class="blaze-error-msg">Error: ${err.message}</div>`;
      goBtn.disabled = false; goBtn.classList.remove('blazing');
      statusText.textContent = 'Error'; statusText.classList.remove('working');
    }
  };
}

async function callAIBlaze(query, context, key, provider, model) {
  return callGeminiBlaze(query, context, key, 'gemini-3.1-flash-lite');
}


async function fetchWithRetry(url, opts, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.status === 429) {
        console.warn(`[AI Blaze] Gemini Rate Limited (429). Retry ${i + 1}/${retries} in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; // Exponential backoff
        continue;
      }
      return resp;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

async function callGeminiBlaze(query, context, key, modelSelection) {
  const model = "gemini-3.1-flash-lite"; 
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`;

  const p = context.profile || {};
  const a = context.application || {};
  
  const systemPrompt = `You are "Ai-Blaze", a professional job application assistant. 
Your goal is to help the user answer application questions or draft cover letters using their personal details and resume context.
STRICT PRIVACY: Only use the information provided. If information is missing, do not hallucinate, but provide a professional placeholder or ask for detail.
Keep answers professional, concise (unless a cover letter), and tailored to the job if job details are available.

PERSONAL DETAILS:
Name: ${p.name || 'N/A'}
Title: ${p.title || 'N/A'}
Experience/Education: ${p.education || 'N/A'}
Certs: ${p.certs || 'N/A'}
Custom Sections: ${JSON.stringify(p.custom_sections || [])}

APPLICATION CONTEXT:
Job: ${a.company || 'N/A'} - ${a.jobTitle || 'N/A'}
Resume: ${a.resume || 'No resume content provided for this specific app.'}

USER REQUEST:
${query}

Response:`;

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: systemPrompt }] }],
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 2048 }
    })
  });

  if (!resp.ok) {
    const err = await resp.json();
    // Fallback to v1beta if v1 is not available for this specific model/key
    if (resp.status === 404) {
       const altUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
       const altResp = await fetchWithRetry(altUrl, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           contents: [{ parts: [{ text: systemPrompt }] }],
           generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 2048 }
         })
       });
       if (altResp.ok) {
         const altData = await altResp.json();
         return altData.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
       }
    }
    throw new Error(err.error?.message || 'Gemini API failure');
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
}


// ── APPLICATIONS TABLE ──
function renderApplications() {
  const isMobile = window.innerWidth <= 768;
  let filtered = [...apps];
  if (filterStatus !== 'all') filtered = filtered.filter(a => a.status === filterStatus);
  if (filterDate)   filtered = filtered.filter(a => a.dateRaw && new Date(a.dateRaw).toLocaleDateString('en-CA') === filterDate);
  if (filterSearch) { const q = filterSearch.toLowerCase(); filtered = filtered.filter(a => (a.company+a.jobTitle+a.url).toLowerCase().includes(q)); }

  document.getElementById('page-content').innerHTML = `
    <!-- Bulk Action Bar -->
    <div id="bulk-bar" style="display:${isBulkMode ? 'flex' : 'none'};align-items:center;gap:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 18px;border-radius:12px;margin-bottom:14px;flex-wrap:wrap;box-shadow:0 4px 16px rgba(79,70,229,0.3);">
      <span id="bulk-count" style="font-size:13px;font-weight:700;">0 selected</span>
      <span style="font-size:13px;">→ Reassign to session:</span>
      <input type="date" id="bulk-session-date" max="${todayISO()}" style="padding:6px 12px;border-radius:8px;border:none;font-size:13px;font-family:inherit;background:#fff;color:var(--text,#1e293b);"/>
      <button id="bulk-reassign-btn" style="padding:7px 18px;background:rgba(255,255,255,0.2);backdrop-filter:blur(8px);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">✓ Reassign</button>
    </div>

    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">All Applications (${filtered.length})</div>
        <div class="filters-row">
          <input class="filter-input" id="app-search" placeholder="Search..." value="${esc(filterSearch)}" style="width:140px"/>
          <select class="filter-select" id="app-status-filter" style="width:130px">
            <option value="all" ${filterStatus==='all'?'selected':''}>All Statuses</option>
            ${STATUSES.map(s=>`<option value="${s}" ${filterStatus===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <div style="display:flex;gap:6px;align-items:center;background:var(--bg-inset);padding:4px;border-radius:10px;border:1px solid var(--border);">
            <button class="export-date-btn ${filterDate===workTodayISO()?'active':''}" id="filter-today-btn" style="padding:6px 12px;border:none;">Today</button>
            <button class="export-date-btn ${filterDate===''?'active':''}" id="filter-all-btn" style="padding:6px 12px;border:none;">All</button>
            <div style="position:relative;display:flex;align-items:center;">
              <input class="filter-input ${filterDate!=='' && filterDate!==workTodayISO()?'active':''}" type="date" id="app-date-filter" value="${filterDate}" max="${todayISO()}" style="width:130px;padding:5px 10px;border-radius:6px;${filterDate!=='' && filterDate!==workTodayISO()?'background:var(--accent);color:#fff;border-color:var(--accent);':''}"/>
            </div>
          </div>
          <button class="btn-new" id="toggle-bulk-mode-btn" style="padding:8px 12px;margin-left:auto;">${isBulkMode ? 'Cancel Select' : '≡ Select'}</button>
        </div>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th class="bulk-col" style="width:36px;display:${isBulkMode ? 'table-cell' : 'none'};"><input type="checkbox" id="select-all-chk" title="Select all"/></th>
          <th>#</th><th>Company</th><th>Job Title</th><th>URL</th><th>Status</th><th>Session Date</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0
            ? `<tr><td colspan="${isBulkMode ? 8 : 7}" class="empty-row">No applications match your filters</td></tr>`
            : filtered.map((a,i) => `
              <tr data-id="${a.id}" class="app-row" style="cursor:pointer;transition:background 0.2s;">
                <td class="bulk-col" style="display:${isBulkMode ? 'table-cell' : 'none'};"><input type="checkbox" class="app-chk" data-id="${a.id}"/></td>
                <td style="color:var(--text-faint);font-size:12px;">${i+1}</td>
                <td><div style="font-weight:600;font-size:13px;color:var(--text);">${esc(a.company||'—')}</div></td>
                <td style="font-size:13px;color:var(--text2);">${esc(a.jobTitle||'—')}</td>
                <td>${a.url?`<a href="${esc(a.url)}" target="_blank" class="url-link">Open ↗</a>`:'—'}</td>
                <td>
                  <select class="status-select" data-id="${a.id}" style="background:${(STATUS_BG[a.status]||STATUS_BG.Applied).bg};color:${(STATUS_BG[a.status]||STATUS_BG.Applied).color};">
                    ${STATUSES.map(s=>`<option value="${s}" ${a.status===s?'selected':''}>${s}</option>`).join('')}
                  </select>
                </td>
                <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">${esc(a.dateKey||a.date||'—')}</td>
                <td style="white-space:nowrap;">
                  <button class="auth-link del-btn" data-id="${a.id}" style="color:var(--danger);font-size:12px;">Delete</button>
                </td>
              </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>
    ${(!hasFullHistory && totalAppCount > apps.length) ? `
      <div style="text-align:center; padding: 20px 0;">
        <button class="settings-btn" id="load-history-btn" style="width: auto; padding: 10px 24px; font-weight: 700;">
          Load Full History (${totalAppCount} total)
        </button>
        <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
          Showing latest 30 days to save bandwidth. Click to fetch all.
        </p>
      </div>
    ` : ''}
  `;

  if (document.getElementById('load-history-btn')) {
    document.getElementById('load-history-btn').addEventListener('click', async () => {
      const btn = document.getElementById('load-history-btn');
      btn.disabled = true;
      btn.textContent = '⏳ Fetching Data...';
      const fullApps = await loadApps('all'); // Fetch all history
      apps = fullApps;
      renderApplications();
      updateBadge();
    });
  }

  // Mobile FAB button
  if (window.innerWidth <= 768) {
    const fab = document.createElement('button');
    fab.id = 'mobile-fab';
    fab.innerHTML = '+ Add';
    fab.style.cssText = 'position:fixed;bottom:72px;right:16px;background:#1F4E79;color:#fff;border:none;border-radius:50px;padding:12px 20px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(31,78,121,0.4);z-index:50;font-family:inherit;';
    fab.addEventListener('click', () => document.getElementById('add-modal').classList.remove('hidden'));
    const old = document.getElementById('mobile-fab');
    if (old) old.remove();
    document.body.appendChild(fab);
  }

  document.getElementById('app-search').addEventListener('input', e => { filterSearch = e.target.value; renderApplications(); });
  document.getElementById('app-status-filter').addEventListener('change', e => { filterStatus = e.target.value; renderApplications(); });
  document.getElementById('app-date-filter').addEventListener('change', e => { filterDate = e.target.value; renderApplications(); });
  document.getElementById('filter-today-btn').addEventListener('click', () => { filterDate = workTodayISO(); renderApplications(); });
  document.getElementById('filter-all-btn').addEventListener('click', () => { filterDate = ''; renderApplications(); });

  document.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const app = apps.find(a => String(a.id) === String(sel.dataset.id));
      if (app) { app.status = sel.value; await updateApp(app); sel.style.background=(STATUS_BG[sel.value]||STATUS_BG.Applied).bg; sel.style.color=(STATUS_BG[sel.value]||STATUS_BG.Applied).color; showToast('Status updated'); }
    });
  });

  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent row click
      if (!confirm('Delete this application?')) return;
      await deleteApp(btn.dataset.id);
      apps = apps.filter(a => String(a.id) !== String(btn.dataset.id));
      renderApplications(); updateBadge(); showToast('Deleted');
    });
  });



  // ── BULK SELECTION ──
  function getSelectedIds() {
    return [...document.querySelectorAll('.app-chk:checked')].map(c => c.dataset.id);
  }
  function updateBulkBar() {
    const ids = getSelectedIds();
    const countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = ids.length + ' selected';
  }
  
  const toggleBulkBtn = document.getElementById('toggle-bulk-mode-btn');
  if (toggleBulkBtn) {
    toggleBulkBtn.addEventListener('click', () => {
      isBulkMode = !isBulkMode;
      // also uncheck everything when turning off
      if (!isBulkMode) document.querySelectorAll('.app-chk').forEach(c => c.checked = false);
      renderApplications();
    });
  }

  // Select all checkbox
  document.getElementById('select-all-chk').addEventListener('change', e => {
    document.querySelectorAll('.app-chk').forEach(c => c.checked = e.target.checked);
    updateBulkBar();
  });

  // Individual checkboxes
  document.querySelectorAll('.app-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const all = document.querySelectorAll('.app-chk');
      const allChk = document.getElementById('select-all-chk');
      if (allChk) allChk.checked = [...all].every(c => c.checked);
      updateBulkBar();
    });
  });



  // Bulk reassign to session date
  document.getElementById('bulk-reassign-btn').addEventListener('click', async () => {
    const ids = getSelectedIds();
    const newDate = document.getElementById('bulk-session-date').value;
    if (!newDate) { showToast('Pick a session date first', true); return; }
    if (!ids.length) { showToast('No apps selected', true); return; }
    const d = new Date(newDate + 'T12:00:00');
    const displayDate = d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    const btn = document.getElementById('bulk-reassign-btn');
    btn.textContent = 'Saving...'; btn.disabled = true;
    let successCount = 0;
    await Promise.all(ids.map(async id => {
      const app = apps.find(a => String(a.id) === String(id));
      if (app) {
        app.dateKey = newDate;
        app.date    = displayDate;
        const ok = await updateApp(app);
        if (ok) successCount++;
      }
    }));
    btn.textContent = '✓ Reassign'; btn.disabled = false;
    showToast(successCount + ' apps moved to ' + newDate + ' ✓');
    document.querySelectorAll('.app-chk').forEach(c => c.checked = false);
    isBulkMode = false;
    renderApplications();
    updateBadge();
  });
  
  // Row Click for Details (excluding interactive elements)
  document.querySelectorAll('.app-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't open details if they clicked an interactive element
      if (e.target.closest('.app-chk') || e.target.closest('#select-all-chk') || e.target.closest('select') || e.target.closest('button') || e.target.closest('a')) {
        return;
      }
      const id = row.getAttribute('data-id');
      const app = apps.find(a => String(a.id) === String(id));
      if (app) {
        openDetailModal(app);
      } else {
        console.error("Could not find app with ID:", id, "Available apps:", apps);
      }
    });
  });
}

// ── DETAIL MODAL ──
function openDetailModal(app) {
  currentDetailApp = app;
  // Company & Job Title (now inputs)
  const titleInput = document.getElementById('detail-modal-title');
  const subInput   = document.getElementById('detail-modal-sub');
  if (titleInput) titleInput.value = app.company || '';
  if (subInput)   subInput.value   = app.jobTitle || '';

  // JD tab
  const jdEl = document.getElementById('detail-jd-text');
  jdEl.value = app.jd || '';
  jdEl.style.color = app.jd ? 'var(--text)' : 'var(--text-muted)';
  if (!app.jd) {
    jdEl.placeholder = '⏳ Loading job description...';
    jdEl.value = '';
  }

  // Resume tab
  const resumeEl = document.getElementById('detail-resume-text');
  resumeEl.value = app.resume || '';
  resumeEl.style.color = app.resume ? 'var(--text)' : 'var(--text-muted)';
  if (!app.resume) {
    resumeEl.placeholder = '⏳ Loading tailored resume...';
    resumeEl.value = '';
  }

  // Lazy load if JD is missing
  if (!app.jd) {
    dbLoadAppDetails(app.id).then(details => {
      if (details) {
        app.jd = details.jd || 'No job description saved.';
        app.resume = details.resume || '';
        // If still on the same app modal, update fields
        const currTitle = document.getElementById('detail-modal-title')?.value;
        if (currTitle === app.company) {
          jdEl.value = app.jd;
          jdEl.style.color = 'var(--text)';
          resumeEl.value = app.resume;
          resumeEl.style.color = 'var(--text)';
        }
      } else {
        jdEl.placeholder = 'Could not load details.';
        resumeEl.placeholder = 'Could not load details.';
      }
    });
  }

  // Notes tab
  document.getElementById('detail-notes-input').value    = app.notes || '';
  document.getElementById('detail-followup-input').value = app.followUpDate || '';
  // Session date — use dateKey (YYYY-MM-DD) or derive from dateRaw
  const sessionDateInput = document.getElementById('detail-session-date-input');
  if (sessionDateInput) {
    let sd = app.dateKey || '';
    // normalize in case old format YYYY-M-D
    if (sd && sd.split('-').length === 3) {
      const p = sd.split('-');
      sd = p[0] + '-' + p[1].padStart(2,'0') + '-' + p[2].padStart(2,'0');
    }
    sessionDateInput.value = sd;
  }
  const statusSel = document.getElementById('detail-status-sel');
  statusSel.innerHTML = STATUSES.map(s => `<option value="${s}" ${app.status===s?'selected':''}>${s}</option>`).join('');
  statusSel.style.background = (STATUS_BG[app.status]||STATUS_BG.Applied).bg;
  statusSel.style.color      = (STATUS_BG[app.status]||STATUS_BG.Applied).color;
  statusSel.addEventListener('change', () => {
    statusSel.style.background = (STATUS_BG[statusSel.value]||STATUS_BG.Applied).bg;
    statusSel.style.color      = (STATUS_BG[statusSel.value]||STATUS_BG.Applied).color;
  });

  // URL input + Open button
  const urlInput = document.getElementById('detail-url-input');
  const urlLink  = document.getElementById('detail-url-link');
  if (urlInput) urlInput.value = app.url || '';
  function syncUrlLink() {
    const v = urlInput ? urlInput.value.trim() : '';
    if (v) { urlLink.href = v; urlLink.style.opacity = '1'; urlLink.style.pointerEvents = 'auto'; }
    else   { urlLink.href = '#'; urlLink.style.opacity = '0.4'; urlLink.style.pointerEvents = 'none'; }
  }
  syncUrlLink();
  if (urlInput) urlInput.addEventListener('input', syncUrlLink);

  // Default to JD tab (or resume if no JD)
  switchDetailTab(app.jd ? 'jd' : (app.resume ? 'resume' : 'notes'));

  // Show modal
  document.getElementById('detail-modal').classList.remove('hidden');

  // Save changes
  document.getElementById('detail-modal-save').onclick = async () => {
    app.company      = document.getElementById('detail-modal-title').value.trim();
    app.jobTitle     = document.getElementById('detail-modal-sub').value.trim();
    app.notes        = document.getElementById('detail-notes-input').value.trim();
    app.followUpDate = document.getElementById('detail-followup-input').value;
    app.status       = document.getElementById('detail-status-sel').value;
    app.url          = (document.getElementById('detail-url-input')?.value || '').trim();
    app.jd           = document.getElementById('detail-jd-text').value.trim();
    app.resume       = document.getElementById('detail-resume-text').value.trim();
    
    // Save session date if changed
    const newSessionDate = document.getElementById('detail-session-date-input')?.value;
    if (newSessionDate) {
      app.dateKey = newSessionDate;
      // Also update the display date
      const d = new Date(newSessionDate + 'T12:00:00');
      app.date = d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    }
    const ok = await updateApp(app);
    if (ok) { showToast('Changes Saved ✓'); document.getElementById('detail-modal').classList.add('hidden'); renderPage(currentPage); }
    else    { showToast('Save failed', true); }
  };
}

function switchDetailTab(tab) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.detail-tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'detail-tab-' + tab));

  const dlBtn = document.getElementById('detail-modal-download');
  if (!dlBtn) return;

  if (tab === 'notes') {
    dlBtn.classList.add('hidden');
  } else {
    dlBtn.classList.remove('hidden');
    dlBtn.textContent = (tab === 'jd') ? '📥 Download JD' : '📥 Download Resume';
    // If resume tab but no resume content, we can either hide or disable. 
    // The user said "if opening resume we click download, it will download", so we'll let it be.
  }
}

// Tab clicks
document.addEventListener('click', e => {
  if (e.target.classList.contains('detail-tab')) switchDetailTab(e.target.dataset.tab);
});

// Download button click handler
document.getElementById('detail-modal-download').addEventListener('click', async () => {
  if (!currentDetailApp) return;
  const tab = document.querySelector('.detail-tab.active')?.dataset.tab;
  const btn = document.getElementById('detail-modal-download');
  
  if (tab === 'jd') {
    btn.textContent = '⏳ Preparing...'; btn.disabled = true;
    try {
      await ResumeEngine.generateJD(currentDetailApp);
      showToast('JD downloaded ✓');
    } catch (err) {
      console.error(err);
      showToast('Download failed: ' + err.message, true);
    } finally {
      btn.textContent = '📥 Download JD'; btn.disabled = false;
    }
  } else if (tab === 'resume') {
    if (!currentDetailApp.resume) {
      showToast('No tailored resume content found for this application.', true);
      return;
    }
    btn.textContent = '⏳ Preparing...'; btn.disabled = true;
    try {
      const profile = await loadProfileDB();
      if (!profile) {
        showToast('Please set up your Resume Profile in Settings first!', true);
        return;
      }
      await ResumeEngine.generate(currentDetailApp, profile);
      showToast('Resume downloaded ✓');
    } catch (err) {
      console.error(err);
      showToast('Download failed: ' + err.message, true);
    } finally {
      btn.textContent = '📥 Download Resume'; btn.disabled = false;
    }
  }
});

// Close detail modal
document.getElementById('detail-modal-close').addEventListener('click',  () => document.getElementById('detail-modal').classList.add('hidden'));
document.getElementById('detail-modal-cancel').addEventListener('click', () => document.getElementById('detail-modal').classList.add('hidden'));

// ── SETTINGS ──
let settingsSection = 'apikey';
function renderSettings() {
  document.getElementById('page-content').innerHTML = `
    <div class="settings-layout">
      <div class="settings-nav-card">
        <div style="padding:16px 20px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); border-bottom:1px solid var(--border-light); margin-bottom:8px;">Configuration</div>
        ${[['apikey','🔑','AI Config'],['blaze_shortcuts','🔥','Blaze Shortcuts'],['resumeprofile','📄','Resume Profile'],['account','👤','Account'],['shortcuts','⌨️','Shortcuts'],['logs','📜','System Logs']].map(([id,icon,label]) =>
          `<div class="settings-nav-item ${settingsSection===id?'active':''}" data-sec="${id}">${icon} ${label}</div>`
        ).join('')}
      </div>
      <div class="settings-content-card animate-entrance" id="settings-panel"></div>
    </div>`;

  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => { 
      settingsSection = item.dataset.sec; 
      renderSettings(); 
    });
  });
  renderSettingsSection(settingsSection);
}

function renderSettingsSection(sec) {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  if (sec === 'apikey') {
    panel.innerHTML = `<div style="padding:60px;text-align:center"><div class="spinner"></div></div>`;
    
    loadAIKeyDB('google').then(async googleKey => {
      const googleModel = await loadAIModelDB('google');
      panel.innerHTML = `
        <div class="settings-section-title">Intelligence Engine</div>
        <div class="settings-section-sub">Configure your Gemini models for automated job extraction and assistance.</div>
        
        <div id="settings-msg" style="margin-bottom:20px;"></div>

        <div class="action-card" style="margin-bottom:24px; cursor:default; border-color:var(--accent-border); background:linear-gradient(to bottom right, var(--bg-card), var(--bg-inset));">
          <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px;">
            <div style="width:48px; height:48px; background:linear-gradient(135deg, #4285f4, #7c3aed); border-radius:14px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:24px; box-shadow:0 8px 16px rgba(66, 133, 244, 0.2);">💎</div>
            <div>
              <div style="font-weight:800; color:var(--text); font-family:'Outfit'; font-size:18px;">Google Gemini Pro</div>
              <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:1px;">Cloud Intelligence API</div>
            </div>
            <a href="https://aistudio.google.com" target="_blank" style="margin-left:auto; font-size:11px; color:var(--accent); font-weight:800; background:var(--accent-light); padding:6px 14px; border-radius:100px; text-decoration:none; border:1px solid var(--accent-border);">GET API KEY ↗</a>
          </div>
          
          <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:16px;">
            <div class="field-group">
              <label style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Gemini API Key</label>
              <div style="display:flex; gap:8px;">
                <input type="password" class="settings-input" id="google-key-input" value="${esc(googleKey)}" placeholder="AIzaSy..." style="flex:1; border-radius:10px; padding:12px;"/>
                <button class="btn-new" data-toggle-password="google-key-input" style="width:70px; font-weight:700; font-size:11px;">SHOW</button>
              </div>
            </div>

            <div class="field-group">
              <label style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Active Model ID</label>
              <div style="position:relative;">
                <input type="text" class="settings-input" id="google-model-input" value="${esc(googleModel)}" placeholder="e.g. gemini-1.5-flash" style="width:100%; padding-right:32px; border-radius:10px; padding:12px;" list="gemini-models-list" autocomplete="off"/>
                <span style="position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:10px; color:var(--text-muted); pointer-events:none;">▼</span>
              </div>
              <datalist id="gemini-models-list">
                <option value="gemini-1.5-flash">
                <option value="gemini-1.5-pro">
                <option value="gemini-2.0-flash">
                <option value="gemini-2.0-flash-lite-preview-02-05">
                <option value="gemini-2.0-pro-exp-02-05">
              </datalist>
            </div>
          </div>
          
          <div style="margin-top:20px; padding-top:20px; border-top:1px solid var(--border-light); display:flex; gap:12px; align-items:center;">
             <div style="font-size:18px;">⚡</div>
             <div style="font-size:12px; color:var(--text2); line-height:1.5;">
               <strong>Performance Hint:</strong> Use <code>gemini-1.5-flash</code> for 3x faster extraction speed, or <code>gemini-2.0-flash</code> for improved accuracy.
             </div>
          </div>
        </div>

        <button class="btn-export" id="save-all-keys-btn" style="width:100%; padding:14px; font-weight:800; font-size:14px; letter-spacing:0.5px; border-radius:12px;">SAVE INTELLIGENCE CONFIG</button>
        
        <div class="premium-info-section glass" style="margin-top:24px; padding:20px; border-style:dashed; background:transparent;">
          <div style="display:flex; gap:12px; align-items:start;">
            <span style="font-size:16px;">🔒</span>
            <div style="font-size:11px; color:var(--text-muted); line-height:1.6;">
              <strong>End-to-End Privacy:</strong> Your keys are stored locally in your browser sandbox. We never see, log, or transmit your API keys to our servers.
            </div>
          </div>
        </div>
        </div>
      `;

      document.getElementById('save-all-keys-btn').onclick = async () => {
        const key = document.getElementById('google-key-input').value.trim();
        const model = document.getElementById('google-model-input').value.trim();
        const btn = document.getElementById('save-all-keys-btn');
        const msgEl = document.getElementById('settings-msg');
        
        btn.textContent = 'Saving...'; btn.disabled = true;
        msgEl.innerHTML = '';

        try {
          await saveAIKeyDB('google', key);
          if (model) await saveAIModelDB('google', model);
          btn.textContent = 'Configuration Saved ✓';
          btn.style.background = '#10b981';
          msgEl.innerHTML = '<div class="auth-msg success" style="margin:0"><strong>Security Guarantee:</strong> Keys are saved strictly to your local browser storage and will never be synced to the cloud.</div>';
          
          setTimeout(() => {
            btn.textContent = 'Save Configuration ✓';
            btn.disabled = false;
            btn.style.background = 'var(--accent)';
            msgEl.innerHTML = '';
          }, 4000);
        } catch (err) {
          console.error('Save AI Config Error:', err);
          msgEl.innerHTML = '<div class="auth-msg error" style="margin:0">Critical Error: ' + err.message + '</div>';
          btn.disabled = false;
          btn.textContent = 'Save Configuration ✓';
        }
      };
    });


  } else if (sec === 'blaze_shortcuts') {
    panel.innerHTML = `
      <div class="settings-section-title">AI-Blaze Shortcuts</div>
      <div class="settings-section-sub">Personalize your AI prompts for common tasks.</div>
      <div id="blaze-msg"></div>
      <div id="blaze-shortcuts-list" style="margin-top:20px;"></div>
      <button class="btn-new" id="add-shortcut-btn" style="margin-top:20px;">+ Add New Shortcut</button>
    `;

    const listEl = document.getElementById('blaze-shortcuts-list');
    const updateList = () => {
      listEl.innerHTML = blazeTemplates.map((t, idx) => `
        <div class="settings-field" style="background:var(--bg-inset);padding:14px;border-radius:10px;margin-bottom:16px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
             <input type="text" class="settings-input shortcut-label" data-idx="${idx}" value="${esc(t.label)}" placeholder="Label" style="font-weight:700;border:none;background:transparent;padding:0;width:150px;"/>
             <div>
               <span style="font-size:10px;color:var(--text-muted);margin-right:10px;">Trigger: <strong>${esc(t.key)}</strong></span>
               <button class="auth-link remove-shortcut-btn" data-idx="${idx}" style="color:var(--danger);font-size:11px;">Remove</button>
             </div>
          </div>
          <textarea class="settings-input shortcut-prompt" data-idx="${idx}" rows="3" style="font-size:12px;">${esc(t.prompt)}</textarea>
        </div>
      `).join('');

      document.querySelectorAll('.shortcut-label, .shortcut-prompt').forEach(el => {
        el.onchange = async () => {
          const idx = el.dataset.idx;
          if (el.classList.contains('shortcut-label')) blazeTemplates[idx].label = el.value.trim();
          else blazeTemplates[idx].prompt = el.value.trim();
          await saveBlazeShortcutsDB(blazeTemplates);
          showToast('Updated ✓');
        };
      });

      document.querySelectorAll('.remove-shortcut-btn').forEach(btn => {
        btn.onclick = async () => {
          blazeTemplates.splice(btn.dataset.idx, 1);
          await saveBlazeShortcutsDB(blazeTemplates);
          updateList();
        };
      });
    };

    updateList();

    document.getElementById('add-shortcut-btn').onclick = async () => {
      const key = '-' + Math.random().toString(36).substring(7);
      blazeTemplates.push({ key, label: 'New Shortcut', prompt: 'Enter prompt here...' });
      await saveBlazeShortcutsDB(blazeTemplates);
      updateList();
    };

  } else if (sec === 'resumeprofile') {
    panel.innerHTML = `<div style="display:flex;justify-content:center;padding:40px;"><div class="loading-spinner"></div></div>`;
    
    loadResumeProfileDB().then(p => {
      const customSections = p.customSections || p.custom_sections || [];
      
      const renderSectionsHTML = () => {
        return customSections.map((s, idx) => `
          <div class="settings-field custom-sec-item" data-idx="${idx}" style="background:var(--bg-inset);padding:14px;border-radius:10px;margin-bottom:16px;border:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <input type="text" class="settings-input custom-sec-title" value="${esc(s.title)}" placeholder="Section Title (e.g. Projects)" style="font-weight:700;border:none;background:transparent;padding:0;font-size:14px;color:var(--text);"/>
              <button class="btn-new btn-danger remove-sec-btn" data-idx="${idx}" style="padding:4px 8px;font-size:11px;">Remove</button>
            </div>
            <textarea class="settings-input custom-sec-content" rows="3" placeholder="Section Details..." style="font-size:13px;">${esc(s.content)}</textarea>
          </div>
        `).join('');
      };

      panel.innerHTML = `
        <div class="settings-section-title">Resume Personal Profile</div>
        <div class="settings-section-sub">These details are used to auto-fill your generated resumes. (Cloud Synced ✓)</div>
        <div id="resume-settings-msg"></div>
        
        <div style="margin-bottom:24px; padding-bottom:24px; border-bottom:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              <div style="font-size:15px; font-weight:700; color:var(--text);">v2.0 Copilot Beta</div>
              <div style="font-size:12px; color:var(--text-muted);">Enable Highlight-to-Prompt and Shortcut Triggers across all sites.</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="v2-copilot-toggle-web">
              <span class="slider round"></span>
            </label>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
          <div class="settings-field"><label>Full Name</label><input type="text" class="settings-input" id="res-name" value="${esc(p.name)}" placeholder="Venkata Vinay Vamsi"/></div>
          <div class="settings-field"><label>Professional Title</label><input type="text" class="settings-input" id="res-title" value="${esc(p.title)}" placeholder="Senior Data Engineer"/></div>
          <div class="settings-field"><label>Email Address</label><input type="email" class="settings-input" id="res-email" value="${esc(p.email)}" placeholder="you@email.com"/></div>
          <div class="settings-field"><label>Phone Number</label><input type="text" class="settings-input" id="res-phone" value="${esc(p.phone)}" placeholder="+1 (414) 895-2296"/></div>
          <div class="settings-field"><label>Location</label><input type="text" class="settings-input" id="res-location" value="${esc(p.location)}" placeholder="United States"/></div>
          <div class="settings-field"><label>LinkedIn URL</label><input type="text" class="settings-input" id="res-linkedin" value="${esc(p.linkedin)}" placeholder="linkedin.com/in/yourname"/></div>
        </div>

        <div class="settings-field">
          <label>🎓 Education <span style="font-weight:400;color:var(--text-muted);font-size:11px;">(Degree | Years | Institution | Country)</span></label>
          <textarea class="settings-input" id="res-education" rows="3" placeholder="Master of Science | 2023-2025 | University | USA">${esc(p.education)}</textarea>
        </div>

        <div class="settings-field">
          <label>📜 Certifications <span style="font-weight:400;color:var(--text-muted);font-size:11px;">(one per line)</span></label>
          <textarea class="settings-input" id="res-certs" rows="2" placeholder="AWS Certified Developer">${esc(p.certs)}</textarea>
        </div>

        <div id="custom-sections-container">
          ${renderSectionsHTML()}
        </div>

        <div style="margin-bottom:24px;">
          <button class="btn-new" id="add-section-btn" style="background:var(--bg-inset);border:1px dashed var(--border);color:var(--text-muted);width:100%;padding:12px;font-size:13px;">+ Add Custom Section (e.g. Projects)</button>
        </div>

        <div style="margin-top:20px;display:flex;gap:12px;align-items:center;">
          <button class="settings-btn" id="save-resume-profile-btn" style="padding:12px 32px;font-size:14px;">Save Personal Profile</button>
          <span id="save-status" style="font-size:12px;color:var(--text-muted);"></span>
        </div>`;

      const syncUIAndListeners = () => {
        const container = document.getElementById('custom-sections-container');
        if (container) {
          container.innerHTML = renderSectionsHTML();
          document.querySelectorAll('.remove-sec-btn').forEach((btn, i) => {
            btn.onclick = () => {
              customSections.splice(i, 1);
              syncUIAndListeners();
            };
          });
          document.querySelectorAll('.custom-sec-title').forEach((el, i) => {
            el.oninput = (e) => { customSections[i].title = e.target.value; };
          });
          document.querySelectorAll('.custom-sec-content').forEach((el, i) => {
            el.oninput = (e) => { customSections[i].content = e.target.value; };
          });
        }
      };

      const addBtn = document.getElementById('add-section-btn');
      if (addBtn) {
        addBtn.onclick = () => {
          customSections.push({ title: '', content: '' });
          syncUIAndListeners();
        };
      }
      syncUIAndListeners();

      const v2Toggle = document.getElementById('v2-copilot-toggle-web');
      if (v2Toggle) {
        v2Toggle.checked = localStorage.getItem('rjd_v2_enabled') === 'true';
        v2Toggle.onchange = () => {
          localStorage.setItem('rjd_v2_enabled', v2Toggle.checked);
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set({ rjd_v2_enabled: v2Toggle.checked });
          }
          showToast('Copilot Updated ✓');
        };
      }

      const saveBtn = document.getElementById('save-resume-profile-btn');
      if (saveBtn) {
        saveBtn.onclick = async () => {
          const status = document.getElementById('save-status');
          if (status) status.textContent = 'Saving...';
          
          const profile = {
            name: document.getElementById('res-name').value.trim(),
            title: document.getElementById('res-title').value.trim(),
            email: document.getElementById('res-email').value.trim(),
            phone: document.getElementById('res-phone').value.trim(),
            location: document.getElementById('res-location').value.trim(),
            linkedin: document.getElementById('res-linkedin').value.trim(),
            education: document.getElementById('res-education').value.trim(),
            certs: document.getElementById('res-certs').value.trim(),
            customSections: customSections
          };
          
          if (!profile.name) { showToast('Please enter your name', true); return; }
          const ok = await saveResumeProfileDB(profile);
          if (status) {
            status.textContent = ok ? 'Saved ✓' : 'Failed';
            status.style.color = ok ? '#10b981' : '#dc2626';
            setTimeout(() => { if (status) status.textContent = ''; }, 3000);
          }
          showToast(ok ? 'Profile saved' : 'Failed to save', !ok);
        };
      }
    });
  } else if (sec === 'account') {
    panel.innerHTML = `
      <div class="settings-section-title">Account Security</div>
      <div class="settings-section-sub">Manage your profile authentication and global application rules.</div>
      
      <div class="action-card glass" style="margin-bottom:24px; display:flex; align-items:center; gap:16px; border-color:var(--accent-border);">
        <div style="width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg, var(--accent), var(--accent2)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; box-shadow:0 8px 16px var(--accent-light);">${esc(initials(currentUser.name))}</div>
        <div style="flex:1;">
          <div style="font-size:16px; font-weight:800; color:var(--text); font-family:'Outfit';">${esc(currentUser.name)}</div>
          <div style="font-size:12px; color:var(--text-muted); font-weight:600;">${esc(currentUser.email)}</div>
        </div>
        <div style="background:var(--success); color:#fff; font-size:10px; font-weight:800; padding:4px 10px; border-radius:100px; text-transform:uppercase; letter-spacing:0.5px;">Verified</div>
      </div>

      <div class="premium-grid" style="grid-template-columns:1fr 1fr; gap:20px;">
        <div class="premium-card" style="padding:20px; text-align:left;">
          <div style="font-size:13px; font-weight:800; color:var(--text); margin-bottom:4px;">🔑 Authentication</div>
          <p style="font-size:11px; color:var(--text-muted); margin-bottom:16px;">Update your master secure password for Supabase Auth.</p>
          <input type="password" id="new-pwd-input" class="settings-input" placeholder="New master password" style="width:100%; margin-bottom:12px; border-radius:10px;"/>
          <button class="btn-primary" id="update-pwd-btn" style="width:100%; font-size:12px; padding:10px;">Update Secure Key</button>
          <div id="pwd-msg" style="margin-top:10px;"></div>
        </div>

        <div class="premium-card" style="padding:20px; text-align:left;">
          <div style="font-size:13px; font-weight:800; color:var(--text); margin-bottom:4px;">🌙 Night Shift Window</div>
          <p style="font-size:11px; color:var(--text-muted); margin-bottom:16px;">Redefine when your workday ends for reporting and export.</p>
          <select id="cutoff-select" class="settings-input" style="width:100%; margin-bottom:12px; border-radius:10px;">
            ${[0,1,2,3,4,5,6].map(h => `<option value="${h}" ${getWorkDayCutoff()===h?'selected':''}>${h===0?'Disabled (Midnight)':h+':00 AM Threshold'}</option>`).join('')}
          </select>
          <button class="btn-new" id="save-cutoff-btn" style="width:100%; font-size:12px; padding:10px;">Save Threshold</button>
          <div id="cutoff-msg" style="margin-top:10px; font-size:11px; text-align:center;"></div>
        </div>
      </div>

      <div style="margin-top:32px; padding-top:24px; border-top:1px solid var(--border-light); text-align:center;">
        <div style="font-size:12px; font-weight:700; color:var(--danger); margin-bottom:12px; text-transform:uppercase; letter-spacing:1px;">Critical Actions</div>
        <button class="btn-new" id="delete-all-btn" style="border-color:var(--danger); color:var(--danger); background:transparent; font-size:12px; padding:10px 24px;">Purge All Application Data</button>
        <p style="font-size:10px; color:var(--text-muted); margin-top:12px;">This action is irreversible. All career entries will be permanently deleted from the cloud.</p>
      </div>`;

    document.getElementById('save-cutoff-btn').addEventListener('click', () => {
      const h = parseInt(document.getElementById('cutoff-select').value, 10);
      saveWorkDayCutoff(h);
      const msg = document.getElementById('cutoff-msg');
      msg.textContent = h === 0 ? 'Disabled ✓' : 'Saved — cutoff set to ' + h + ':00 AM ✓';
      setTimeout(() => { if (msg) msg.textContent = ''; }, 3000);
    });

    const updBtn = document.getElementById('update-pwd-btn');
    updBtn.addEventListener('click', async () => {
      const np = document.getElementById('new-pwd-input').value;
      const msgEl = document.getElementById('pwd-msg');
      if (np.length < 6) { msgEl.innerHTML = '<div class="auth-msg error">Password must be at least 6 characters</div>'; return; }
      updBtn.disabled = true; updBtn.textContent = "Updating...";
      try {
        const r = await fetch(SUPABASE_URL+'/auth/v1/user', {
          method:'PUT', headers:headers(), body: JSON.stringify({password: np})
        });
        if (r.ok) {
          msgEl.innerHTML = '<div class="auth-msg success">Password updated! Please sign in again.</div>';
          setTimeout(async () => {
             document.getElementById('signout-btn')?.click();
          }, 2000);
        } else {
          msgEl.innerHTML = '<div class="auth-msg error">Update failed. Your session might be too old, please sign out and sign in again.</div>';
          updBtn.disabled = false; updBtn.textContent = "Update";
        }
      } catch(e) {
        msgEl.innerHTML = '<div class="auth-msg error">Network error.</div>';
        updBtn.disabled = false; updBtn.textContent = "Update";
      }
    });

    document.getElementById('delete-all-btn').addEventListener('click', async () => {
      if (!confirm('Delete ALL your applications? This cannot be undone.')) return;
      await Promise.all(apps.map(a => deleteApp(a.id)));
      apps = [];
      updateBadge();
      showToast('All data deleted');
      renderSettings();
    });

  } else if (sec === 'shortcuts') {
    panel.innerHTML = `
      <div class="settings-section-title">Keyboard Shortcuts</div>
      <div class="settings-section-sub">Use these shortcuts in the Chrome extension sidebar.</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${[
          ['Open / close sidebar',  'Alt + Shift + T'],
          ['Extract & Save',        'Alt + Shift + E'],
          ['New application',       'Alt + Shift + N'],
          ['Open settings',         'Alt + Shift + S'],
          ['Close panel / back',    'Escape'],
        ].map(([action, key]) => `
          <div class="settings-row">
            <div><div class="settings-row-label">${action}</div></div>
            <span class="kbd">${key}</span>
          </div>`).join('')}
      </div>`;

  } else if (sec === 'privacy-s') {
    panel.innerHTML = `
      <div class="settings-section-title">Privacy</div>
      <div class="settings-section-sub">What we collect and how we use it.</div>
      <div class="privacy-block"><strong>What we store:</strong> Your email, name, and job applications (company, title, URL, JD, resume, status, notes). Stored in Supabase with Row Level Security.</div>
      <div class="privacy-block"><strong>Gemini API key:</strong> Stored only in your browser. Never sent to our servers — goes directly to Google.</div>
      <div class="privacy-block"><strong>No tracking:</strong> We do not collect analytics, usage data, or advertising data of any kind.</div>
      <div class="privacy-block"><strong>Your rights:</strong> Export your data anytime via the Export page. Delete all data from the Account settings. Contact us to delete your account entirely.</div>
      <div style="margin-top:16px;"><a href="privacy.html" target="_blank" class="auth-link">View full privacy policy →</a></div>`;

  } else if (sec === 'about') {
    panel.innerHTML = `
      <div class="settings-section-title">About</div>
      <div class="settings-section-sub">Version and technology info.</div>
      ${[
        ['Version',    '4.2.0'],
        ['AI Model',   'Gemini 3.1 Flash Lite'],
        ['Database',   'Supabase (PostgreSQL)'],
        ['Auth',       'Supabase Auth'],
        ['Extension',  'Chrome Manifest V3'],
        ['Storage',    'Cloud + Browser local'],
      ].map(([k,v]) => `
        <div class="settings-row">
          <div class="settings-row-label">${k}</div>
          <div class="settings-row-val">${v}</div>
        </div>`).join('')}
      <div style="margin-top:20px;background:#f8fafc;border-radius:8px;padding:14px;font-size:13px;color:#718096;text-align:center;">
        Built for job seekers who mean business · <strong style="color:#1F4E79;">Free forever</strong>
      </div>`;
  } else if (sec === 'logs') {
    panel.innerHTML = `
      <div class="settings-section-title">System Intelligence Logs</div>
      <div class="settings-section-sub">Diagnostic records and localized error tracking for technical audit.</div>
      
      <div class="action-card" style="margin-bottom:24px; cursor:default; border-style:dashed;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <div style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px;">Session Stream</div>
          <div style="display:flex; gap:8px;">
            <button class="chip" id="dl-logs-btn">Download Archive</button>
            <button class="chip" id="clear-logs-btn" style="color:var(--danger); border-color:var(--danger);">Clear Buffer</button>
          </div>
        </div>
        
        <div id="logs-list-container" style="background:var(--bg-inset); border:1px solid var(--border); border-radius:12px; height:360px; overflow-y:auto; padding:16px; font-family:'JetBrains Mono', 'SF Mono', monospace; font-size:11px; line-height:1.5;">
          <div style="text-align:center; padding:60px; color:var(--text-muted);">Initializing log stream...</div>
        </div>
      </div>
      
      <div class="premium-info-section glass" style="background:transparent; padding:16px;">
        <p style="font-size:11px; color:var(--text-muted); margin:0;">
          <strong>Debug Mode:</strong> Logs are stored in transient browser memory and are cleared upon signing out or manual purge.
        </p>
      </div>`;

    const loadLogs = async () => {
      const logs = await AppLogger.getLogs();
      const container = document.getElementById('logs-list-container');
      if (!logs.length) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No logs recorded. Everything looks good!</div>';
        return;
      }
      container.innerHTML = logs.reverse().map(l => `
        <div style="margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--border-light);">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <strong style="color:${l.level==='ERROR'?'var(--danger)':'var(--warning)'};">${l.level}</strong>
            <span style="color:var(--text-muted);">${new Date(l.timestamp).toLocaleString()}</span>
          </div>
          <div style="word-break:break-all;"><strong>Msg:</strong> ${esc(l.message)}</div>
          ${l.url ? `<div style="color:var(--text-muted); font-size:10px;">URL: ${esc(l.url)}</div>` : ''}
        </div>
      `).join('');
    };

    loadLogs();

    document.getElementById('dl-logs-btn').onclick = () => AppLogger.download();
    document.getElementById('clear-logs-btn').onclick = async () => {
      if (confirm('Clear all local logs?')) {
        await AppLogger.clear();
        loadLogs();
        showToast('Logs cleared');
      }
    };
  }
}

// ── EXPORT PAGE ──
function renderExport() {
  const dateCounts = {};
  apps.forEach(a => {
    const k = a.dateKey || (a.dateRaw ? getWorkDayISO(a.dateRaw) : '');
    if (k) dateCounts[k] = (dateCounts[k]||0)+1;
  });
  const uniqueDates = Object.keys(dateCounts).sort().reverse().slice(0, 10);
  const wToday = workTodayISO();

  document.getElementById('page-content').innerHTML = `
    <div class="premium-page-container animate-entrance">
      <header class="premium-header">
        <h1 class="premium-title">Data Orchestration</h1>
        <p class="premium-subtitle">Export your career journey to high-quality formats for analysis and archival.</p>
      </header>

      <!-- Filter bar Chips -->
      <div class="premium-card glass" style="padding:24px; margin-bottom:32px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <div>
            <div style="font-size:14px; font-weight:800; color:var(--text); letter-spacing:0.5px;">📅 DATE SELECTION</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Filter applications by submission window</div>
          </div>
          <div style="text-align:right;">
             <div style="font-size:10px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Applications Selected</div>
             <div id="export-count-label" style="font-size:18px; font-weight:800; color:var(--accent); font-family:'Outfit';">${apps.length}</div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <div class="chip active" data-date="">All Time</div>
          <div class="chip" data-date="${wToday}">Today</div>
          ${uniqueDates.filter(d => d !== wToday).map(d => `
            <div class="chip" data-date="${d}">${new Date(d).toLocaleDateString(undefined, {month:'short', day:'numeric'})}</div>
          `).join('')}
          <div style="height:32px; width:1px; background:var(--border); margin:0 4px;"></div>
          <input type="date" id="export-custom-date" class="filter-input" max="${todayISO()}" style="height:32px; padding:0 12px; border-radius:100px; font-size:12px; width:140px;" title="Pick custom date"/>
        </div>
      </div>

      <!-- Export Action Cards -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:32px;">
        <div class="action-card" id="export-xlsx-btn">
          <div class="action-card-icon">📊</div>
          <div style="font-size:16px; font-weight:800; color:var(--text); margin-bottom:8px;">Professional Excel</div>
          <p style="font-size:13px; color:var(--text2); margin-bottom:20px; line-height:1.5;">Direct export to .xlsx with color-coded sheets, smart summaries, and trend dashboards.</p>
          <div style="display:flex; align-items:center; color:var(--accent); font-size:12px; font-weight:700; margin-top:auto;">
             Download Report <span style="margin-left:6px; font-size:14px;">→</span>
          </div>
        </div>
        
        <div class="action-card" id="export-csv-btn">
          <div class="action-card-icon">📄</div>
          <div style="font-size:16px; font-weight:800; color:var(--text); margin-bottom:8px;">Portable CSV</div>
          <p style="font-size:13px; color:var(--text2); margin-bottom:20px; line-height:1.5;">Clean, minimal comma-separated file for universal spreadsheet compatibility and data processing.</p>
          <div style="display:flex; align-items:center; color:var(--text2); font-size:12px; font-weight:700; margin-top:auto;">
             Download Simple CSV <span style="margin-left:6px; font-size:14px;">→</span>
          </div>
        </div>
      </div>

      <div class="premium-info-section glass" style="padding:24px; border-style:dashed;">
        <div style="display:flex; gap:16px; align-items:center;">
          <div style="width:48px; height:48px; border-radius:12px; background:var(--accent-light); display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">💡</div>
          <div>
            <div style="font-weight:700; color:var(--text); font-size:14px;">Analyst Tip</div>
            <div style="font-size:12px; color:var(--text2); line-height:1.6; margin-top:4px;">
              Applying to 30+ jobs per day? Select <strong>Today</strong> before exporting to get a focused sheet for your immediate follow-up ritual.
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // ── Date filter state ──
  let exportDate = ''; // '' = all

  function getFilteredApps() {
    if (!exportDate) return apps;
    // dateKey is now always YYYY-MM-DD (zero-padded), direct match
    return apps.filter(a => {
      if (a.dateKey) return a.dateKey === exportDate;
      return a.dateRaw && getWorkDayISO(a.dateRaw) === exportDate;
    });
  }

  function updateExportLabel() {
    const filtered = getFilteredApps();
    const el = document.getElementById('export-count-label');
    if (el) {
       el.style.transform = 'scale(1.1)';
       el.style.transition = 'transform 0.2s';
       el.textContent = filtered.length;
       setTimeout(() => el.style.transform = 'scale(1)', 200);
    }
  }

  function setExportDate(date) {
    exportDate = date;
    document.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b.dataset.date === date));
    if (date) document.getElementById('export-custom-date').value = date;
    else document.getElementById('export-custom-date').value = '';
    updateExportLabel();
  }

  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => setExportDate(btn.dataset.date));
  });

  document.getElementById('export-custom-date').addEventListener('change', e => {
    setExportDate(e.target.value);
    document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
  });

  // ── CSV Export ──
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const filtered = getFilteredApps();
    if (!filtered.length) { showToast('No applications to export', true); return; }
    const hdrs = ['#','Company','Job Title','URL','Status','Date','Follow-up Date','Notes'];
    const rows = filtered.map((a,i) => [i+1,a.company,a.jobTitle,a.url,a.status,a.date,a.followUpDate||'',a.notes].map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(','));
    const blob = new Blob([[hdrs.join(','),...rows].join('\n')], {type:'text/csv'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (currentUser.name||'applications') + '_' + (exportDate||todayISO()) + '.csv';
    link.click();
    showToast('CSV exported (' + filtered.length + ' rows)');
  });

  // ── XLSX Export ──
  document.getElementById('export-xlsx-btn').addEventListener('click', async () => {
    const filtered = getFilteredApps();
    if (!filtered.length) { showToast('No applications to export', true); return; }
    showToast('Preparing export...');
    try {
      const now = new Date();
      const dateLabel = exportDate ? ' — ' + exportDate : '';
      const statusStyleMap = { 'Applied':2,'Interview Scheduled':3,'Interview Done':4,'Offer':5,'Rejected':6,'Skipped':7 };
      const numCols = 8;
      const colWidths = [5, 22, 30, 28, 20, 14, 45, 55];
      const rowHeights = {};
      const sheetRows = [];
      sheetRows.push([{ v: 'Job Application Report — ' + currentUser.name + dateLabel, t:'s', s:15 }, ...Array(numCols-1).fill(null)]);
      rowHeights[0] = 30;
      sheetRows.push([{ v: 'Exported on ' + now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) + '   ·   Total: ' + filtered.length, t:'s', s:16 }, ...Array(numCols-1).fill(null)]);
      rowHeights[1] = 18;
      sheetRows.push(Array(numCols).fill(null)); rowHeights[2] = 6;
      const xlsxHeaders = ['#','Company','Job Title','Job URL','Status','Date Applied','Resume Text','Job Description'];
      sheetRows.push(xlsxHeaders.map(h=>({ v:h, t:'s', s:1 }))); rowHeights[3] = 22;
      filtered.forEach((a,i) => {
        const isAlt = i%2===1; const sStat = statusStyleMap[a.status]||2;
        const def=isAlt?8:0, wrap=isAlt?10:9, ctr=isAlt?14:13;
        const urlCell = a.url ? { v:'Open Link', t:'s', s:11, url:a.url } : { v:'—', t:'s', s:def };
        rowHeights[4+i] = (a.resume||a.jd) ? 90 : 18;
        sheetRows.push([
          { v:String(i+1), t:'n', s:ctr }, { v:a.company||'—', t:'s', s:def },
          { v:a.jobTitle||'—', t:'s', s:def }, urlCell, { v:a.status||'—', t:'s', s:sStat },
          { v:a.date||'—', t:'s', s:ctr }, { v:a.resume||'', t:'s', s:wrap }, { v:a.jd||'', t:'s', s:wrap },
        ]);
      });
      const STATUSES2 = ['Applied','Interview Scheduled','Interview Done','Offer','Rejected','Skipped'];
      const statusCounts = {}; STATUSES2.forEach(s=>{ statusCounts[s]=filtered.filter(a=>a.status===s).length; });
      const s2rows = []; const s2heights = {};
      s2rows.push([{ v:'Summary Dashboard' + dateLabel, t:'s', s:15 }, null,null,null,null,null]); s2heights[0]=28;
      s2rows.push([{ v:'User: '+currentUser.name+'   ·   '+now.toLocaleDateString(), t:'s', s:16 }, null,null,null,null,null]); s2heights[1]=16;
      s2rows.push(Array(6).fill(null)); s2heights[2]=10;
      const kpis=[{label:'Total',value:String(filtered.length)},{label:'This Week',value:String(apps.filter(a=>{const d=new Date(a.dateRaw);return(now-d)<=7*86400000;}).length)},{label:'Interviews',value:String((statusCounts['Interview Scheduled']||0)+(statusCounts['Interview Done']||0))},{label:'Offers',value:String(statusCounts['Offer']||0)},{label:'With Resume',value:String(filtered.filter(a=>a.resume).length)},{label:'Success %',value:filtered.length>0?Math.round(((statusCounts['Offer']||0)/filtered.length)*100)+'%':'0%'}];
      const kpiStyles=[17,22,23,24,25,26];
      s2rows.push(kpis.map((k,i)=>({ v:k.label, t:'s', s:kpiStyles[i] }))); s2heights[3]=18;
      s2rows.push(kpis.map(k=>({ v:k.value, t:'s', s:18 }))); s2heights[4]=40;
      s2rows.push(Array(6).fill(null)); s2heights[5]=12;
      s2rows.push([{v:'Status',t:'s',s:19},{v:'Count',t:'s',s:19},{v:'%',t:'s',s:19},null,null,null]); s2heights[6]=20;
      STATUSES2.forEach((st,i)=>{ const c=statusCounts[st]||0; const pct=filtered.length>0?((c/filtered.length)*100).toFixed(1)+'%':'0%'; const ss=statusStyleMap[st]||2; s2rows.push([{v:st,t:'s',s:ss},{v:String(c),t:'n',s:13},{v:pct,t:'s',s:13},null,null,null]); s2heights[7+i]=18; });
      const bytes = await window.buildXLSX([
        { name:'Applications', headers:xlsxHeaders, rows:sheetRows, colWidths, merges:['A1:H1','A2:H2'], rowHeights },
        { name:'Summary', headers:[], rows:s2rows, colWidths:[22,12,12,12,12,12], merges:['A1:F1','A2:F2'], rowHeights:s2heights }
      ]);
      const blob = new Blob([bytes], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = currentUser.name + '_' + (exportDate||todayISO()) + '.xlsx';
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Excel exported ✓ (' + filtered.length + ' rows)');
    } catch(err) { showToast('Export failed: ' + err.message, true); }
  });
}

// ── PRIVACY PAGE (RE-DESIGNED) ──
function renderPrivacy() {
  document.getElementById('page-content').innerHTML = `
    <div class="premium-page-container animate-entrance">
      <header class="premium-header">
        <h1 class="premium-title">Privacy Protocol</h1>
        <p class="premium-subtitle">Your data encryption and security standards. Last updated March 2026.</p>
      </header>

      <div class="premium-grid">
        <div class="premium-card glass">
          <div class="card-icon">🔐</div>
          <h3>Local First Policy</h3>
          <p>Your Gemini API keys are never uploaded to our servers. They reside exclusively in your browser's secure local storage.</p>
        </div>
        <div class="premium-card glass">
          <div class="card-icon">🛡️</div>
          <h3>Data Ownership</h3>
          <p>We do not sell or monetize your job applications. Every entry is protected by Row Level Security (RLS) in Supabase.</p>
        </div>
        <div class="premium-card glass">
          <div class="card-icon">✨</div>
          <h3>No Tracking</h3>
          <p>We do not use analytics or user tracking. Your career journey is private, as it should be.</p>
        </div>
      </div>

      <div class="premium-info-section glass">
        <div style="display:flex; gap:24px; align-items:flex-start;">
          <div style="flex:1;">
            <h4 style="margin-bottom:8px; color:var(--text); font-weight:700;">Infrastructure</h4>
            <div class="privacy-bullet"><strong>Supabase Cloud:</strong> Encrypted storage for applications.</div>
            <div class="privacy-bullet"><strong>End-to-End SSL:</strong> Secure transit for all API calls.</div>
            <div class="privacy-bullet"><strong>Row Security:</strong> Hardened isolation between users.</div>
          </div>
          <div style="flex:1;">
            <h4 style="margin-bottom:8px; color:var(--text); font-weight:700;">Your Rights</h4>
            <div class="privacy-bullet"><strong>Full Export:</strong> Download all data as Excel/CSV anytime.</div>
            <div class="privacy-bullet"><strong>Immediate Purge:</strong> Delete all data with one click.</div>
            <div class="privacy-bullet"><strong>Account Closure:</strong> Permanent account deletion on request.</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── ABOUT PAGE (PREMIUM DESIGN) ──
function renderAbout() {
  document.getElementById('page-content').innerHTML = `
    <div class="premium-page-container animate-entrance">
      <div class="about-hero glass">
        <div class="about-logo">🚀</div>
        <h1 class="premium-title">Job Application Tracker</h1>
        <div class="version-badge">v5.2.0 Professional</div>
        <p class="premium-subtitle" style="max-width:500px; margin: 0 auto;">Empowering thousands of job seekers with cutting-edge AI automation and professional document orchestration.</p>
      </div>

      <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px; margin-top:24px;">
        <div class="premium-card glass" style="text-align:left;">
          <h3 style="margin-bottom:12px;">Technical Architecture</h3>
          <div class="tech-stack-list">
            ${[
              ['Frontend', 'Vanilla JS, CSS Variables, Glassmorphism'],
              ['Intelligence', 'Google Gemini 1.5/2.0 Engines'],
              ['Cloud Backend', 'Supabase Realtime & PostgreSQL'],
              ['Auth Engine', 'GoTrue / Supabase Identity'],
              ['Document Engine', 'Docx.js Professional'],
              ['Package', 'Chrome Extension Manifest V3'],
            ].map(([k,v]) => `
              <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-light);">
                <span style="font-size:12px; color:var(--text-muted); font-weight:600;">${k}</span>
                <span style="font-size:12px; color:var(--text); font-weight:700;">${v}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="premium-card glass" style="background: linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(124, 58, 237, 0.1));">
          <h3 style="margin-bottom:12px;">Our Mission</h3>
          <p style="font-size:13px; line-height:1.6; color:var(--text2);">We believe that finding a job should be about your talent, not your ability to manage spreadsheets. We build tools that handle the grind, so you can focus on the interview.</p>
          <div style="margin-top:20px; text-align:center;">
             <div style="font-size:11px; color:#1F4E79; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Built for Action</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── SIGN OUT ──
document.getElementById('signout-btn').addEventListener('click', async () => {
  if (!confirm('Sign out of Job Tracker?')) return;
  await signOut();
  clearStoredSession();
  session = null; currentUser = null; apps = [];
  if (window._appSyncTimer)    { clearInterval(window._appSyncTimer);    window._appSyncTimer    = null; }
  if (window._appRefreshTimer) { clearInterval(window._appRefreshTimer); window._appRefreshTimer = null; }
  const fields = ['auth-email','auth-password','auth-name','forgot-email'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const authMsg = document.getElementById('auth-msg');
  if (authMsg) authMsg.innerHTML = '';
  showSection('auth-section');
  setMode('signin');
});

function clearStoredSession() {
  localStorage.removeItem('rjd_web_session');
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('rjd_session');
  }
}

// ── ADD APP MODAL ──
document.getElementById('add-app-btn').addEventListener('click', () => {
  document.getElementById('add-modal').classList.remove('hidden');
});
document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('add-modal').classList.add('hidden');
});
document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('add-modal').classList.add('hidden');
});
document.getElementById('modal-save').addEventListener('click', async () => {
  const company  = document.getElementById('m-company').value.trim();
  const jobTitle = document.getElementById('m-title').value.trim();
  const url      = document.getElementById('m-url').value.trim();
  const status   = document.getElementById('m-status').value;
  const jd       = document.getElementById('m-jd').value.trim();
  const notes    = document.getElementById('m-notes').value.trim();
  if (!company && !jobTitle) { showToast('Enter company or job title', true); return; }
  const now = new Date();
  // Fix #13: use crypto.randomUUID() — avoids timestamp collisions and produces proper UUID
  const app = {
    id: crypto.randomUUID(), company, jobTitle, url, jd, resume:'',
    status, date: today(), dateRaw: now.toISOString(),
    dateKey: `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`,
    notes, followUpDate:''
  };
  const ok = await saveApp(app);
  if (ok) {
    apps.push(app);
    document.getElementById('add-modal').classList.add('hidden');
    ['m-company','m-title','m-url','m-jd','m-notes'].forEach(id => document.getElementById(id).value='');
    updateBadge();
    renderPage(currentPage);
    showToast('Application saved');
  } else { showToast('Save failed — check connection', true); }
});

// ── INTEGRATED RESUME ENGINE ──
async function generateIntegratedResume(app) {
  const p = JSON.parse(localStorage.getItem('rjd_resume_profile') || '{}');
  if (!p.name) {
    showToast('Please fill out your Resume Profile in Settings first!', true);
    navigateTo('settings');
    settingsSection = 'resumeprofile';
    renderSettings();
    return;
  }
  try {
    if (window.ResumeEngine) {
      await window.ResumeEngine.generate(app, p);
    } else {
      showToast('Resume engine not loaded. Please refresh.', true);
    }
  } catch (err) {
    console.error(err);
    showToast('Download failed: ' + err.message, true);
  }
}

// ── INIT ──
setupAuth();
