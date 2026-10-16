/* ============================================
   Minga Parish — Supabase client
   Load after the supabase-js CDN script and assets/js/config.js.
   The local development server (tools/dev/local-supabase.mjs) sets
   window.PM_LOCAL_URL so the same pages talk to it instead.
   ============================================ */
(function () {
  if (window.__pmSupabase) return;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('supabase-js haijapakiwa: weka script ya CDN kabla ya supabase-client.js');
  }
  const cfg = window.PM_CONFIG || {};
  const url = window.PM_LOCAL_URL || cfg.SUPABASE_URL;
  const key = window.PM_LOCAL_URL ? 'local-dev' : cfg.SUPABASE_ANON_KEY;
  window.supabase = window.supabase.createClient(url, key);
  window.__pmSupabase = true;
})();
