const SUPABASE_URL = 'https://dxsdvzhnqbynicrvbcfi.supabase.co';
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
let currentPage = 'kanban';
let authMode    = 'signin';
let filterStatus = 'all';
let filterSearch = '';
let filterDate   = '';

// ── UTILS ──
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(name) { return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function today() { return new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function todayISO() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

function headers(extra) {
  return { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+(session?.access_token||SUPABASE_KEY), ...extra };
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
  const r = await fetch(SUPABASE_URL+'/rest/v1/applications?select=*&order=created_at.desc', { headers:headers() });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data.map(mapRow) : [];
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
function saveSession(data) {
  localStorage.setItem('rjd_web_session', JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user
  }));
}
function loadStoredSession() {
  try { return JSON.parse(localStorage.getItem('rjd_web_session')); } catch { return null; }
}
function clearStoredSession() { localStorage.removeItem('rjd_web_session'); }

// ── AUTH SETUP ──
function setupAuth() {
  const stored = loadStoredSession();
  if (stored && stored.access_token) {
    session     = stored;
    currentUser = { id: stored.user.id, email: stored.user.email,
      name: stored.user.user_metadata?.full_name || stored.user.email.split('@')[0] };
    showApp();
    return;
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
  document.getElementById('sb-avatar').textContent = initials(currentUser.name);
  document.getElementById('sb-name').textContent   = currentUser.name;
  document.getElementById('sb-email').textContent  = currentUser.email;
  showLoading();
  apps = await loadApps();
  navigateTo('kanban');
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
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  const titles = { dashboard:'Overview', applications:'Applications', kanban:'Kanban Board', settings:'Settings', export:'Export', privacy:'Privacy Policy' };
  document.getElementById('page-title').textContent = titles[page] || page;
  document.getElementById('add-app-btn').classList.toggle('hidden', page !== 'applications');
  renderPage(page);
}

function renderPage(page) {
  updateBadge();
  if (page === 'dashboard')    renderDashboard();
  else if (page === 'applications') renderApplications();
  else if (page === 'kanban')  renderKanban();
  else if (page === 'settings') renderSettings();
  else if (page === 'export')  renderExport();
  else if (page === 'privacy') renderPrivacy();
}

function updateBadge() {
  document.getElementById('total-badge').textContent = apps.length + ' application' + (apps.length !== 1 ? 's' : '');
}

// ── DASHBOARD ──
function renderDashboard() {
  const now   = new Date();
  const today = apps.filter(a => { if(!a.dateRaw) return false; const d=new Date(a.dateRaw); return d.toLocaleDateString('en-CA') === todayISO(); }).length;
  const week  = apps.filter(a => a.dateRaw && (now - new Date(a.dateRaw)) <= 7*86400000).length;
  const ints  = apps.filter(a => a.status==='Interview Scheduled'||a.status==='Interview Done').length;
  const offers= apps.filter(a => a.status==='Offer').length;
  const rejected = apps.filter(a => a.status==='Rejected').length;
  const rate  = apps.length > 0 ? Math.round((offers/apps.length)*100) : 0;

  const statusCounts = {};
  STATUSES.forEach(s => { statusCounts[s] = apps.filter(a => a.status === s).length; });

  document.getElementById('page-content').innerHTML = `
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
        ${apps.length > 6 ? `<div style="padding:10px 16px;border-top:1px solid #f1f5f9;text-align:center;"><button class="auth-link" onclick="navigateTo('applications')">View all ${apps.length} →</button></div>` : ''}
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
}

// ── APPLICATIONS TABLE ──
function renderApplications() {
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

// ── KANBAN ──
function renderKanban() {
  const total = apps.length;
  document.getElementById('page-content').innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
      ${STATUSES.map(s => {
        const count = apps.filter(a=>a.status===s).length;
        const sc = STATUS_BG[s]||STATUS_BG.Applied;
        return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="filterKanban('${s}')">
          <div style="width:8px;height:8px;border-radius:50%;background:${sc.color};flex-shrink:0;"></div>
          <span style="font-size:12px;color:#4a5568;">${s}</span>
          <span style="font-size:12px;font-weight:700;color:#1a202c;">${count}</span>
        </div>`;
      }).join('')}
      <div style="margin-left:auto;font-size:12px;color:#a0aec0;display:flex;align-items:center;">${total} total</div>
    </div>
    <div class="kanban-board" id="kanban-board-inner">
      ${STATUSES.map(s => {
        const sc  = STATUS_BG[s]||STATUS_BG.Applied;
        const col = apps.filter(a => a.status === s);
        return `<div class="kanban-col" data-status="${s}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="width:10px;height:10px;border-radius:50%;background:${sc.color};"></div>
              <span style="font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:0.5px;">${s}</span>
            </div>
            <span style="font-size:11px;font-weight:700;background:${sc.bg};color:${sc.color};padding:1px 7px;border-radius:10px;">${col.length}</span>
          </div>
          ${col.map(a => `
            <div class="kanban-card" data-id="${a.id}" onclick="openKanbanCard('${a.id}')">
              <div class="kanban-card-company">${esc(a.company||'—')}</div>
              <div class="kanban-card-title">${esc(a.jobTitle||'—')}</div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
                <div class="kanban-card-date">${esc(a.date||'—')}</div>
                ${a.followUpDate ? `<div style="font-size:9px;color:${a.followUpDate<=todayISO()?'#c53030':'#718096'};">📅 ${a.followUpDate}</div>` : ''}
              </div>
              ${a.resume ? '<div style="margin-top:4px;font-size:9px;color:#276749;font-weight:600;">📄 Resume</div>' : ''}
              ${a.notes ? '<div style="margin-top:4px;font-size:9px;color:#718096;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">' + esc(a.notes.slice(0,60)) + (a.notes.length>60?'...':'') + '</div>' : ''}
            </div>`).join('') || `
          <div style="border:2px dashed #e2e8f0;border-radius:8px;padding:20px;text-align:center;">
            <div style="font-size:11px;color:#cbd5e0;">No applications</div>
          </div>`}
        </div>`;
      }).join('')}
    </div>
    <!-- Card detail modal -->
    <div id="kanban-detail" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:none;align-items:center;justify-content:center;padding:20px;">
      <div style="background:#fff;border-radius:16px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;">
        <div style="padding:20px 24px 16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
          <div id="kd-company" style="font-size:17px;font-weight:700;color:#1a202c;"></div>
          <button onclick="closeKanbanCard()" style="background:none;border:none;font-size:20px;color:#a0aec0;cursor:pointer;">✕</button>
        </div>
        <div style="padding:20px 24px;">
          <div id="kd-title" style="font-size:14px;color:#718096;margin-bottom:16px;"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div><div style="font-size:10px;font-weight:700;color:#a0aec0;text-transform:uppercase;margin-bottom:4px;">Status</div>
              <select id="kd-status" class="filter-select" style="width:100%;"></select></div>
            <div><div style="font-size:10px;font-weight:700;color:#a0aec0;text-transform:uppercase;margin-bottom:4px;">Follow-up Date</div>
              <input type="date" id="kd-followup" class="filter-input" style="width:100%;"/></div>
          </div>
          <div style="margin-bottom:12px;"><div style="font-size:10px;font-weight:700;color:#a0aec0;text-transform:uppercase;margin-bottom:4px;">Notes</div>
            <textarea id="kd-notes" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;min-height:80px;outline:none;" placeholder="Add notes..."></textarea></div>
          <div id="kd-url-row" style="margin-bottom:12px;"></div>
          <div style="display:flex;gap:8px;justify-content:space-between;">
            <button onclick="deleteKanbanCard()" style="background:#fff5f5;color:#c53030;border:1px solid #fed7d7;border-radius:7px;padding:7px 16px;font-size:12px;cursor:pointer;font-family:inherit;">Delete</button>
            <button onclick="saveKanbanCard()" class="btn-export" style="padding:8px 20px;">Save changes</button>
          </div>
        </div>
      </div>
    </div>`;
}

let kanbanDetailId = null;
function openKanbanCard(id) {
  const app = apps.find(a => a.id === id);
  if (!app) return;
  kanbanDetailId = id;
  document.getElementById('kd-company').textContent = app.company || '—';
  document.getElementById('kd-title').textContent   = app.jobTitle || '—';
  document.getElementById('kd-notes').value         = app.notes || '';
  document.getElementById('kd-followup').value      = app.followUpDate || '';
  document.getElementById('kd-status').innerHTML    = STATUSES.map(s => `<option value="${s}" ${app.status===s?'selected':''}>${s}</option>`).join('');
  document.getElementById('kd-url-row').innerHTML   = app.url
    ? `<a href="${esc(app.url)}" target="_blank" class="url-link" style="font-size:13px;">Open job posting ↗</a>`
    : '';
  document.getElementById('kanban-detail').style.display = 'flex';
}
function closeKanbanCard() {
  document.getElementById('kanban-detail').style.display = 'none';
  kanbanDetailId = null;
}
async function saveKanbanCard() {
  const app = apps.find(a => a.id === kanbanDetailId);
  if (!app) return;
  app.status      = document.getElementById('kd-status').value;
  app.notes       = document.getElementById('kd-notes').value;
  app.followUpDate= document.getElementById('kd-followup').value || '';
  await updateApp(app);
  closeKanbanCard();
  renderKanban();
  showToast('Saved');
}
async function deleteKanbanCard() {
  if (!confirm('Delete this application?')) return;
  await deleteApp(kanbanDetailId);
  apps = apps.filter(a => a.id !== kanbanDetailId);
  closeKanbanCard();
  renderKanban();
  updateBadge();
  showToast('Deleted');
}
function filterKanban(status) {
  filterStatus = filterStatus === status ? 'all' : status;
  renderKanban();
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
    const savedKey = localStorage.getItem('rjd_gemini_key') || '';
    panel.innerHTML = `
      <div class="settings-section-title">Gemini API Key</div>
      <div class="settings-section-sub">Powers AI extraction in the Chrome extension. Free from Google.</div>
      <div class="settings-info-box">Your key is stored only in your browser. It is sent directly to Google Gemini — never to any other server.</div>
      <div id="settings-msg"></div>
      <div class="settings-field"><label>API Key</label>
        <div style="display:flex;gap:8px;">
          <input type="password" class="settings-input" id="key-input" value="${esc(savedKey)}" placeholder="AIzaSy..." style="flex:1"/>
          <button class="btn-new" id="show-key-btn" style="white-space:nowrap;padding:0 14px;">Show</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:20px;">
        <button class="settings-btn" id="save-key-btn">Save Key</button>
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
      localStorage.setItem('rjd_gemini_key', key);
      document.getElementById('settings-msg').innerHTML='<div class="auth-msg success">Key saved ✓</div>';
      setTimeout(() => { const el=document.getElementById('settings-msg'); if(el) el.innerHTML=''; }, 3000);
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

  document.getElementById('export-xlsx-btn').addEventListener('click', () => {
    showToast('Use the extension\'s Export XLSX button for the full Excel report', false);
  });
}

// ── PRIVACY PAGE ──
function renderPrivacy() {
  document.getElementById('page-content').innerHTML = `
    <div style="max-width:700px;">
      <iframe src="https://janakirao4701.github.io/job-tracker-app/privacy.html" style="width:100%;height:800px;border:none;border-radius:12px;"></iframe>
    </div>`;
}

// ── SIGN OUT ──
document.getElementById('signout-btn').addEventListener('click', async () => {
  await signOut();
  clearStoredSession();
  session = null; currentUser = null; apps = [];
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
    apps.unshift(app);
    document.getElementById('add-modal').classList.add('hidden');
    ['m-company','m-title','m-url','m-jd','m-notes'].forEach(id => document.getElementById(id).value='');
    updateBadge();
    renderPage(currentPage);
    showToast('Application saved');
  } else { showToast('Save failed — check connection', true); }
});

// ── INIT ──
setupAuth();
