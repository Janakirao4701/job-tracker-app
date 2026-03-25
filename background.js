// ── SHARED CONFIG ──
// Issue #1 fix: anon key is no longer hardcoded in source.
// It is stored in chrome.storage.local at install time (set via options/setup page).
const SUPABASE_URL = 'https://dxsdvzhnqbynicrvbcfi.supabase.co';
async function getSupabaseKey() {
  const { rjd_anon_key } = await chrome.storage.local.get('rjd_anon_key');
  return rjd_anon_key || '';
}

// ── FORWARD SESSION EVENTS TO ALL TABS ──
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'session_saved' || msg.action === 'session_cleared') {
    // Broadcast to all open tabs so content scripts update TRACK button immediately
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, msg).catch(e => {
          // Only silence expected "no receiver" errors, log real ones
          if (!e.message.includes('Receiving end does not exist') &&
              !e.message.includes('Could not establish connection')) {
            console.warn('[RJD] sendMessage error on tab', tab.id, e.message);
          }
        });
      });
    });
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
// Issue #2 fix: MV3 service workers do not support setTimeout/setInterval across
// restarts. Use chrome.alarms instead — the alarm persists even after the service
// worker is terminated and re-spawned.

const ALARM_NAME = 'rjd_daily_check';

// Schedule a daily alarm at 09:00 if not already scheduled.
async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) return;

  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  chrome.alarms.create(ALARM_NAME, {
    when: next.getTime(),
    periodInMinutes: 24 * 60,   // repeat every 24 h
  });
}

// Run a check immediately on service-worker start and ensure the alarm exists.
checkInterviewsToday();
ensureAlarm();

// Fire on every alarm tick.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkInterviewsToday();
});

async function checkInterviewsToday() {
  const { rjd_session } = await chrome.storage.local.get('rjd_session');
  if (!rjd_session) return;

  // Support both token formats — standardised format uses 'token',
  // guard against legacy 'access_token' key too.
  const token = rjd_session.token || rjd_session.access_token;
  if (!token) return;

  const SUPABASE_KEY = await getSupabaseKey();
  if (!SUPABASE_KEY) return;

  const today = new Date().toLocaleDateString('en-CA');
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/applications?status=eq.Interview%20Scheduled&select=company,job_title,follow_up_date',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }
    );
    if (!res.ok) return;
    const apps = await res.json();
    if (!Array.isArray(apps)) return;

    const todayInterviews = apps.filter(a => a.follow_up_date === today);
    if (!todayInterviews.length) return;

    const storageKey = 'rjd_notified_' + today;
    const stored = await chrome.storage.local.get(storageKey);
    if (stored[storageKey]) return;

    const names = todayInterviews.map(a => (a.company || 'Unknown') + (a.job_title ? ' \u2014 ' + a.job_title : '')).join('\n');
    chrome.notifications.create('rjd-interview-' + Date.now(), {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: todayInterviews.length === 1 ? 'Interview today!' : todayInterviews.length + ' interviews today!',
      message: names, priority: 2,
    });
    chrome.storage.local.set({ [storageKey]: true });
  } catch(e) {
    console.warn('[RJD] checkInterviewsToday failed:', e);
  }
}
