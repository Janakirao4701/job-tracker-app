
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
  while (true) {
    let r = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?select=*&username=eq.${currentUser.id}&order=created_at.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: headers({ 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE_SIZE - 1}` }) }
    );
    // If 401 — try refresh token (only on first page attempt)
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
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows.map(mapRow);
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
// ── GEMINI KEY — stored in Supabase per user ──
async function saveGeminiKeyDB(key) {
  // Save to Supabase
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/user_settings', {
      method: 'POST',
      headers: headers({'Prefer': 'resolution=merge-duplicates,return=representation'}),
      body: JSON.stringify({ username: currentUser.id, gemini_key: key })
    });
    if (res.ok) {
      localStorage.setItem('rjd_gemini_key_' + currentUser.id, key);
      // Critical fix #5: also sync to chrome.storage so the extension sidebar can read it
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ rjd_gemini_key: key });
      }
      return true;
    }
  } catch(e) {}
  // Fallback to local storage only
  localStorage.setItem('rjd_gemini_key_' + currentUser.id, key);
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ rjd_gemini_key: key });
  }
  return false;
}

async function loadGeminiKeyDB() {
  // Try localStorage first (fast)
  const localKey = localStorage.getItem('rjd_gemini_key_' + currentUser.id);
  if (localKey) return localKey;
  // Load from Supabase
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/user_settings?username=eq.' + currentUser.id + '&select=gemini_key',
      { headers: headers() }
    );
    if (res.ok) {
      const data = await res.json();
      if (data && data[0] && data[0].gemini_key) {
        const key = data[0].gemini_key;
        localStorage.setItem('rjd_gemini_key_' + currentUser.id, key);
        return key;
      }
    }
  } catch(e) {}
  return '';
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
      chrome.runtime.sendMessage({ action: 'session_cleared' });
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
  const titles = { dashboard:'Overview', applications:'Applications', settings:'Settings', export:'Export', privacy:'Privacy Policy' };
  document.getElementById('page-title').textContent = titles[page] || page;
  const addBtn = document.getElementById('add-app-btn');
  if (addBtn) addBtn.classList.toggle('hidden', page !== 'applications');
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.style.display = '';
  renderPage(page);
}

function renderPage(page) {
  updateBadge();
  if (page === 'dashboard')    renderDashboard();
  else if (page === 'applications') renderApplications();
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

  const dashHTML = window.rjdTemplates.dashboardDashboard({
    apps, week, today, ints, offers, rejected, rate,
    monthName, calMonth, calYear, firstDay, daysInMonth,
    calendarData, weeklyData, todayISO: todayISO(), STATUS_COLORS, esc
  });

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
      // value label on top
      if (val > 0) {
        ctx.fillStyle = '#4a5568';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(val, x + barW / 2, y - 3);
      }
      // x-axis label
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

// ── APPLICATIONS TABLE ──
function renderApplications() {
  let filtered = [...apps];
  if (filterStatus !== 'all') filtered = filtered.filter(a => a.status === filterStatus);
  if (filterDate)   filtered = filtered.filter(a => a.dateRaw && getWorkDayISO(a.dateRaw) === filterDate);
  if (filterSearch) { const q = filterSearch.toLowerCase(); filtered = filtered.filter(a => (a.company+a.jobTitle+a.url).toLowerCase().includes(q)); }

  document.getElementById('page-content').innerHTML = window.rjdTemplates.dashboardApplications({
    isBulkMode, todayISO: todayISO(), filterSearch, filterStatus, STATUSES, filtered, esc
  });

  const tbody = document.getElementById('app-tbody');
  if (tbody) {
    tbody.innerHTML = filtered.length === 0 
      ? `<tr><td colspan="${isBulkMode ? 8 : 7}" class="empty-row">No applications found matching your filters.</td></tr>`
      : filtered.map((a,i) => `
        <tr data-id="${a.id}" class="app-row" style="cursor:pointer;transition:background 0.2s;">
          <td class="bulk-col" style="display:${isBulkMode ? 'table-cell' : 'none'};"><input type="checkbox" class="app-chk" data-id="${a.id}"/></td>
          <td style="color:var(--text-faint);font-size:12px;">${i+1}</td>
          <td><div style="font-weight:600;font-size:13px;color:var(--text);">${esc(a.company||'—')}</div>
              <div style="margin-top:3px;display:flex;gap:4px;">
                ${a.jd     ? `<span style="font-size:10px;background:var(--accent-light);color:var(--accent);border-radius:4px;padding:1px 5px;font-weight:600;">JD</span>` : ''}
                ${a.resume ? `<span style="font-size:10px;background:#ecfdf5;color:#059669;border-radius:4px;padding:1px 5px;font-weight:600;">Resume</span>` : ''}
              </div>
          </td>
          <td style="font-size:13px;color:var(--text2);">${esc(a.jobTitle||'—')}</td>
          <td>${a.url?`<a href="${esc(a.url)}" target="_blank" class="url-link">Open ↗</a>`:'—'}</td>
          <td>
            <div class="status-chip ${STATUS_COLORS[a.status]||'s-applied'}" data-id="${a.id}" style="cursor:pointer;display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;">${a.status}</div>
          </td>
          <td style="font-size:12px;color:var(--text-muted);white-space:nowrap;">${esc(a.dateKey||getWorkDayISO(a.dateRaw)||'—')}</td>
          <td style="white-space:nowrap;">
            <button class="auth-link del-btn" data-id="${a.id}" style="color:var(--danger);font-size:12px;">Delete</button>
          </td>
        </tr>`).join('');
  }

  // Mobile FAB button
  if (window.innerWidth <= 768) {
    const old = document.getElementById('mobile-fab'); if (old) old.remove();
    const fab = document.createElement('button');
    fab.id = 'mobile-fab'; fab.innerHTML = '+ Add';
    fab.style.cssText = 'position:fixed;bottom:72px;right:16px;background:#1F4E79;color:#fff;border:none;border-radius:50px;padding:12px 20px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(31,78,121,0.4);z-index:50;';
    fab.onclick = () => document.getElementById('add-modal').classList.remove('hidden');
    document.body.appendChild(fab);
  }

  // Event Listeners
  document.getElementById('app-search').oninput = (e) => { filterSearch = e.target.value; renderApplications(); };
  document.getElementById('app-status-filter').onchange = (e) => { filterStatus = e.target.value; renderApplications(); };
  document.getElementById('app-date-filter').onchange = (e) => { filterDate = e.target.value; renderApplications(); };

  const toggleBulkBtn = document.getElementById('toggle-bulk-mode-btn');
  if (toggleBulkBtn) {
    toggleBulkBtn.onclick = () => { isBulkMode = !isBulkMode; renderApplications(); };
  }

  const selectAll = document.getElementById('select-all-chk');
  if (selectAll) {
    selectAll.onchange = (e) => {
      document.querySelectorAll('.app-chk').forEach(c => c.checked = e.target.checked);
      updateBulkBar();
    };
  }

  document.querySelectorAll('.app-chk').forEach(chk => {
    chk.onchange = updateBulkBar;
  });

  function updateBulkBar() {
    const selected = document.querySelectorAll('.app-chk:checked');
    const bulkCount = document.getElementById('bulk-count');
    if (bulkCount) bulkCount.textContent = selected.length + ' selected';
  }

  // Bulk Status Change
  const bulkStatus = document.getElementById('bulk-status-box');
  if (bulkStatus) {
    bulkStatus.onclick = async () => {
      const idx = STATUSES.indexOf(bulkStatus.dataset.value || 'Applied');
      const next = STATUSES[(idx + 1) % STATUSES.length];
      bulkStatus.dataset.value = next;
      bulkStatus.textContent = next + ' ▾';
      const ids = [...document.querySelectorAll('.app-chk:checked')].map(c => c.dataset.id);
      if (ids.length && confirm(`Change status of ${ids.length} applications to ${next}?`)) {
        showToast('Updating statuses...');
        for (const id of ids) {
          const app = apps.find(a => String(a.id) === String(id));
          if (app) { app.status = next; await updateApp(app); }
        }
        renderApplications(); updateBadge();
      }
    };
  }

  // Bulk Delete
  const bulkDel = document.getElementById('bulk-delete-btn');
  if (bulkDel) {
    bulkDel.onclick = async () => {
      const ids = [...document.querySelectorAll('.app-chk:checked')].map(c => c.dataset.id);
      if (!ids.length) return;
      if (!confirm(`Delete ${ids.length} applications?`)) return;
      showToast('Deleting...');
      for (const id of ids) {
        await deleteApp(id);
        apps = apps.filter(a => String(a.id) !== String(id));
      }
      renderApplications(); updateBadge();
    };
  }

  // Bulk Reassign Date
  const bulkReassign = document.getElementById('bulk-reassign-btn');
  if (bulkReassign) {
    bulkReassign.onclick = async () => {
      const ids = [...document.querySelectorAll('.app-chk:checked')].map(c => c.dataset.id);
      const newDate = document.getElementById('bulk-session-date').value;
      if (!ids.length || !newDate) return;
      showToast('Reassigning date...');
      for (const id of ids) {
        const app = apps.find(a => String(a.id) === String(id));
        if (app) { app.dateKey = newDate; await updateApp(app); }
      }
      renderApplications();
    };
  }

  // Status Chip Click (Inline Toggle)
  document.querySelectorAll('.status-chip').forEach(chip => {
    chip.onclick = async (e) => {
      e.stopPropagation();
      const idx = STATUSES.indexOf(chip.textContent.trim());
      const next = STATUSES[(idx + 1) % STATUSES.length];
      const app = apps.find(a => String(a.id) === String(chip.dataset.id));
      if (app) {
        app.status = next;
        await updateApp(app);
        chip.textContent = next;
        chip.className = 'status-chip ' + (STATUS_COLORS[next] || 's-applied');
        updateBadge();
        showToast('Status updated ✓');
      }
    };
  });

  // Individual Delete
  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this application?')) return;
      await deleteApp(btn.dataset.id);
      apps = apps.filter(a => String(a.id) !== String(btn.dataset.id));
      renderApplications(); updateBadge();
    };
  });

  // Row Click for Details
  document.querySelectorAll('.app-row').forEach(row => {
    row.onclick = (e) => {
      if (e.target.closest('.app-chk') || e.target.closest('button') || e.target.closest('a') || e.target.closest('.status-chip')) return;
      const app = apps.find(a => String(a.id) === String(row.dataset.id));
      if (app) openDetailModal(app);
    };
  });
}

// ── DETAIL MODAL ──
function openDetailModal(app) {
  document.getElementById('detail-modal-title').textContent = app.company || 'Application';
  document.getElementById('detail-modal-sub').textContent   = app.jobTitle || '';
  document.getElementById('detail-jd-text').textContent     = app.jd || 'No JD';
  document.getElementById('detail-resume-text').textContent = app.resume || 'No Resume';
  document.getElementById('detail-notes-input').value       = app.notes || '';
  document.getElementById('detail-followup-input').value    = app.followUpDate || '';
  
  const statusBtn = document.getElementById('detail-status-sel');
  statusBtn.dataset.value = app.status;
  statusBtn.textContent = app.status + ' ▾';
  statusBtn.style.background = (STATUS_BG[app.status]||STATUS_BG.Applied).bg;
  statusBtn.style.color      = (STATUS_BG[app.status]||STATUS_BG.Applied).color;
  statusBtn.onclick = () => {
    const idx = STATUSES.indexOf(statusBtn.dataset.value);
    const next = STATUSES[(idx + 1) % STATUSES.length];
    statusBtn.dataset.value = next;
    statusBtn.textContent = next + ' ▾';
    statusBtn.style.background = (STATUS_BG[next]||STATUS_BG.Applied).bg;
    statusBtn.style.color      = (STATUS_BG[next]||STATUS_BG.Applied).color;
  };

  document.getElementById('detail-modal').classList.remove('hidden');

  document.getElementById('detail-modal-save').onclick = async () => {
    app.notes = document.getElementById('detail-notes-input').value.trim();
    app.followUpDate = document.getElementById('detail-followup-input').value;
    app.status = statusBtn.dataset.value;
    await updateApp(app);
    showToast('Saved ✓');
    document.getElementById('detail-modal').classList.add('hidden');
    renderApplications();
  };
}

function switchDetailTab(tab) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.detail-tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'detail-tab-' + tab));
}

// ── SETTINGS ──
let settingsSection = 'apikey';
function renderSettings() {
  document.getElementById('page-content').innerHTML = window.rjdTemplates.dashboardSettingsNav({ settingsSection });
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.onclick = () => { settingsSection = item.dataset.sec; renderSettings(); };
  });
  renderSettingsSection(settingsSection);
}

async function renderSettingsSection(sec) {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  const savedKey = await loadGeminiKeyDB();
  let rp = {}; try { rp = JSON.parse(localStorage.getItem('resume_builder_profile') || '{}'); } catch(e) {}
  panel.innerHTML = window.rjdTemplates.dashboardSettingsSection({
    sec, currentUser, initials, getWorkDayCutoff, STATUSES, esc, savedKey, rp
  });

  if (sec === 'apikey') {
    document.getElementById('save-key-btn').onclick = async () => {
      const key = document.getElementById('key-input').value.trim();
      if (await saveGeminiKeyDB(key)) showToast('Key saved & synced ✓');
    };
  } else if (sec === 'account') {
    document.getElementById('save-cutoff-btn').onclick = () => {
      const h = parseInt(document.getElementById('cutoff-select').value, 10);
      saveWorkDayCutoff(h); showToast('Cutoff saved ✓');
    };
    document.getElementById('delete-all-btn').onclick = async () => {
      if (confirm('Delete ALL data?')) {
        await Promise.all(apps.map(a => deleteApp(a.id)));
        apps = []; renderPage(currentPage); showToast('All data deleted');
      }
    };
  } else if (sec === 'resume') {
    document.querySelectorAll('.rp-input').forEach(inp => {
      inp.oninput = () => {
        const profile = {
          name: document.getElementById('rp-name').value,
          title: document.getElementById('rp-title').value,
          email: document.getElementById('rp-email').value,
          phone: document.getElementById('rp-phone').value,
          education: document.getElementById('rp-education').value
        };
        localStorage.setItem('resume_builder_profile', JSON.stringify(profile));
        document.getElementById('rp-status').textContent = 'Auto-saved ✓';
      };
    });
  }
}

// ── EXPORT ──
function renderExport() {
  const dateCounts = {};
  apps.forEach(a => { const k = a.dateKey || (a.dateRaw ? getWorkDayISO(a.dateRaw) : ''); if (k) dateCounts[k] = (dateCounts[k]||0)+1; });
  const uniqueDates = Object.keys(dateCounts).sort().reverse().slice(0, 7);
  const wToday = workTodayISO();
  document.getElementById('page-content').innerHTML = window.rjdTemplates.dashboardExport({
    dateCounts, wToday, apps, uniqueDates, todayISO: todayISO(), esc
  });
  
  document.getElementById('export-csv-btn').onclick = () => {
    const hdrs = ['Company','Job Title','Status','Date'];
    const rows = apps.map(a => [a.company, a.jobTitle, a.status, a.date].map(v => '"'+String(v||'').replace(/"/g,'""')+'"').join(','));
    const blob = new Blob([[hdrs.join(','),...rows].join('\n')], {type:'text/csv'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'applications.csv'; link.click();
  };
}

// ── MODALS & SHORTCUTS ──
document.getElementById('add-app-btn').onclick = () => {
  document.getElementById('add-modal').classList.remove('hidden');
  const mStatus = document.getElementById('m-status');
  mStatus.onclick = () => {
    const idx = STATUSES.indexOf(mStatus.dataset.value || 'Applied');
    const next = STATUSES[(idx + 1) % STATUSES.length];
    mStatus.dataset.value = next; mStatus.textContent = next + ' ▾';
    mStatus.style.background = (STATUS_BG[next]||STATUS_BG.Applied).bg;
    mStatus.style.color      = (STATUS_BG[next]||STATUS_BG.Applied).color;
  };
};
document.getElementById('modal-save').onclick = async () => {
  const company = document.getElementById('m-company').value.trim();
  const title = document.getElementById('m-title').value.trim();
  if (!company) { showToast('Company name required', true); return; }
  const app = {
    id: crypto.randomUUID(), company, jobTitle: title,
    status: document.getElementById('m-status').dataset.value || 'Applied',
    date: today(), dateRaw: new Date().toISOString(), dateKey: workTodayISO(),
    notes: document.getElementById('m-notes').value, jd: document.getElementById('m-jd').value
  };
  if (await saveApp(app)) {
    apps.push(app); renderPage(currentPage);
    document.getElementById('add-modal').classList.add('hidden');
    showToast('Saved ✓');
  }
};
document.querySelectorAll('.modal-close').forEach(b => b.onclick = () => b.closest('.modal-wrap').classList.add('hidden'));

// ── INIT ──
setupAuth();

