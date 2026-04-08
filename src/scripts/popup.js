// ── CONFIG ──
const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

function verifyTokenProject(token) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const projectRef = payload.ref || (payload.iss && payload.iss.includes('supabase') ? payload.iss.split('/')[2].split('.')[0] : null);
    if (projectRef && !SUPABASE_URL.includes(projectRef)) return false;
  } catch (e) { return false; }
  return true;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

const STATUS_BADGE = {
  'Applied':'b-applied','Interview Scheduled':'b-interview',
  'Interview Done':'b-done','Offer':'b-offer',
  'Rejected':'b-rejected','Skipped':'b-skipped'
};

// ── Count-up animation ──
function animateCount(el, target, duration) {
  if (!el || target === 0) return;
  let start = 0;
  const step = Math.ceil(target / (duration / 16));
  const timer = setInterval(() => {
    start += step;
    if (start >= target) { start = target; clearInterval(timer); }
    el.textContent = start;
  }, 16);
}

function renderNotLoggedIn() {
  document.getElementById('root').innerHTML = `
    <div class="get-started">
      <div class="gs-icon"><img src="/public/icons/icon128.png" style="width:40px; height:40px; object-fit:contain; border-radius:10px;"/></div>
      <div class="gs-title">Job Application Tracker</div>
      <div class="gs-sub">Track every application with AI-powered extraction and cloud sync. Start your organized job search today.</div>
      <button class="btn-gs" id="btn-gs">Get Started — It's Free</button>
      <div class="gs-note">Opens sign in page · Free forever</div>
    </div>`;
  document.getElementById('btn-gs').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/app.html') });
    window.close();
  });
}

function renderLoggedIn(user, apps) {
  const today = new Date().toLocaleDateString('en-CA');
  const todayCount  = apps.filter(a => a.date_raw && new Date(a.date_raw).toLocaleDateString('en-CA') === today).length;
  const interviews  = apps.filter(a => a.status==='Interview Scheduled'||a.status==='Interview Done').length;
  const offers      = apps.filter(a => a.status==='Offer').length;
  const recent      = apps.slice(0, 4);

  document.getElementById('root').innerHTML = `
    <div class="header">
      <span class="version-badge">v5.0</span>
      <div class="header-top">
        <div class="logo"><img src="/public/icons/icon48.png" style="width:24px; height:24px; object-fit:contain; border-radius:6px;"/></div>
        <div class="header-text">
          <h1>Job Tracker</h1>
          <p>AI-powered · Cloud sync</p>
        </div>
      </div>
    </div>
    <div class="stats">
      <div class="stat animate-in" style="animation-delay:0.05s">
        <div class="stat-num" data-count="${apps.length}">0</div>
        <div class="stat-lbl">Total</div>
      </div>
      <div class="stat animate-in" style="animation-delay:0.1s">
        <div class="stat-num blue" data-count="${todayCount}">0</div>
        <div class="stat-lbl">Today</div>
      </div>
      <div class="stat animate-in" style="animation-delay:0.15s">
        <div class="stat-num orange" data-count="${interviews}">0</div>
        <div class="stat-lbl">Interviews</div>
      </div>
      <div class="stat animate-in" style="animation-delay:0.2s">
        <div class="stat-num green" data-count="${offers}">0</div>
        <div class="stat-lbl">Offers</div>
      </div>
    </div>
    <div class="user-bar">
      <div class="avatar">${esc(initials(user.name||user.email))}</div>
      <div>
        <div class="user-name">${esc(user.name||user.email)}</div>
        <div class="user-email">${esc(user.email||'')}</div>
      </div>
    </div>
    <div class="actions">
      <button class="btn-primary" id="btn-tracker">⚡ Open Sidebar</button>
      <button class="btn-secondary" id="btn-dash">📊 Dashboard</button>
    </div>
    <div class="recent">
      <div class="recent-header">Recent Applications</div>
      ${recent.length ? recent.map(a => `
        <div class="recent-item">
          <div>
            <div class="recent-company">${esc(a.company||'—')}</div>
            <div class="recent-job">${esc(a.job_title||'—')}</div>
          </div>
          <span class="badge ${STATUS_BADGE[a.status]||'b-applied'}">${esc(a.status||'Applied')}</span>
        </div>`).join('') : '<div class="no-recent">No applications yet</div>'}
    </div>
    <div class="footer">
      <button class="footer-btn" id="btn-so">Sign out</button>
    </div>`;

  // Animate stat counters
  setTimeout(() => {
    document.querySelectorAll('.stat-num[data-count]').forEach(el => {
      animateCount(el, parseInt(el.dataset.count, 10), 600);
    });
  }, 200);

  document.getElementById('btn-tracker').addEventListener('click', () => {
    chrome.tabs.query({ active:true, currentWindow:true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => { const t = document.getElementById('rjd-toggle'); if (t) t.dispatchEvent(new Event('rjd-external-open')); }
        }).catch(() => {});
      }
      window.close();
    });
  });

  document.getElementById('btn-dash').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/app.html') });
    window.close();
  });

  document.getElementById('btn-so').addEventListener('click', () => {
    chrome.storage.local.remove('rjd_session', () => {
      chrome.runtime.sendMessage({ action: 'session_cleared' }, () => {
        if (chrome.runtime.lastError) { /* ignore No SW errors */ }
      });
      window.close();
    });
  });
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['rjd_session', 'rjd_apps_cache'], async (res) => {
    const session = res.rjd_session || null;
    if (!session) { renderNotLoggedIn(); return; }
    const sessToken = session.token || session.access_token;
    if (!session || !sessToken || !session.user || !verifyTokenProject(sessToken)) {
      if (session) chrome.storage.local.remove('rjd_session');
      renderNotLoggedIn();
      return;
    }
    
    // Optimistic instant render from cache
    if (res.rjd_apps_cache) {
      renderLoggedIn(session.user, res.rjd_apps_cache);
    } else {
      // Modern spinner instead of "Loading..." text
      document.getElementById('root').innerHTML = `
        <style>@keyframes popupSpin { to { transform: rotate(360deg); } }</style>
        <div style="display:flex; justify-content:center; align-items:center; height:180px;">
          <div style="width:28px; height:28px; border:3px solid #eef2ff; border-top-color:#4f46e5; border-radius:50%; animation:popupSpin 0.8s linear infinite;"></div>
        </div>
      `;
    }
    
    try {
      let r = await fetch(SUPABASE_URL + '/rest/v1/applications?select=*&username=eq.' + session.user.id + '&order=created_at.desc', {
        headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+(session.token || session.access_token) }
      });
      
      if (r.status === 401 && session.refreshToken) {
        // Attempt refresh
        const refreshRes = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
          body: JSON.stringify({ refresh_token: session.refreshToken })
        });
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          session.token = refreshData.access_token;
          if (refreshData.refresh_token) session.refreshToken = refreshData.refresh_token;
          chrome.storage.local.set({ rjd_session: session });
          chrome.runtime.sendMessage({ action: 'session_saved', payload: session }, () => {
            if (chrome.runtime.lastError) { /* ignore No SW errors */ }
          });
          // Retry original fetch
          r = await fetch(SUPABASE_URL + '/rest/v1/applications?select=*&username=eq.' + session.user.id + '&order=created_at.desc', {
            headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+(session.token || session.access_token) }
          });
        }
      }

      if (!r.ok) { 
        if (r.status === 401) {
          chrome.storage.local.remove('rjd_session');
          renderNotLoggedIn();
          return;
        }
        if (!res.rjd_apps_cache) renderLoggedIn(session.user, []);
        return; 
      }
      const apps = await r.json();
      const validApps = Array.isArray(apps) ? apps : [];
      
      // Update cache
      chrome.storage.local.set({ rjd_apps_cache: validApps });
      
      // Update UI with fresh data
      renderLoggedIn(session.user, validApps);
    } catch(e) {
      if (!res.rjd_apps_cache) renderLoggedIn(session.user, []);
    }
  });
});
