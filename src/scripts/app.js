
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
async function loadApps() {
  const PAGE_SIZE = 1000;
  let allRows = [];
  let offset  = 0;
  // Fix #7: filter by current user so users never see each other's data
  // Fix #14: paginate to bypass Supabase's default 1000-row cap
  let fetchSuccess = false;
  while (true) {
    let r = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?select=*&username=eq.${currentUser.id}&order=created_at.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: headers({ 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE_SIZE - 1}` }) }
    );
    if (r.status === 401 && session?.refresh_token && offset === 0) {
      const refreshed = await refreshToken();
      if (refreshed) {
        r = await fetch(
          `${SUPABASE_URL}/rest/v1/applications?select=*&username=eq.${currentUser.id}&order=created_at.asc&limit=${PAGE_SIZE}&offset=${offset}`,
          { headers: headers({ 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE_SIZE - 1}` }) }
        );
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
async function saveApp(app) {
  const r = await fetch(SUPABASE_URL+'/rest/v1/applications', {
    method:'POST', headers:headers({'Prefer':'return=representation'}),
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
    method:'PATCH', headers:headers({'Prefer':'return=representation'}),
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?on_conflict=username`, {
      method: 'POST',
      headers: headers({'Prefer': 'resolution=merge-duplicates,return=representation'}),
      body: JSON.stringify({
        username: currentUser.id,
        resume_profile: profile 
      })
    });
    if (res.ok) {
      localStorage.setItem('rjd_resume_profile', JSON.stringify(profile));
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ rjd_resume_profile: profile });
      }
      return true;
    }
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
      let friendly = 'Something went wrong. Please try again.';
      if (/invalid.*(login|credentials)/i.test(raw))               friendly = 'Incorrect email or password.';
      else if (/already.*registered|user.*exists/i.test(raw))      friendly = 'An account with this email already exists. Try signing in.';
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
      if (!session || !currentUser || document.hidden) return; // Don't poll if tab is hidden
      try {
        const fresh = await loadApps();
        // Fast signature check to see if anything meaningful changed
        const newSig = fresh.length + '|' + fresh.map(a => a.id + a.status).join('|');
        if (window._lastAppSig !== newSig) {
          window._lastAppSig = newSig;
          apps = fresh;
          updateBadge();
          renderPage(currentPage);
        }
      } catch(e) {}
    }, 15000); // Polling every 15 seconds for 'instant' feel
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

  navigateTo('dashboard');

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
}

function updateBadge() {
  document.getElementById('total-badge').textContent = apps.length + ' application' + (apps.length !== 1 ? 's' : '') + ' tracked';
}

// ── DASHBOARD ──
function renderDashboard() {
  document.getElementById('page-content').innerHTML = '<div style="padding:60px;text-align:center"><div class="spinner"></div></div>';
  const now   = new Date();
  const today = apps.filter(a => a.dateRaw && getWorkDayISO(a.dateRaw) === workTodayISO()).length;
  const week  = apps.filter(a => a.dateRaw && (now - new Date(a.dateRaw)) <= 7*86400000).length;
  const ints  = apps.filter(a => a.status==='Interview Scheduled'||a.status==='Interview Done').length;
  const offers= apps.filter(a => a.status==='Offer').length;
  const rejected = apps.filter(a => a.status==='Rejected').length;
  const rate  = apps.length > 0 ? Math.round((offers/apps.length)*100) : 0;

  const statusCounts = {};
  STATUSES.forEach(s => { statusCounts[s] = apps.filter(a => a.status === s).length; });

  // Build calendar day lookup
  const calendarData = {};
  apps.forEach(a => { if (a.dateRaw) { const k = getWorkDayISO(a.dateRaw); calendarData[k] = (calendarData[k]||0)+1; } });

  // Build weekly progress data (last 6 weeks)
  const weeklyData = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now); start.setDate(now.getDate() - i*7 - now.getDay());
    const end   = new Date(start); end.setDate(start.getDate() + 6);
    const label = start.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const count = apps.filter(a => { if (!a.dateRaw) return false; const d = new Date(a.dateRaw); return d >= start && d <= end; }).length;
    weeklyData.push({ label, count });
  }
  // Build calendar (current month)
  const calYear = now.getFullYear(), calMonth = now.getMonth();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const monthName = now.toLocaleDateString('en-US',{month:'long',year:'numeric'});

  const dashHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-label">Total Applications</div>
        <div class="stat-card-value">${apps.length}</div>
        <div class="stat-card-sub">${week} this week</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Today</div>
        <div class="stat-card-value blue">${today}</div>
        <div class="stat-card-sub">applied today</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Interviews</div>
        <div class="stat-card-value orange">${ints}</div>
        <div class="stat-card-sub">${offers} offers received</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Success Rate</div>
        <div class="stat-card-value green">${rate}%</div>
        <div class="stat-card-sub">${rejected} rejected</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">

      <div class="section-card">
        <div class="section-card-header"><div class="section-card-title">📅 Application Calendar</div></div>
        <div style="padding:12px 16px 16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-size:13px;font-weight:600;color:var(--text);">${monthName}</span>
            <span style="font-size:12px;color:var(--text-muted);">${apps.filter(a=>a.dateRaw&&new Date(a.dateRaw).getMonth()===calMonth&&new Date(a.dateRaw).getFullYear()===calYear).length} applied this month</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,32px);gap:2px;justify-content:space-between;">
            ${['S','M','T','W','T','F','S'].map(d=>`<div style="width:32px;height:20px;font-size:10px;color:#a0aec0;font-weight:600;text-align:center;line-height:20px;">${d}</div>`).join('')}
            ${Array(firstDay).fill(`<div style="width:32px;height:32px;"></div>`).join('')}
            ${Array.from({length:daysInMonth},(_,i)=>{
              const d = i+1;
              const key = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const count = calendarData[key]||0;
              const isToday = key === todayISO();
              let bg = 'transparent', color = 'var(--text2)', fontWeight = '400', border = 'none';
              if (count > 0) { bg = 'linear-gradient(135deg,#4f46e5,#7c3aed)'; color = '#fff'; fontWeight = '600'; }
              else if (isToday) { bg = '#eef2ff'; color = '#4f46e5'; fontWeight = '600'; border = '1.5px solid #4f46e5'; }
              return `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${bg};color:${color};font-size:11px;font-weight:${fontWeight};border:${border};" title="${count>0?count+' application'+(count>1?'s':''):''}">${d}</div>`;
            }).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted,#94a3b8);"><span style="width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:inline-block;"></span>Applied</div>
            <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted,#94a3b8);"><span style="width:8px;height:8px;border-radius:50%;background:#eef2ff;border:1.5px solid #4f46e5;display:inline-block;"></span>Today</div>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header"><div class="section-card-title">📊 Weekly Progress</div></div>
        <div style="padding:12px 16px 16px;">
          <div style="display:flex;gap:12px;margin-bottom:14px;">
            <div style="flex:1;background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">This week</div>
              <div style="font-size:22px;font-weight:700;color:var(--accent);">${weeklyData[weeklyData.length-1].count}</div>
            </div>
            <div style="flex:1;background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Last week</div>
              <div style="font-size:22px;font-weight:700;color:var(--text2);">${weeklyData[weeklyData.length-2].count}</div>
            </div>
            <div style="flex:1;background:var(--bg);border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">6-week total</div>
              <div style="font-size:22px;font-weight:700;color:var(--text2);">${weeklyData.reduce((s,w)=>s+w.count,0)}</div>
            </div>
          </div>
          <div style="position:relative;height:120px;" id="weekly-chart-wrap">
            <canvas id="weekly-chart"></canvas>
          </div>
        </div>
      </div>

    </div>

    <div style="margin-bottom:24px">
      <div class="section-card">
        <div class="section-card-header"><div class="section-card-title">Recent Applications</div></div>
        <table>
          <tbody>
            ${apps.slice(0,6).map(a => `
              <tr>
                <td><div style="font-size:13px;font-weight:600;color:var(--text);">${esc(a.company||'—')}</div>
                    <div style="font-size:11px;color:var(--text-muted);">${esc(a.jobTitle||'—')}</div></td>
                <td><span class="status-badge ${STATUS_COLORS[a.status]||'s-applied'}">${esc(a.status)}</span></td>
                <td style="font-size:11px;color:var(--text-faint);text-align:right;">${esc(a.date||'—')}</td>
              </tr>`).join('') || '<tr><td colspan="3" class="empty-row">No applications yet</td></tr>'}
          </tbody>
        </table>
        ${apps.length > 6 ? `<div style="padding:10px 16px;border-top:1px solid #f1f5f9;text-align:center;"><button class="auth-link" id="view-all-btn">View all ${apps.length} →</button></div>` : ''}
      </div>
    </div>

    ${apps.filter(a=>a.followUpDate && a.followUpDate >= todayISO()).length > 0 ? `
    <div class="section-card">
      <div class="section-card-header"><div class="section-card-title">📅 Upcoming Follow-ups</div></div>
      <table>
        <thead><tr><th>Company</th><th>Job Title</th><th>Status</th><th>Follow-up Date</th></tr></thead>
        <tbody>
          ${apps.filter(a=>a.followUpDate && a.followUpDate >= todayISO())
            .sort((a,b) => a.followUpDate.localeCompare(b.followUpDate))
            .slice(0,5).map(a => `
            <tr>
              <td style="font-weight:600">${esc(a.company||'—')}</td>
              <td>${esc(a.jobTitle||'—')}</td>
              <td><span class="status-badge ${STATUS_COLORS[a.status]||'s-applied'}">${esc(a.status)}</span></td>
              <td style="color:${a.followUpDate===todayISO()?'#c53030':'#276749'};font-weight:600;">${a.followUpDate===todayISO()?'⚠ Today':esc(a.followUpDate)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}`;

  // Critical fix: render chart after innerHTML is set — scripts inside innerHTML don't execute
  document.getElementById('page-content').innerHTML = dashHTML;

  // Build weekly chart — pure canvas, no Chart.js dependency
  function buildWeeklyChart() {
    const el = document.getElementById('weekly-chart');
    if (!el) return;
    const labels = weeklyData.map(w => w.label);
    const data   = weeklyData.map(w => w.count);
    const max    = Math.max(...data, 1);
    const W = el.parentElement.offsetWidth || 340;
    const H = 120;
    el.width  = W;
    el.height = H;
    const ctx = el.getContext('2d');
    const n   = data.length;
    const barW  = Math.floor((W - 20) / n * 0.55);
    const gap   = Math.floor((W - 20) / n);
    const padB  = 22, padT = 10;
    const chartH = H - padB - padT;
    ctx.clearRect(0, 0, W, H);
    data.forEach((val, i) => {
      const x   = 10 + i * gap + (gap - barW) / 2;
      const bH  = val > 0 ? Math.max(4, Math.round((val / max) * chartH)) : 0;
      const y   = padT + chartH - bH;
      ctx.fillStyle = i === n - 1 ? '#4f46e5' : '#c7d2fe';
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bH, 3);
      ctx.fill();
      if (val > 0) {
        ctx.fillStyle = '#4a5568';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(val, x + barW / 2, y - 3);
      }
      ctx.fillStyle = '#a0aec0';
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barW / 2, H - 5);
    });
  }
  buildWeeklyChart();
  if (apps.length > 6) {
    const viewAllBtn = document.getElementById('view-all-btn');
    if (viewAllBtn) viewAllBtn.addEventListener('click', () => navigateTo('applications'));
  }
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

  const stored = localStorage.getItem('rjd_blaze_shortcuts');
  if (stored) { try { blazeTemplates = JSON.parse(stored); } catch(e) {} }

  if (!blazeSelectedAppId && apps.length > 0) blazeSelectedAppId = apps[apps.length-1].id;

  const selectedApp = apps.find(a => String(a.id) === String(blazeSelectedAppId));
  const personalProfile = await loadResumeProfileDB();

  const provider = BLAZE_PROVIDERS[blazeSelectedProvider] || BLAZE_PROVIDERS.google;

  content.innerHTML = `
    <div class="blaze-premium-container">
      <div class="blaze-glass-layout">
        
        <!-- Dashboard Sidebar: Context & Actions -->
        <aside class="blaze-glass-sidebar">
          <div class="blaze-sidebar-header">
            <span class="blaze-fire-icon">🔥</span>
            <div>
              <div class="blaze-brand">AI-Blaze</div>
              <div class="blaze-status-pill" id="blaze-status">Ready</div>
            </div>
          </div>

          <div class="blaze-group">
            <label class="blaze-label">TARGET APPLICATION</label>
            <div class="blaze-select-wrap">
              <select class="blaze-select" id="blaze-app-select">
                <option value="">No specific app (Profile only)</option>
                ${apps.slice().reverse().map(a => `
                  <option value="${a.id}" ${blazeSelectedAppId === a.id ? 'selected' : ''}>
                    ${esc(a.company || '—')}
                  </option>
                `).join('')}
              </select>
            </div>
            ${selectedApp ? `
              <div class="blaze-context-card">
                <div class="blaze-context-title">${esc(selectedApp.jobTitle || 'Role')}</div>
                <div class="blaze-context-tags">
                  <span class="blaze-tag ${selectedApp.jd ? 'active' : ''}">${selectedApp.jd ? '✓ JD' : 'No JD'}</span>
                  <span class="blaze-tag ${selectedApp.resume ? 'active' : ''}">${selectedApp.resume ? '✓ Resume' : 'No Resume'}</span>
                </div>
              </div>
            ` : ''}
          </div>

          <div class="blaze-group">
            <label class="blaze-label">QUICK ACTIONS</label>
            <div class="blaze-shortcuts-grid">
              ${blazeTemplates.map(t => `
                <div class="blaze-shortcut-card" data-key="${t.key}">
                  <span class="blaze-shortcut-icon">${t.icon || '⚡'}</span>
                  <span class="blaze-shortcut-label">${esc(t.label)}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="blaze-group">
            <label class="blaze-label">ENGINE & MODEL</label>
            <div class="blaze-config-row">
              <div class="blaze-status-pill blue">Gemini 3.1 Flash Lite</div>
            </div>
            <div style="font-size:10px; color:var(--text-muted); margin-top:8px;">Manage your API key in <a href="#" onclick="navigateTo('settings'); settingsSection='apikey'; renderSettings(); return false;" style="color:var(--accent); text-decoration:none;">Settings</a>.</div>
          </div>
        </aside>

        <!-- Main Generation Area -->
        <main class="blaze-glass-main">
          <div class="blaze-chat-container">
            <div class="rjd-chat-greeting" style="margin: 40px 0 20px;">
              <h1>How can I help you today?</h1>
            </div>


            <div id="blaze-history"></div>

            <div class="blaze-response-area hidden" id="blaze-result-wrap">
              <div class="blaze-response-header">
                <span class="blaze-ai-label">✨ BLAZE AI</span>
                <button class="blaze-copy-btn" id="blaze-copy-btn">📋 Copy Result</button>
              </div>
              <div class="blaze-response-content" id="blaze-result-text"></div>
            </div>
          </div>

          <div class="blaze-input-footer">
            <div class="blaze-input-container">
              <textarea class="blaze-textarea" id="blaze-query" placeholder="How can I help you today?"></textarea>
              <button class="blaze-submit-btn" id="blaze-go-btn" title="Send Message">
                <span class="blaze-btn-arrow">→</span>
              </button>
            </div>
            <div class="blaze-input-hints">
              <span>Press <b>Shift + Enter</b> for new line</span>
              <button id="blaze-clear-btn" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:11px;">Clear Workspace</button>
            </div>
          </div>
        </main>

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

  const resp = await fetch(url, {
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
       const altResp = await fetch(altUrl, {
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
          <th>#</th><th>Company</th><th>Job Title</th><th>URL</th><th>Status</th><th>Session Date</th><th>Resume Content</th><th>Download</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0
            ? `<tr><td colspan="${isBulkMode ? 9 : 8}" class="empty-row">No applications match your filters</td></tr>`
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
                <td>
                  <button class="auth-link add-resume-btn" data-id="${a.id}" style="font-size:12px;font-weight:600;color:${a.resume?'#059669':'var(--accent)'};">
                    ${a.resume ? '📝 Update' : '➕ Add Content'}
                  </button>
                </td>
                <td>
                  <button class="btn-new dl-resume-btn" data-id="${a.id}" style="padding:4px 10px;font-size:11px;${!a.resume ? 'opacity:0.4;pointer-events:none;' : ''}">
                    📥 Download
                  </button>
                </td>
                <td style="white-space:nowrap;">
                  <button class="auth-link del-btn" data-id="${a.id}" style="color:var(--danger);font-size:12px;">Delete</button>
                </td>
              </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>`;

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

  document.querySelectorAll('.add-resume-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const app = apps.find(a => String(a.id) === String(id));
      if (!app) return;
      try {
        const text = await navigator.clipboard.readText();
        if (!text || text.trim().length < 10) {
          showToast('Clipboard is empty or too short. Copy the tailored resume first!', true);
          return;
        }
        app.resume = text.trim();
        const ok = await updateApp(app);
        if (ok) {
          showToast('Resume content saved ✓');
          renderApplications();
        } else {
          showToast('Failed to save content', true);
        }
      } catch (err) {
        showToast('Clipboard access denied. Please click the button to allow.', true);
      }
    });
  });

  document.querySelectorAll('.dl-resume-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const app = apps.find(a => String(a.id) === String(id));
      if (app && app.resume) {
        btn.disabled = true;
        btn.textContent = '⏳ Preparing...';
        try {
          await generateIntegratedResume(app);
          showToast('Resume downloaded ✓');
        } catch (err) {
          console.error(err);
          showToast('Download failed: ' + err.message, true);
        } finally {
          btn.disabled = false;
          btn.textContent = '📥 Download';
        }
      }
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
  // Company & Job Title (now inputs)
  const titleInput = document.getElementById('detail-modal-title');
  const subInput   = document.getElementById('detail-modal-sub');
  if (titleInput) titleInput.value = app.company || '';
  if (subInput)   subInput.value   = app.jobTitle || '';

  // JD tab
  const jdEl = document.getElementById('detail-jd-text');
  jdEl.value = app.jd || '';
  jdEl.style.color = app.jd ? 'var(--text)' : 'var(--text-muted)';
  if (!app.jd) jdEl.placeholder = 'No job description saved.';

  // Resume tab
  const resumeEl = document.getElementById('detail-resume-text');
  resumeEl.value = app.resume || '';
  resumeEl.style.color = app.resume ? 'var(--text)' : 'var(--text-muted)';
  if (!app.resume) resumeEl.placeholder = 'No tailored resume saved.';

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
}

// Tab clicks
document.addEventListener('click', e => {
  if (e.target.classList.contains('detail-tab')) switchDetailTab(e.target.dataset.tab);
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
        ${[['apikey','🔑','API Key'],['blaze_shortcuts','🔥','Blaze Shortcuts'],['resumeprofile','📄','Resume Profile'],['account','👤','Account'],['shortcuts','⌨️','Shortcuts'],['privacy-s','🛡️','Privacy'],['about','ℹ️','About']].map(([id,icon,label]) =>
          `<div class="settings-nav-item ${settingsSection===id?'active':''}" data-sec="${id}">${icon} ${label}</div>`
        ).join('')}
      </div>
      <div class="settings-content-card" id="settings-panel"></div>
    </div>`;

  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => { settingsSection = item.dataset.sec; renderSettings(); });
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
        <div class="settings-section-title">AI Provider Configuration</div>
        <div class="settings-section-sub">Configure your Gemini engine for extraction and AI-Blaze assistance.</div>
        
        <div id="settings-msg" style="margin-bottom:20px;"></div>

        <div class="provider-config-card" style="margin-bottom:24px; background:var(--bg-inset); padding:20px; border-radius:16px; border:1px solid var(--border);">
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
            <div style="width:40px; height:40px; background:#4285f4; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px;">💎</div>
            <div>
              <div style="font-weight:700; color:var(--text);">Google Gemini</div>
              <div style="font-size:11px; color:var(--text-muted);">Consolidated extraction engine for all AI features.</div>
            </div>
            <a href="https://aistudio.google.com" target="_blank" style="margin-left:auto; font-size:11px; color:var(--accent); font-weight:700;">Get Free Key ↗</a>
          </div>
          
          <div style="margin-bottom:16px;">
            <label style="display:block; font-size:11px; font-weight:700; margin-bottom:6px; color:var(--text-muted);">API KEY</label>
            <div style="display:flex; gap:8px;">
              <input type="password" class="settings-input" id="google-key-input" value="${esc(googleKey)}" placeholder="AIzaSy..." style="flex:1;"/>
              <button class="btn-new" data-toggle-password="google-key-input" style="width:70px;">Show</button>
            </div>
          </div>

          <div>
            <label style="display:block; font-size:11px; font-weight:700; margin-bottom:6px; color:var(--text-muted);">MODEL ID</label>
            <input type="text" class="settings-input" id="google-model-input" value="${esc(googleModel)}" placeholder="e.g. gemini-1.5-flash" style="width:100%;" list="gemini-models-list"/>
            <datalist id="gemini-models-list">
              <option value="gemini-1.5-flash">
              <option value="gemini-1.5-pro">
              <option value="gemini-2.0-flash">
              <option value="gemini-2.5-flash-lite">
              <option value="gemini-3.1-flash-lite">
            </datalist>
            <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">Pro-tip: Use <strong>gemini-1.5-flash</strong> for best speed/stability fallback.</div>
          </div>
        </div>

        <button class="settings-btn" id="save-all-keys-btn" style="padding:12px 32px; width:100%; font-weight:800; background:var(--accent);">Save Configuration ✓</button>
        <div style="margin-top:16px; font-size:12px; color:var(--text-muted); text-align:center;">
          <strong>Security Protocol:</strong> Your private API keys are stored only in your local browser storage and never uploaded to any cloud server or Supabase.
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
        el.onchange = () => {
          const idx = el.dataset.idx;
          if (el.classList.contains('shortcut-label')) blazeTemplates[idx].label = el.value.trim();
          else blazeTemplates[idx].prompt = el.value.trim();
          localStorage.setItem('rjd_blaze_shortcuts', JSON.stringify(blazeTemplates));
          showToast('Updated ✓');
        };
      });

      document.querySelectorAll('.remove-shortcut-btn').forEach(btn => {
        btn.onclick = () => {
          blazeTemplates.splice(btn.dataset.idx, 1);
          localStorage.setItem('rjd_blaze_shortcuts', JSON.stringify(blazeTemplates));
          updateList();
        };
      });
    };

    updateList();

    document.getElementById('add-shortcut-btn').onclick = () => {
      const key = '-' + Math.random().toString(36).substring(7);
      blazeTemplates.push({ key, label: 'New Shortcut', prompt: 'Enter prompt here...' });
      localStorage.setItem('rjd_blaze_shortcuts', JSON.stringify(blazeTemplates));
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
      <div class="settings-section-title">Account</div>
      <div class="settings-section-sub">Your profile and login details.</div>
      <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid #e2e8f0;">
        <div style="width:48px;height:48px;border-radius:50%;background:#1F4E79;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;">${esc(initials(currentUser.name))}</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#1a202c;">${esc(currentUser.name)}</div>
          <div style="font-size:12px;color:#718096;">${esc(currentUser.email)}</div>
        </div>
      </div>
      <div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:20px;">
        <div style="font-size:13px;font-weight:700;color:#1F4E79;margin-bottom:4px;">🔑 Change Password</div>
        <div style="font-size:12px;color:#718096;margin-bottom:12px;">Update your Supabase authentication password.</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="password" id="new-pwd-input" class="settings-input" placeholder="New password (min 6 chars)" style="max-width:280px;"/>
          <button class="settings-btn" id="update-pwd-btn" style="padding:10px 24px;">Update</button>
        </div>
        <div id="pwd-msg" style="margin-top:10px;"></div>
      </div>
      <div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:4px;">
        <div style="font-size:13px;font-weight:700;color:#1a202c;margin-bottom:4px;">🌙 Night Shift Cutoff</div>
        <div style="font-size:12px;color:#718096;margin-bottom:10px;">If you work past midnight, applications before this hour are counted as the <strong>previous day</strong>. Affects Today count, calendar, and date export filters.</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <select id="cutoff-select" class="settings-input" style="width:160px;">
            ${[0,1,2,3,4,5,6].map(h => `<option value="${h}" ${getWorkDayCutoff()===h?'selected':''}>${h===0?'Disabled (midnight)':h+':00 AM'}</option>`).join('')}
          </select>
          <button class="settings-btn" id="save-cutoff-btn" style="padding:8px 20px;">Save</button>
          <span id="cutoff-msg" style="font-size:12px;color:#276749;"></span>
        </div>
      </div>
      <div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:20px;">
        <div style="font-size:13px;font-weight:700;color:#c53030;margin-bottom:10px;">Danger Zone</div>
        <button class="settings-danger-btn" id="delete-all-btn">Delete all my applications</button>
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
  }
}

// ── EXPORT PAGE ──
function renderExport() {
  // Build list of unique WORK-DAY dates that have applications
  // Use dateKey (working date chosen in extension) if available, else fallback to workday from dateRaw
  const dateCounts = {};
  apps.forEach(a => {
    // dateKey is YYYY-MM-DD (zero-padded) — use directly
    const k = a.dateKey || (a.dateRaw ? getWorkDayISO(a.dateRaw) : '');
    if (k) dateCounts[k] = (dateCounts[k]||0)+1;
  });
  const uniqueDates = Object.keys(dateCounts).sort().reverse().slice(0, 7);
  const wToday = workTodayISO();

  document.getElementById('page-content').innerHTML = `
    <!-- Filter bar -->
    <div class="section-card" style="padding:20px;max-width:700px;margin-bottom:20px;">
      <div style="font-size:14px;font-weight:700;color:#1a202c;margin-bottom:12px;">📅 Filter by Date</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button class="export-date-btn active" data-date="" style="">All (${apps.length})</button>
        <button class="export-date-btn" data-date="${wToday}">Today (${dateCounts[wToday]||0})</button>
        ${uniqueDates.filter(d => d !== wToday).map(d => `
          <button class="export-date-btn" data-date="${d}">${d} (${dateCounts[d]})</button>
        `).join('')}
        <input type="date" id="export-custom-date" class="filter-input" max="${todayISO()}" style="height:34px;" title="Pick a custom date"/>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid #f1f5f9;font-size:13px;color:#718096;">
        Exporting: <strong id="export-count-label" style="color:#1F4E79;">${apps.length} applications</strong>
      </div>
    </div>

    <!-- Export buttons -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:700px;">
      <div class="section-card" style="padding:24px;">
        <div style="font-size:32px;margin-bottom:12px;">📊</div>
        <div style="font-size:15px;font-weight:700;color:#1a202c;margin-bottom:6px;">Excel Report (.xlsx)</div>
        <div style="font-size:13px;color:#718096;margin-bottom:20px;line-height:1.6;">Color-coded spreadsheet with Applications sheet and Summary Dashboard.</div>
        <button class="btn-export" id="export-xlsx-btn" style="width:100%;padding:10px;">Download Excel</button>
      </div>
      <div class="section-card" style="padding:24px;">
        <div style="font-size:32px;margin-bottom:12px;">📄</div>
        <div style="font-size:15px;font-weight:700;color:#1a202c;margin-bottom:6px;">CSV File (.csv)</div>
        <div style="font-size:13px;color:#718096;margin-bottom:20px;line-height:1.6;">Simple comma-separated file. Open in Excel, Google Sheets, or any spreadsheet app.</div>
        <button class="btn-new" id="export-csv-btn" style="width:100%;padding:10px;">Download CSV</button>
      </div>
    </div>
    <div style="margin-top:16px;background:#ebf4ff;border-radius:10px;border:1px solid #bee3f8;padding:16px;max-width:700px;">
      <div style="font-size:13px;font-weight:700;color:#2E75B6;margin-bottom:4px;">💡 Daily Target Tip</div>
      <div style="font-size:12px;color:#4a5568;line-height:1.6;">
        Applied 30 today? Click <strong>Today</strong> above then download — you'll get only today's applications in the sheet.
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
    document.getElementById('export-count-label').textContent = filtered.length + ' application' + (filtered.length !== 1 ? 's' : '');
  }

  function setExportDate(date) {
    exportDate = date;
    document.querySelectorAll('.export-date-btn').forEach(b => b.classList.toggle('active', b.dataset.date === date));
    if (date) document.getElementById('export-custom-date').value = date;
    else document.getElementById('export-custom-date').value = '';
    updateExportLabel();
  }

  document.querySelectorAll('.export-date-btn').forEach(btn => {
    btn.addEventListener('click', () => setExportDate(btn.dataset.date));
  });

  document.getElementById('export-custom-date').addEventListener('change', e => {
    setExportDate(e.target.value);
    // Deselect all quick buttons since custom date is picked
    document.querySelectorAll('.export-date-btn').forEach(b => b.classList.remove('active'));
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

// ── PRIVACY PAGE ──
function renderPrivacy() {
  document.getElementById('page-content').innerHTML = `
    <div style="max-width:800px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px;">
      
      <div class="settings-content-card">
        <div class="settings-section-title">Privacy Policy</div>
        <div class="settings-section-sub">Last updated: March 2026 · Effective immediately</div>
        
        <div class="settings-info-box" style="margin-top:20px;">
          <strong>Privacy-first design:</strong> We do not sell your data. We do not show ads. Your job applications are entirely private to you.
        </div>
      </div>

      <div class="settings-content-card">
        <div class="settings-section-title">Data We Collect</div>
        <div class="settings-section-sub">What information is stored when you use the app.</div>
        
        <div class="privacy-block">
          <strong>Account Information:</strong> When you create an account, we store your email address and an encrypted password (handled securely by Supabase Auth — we never see your password).
        </div>
        <div class="privacy-block">
          <strong>Job Application Data:</strong> When you save an application, we store the company name, job title, posting URL, job description text, resume text, status, notes, and dates. This allows you to track your progress across devices.
        </div>
        <div class="privacy-block">
          <strong>What We Do NOT Collect:</strong> We do not collect browsing history, personal financial information, location data, or any analytics/usage tracking. Your Gemini API key is stored <strong>only in your browser's local storage</strong>.
        </div>
      </div>

      <div class="settings-content-card">
        <div class="settings-section-title">Third-Party Services</div>
        <div class="settings-section-sub">External services required to run the extension.</div>
        
        <div class="privacy-block">
          <strong>Supabase:</strong> Your account and data are securely stored in Supabase, a PostgreSQL cloud database. Data is encrypted in transit and at rest. Row Level Security ensures only you can access your own data.
        </div>
        <div class="privacy-block">
          <strong>Google Gemini API:</strong> The Extract & Save feature sends the job description text to Google's Gemini API to extract the company and job title. This uses your personal API key directly from your browser.
        </div>
      </div>

      <div class="settings-content-card">
        <div class="settings-section-title">Your Rights</div>
        <div class="settings-section-sub">Managing and deleting your information.</div>
        
        <div class="privacy-block">
          <strong>Access your data:</strong> You can export all your data at any time using the Export page to generate Excel or CSV files.
        </div>
        <div class="privacy-block">
          <strong>Delete your data:</strong> You can permanently delete all your applications directly from the Settings page.
        </div>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: var(--text-muted); font-size: 12px;">
        Job Application Tracker v5.0 · This extension is free and open. Your data belongs to you.
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
