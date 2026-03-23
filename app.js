
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
  return r.json();
}
async function signUp(email, password, name) {
  const r = await fetch(SUPABASE_URL+'/auth/v1/signup', {
    method:'POST', headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
    body: JSON.stringify({email, password, data:{full_name:name}})
  });
  return r.json();
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

    if (data.error || data.error_description) {
      showAuthMsg(data.error_description || data.error || 'Something went wrong', true);
      btn.disabled = false; btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
      return;
    }

    if (authMode === 'signup' && !data.access_token) {
      showAuthMsg('Account created! Check your email to confirm, then sign in.', false);
      setMode('signin'); btn.disabled = false; return;
    }

    session     = data;
    currentUser = { id: data.user.id, email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.email.split('@')[0] };
    saveSession(data);
    showApp();
  } catch(e) {
    showAuthMsg('Connection error. Check your internet.', true);
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
        <div class="section-card-header"><div class="section-card-title">Status Breakdown</div></div>
        <div style="padding:16px">
          ${STATUSES.map(s => {
            const count = statusCounts[s]||0;
            const pct   = apps.length > 0 ? Math.round((count/apps.length)*100) : 0;
            const sc    = STATUS_BG[s] || STATUS_BG['Applied'];
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <div style="font-size:12px;width:140px;color:#4a5568;">${s}</div>
              <div style="flex:1;background:#f1f5f9;border-radius:4px;height:7px;overflow:hidden;">
                <div style="width:${pct}%;background:${sc.color};height:100%;border-radius:4px;transition:width 0.5s;"></div>
              </div>
              <div style="font-size:12px;font-weight:700;color:#1a202c;min-width:20px;text-align:right;">${count}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

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

  // Critical fix #2: dashHTML was built but never inserted — dashboard showed spinner forever
  document.getElementById('page-content').innerHTML = dashHTML;

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
                <td><div style="font-weight:600;font-size:13px;">${esc(a.company||'—')}</div></td>
                <td style="font-size:13px;color:#4a5568;">${esc(a.jobTitle||'—')}</td>
                <td>${a.url?`<a href="${esc(a.url)}" target="_blank" class="url-link">Open ↗</a>`:'—'}</td>
                <td>
                  <select class="status-select" data-id="${a.id}" style="background:${(STATUS_BG[a.status]||STATUS_BG.Applied).bg};color:${(STATUS_BG[a.status]||STATUS_BG.Applied).color};">
                    ${STATUSES.map(s=>`<option value="${s}" ${a.status===s?'selected':''}>${s}</option>`).join('')}
                  </select>
                </td>
                <td style="font-size:12px;color:#718096;white-space:nowrap;">${esc(a.date||'—')}</td>
                <td style="font-size:12px;color:#718096;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.notes||'—')}</td>
                <td>
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
}

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
