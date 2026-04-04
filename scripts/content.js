(function () {
  if (document.getElementById('rjd-sidebar')) return;

  // ── CONFIG ──
  let GEMINI_KEY = ''; // loaded from storage
  const SUPABASE_URL  = CONFIG.SUPABASE_URL;
  const SUPABASE_KEY  = CONFIG.SUPABASE_KEY;

  const STATUSES = ['Applied','Interview Scheduled','Interview Done','Offer','Rejected','Skipped'];
  const STATUS_COLORS = {
    'Applied':             { bg: '#eef2ff', color: '#4f46e5' },
    'Interview Scheduled': { bg: '#ecfdf5', color: '#059669' },
    'Interview Done':      { bg: '#fffbeb', color: '#d97706' },
    'Offer':               { bg: '#d1fae5', color: '#065f46' },
    'Rejected':            { bg: '#fef2f2', color: '#dc2626' },
    'Skipped':             { bg: '#f1f5f9', color: '#94a3b8' },
  };

  let currentUser         = null; 
  let sessionToken        = null;
  let sessionRefreshToken = null;
  let applications = [];
  let filterStatus = 'all';
  let filterSearch = '';
  let filterDate   = '';
  let cachedProfile = {}; 
  let currentDetailId = null;

  // ── OFFLINE QUEUE ──
  const QUEUE_KEY = 'rjd_offline_queue';
  function getQueue(cb) {
    const s = chromeStore();
    if (s) s.get(QUEUE_KEY, r => cb(r[QUEUE_KEY] || []));
    else cb([]);
  }
  function saveQueue(queue, cb) {
    const s = chromeStore();
    if (s) s.set({ [QUEUE_KEY]: queue }, cb);
    updateQueueBadge(queue.length);
  }
  function updateQueueBadge(count) {
    const badge = document.getElementById('rjd-queue-badge');
    if (!badge) return;
    badge.style.display = count > 0 ? 'flex' : 'none';
    badge.textContent = count;
  }
  function enqueueApp(app) {
    getQueue(queue => {
      queue.push({ app, queuedAt: Date.now() });
      saveQueue(queue);
      showToast('📶 Offline — queued (syncs when online)');
    });
  }
  async function flushQueue() {
    if (!navigator.onLine) return;
    getQueue(async queue => {
      if (!queue.length) return;
      const remaining = [];
      for (const item of queue) {
        try {
          const body = {
            id: item.app.id, username: currentUser?.id,
            company: item.app.company, job_title: item.app.jobTitle,
            url: item.app.url, jd: item.app.jd, resume: item.app.resume || '',
            status: item.app.status, date: item.app.date,
            date_raw: item.app.dateRaw, date_key: item.app.dateKey,
            notes: item.app.notes || '', follow_up_date: item.app.followUpDate || null,
          };
          const res = await fetch(SUPABASE_URL + '/rest/v1/applications', {
            method: 'POST',
            headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            if (!applications.find(a => a.id === item.app.id)) applications.push(item.app);
          } else remaining.push(item);
        } catch(e) { remaining.push(item); }
      }
      saveQueue(remaining);
      if (remaining.length < queue.length) {
        renderTable();
        showToast('✓ ' + (queue.length - remaining.length) + ' queued app(s) synced');
      }
    });
  }
  window.addEventListener('online', () => flushQueue());

  // ── SUPABASE HELPERS ──
  function sbHeaders() {
    return {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + (sessionToken || SUPABASE_KEY),
    };
  }

  let _refreshPromise = null;
  async function refreshSession() {
    if (!sessionRefreshToken) return false;
    if (_refreshPromise) return _refreshPromise; 
    _refreshPromise = (async () => {
      try {
        const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
          body: JSON.stringify({ refresh_token: sessionRefreshToken }),
        });
        const data = await res.json();
        if (data.access_token) {
          sessionToken = data.access_token;
          if (data.refresh_token) sessionRefreshToken = data.refresh_token;
          saveSession(sessionToken, currentUser, sessionRefreshToken);
          return true;
        }
      } catch(e) { console.warn('Token refresh failed', e); }
      return false;
    })();
    try { return await _refreshPromise; } finally { _refreshPromise = null; }
  }

  async function sbFetch(url, opts) {
    if (!navigator.onLine) throw new Error('You are offline.');
    let res = await fetch(url, opts);
    if (res.status === 401 && sessionRefreshToken) {
      if (await refreshSession()) {
        opts.headers['Authorization'] = 'Bearer ' + sessionToken;
        res = await fetch(url, opts);
      }
    }
    return res;
  }

  async function sbSignOut() {
    await fetch(SUPABASE_URL + '/auth/v1/logout', {
      method: 'POST',
      headers: sbHeaders(),
    });
  }

  async function dbLoadApps() {
    const PAGE_SIZE = 1000;
    let allRows = [];
    let offset  = 0;
    while (true) {
      const res = await sbFetch(
        SUPABASE_URL + `/rest/v1/applications?select=*&order=created_at.asc&limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { ...sbHeaders(), 'Range-Unit': 'items', 'Range': `${offset}-${offset + PAGE_SIZE - 1}` } }
      );
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return allRows.map(r => ({
      id: r.id, company: r.company, jobTitle: r.job_title, url: r.url, jd: r.jd,
      resume: r.resume, status: r.status, date: r.date, dateRaw: r.date_raw, dateKey: r.date_key,
      notes: r.notes, followUpDate: r.follow_up_date || '',
    }));
  }

  async function dbSaveApp(app) {
    if (!navigator.onLine) { enqueueApp(app); applications.push(app); renderTable(); return true; }
    if (!currentUser) return false;
    const body = {
      id: app.id, username: currentUser.id, company: app.company, job_title: app.jobTitle,
      url: app.url, jd: app.jd, resume: app.resume || '', status: app.status,
      date: app.date, date_raw: app.dateRaw, date_key: app.dateKey, notes: app.notes || '',
      follow_up_date: app.followUpDate || null,
    };
    const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications', {
      method: 'POST', headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function dbUpdateApp(app) {
    if (!navigator.onLine) return false;
    const body = {
      company: app.company, job_title: app.jobTitle, url: app.url, jd: app.jd,
      resume: app.resume || '', status: app.status, notes: app.notes || '',
      follow_up_date: app.followUpDate || null,
    };
    const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications?id=eq.' + app.id, {
      method: 'PATCH', headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function dbDeleteApp(id) {
    const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications?id=eq.' + id, {
      method: 'DELETE', headers: sbHeaders(),
    });
    return res.ok;
  }

  // ── PERSISTENCE ──
  function chromeStore() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  }
  function saveSession(token, user, refreshToken) {
    const s = chromeStore();
    if (s) s.set({ rjd_session: { token, user, refreshToken: refreshToken||'' } });
  }
  function clearSession() {
    const s = chromeStore();
    if (s) s.remove('rjd_session');
  }
  function loadSession(cb) {
    const s = chromeStore();
    if (s) s.get('rjd_session', r => cb(r.rjd_session || null));
    else cb(null);
  }
  function saveGeminiKey(key, cb) {
    const s = chromeStore();
    if (s) s.set({ rjd_gemini_key: key }, cb || (() => {}));
  }
  function loadGeminiKey(cb) {
    const s = chromeStore();
    if (s) s.get('rjd_gemini_key', r => cb(r.rjd_gemini_key || ''));
    else cb('');
  }

  // ── UTILS ──
  let workingDate = '';
  function getWorkingDateObj() {
    if (workingDate) { const [y,m,d] = workingDate.split('-').map(Number); return new Date(y, m-1, d); }
    return new Date();
  }
  function today() { return getWorkingDateObj().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function todayKey() { const d = getWorkingDateObj(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function todayISO() { return todayKey(); }
  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function showToast(msg, isError) {
    const t = document.getElementById('rjd-toast');
    if (!t) return;
    t.textContent = msg; t.style.background = isError ? '#dc2626' : '';
    t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500);
  }
  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  }

  // ── EXTRACTION ──
  async function extractWithGemini(jdText, pageUrl) {
    if (!GEMINI_KEY || !GEMINI_KEY.trim()) throw new Error('API key not set');
    const prompt = `Extract company and title from: ${jdText}. Return JSON: {"company_name":"","job_title":""}`;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } })
    });
    const data = await res.json();
    let raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
    try { return JSON.parse(raw); } catch(e) { return { company_name:'', job_title:'' }; }
  }

  async function runExtract() {
    const st = document.getElementById('rjd-extract-status');
    const eb = document.getElementById('rjd-extract-btn');
    if (st) st.textContent = '⏳ Extracting...';
    try {
      const clipText = await navigator.clipboard.readText();
      const res = await extractWithGemini(clipText, window.location.href);
      const co = document.getElementById('rjd-new-company');
      const ti = document.getElementById('rjd-new-title');
      if (co) co.value = res.company_name || '';
      if (ti) ti.value = res.job_title || '';
      if (st) st.textContent = '✓ Extracted';
    } catch(err) { if (st) st.textContent = '✕ failed'; }
  }

  // ── UI SCREENS ──
  function renderSettingsScreen(returnTo) {
    const main = document.getElementById('rjd-sidebar-content');
    if (!main) return;
    main.innerHTML = `<div style="padding:20px;"><button id="rjd-settings-back-btn">← Back</button><h3>Settings</h3><label>Gemini Key</label><input type="password" id="rjd-sk-input"/><button id="rjd-sk-save">Save</button></div>`;
    document.getElementById('rjd-settings-back-btn').addEventListener('click', () => renderTrackerScreen());
    document.getElementById('rjd-sk-save').addEventListener('click', () => {
      const k = document.getElementById('rjd-sk-input').value;
      saveGeminiKey(k, () => { GEMINI_KEY = k; showToast('Saved'); });
    });
    loadGeminiKey(k => { document.getElementById('rjd-sk-input').value = k; });
  }

  function renderTrackerScreen() {
    const main = document.getElementById('rjd-sidebar-content');
    if (!main || !currentUser) return;
    main.innerHTML = window.rjdTemplates.trackerScreen({
      initials: getInitials(currentUser.name), name: currentUser.name,
      todayISO: todayISO(), filterDate, STATUSES
    });
    renderTable();
    bindTrackerEvents();
  }

  function bindTrackerEvents() {
    const _setBtn = document.getElementById('rjd-settings-btn');
    if (_setBtn) _setBtn.addEventListener('click', () => renderSettingsScreen('tracker'));
    const _refBtn = document.getElementById('rjd-refresh-btn');
    if (_refBtn) _refBtn.addEventListener('click', async () => {
      try { applications = await dbLoadApps(); renderTable(); showToast('Refreshed ✓'); } catch(e) {}
    });
    const _newBtn = document.getElementById('rjd-new-app-btn');
    if (_newBtn) _newBtn.addEventListener('click', () => showNewAppPanel());
    
    // Hardened null checks for all remaining tracker UI
    ['rjd-new-back','rjd-detail-back','rjd-resume-back'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => {
        if (id === 'rjd-new-back') hideNewAppPanel();
        if (id === 'rjd-detail-back') hideAppDetail();
        if (id === 'rjd-resume-back') hideResumeDetail();
      });
    });

    const _qExBtn = document.getElementById('rjd-quick-extract-btn');
    if (_qExBtn) _qExBtn.addEventListener('click', async () => {
      _qExBtn.disabled = true; _qExBtn.textContent = '...';
      try {
        const clipText = await navigator.clipboard.readText();
        const res = await extractWithGemini(clipText, window.location.href);
        if (res.company_name && res.job_title) {
          const app = { id:crypto.randomUUID(), company:res.company_name, jobTitle:res.job_title, url:window.location.href, jd:clipText, status:'Applied', date:today(), dateRaw:new Date().toISOString(), dateKey:todayKey() };
          if (await dbSaveApp(app)) { applications.push(app); renderTable(); showToast('Saved'); }
        } else { showNewAppPanel(); const co = document.getElementById('rjd-new-company'); if (co) co.value = res.company_name||''; }
      } catch(e) {}
      _qExBtn.disabled = false; _qExBtn.textContent = '✦ Extract & Save';
    });
  }

  function renderTable() {
    const tbody = document.getElementById('rjd-tbody');
    if (!tbody) return;
    tbody.innerHTML = applications.map((app, idx) => `
      <tr class="rjd-row" data-id="${app.id}">
        <td>${idx+1}</td>
        <td>${escHtml(app.company)}</td>
        <td>${escHtml(app.jobTitle)}</td>
        <td><button class="rjd-dl-resume-btn" data-id="${app.id}">⬇</button></td>
        <td>${app.status}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.rjd-dl-resume-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const app = applications.find(a => a.id === btn.dataset.id);
        downloadAppResume(app);
      });
    });
  }

  function showNewAppPanel() {
    const p = document.getElementById('rjd-new-app-panel');
    const m = document.getElementById('rjd-main');
    if (p && m) { m.style.display = 'none'; p.style.display = 'flex'; }
  }
  function hideNewAppPanel() {
    const p = document.getElementById('rjd-new-app-panel');
    const m = document.getElementById('rjd-main');
    if (p && m) { p.style.display = 'none'; m.style.display = 'flex'; }
  }
  function hideAppDetail() { document.getElementById('rjd-detail-panel').style.display = 'none'; document.getElementById('rjd-main').style.display = 'flex'; }
  function hideResumeDetail() { document.getElementById('rjd-resume-panel').style.display = 'none'; document.getElementById('rjd-main').style.display = 'flex'; }

  // ── RESUME DOWNLOAD ──
  function downloadAppResume(app) {
    if (!app || !app.resume) { showToast('No resume', true); return; }
    const profile = cachedProfile || {};
    const templateId = profile.template || 'standard';
    const filename = (app.company || 'Resume').replace(/[^a-z0-9]/gi, '_') + '_Resume';
    if (typeof window.downloadResumeDocx === 'function') {
      window.downloadResumeDocx(profile, app.resume, filename, templateId);
      showToast('Downloaded ✓');
    } else {
      showToast('Library non loaded', true);
    }
  }

  // ── SIDEBAR ──
  function buildSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'rjd-sidebar';
    sidebar.innerHTML = `<div id="rjd-header"><h2>Tracker</h2><button id="rjd-close">✕</button></div><div id="rjd-sidebar-content"></div>`;
    document.body.appendChild(sidebar);
    const toggle = document.createElement('div');
    toggle.id = 'rjd-toggle'; toggle.innerHTML = `<div id="rjd-toggle-icon">🚀</div>`;
    toggle.onclick = () => {
      sidebar.classList.toggle('open');
      if (sidebar.classList.contains('open')) renderTrackerScreen();
    };
    document.body.appendChild(toggle);
    document.getElementById('rjd-close').onclick = () => sidebar.classList.remove('open');
    const toast = document.createElement('div'); toast.id = 'rjd-toast'; document.body.appendChild(toast);
  }

  function updateSessionProgress() {} // Noop for now

  // ── INIT ──
  function applySession(sess) {
    if (sess && sess.token && sess.user) {
      sessionToken = sess.token; sessionRefreshToken = sess.refreshToken; currentUser = sess.user;
      loadGeminiKey(k => { GEMINI_KEY = k; });
      dbLoadApps().then(apps => { applications = apps; updateTrackBadge(); }).catch(() => {});
    } else {
      currentUser = null; applications = [];
    }
  }
  function updateTrackBadge() {}

  buildSidebar();
  const s = chromeStore();
  if (s) {
    s.get(['rjd_session', 'resume_builder_profile'], r => {
      if (r.resume_builder_profile) cachedProfile = r.resume_builder_profile;
      applySession(r.rjd_session);
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.resume_builder_profile) cachedProfile = c.resume_builder_profile.newValue || {};
    });
  }

  // Bridge dashboard profile to extension
  window.addEventListener('storage', (e) => {
    if (e.key === 'resume_builder_profile' && e.newValue) {
      const p = JSON.parse(e.newValue);
      chrome.storage.local.set({ resume_builder_profile: p });
    }
  });

})();
