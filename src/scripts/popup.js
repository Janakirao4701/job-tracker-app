(function() {
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

// ── Count-up animation ──
function animateCount(el, target, duration) {
  if (!el || target === 0) { if (el) el.textContent = '0'; return; }
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

function renderLoggedIn(appCount) {
  document.getElementById('root').innerHTML = `
    <div class="header">
      <span class="version-badge">v5.0</span>
      <div class="header-top">
        <div class="logo"><img src="/public/icons/icon48.png" style="width:24px; height:24px; object-fit:contain; border-radius:6px;"/></div>
        <div class="header-text">
          <h1>AI Blaze</h1>
          <p>AI-powered Job Tracker · Cloud Sync</p>
        </div>
      </div>
    </div>
    <div class="app-count-section">
      <div class="count-label">Applications Tracked</div>
      <div class="count-num" data-count="${appCount}">0</div>
    </div>
    <div class="info-section">
      <div class="info-text">Track, manage, and analyze your job applications from any job board. AI extracts company and job details automatically.</div>
    </div>
    <div class="actions">
      <button class="btn-primary" id="btn-tracker">⚡ Open Sidebar</button>
      <button class="btn-secondary" id="btn-dash">📊 Dashboard</button>
    </div>
    <div class="footer">
      <button class="footer-btn" id="btn-so">Sign out</button>
    </div>`;

  // Animate counter
  setTimeout(() => {
    const el = document.querySelector('.count-num[data-count]');
    if (el) animateCount(el, parseInt(el.dataset.count, 10), 600);
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
// Uses ONLY local cache — zero Supabase network calls
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['rjd_session', 'rjd_apps_cache'], (res) => {
    const session = res.rjd_session || null;
    if (!session) { renderNotLoggedIn(); return; }
    const sessToken = session.token || session.access_token;
    if (!sessToken || !session.user || !verifyTokenProject(sessToken)) {
      if (session) chrome.storage.local.remove('rjd_session');
      renderNotLoggedIn();
      return;
    }

    const cachedApps = res.rjd_apps_cache;
    const appCount = Array.isArray(cachedApps) ? cachedApps.length : 0;
    renderLoggedIn(appCount);
  });
});
})();
