window.rjdTemplates = {
  trackerScreen: function({ initials, name, todayISO, filterDate, STATUSES }) {
    return `
      <div id="rjd-tracker-wrap">
        <div id="rjd-main" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
          <div id="rjd-toolbar">
            <div class="rjd-toolbar-left">
              <div class="rjd-toolbar-avatar">${initials}</div>
              <span id="rjd-username-display">${name}</span>
            </div>
            <div style="display:flex;gap:6px;">
              <button id="rjd-quick-extract-btn" class="rjd-primary-btn" style="font-size:11px;padding:6px 12px;white-space:nowrap;">✦ Extract & Save</button>
              <button id="rjd-new-app-btn" class="rjd-primary-btn" style="background:var(--bg-secondary,#f8fafc);color:var(--accent-primary,#4f46e5);border:1.5px solid var(--accent-border,#c7d2fe);box-shadow:none;">+ New</button>
              <button id="rjd-refresh-btn" title="Refresh" style="background:var(--bg-secondary,#f8fafc);border:1px solid var(--border-color,#e2e8f0);color:var(--text-muted,#94a3b8);font-size:14px;cursor:pointer;padding:6px 8px;border-radius:8px;line-height:1;transition:all 0.2s;">↻</button>
              <button id="rjd-settings-btn" title="Settings" style="background:var(--bg-secondary,#f8fafc);border:1px solid var(--border-color,#e2e8f0);color:var(--text-muted,#94a3b8);font-size:14px;cursor:pointer;padding:6px 8px;border-radius:8px;line-height:1;transition:all 0.2s;">⚙</button>
            </div>
          </div>

          <div id="rjd-stats"></div>

          <div id="rjd-session-bar">
            <div class="rjd-session-row" style="margin-bottom:0;">
              <span title="Session Date">📅</span>
              <input type="date" id="rjd-working-date-input" class="rjd-session-input" style="flex:1;" max="${todayISO}"/>
              <button id="rjd-working-date-today" style="background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;padding:3px;font-size:10px;cursor:pointer;">T</button>
              <div style="width:8px;"></div>
              <span title="Target Applications">🎯</span>
              <input type="number" id="rjd-target-select" class="rjd-session-input" style="width:45px;padding:5px;" min="1" max="999" value="30" />
              <span id="rjd-session-progress" style="font-weight:700;white-space:nowrap;color:var(--accent-primary,#4f46e5);font-size:12px;">0/30</span>
            </div>
            <div id="rjd-progress-bar-wrap"><div id="rjd-progress-bar"></div></div>
          </div>

          <div id="rjd-filters">
            <input type="text" id="rjd-search-input" placeholder="Search company or title..." />
            <select id="rjd-status-filter">
              <option value="all">All Statuses</option>
              ${STATUSES.map(s => "<option value='" + s + "'>" + s + "</option>").join('')}
            </select>
            <input type="date" id="rjd-date-filter" title="Filter by date" value="${filterDate || ''}" max="${todayISO}" />
            <button id="rjd-export-csv-btn" title="Export Excel">Export XLSX</button>
          </div>

          <div id="rjd-table-wrap">
            <table id="rjd-table">
              <thead>
                <tr><th class="rjd-th">#</th><th class="rjd-th">Company</th><th class="rjd-th">Job Title</th><th class="rjd-th">URL</th><th class="rjd-th">Resume</th><th class="rjd-th">DL</th><th class="rjd-th">Date</th><th class="rjd-th">Status</th></tr>
              </thead>
              <tbody id="rjd-tbody"></tbody>
            </table>
          </div>
        </div>

        <div id="rjd-new-app-panel" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:14px 18px;display:flex;align-items:center;gap:10px;flex-shrink:0;position:relative;overflow:hidden;">
            <button id="rjd-new-back" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600;backdrop-filter:blur(8px);transition:all 0.2s;flex-shrink:0;">← Back</button>
            <div style="flex:1;">
              <div style="font-size:15px;font-weight:700;color:#fff;">New Application</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.65);" id="rjd-extract-status"></div>
            </div>
          </div>
          <div style="flex:1;overflow-y:auto;padding:18px 18px 24px;">
            <button id="rjd-extract-btn" style="width:100%;padding:14px 16px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 16px rgba(79,70,229,0.3);transition:all 0.2s;">✦ Extract from Clipboard + URL</button>
            <div class="rjd-field-group"><label class="rjd-label">Company Name</label><input type="text" id="rjd-new-company" placeholder="e.g. Google" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;"/></div>
            <div class="rjd-field-group"><label class="rjd-label">Job Title</label><input type="text" id="rjd-new-title" placeholder="e.g. Engineer" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;"/></div>
            <div class="rjd-field-group"><label class="rjd-label">Job URL</label><input type="url" id="rjd-new-url" placeholder="https://..." style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;"/></div>
            <div class="rjd-field-group"><label class="rjd-label">Status</label><select id="rjd-new-status" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:9px;">${STATUSES.map(s => "<option value='" + s + "'>" + s + "</option>").join('')}</select></div>
            <div class="rjd-field-group"><label class="rjd-label">Job Description</label><textarea id="rjd-new-jd" rows="4" placeholder="Paste JD..."></textarea></div>
            <button id="rjd-new-save" style="width:100%;padding:12px;background:#f8fafc;color:#4f46e5;border:1.5px solid #e0e7ff;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:10px;">Save Application</button>
          </div>
        </div>

        <div id="rjd-detail-panel" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
          <div class="rjd-panel-header"><button class="rjd-back-btn" id="rjd-detail-back">← Back</button><span class="rjd-panel-title" id="rjd-detail-company">Detail</span></div>
          <div class="rjd-panel-body">
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">Job Title</span><span id="rjd-detail-title"></span></div>
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">URL</span><div style="display:flex;gap:6px;align-items:center;flex:1;"><input type="url" id="rjd-detail-url-input" style="flex:1;padding:4px 8px;border:1px solid #cbd5e0;border-radius:5px;font-size:12px;"/><a id="rjd-detail-url" target="_blank" class="rjd-url-link">Open</a></div></div>
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">Date</span><span id="rjd-detail-date"></span></div>
            <div class="rjd-detail-row"><span class="rjd-detail-lbl">Status</span><span id="rjd-detail-status"></span></div>
            <div class="rjd-detail-section"><div class="rjd-detail-lbl">Notes</div><textarea id="rjd-detail-notes" class="rjd-notes-input" rows="3"></textarea><button id="rjd-save-notes-btn" class="rjd-action-btn" style="margin-top:6px;">Save Notes</button></div>
            <div style="margin-top:12px;"><button id="rjd-delete-app-btn" class="rjd-delete-app-btn">Delete Application</button></div>
          </div>
        </div>
      </div>
    `;
  },

  dashboardDashboard: function({ apps, week, today, ints, offers, rejected, rate, monthName, calMonth, calYear, firstDay, daysInMonth, calendarData, weeklyData, todayISO, STATUS_COLORS, esc }) {
    return `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-card-label">Total Applications</div><div class="stat-card-value">${apps.length}</div><div class="stat-card-sub">${week} this week</div></div>
        <div class="stat-card"><div class="stat-card-label">Today</div><div class="stat-card-value blue">${today}</div><div class="stat-card-sub">applied today</div></div>
        <div class="stat-card"><div class="stat-card-label">Interviews</div><div class="stat-card-value orange">${ints}</div><div class="stat-card-sub">${offers} offers received</div></div>
        <div class="stat-card"><div class="stat-card-label">Success Rate</div><div class="stat-card-value green">${rate}%</div><div class="stat-card-sub">${rejected} rejected</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div class="section-card">
          <div class="section-card-header"><div class="section-card-title">📅 Application Calendar</div></div>
          <div style="padding:12px 16px 16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;"><span style="font-size:13px;font-weight:600;color:var(--text);">${monthName}</span><span style="font-size:12px;color:var(--text-muted);">${apps.filter(a=>a.dateRaw&&new Date(a.dateRaw).getMonth()===calMonth&&new Date(a.dateRaw).getFullYear()===calYear).length} applied</span></div>
            <div style="display:grid;grid-template-columns:repeat(7,32px);gap:2px;justify-content:space-between;">
              ${['S','M','T','W','T','F','S'].map(d=>"<div style='width:32px;height:20px;font-size:10px;color:#a0aec0;font-weight:600;text-align:center;'>"+d+"</div>").join('')}
              ${Array(firstDay).fill("<div style='width:32px;height:32px;'></div>").join('')}
              ${Array.from({length:daysInMonth},(_,i)=>{
                const d = i+1;
                const key = calYear + "-" + String(calMonth+1).padStart(2,"0") + "-" + String(d).padStart(2,"0");
                const count = calendarData[key]||0; const isToday = key === todayISO;
                let bg='transparent', color='var(--text2)', fontWeight='400', border='none';
                if(count>0){ bg='linear-gradient(135deg,#4f46e5,#7c3aed)'; color='#fff'; fontWeight='600'; }
                else if(isToday){ bg='#eef2ff'; color='#4f46e5'; fontWeight='600'; border='1.5px solid #4f46e5'; }
                return "<div style='width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:"+bg+";color:"+color+";font-size:11px;font-weight:"+fontWeight+";border:"+border+";' title='"+(count>0?count+" applications":"")+"'>"+d+"</div>";
              }).join('')}
            </div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-card-header"><div class="section-card-title">📊 Weekly Progress</div></div>
          <div style="padding:12px 16px 16px;">
            <div style="display:flex;gap:12px;margin-bottom:14px;">
              <div style="flex:1;background:var(--bg);border-radius:8px;padding:10px 12px;"><div style="font-size:11px;color:var(--text-muted);">This week</div><div style="font-size:22px;font-weight:700;color:var(--accent);">${weeklyData[weeklyData.length-1].count}</div></div>
              <div style="flex:1;background:var(--bg);border-radius:8px;padding:10px 12px;"><div style="font-size:11px;color:var(--text-muted);">Last week</div><div style="font-size:22px;font-weight:700;color:var(--text2);">${weeklyData[weeklyData.length-2].count}</div></div>
            </div>
            <div style="position:relative;height:120px;"><canvas id="weekly-chart"></canvas></div>
          </div>
        </div>
      </div>
      <div class="section-card" style="margin-bottom:24px">
        <div class="section-card-header"><div class="section-card-title">Recent Applications</div></div>
        <table><tbody>
          ${apps.slice(0,6).map(a => "<tr><td><div style='font-size:13px;font-weight:600;color:var(--text);'>"+esc(a.company||"—")+"</div><div style='font-size:11px;color:var(--text-muted);'>"+esc(a.jobTitle||"—")+"</div></td><td><span class='status-badge "+(STATUS_COLORS[a.status]||"s-applied")+"'>"+esc(a.status)+"</span></td><td style='font-size:11px;color:var(--text-faint);text-align:right;'>"+esc(a.date||"—")+"</td></tr>").join('') || "<tr><td colspan='3' class='empty-row'>No applications yet</td></tr>"}
        </tbody></table>
        ${apps.length > 6 ? "<div style='padding:10px 16px;border-top:1px solid #f1f5f9;text-align:center;'><button class='auth-link' id='view-all-btn'>View all "+apps.length+" →</button></div>" : ""}
      </div>
    `;
  },

  dashboardApplications: function({ isBulkMode, todayISO, filterSearch, filterStatus, STATUSES, filtered, esc }) {
    return `
      <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
        <div style="flex:1;min-width:240px;position:relative;">
          <input type="text" id="app-search" class="filter-input" value="${esc(filterSearch)}" placeholder="Search company, title, or URL..." style="width:100%;height:40px;padding-left:14px;"/>
        </div>
        <select id="app-status-filter" class="filter-input" style="width:160px;height:40px;">
          <option value="all" ${filterStatus==='all'?'selected':''}>All Statuses</option>
          ${STATUSES.map(s => `<option value="${s}" ${filterStatus===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <input type="date" id="app-date-filter" class="filter-input" style="width:150px;height:40px;" value="${filterDate}"/>
        <button id="toggle-bulk-mode-btn" class="bulk-toggle-btn ${isBulkMode?'active':''}" style="height:40px;padding:0 18px;font-size:13px;font-weight:700;">
          ${isBulkMode ? 'Done' : 'Bulk Actions'}
        </button>
      </div>

      <div id="bulk-bar" style="display:${isBulkMode ? 'flex' : 'none'};align-items:center;gap:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 18px;border-radius:12px;margin-bottom:14px;flex-wrap:wrap;box-shadow:0 4px 16px rgba(79,70,229,0.3);">
        <span id="bulk-count" style="font-size:13px;font-weight:700;">0 selected</span>
        <div style="height:20px;width:1px;background:rgba(255,255,255,0.3);margin:0 4px;"></div>
        <span style="font-size:13px;">Reassign:</span>
        <input type="date" id="bulk-session-date" max="${todayISO}" style="padding:4px 8px;border-radius:6px;border:none;font-size:12px;font-family:inherit;background:#fff;color:#1e293b;width:120px;"/>
        <button id="bulk-reassign-btn" class="bulk-action-btn-sm">✓ Apply</button>
        <div style="height:20px;width:1px;background:rgba(255,255,255,0.3);margin:0 4px;"></div>
        <span style="font-size:13px;">Status:</span>
        <button id="bulk-status-box" data-value="Applied" class="bulk-action-btn-sm" style="min-width:100px;">Applied ▾</button>
        <div style="height:20px;width:1px;background:rgba(255,255,255,0.3);margin:0 4px;"></div>
        <button id="bulk-delete-btn" style="padding:6px 14px;background:rgba(239,68,68,0.2);color:#fee2e2;border:1px solid rgba(239,68,68,0.3);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🗑️ Delete All</button>
      </div>
      <div class="section-card">
        <div class="section-card-header"><div class="section-card-title">All Applications (${filtered.length})</div></div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr>
              <th class="bulk-col" style="width:36px;display:${isBulkMode ? 'table-cell' : 'none'};"><input type="checkbox" id="select-all-chk"/></th>
              <th>#</th><th>Company</th><th>Job Title</th><th>URL</th><th>Status</th><th>Date</th><th>Actions</th>
            </tr></thead>
            <tbody id="app-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
  },

  dashboardSettingsNav: function({ settingsSection }) {
    return `
      <div class="settings-layout">
        <div class="settings-nav-card">
          ${[['apikey','🔑','API Key'],['resume','📝','Resume Profile'],['account','👤','Account'],['shortcuts','⌨️','Shortcuts'],['privacy-s','🛡️','Privacy'],['about','ℹ️','About']].map(([id,icon,label]) =>
            "<div class='settings-nav-item "+(settingsSection===id?"active":"")+"' data-sec='"+id+"'>"+icon+" "+label+"</div>"
          ).join('')}
        </div>
        <div class="settings-content-card" id="settings-panel"></div>
      </div>`;
  },

  dashboardSettingsSection: function({ sec, currentUser, initials, getWorkDayCutoff, STATUSES, esc, savedKey, rp }) {
    if (sec === 'apikey') {
      return `
        <div class="settings-section-title">Gemini API Key</div>
        <div class="settings-section-sub">Powers AI extraction in the Chrome extension. Free from Google.</div>
        <div class="settings-info-box">Your key is stored only in your browser. It is sent directly to Google — never to our servers.</div>
        <div id="settings-msg"></div>
        <div class="settings-field" style="max-width:480px;"><label>API Key</label>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <input type="password" class="settings-input" id="key-input" value="${esc(savedKey||'')}" placeholder="AIzaSy..." style="flex:1;max-width:520px;"/>
            <button class="btn-new" id="show-key-btn" style="white-space:nowrap;padding:0 16px;height:42px;">Show</button>
          </div>
          <button class="settings-btn" id="save-key-btn" style="padding:10px 28px;font-size:14px;">Save Key</button>
        </div>
        <div style="font-size:13px;color:#4a5568;background:#f8fafc;border-radius:8px;padding:14px;border:1px solid #e2e8f0;margin-top:20px;">
          <strong>Get a free key:</strong><br>
          1. Go to <a href="https://aistudio.google.com" target="_blank" style="color:#2E75B6;">aistudio.google.com</a><br>
          2. Click <strong>Get API Key → Create API key</strong>
        </div>`;
    }
    if (sec === 'account') {
      return `
        <div class="settings-section-title">Account</div>
        <div class="settings-section-sub">Your profile and login details.</div>
        <div style="display:flex;align-items:center;gap:14px;background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid #e2e8f0;">
          <div style="width:48px;height:48px;border-radius:50%;background:#1F4E79;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;">${esc(initials(currentUser.name))}</div>
          <div>
            <div style="font-size:15px;font-weight:700;">${esc(currentUser.name)}</div>
            <div style="font-size:12px;color:#718096;">${esc(currentUser.email)}</div>
          </div>
        </div>
        <div style="border-top:1px solid #f1f5f9;padding-top:20px;">
          <div style="font-size:13px;font-weight:700;color:#1F4E79;margin-bottom:4px;">🔑 Change Password</div>
          <div style="display:flex;gap:10px;"><input type="password" id="new-pwd-input" class="settings-input" placeholder="New password" style="max-width:280px;"/><button class="settings-btn" id="update-pwd-btn">Update</button></div>
          <div id="pwd-msg"></div>
        </div>
        <div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:20px;">
          <div style="font-size:13px;font-weight:700;color:#1a202c;margin-bottom:4px;">🌙 Night Shift Cutoff</div>
          <div style="display:flex;gap:10px;">
            <select id="cutoff-select" class="settings-input" style="width:160px;">
              ${[0,1,2,3,4,5,6].map(h => "<option value='"+h+"' "+(getWorkDayCutoff()===h?"selected":"")+">"+(h===0?"Disabled":h+":00 AM")+"</option>").join('')}
            </select>
            <button class="settings-btn" id="save-cutoff-btn">Save</button>
          </div>
        </div>
        <div style="border-top:1px solid #f1f5f9;padding-top:20px;margin-top:20px;"><button class="settings-danger-btn" id="delete-all-btn">Delete all data</button></div>`;
    }
    if (sec === 'shortcuts') {
      return `
        <div class="settings-section-title">Keyboard Shortcuts</div>
        <div class="settings-section-sub">Use these within the Chrome extension.</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${[['Open sidebar','Alt+Shift+T'],['Extract & Save','Alt+Shift+E'],['New app','Alt+Shift+N'],['Cycle Status (Modal)','Alt + S'],['Save (Modal)','Ctrl + S']].map(([a,k]) =>
            "<div class='settings-row'><div><div class='settings-row-label'>"+a+"</div></div><span class='kbd'>"+k+"</span></div>"
          ).join('')}
        </div>`;
    }
    if (sec === 'resume') {
      return `
        <div class="settings-section-title">Resume Profile</div>
        <div class="settings-section-sub">Details for Word document generation.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;">
          <div class="settings-field"><label>Full Name</label><input class="settings-input rp-input" id="rp-name" value="${esc(rp.name||'')}"/></div>
          <div class="settings-field"><label>Title</label><input class="settings-input rp-input" id="rp-title" value="${esc(rp.title||'')}"/></div>
          <div class="settings-field"><label>Email</label><input class="settings-input rp-input" id="rp-email" value="${esc(rp.email||'')}"/></div>
          <div class="settings-field"><label>Phone</label><input class="settings-input rp-input" id="rp-phone" value="${esc(rp.phone||'')}"/></div>
        </div>
        <div class="settings-field" style="margin-top:14px;"><label>Education</label><textarea class="settings-input rp-input" id="rp-education" rows="3">${esc(rp.education||'')}</textarea></div>
        <div id="rp-status" style="font-size:12px;color:#059669;margin-top:10px;"></div>`;
    }
    return "";
  },

  dashboardExport: function({ dateCounts, wToday, apps, uniqueDates, todayISO, esc }) {
    return `
      <div class="section-card" style="padding:20px;max-width:700px;margin-bottom:20px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;">📅 Filter by Date</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="export-date-btn active" data-date="">All (${apps.length})</button>
          <button class="export-date-btn" data-date="${wToday}">Today (${dateCounts[wToday]||0})</button>
          ${uniqueDates.filter(d => d !== wToday).map(d => "<button class='export-date-btn' data-date='"+d+"'>"+d+" ("+(dateCounts[d]||0)+")</button>").join('')}
          <input type="date" id="export-custom-date" class="filter-input" max="${todayISO}" style="height:34px;"/>
        </div>
        <div id="export-count-label" style="margin-top:12px;font-size:13px;color:#718096;">${apps.length} applications</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:700px;">
        <div class="section-card" style="padding:24px;"><div>📊</div><div style="font-size:15px;font-weight:700;">Excel Report (.xlsx)</div><button class="btn-export" id="export-xlsx-btn" style="width:100%;margin-top:20px;">Download Excel</button></div>
        <div class="section-card" style="padding:24px;"><div>📄</div><div style="font-size:15px;font-weight:700;">CSV File (.csv)</div><button class="btn-new" id="export-csv-btn" style="width:100%;margin-top:20px;">Download CSV</button></div>
      </div>`;
  },

  dashboardPrivacy: function() {
    return `
      <div style="max-width:800px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px;">
        <div class="settings-content-card">
          <div class="settings-section-title">Privacy Policy</div>
          <div class="settings-info-box">We do not sell your data. Your job applications are private to you.</div>
        </div>
        <div class="settings-content-card">
          <div class="settings-section-title">Data Protection</div>
          <div class="privacy-block"><strong>Account:</strong> Securely handled by Supabase Auth with Row Level Security.</div>
          <div class="privacy-block"><strong>Gemini Key:</strong> Stored locally in your browser only.</div>
        </div>
      </div>`;
  }
};
