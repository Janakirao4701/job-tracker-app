// Configuration for Job Tracker Extension (EXAMPLE)
// Copy this file to src/lib/config.js and fill in your actual Supabase URL and Key.

const CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL_HERE',
  SUPABASE_KEY: 'YOUR_SUPABASE_ANON_KEY_HERE',
};

// Export for module systems if used, but normally relies on global window/self
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
} else if (typeof self !== 'undefined') {
  self.CONFIG = CONFIG;
}
