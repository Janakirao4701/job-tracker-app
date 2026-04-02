// Configuration for Job Tracker Extension
// Note: In a production environment, you might fetch these from a server or use an environment variables build system.
// Because it's an extension relying directly on Supabase from the client, the Anon key is exposed.
// Secure your database with Row Level Security (RLS) policies.

const CONFIG = {
  SUPABASE_URL: 'https://dxsdvzhnqbynicrvbcfi.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4c2R2emhucWJ5bmljcnZiY2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTUyMDcsImV4cCI6MjA4OTY5MTIwN30.7csAFAIjVOU8_acamyYoTFLgXzao56k9aDYgGDFd2oo',
};

// Export for module systems if used, but normally relies on global window/self
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
} else if (typeof self !== 'undefined') {
  self.CONFIG = CONFIG;
}
