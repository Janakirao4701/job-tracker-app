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

  let currentUser         = null; // { id, email, name }
  let sessionToken        = null;
  let sessionRefreshToken = null;
  let applications = [];
  let filterStatus = 'all';
  let filterSearch = '';
  let filterDate   = '';
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
  // Auto-flush when coming back online
  window.addEventListener('online', () => flushQueue());

  // ── SUPABASE HELPERS ──
  function sbHeaders() {
    return {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + (sessionToken || SUPABASE_KEY),
    };
  }

  // Fix #15: Single in-flight promise prevents multiple simultaneous refresh calls
  let _refreshPromise = null;
  async function refreshSession() {
    if (!sessionRefreshToken) return false;
    if (_refreshPromise) return _refreshPromise; // coalesce concurrent callers
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
          const s = chromeStore();
          if (s) {
            chrome.runtime.sendMessage({
              action: 'session_saved',
              payload: { token: sessionToken, user: currentUser, refreshToken: sessionRefreshToken }
            }, () => { if (chrome.runtime.lastError) {} });
          }
          return true;
        }
      } catch(e) { console.warn('Token refresh failed', e); }
      return false;
    })();
    try { return await _refreshPromise; } finally { _refreshPromise = null; }
  }

  async function sbFetch(url, opts) {
    if (!navigator.onLine) throw new Error('You are offline. Check your internet connection.');
    let res = await fetch(url, opts);
    if (res.status === 401 && sessionRefreshToken) {
      const ok = await refreshSession();
      if (ok) {
        if (opts.headers) opts.headers['Authorization'] = 'Bearer ' + sessionToken;
        res = await fetch(url, opts);
      }
    }
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

  async function dbLoadApps() {
    const PAGE_SIZE = 1000;
    let allRows = [];
    let offset  = 0;
    // Paginate to bypass Supabase's default 1000-row cap
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
      id:       r.id,
      company:  r.company,
      jobTitle: r.job_title,
      url:      r.url,
      jd:       r.jd,
      resume:   r.resume,
      status:   r.status,
      date:     r.date,
      dateRaw:  r.date_raw,
      dateKey:  r.date_key,
      notes:       r.notes,
      followUpDate: r.follow_up_date || '',
    }));
  }

  async function dbSaveApp(app) {
    if (!navigator.onLine) {
      enqueueApp(app);
      applications.push(app);
      renderTable();
      return true; // treat as success so UI updates
    }
    if (!currentUser || !currentUser.id) {
      showToast('Please sign in to save applications', true);
      return false;
    }
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
    try {
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
    if (!navigator.onLine) { showToast('No internet — change will sync when online', true); return false; }
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
    try {
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
    return (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
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
    if (s) {
      s.get('rjd_session', r => {
        const sess = r.rjd_session || null;
        // Support both 'refreshToken' (current) and legacy 'refresh_token' key
        if (sess) sessionRefreshToken = sess.refreshToken || sess.refresh_token || '';
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
        <div id="rjd-spinner" style="width:36px;height:36px;border:3px solid #eef2ff;border-top-color:#4f46e5;border-radius:50%;"></div>
        <div style="font-size:13px;color:var(--text-muted,#94a3b8);text-align:center;">${msg || 'Loading...'}</div>
      </div>`;
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
    t.style.background = isError ? '#dc2626' : '';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }
  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  }

  // ── GEMINI EXTRACTION ──

  function extractFromDomain() {
    try {
      const hostname = window.location.hostname;
      // LinkedIn
      if (hostname.includes('linkedin.com')) {
        let company = document.querySelector('.job-details-jobs-unified-top-card__company-name a')?.innerText
                   || document.querySelector('.job-details-jobs-unified-top-card__company-name')?.innerText
                   || document.querySelector('.job-details-top-card__company-url')?.innerText;
        let title = document.querySelector('.job-details-jobs-unified-top-card__job-title h1')?.innerText
                 || document.querySelector('h1.t-24')?.innerText
                 || document.querySelector('.topcard__title')?.innerText;
        if (company && title) return { company: company.trim(), jobTitle: title.trim(), source: 'linkedin_dom' };
      }
      // Naukri
      if (hostname.includes('naukri.com')) {
        let company = document.querySelector('.jd-header-comp-name a')?.innerText 
                   || document.querySelector('.job-details .company-name')?.innerText;
        let title = document.querySelector('.jd-header-title')?.innerText 
                 || document.querySelector('h1.title')?.innerText;
        if (company && title) return { company: company.trim(), jobTitle: title.trim(), source: 'naukri_dom' };
      }
      // Indeed
      if (hostname.includes('indeed.com')) {
        let company = document.querySelector('[data-company-name="true"] a')?.innerText 
                   || document.querySelector('[data-company-name="true"]')?.innerText;
        let title = document.querySelector('h1[data-testid="jobsearch-JobInfoHeader-title"]')?.innerText
                 || document.querySelector('.jobsearch-JobInfoHeader-title')?.innerText;
        if (title) title = title.replace(/\s*-\s*job post$/i, '');
        if (company && title) return { company: company.trim(), jobTitle: title.trim(), source: 'indeed_dom' };
      }
      // Glassdoor
      if (hostname.includes('glassdoor.')) {
        let company = document.querySelector('[data-test="employerName"]')?.innerText?.split('\n')[0];
        let title = document.querySelector('[data-test="jobTitle"]')?.innerText;
        if (company && title) return { company: company.replace(/★.*/,'').trim(), jobTitle: title.trim(), source: 'glassdoor_dom' };
      }
      // Wellfound / AngelList
      if (hostname.includes('wellfound.com') || hostname.includes('angel.co')) {
        let company = document.querySelector('h2.styles_name__mkZaj')?.innerText
                   || document.querySelector('h1.styles_component__2q82k')?.innerText; // Depends on view
        let title = document.querySelector('h2.styles_title__D_wGE')?.innerText
                 || document.querySelector('.styles_jobTitle__...')?.innerText; // Adjust if found
        if (company) return { company: company.trim(), jobTitle: title?.trim(), source: 'wellfound_dom' };
      }
      // Internshala
      if (hostname.includes('internshala.com')) {
        let company = document.querySelector('.company_name a')?.innerText || document.querySelector('.company_name')?.innerText;
        let title = document.querySelector('.profile_on_detail_page')?.innerText;
        if (company && title) return { company: company.trim(), jobTitle: title.trim(), source: 'internshala_dom' };
      }
    } catch(e) {}
    return null;
  }

  function findJobPostingLD(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj['@type'] === 'JobPosting' || (Array.isArray(obj['@type']) && obj['@type'].includes('JobPosting'))) return obj;
    if (Array.isArray(obj)) {
      for (let item of obj) {
        const found = findJobPostingLD(item);
        if (found) return found;
      }
    } else {
      for (let key in obj) {
        if (typeof obj[key] === 'object') {
          const found = findJobPostingLD(obj[key]);
          if (found) return found;
        }
      }
    }
    return null;
  }

  // Fallback 1: scrape visible page DOM for company/title signals
  function scrapePageSignals() {
    const signals = {};

    // --- Precise Domain Extraction (Golden Path) ---
    const domainSignals = extractFromDomain();
    if (domainSignals) {
      signals.company = domainSignals.company;
      signals.jobTitle = domainSignals.jobTitle;
      signals.preciseDomain = true;
    }

    // --- Job Title Common Fallbacks ---
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const metaTitle = document.querySelector('meta[name="title"]')?.content || '';
    const h1 = document.querySelector('h1')?.innerText?.trim() || '';
    const pageTitle = document.title || '';
    signals.rawTitle = ogTitle || metaTitle || h1 || pageTitle;

    // --- Structured Data (Silver Path) ---
    if (!signals.company || !signals.jobTitle) {
      try {
        const jsonLds = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const el of jsonLds) {
          const obj = JSON.parse(el.textContent);
          const jobNode = findJobPostingLD(obj);
          if (jobNode) {
            let cName = typeof jobNode.hiringOrganization === 'string' ? jobNode.hiringOrganization : jobNode.hiringOrganization?.name;
            if (cName && !signals.company) signals.company = cName;
            if (jobNode.title && !signals.jobTitle) signals.jobTitle = jobNode.title;
          }
        }
      } catch(e) {}
    }

    // Try og:site_name as company hint
    if (!signals.company) {
      signals.ogSiteName = document.querySelector('meta[property="og:site_name"]')?.content || '';
    }

    // Collect visible text near common company-label elements
    const companySelectors = [
      '[data-company-name]','[class*="company-name"]','[class*="companyName"]',
      '[class*="employer"]','[class*="org-name"]','[itemprop="name"]',
      '[class*="hiring-company"]','[class*="job-company"]',
    ];
    for (const sel of companySelectors) {
      const el = document.querySelector(sel);
      if (el?.innerText?.trim()) { signals.domCompany = el.innerText.trim(); break; }
    }

    // URL hostname as last-resort company hint
    try {
      const host = new URL(window.location.href).hostname.replace(/^www\.|^jobs\.|^careers\.|^jobs\./, '');
      signals.hostname = host.split('.')[0]; 
    } catch(e) {}

    return signals;
  }

  // ── JD TEXT PRE-PARSER ──
  // Extracts company/title directly from the copied JD text using regex patterns.
  // This is the MOST reliable source when the user is on a different page.
  function parseJdTextSignals(jdText) {
    if (!jdText || !jdText.trim()) return {};
    const signals = {};
    const lines = jdText.split('\n').map(l => l.trim()).filter(Boolean);

    // Pattern 1: Labelled fields — "Company: Acme Corp", "Role: Software Engineer"
    const COMPANY_LABELS = /^(?:company|employer|organisation|organization|hiring company|posted by|about the company)\s*[:\-–]\s*(.+)$/i;
    const TITLE_LABELS   = /^(?:job title|role|position|designation|opening|vacancy|job opening|job role)\s*[:\-–]\s*(.+)$/i;
    for (const line of lines) {
      if (!signals.company) {
        const m = line.match(COMPANY_LABELS);
        if (m) signals.company = m[1].trim();
      }
      if (!signals.jobTitle) {
        const m = line.match(TITLE_LABELS);
        if (m) signals.jobTitle = m[1].trim();
      }
      if (signals.company && signals.jobTitle) break;
    }

    // Pattern 2: Top lines sometimes are: "CompanyName\nJobTitle" or vice versa
    // Heuristic: first non-empty line that looks like a proper title (2–6 words, title-case)
    if (!signals.jobTitle) {
      const JOB_TITLE_PATTERN = /^[A-Z][a-z]+(?:\s+[A-Za-z\-\/]+){1,6}$/;
      const SENIOR_WORDS = /\b(senior|junior|lead|staff|principal|associate|intern|manager|engineer|analyst|developer|designer|specialist|consultant|architect|director)\b/i;
      for (const line of lines.slice(0, 8)) {
        if (line.length > 5 && line.length < 80 && SENIOR_WORDS.test(line)) {
          signals.jobTitle = line;
          break;
        }
      }
    }

    // Pattern 3: "at CompanyName" in title  — e.g. "Senior Engineer at Google"
    if (!signals.company && signals.jobTitle) {
      const atMatch = signals.jobTitle.match(/\bat\s+(.+)$/i);
      if (atMatch) {
        signals.company = atMatch[1].trim();
        signals.jobTitle = signals.jobTitle.replace(/\bat\s+.+$/i, '').trim();
      }
    }

    // Pattern 4: Look for "About <Company>" or "About Us" section header
    if (!signals.company) {
      for (const line of lines) {
        const m = line.match(/^About\s+(?!us|the role|this role|this position)(.{2,50})$/i);
        if (m) { signals.company = m[1].replace(/[:\-–].*/, '').trim(); break; }
      }
    }

    // Pattern 5: "We are <Company>" / "<Company> is looking for"
    if (!signals.company) {
      for (const line of lines.slice(0, 20)) {
        let m = line.match(/^(?:we are|we're|welcome to|join)\s+([A-Z][A-Za-z0-9&' ]{1,40?})[,!.]/);
        if (!m) m = line.match(/^([A-Z][A-Za-z0-9&' ]{1,40?})\s+is\s+(?:looking|hiring|seeking)/);
        if (!m) m = line.match(/^([A-Z][A-Za-z0-9&'.\- ]{1,40?})\s+is\s+a\s+(?:leading|global|fast|growing)/i);
        if (m) { signals.company = m[1].trim(); break; }
      }
    }

    return signals;
  }

  // Build the richest possible context string to send to Gemini
  function buildExtractionContext(jdText, pageUrl) {
    const parts = [];
    const hasJD = jdText && jdText.trim().length > 50;

    // ── PRIORITY 1: JD text pre-parsed signals (most reliable when on a different page) ──
    if (hasJD) {
      const jdSig = parseJdTextSignals(jdText);
      if (jdSig.company)   parts.push(`[JD TEXT company hint] ${jdSig.company}`);
      if (jdSig.jobTitle)  parts.push(`[JD TEXT title hint] ${jdSig.jobTitle}`);
    }

    // ── PRIORITY 2: Page structured/DOM signals (only useful if on the actual job page) ──
    const sig = scrapePageSignals();
    if (sig.preciseDomain) {
      parts.push(`[VERIFIED DOM COMPANY] ${sig.company}`);
      parts.push(`[VERIFIED DOM TITLE] ${sig.jobTitle}`);
    } else {
      if (sig.company)    parts.push(`[PAGE structured data company] ${sig.company}`);
      if (sig.jobTitle)   parts.push(`[PAGE structured data title] ${sig.jobTitle}`);
      if (sig.rawTitle)   parts.push(`[PAGE title/H1] ${sig.rawTitle}`);
      if (sig.ogSiteName) parts.push(`[PAGE og:site_name] ${sig.ogSiteName}`);
      if (sig.domCompany) parts.push(`[PAGE DOM company element] ${sig.domCompany}`);
      if (sig.hostname)   parts.push(`[PAGE hostname hint] ${sig.hostname}`);
    }
    parts.push(`[PAGE URL] ${pageUrl}`);

    // ── PRIORITY 3: Full JD text (let Gemini read it directly) ──
    if (hasJD) {
      parts.push(`[JOB DESCRIPTION TEXT]\n${jdText.substring(0, 8000)}`);
    }

    return parts.join('\n');
  }

  async function extractWithGemini(jdText, pageUrl) {
    if (!GEMINI_KEY || !GEMINI_KEY.trim()) throw new Error('Gemini API key not set — open Settings to add it');

    const context = buildExtractionContext(jdText, pageUrl);
    const hasJD   = jdText && jdText.trim().length > 50;

    const prompt = `You are a precise job-posting parser. Extract the company name and job title.

RULES:
- Return ONLY valid JSON: {"company_name":"...","job_title":"..."}
- No markdown, no explanation, no extra keys.
- company_name: the actual HIRING COMPANY (never a job board like LinkedIn, Indeed, Glassdoor, Naukri, Internshala, Monster, Simplify, Wellfound).
- job_title: the exact role title (e.g. "Senior Data Engineer", "Product Manager").
- If a value truly cannot be determined, use "" — never guess randomly.

EXTRACTION PRIORITY (highest to lowest):
${hasJD ? `1. [JD TEXT company hint] and [VERIFIED DOM COMPANY] — these are highly reliable.
2. Read [JOB DESCRIPTION TEXT] carefully — company name and job title are typically mentioned in the first few lines.
3. [PAGE structured data] — only reliable if the user is on the actual job posting page.
4. [PAGE title/H1] and [PAGE hostname hint] — low reliability, use as last resort only.` :
`1. [VERIFIED DOM COMPANY/TITLE] — extremely reliable, trust this implicitly.
2. [PAGE structured data company/title] — highly reliable.
3. [PAGE title/H1] — parse carefully, strip "| LinkedIn" etc.
4. [PAGE hostname hint] — last resort for company name.`}

IMPORTANT: The user may have copied the JD from one page and is now on a DIFFERENT page. In that case, [PAGE signals] will be WRONG unless it's a [VERIFIED DOM COMPANY]. Always trust [JD TEXT] signals over general [PAGE] signals when they conflict.

Strip from job_title: location, salary, "Jobs", "Careers", "| LinkedIn", "at CompanyName".
Capitalize company_name properly if it appears in all-lowercase.

CONTEXT:
${context}`;

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200 },
        }),
      }
    );
    if (!res.ok) throw new Error('Gemini API error: ' + res.status);
    const data = await res.json();
    let raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '{}')
      .replace(/```json|```/g, '').trim();

    // Extract JSON object from raw string
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) raw = raw.slice(jsonStart, jsonEnd + 1);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      const cn = raw.match(/"company_name"\s*:\s*"([^"]*)"/)?.[1] || '';
      const jt = raw.match(/"job_title"\s*:\s*"([^"]*)"/)?.[1]    || '';
      parsed = { company_name: cn, job_title: jt };
    }

    // ── Post-processing fallbacks ──
    const sig   = scrapePageSignals();
    const jdSig = parseJdTextSignals(jdText);

    // If we have precise domain extraction, trust it over Gemini for company name
    if (sig.preciseDomain && sig.company) {
      if (!parsed.company_name || parsed.company_name !== sig.company) {
        parsed.company_name = sig.company;
      }
    }

    // If Gemini returned a job board as the company, override with JD signals first
    const JOB_BOARDS = /^(linkedin|indeed|glassdoor|naukri|monster|ziprecruiter|dice|simplyhired|hired\.com|wellfound|angel\.co|internshala|simplify|greenhouse|lever|workday|workable|breezy|ashby|dover)$/i;
    if (!parsed.company_name || JOB_BOARDS.test(parsed.company_name.trim())) {
      parsed.company_name = jdSig.company || sig.company || sig.domCompany || sig.ogSiteName || '';
    }

    // If title is empty, use JD pre-parsed title first, then structured data
    if (!parsed.job_title) {
      parsed.job_title = jdSig.jobTitle || sig.jobTitle || '';
    }
    // Last resort: parse page title
    if (!parsed.job_title && sig.rawTitle) {
      parsed.job_title = sig.rawTitle
        .replace(/\s*[\|\-–—]\s*(linkedin|indeed|glassdoor|naukri|careers|jobs|internshala).*/i, '')
        .replace(/\s*(at|@)\s+[\w\s]+$/, '')
        .trim()
        .substring(0, 120);
    }

    // Capitalize company name if all-lowercase
    if (parsed.company_name && parsed.company_name === parsed.company_name.toLowerCase()) {
      parsed.company_name = parsed.company_name.replace(/\b\w/g, c => c.toUpperCase());
    }

    // Strip "at CompanyName" from job title if it snuck in
    if (parsed.job_title && parsed.company_name) {
      parsed.job_title = parsed.job_title
        .replace(new RegExp(`\\s*at\\s+${parsed.company_name}\\s*$`, 'i'), '')
        .trim();
    }

    parsed.url = pageUrl;
    return parsed;
  }


  async function runExtract() {
    const statusEl = document.getElementById('rjd-extract-status');
    if (!statusEl) return;

    const extractBtn = document.getElementById('rjd-extract-btn');
    statusEl.textContent = '⏳ Extracting...';
    if (extractBtn) { extractBtn.disabled = true; extractBtn.style.opacity = '0.7'; extractBtn.textContent = '⏳ Extracting...'; }
    try {
      let clipText = '';
      try { clipText = await navigator.clipboard.readText(); } catch(e) {}

      if (!clipText.trim()) {
        statusEl.textContent = '⚡ No clipboard text — using page signals...';
      }

      const result = await extractWithGemini(clipText, window.location.href);

      document.getElementById('rjd-new-company').value = result.company_name || '';
      document.getElementById('rjd-new-title').value   = result.job_title   || '';
      document.getElementById('rjd-new-url').value     = result.url         || '';
      document.getElementById('rjd-new-jd').value      = clipText;

      const gotBoth    = result.company_name && result.job_title;
      const gotPartial = result.company_name || result.job_title;
      if (gotBoth) {
        statusEl.textContent = '✓ Extracted — review and save';
        statusEl.style.color = 'rgba(255,255,255,0.9)';
      } else if (gotPartial) {
        statusEl.textContent = '⚠ Partially extracted — fill missing field';
        statusEl.style.color = '#fde68a';
      } else {
        statusEl.textContent = 'Could not extract — fill in manually';
        statusEl.style.color = '#fca5a5';
      }
      if (extractBtn) { extractBtn.disabled = false; extractBtn.style.opacity = '1'; extractBtn.innerHTML = '<span style="font-size:16px;">✦</span> Extract from Clipboard + Page URL'; }
      setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 5000);
    } catch(err) {
      statusEl.textContent = '✕ ' + (err.message || 'Extraction failed');
      statusEl.style.color = '#fca5a5';
      if (extractBtn) { extractBtn.disabled = false; extractBtn.style.opacity = '1'; extractBtn.innerHTML = '<span style="font-size:16px;">✦</span> Extract from Clipboard + Page URL'; }
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

          <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;">
            <button id="rjd-settings-back-btn" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;backdrop-filter:blur(8px);font-family:inherit;">← Back</button>
            <span style="font-size:14px;font-weight:700;color:#fff;">Settings</span>
          </div>

          <div style="flex:1;display:flex;overflow:hidden;">

            <!-- NAV -->
            <div style="width:140px;background:var(--bg-secondary,#f8fafc);border-right:1px solid var(--border-color,#e2e8f0);flex-shrink:0;overflow-y:auto;padding:8px 0;">
              <div style="font-size:9px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;letter-spacing:0.8px;padding:8px 14px 4px;">General</div>
              <div class="rjd-settings-nav-item ${activeSection==='apikey'?'rjd-snav-active':''}" data-sec="apikey">🔑 API Key</div>
              <div class="rjd-settings-nav-item ${activeSection==='resumeprofile'?'rjd-snav-active':''}" data-sec="resumeprofile">📄 Resume Profile</div>
              <div style="font-size:9px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;letter-spacing:0.8px;padding:12px 14px 4px;">Info</div>
              <div class="rjd-settings-nav-item ${activeSection==='shortcuts'?'rjd-snav-active':''}" data-sec="shortcuts">⌨️ Shortcuts</div>
              <div class="rjd-settings-nav-item ${activeSection==='privacy'?'rjd-snav-active':''}" data-sec="privacy">🛡️ Privacy</div>
              <div class="rjd-settings-nav-item ${activeSection==='about'?'rjd-snav-active':''}" data-sec="about">ℹ️ About</div>
            </div>

            <!-- CONTENT -->
            <div id="rjd-settings-panel" style="flex:1;overflow-y:auto;padding:18px;"></div>
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
          <div style="font-size:15px;font-weight:700;color:var(--text-primary,#1e293b);margin-bottom:4px;">Gemini API Key</div>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-bottom:14px;">Powers AI extraction. Free key from Google.</div>
          <div style="background:var(--accent-light,#eef2ff);border:1px solid var(--accent-border,#c7d2fe);border-radius:8px;padding:12px;margin-bottom:16px;font-size:11px;color:var(--accent-primary,#4f46e5);line-height:1.6;">
            Your key is stored only in your browser. It is sent directly to Google Gemini — never to any other server.
          </div>
          <div id="rjd-sk-msg"></div>
          <label style="font-size:10px;font-weight:700;color:var(--text-muted,#94a3b8);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:5px;">API Key</label>
          <input type="password" id="rjd-sk-input" placeholder="AIzaSy..." style="width:100%;padding:10px 12px;border:1.5px solid var(--border-color,#e2e8f0);border-radius:8px;font-size:12px;font-family:inherit;background:var(--bg-primary,#fff) !important;color:var(--text-primary,#1e293b) !important;margin-bottom:10px;"/>
          <div style="display:flex;gap:8px;margin-bottom:16px;">
            <button id="rjd-sk-show" style="padding:8px 14px;border:1px solid var(--border-color,#e2e8f0);border-radius:8px;font-size:11px;cursor:pointer;background:var(--bg-secondary,#f8fafc);color:var(--text-muted,#94a3b8);font-family:inherit;transition:all 0.2s;">Show</button>
            <button id="rjd-sk-save" class="rjd-primary-btn" style="flex:1;padding:8px;">Save Key</button>
          </div>
          <div style="border-top:1px solid var(--border-light,#f1f5f9);padding-top:14px;">
            <div style="font-size:12px;font-weight:600;color:var(--text-primary,#1e293b);margin-bottom:8px;">How to get a free key:</div>
            <div style="font-size:12px;color:var(--text-secondary,#475569);line-height:1.8;">
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


      } else if (sec === 'resumeprofile') {
        const p = JSON.parse(localStorage.getItem('rjd_resume_profile') || '{}');
        panel.innerHTML = `
          <div style="font-size:15px;font-weight:700;color:var(--text-primary,#1e293b);margin-bottom:4px;">Resume Personal Profile</div>
          <div style="font-size:12px;color:var(--text-muted,#94a3b8);margin-bottom:14px;">These details are used to auto-fill your generated resumes.</div>
          <div id="rjd-rp-msg"></div>
          
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div><label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Full Name</label><input type="text" id="rp-name" class="rjd-sidebar-input" value="${escHtml(p.name||'')}" style="width:100%;padding:6px;font-size:11px;"/></div>
            <div><label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Title</label><input type="text" id="rp-title" class="rjd-sidebar-input" value="${escHtml(p.title||'')}" style="width:100%;padding:6px;font-size:11px;"/></div>
            <div><label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Email</label><input type="email" id="rp-email" class="rjd-sidebar-input" value="${escHtml(p.email||'')}" style="width:100%;padding:6px;font-size:11px;"/></div>
            <div><label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Phone</label><input type="text" id="rp-phone" class="rjd-sidebar-input" value="${escHtml(p.phone||'')}" style="width:100%;padding:6px;font-size:11px;"/></div>
            <div><label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Location</label><input type="text" id="rp-location" class="rjd-sidebar-input" value="${escHtml(p.location||'')}" style="width:100%;padding:6px;font-size:11px;"/></div>
            <div><label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">LinkedIn</label><input type="text" id="rp-linkedin" class="rjd-sidebar-input" value="${escHtml(p.linkedin||'')}" style="width:100%;padding:6px;font-size:11px;"/></div>
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">🎓 Education (Degree | Year | Uni | Country)</label>
            <textarea id="rp-education" class="rjd-sidebar-input" rows="2" style="width:100%;padding:6px;font-size:11px;resize:none;">${escHtml(p.education||'')}</textarea>
          </div>

          <div style="margin-bottom:12px;">
            <label style="font-size:9px;font-weight:700;color:var(--text-muted);text-transform:uppercase;">📜 Certifications (one per line)</label>
            <textarea id="rp-certs" class="rjd-sidebar-input" rows="2" style="width:100%;padding:6px;font-size:11px;resize:none;">${escHtml(p.certs||'')}</textarea>
          </div>

          <button id="rjd-rp-save" class="rjd-primary-btn" style="width:100%;padding:10px;font-weight:700;">Save Personal Profile</button>
        `;

        document.getElementById('rjd-rp-save').addEventListener('click', () => {
          const profile = {
            name: document.getElementById('rp-name').value.trim(),
            title: document.getElementById('rp-title').value.trim(),
            email: document.getElementById('rp-email').value.trim(),
            phone: document.getElementById('rp-phone').value.trim(),
            location: document.getElementById('rp-location').value.trim(),
            linkedin: document.getElementById('rp-linkedin').value.trim(),
            education: document.getElementById('rp-education').value.trim(),
            certs: document.getElementById('rp-certs').value.trim()
          };
          localStorage.setItem('rjd_resume_profile', JSON.stringify(profile));
          const msg = document.getElementById('rjd-rp-msg');
          msg.innerHTML = `<div style="padding:7px;background:#f0fff4;color:#276749;border:1px solid #c6f6d5;border-radius:6px;font-size:11px;margin-bottom:10px;text-align:center;">Profile saved ✓</div>`;
          setTimeout(() => { if (msg) msg.innerHTML = ''; }, 3000);
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
              <span style="color:#718096;">AI Model</span><span style="font-weight:600;color:#1a202c;">Gemini 1.5 Flash</span>
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
    if (progText) progText.style.color = done >= target ? '#059669' : '';
    if (progBar)  { progBar.style.width = pct + '%'; }
    if (targSel)  targSel.value = String(target);
  }

  // ── TABLE ──
  function updateTrackBadge() {
    const badge = document.getElementById('rjd-toggle-badge');
    if (!badge) return;
    const todayCount = applications.filter(a => a.dateKey === todayKey()).length;
    badge.style.display = todayCount > 0 ? 'flex' : 'none';
    badge.textContent = todayCount > 99 ? '99+' : todayCount;
    // Tooltip so user knows what it means
    const icon = document.getElementById('rjd-toggle-icon');
    if (icon) icon.title = todayCount + ' application' + (todayCount !== 1 ? 's' : '') + ' today';
  }

  function getFiltered() {
    let list = [...applications];
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus);
    if (filterDate) list = list.filter(a => {
      if (!a.dateKey) return false;
      return a.dateKey === filterDate;
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
      const safeUrl = app.url && /^https?:\/\//i.test(app.url) ? app.url : null;
      const addBtn    = `<button class="rjd-add-resume-btn" data-id="${app.id}" title="Paste resume from clipboard" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color,#e2e8f0);background:var(--bg-secondary,#f8fafc);color:${app.resume?'#059669':'var(--accent-primary,#4f46e5)'};cursor:pointer;font-size:10px;font-weight:600;font-family:inherit;">${app.resume?'✓ Update':'+ Add'}</button>`;
      const dlBtn     = `<button class="rjd-dl-resume-btn" data-id="${app.id}" title="Download tailored resume" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color,#e2e8f0);background:var(--bg-secondary,#f8fafc);color:var(--text-primary,#1e293b);cursor:pointer;font-size:11px;font-family:inherit;${!app.resume?'opacity:0.4;pointer-events:none;':''}">📥</button>`;
      const urlBtn    = safeUrl    ? `<a href="${escHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="rjd-url-link">Open</a>` : `<span class="rjd-no-resume">—</span>`;
      const isOverdue = app.followUpDate && app.followUpDate < todayKey().slice(0,10) && app.status !== 'Offer' && app.status !== 'Rejected';
      const followUpBadge = app.followUpDate ? `<div style="font-size:9px;color:${isOverdue?'#dc2626':'#94a3b8'};margin-top:1px;">${isOverdue?'⚠ ':'📅 '}${app.followUpDate}</div>` : '';
      // Status chip (click to cycle)
      const shortStatus = { 'Applied':'Applied','Interview Scheduled':'Interview','Interview Done':'Done','Offer':'Offer','Rejected':'Rejected','Skipped':'Skipped' };
      const statusChip = `<button class="rjd-status-chip-btn" data-id="${app.id}" style="background:${sc.bg};color:${sc.color};border:1.5px solid ${sc.color}33;padding:4px 9px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all 0.15s;letter-spacing:0.1px;" title="Click to change status">${shortStatus[app.status]||app.status} ▾</button>`;
      return `<tr class="rjd-row" data-id="${app.id}" style="${isOverdue?'background:#fff5f5 !important;':''}">
        <td class="rjd-td rjd-td-sno">${idx+1}</td>
        <td class="rjd-td rjd-td-company"><div>${escHtml(app.company||'—')}</div>${followUpBadge}</td>
        <td class="rjd-td rjd-td-title">${escHtml(app.jobTitle||'—')}</td>
        <td class="rjd-td rjd-td-url">${urlBtn}</td>
        <td class="rjd-td rjd-td-add">${addBtn}</td>
        <td class="rjd-td rjd-td-dl">${dlBtn}</td>
        <td class="rjd-td rjd-td-date">${escHtml(app.date||'—')}</td>
        <td class="rjd-td rjd-td-status">${statusChip}</td>
      </tr>`;
    }).join('');

    // Event Listeners
    tbody.querySelectorAll('.rjd-status-chip-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const app = applications.find(a => a.id === btn.dataset.id);
        if (!app) return;
        const idx = STATUSES.indexOf(app.status);
        const next = STATUSES[(idx + 1) % STATUSES.length];
        app.status = next;
        await dbUpdateApp(app);
        renderTable();
        showToast('Status → ' + next);
      });
    });

    tbody.querySelectorAll('.rjd-add-resume-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); saveResumeFromClipboard(btn.dataset.id); });
    });

    tbody.querySelectorAll('.rjd-dl-resume-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const app = applications.find(a=>a.id===btn.dataset.id);
        if (app && app.resume) {
          const old = btn.textContent;
          btn.textContent = '⏳'; btn.disabled = true;
          try {
            await generateIntegratedResume(app);
            showToast('Resume downloaded ✓');
          } catch (err) {
            console.error(err);
            showToast('Download failed: ' + err.message, true);
          } finally {
            btn.textContent = old; btn.disabled = false;
          }
        }
      });
    });

    tbody.querySelectorAll('.rjd-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (['rjd-status-chip-btn','rjd-add-resume-btn','rjd-dl-resume-btn','rjd-url-link'].some(c=>e.target.classList.contains(c))) return;
        const app = applications.find(a=>a.id===row.dataset.id);
        if (app) showAppDetail(app);
      });
    });
  }

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

      // Wire status chips — select "Applied" by default
      const statusInput = document.getElementById('rjd-new-status');
      panel.querySelectorAll('.rjd-status-chip').forEach(chip => {
        if (chip.dataset.val === 'Applied') {
          chip.style.background  = '#eef2ff';
          chip.style.borderColor = '#4f46e5';
          chip.style.color       = '#4f46e5';
        }
        chip.onclick = () => {
          statusInput.value = chip.dataset.val;
          panel.querySelectorAll('.rjd-status-chip').forEach(c => {
            c.style.background  = '#f8fafc';
            c.style.borderColor = '#e2e8f0';
            c.style.color       = '#64748b';
          });
          chip.style.background  = '#eef2ff';
          chip.style.borderColor = '#4f46e5';
          chip.style.color       = '#4f46e5';
        };
      });

      // Input focus glow
      panel.querySelectorAll('input[type=text],input[type=url],textarea').forEach(el => {
        el.onfocus = () => { el.style.borderColor = '#4f46e5'; el.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.12)'; };
        el.onblur  = () => { el.style.borderColor = '#e2e8f0'; el.style.boxShadow = 'none'; };
      });

      // Extract button hover
      const eb = document.getElementById('rjd-extract-btn');
      if (eb) {
        eb.onmouseenter = () => { eb.style.transform = 'translateY(-1px)'; eb.style.boxShadow = '0 6px 20px rgba(79,70,229,0.4)'; };
        eb.onmouseleave = () => { eb.style.transform = ''; eb.style.boxShadow = '0 4px 16px rgba(79,70,229,0.3)'; };
      }

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
      if (v) { urlLink.href = v; urlLink.style.opacity = '1'; urlLink.style.pointerEvents = 'auto'; }
      else   { urlLink.href = '#'; urlLink.style.opacity = '0.4'; urlLink.style.pointerEvents = 'none'; }
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
              <div class="rjd-toolbar-avatar">${escHtml(initials)}</div>
              <span id="rjd-username-display">${escHtml(currentUser.name)}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button id="rjd-quick-extract-btn" class="rjd-primary-btn" style="font-size:11px;padding:6px 12px;white-space:nowrap;">✦ Extract & Save</button>
              <button id="rjd-new-app-btn" class="rjd-primary-btn" style="background:var(--bg-secondary,#f8fafc);color:var(--accent-primary,#4f46e5);border:1.5px solid var(--accent-border,#c7d2fe);box-shadow:none;">+ New</button>
              <button id="rjd-refresh-btn" title="Refresh" style="background:var(--bg-secondary,#f8fafc);border:1px solid var(--border-color,#e2e8f0);color:var(--text-muted,#94a3b8);font-size:14px;cursor:pointer;padding:6px 8px;border-radius:8px;line-height:1;transition:all 0.2s;">↻</button>
              <button id="rjd-settings-btn" title="Settings" style="background:var(--bg-secondary,#f8fafc);border:1px solid var(--border-color,#e2e8f0);color:var(--text-muted,#94a3b8);font-size:14px;cursor:pointer;padding:6px 8px;border-radius:8px;line-height:1;transition:all 0.2s;">⚙</button>
            </div>
          </div>

          <div id="rjd-stats"></div>

          <!-- Session Bar -->
          <div id="rjd-session-bar">
            <div class="rjd-session-row">
              <span class="rjd-session-label">📅 Session:</span>
              <input type="date" id="rjd-working-date-input" class="rjd-session-input" max="${todayISO()}"/>
              <button id="rjd-working-date-today" class="rjd-session-btn">Today</button>
            </div>
            <div class="rjd-session-row">
              <span class="rjd-session-label">🎯 Target:</span>
              <select id="rjd-target-select" class="rjd-session-input">
                ${[10,15,20,25,30,35,40,50].map(n=>`<option value="${n}">${n} applications</option>`).join('')}
              </select>
              <span id="rjd-session-progress" style="font-weight:700;white-space:nowrap;color:var(--accent-primary,#4f46e5);font-size:12px;">0/30</span>
            </div>
            <div id="rjd-progress-bar-wrap">
              <div id="rjd-progress-bar"></div>
            </div>
          </div>

          <div id="rjd-filters">
            <input type="text" id="rjd-search-input" placeholder="Search company or title..." />
            <select id="rjd-status-filter">
              <option value="all">All Statuses</option>
              ${STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}
            </select>
            <input type="date" id="rjd-date-filter" title="Filter by date" value="${filterDate || ''}" max="${todayISO()}" />
            <button id="rjd-export-csv-btn" title="Export Excel">Export XLSX</button>
          </div>

          <div id="rjd-table-wrap">
            <table id="rjd-table">
              <thead>
                <tr>
                  <th class="rjd-th" style="width:24px;">#</th>
                  <th class="rjd-th">Company</th>
                  <th class="rjd-th">Job Title</th>
                  <th class="rjd-th">URL</th>
                  <th class="rjd-th" title="Add Resume from Clipboard">Add</th>
                  <th class="rjd-th" title="Download Tailored Resume">DL</th>
                  <th class="rjd-th">Date</th>
                  <th class="rjd-th">Status</th>
                </tr>
              </thead>
              <tbody id="rjd-tbody"></tbody>
            </table>
          </div>
        </div>

        <div id="rjd-new-app-panel" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
          <!-- Panel Header -->
          <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:14px 18px;display:flex;align-items:center;gap:10px;flex-shrink:0;position:relative;overflow:hidden;">
            <div style="position:absolute;top:-20px;right:-10px;width:70px;height:70px;background:rgba(255,255,255,0.07);border-radius:50%;"></div>
            <button id="rjd-new-back" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600;backdrop-filter:blur(8px);transition:all 0.2s;flex-shrink:0;">← Back</button>
            <div style="flex:1;">
              <div style="font-size:15px;font-weight:700;color:#fff;letter-spacing:-0.2px;">New Application</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:1px;" id="rjd-extract-status"></div>
            </div>
          </div>

          <!-- Scrollable Body -->
          <div style="flex:1;overflow-y:auto;padding:18px 18px 24px;">

            <!-- Extract Button -->
            <button id="rjd-extract-btn" style="width:100%;padding:14px 16px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 16px rgba(79,70,229,0.3);transition:all 0.2s;letter-spacing:0.1px;">
              <span style="font-size:16px;">✦</span> Extract from Clipboard + Page URL
            </button>

            <!-- Divider -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
              <div style="flex:1;height:1px;background:#e2e8f0;"></div>
              <span style="font-size:11px;color:#94a3b8;font-weight:600;white-space:nowrap;">OR FILL MANUALLY</span>
              <div style="flex:1;height:1px;background:#e2e8f0;"></div>
            </div>

            <!-- Company + Title side-by-side -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
              <div>
                <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Company Name</label>
                <input type="text" id="rjd-new-company" placeholder="e.g. Google" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;font-family:inherit;background:#fff !important;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;outline:none;transition:border-color 0.2s,box-shadow 0.2s;"/>
              </div>
              <div>
                <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Job Title</label>
                <input type="text" id="rjd-new-title" placeholder="e.g. Data Analyst" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;font-family:inherit;background:#fff !important;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;outline:none;transition:border-color 0.2s,box-shadow 0.2s;"/>
              </div>
            </div>

            <!-- Status -->
            <div style="margin-bottom:14px;">
              <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Status</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${STATUSES.map(s => `<button class="rjd-status-chip" data-val="${s}" style="padding:6px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1.5px solid #e2e8f0;background:#f8fafc;color:#64748b;font-family:inherit;transition:all 0.15s;">${s}</button>`).join('')}
              </div>
              <input type="hidden" id="rjd-new-status" value="Applied"/>
            </div>

            <!-- Job URL -->
            <div style="margin-bottom:14px;">
              <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Job URL</label>
              <input type="url" id="rjd-new-url" placeholder="Auto-filled or paste manually" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:13px;font-family:inherit;background:#fff !important;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;outline:none;transition:border-color 0.2s,box-shadow 0.2s;"/>
            </div>

            <!-- Job Description -->
            <div style="margin-bottom:20px;">
              <label style="display:block;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Job Description</label>
              <textarea id="rjd-new-jd" placeholder="Auto-filled from clipboard, or paste JD here..." rows="6" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-size:12px;font-family:inherit;background:#fff !important;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;resize:vertical;outline:none;line-height:1.6;transition:border-color 0.2s,box-shadow 0.2s;"></textarea>
            </div>

            <!-- Save Button -->
            <button id="rjd-save-app-btn" style="width:100%;padding:13px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(79,70,229,0.3);transition:all 0.2s;letter-spacing:-0.1px;">
              💾 Save Application
            </button>

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

    // Save new app — loading guard prevents double-submit (#17)
    let _saving = false;
    document.getElementById('rjd-save-app-btn').addEventListener('click', async () => {
      if (_saving) return;
      const company  = document.getElementById('rjd-new-company').value.trim();
      const jobTitle = document.getElementById('rjd-new-title').value.trim();
      const url      = document.getElementById('rjd-new-url').value.trim();
      const jd       = document.getElementById('rjd-new-jd').value.trim();
      const status   = document.getElementById('rjd-new-status')?.value || 'Applied';
      if (!company && !jobTitle) { showToast('Enter at least company or job title', true); return; }
      const dupByUrl   = url && applications.find(a => a.url && a.url === url);
      const dupByTitle = company && jobTitle && applications.find(a =>
        a.company?.toLowerCase().trim() === company.toLowerCase() &&
        a.jobTitle?.toLowerCase().trim() === jobTitle.toLowerCase()
      );
      if (dupByUrl)   { showToast('Already saved: ' + (dupByUrl.company || dupByUrl.jobTitle), true); return; }
      if (dupByTitle) { showToast('Possible duplicate: ' + dupByTitle.company + ' — ' + dupByTitle.jobTitle, true); return; }
      _saving = true;
      const saveBtn = document.getElementById('rjd-save-app-btn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving...'; }
      const app = {
        id: crypto.randomUUID(), company, jobTitle, url, jd, resume: '',
        status, date: today(), dateRaw: new Date().toISOString(), dateKey: todayKey(), notes: ''
      };
      const ok = await dbSaveApp(app);
      _saving = false;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '💾 Save Application'; }
      if (ok) {
        applications.push(app);
        hideNewAppPanel();
        renderTable();
        showToast('✓ Application saved — ' + company);
      } else { showToast('Save failed — check connection', true); }
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

    // Export XLSX — inject xlsxbuilder.js on demand (fix #9: removed from content_scripts to avoid global scope pollution)
    document.getElementById('rjd-export-csv-btn').addEventListener('click', async () => {
      if (applications.length === 0) { showToast('No applications to export', true); return; }
      // Lazy-load xlsxbuilder if not already present
      if (typeof window.buildXLSX !== 'function') {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = chrome.runtime.getURL('lib/xlsxbuilder.js');
          s.onload = resolve;
          s.onerror = () => reject(new Error('Failed to load xlsxbuilder.js'));
          document.head.appendChild(s);
        });
      }
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
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
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

    // ── FLOATING TRACK BUTTON ──
    const toggle = document.createElement('div');
    toggle.id = 'rjd-toggle';
    toggle.innerHTML = `
      <div id="rjd-toggle-icon" style="width:52px;height:52px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(79,70,229,0.4);cursor:pointer;transition:all 0.2s;position:relative;">
        <img src="${(typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.getURL('icons/icon128.png') : ''}" style="width:26px; height:26px; object-fit:contain; border-radius:6px; pointer-events:none;"/>
        <div id="rjd-toggle-badge" style="display:none;position:absolute;top:-4px;right:-4px;background:#dc2626;color:#fff;border-radius:50%;width:20px;height:20px;font-size:10px;font-weight:800;align-items:center;justify-content:center;border:2px solid #fff;">0</div>
      </div>
      <div id="rjd-queue-badge" style="display:none;position:absolute;bottom:-4px;right:-4px;background:#f59e0b;color:#fff;border-radius:50%;width:18px;height:18px;font-size:9px;font-weight:800;align-items:center;justify-content:center;border:2px solid #fff;">0</div>
    `;
    // Draggable positioning (slide up/down on the right edge)
    let _isDragging = false, _startY = 0, _startTop = 0;
    let _toggleTop = window.innerHeight / 2 - 26; // initial vertical center
    toggle.style.cssText = `position:fixed!important;right:12px!important;top:${_toggleTop}px;z-index:2147483647!important;cursor:grab;user-select:none;`;

    toggle.addEventListener('mousedown', (e) => {
      _isDragging = false;
      _startY = e.clientY;
      _startTop = _toggleTop;
      const onMove = (em) => {
        const dy = em.clientY - _startY;
        if (Math.abs(dy) > 4) _isDragging = true;
        _toggleTop = Math.max(10, Math.min(window.innerHeight - 70, _startTop + dy));
        toggle.style.top = _toggleTop + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        toggle.style.cursor = 'grab';
        if (!_isDragging) handleToggleClick();
        // Persist position safely
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
            const s3 = chromeStore();
            if (s3) s3.set({ rjd_toggle_top: _toggleTop });
          }
        } catch(e) {}
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Touch drag support
    toggle.addEventListener('touchstart', (e) => {
      _isDragging = false;
      _startY = e.touches[0].clientY;
      _startTop = _toggleTop;
    }, { passive: true });
    toggle.addEventListener('touchmove', (e) => {
      const dy = e.touches[0].clientY - _startY;
      if (Math.abs(dy) > 4) _isDragging = true;
      _toggleTop = Math.max(10, Math.min(window.innerHeight - 70, _startTop + dy));
      toggle.style.top = _toggleTop + 'px';
    }, { passive: true });
    toggle.addEventListener('touchend', () => { if (!_isDragging) handleToggleClick(); });

    function handleToggleClick() {
      if (!currentUser) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          window.open(chrome.runtime.getURL('pages/app.html'), '_blank');
        }
        return;
      }
      sidebar.classList.toggle('open');
      if (!sidebar.classList.contains('open')) return;
      if (applications.length > 0) { renderTrackerScreen(); return; }
      showLoading('Loading...');
      dbLoadApps().then(apps => { applications = apps; renderTrackerScreen(); }).catch(() => renderTrackerScreen());
    }

    // Restore saved position
    const s2b = chromeStore();
    if (s2b) s2b.get('rjd_toggle_top', r => {
      if (r.rjd_toggle_top) { _toggleTop = r.rjd_toggle_top; toggle.style.top = _toggleTop + 'px'; }
    });

    // Hover effect
    const icon = toggle.querySelector('#rjd-toggle-icon');
    toggle.addEventListener('mouseenter', () => { if (icon) icon.style.transform = 'scale(1.1)'; });
    toggle.addEventListener('mouseleave', () => { if (icon) icon.style.transform = ''; });
    
    // External open hook for popup/keyboard shortcut
    toggle.addEventListener('rjd-external-open', handleToggleClick);

    document.body.appendChild(toggle);

    const toast = document.createElement('div');
    toast.id = 'rjd-toast';
    document.body.appendChild(toast);

    document.getElementById('rjd-close').addEventListener('click', () => sidebar.classList.remove('open'));

    // Flush offline queue on load
    setTimeout(() => flushQueue(), 2000);
    // Check for existing queue items
    getQueue(q => updateQueueBadge(q.length));
  }

  // ── KEYBOARD SHORTCUTS ──
  // Listen for commands forwarded from background.js via CustomEvent
  window.addEventListener('rjd-command', (e) => {
    const action  = e.detail && e.detail.action;
    const sidebar = document.getElementById('rjd-sidebar');
    const isOpen  = sidebar && sidebar.classList.contains('open');
    if (action === 'toggle_sidebar') {
      const tg = document.getElementById('rjd-toggle');
      if (tg) tg.dispatchEvent(new Event('rjd-external-open'));
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
    if (sess && sess.token && sess.user) {
      sessionToken        = sess.token;
      sessionRefreshToken = sess.refreshToken || '';
      currentUser         = sess.user;
      loadGeminiKey(k => { GEMINI_KEY = k || ''; });
      filterDate          = todayISO(); // Default to today in the list
      if (tog) tog.classList.add('rjd-visible');
      updateTrackBadge();
      // Preload apps silently
      dbLoadApps().then(apps => { applications = apps; updateTrackBadge(); }).catch(() => {});
      // Proactive refresh every 50m
      if (!window._rjdRefreshTimer) {
        window._rjdRefreshTimer = setInterval(() => refreshSession(), 50 * 60 * 1000);
      }
    } else {
      currentUser = null;
      applications = [];
      if (tog) tog.classList.remove('rjd-visible');
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

  // Fallback poll every 3 seconds
  if (hasChromeStorage) {
    const _poll = setInterval(() => {
      try {
        // Stop polling if extension context is gone (happens after extension reload)
        if (!chrome.runtime || !chrome.runtime.id) { clearInterval(_poll); return; }
        chrome.storage.local.get('rjd_session', r => {
          if (chrome.runtime.lastError) { clearInterval(_poll); return; }
          const sess = r.rjd_session || null;
          if (sess && sess.token && sess.user && !currentUser) {
            applySession(sess);
          } else if ((!sess || !sess.token) && currentUser) {
            applySession(null);
          }
        });
      } catch(e) { clearInterval(_poll); }
    }, 3000);
  }

  // -- INTEGRATED RESUME ENGINE --
  async function generateIntegratedResume(app) {
    const p = JSON.parse(localStorage.getItem('rjd_resume_profile') || '{}');
    if (!p.name) {
      showToast('Please fill out your Resume Profile in Settings first!', true);
      renderSettingsScreen('tracker');
      return;
    }
    try {
      if (window.ResumeEngine) {
        await window.ResumeEngine.generate(app, p);
      } else {
        showToast('Resume engine not loaded. Please refresh.', true);
      }
    } catch (err) {
      console.error(err);
      showToast('Download failed: ' + err.message, true);
    }
  }

})();