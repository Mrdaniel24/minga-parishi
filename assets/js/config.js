/* ============================================
   Minga Parish — connection settings
   Change these two values to point the system at another Supabase project.
   The anon (publishable) key is meant to be public: every rule about who may
   see or change what is enforced inside the database (Row Level Security).
   Never put the service_role key here.
   ============================================ */
window.PM_CONFIG = {
  SUPABASE_URL: 'https://gyntomzlvmwiywtsdoth.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bnRvbXpsdm13aXl3dHNkb3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMTAwMDEsImV4cCI6MjEwNzY4NjAwMX0.8FYHk8TCEMVK8rlLYUfc2eupffc46s9eP69zvbUkAwY',
  // Demo: shows one-click sign-in buttons on the login page for the accounts
  // created by database/demo/demo_accounts.sql. Set to false (and run
  // database/demo/demo_remove.sql) before the parish starts using the system.
  DEMO: true,
  DEMO_PASSWORD: 'Demo@2026',
  DEMO_ACCOUNTS: [
    ['superadmin@minga.demo', 'Msimamizi wa Mfumo', 'shield_person'],
    ['admin@minga.demo', 'Katibu / Msimamizi wa Parokia', 'admin_panel_settings'],
    ['paroko@minga.demo', 'Paroko', 'church'],
    ['mhasibu@minga.demo', 'Mhasibu', 'point_of_sale'],
    ['mhazini@minga.demo', 'Mtunza Hazina', 'savings'],
    ['karani@minga.demo', 'Karani', 'edit_note'],
    ['mkaguzi@minga.demo', 'Mkaguzi', 'fact_check'],
    ['kigango@minga.demo', 'Kiongozi wa Kigango (Mughanga)', 'account_tree'],
    ['jumuiya@minga.demo', 'Kiongozi wa Jumuiya (Clara)', 'groups'],
    ['muumini@minga.demo', 'Muumini', 'person'],
  ],
};
