(function () {
  if (document.getElementById('rjd-sidebar')) return;

  // ── CONFIG ──
  let GEMINI_KEY = ''; 
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
    if (!eb) return;
    eb.textContent = '⏳ ...'; eb.disabled = true;
    try {
      const clipText = await navigator.clipboard.readText();
      const res = await extractWithGemini(clipText, window.location.href);
      const co = document.getElementById('rjd-new-company');
      const ti = document.getElementById('rjd-new-title');
      const ur = document.getElementById('rjd-new-url');
      const jd = document.getElementById('rjd-new-jd');
      if (co) co.value = res.company_name || '';
      if (ti) ti.value = res.job_title || '';
      if (ur) ur.value = window.location.href;
      if (jd) jd.value = clipText || '';
      if (st) { st.style.color = '#10b981'; st.textContent = '✓ Extracted'; }
    } catch(err) { if (st) { st.style.color = '#ef4444'; st.textContent = '✕ failed'; } }
    finally { eb.textContent = '✦ Extract & Save'; eb.disabled = false; }
  }

  // ── SETTINGS ──
  function renderSettingsScreen() {
    const main = document.getElementById('rjd-sidebar-content');
    if (!main) return;
    let activeSection = 'apikey';
    function renderSettings() {
      main.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:var(--bg-secondary,#f8fafc);">
          <div style="padding:16px;background:white;border-bottom:1px solid var(--border-color,#e2e8f0);display:flex;align-items:center;gap:12px;">
            <button id="rjd-settings-back" style="background:none;border:none;cursor:pointer;padding:8px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <h3 style="margin:0;font-size:18px;font-weight:800;color:var(--text-primary,#1e293b);">Settings</h3>
          </div>
          <div style="display:flex;flex:1;overflow:hidden;">
            <div style="width:140px;background:white;border-right:1px solid var(--border-color,#e2e8f0);padding:12px 8px;display:flex;flex-direction:column;gap:4px;">
              ${[
                ['apikey','API Key','🔑'], ['resume','Template','📄'], ['shortcuts','Hotkeys','⌨'], ['privacy','Privacy','🔒'], ['about','About','ℹ']
              ].map(([id, label, icon]) => 
                `<button class="rjd-set-tab ${activeSection===id?'active':''}" data-id="${id}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:none;background:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:${activeSection===id?'#4f46e5':'#64748b'};text-align:left;transition:all 0.2s;">
                  <span style="font-size:14px;">${icon}</span><span>${label}</span>
                </button>`
              ).join('')}
              <div style="margin-top:auto;padding-top:12px;border-top:1px solid #f1f5f9;">
                <button id="rjd-logout-btn" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border:none;background:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:#ef4444;text-align:left;">
                  <span style="font-size:14px;">🚪</span><span>Logout</span>
                </button>
              </div>
            </div>
            <div id="rjd-settings-panel" style="flex:1;padding:20px;overflow-y:auto;background:white;"></div>
          </div>
        </div>`;
      
      document.getElementById('rjd-settings-back').onclick = () => renderTrackerScreen();
      document.getElementById('rjd-logout-btn').onclick = () => logoutUser();
      main.querySelectorAll('.rjd-set-tab').forEach(btn => {
        btn.onclick = () => { activeSection = btn.dataset.id; renderSettings(); };
      });
      renderSection(activeSection);
    }
    function renderSection(sec) {
      const panel = document.getElementById('rjd-settings-panel');
      if (!panel) return;
      if (sec === 'apikey') {
        panel.innerHTML = `
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">Gemini API Key</div>
          <div style="font-size:12px;color:#94a3b8;margin-bottom:14px;">Powers AI extraction. Free from Google.</div>
          <input type="password" id="rjd-sk-input" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;margin-bottom:10px;"/>
          <button id="rjd-sk-save" class="rjd-primary-btn" style="width:100%;padding:10px;">Save Key</button>`;
        loadGeminiKey(k => { if (k) document.getElementById('rjd-sk-input').value = k; });
        document.getElementById('rjd-sk-save').onclick = () => {
          const k = document.getElementById('rjd-sk-input').value.trim();
          saveGeminiKey(k, () => { GEMINI_KEY = k; showToast('Key saved ✓'); });
        };
      } else if (sec === 'resume') {
        chromeStore().get('resume_builder_profile', r => {
          const profile = r.resume_builder_profile || {};
          panel.innerHTML = `<div style="font-size:14px;font-weight:700;margin-bottom:10px;">Template Selection</div>
            <select id="rjd-tpl-select" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;">
              <option value="standard" ${profile.template==='standard'?'selected':''}>Professional Standard</option>
              <option value="p2p_vinay" ${profile.template==='p2p_vinay'?'selected':''}>Pin-to-Pin LaTeX</option>
            </select>`;
          document.getElementById('rjd-tpl-select').onchange = (e) => {
            profile.template = e.target.value;
            chromeStore().set({ resume_builder_profile: profile }, () => showToast('Template updated ✓'));
          };
        });
      } else if (sec === 'shortcuts') {
         panel.innerHTML = `<div style="font-size:14px;font-weight:700;margin-bottom:10px;">Shortcuts</div>
           <div style="font-size:12px;color:#64748b;">Alt + Shift + T: Toggle Sidebar<br>Alt + Shift + E: Extract & Save</div>`;
      }
    }
    renderSettings();
  }

  // ── STATS ──
  function renderStats() {
    const el = document.getElementById('rjd-stats');
    if (!el) return;
    const todayCount = applications.filter(a => a.dateKey === todayKey()).length;
    const weekCount = applications.filter(a => (new Date() - new Date(a.dateRaw)) <= 7*86400000).length;
    const offers = applications.filter(a => a.status === 'Offer').length;
    el.innerHTML = `
      <div class="rjd-stat-box"><div class="rjd-stat-num">${todayCount}</div><div class="rjd-stat-lbl">Today</div></div>
      <div class="rjd-stat-box"><div class="rjd-stat-num">${weekCount}</div><div class="rjd-stat-lbl">Week</div></div>
      <div class="rjd-stat-box"><div class="rjd-stat-num" style="color:#059669;">${offers}</div><div class="rjd-stat-lbl">Offers</div></div>`;
  }

  function getSessionTarget() { return parseInt(localStorage.getItem('rjd_session_target') || '30', 10); }
  function updateSessionProgress() {
    const tg = getSessionTarget(); const done = applications.filter(a => a.dateKey === todayKey()).length;
    const pct = Math.min(100, Math.round((done/tg)*100));
    const bar = document.getElementById('rjd-progress-bar'); if (bar) bar.style.width = pct + '%';
    const txt = document.getElementById('rjd-session-progress'); if (txt) txt.textContent = done + '/' + tg;
  }

  function updateTrackBadge() {
    const badge = document.getElementById('rjd-toggle-badge');
    if (!badge) return;
    const count = applications.filter(a => a.dateKey === todayKey()).length;
    badge.style.display = count > 0 ? 'flex' : 'none';
    badge.textContent = count;
  }

  function renderTable() {
    renderStats(); updateTrackBadge(); updateSessionProgress();
    const filtered = applications.filter(a => {
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterDate && a.dateKey !== filterDate) return false;
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        return (a.company||'').toLowerCase().includes(q) || (a.jobTitle||'').toLowerCase().includes(q);
      }
      return true;
    });
    const tbody = document.getElementById('rjd-tbody');
    if (!tbody) return;
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="rjd-empty-row">No applications found.</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map((app, idx) => {
      const sc = STATUS_COLORS[app.status] || STATUS_COLORS['Applied'];
      return `<tr class="rjd-row" data-id="${app.id}">
        <td class="rjd-td">${idx+1}</td>
        <td class="rjd-td"><b>${escHtml(app.company)}</b></td>
        <td class="rjd-td">${escHtml(app.jobTitle)}</td>
        <td class="rjd-td" style="text-align:center;">${app.url ? '<a href="'+app.url+'" target="_blank" class="rjd-url-link">Open</a>' : '—'}</td>
        <td class="rjd-td" style="text-align:center;">
          <button class="rjd-add-resume-btn" data-id="${app.id}">${app.resume ? '✓' : '+'}</button>
        </td>
        <td class="rjd-td" style="text-align:center;">
          ${app.resume ? '<button class="rjd-dl-resume-btn" data-id="'+app.id+'">⬇</button>' : '—'}
        </td>
        <td class="rjd-td">${escHtml(app.date.replace(/, \d{4}$/,''))}</td>
        <td class="rjd-td"><button class="rjd-status-chip-btn" data-id="${app.id}" style="background:${sc.bg};color:${sc.color};border-radius:12px;padding:2px 8px;border:1px solid ${sc.color};font-size:10px;cursor:pointer;">${app.status} ▾</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.rjd-status-chip-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const app = applications.find(a => a.id === btn.dataset.id);
        const next = STATUSES[(STATUSES.indexOf(app.status)+1)%STATUSES.length];
        app.status = next; await dbUpdateApp(app); renderTable();
      };
    });
    tbody.querySelectorAll('.rjd-add-resume-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const app = applications.find(a => a.id === btn.dataset.id);
        try {
          const t = await navigator.clipboard.readText();
          if (t.trim()) { app.resume = t.trim(); await dbUpdateApp(app); renderTable(); showToast('Resume added ✓'); }
        } catch(e) { showToast('Clipboard fail', true); }
      };
    });
    tbody.querySelectorAll('.rjd-dl-resume-btn').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); downloadAppResume(applications.find(a=>a.id===btn.dataset.id)); };
    });
    tbody.querySelectorAll('.rjd-row').forEach(row => {
      row.onclick = (e) => { if(!e.target.closest('button, a')) showAppDetail(applications.find(a=>a.id===row.dataset.id)); };
    });
  }

  // ── PANELS ──
  function showNewAppPanel() {
    const p = document.getElementById('rjd-new-app-panel');
    const m = document.getElementById('rjd-main');
    if (p && m) { 
      m.style.display = 'none'; p.style.display = 'flex';
      ['rjd-new-company','rjd-new-title','rjd-new-url','rjd-new-jd'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      const st = document.getElementById('rjd-extract-status'); if (st) st.textContent = '';
    }
  }
  function hideNewAppPanel() { document.getElementById('rjd-new-app-panel').style.display = 'none'; document.getElementById('rjd-main').style.display = 'flex'; }

  function showAppDetail(app) {
    currentDetailId = app.id;
    const p = document.getElementById('rjd-detail-panel');
    if (!p) return;
    document.getElementById('rjd-main').style.display = 'none'; p.style.display = 'flex';
    document.getElementById('rjd-detail-company').textContent = app.company || '—';
    document.getElementById('rjd-detail-title').textContent = app.jobTitle || '—';
    document.getElementById('rjd-detail-jd').textContent = app.jd || 'No JD';
    document.getElementById('rjd-detail-notes').value = app.notes || '';
    const resSec = document.getElementById('rjd-detail-resume-section');
    if (resSec) resSec.innerHTML = app.resume ? `<button id="rjd-view-resume-btn" class="rjd-primary-btn">View Resume</button>` : `<button id="rjd-add-resume-detail" class="rjd-primary-btn">+ Add Resume</button>`;
    if (document.getElementById('rjd-view-resume-btn')) document.getElementById('rjd-view-resume-btn').onclick = () => showResumeDetail(app);
    if (document.getElementById('rjd-add-resume-detail')) document.getElementById('rjd-add-resume-detail').onclick = () => {
      navigator.clipboard.readText().then(t => { if(t.trim()){ app.resume=t.trim(); dbUpdateApp(app); renderTable(); showAppDetail(app); } });
    };
  }
  function hideAppDetail() { document.getElementById('rjd-detail-panel').style.display = 'none'; document.getElementById('rjd-main').style.display = 'flex'; currentDetailId = null; }

  function showResumeDetail(app) {
    const p = document.getElementById('rjd-resume-panel');
    if (!p) return;
    document.getElementById('rjd-detail-panel').style.display = 'none'; p.style.display = 'flex';
    document.getElementById('rjd-resume-body').textContent = app.resume || '';
  }
  function hideResumeDetail() { document.getElementById('rjd-resume-panel').style.display = 'none'; document.getElementById('rjd-detail-panel').style.display = 'flex'; }

  // ── LOGOUT ──
  async function logoutUser() {
    await sbSignOut(); clearSession();
    const s = document.getElementById('rjd-sidebar'); if (s) s.classList.remove('open');
    currentUser = null; applications = []; updateTrackBadge();
  }

  // ── TRACKER SCREEN ──
  function renderTrackerScreen() {
    const mc = document.getElementById('rjd-sidebar-content');
    if (!mc || !currentUser) return;
    mc.innerHTML = window.rjdTemplates.trackerScreen({
      initials: getInitials(currentUser.name), name: currentUser.name, todayISO: todayISO(), filterDate, STATUSES
    });
    renderTable(); bindTrackerEvents();
  }

  function bindTrackerEvents() {
    const bBack = document.getElementById('rjd-new-back'); if (bBack) bBack.onclick = hideNewAppPanel;
    const dBack = document.getElementById('rjd-detail-back'); if (dBack) dBack.onclick = hideAppDetail;
    const rBack = document.getElementById('rjd-resume-back'); if (rBack) rBack.onclick = hideResumeDetail;
    const nBtn = document.getElementById('rjd-new-app-btn'); if (nBtn) nBtn.onclick = showNewAppPanel;
    const sBtn = document.getElementById('rjd-settings-btn'); if (sBtn) sBtn.onclick = renderSettingsScreen;
    
    const exBtn = document.getElementById('rjd-extract-btn'); if (exBtn) exBtn.onclick = runExtract;
    const qExBtn = document.getElementById('rjd-quick-extract-btn'); if (qExBtn) qExBtn.onclick = runExtract;

    const sIn = document.getElementById('rjd-search-input'); if (sIn) sIn.oninput = (e) => { filterSearch = e.target.value; renderTable(); };
    const sFi = document.getElementById('rjd-status-filter'); if (sFi) sFi.onchange = (e) => { filterStatus = e.target.value; renderTable(); };
    
    // Save Notes
    const snBtn = document.getElementById('rjd-save-notes-btn');
    if (snBtn) snBtn.onclick = async () => {
      const app = applications.find(a => a.id === currentDetailId);
      if (app) { app.notes = document.getElementById('rjd-detail-notes').value; await dbUpdateApp(app); showToast('Saved'); }
    };
    
    // Save New App
    const saBtn = document.getElementById('rjd-save-app-btn');
    if (saBtn) saBtn.onclick = async () => {
      const company = document.getElementById('rjd-new-company').value.trim();
      const jobTitle = document.getElementById('rjd-new-title').value.trim();
      if (!company) { showToast('Company required', true); return; }
      const app = { 
        id: crypto.randomUUID(), company, jobTitle, url: document.getElementById('rjd-new-url').value, 
        jd: document.getElementById('rjd-new-jd').value, status: 'Applied', 
        date: today(), dateRaw: new Date().toISOString(), dateKey: todayKey() 
      };
      if (await dbSaveApp(app)) { applications.push(app); renderTable(); hideNewAppPanel(); showToast('Saved!'); }
    };

    // XLSX Export
    const csvBtn = document.getElementById('rjd-export-csv-btn');
    if (csvBtn) csvBtn.onclick = async () => {
      if (typeof window.buildXLSX !== 'function') {
        const s = document.createElement('script'); s.src = chrome.runtime.getURL('lib/xlsxbuilder.js');
        await new Promise(r => { s.onload = r; document.head.appendChild(s); });
      }
      const bytes = await window.buildXLSX([{ name: 'Apps', rows: applications.map(a => [a.company, a.jobTitle, a.status, a.date]) }]);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Applications.xlsx'; a.click();
    };
  }

  // ── RESUME DOWNLOAD ──
  async function downloadAppResume(app) {
    if (!app || !app.resume) { showToast('No resume', true); return; }
    
    // Dynamic load docxbuilder if missing
    if (typeof window.downloadResumeDocx !== 'function') {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('lib/docxbuilder.js');
      try {
        await new Promise((resolve, reject) => {
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch(e) { showToast('Failed to load builder', true); return; }
    }

    const profile = cachedProfile || {};
    const templateId = profile.template || 'standard';
    const filename = (app.company || 'Resume').replace(/[^a-z0-9]/gi, '_') + '_Resume';
    
    if (typeof window.downloadResumeDocx === 'function') {
      window.downloadResumeDocx(profile, app.resume, filename, templateId);
      showToast('Downloaded ✓');
    } else {
      showToast('Builder not found', true);
    }
  }

  // ── MAIN INIT ──
  function buildSidebar() {
    const sidebar = document.createElement('div'); sidebar.id = 'rjd-sidebar';
    sidebar.innerHTML = `<div id="rjd-header"><h2>Job Tracker</h2><button id="rjd-close">✕</button></div><div id="rjd-sidebar-content"></div>`;
    document.body.appendChild(sidebar);
    
    const toggle = document.createElement('div'); toggle.id = 'rjd-toggle';
    toggle.innerHTML = `<div id="rjd-toggle-icon">🚀</div><div id="rjd-toggle-badge" style="display:none;">0</div>`;
    toggle.onclick = () => {
      sidebar.classList.toggle('open');
      if (sidebar.classList.contains('open')) {
        if (applications.length) renderTrackerScreen();
        else dbLoadApps().then(apps => { applications = apps; renderTrackerScreen(); });
      }
    };
    document.body.appendChild(toggle);
    document.getElementById('rjd-close').onclick = () => sidebar.classList.remove('open');
    const t = document.createElement('div'); t.id = 'rjd-toast'; document.body.appendChild(t);
  }

  function applySession(sess) {
    if (sess && sess.token && sess.user) {
      sessionToken = sess.token; sessionRefreshToken = sess.refreshToken; currentUser = sess.user;
      loadGeminiKey(k => { GEMINI_KEY = k; });
      dbLoadApps().then(apps => { applications = apps; updateTrackBadge(); }).catch(() => {});
    } else { currentUser = null; applications = []; updateTrackBadge(); }
  }

  buildSidebar();
  const cs = chromeStore();
  if (cs) {
    cs.get(['rjd_session', 'resume_builder_profile'], r => {
      if (r.resume_builder_profile) cachedProfile = r.resume_builder_profile;
      applySession(r.rjd_session);
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === 'local' && c.resume_builder_profile) cachedProfile = c.resume_builder_profile.newValue || {};
    });
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'resume_builder_profile' && e.newValue) {
      try { chromeStore().set({ resume_builder_profile: JSON.parse(e.newValue) }); } catch(e){}
    }
  });

})();
