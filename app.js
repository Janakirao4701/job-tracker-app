
const SUPABASE_URL = 'https://dxsdvzhnqbynicrvbcfi.supabase.co';
// Extension ID - update this after publishing to Chrome Web Store
// For now using runtime detection
// Extension ID - this is set after the extension is installed
// chrome.runtime.id works when page is opened FROM the extension
// For external pages (Vercel), we use externally_connectable messaging
const EXT_ID = null; // Will be provided via URL parameter
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4c2R2emhucWJ5bmljcnZiY2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTUyMDcsImV4cCI6MjA4OTY5MTIwN30.7csAFAIjVOU8_acamyYoTFLgXzao56k9aDYgGDFd2oo';

const STATUS_COLORS = {
  'Applied':             's-applied',
  'Interview Scheduled': 's-interview',
  'Interview Done':      's-done',
  'Offer':               's-offer',
  'Rejected':            's-rejected',
  'Skipped':             's-skipped',
};
const STATUS_BG = {
  'Applied':             { bg:'#DDEEFF', color:'#1F4E79' },
  'Interview Scheduled': { bg:'#C6EFCE', color:'#276749' },
  'Interview Done':      { bg:'#FFEB9C', color:'#9C5700' },
  'Offer':               { bg:'#D4EDDA', color:'#155724' },
  'Rejected':            { bg:'#FFC7CE', color:'#9C0006' },
  'Skipped':             { bg:'#F2F2F2', color:'#808080' },
};
const STATUSES = ['Applied','Interview Scheduled','Interview Done','Offer','Rejected','Skipped'];

let session     = null;
let currentUser = null;
let apps        = [];
let currentPage = 'dashboard';
let authMode    = 'signin';
let filterStatus = 'all';
let filterSearch = '';
let filterDate   = '';

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

function showToast(msg, isError) {
  const t = document.getElementById('toast');
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
  let r = await fetch(SUPABASE_URL+'/rest/v1/applications?select=*&order=created_at.asc', { headers:headers() });
  // If 401 — try refresh token
  if (r.status === 401 && session?.refresh_token) {
    const refreshed = await refreshToken();
    if (refreshed) {
      r = await fetch(SUPABASE_URL+'/rest/v1/applications?select=*&order=created_at.asc', { headers:headers() });
    } else {
      // Token refresh failed — sign out
      clearStoredSession();
      session = null; currentUser = null; apps = [];
      showSection('auth-section'); setMode('signin');
      return [];
    }
  }
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data.map(mapRow) : [];
}

async function refreshToken() {
  if (!session?.refresh_token) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await r.json();
    if (data.access_token) {
      session = { access_token: data.access_token, refresh_token: data.refresh_token || session.refresh_token };
      // Update stored session
      const stored = loadStoredSession();
      if (stored) {
        stored.token = data.access_token;
        stored.access_token = data.access_token;
        if (data.refresh_token) stored.refreshToken = data.refresh_token;
        localStorage.setItem('rjd_web_session', JSON.stringify(stored));
      }
      return true;
    }
  } catch(e) {}
  return false;
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
  const ta = document.getElementById('topbar-avatar');
  const tn = document.getElementById('topbar-name');
  const te = document.getElementById('topbar-email');
  if (ta) ta.textContent = initials(currentUser.name);
  if (tn) tn.textContent = currentUser.name;
  if (te) te.textContent = currentUser.email;
  // Click topbar user → go to settings
  const tb = document.getElementById('topbar-user-btn');
  if (tb) tb.addEventListener('click', () => navigateTo('settings'));
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
      if (!session || !currentUser) return;
      try {
        const fresh = await loadApps();
        const oldIds  = apps.map(a => a.id).sort().join(',');
        const newIds  = fresh.map(a => a.id).sort().join(',');
        const oldSigs = apps.map(a => a.id + a.status + a.notes + a.followUpDate).sort().join('|');
        const newSigs = fresh.map(a => a.id + a.status + a.notes + a.followUpDate).sort().join('|');
        if (oldIds !== newIds || oldSigs !== newSigs) {
          apps = fresh;
          updateBadge();
          renderPage(currentPage);
        }
      } catch(e) {}
    }, 20 * 1000); // poll every 20 seconds
  }
  // Load and sync Gemini key to extension (non-blocking)
  try {
    const geminiKey = await loadGeminiKeyDB();
    if (geminiKey && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ rjd_gemini_key: geminiKey });
    }
  } catch(e) {}
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
  item.addEventListener('click', () => navigateTo(item.dataset.page));
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
  const today = apps.filter(a => { if(!a.dateRaw) return false; const d=new Date(a.dateRaw); return d.toLocaleDateString('en-CA') === todayISO(); }).length;
  const week  = apps.filter(a => a.dateRaw && (now - new Date(a.dateRaw)) <= 7*86400000).length;
  const ints  = apps.filter(a => a.status==='Interview Scheduled'||a.status==='Interview Done').length;
  const offers= apps.filter(a => a.status==='Offer').length;
  const rejected = apps.filter(a => a.status==='Rejected').length;
  const rate  = apps.length > 0 ? Math.round((offers/apps.length)*100) : 0;

  const statusCounts = {};
  STATUSES.forEach(s => { statusCounts[s] = apps.filter(a => a.status === s).length; });

  // Build calendar day lookup
  const calendarData = {};
  apps.forEach(a => { if (a.dateRaw) { const k = new Date(a.dateRaw).toLocaleDateString('en-CA'); calendarData[k] = (calendarData[k]||0)+1; } });

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
            <span style="font-size:13px;font-weight:600;color:#1a202c;">${monthName}</span>
            <span style="font-size:12px;color:#718096;">${apps.filter(a=>a.dateRaw&&new Date(a.dateRaw).getMonth()===calMonth&&new Date(a.dateRaw).getFullYear()===calYear).length} applied this month</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,32px);gap:2px;justify-content:space-between;">
            ${['S','M','T','W','T','F','S'].map(d=>`<div style="width:32px;height:20px;font-size:10px;color:#a0aec0;font-weight:600;text-align:center;line-height:20px;">${d}</div>`).join('')}
            ${Array(firstDay).fill(`<div style="width:32px;height:32px;"></div>`).join('')}
            ${Array.from({length:daysInMonth},(_,i)=>{
              const d = i+1;
              const key = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const count = calendarData[key]||0;
              const isToday = key === todayISO();
              let bg = 'transparent', color = '#4a5568', fontWeight = '400', border = 'none';
              if (count > 0) { bg = '#1F4E79'; color = '#fff'; fontWeight = '600'; }
              else if (isToday) { bg = '#EBF4FF'; color = '#1F4E79'; fontWeight = '600'; border = '1.5px solid #1F4E79'; }
              return `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${bg};color:${color};font-size:11px;font-weight:${fontWeight};border:${border};" title="${count>0?count+' application'+(count>1?'s':''):''}">${d}</div>`;
            }).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:#718096;"><span style="width:8px;height:8px;border-radius:50%;background:#1F4E79;display:inline-block;"></span>Applied</div>
            <div style="display:flex;align-items:center;gap:4px;font-size:11px;color:#718096;"><span style="width:8px;height:8px;border-radius:50%;background:#EBF4FF;border:1.5px solid #1F4E79;display:inline-block;"></span>Today</div>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-card-header"><div class="section-card-title">📊 Weekly Progress</div></div>
        <div style="padding:12px 16px 16px;">
          <div style="display:flex;gap:12px;margin-bottom:14px;">
            <div style="flex:1;background:#f8fafc;border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;color:#718096;margin-bottom:2px;">This week</div>
              <div style="font-size:22px;font-weight:700;color:#1F4E79;">${weeklyData[weeklyData.length-1].count}</div>
            </div>
            <div style="flex:1;background:#f8fafc;border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;color:#718096;margin-bottom:2px;">Last week</div>
              <div style="font-size:22px;font-weight:700;color:#4a5568;">${weeklyData[weeklyData.length-2].count}</div>
            </div>
            <div style="flex:1;background:#f8fafc;border-radius:8px;padding:10px 12px;">
              <div style="font-size:11px;color:#718096;margin-bottom:2px;">6-week total</div>
              <div style="font-size:22px;font-weight:700;color:#4a5568;">${weeklyData.reduce((s,w)=>s+w.count,0)}</div>
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
                <td><div style="font-size:13px;font-weight:600;color:#1a202c;">${esc(a.company||'—')}</div>
                    <div style="font-size:11px;color:#718096;">${esc(a.jobTitle||'—')}</div></td>
                <td><span class="status-badge ${STATUS_COLORS[a.status]||'s-applied'}">${esc(a.status)}</span></td>
                <td style="font-size:11px;color:#a0aec0;text-align:right;">${esc(a.date||'—')}</td>
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

  // Build weekly chart
  function buildWeeklyChart() {
    const el = document.getElementById('weekly-chart');
    if (!el) return;
    const labels = weeklyData.map(w => w.label);
    const data   = weeklyData.map(w => w.count);
    new Chart(el, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: data.map((_,i) => i===data.length-1?'#1F4E79':'#BFD7ED'), borderRadius:4, borderSkipped:false }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>ctx.parsed.y+' apps'}} },
        scales:{ x:{grid:{display:false},ticks:{font:{size:11},color:'#a0aec0'}}, y:{display:false,beginAtZero:true} }
      }
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
  // Show mobile FAB for adding apps
  const isMobile = window.innerWidth <= 768;
  let filtered = [...apps];
  if (filterStatus !== 'all') filtered = filtered.filter(a => a.status === filterStatus);
  if (filterDate)   filtered = filtered.filter(a => a.dateRaw && new Date(a.dateRaw).toLocaleDateString('en-CA') === filterDate);
  if (filterSearch) { const q = filterSearch.toLowerCase(); filtered = filtered.filter(a => (a.company+a.jobTitle+a.url).toLowerCase().includes(q)); }

  document.getElementById('page-content').innerHTML = `
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-card-title">All Applications (${filtered.length})</div>
        <div class="filters-row">
          <input class="filter-input" id="app-search" placeholder="Search..." value="${esc(filterSearch)}" style="width:160px"/>
          <select class="filter-select" id="app-status-filter">
            <option value="all" ${filterStatus==='all'?'selected':''}>All Statuses</option>
            ${STATUSES.map(s=>`<option value="${s}" ${filterStatus===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <input class="filter-input" type="date" id="app-date-filter" value="${filterDate}" style="width:150px"/>
        </div>
      </div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Company</th><th>Job Title</th><th>URL</th><th>Status</th><th>Date</th><th>Notes</th><th>Actions</th></tr></thead>
        <tbody>
          ${filtered.length === 0
            ? '<tr><td colspan="8" class="empty-row">No applications match your filters</td></tr>'
            : filtered.map((a,i) => `
              <tr data-id="${a.id}">
                <td style="color:#a0aec0;font-size:12px;">${i+1}</td>
                <td><div style="font-weight:600;font-size:13px;">${esc(a.company||'—')}</div>
                    <div style="margin-top:3px;display:flex;gap:4px;">
                      ${a.jd     ? `<span style="font-size:10px;background:#EBF4FF;color:#1F4E79;border-radius:4px;padding:1px 5px;font-weight:600;">JD</span>` : ''}
                      ${a.resume ? `<span style="font-size:10px;background:#F0FFF4;color:#276749;border-radius:4px;padding:1px 5px;font-weight:600;">Resume</span>` : ''}
                    </div>
                </td>
                <td style="font-size:13px;color:#4a5568;">${esc(a.jobTitle||'—')}</td>
                <td>${a.url?`<a href="${esc(a.url)}" target="_blank" class="url-link">Open ↗</a>`:'—'}</td>
                <td>
                  <select class="status-select" data-id="${a.id}" style="background:${(STATUS_BG[a.status]||STATUS_BG.Applied).bg};color:${(STATUS_BG[a.status]||STATUS_BG.Applied).color};">
                    ${STATUSES.map(s=>`<option value="${s}" ${a.status===s?'selected':''}>${s}</option>`).join('')}
                  </select>
                </td>
                <td style="font-size:12px;color:#718096;white-space:nowrap;">${esc(a.date||'—')}</td>
                <td style="font-size:12px;color:#718096;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.notes||'—')}</td>
                <td style="white-space:nowrap;">
                  <button class="auth-link view-btn" data-id="${a.id}" style="color:#2E75B6;font-size:12px;margin-right:8px;">View</button>
                  <button class="auth-link del-btn" data-id="${a.id}" style="color:#c53030;font-size:12px;">Delete</button>
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

  document.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const app = apps.find(a => a.id === sel.dataset.id);
      if (app) { app.status = sel.value; await updateApp(app); sel.style.background=(STATUS_BG[sel.value]||STATUS_BG.Applied).bg; sel.style.color=(STATUS_BG[sel.value]||STATUS_BG.Applied).color; showToast('Status updated'); }
    });
  });

  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this application?')) return;
      await deleteApp(btn.dataset.id);
      apps = apps.filter(a => a.id !== btn.dataset.id);
      renderApplications(); updateBadge(); showToast('Deleted');
    });
  });

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const app = apps.find(a => a.id === btn.dataset.id);
      if (app) openDetailModal(app);
    });
  });
}

// ── DETAIL MODAL ──
function openDetailModal(app) {
  // Title & subtitle
  document.getElementById('detail-modal-title').textContent = app.company || 'Application';
  document.getElementById('detail-modal-sub').textContent   = app.jobTitle || '';

  // JD tab
  const jdEl = document.getElementById('detail-jd-text');
  jdEl.textContent = app.jd || 'No job description saved for this application.';
  jdEl.style.color = app.jd ? '#2d3748' : '#a0aec0';

  // Resume tab
  const resumeEl = document.getElementById('detail-resume-text');
  resumeEl.textContent = app.resume || 'No resume saved for this application.';
  resumeEl.style.color = app.resume ? '#2d3748' : '#a0aec0';

  // Notes tab
  document.getElementById('detail-notes-input').value    = app.notes || '';
  document.getElementById('detail-followup-input').value = app.followUpDate || '';
  const statusSel = document.getElementById('detail-status-sel');
  statusSel.innerHTML = STATUSES.map(s => `<option value="${s}" ${app.status===s?'selected':''}>${s}</option>`).join('');
  statusSel.style.background = (STATUS_BG[app.status]||STATUS_BG.Applied).bg;
  statusSel.style.color      = (STATUS_BG[app.status]||STATUS_BG.Applied).color;
  statusSel.addEventListener('change', () => {
    statusSel.style.background = (STATUS_BG[statusSel.value]||STATUS_BG.Applied).bg;
    statusSel.style.color      = (STATUS_BG[statusSel.value]||STATUS_BG.Applied).color;
  });

  // URL button
  const urlLink = document.getElementById('detail-url-link');
  if (app.url) { urlLink.href = app.url; urlLink.style.display = 'inline-flex'; }
  else         { urlLink.style.display = 'none'; }

  // Default to JD tab (or resume if no JD)
  switchDetailTab(app.jd ? 'jd' : (app.resume ? 'resume' : 'notes'));

  // Show modal
  document.getElementById('detail-modal').classList.remove('hidden');

  // Save changes
  document.getElementById('detail-modal-save').onclick = async () => {
    app.notes       = document.getElementById('detail-notes-input').value.trim();
    app.followUpDate= document.getElementById('detail-followup-input').value;
    app.status      = document.getElementById('detail-status-sel').value;
    const ok = await updateApp(app);
    if (ok) { showToast('Saved ✓'); document.getElementById('detail-modal').classList.add('hidden'); renderPage(currentPage); }
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
        ${[['apikey','🔑','API Key'],['account','👤','Account'],['shortcuts','⌨️','Shortcuts'],['privacy-s','🛡️','Privacy'],['about','ℹ️','About']].map(([id,icon,label]) =>
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
    // Critical fix #5: read from chrome.storage first (shared with extension), fall back to localStorage
    const localKey = localStorage.getItem('rjd_gemini_key_' + (currentUser?.id||'')) || '';
    let savedKey = localKey;
    if (!savedKey && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('rjd_gemini_key', r => {
        if (r.rjd_gemini_key) {
          const input = document.getElementById('key-input');
          if (input) input.value = r.rjd_gemini_key;
        }
      });
    }
    panel.innerHTML = `
      <div class="settings-section-title">Gemini API Key</div>
      <div class="settings-section-sub">Powers AI extraction in the Chrome extension. Free from Google.</div>
      <div class="settings-info-box">Your key is stored only in your browser. It is sent directly to Google Gemini — never to any other server.</div>
      <div id="settings-msg"></div>
      <div class="settings-field" style="max-width:480px;"><label>API Key</label>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <input type="password" class="settings-input" id="key-input" value="${esc(savedKey)}" placeholder="AIzaSy..." style="flex:1;max-width:520px;"/>
          <button class="btn-new" id="show-key-btn" style="white-space:nowrap;padding:0 16px;height:42px;">Show</button>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:20px;">
          <button class="settings-btn" id="save-key-btn" style="padding:10px 28px;font-size:14px;">Save Key</button>
        </div>
      </div>
      <div style="font-size:13px;color:#4a5568;background:#f8fafc;border-radius:8px;padding:14px;border:1px solid #e2e8f0;">
        <strong>Get a free key:</strong><br>
        1. Go to <a href="https://aistudio.google.com" target="_blank" style="color:#2E75B6;">aistudio.google.com</a><br>
        2. Click <strong>Get API Key → Create API key</strong><br>
        3. Copy and paste it above
      </div>`;

    let shown = false;
    document.getElementById('show-key-btn').addEventListener('click', () => {
      shown = !shown;
      document.getElementById('key-input').type = shown ? 'text' : 'password';
      document.getElementById('show-key-btn').textContent = shown ? 'Hide' : 'Show';
    });
    document.getElementById('save-key-btn').addEventListener('click', () => {
      const key = document.getElementById('key-input').value.trim();
      if (!key) { document.getElementById('settings-msg').innerHTML='<div class="auth-msg error">Enter your API key</div>'; return; }
      if (!key.startsWith('AIza')) { document.getElementById('settings-msg').innerHTML='<div class="auth-msg error">Key should start with AIza...</div>'; return; }
      saveGeminiKeyDB(key).then(saved => {
        document.getElementById('settings-msg').innerHTML='<div class="auth-msg success">Key saved ' + (saved ? '& synced ✓' : '(locally) ✓') + '</div>';
        setTimeout(() => { const el=document.getElementById('settings-msg'); if(el) el.innerHTML=''; }, 3000);
      });
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
      <div style="background:#fff8f0;border:1px solid #fbd38d;border-radius:8px;padding:12px 16px;font-size:13px;color:#975a16;margin-bottom:20px;">
        To change your password, sign out and use the Forgot Password option on the sign-in screen.
      </div>
      <div style="border-top:1px solid #f1f5f9;padding-top:20px;">
        <div style="font-size:13px;font-weight:700;color:#c53030;margin-bottom:10px;">Danger Zone</div>
        <button class="settings-danger-btn" id="delete-all-btn">Delete all my applications</button>
      </div>`;

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
        ['AI Model',   'Google Gemini 2.5 Flash'],
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
  document.getElementById('page-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:700px;">
      <div class="section-card" style="padding:24px;">
        <div style="font-size:32px;margin-bottom:12px;">📊</div>
        <div style="font-size:15px;font-weight:700;color:#1a202c;margin-bottom:6px;">Excel Report (.xlsx)</div>
        <div style="font-size:13px;color:#718096;margin-bottom:20px;line-height:1.6;">Professional color-coded spreadsheet with Applications sheet and Summary Dashboard.</div>
        <button class="btn-export" id="export-xlsx-btn" style="width:100%;padding:10px;">Download Excel</button>
      </div>
      <div class="section-card" style="padding:24px;">
        <div style="font-size:32px;margin-bottom:12px;">📄</div>
        <div style="font-size:15px;font-weight:700;color:#1a202c;margin-bottom:6px;">CSV File (.csv)</div>
        <div style="font-size:13px;color:#718096;margin-bottom:20px;line-height:1.6;">Simple comma-separated file. Open in Excel, Google Sheets, or any spreadsheet app.</div>
        <button class="btn-new" id="export-csv-btn" style="width:100%;padding:10px;">Download CSV</button>
      </div>
    </div>
    <div style="margin-top:20px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:20px;max-width:700px;">
      <div style="font-size:14px;font-weight:700;color:#1a202c;margin-bottom:8px;">Export summary</div>
      <div style="font-size:13px;color:#718096;">
        <strong>${apps.length}</strong> total applications · 
        <strong>${apps.filter(a=>a.resume).length}</strong> with resume · 
        <strong>${apps.filter(a=>a.jd).length}</strong> with JD
      </div>
    </div>
    <div style="margin-top:16px;background:#ebf4ff;border-radius:10px;border:1px solid #bee3f8;padding:16px;max-width:700px;">
      <div style="font-size:13px;font-weight:700;color:#2E75B6;margin-bottom:4px;">💡 Interview Notifications</div>
      <div style="font-size:12px;color:#4a5568;line-height:1.6;">
        To get notified on interview day — open any application in the tracker, set the <strong>Follow-up Date</strong> to your interview date, and make sure status is <strong>Interview Scheduled</strong>. You'll get a Chrome notification at 9am that day.
      </div>
    </div>`;

  document.getElementById('export-csv-btn').addEventListener('click', () => {
    if (!apps.length) { showToast('No applications to export', true); return; }
    const headers = ['#','Company','Job Title','URL','Status','Date','Follow-up Date','Notes'];
    const rows = apps.map((a,i) => [i+1,a.company,a.jobTitle,a.url,a.status,a.date,a.followUpDate||'',a.notes].map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(','));
    const blob = new Blob([[headers.join(','),...rows].join('\n')], {type:'text/csv'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (currentUser.name||'applications')+'_'+todayISO()+'.csv';
    link.click();
    showToast('CSV exported');
  });

  document.getElementById('export-xlsx-btn').addEventListener('click', async () => {
    if (!apps.length) { showToast('No applications to export', true); return; }
    showToast('Preparing export...');
    try {
      // Warning fix #3: implement full XLSX export in web app — same logic as content.js
      const now = new Date();
      const statusStyleMap = { 'Applied':2,'Interview Scheduled':3,'Interview Done':4,'Offer':5,'Rejected':6,'Skipped':7 };
      const numCols = 8;
      const colWidths = [5, 22, 30, 28, 20, 14, 45, 55];
      const rowHeights = {};
      const sheetRows = [];
      sheetRows.push([{ v: 'Job Application Report — ' + currentUser.name, t:'s', s:15 }, ...Array(numCols-1).fill(null)]);
      rowHeights[0] = 30;
      sheetRows.push([{ v: 'Exported on ' + now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) + '   ·   Total: ' + apps.length, t:'s', s:16 }, ...Array(numCols-1).fill(null)]);
      rowHeights[1] = 18;
      sheetRows.push(Array(numCols).fill(null)); rowHeights[2] = 6;
      const xlsxHeaders = ['#','Company','Job Title','Job URL','Status','Date Applied','Resume Text','Job Description'];
      sheetRows.push(xlsxHeaders.map(h=>({ v:h, t:'s', s:1 }))); rowHeights[3] = 22;
      apps.forEach((a,i) => {
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
      const statusCounts = {}; STATUSES2.forEach(s=>{ statusCounts[s]=apps.filter(a=>a.status===s).length; });
      const s2rows = []; const s2heights = {};
      s2rows.push([{ v:'Summary Dashboard', t:'s', s:15 }, null,null,null,null,null]); s2heights[0]=28;
      s2rows.push([{ v:'User: '+currentUser.name+'   ·   '+now.toLocaleDateString(), t:'s', s:16 }, null,null,null,null,null]); s2heights[1]=16;
      s2rows.push(Array(6).fill(null)); s2heights[2]=10;
      const kpis=[{label:'Total',value:String(apps.length)},{label:'This Week',value:String(apps.filter(a=>{const d=new Date(a.dateRaw);return(now-d)<=7*86400000;}).length)},{label:'Interviews',value:String((statusCounts['Interview Scheduled']||0)+(statusCounts['Interview Done']||0))},{label:'Offers',value:String(statusCounts['Offer']||0)},{label:'With Resume',value:String(apps.filter(a=>a.resume).length)},{label:'Success %',value:apps.length>0?Math.round(((statusCounts['Offer']||0)/apps.length)*100)+'%':'0%'}];
      const kpiStyles=[17,22,23,24,25,26];
      s2rows.push(kpis.map((k,i)=>({ v:k.label, t:'s', s:kpiStyles[i] }))); s2heights[3]=18;
      s2rows.push(kpis.map(k=>({ v:k.value, t:'s', s:18 }))); s2heights[4]=40;
      s2rows.push(Array(6).fill(null)); s2heights[5]=12;
      s2rows.push([{v:'Status',t:'s',s:19},{v:'Count',t:'s',s:19},{v:'%',t:'s',s:19},null,null,null]); s2heights[6]=20;
      STATUSES2.forEach((st,i)=>{ const c=statusCounts[st]||0; const pct=apps.length>0?((c/apps.length)*100).toFixed(1)+'%':'0%'; const ss=statusStyleMap[st]||2; s2rows.push([{v:st,t:'s',s:ss},{v:String(c),t:'n',s:13},{v:pct,t:'s',s:13},null,null,null]); s2heights[7+i]=18; });
      const bytes = await window.buildXLSX([
        { name:'Applications', headers:xlsxHeaders, rows:sheetRows, colWidths, merges:['A1:H1','A2:H2'], rowHeights },
        { name:'Summary', headers:[], rows:s2rows, colWidths:[22,12,12,12,12,12], merges:['A1:F1','A2:F2'], rowHeights:s2heights }
      ]);
      const blob = new Blob([bytes], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = currentUser.name + '_' + todayISO() + '.xlsx';
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url); showToast('Excel exported ✓');
    } catch(err) { showToast('Export failed: ' + err.message, true); }
  });
}

// ── PRIVACY PAGE ──
function renderPrivacy() {
  // Quality fix #4: load local privacy.html — was using fragile external Vercel iframe URL
  document.getElementById('page-content').innerHTML = `
    <div style="max-width:700px;">
      <iframe src="privacy.html" style="width:100%;height:800px;border:none;border-radius:12px;"></iframe>
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
  document.getElementById('auth-msg').innerHTML = '';
  showSection('auth-section');
  setMode('signin');
});

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
  const app = {
    id: Date.now().toString(), company, jobTitle, url, jd, resume:'',
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

// ── INIT ──
setupAuth();
