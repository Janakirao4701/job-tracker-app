// ── FORWARD SYNC EVENTS FROM DASHBOARD TO ALL TABS ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const syncActions = ['session_saved', 'session_cleared', 'save_profile', 'save_key'];
  if (syncActions.includes(msg.action)) {
    // Broadcast to all open tabs so content scripts update immediately
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, msg).catch(e => {
          // Silence connection errors for inactive/non-matching tabs
          if (!e.message.includes('Receiving end does not exist') &&
              !e.message.includes('Could not establish connection')) {
            console.warn('[RJD] broadcast error on tab', tab.id, e.message);
          }
        });
      });
    });
    if (sendResponse) sendResponse({ ok: true });
  }
});

// ── KEYBOARD COMMANDS ──
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (cmd) => {
        window.dispatchEvent(new CustomEvent('rjd-command', { detail: { action: cmd } }));
      },
      args: [command]
    });
  } catch(e) {}
});

// ── INTERVIEW NOTIFICATIONS ──
// Fix #2: MV3 service workers do not support setTimeout/setInterval reliably.
// Use chrome.alarms instead — these fire even after the service worker restarts.
chrome.alarms.get('rjd-daily-check', (alarm) => {
  if (!alarm) {
    // Schedule a daily alarm firing at 09:00 local time (delay in minutes)
    const now  = new Date();
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMinutes = Math.ceil((next - now) / 60000);
    chrome.alarms.create('rjd-daily-check', {
      delayInMinutes: delayMinutes,
      periodInMinutes: 24 * 60
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'rjd-daily-check') {
    checkInterviewsToday();
  }
});

// Also run once on install/startup
checkInterviewsToday();

async function checkInterviewsToday() {
  const { rjd_session } = await chrome.storage.local.get('rjd_session');
  if (!rjd_session) return;

  // Critical fix #3: support both token formats — standardised format uses 'token',
  // but guard against legacy 'access_token' key too
  const token = rjd_session.token || rjd_session.access_token;
  if (!token) return;

  const today = new Date().toLocaleDateString('en-CA');
  try {
    const res = await fetch(
      CONFIG.SUPABASE_URL + "/rest/v1/applications?status=eq.Interview Scheduled&select=company,job_title,follow_up_date",
      { headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    if (!res.ok) return;
    const apps = await res.json();
    if (!Array.isArray(apps)) return;

    const todayInterviews = apps.filter(a => a.follow_up_date === today);
    if (!todayInterviews.length) return;

    const storageKey = 'rjd_notified_' + today;
    const stored = await chrome.storage.local.get(storageKey);
    if (stored[storageKey]) return;

    const names = todayInterviews.map(a => (a.company || 'Unknown') + (a.job_title ? ' — ' + a.job_title : '')).join('\n');
    chrome.notifications.create('rjd-interview-' + Date.now(), {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: todayInterviews.length === 1 ? 'Interview today!' : todayInterviews.length + ' interviews today!',
      message: names, priority: 2,
    });
    chrome.storage.local.set({ [storageKey]: true });
  } catch(e) {}
}
