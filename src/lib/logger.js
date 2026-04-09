/**
 * AppLogger - Persistent Local Logging for AI Blaze
 * Stores logs in chrome.storage.local (Extension) or localStorage (Web)
 */
const AppLogger = (() => {
  const MAX_LOGS = 200;
  const STORAGE_KEY = 'rjd_error_logs';

  async function getLogs() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(STORAGE_KEY, data => resolve(data[STORAGE_KEY] || []));
      } else {
        try {
          resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
        } catch (e) {
          resolve([]);
        }
      }
    });
  }

  async function saveLogs(logs) {
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: logs }, resolve);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
        resolve();
      }
    });
  }

  return {
    error: async (message, context = {}) => {
      const timestamp = new Date().toISOString();
      const entry = {
        level: 'ERROR',
        timestamp,
        message: String(message),
        context: JSON.stringify(context),
        url: window.location.href,
        userAgent: navigator.userAgent
      };
      
      console.error(`[AppLogger] ${message}`, context);
      
      const logs = await getLogs();
      logs.push(entry);
      await saveLogs(logs);
    },

    warn: async (message, context = {}) => {
      const timestamp = new Date().toISOString();
      const entry = {
        level: 'WARN',
        timestamp,
        message: String(message),
        context: JSON.stringify(context),
        url: window.location.href
      };
      
      console.warn(`[AppLogger] ${message}`, context);
      
      const logs = await getLogs();
      logs.push(entry);
      await saveLogs(logs);
    },

    info: async (message, context = {}) => {
      const timestamp = new Date().toISOString();
      const entry = {
        level: 'INFO',
        timestamp,
        message: String(message),
        context: JSON.stringify(context)
      };
      const logs = await getLogs();
      logs.push(entry);
      await saveLogs(logs);
    },

    getLogs,

    clear: async () => {
      await saveLogs([]);
    },

    download: async () => {
      const logs = await getLogs();
      if (logs.length === 0) {
        alert('No logs available locally.');
        return;
      }

      const content = logs.map(l => 
        `[${l.timestamp}] ${l.level}: ${l.message}\nContext: ${l.context}\nURL: ${l.url}\n-------------------`
      ).join('\n\n');

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-blaze-logs-${new Date().getTime()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };
})();

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppLogger;
} else {
  window.AppLogger = AppLogger;
}
