const SUPABASE_URL = 'https://dxsdvzhnqbynicrvbcfi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4c2R2emhucWJ5bmljcnZiY2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTUyMDcsImV4cCI6MjA4OTY5MTIwN30.7csAFAIjVOU8_acamyYoTFLgXzao56k9aDYgGDFd2oo';

async function checkColumn() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?select=resume_profile&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY }
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response:', text);
  } catch (e) {
    console.error('Error:', e);
  }
}
checkColumn();
