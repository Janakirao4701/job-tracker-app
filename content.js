(function () {
  if (document.getElementById('rjd-sidebar')) return;

  // ── CONFIG ──
  let GEMINI_KEY = ''; // loaded from storage
  const SUPABASE_URL  = 'https://dxsdvzhnqbynicrvbcfi.supabase.co';
  // The Supabase anon key is a PUBLIC key — safe to ship in client code.
  // Security comes from RLS policies on the Supabase project, not from hiding this key.
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4c2R2emhucUJ5bmljcnZiY2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTUyMDcsImV4cCI6MjA4OTY5MTIwN30.7csAFAIjVOU8_acamyYoTFLgXzao56k9aDYgGDFd2oo';

  const STATUSES = ['Applied','Interview Scheduled','Interview Done','Offer','Rejected','Skipped'];
  const STATUS_COLORS = {
    'Applied':             { bg: '#ebf4ff', color: '#2E75B6' },
    'Interview Scheduled': { bg: '#f0fff4', color: '#276749' },
    'Interview Done':      { bg: '#fffff0', color: '#975a16' },
    'Offer':               { bg: '#e6ffed', color: '#22543d' },
    'Rejected':            { bg: '#fff5f5', color: '#c53030' },
    'Skipped':             { bg: '#f7fafc', color: '#a0aec0' },
  };

  let currentUser         = null; // { id, email, name }
  let sessionToken        = null;
  let sessionRefreshToken = null;
  let applications = [];
  let filterStatus = 'all';
  let filterSearch = '';
  let filterDate   = '';
  let currentDetailId = null;

  // ── SUPABASE HELPERS ──
  function sbHeaders() {
    return {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + (sessionToken || SUPABASE_KEY),
    };
  }

  // Auto-refresh session token before it expires
  // Issue #15 fix: singleton promise prevents concurrent refresh calls racing each other.
  let _refreshPromise = null;
  async function refreshSession() {
    if (!sessionToken) return;
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = _doRefreshSession().finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  }
  async function _doRefreshSession() {
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
        // Warning fix #2: broadcast refreshed token to all tabs via background
        const s = chromeStore();
        if (s) {
          chrome.runtime.sendMessage({
            action: 'session_saved',
            payload: { token: sessionToken, user: currentUser, refreshToken: sessionRefreshToken }
          }, () => { if (chrome.runtime.lastError) {} });
        }
      }
    } catch(e) { console.warn('Token refresh failed', e); }
  }

  async function sbFetch(url, opts) {
    if (!navigator.onLine) throw new Error('You are offline. Check your internet connection.');
    const res = await fetch(url, opts);
    if (res.status === 401) {
      sessionToken = null; currentUser = null; clearSession();
            showToast('Session expired — please sign in again', true);
      throw new Error('Session expired');
    }
    return res;
  }

  async function sbSignOut() {
    await fetch(SUPABASE_URL + '/auth/v1/logout', {
      method: 'POST',
      headers: sbHeaders(),
    });
  }

  function _mapRow(r) {
    return {
      id:          r.id,
      company:     r.company,
      jobTitle:    r.job_title,
      url:         r.url,
      jd:          r.jd,
      resume:      r.resume,
      status:      r.status,
      date:        r.date,
      dateRaw:     r.date_raw,
      dateKey:     r.date_key,
      notes:       r.notes,
      followUpDate: r.follow_up_date || '',
    };
  }

  async function dbLoadApps() {
    // Issue #14 fix: paginate in 1000-row pages so users with >1000 applications
    // don't silently lose records (Supabase default cap is 1000 rows).
    const PAGE = 1000;
    let all = [];
    let page = 0;
    while (true) {
      const from = page * PAGE;
      const to   = from + PAGE - 1;
      const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications?select=*&order=created_at.asc', {
        headers: { ...sbHeaders(), 'Range-Unit': 'items', 'Range': from + '-' + to },
      });
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;
      all = all.concat(data.map(_mapRow));
      if (data.length < PAGE) break;   // last page
      page++;
    }
    return all;
  }

  async function dbSaveApp(app) {
    // Issue #5 fix: wrap in try/catch so network/parse errors surface as toasts.
    if (!navigator.onLine) { showToast('No internet — cannot save', true); return false; }
    try {
      const body = {
        id:        app.id,
        username:  currentUser.id,
        company:   app.company,
        job_title: app.jobTitle,
        url:       app.url,
        jd:        app.jd,
        resume:    app.resume || '',
        status:    app.status,
        date:      app.date,
        date_raw:  app.dateRaw,
        date_key:  app.dateKey,
        notes:          app.notes || '',
        follow_up_date: app.followUpDate || null,
      };
      const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications', {
        method: 'POST',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch(e) {
      showToast('Save failed: ' + (e.message || 'unknown error'), true);
      return false;
    }
  }

  async function dbUpdateApp(app) {
    // Issue #5 fix: try/catch for update errors.
    if (!navigator.onLine) { showToast('No internet — change will sync when online', true); return false; }
    try {
      const body = {
        company:   app.company,
        job_title: app.jobTitle,
        url:       app.url,
        jd:        app.jd,
        resume:          app.resume || '',
        status:          app.status,
        notes:           app.notes || '',
        follow_up_date:  app.followUpDate || null,
      };
      const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications?id=eq.' + app.id, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch(e) {
      showToast('Update failed: ' + (e.message || 'unknown error'), true);
      return false;
    }
  }

  async function dbDeleteApp(id) {
    // Issue #5 fix: try/catch for delete errors.
    try {
      const res = await sbFetch(SUPABASE_URL + '/rest/v1/applications?id=eq.' + id, {
        method: 'DELETE',
        headers: sbHeaders(),
      });
      return res.ok;
    } catch(e) {
      showToast('Delete failed: ' + (e.message || 'unknown error'), true);
      return false;
    }
  }

  // ── SESSION PERSISTENCE ──
  function chromeStore() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  }

  function saveSession(token, user, refreshToken) {
    // Issue #4 fix: store under BOTH keys so background.js (refresh_token) and
    // content.js legacy readers (refreshToken) both find the value.
    const s = chromeStore();
    if (s) s.set({ rjd_session: { token, user, refreshToken: refreshToken||'', refresh_token: refreshToken||'' } });
  }

  function clearSession() {
    const s = chromeStore();
    if (s) s.remove('rjd_session');
  }

  function loadSession(cb) {
    const s = chromeStore();
    if (s) {
      s.get('rjd_session', r => {
        const sess = r.rjd_session || null;
        if (sess && sess.refreshToken) sessionRefreshToken = sess.refreshToken;
        cb(sess);
      });
    } else {
      cb(null);
    }
  }

  // ── GEMINI KEY STORAGE ──
  function saveGeminiKey(key, cb) {
    const s = chromeStore();
    if (s) s.set({ rjd_gemini_key: key }, cb || (() => {}));
  }

  function loadGeminiKey(cb) {
    if (typeof cb !== 'function') return;
    const s = chromeStore();
    if (s) {
      s.get('rjd_gemini_key', r => cb(r.rjd_gemini_key || ''));
    } else {
      cb('');
    }
  }

  // ── LOADING SCREEN ──
  function showLoading(msg) {
    const main = document.getElementById('rjd-sidebar-content');
    if (!main) return;
    main.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 20px;">
        <div id="rjd-spinner" style="width:36px;height:36px;border:3px solid #ebf4ff;border-top-color:#1F4E79;border-radius:50%;"></div>
        <div style="font-size:13px;color:#718096;text-align:center;">${msg || 'Loading...'}</div>
      </div>`;
    // CSS animation via style tag
    const s = document.createElement('style');
    s.id = 'rjd-spinner-style';
    s.textContent = '@keyframes rjd-spin{to{transform:rotate(360deg)}} #rjd-spinner{animation:rjd-spin 0.8s linear infinite;}';
    if (!document.getElementById('rjd-spinner-style')) document.head.appendChild(s);
  }

  // ── UTILS ──
  // workingDate: manually chosen date for this session (YYYY-MM-DD), stored in chrome.storage
  let workingDate = '';

  function getWorkingDateObj() {
    if (workingDate) {
      const [y,m,d] = workingDate.split('-').map(Number);
      return new Date(y, m-1, d);
    }
    return new Date();
  }
  function today() {
    return getWorkingDateObj().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function todayKey() {
    const d = getWorkingDateObj();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function todayISO() {
    const d = getWorkingDateObj();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function showToast(msg, isError) {
    const t = document.getElementById('rjd-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = isError ? '#c53030' : '#1F4E79';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }
  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  }

  // ── GEMINI EXTRACTION ──
  async function extractWithGemini(jdText, pageUrl) {
    if (!GEMINI_KEY || !GEMINI_KEY.trim()) throw new Error('Gemini API key not set — open Settings to add it');
    const prompt = `Extract from this job description. Return ONLY valid JSON, no markdown.\n{"company_name":"","job_title":""}\n\n${jdText.substring(0,3000)}`;
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + GEMINI_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 150 } })
    });
    if (!res.ok) throw new Error('Gemini API error: ' + res.status);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(text);
    parsed.url = pageUrl;
    return parsed;
  }

  async function runExtract() {
    const statusEl = document.getElementById('rjd-extract-status');
    if (!statusEl) return;
    statusEl.textContent = 'Auto-extracting...';
    statusEl.style.color = '#2E75B6';
    try {
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) { statusEl.textContent = 'Clipboard empty — paste JD and click Extract.'; statusEl.style.color = '#c53030'; return; }
      const result = await extractWithGemini(clipText, window.location.href);
      document.getElementById('rjd-new-company').value = result.company_name || '';
      document.getElementById('rjd-new-title').value   = result.job_title   || '';
      document.getElementById('rjd-new-url').value     = result.url         || '';
      document.getElementById('rjd-new-jd').value      = clipText;
      statusEl.textContent = '✓ Extracted — review and save';
      statusEl.style.color = '#276749';
      setTimeout(() => { statusEl.textContent = ''; }, 4000);
    } catch(err) {
      statusEl.textContent = err.message || 'Extraction failed';
      statusEl.style.color = '#c53030';
    }
  }


  // ════════════════════════════════════════
  // SETTINGS SCREEN
  // ════════════════════════════════════════
  function renderSettingsScreen(returnTo) {
    const main = document.getElementById('rjd-sidebar-content');
    if (!main) return;

    let activeSection = 'apikey';

    function renderSettings() {
      main.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">

          <div style="background:#1F4E79;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-shrink:0;">
            <button id="rjd-settings-back-btn" style="background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;">← Back</button>
            <span style="font-size:13px;font-weight:700;color:#fff;">Settings</span>
          </div>

          <div style="flex:1;display:flex;overflow:hidden;">

            <!-- NAV -->
            <div style="width:130px;background:#f8fafc;border-right:1px solid #e2e8f0;flex-shrink:0;overflow-y:auto;padding:8px 0;">
              <div style="font-size:9px;font-weight:700;color:#a0aec0;text-transform:uppercase;letter-spacing:0.8px;padding:6px 12px 4px;">General</div>
              <div class="rjd-settings-nav-item ${activeSection==='apikey'?'rjd-snav-active':''}" data-sec="apikey">🔑 API Key</div>
              <div style="font-size:9px;font-weight:700;color:#a0aec0;text-transform:uppercase;letter-spacing:0.8px;padding:10px 12px 4px;">Info</div>
              <div class="rjd-settings-nav-item ${activeSection==='shortcuts'?'rjd-snav-active':''}" data-sec="shortcuts">⌨️ Shortcuts</div>
              <div class="rjd-settings-nav-item ${activeSection==='privacy'?'rjd-snav-active':''}" data-sec="privacy">🛡️ Privacy</div>
              <div class="rjd-settings-nav-item ${activeSection==='about'?'rjd-snav-active':''}" data-sec="about">ℹ️ About</div>
            </div>

            <!-- CONTENT -->
            <div id="rjd-settings-panel" style="flex:1;overflow-y:auto;padding:16px;"></div>
          </div>
        </div>`;

      // Nav click
      main.querySelectorAll('.rjd-settings-nav-item').forEach(item => {
        item.addEventListener('click', () => {
          activeSection = item.dataset.sec;
          main.querySelectorAll('.rjd-settings-nav-item').forEach(i => i.classList.remove('rjd-snav-active'));
          item.classList.add('rjd-snav-active');
          renderSection(activeSection);
        });
      });

      document.getElementById('rjd-settings-back-btn').addEventListener('click', () => {
        // Warning fix #5: honour the returnTo parameter instead of always going to tracker
        if (returnTo === 'tracker') renderTrackerScreen();
        else renderTrackerScreen(); // default fallback
      });

      renderSection(activeSection);
    }

    function renderSection(sec) {
      const panel = document.getElementById('rjd-settings-panel');
      if (!panel) return;

      if (sec === 'apikey') {
        panel.innerHTML = `
          <div style="font-size:14px;font-weight:700;color:#1F4E79;margin-bottom:3px;">Gemini API Key</div>
          <div style="font-size:11px;color:#718096;margin-bottom:12px;">Powers AI extraction. Free key from Google.</div>
          <div style="background:#ebf4ff;border:1px solid #bee3f8;border-radius:7px;padding:10px;margin-bottom:14px;font-size:10px;color:#2E75B6;line-height:1.6;">
            Your key is stored only in your browser. It is sent directly to Google Gemini — never to any other server.
          </div>
          <div id="rjd-sk-msg"></div>
          <label style="font-size:10px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">API Key</label>
          <input type="password" id="rjd-sk-input" placeholder="AIzaSy..." style="width:100%;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:11px;font-family:inherit;background:#fff !important;color:#1a202c !important;margin-bottom:8px;"/>
          <div style="display:flex;gap:8px;margin-bottom:14px;">
            <button id="rjd-sk-show" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:10px;cursor:pointer;background:#f8fafc;color:#718096;font-family:inherit;">Show</button>
            <button id="rjd-sk-save" class="rjd-primary-btn" style="flex:1;padding:6px;">Save Key</button>
          </div>
          <div style="border-top:1px solid #f1f5f9;padding-top:12px;">
            <div style="font-size:11px;font-weight:600;color:#1a202c;margin-bottom:6px;">How to get a free key:</div>
            <div style="font-size:11px;color:#4a5568;line-height:1.8;">
              1. Go to <strong>aistudio.google.com</strong><br>
              2. Click <strong>Get API Key → Create API key</strong><br>
              3. Copy and paste it above
            </div>
          </div>`;

        loadGeminiKey(k => { if (k) document.getElementById('rjd-sk-input').value = k; });

        let shown = false;
        document.getElementById('rjd-sk-show').addEventListener('click', () => {
          shown = !shown;
          document.getElementById('rjd-sk-input').type = shown ? 'text' : 'password';
          document.getElementById('rjd-sk-show').textContent = shown ? 'Hide' : 'Show';
        });
        document.getElementById('rjd-sk-save').addEventListener('click', () => {
          const key = document.getElementById('rjd-sk-input').value.trim();
          if (!key) { showSMsg('Enter your API key', true); return; }
          if (!key.startsWith('AIza')) { showSMsg('Key should start with AIza...', true); return; }
          saveGeminiKey(key, () => {
            GEMINI_KEY = key;
            showSMsg('Key saved ✓', false);
          });
        });


      } else if (sec === 'shortcuts') {
        panel.innerHTML = `
          <div style="font-size:14px;font-weight:700;color:#1F4E79;margin-bottom:3px;">Keyboard Shortcuts</div>
          <div style="font-size:11px;color:#718096;margin-bottom:14px;">Speed up your workflow with these shortcuts.</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${[
              ['Open / close sidebar',  'Alt + Shift + T'],
              ['Extract & Save',        'Alt + Shift + E'],
              ['New application',       'Alt + Shift + N'],
              ['Open settings',         'Alt + Shift + S'],
              ['Close panel / back',    'Escape'],
            ].map(([action, key]) =>
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:7px;background:#f8fafc;border:1px solid #e2e8f0;">'
              + '<span style="font-size:12px;color:#1a202c;">' + action + '</span>'
              + '<kbd style="background:#fff;border:1px solid #cbd5e0;border-bottom:2px solid #cbd5e0;border-radius:5px;padding:3px 8px;font-size:10px;font-family:monospace;color:#1F4E79;font-weight:700;">' + key + '</kbd>'
              + '</div>'
            ).join('')}
          </div>
          <div style="margin-top:12px;background:#ebf4ff;border-radius:7px;padding:10px;font-size:10px;color:#2E75B6;line-height:1.6;">
            Shortcuts work on any page where the extension is active.
          </div>`;

      } else if (sec === 'privacy') {
        panel.innerHTML = `
          <div style="font-size:14px;font-weight:700;color:#1F4E79;margin-bottom:3px;">Privacy</div>
          <div style="font-size:11px;color:#718096;margin-bottom:14px;">What data we collect and how it's used.</div>
          <div style="display:flex;flex-direction:column;gap:10px;font-size:11px;color:#4a5568;line-height:1.7;">
            <div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:7px;padding:10px;">
              <strong style="color:#276749;">✓ What we store in Supabase:</strong><br>
              Your email, name, and job applications (company, title, URL, JD, resume, status, notes).
            </div>
            <div style="background:#ebf4ff;border:1px solid #bee3f8;border-radius:7px;padding:10px;">
              <strong style="color:#2E75B6;">✓ Your Gemini API key:</strong><br>
              Stored only in your browser's local storage. Never sent to our servers.
            </div>
            <div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:7px;padding:10px;">
              <strong style="color:#276749;">✓ No tracking:</strong><br>
              We do not collect analytics, usage data, or any personal information beyond what you enter.
            </div>
            <div style="background:#fff8f0;border:1px solid #fbd38d;border-radius:7px;padding:10px;">
              <strong style="color:#975a16;">⚠ Third parties:</strong><br>
              Job descriptions are sent to Google Gemini API for extraction. Supabase stores your application data. Both have their own privacy policies.
            </div>
          </div>`;

      } else if (sec === 'about') {
        const isDark = document.getElementById('rjd-sidebar').getAttribute('data-theme') === 'dark';
        panel.innerHTML = `
          <div style="font-size:14px;font-weight:700;color:#1F4E79;margin-bottom:3px;">About</div>
          <div style="font-size:11px;color:#718096;margin-bottom:14px;">Version info and credits.</div>
          <div style="margin-bottom:14px;padding:12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
            <div style="font-size:11px;font-weight:700;color:#1a202c;margin-bottom:8px;">Appearance</div>
            <div style="display:flex;gap:8px;">
              <button data-theme="light" style="flex:1;padding:7px;border-radius:6px;border:2px solid ${isDark?'#e2e8f0':'#1F4E79'};background:${isDark?'#f8fafc':'#ebf4ff'};color:${isDark?'#718096':'#1F4E79'};font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">☀️ Light</button>
              <button data-theme="dark" style="flex:1;padding:7px;border-radius:6px;border:2px solid ${isDark?'#1F4E79':'#e2e8f0'};background:${isDark?'#1a202c':'#f8fafc'};color:${isDark?'#e2e8f0':'#718096'};font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">🌙 Dark</button>
              <button data-theme="auto" style="flex:1;padding:7px;border-radius:6px;border:1px solid #e2e8f0;background:#f8fafc;color:#718096;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">🖥 Auto</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
              <span style="color:#718096;">Version</span><span style="font-weight:600;color:#1a202c;">4.2.0</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
              <span style="color:#718096;">AI Model</span><span style="font-weight:600;color:#1a202c;">Gemini 2.5 Flash</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
              <span style="color:#718096;">Database</span><span style="font-weight:600;color:#1a202c;">Supabase</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
              <span style="color:#718096;">Manifest</span><span style="font-weight:600;color:#1a202c;">Chrome MV3</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12px;">
              <span style="color:#718096;">Storage</span><span style="font-weight:600;color:#1a202c;">Cloud + Local</span>
            </div>
          </div>
          <div style="margin-top:16px;background:#f8fafc;border-radius:8px;padding:12px;font-size:11px;color:#718096;text-align:center;line-height:1.6;">
            Built for job seekers who mean business.<br>
            <span style="color:#1F4E79;font-weight:600;">Free forever.</span>
          </div>`;
        panel.querySelectorAll('[data-theme]').forEach(btn => {
          btn.addEventListener('click', () => {
            const t = btn.dataset.theme;
            if (t === 'auto') {
              const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              applyTheme(dark ? 'dark' : 'light');
            } else {
              applyTheme(t);
            }
            renderSection('about');
          });
        });
      }

      function showSMsg(msg, isError) {
        const el = document.getElementById('rjd-sk-msg');
        if (!el) return;
        el.innerHTML = `<div style="padding:7px 10px;border-radius:6px;font-size:11px;margin-bottom:10px;background:${isError?'#fff5f5':'#f0fff4'};color:${isError?'#c53030':'#276749'};border:1px solid ${isError?'#fed7d7':'#c6f6d5'};">${escHtml(msg)}</div>`;
      }
    }

    renderSettings();
  }

  

  // ════════════════════════════════════════
  // STATS
  // ════════════════════════════════════════
  function renderStats() {
    const sessionApps = applications.filter(a => a.dateKey === todayKey()).length;
    const thisWeek    = applications.filter(a => { const d = new Date(a.dateRaw); return (new Date()-d) <= 7*86400000; }).length;
    const interviews  = applications.filter(a => a.status === 'Interview Scheduled' || a.status === 'Interview Done').length;
    const offers      = applications.filter(a => a.status === 'Offer').length;
    const el = document.getElementById('rjd-stats');
    if (el) el.innerHTML = `
      <div class="rjd-stat-box"><div class="rjd-stat-num" id="rjd-today-count">${sessionApps}</div><div class="rjd-stat-lbl">This Session</div></div>
      <div class="rjd-stat-box"><div class="rjd-stat-num">${thisWeek}</div><div class="rjd-stat-lbl">This Week</div></div>
      <div class="rjd-stat-box"><div class="rjd-stat-num">${interviews}</div><div class="rjd-stat-lbl">Interviews</div></div>
      <div class="rjd-stat-box"><div class="rjd-stat-num rjd-stat-offer">${offers}</div><div class="rjd-stat-lbl">Offers</div></div>`;
    // Update progress bar
    updateSessionProgress();
  }

  function getSessionTarget() {
    return parseInt(localStorage.getItem('rjd_session_target') || '30', 10);
  }
  function updateSessionProgress() {
    const target     = getSessionTarget();
    const done       = applications.filter(a => a.dateKey === todayKey()).length;
    const pct        = Math.min(100, Math.round((done / target) * 100));
    const progText   = document.getElementById('rjd-session-progress');
    const progBar    = document.getElementById('rjd-progress-bar');
    const targSel    = document.getElementById('rjd-target-select');
    if (progText) progText.textContent = done + '/' + target;
    if (progText) progText.style.color = done >= target ? '#68d391' : '#90cdf4';
    if (progBar)  { progBar.style.width = pct + '%'; progBar.style.background = done >= target ? '#68d391' : '#2E75B6'; }
    if (targSel)  targSel.value = String(target);
  }

  // ── TABLE ──
  function updateTrackBadge() {
    const toggle = document.getElementById('rjd-toggle');
    if (!toggle) return;
    const count = applications.length;
    toggle.innerHTML = count > 0
      ? 'TRACK<span style="display:block;background:#fff;color:#1F4E79;border-radius:8px;font-size:8px;font-weight:900;padding:1px 4px;margin-top:3px;min-width:16px;text-align:center;">' + count + '</span>'
      : 'TRACK';
  }

  function getFiltered() {
    let list = [...applications];
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus);
    if (filterDate) list = list.filter(a => {
      if (!a.dateRaw) return false;
      // Convert dateRaw to local YYYY-MM-DD and compare
      const localDate = new Date(a.dateRaw).toLocaleDateString('en-CA'); // en-CA = YYYY-MM-DD
      return localDate === filterDate;
    });
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      list = list.filter(a => (a.company||'').toLowerCase().includes(q) || (a.jobTitle||'').toLowerCase().includes(q) || (a.url||'').toLowerCase().includes(q));
    }
    return list;
  }

  function renderTable() {
    renderStats();
    updateTrackBadge();
    const filtered = getFiltered();
    const tbody = document.getElementById('rjd-tbody');
    if (!tbody) return;
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="rjd-empty-row">No applications yet. Click "✦ Extract & Save" to start.</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map((app, idx) => {
      const sc = STATUS_COLORS[app.status] || STATUS_COLORS['Applied'];
      const resumeBtn = app.resume ? `<button class="rjd-view-resume-btn" data-id="${app.id}">View</button>` : `<span class="rjd-no-resume">—</span>`;
      const urlBtn    = app.url    ? `<a href="${escHtml(app.url)}" target="_blank" class="rjd-url-link">Open</a>` : `<span class="rjd-no-resume">—</span>`;
      // Warning fix #4: compare date strings directly — avoids UTC vs local timezone mismatch
      const isOverdue = app.followUpDate && app.followUpDate < todayKey().slice(0,10) && app.status !== 'Offer' && app.status !== 'Rejected';
      const followUpBadge = app.followUpDate ? `<div style="font-size:9px;color:${isOverdue?'#c53030':'#718096'};margin-top:1px;">${isOverdue?'⚠ Follow up: ':'📅 '} ${app.followUpDate}</div>` : '';
      return `<tr class="rjd-row" data-id="${app.id}" style="${isOverdue?'background:#fff5f5 !important;':''}">
        <td class="rjd-td rjd-td-sno">${idx+1}</td>
        <td class="rjd-td rjd-td-company"><div>${escHtml(app.company||'—')}</div>${followUpBadge}</td>
        <td class="rjd-td rjd-td-title">${escHtml(app.jobTitle||'—')}</td>
        <td class="rjd-td rjd-td-url">${urlBtn}</td>
        <td class="rjd-td rjd-td-resume">${resumeBtn}</td>
        <td class="rjd-td rjd-td-date">${escHtml(app.date||'—')}</td>
        <td class="rjd-td rjd-td-status">
          <select class="rjd-status-sel" data-id="${app.id}" style="background:${sc.bg};color:${sc.color}">
            ${STATUSES.map(s=>`<option value="${s}" ${app.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.rjd-status-sel').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        e.stopPropagation();
        const app = applications.find(a => a.id === sel.dataset.id);
        if (app) {
          app.status = sel.value;
          await dbUpdateApp(app);
          // Quality fix #2: re-render table instead of manually patching row backgrounds
          renderTable();
        }
      });
    });

    tbody.querySelectorAll('.rjd-view-resume-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); const app = applications.find(a=>a.id===btn.dataset.id); if(app) showResumeDetail(app); });
    });

    tbody.querySelectorAll('.rjd-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (['rjd-status-sel','rjd-view-resume-btn','rjd-url-link'].some(c=>e.target.classList.contains(c))) return;
        const app = applications.find(a=>a.id===row.dataset.id);
        if (app) showAppDetail(app);
      });
    });
  }

  // ── NEW APP PANEL ──
  function showNewAppPanel(autoExtract) {
    const panel = document.getElementById('rjd-new-app-panel');
    const main  = document.getElementById('rjd-main');
    if (panel && main) {
      main.style.display  = 'none';
      panel.style.display = 'flex';
      document.getElementById('rjd-new-company').value = '';
      document.getElementById('rjd-new-title').value   = '';
      document.getElementById('rjd-new-url').value     = '';
      document.getElementById('rjd-new-jd').value      = '';
      document.getElementById('rjd-extract-status').textContent = '';
      if (autoExtract) setTimeout(() => runExtract(), 100);
    }
  }

  function hideNewAppPanel() {
    document.getElementById('rjd-new-app-panel').style.display = 'none';
    document.getElementById('rjd-main').style.display = 'flex';
  }

  // ── APP DETAIL ──
  function showAppDetail(app) {
    currentDetailId = app.id;
    const panel = document.getElementById('rjd-detail-panel');
    document.getElementById('rjd-main').style.display  = 'none';
    panel.style.display = 'flex';
    document.getElementById('rjd-detail-company').textContent = app.company  || '—';
    document.getElementById('rjd-detail-title').textContent   = app.jobTitle || '—';
    // URL — populate editable input and sync Open link
    const urlInput = document.getElementById('rjd-detail-url-input');
    const urlLink  = document.getElementById('rjd-detail-url');
    if (urlInput) urlInput.value = app.url || '';
    function syncDetailUrlLink() {
      const v = urlInput ? urlInput.value.trim() : '';
      // Issue #12 fix: only allow http/https URLs to prevent javascript: injection.
      const isSafeUrl = v && /^https?:\/\//i.test(v);
      if (isSafeUrl) { urlLink.href = v; urlLink.style.opacity = '1'; urlLink.style.pointerEvents = 'auto'; }
      else           { urlLink.href = '#'; urlLink.style.opacity = '0.4'; urlLink.style.pointerEvents = 'none'; }
    }
    syncDetailUrlLink();
    if (urlInput) { urlInput.removeEventListener('input', syncDetailUrlLink); urlInput.addEventListener('input', syncDetailUrlLink); }
    document.getElementById('rjd-detail-date').textContent   = app.date   || '—';
    document.getElementById('rjd-detail-status').textContent = app.status || '—';
    document.getElementById('rjd-detail-jd').textContent     = app.jd     || 'No JD saved.';
    document.getElementById('rjd-detail-notes').value        = app.notes  || '';
    document.getElementById('rjd-detail-followup').value     = app.followUpDate || '';
    const resumeSection = document.getElementById('rjd-detail-resume-section');
    if (app.resume) {
      resumeSection.innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="rjd-view-resume-detail" class="rjd-action-btn">View Resume</button>
          <button id="rjd-copy-resume-btn" class="rjd-action-btn rjd-secondary-btn">Copy Resume</button>
          <button id="rjd-update-resume-btn" class="rjd-action-btn rjd-secondary-btn">Update Resume</button>
        </div>`;
      document.getElementById('rjd-view-resume-detail').addEventListener('click', () => showResumeDetail(app));
      document.getElementById('rjd-copy-resume-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(app.resume).then(() => showToast('Resume copied')).catch(() => showToast('Copy failed', true));
      });
      document.getElementById('rjd-update-resume-btn').addEventListener('click',  () => saveResumeFromClipboard(app.id));
    } else {
      resumeSection.innerHTML = `<button id="rjd-add-resume-btn" class="rjd-action-btn">+ Add Resume from Clipboard</button>`;
      document.getElementById('rjd-add-resume-btn').addEventListener('click', () => saveResumeFromClipboard(app.id));
    }
    // Copy JD button
    const copyJdBtn = document.getElementById('rjd-copy-jd-btn');
    if (copyJdBtn) copyJdBtn.addEventListener('click', () => {
      const jd = app.jd || '';
      if (!jd) { showToast('No JD saved', true); return; }
      navigator.clipboard.writeText(jd).then(() => showToast('JD copied')).catch(() => showToast('Copy failed', true));
    });
    // Copy URL button
    const copyUrlBtn = document.getElementById('rjd-copy-url-btn');
    if (copyUrlBtn) copyUrlBtn.addEventListener('click', () => {
      const v = document.getElementById('rjd-detail-url-input')?.value.trim() || '';
      if (!v) { showToast('No URL saved', true); return; }
      navigator.clipboard.writeText(v).then(() => showToast('URL copied')).catch(() => showToast('Copy failed', true));
    });
  }

  function hideAppDetail() {
    document.getElementById('rjd-detail-panel').style.display = 'none';
    document.getElementById('rjd-main').style.display = 'flex';
    currentDetailId = null;
  }

  // ── RESUME DETAIL ──
  function showResumeDetail(app) {
    const panel = document.getElementById('rjd-resume-panel');
    panel.dataset.prev = currentDetailId ? 'detail' : 'main';
    panel.style.display = 'flex';
    document.getElementById('rjd-detail-panel').style.display = 'none';
    document.getElementById('rjd-main').style.display = 'none';
    document.getElementById('rjd-resume-title').textContent = 'Resume — ' + (app.company||'Application');
    document.getElementById('rjd-resume-body').textContent  = app.resume || '';
  }

  function hideResumeDetail() {
    const panel = document.getElementById('rjd-resume-panel');
    panel.style.display = 'none';
    if (panel.dataset.prev === 'detail') {
      const app = applications.find(a=>a.id===currentDetailId);
      if (app) showAppDetail(app);
    } else {
      document.getElementById('rjd-main').style.display = 'flex';
    }
  }

  async function saveResumeFromClipboard(appId) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { showToast('Clipboard is empty', true); return; }
      const app = applications.find(a=>a.id===appId);
      if (app) {
        app.resume = text.trim();
        await dbUpdateApp(app);
        showToast('Resume saved');
        renderTable();
        if (currentDetailId === appId) showAppDetail(app);
      }
    } catch { showToast('Could not read clipboard', true); }
  }

  // ── LOGOUT ──
  async function logoutUser() {
    await sbSignOut();
    clearSession();
    // Critical fix #4: reset all state and close sidebar via applySession
    applySession(null);
    const sidebar = document.getElementById('rjd-sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  // ════════════════════════════════════════
  // TRACKER SCREEN
  // ════════════════════════════════════════
  function renderTrackerScreen() {
    const main = document.getElementById('rjd-sidebar-content');
    if (!main) return;

    const initials = getInitials(currentUser.name);

    main.innerHTML = `
      <div id="rjd-tracker-wrap">
        <div id="rjd-main" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
          <div id="rjd-toolbar">
            <div class="rjd-toolbar-left">
              <div style="width:28px;height:28px;border-radius:50%;background:#fff;color:#1F4E79;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${escHtml(initials)}</div>
              <span id="rjd-username-display">${escHtml(currentUser.name)}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button id="rjd-quick-extract-btn" class="rjd-primary-btn" style="background:#1F4E79;font-size:11px;padding:5px 10px;white-space:nowrap;">✦ Extract & Save</button>
              <button id="rjd-new-app-btn" class="rjd-primary-btn">+ New</button>
              <button id="rjd-refresh-btn" title="Refresh" style="background:rgba(255,255,255,0.2);border:none;color:#fff;font-size:14px;cursor:pointer;padding:5px 7px;border-radius:6px;line-height:1;">↻</button>
              <button id="rjd-settings-btn" title="Settings" style="background:rgba(255,255,255,0.2);border:none;color:#fff;font-size:14px;cursor:pointer;padding:5px 7px;border-radius:6px;line-height:1;">⚙</button>
            </div>
          </div>

          <div id="rjd-stats"></div>

          <!-- Session Bar -->
          <div id="rjd-session-bar" style="padding:8px 12px;background:#1a365d;border-bottom:1px solid #2a4a7f;font-size:12px;color:#bee3f8;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-weight:700;white-space:nowrap;">📅 Session:</span>
              <input type="date" id="rjd-working-date-input" style="flex:1;padding:3px 8px;border-radius:5px;border:1px solid #2E75B6;background:#0f2744;color:#fff;font-size:12px;font-family:inherit;"/>
              <button id="rjd-working-date-today" style="padding:3px 8px;border-radius:5px;border:none;background:#2E75B6;color:#fff;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;">Today</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="white-space:nowrap;">🎯 Target:</span>
              <select id="rjd-target-select" style="padding:3px 8px;border-radius:5px;border:1px solid #2E75B6;background:#0f2744;color:#fff;font-size:12px;font-family:inherit;flex:1;">
                ${[10,15,20,25,30,35,40,50].map(n=>`<option value="${n}">${n} applications</option>`).join('')}
              </select>
              <span id="rjd-session-progress" style="font-weight:700;white-space:nowrap;color:#90cdf4;">0/30</span>
            </div>
            <div id="rjd-progress-bar-wrap" style="margin-top:6px;background:#0f2744;border-radius:4px;height:6px;overflow:hidden;">
              <div id="rjd-progress-bar" style="height:6px;background:#2E75B6;border-radius:4px;width:0%;transition:width 0.3s;"></div>
            </div>
          </div>

          <div id="rjd-filters">
            <input type="text" id="rjd-search-input" placeholder="Search company or title..." />
            <select id="rjd-status-filter">
              <option value="all">All Statuses</option>
              ${STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}
            </select>
            <input type="date" id="rjd-date-filter" title="Filter by date" />
            <button id="rjd-export-csv-btn" title="Export Excel">Export XLSX</button>
          </div>

          <div id="rjd-table-wrap">
            <table id="rjd-table">
              <thead>
                <tr>
                  <th class="rjd-th">#</th>
                  <th class="rjd-th">Company</th>
                  <th class="rjd-th">Job Title</th>
                  <th class="rjd-th">URL</th>
                  <th class="rjd-th">Resume</th>
                  <th class="rjd-th">Date</th>
                  <th class="rjd-th">Status</th>
                </tr>
              </thead>
              <tbody id="rjd-tbody"></tbody>
            </table>
          </div>
        </div>

        <div id="rjd-new-app-panel" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
          <div class="rjd-panel-header">
            <button class="rjd-back-btn" id="rjd-new-back">← Back</button>
            <span class="rjd-panel-title">New Application</span>
          </div>
          <div class="rjd-panel-body">
            <div id="rjd-extract-status" class="rjd-extract-status"></div>
            <button id="rjd-extract-btn" class="rjd-extract-btn">✦ Extract from Clipboard + Page URL</button>
            <div class="rjd-field-group"><label class="rjd-label">Company Name</label><input type="text" id="rjd-new-company" placeholder="e.g. Google"/></div>
            <div class="rjd-field-group"><label class="rjd-label">Job Title</label><input type="text" id="rjd-new-title" placeholder="e.g. Senior Data Analyst"/></div>
            <div class="rjd-field-group"><label class="rjd-label">Job URL</label><input type="text" id="rjd-new-url" placeholder="Auto-filled or paste manually"/></div>
            <div class="rjd-field-group"><label class="rjd-label">Job Description</label><textarea id="rjd-new-jd" placeholder="Auto-filled from clipboard..." rows="6"></textarea></div>
            <button id="rjd-save-app-btn" class="rjd-primary-btn">Save Application</button>
          </div>
        </div>

        <div id="rjd-detail-panel" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
          <div class="rjd-panel-header">
            <button class="rjd-back-btn" id="rjd-detail-back">← Back</button>
            <span class="rjd-panel-title" id="rjd-detail-company">Detail</span>
          </div>
          <div class="rjd-panel-body">
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">Job Title</span><span id="rjd-detail-title"></span></div>
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">URL</span>
              <div style="display:flex;gap:6px;align-items:center;flex:1;">
                <input type="url" id="rjd-detail-url-input" style="flex:1;padding:4px 8px;border:1px solid #cbd5e0;border-radius:5px;font-size:12px;font-family:inherit;background:#fff;color:#1a202c;" placeholder="https://..."/>
                <a id="rjd-detail-url" target="_blank" class="rjd-url-link" style="white-space:nowrap;flex-shrink:0;">Open</a>
                <button id="rjd-copy-url-btn" style="padding:3px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;background:#f8fafc;color:#4a5568;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">Copy</button>
              </div>
            </div>
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">Date</span><span id="rjd-detail-date"></span></div>
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">Status</span><span id="rjd-detail-status"></span></div>
            <div class="rjd-detail-section"><div class="rjd-detail-lbl" style="display:flex;align-items:center;justify-content:space-between;">Resume</div><div id="rjd-detail-resume-section" style="margin-top:6px;"></div></div>
            <div class="rjd-detail-section">
              <div class="rjd-detail-lbl" style="display:flex;align-items:center;justify-content:space-between;">
                <span>Job Description</span>
                <button id="rjd-copy-jd-btn" style="padding:3px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;background:#f8fafc;color:#4a5568;cursor:pointer;font-family:inherit;">Copy JD</button>
              </div>
              <pre id="rjd-detail-jd" class="rjd-jd-text"></pre>
            </div>
            <div class="rjd-detail-section">
              <div class="rjd-detail-lbl">Follow-up Date</div>
              <input type="date" id="rjd-detail-followup" style="width:100%;padding:6px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:12px;font-family:inherit;background:#fff !important;color:#1a202c !important;margin-top:4px;"/>
            </div>
            <div class="rjd-detail-section">
              <div class="rjd-detail-lbl">Notes</div>
              <textarea id="rjd-detail-notes" class="rjd-notes-input" rows="3"></textarea>
              <button id="rjd-save-notes-btn" class="rjd-action-btn" style="margin-top:6px;">Save Notes</button>
            </div>
            <div style="margin-top:12px;"><button id="rjd-delete-app-btn" class="rjd-delete-app-btn">Delete Application</button></div>
          </div>
        </div>

        <div id="rjd-resume-panel" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
          <div class="rjd-panel-header">
            <button class="rjd-back-btn" id="rjd-resume-back">← Back</button>
            <span class="rjd-panel-title" id="rjd-resume-title">Resume</span>
          </div>
          <div id="rjd-resume-body" class="rjd-resume-body"></div>
          <div style="padding:10px 12px;border-top:1px solid #e2e8f0;flex-shrink:0;">
            <button id="rjd-resume-copy-btn" class="rjd-primary-btn">Copy Resume Text</button>
          </div>
        </div>
      </div>`;

    renderTable();
    bindTrackerEvents();
  }

  function bindTrackerEvents() {
    document.getElementById('rjd-settings-btn').addEventListener('click', () => renderSettingsScreen('tracker'));
    document.getElementById('rjd-refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('rjd-refresh-btn');
      btn.style.opacity = '0.5';
      btn.disabled = true;
      try {
        applications = await dbLoadApps();
        renderTable();
        showToast('Refreshed ✓');
      } catch(e) {
        showToast('Refresh failed', true);
      }
      btn.style.opacity = '1';
      btn.disabled = false;
    });
    document.getElementById('rjd-new-app-btn').addEventListener('click', () => showNewAppPanel(false));
    document.getElementById('rjd-new-back').addEventListener('click', hideNewAppPanel);
    document.getElementById('rjd-detail-back').addEventListener('click', hideAppDetail);
    document.getElementById('rjd-resume-back').addEventListener('click', hideResumeDetail);

    document.getElementById('rjd-search-input').addEventListener('input', (e) => { filterSearch = e.target.value; renderTable(); });
    document.getElementById('rjd-status-filter').addEventListener('change', (e) => { filterStatus = e.target.value; renderTable(); });
    document.getElementById('rjd-date-filter').addEventListener('change', (e) => { filterDate = e.target.value; renderTable(); });

    // ── WORKING DATE picker ──
    function setWorkingDate(iso) {
      workingDate = iso;
      const input = document.getElementById('rjd-working-date-input');
      if (input) input.value = iso;
      chrome.storage.local.set({ rjd_working_date: iso });
      // Update stats to reflect new working date
      updateStatsBar();
    }
    function updateStatsBar() {
      const todayApps = applications.filter(a => a.dateKey === todayKey()).length;
      const el = document.getElementById('rjd-today-count');
      if (el) el.textContent = todayApps;
    }
    // Set the input to reflect already-loaded workingDate
    const _wdInput = document.getElementById('rjd-working-date-input');
    if (_wdInput && workingDate) _wdInput.value = workingDate;
    document.getElementById('rjd-working-date-input').addEventListener('change', e => {
      setWorkingDate(e.target.value);
    });
    document.getElementById('rjd-working-date-today').addEventListener('click', () => {
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      setWorkingDate(iso);
    });
    document.getElementById('rjd-target-select').addEventListener('change', e => {
      localStorage.setItem('rjd_session_target', e.target.value);
      updateSessionProgress();
    });
    // Init target select value
    const _tSel = document.getElementById('rjd-target-select');
    if (_tSel) _tSel.value = String(getSessionTarget());
    updateSessionProgress();

    // Quick extract & save
    let _extracting = false;
    document.getElementById('rjd-quick-extract-btn').addEventListener('click', async () => {
      if (_extracting) return;
      _extracting = true;
      const btn = document.getElementById('rjd-quick-extract-btn');
      btn.textContent = 'Extracting...'; btn.disabled = true;

      const pageUrl  = window.location.href;
      let company    = '';
      let jobTitle   = '';
      let clipText   = '';

      // Try to read clipboard
      try { clipText = await navigator.clipboard.readText(); } catch(e) {}

      // Try Gemini extraction if key exists and clipboard has content
      if (GEMINI_KEY && GEMINI_KEY.trim() && clipText.trim()) {
        try {
          const result = await extractWithGemini(clipText, pageUrl);
          company  = result.company_name || '';
          jobTitle = result.job_title    || '';
        } catch(e) {
          // Extraction failed — will open form for manual fill
        }
      }

      // Duplicate check (only if we got something)
      if (company || jobTitle) {
        const dupByUrl   = applications.find(a => a.url && a.url === pageUrl);
        // Warning fix #1: normalise both sides with trim() + toLowerCase() for reliable matching
        const dupByTitle = applications.find(a =>
          a.company?.toLowerCase().trim() === company.toLowerCase().trim() &&
          a.jobTitle?.toLowerCase().trim() === jobTitle.toLowerCase().trim()
        );
        if (dupByUrl) {
          showToast('Already saved: ' + (dupByUrl.company || dupByUrl.jobTitle), true);
          btn.textContent = '✦ Extract & Save'; btn.disabled = false; _extracting = false;
          return;
        }
        if (dupByTitle) {
          showToast('Possible duplicate: ' + dupByTitle.company + ' — ' + dupByTitle.jobTitle, true);
          btn.textContent = '✦ Extract & Save'; btn.disabled = false; _extracting = false;
          return;
        }
      }

      // If we got company + title → save directly
      if (company && jobTitle) {
        const app = {
          id: crypto.randomUUID(), company, jobTitle,
          url: pageUrl, jd: clipText, resume: '',
          status: 'Applied', date: today(), dateRaw: new Date().toISOString(),
          dateKey: todayKey(), notes: '', followUpDate: ''
        };
        const ok = await dbSaveApp(app);
        if (ok) {
          applications.push(app);
          renderTable();
          showToast('Saved: ' + company + ' — ' + jobTitle);
        } else {
          showToast('Save failed — check connection', true);
        }
      } else {
        // Could not extract — open New Application form pre-filled with what we have
        showNewAppPanel(false);
        // Pre-fill whatever we could get
        const co = document.getElementById('rjd-new-company');
        const ti = document.getElementById('rjd-new-title');
        const ur = document.getElementById('rjd-new-url');
        const jd = document.getElementById('rjd-new-jd');
        if (co) co.value = company || '';
        if (ti) ti.value = jobTitle || '';
        if (ur) ur.value = pageUrl;
        if (jd) jd.value = clipText || '';
        // Show helpful hint
        const st = document.getElementById('rjd-extract-status');
        if (st) {
          st.style.color = '#975a16';
          st.textContent = !GEMINI_KEY
            ? 'No API key — fill details manually or add key in ⚙ Settings'
            : !clipText.trim()
            ? 'Clipboard empty — URL pre-filled, add company and title'
            : 'Could not extract — please fill in the details';
        }
      }

      btn.textContent = '✦ Extract & Save'; btn.disabled = false;
      _extracting = false;
    });

    // Extract in panel
    document.getElementById('rjd-extract-btn').addEventListener('click', () => runExtract());

    // Save new app
    // Issue #17 fix: guard against double-submit while async save is in flight.
    let _savingApp = false;
    document.getElementById('rjd-save-app-btn').addEventListener('click', async () => {
      if (_savingApp) return;
      _savingApp = true;
      const btn = document.getElementById('rjd-save-app-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
      const company  = document.getElementById('rjd-new-company').value.trim();
      const jobTitle = document.getElementById('rjd-new-title').value.trim();
      const url      = document.getElementById('rjd-new-url').value.trim();
      const jd       = document.getElementById('rjd-new-jd').value.trim();
      if (!company && !jobTitle) { showToast('Enter at least company or job title', true); return; }
      // Warning fix #1: duplicate check in manual save path too
      const dupByUrl   = url && applications.find(a => a.url && a.url === url);
      const dupByTitle = company && jobTitle && applications.find(a =>
        a.company?.toLowerCase().trim() === company.toLowerCase() &&
        a.jobTitle?.toLowerCase().trim() === jobTitle.toLowerCase()
      );
      if (dupByUrl)   { showToast('Already saved: ' + (dupByUrl.company || dupByUrl.jobTitle), true); return; }
      if (dupByTitle) { showToast('Possible duplicate: ' + dupByTitle.company + ' — ' + dupByTitle.jobTitle, true); return; }
      const app = {
        id: crypto.randomUUID(), company, jobTitle, url, jd, resume: '',
        status: 'Applied', date: today(), dateRaw: new Date().toISOString(), dateKey: todayKey(), notes: ''
      };
      const ok = await dbSaveApp(app);
      if (ok) {
        applications.push(app);
        hideNewAppPanel();
        renderTable();
        showToast('Application saved');
      } else { showToast('Save failed — check connection', true); }
      } finally {
        _savingApp = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Save Application'; }
      }
    });

    // Detail panel events
    document.getElementById('rjd-detail-panel').addEventListener('click', async (e) => {
      if (e.target.id === 'rjd-save-notes-btn') {
        const app = applications.find(a=>a.id===currentDetailId);
        if (app) {
          app.notes = document.getElementById('rjd-detail-notes').value;
          app.followUpDate = document.getElementById('rjd-detail-followup').value || '';
          const newUrl = (document.getElementById('rjd-detail-url-input')?.value || '').trim();
          app.url = newUrl;
          await dbUpdateApp(app);
          showToast('Saved');
          renderTable();
        }
      }
      if (e.target.id === 'rjd-delete-app-btn') {
        if (confirm('Delete this application?')) {
          await dbDeleteApp(currentDetailId);
          applications = applications.filter(a=>a.id!==currentDetailId);
          hideAppDetail(); renderTable(); showToast('Deleted');
        }
      }
    });

    document.getElementById('rjd-resume-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('rjd-resume-body').textContent);
      showToast('Resume copied');
    });

    // Export XLSX
    document.getElementById('rjd-export-csv-btn').addEventListener('click', async () => {
      if (applications.length === 0) { showToast('No applications to export', true); return; }
      showToast('Preparing export...');
      try {
        const now = new Date();
        const statusStyleMap = { 'Applied':2,'Interview Scheduled':3,'Interview Done':4,'Offer':5,'Rejected':6,'Skipped':7 };
        const numCols = 8;
        const colWidths = [5, 22, 30, 28, 20, 14, 45, 55];
        const rowHeights = {};
        const sheetRows = [];
        sheetRows.push([{ v: 'Job Application Report — ' + currentUser.name, t:'s', s:15 }, ...Array(numCols-1).fill(null)]);
        rowHeights[0] = 30;
        sheetRows.push([{ v: 'Exported on ' + now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) + '   ·   Total: ' + applications.length, t:'s', s:16 }, ...Array(numCols-1).fill(null)]);
        rowHeights[1] = 18;
        sheetRows.push(Array(numCols).fill(null)); rowHeights[2] = 6;
        const headers = ['#','Company','Job Title','Job URL','Status','Date Applied','Resume Text','Job Description'];
        sheetRows.push(headers.map(h=>({ v:h, t:'s', s:1 }))); rowHeights[3] = 22;
        applications.forEach((a,i) => {
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
        const statusCounts = {}; STATUSES2.forEach(s=>{ statusCounts[s]=applications.filter(a=>a.status===s).length; });
        const s2rows = []; const s2heights = {};
        s2rows.push([{ v:'Summary Dashboard', t:'s', s:15 }, null,null,null,null,null]); s2heights[0]=28;
        s2rows.push([{ v:'User: '+currentUser.name+'   ·   '+now.toLocaleDateString(), t:'s', s:16 }, null,null,null,null,null]); s2heights[1]=16;
        s2rows.push(Array(6).fill(null)); s2heights[2]=10;
        const kpis=[{label:'Total',value:String(applications.length)},{label:'This Week',value:String(applications.filter(a=>{const d=new Date(a.dateRaw);return(now-d)<=7*86400000;}).length)},{label:'Interviews',value:String((statusCounts['Interview Scheduled']||0)+(statusCounts['Interview Done']||0))},{label:'Offers',value:String(statusCounts['Offer']||0)},{label:'With Resume',value:String(applications.filter(a=>a.resume).length)},{label:'Success %',value:applications.length>0?Math.round(((statusCounts['Offer']||0)/applications.length)*100)+'%':'0%'}];
        const kpiStyles=[17,22,23,24,25,26];
        s2rows.push(kpis.map((k,i)=>({ v:k.label, t:'s', s:kpiStyles[i] }))); s2heights[3]=18;
        s2rows.push(kpis.map(k=>({ v:k.value, t:'s', s:18 }))); s2heights[4]=40;
        s2rows.push(Array(6).fill(null)); s2heights[5]=12;
        s2rows.push([{v:'Status',t:'s',s:19},{v:'Count',t:'s',s:19},{v:'%',t:'s',s:19},null,null,null]); s2heights[6]=20;
        STATUSES2.forEach((st,i)=>{ const c=statusCounts[st]||0; const pct=applications.length>0?((c/applications.length)*100).toFixed(1)+'%':'0%'; const ss=statusStyleMap[st]||2; s2rows.push([{v:st,t:'s',s:ss},{v:String(c),t:'n',s:13},{v:pct,t:'s',s:13},null,null,null]); s2heights[7+i]=18; });
        const bytes = await window.buildXLSX([
          { name:'Applications', headers, rows:sheetRows, colWidths, merges:['A1:H1','A2:H2'], rowHeights },
          { name:'Summary', headers:[], rows:s2rows, colWidths:[22,12,12,12,12,12], merges:['A1:F1','A2:F2'], rowHeights:s2heights }
        ]);
        const blob = new Blob([bytes], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = currentUser.name + '_' + now.toISOString().slice(0,10) + '.xlsx';
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        URL.revokeObjectURL(url); showToast('Excel exported ✓');
      } catch(err) { showToast('Export failed: ' + err.message, true); }
    });
  }


  // ── BUILD SIDEBAR ──
  function applyTheme(theme) {
    const sidebar = document.getElementById('rjd-sidebar');
    if (!sidebar) return;
    sidebar.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    const s = chromeStore(); if (s) s.set({ rjd_theme: theme });
  }

  function buildSidebar() {
    const style = document.createElement('style');
    style.textContent = `
      .rjd-settings-nav-item{padding:7px 12px;font-size:11px;color:#718096;cursor:pointer;border-left:2px solid transparent;display:flex;align-items:center;gap:6px;}
      .rjd-settings-nav-item:hover{background:#f1f5f9;color:#1F4E79;}
      .rjd-snav-active{background:#ebf4ff !important;color:#1F4E79 !important;border-left-color:#1F4E79 !important;font-weight:600;}
      .rjd-td-sno{width:24px !important;min-width:24px !important;max-width:24px !important;padding:5px 4px !important;text-align:center !important;}
      #rjd-table thead tr th:first-child{width:24px !important;padding:5px 4px !important;text-align:center !important;}
      #rjd-sidebar[data-theme=dark]{background:#1a202c !important;color:#e2e8f0 !important;border-left-color:#2d3748 !important;}
      #rjd-sidebar[data-theme=dark] #rjd-header{background:#1F4E79 !important;}
      #rjd-sidebar[data-theme=dark] #rjd-toolbar{background:#2d3748 !important;border-bottom-color:#4a5568 !important;}
      #rjd-sidebar[data-theme=dark] #rjd-filters{background:#2d3748 !important;border-bottom-color:#4a5568 !important;}
      #rjd-sidebar[data-theme=dark] #rjd-search-input,
      #rjd-sidebar[data-theme=dark] #rjd-status-filter,
      #rjd-sidebar[data-theme=dark] #rjd-date-filter{background:#4a5568 !important;color:#e2e8f0 !important;-webkit-text-fill-color:#e2e8f0 !important;border-color:#718096 !important;}
      #rjd-sidebar[data-theme=dark] #rjd-table-wrap{background:#1a202c !important;}
      #rjd-sidebar[data-theme=dark] .rjd-th{background:#2d3748 !important;color:#a0aec0 !important;border-color:#4a5568 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-td{border-color:#2d3748 !important;background:#1a202c !important;color:#e2e8f0 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-row:nth-child(even) .rjd-td{background:#2d3748 !important;}
      #rjd-sidebar[data-theme=dark] #rjd-stats{background:#2d3748 !important;border-bottom-color:#4a5568 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-stat-box{background:#2d3748 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-stat-lbl{color:#a0aec0 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-panel-header{background:#2d3748 !important;border-bottom-color:#4a5568 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-panel-body{background:#1a202c !important;}
      #rjd-sidebar[data-theme=dark] .rjd-field-group input,
      #rjd-sidebar[data-theme=dark] .rjd-field-group textarea,
      #rjd-sidebar[data-theme=dark] .rjd-notes-input{background:#2d3748 !important;color:#e2e8f0 !important;-webkit-text-fill-color:#e2e8f0 !important;border-color:#4a5568 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-label{color:#a0aec0 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-detail-lbl{color:#a0aec0 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-detail-row{border-bottom-color:#2d3748 !important;color:#e2e8f0 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-resume-body{background:#2d3748 !important;color:#e2e8f0 !important;}
      #rjd-sidebar[data-theme=dark] .rjd-jd-text{background:#2d3748 !important;color:#e2e8f0 !important;}
    `;
    document.head.appendChild(style);

    // Restore saved theme preference or auto-detect
    const s2 = chromeStore();
    if (s2) {
      s2.get('rjd_theme', r => {
        const saved = r.rjd_theme || 'auto';
        if (saved === 'dark') {
          applyTheme('dark');
        } else if (saved === 'light') {
          applyTheme('light');
        } else {
          // Auto — follow OS
          const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          applyTheme(prefersDark ? 'dark' : 'light');
        }
      });
    }

    const sidebar = document.createElement('div');
    sidebar.id = 'rjd-sidebar';
    sidebar.innerHTML = `
      <div id="rjd-header">
        <h2>Job Application Tracker</h2>
        <button id="rjd-close">✕</button>
      </div>
      <div id="rjd-sidebar-content" style="display:flex;flex-direction:column;flex:1;overflow:hidden;"></div>`;
    document.body.appendChild(sidebar);

    const toggle = document.createElement('button');
    toggle.id = 'rjd-toggle';
    // Always visible — behaviour changes based on login state
    document.body.appendChild(toggle);

    const toast = document.createElement('div');
    toast.id = 'rjd-toast';
    document.body.appendChild(toast);

    document.getElementById('rjd-close').addEventListener('click', () => sidebar.classList.remove('open'));

    toggle.addEventListener('click', () => {
      if (!currentUser) {
        // Not logged in — open extension's app.html which can write to chrome.storage
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
        }
        return;
      }
      sidebar.classList.toggle('open');
      if (!sidebar.classList.contains('open')) return;
      // Warning fix #6: skip reload if apps already loaded (avoid double-fetch + spinner flash)
      if (applications.length > 0) {
        renderTrackerScreen();
        return;
      }
      showLoading('Loading...');
      dbLoadApps().then(apps => {
        applications = apps;
        renderTrackerScreen();
      }).catch(() => renderTrackerScreen());
    });
  }

  // ── KEYBOARD SHORTCUTS ──
  // Listen for commands forwarded from background.js via CustomEvent
  window.addEventListener('rjd-command', (e) => {
    const action  = e.detail && e.detail.action;
    const sidebar = document.getElementById('rjd-sidebar');
    const isOpen  = sidebar && sidebar.classList.contains('open');
    if (action === 'toggle_sidebar') {
      document.getElementById('rjd-toggle') && document.getElementById('rjd-toggle').click();
    } else if (action === 'extract_save' && isOpen) {
      document.getElementById('rjd-quick-extract-btn') && document.getElementById('rjd-quick-extract-btn').click();
    } else if (action === 'new_app' && isOpen) {
      document.getElementById('rjd-new-app-btn') && document.getElementById('rjd-new-app-btn').click();
    } else if (action === 'open_settings' && isOpen && currentUser) {
      renderSettingsScreen('tracker');
    }
  });

  // Escape key — close panel or sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const sidebar = document.getElementById('rjd-sidebar');
    if (!sidebar || !sidebar.classList.contains('open')) return;
    // Close detail/new/resume panels first, then sidebar
    const detail = document.getElementById('rjd-detail-panel');
    const newApp  = document.getElementById('rjd-new-app-panel');
    const resume  = document.getElementById('rjd-resume-panel');
    if (resume  && resume.style.display  !== 'none') { hideResumeDetail(); return; }
    if (detail  && detail.style.display  !== 'none') { hideAppDetail();    return; }
    if (newApp  && newApp.style.display  !== 'none') { hideNewAppPanel();  return; }
    sidebar.classList.remove('open');
  });

  buildSidebar();

  // ── SESSION MANAGEMENT ──
  function applySession(sess) {
    const tog = document.getElementById('rjd-toggle');
    // Normalise: accept both {token} (our format) and {access_token} (raw Supabase format).
    if (sess && (sess.token || sess.access_token)) sess = { ...sess, token: sess.token || sess.access_token };
    if (sess && sess.token && sess.user) {
      sessionToken        = sess.token;
      sessionRefreshToken = sess.refreshToken || sess.refresh_token || '';
      currentUser         = sess.user;
      loadGeminiKey(k => { GEMINI_KEY = k || ''; });
      if (tog) tog.classList.add('rjd-visible');
      updateTrackBadge();
      // Preload apps silently
      dbLoadApps().then(apps => { applications = apps; updateTrackBadge(); }).catch(() => {});
    } else {
      currentUser = null;
      applications = [];
      if (tog) tog.classList.remove('rjd-visible');
      // Bug fix: also close the sidebar when session is cleared so it
      // doesn't stay open on the screen after logout/session expiry.
      const _sb = document.getElementById('rjd-sidebar');
      if (_sb) _sb.classList.remove('open');
    }
  }

  // Safe chrome API check
  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const hasChromeRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage;

  // On page load — load working date AND session together so workingDate is set before any save
  if (hasChromeStorage) {
    chrome.storage.local.get(['rjd_session', 'rjd_working_date'], r => {
      if (chrome.runtime.lastError) return;
      // Set workingDate FIRST before applySession renders the sidebar
      if (r.rjd_working_date) {
        workingDate = r.rjd_working_date;
      }
      applySession(r.rjd_session || null);
    });
  }

  // Listen for login/logout from background.js
  if (hasChromeRuntime) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'session_saved') {
        applySession(msg.payload);
      } else if (msg.action === 'session_cleared') {
        applySession(null);
        const sidebar = document.getElementById('rjd-sidebar');
        if (sidebar) sidebar.classList.remove('open');
      }
    });
  }

  // Poll chrome.storage to catch login/logout events that arrive while tab is open.
  // Fast poll (500ms) for the first 10s after page load catches login without message delay.
  // Then settles to 3s to reduce overhead.
  if (hasChromeStorage) {
    function _checkSession() {
      try {
        if (!chrome.runtime || !chrome.runtime.id) return false;
        chrome.storage.local.get('rjd_session', r => {
          if (chrome.runtime.lastError) return;
          const sess = r.rjd_session || null;
          if (sess && sess.token && sess.user && !currentUser) {
            applySession(sess);
          } else if ((!sess || !sess.token) && currentUser) {
            applySession(null);
          }
        });
        return true;
      } catch(e) { return false; }
    }

    // Fast poll for first 10s (catches login without relying on message delivery).
    // Then drops to slow poll to reduce overhead.
    const _fastPoll = setInterval(() => { if (!_checkSession()) clearInterval(_fastPoll); }, 500);
    setTimeout(() => {
      clearInterval(_fastPoll);
      setInterval(() => { _checkSession(); }, 3000);
    }, 10000);
  }

})();
