// Build-time constants. Anon key is intentionally public (Supabase design).
// Shared secret and user preferences live in chrome.storage.local, set via
// the extension popup.
window.ZINOLT_CONFIG = {
  supabaseUrl: "https://kwqbgetoiiikctkmzirx.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3cWJnZXRvaWlpa2N0a216aXJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMzU1NjQsImV4cCI6MjA5OTkxMTU2NH0.iodte7jUTo1JnXGdjgGAspTGIfhjTdwmt8SMCAO-W-c",
};
