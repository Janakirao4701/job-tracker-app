const SUPABASE_URL = 'https://ayreitpysvixquqfbeix.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5cmVpdHB5c3ZpeHF1cWZiZWl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTMyNDYxNTIsImV4cCI6MjAyODgyMjE1Mn0.39-M7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9-7-9'; // Using public anon key for check

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
