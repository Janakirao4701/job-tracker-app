// ── CONFIG ── (Quality note: popup runs in its own isolated context — cannot import from background.js)
// These must match background.js exactly. If rotating keys, update all 4 files: app.js, content.js, background.js, popup.js
const SUPABASE_URL = 'https://dxsdvzhnqbynicrvbcfi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4c2R2emhucWJ5bmljcnZiY2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTUyMDcsImV4cCI6MjA4OTY5MTIwN30.7csAFAIjVOU8_acamyYoTFLgXzao56k9aDYgGDFd2oo';

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(n) { return (n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

const STATUS_BADGE = {
  'Applied':'b-applied','Interview Scheduled':'b-interview',
  'Interview Done':'b-done','Offer':'b-offer',
  'Rejected':'b-rejected','Skipped':'b-skipped'
};

function renderNotLoggedIn() {
  document.getElementById('root').innerHTML = `
    <div class="get-started">
      <div class="gs-icon">📋</div>
      <div class="gs-title">Job Application Tracker</div>
      <div class="gs-sub">Track every job you apply to. Sign in to get started.</div>
      <button class="btn-gs" id="btn-gs">Get Started — It's Free</button>
      <div class="gs-note">Opens sign in page · Free forever</div>
    </div>`;
  document.getElementById('btn-gs').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
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
      <div class="logo">📋</div>
      <div class="header-text">
        <h1>Job Application Tracker</h1>
        <p>AI-powered · Cloud sync · Free forever</p>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">${apps.length}</div><div class="stat-lbl">Total</div></div>
      <div class="stat"><div class="stat-num blue">${todayCount}</div><div class="stat-lbl">Today</div></div>
      <div class="stat"><div class="stat-num orange">${interviews}</div><div class="stat-lbl">Interviews</div></div>
      <div class="stat"><div class="stat-num green">${offers}</div><div class="stat-lbl">Offers</div></div>
    </div>
    <div class="user-bar">
      <div class="avatar">${esc(initials(user.name||user.email))}</div>
      <div>
        <div class="username">${esc(user.name||user.email)}</div>
        <div class="useremail">${esc(user.email||'')}</div>
      </div>
    </div>
    <div class="actions">
      <button class="btn-primary" id="btn-tracker">⚡ Open Tracker</button>
      <button class="btn-secondary" id="btn-dash">📊 Dashboard</button>
    </div>
    <div class="recent">
      <div class="recent-label">Recent Applications</div>
      ${recent.length ? recent.map(a => `
        <div class="recent-item">
          <div>
            <div class="recent-company">${esc(a.company||'—')}</div>
            <div class="recent-job">${esc(a.job_title||'—')}</div>
          </div>
          <span class="badge ${STATUS_BADGE[a.status]||'b-applied'}">${esc(a.status||'Applied')}</span>
        </div>`).join('') : '<div class="no-apps">No applications yet</div>'}
    </div>
    <div class="footer">
      <button class="btn-signout" id="btn-so">Sign out</button>
      <span class="version">v4.2.0</span>
    </div>`;

  document.getElementById('btn-tracker').addEventListener('click', () => {
    chrome.tabs.query({ active:true, currentWindow:true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => { const t = document.getElementById('rjd-toggle'); if (t) t.click(); }
        }).catch(() => {});
      }
      window.close();
    });
  });

  document.getElementById('btn-dash').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
    window.close();
  });

  document.getElementById('btn-so').addEventListener('click', () => {
    chrome.storage.local.remove('rjd_session', () => {
      chrome.runtime.sendMessage({ action: 'session_cleared' });
      window.close();
    });
  });
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('rjd_session', async (res) => {
    const session = res.rjd_session || null;
    if (!session || !session.token || !session.user) {
      renderNotLoggedIn();
      return;
    }
    // Show logged in with empty stats first, then load
    renderLoggedIn(session.user, []);
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/applications?select=*&order=created_at.desc', {
        headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+session.token }
      });
      if (!r.ok) return;
      const apps = await r.json();
      if (Array.isArray(apps)) renderLoggedIn(session.user, apps);
    } catch(e) {}
  });
});
