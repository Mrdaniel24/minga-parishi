# Deployment, import, backup

> Real parish data goes only to the parish's own private Supabase project.

## 1. Create the project
1. Supabase → New project (region close to Tanzania, e.g. eu-central / af-south when available). Note the URL and anon key.
2. Authentication → Email: keep e-mail confirmation on; set Site URL to the production domain.

## 2. Database (one file)
Supabase → **SQL Editor** → New query → paste the whole of `database/supabase_setup.sql` → **Run**.
It is every file of `database/migrations/` in order (`00_base` … `10_profiles_rls`), contains no personal data and can be run again safely.
After changing a migration, rebuild it with `npm run setup:sql` (a test fails if it is out of date).
For scheduled report snapshots enable **pg_cron** (Database → Extensions) *before* running it.

## 3. First administrator (super admin)
1. Authentication → Users → **Add user** → e-mail + password, tick *Auto Confirm User*. A row in `public.profiles` is created automatically.
2. SQL Editor:
```sql
update public.profiles set role = 'super_admin', full_name = 'FULL NAME' where email = 'ADMIN_EMAIL_HERE';
```
The super admin sees everything. Everyone else gets access only through parish roles.

## 4. Other users
1. Authentication → Users → **Add user** (one account per person).
2. In the app: **Mfumo → Watumiaji na Nafasi → Toa nafasi** → their e-mail → role (Paroko, Mhasibu, Karani, Kiongozi wa Jumuiya …) and, for leaders, their kigango/jumuiya.
An account without a role can sign in but sees nothing.

## 5. Point the frontend at the project and deploy
`assets/js/config.js` → `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings → API: Project URL and the *anon public* key — never the service_role key).
Deploy: Vercel → New project from this repository (static, no build). In Supabase → Authentication → URL Configuration set **Site URL** to the Vercel address and add `<site>/reset.html` to the redirect URLs (password reset links).

## 6. Import the workbook (once)
On the office computer (Python 3.12 + `pip install openpyxl`):
```bash
python -I tools/migration/extract_workbook.py "C:\path\MINGA-PARISH ... .xlsm" C:\minga-private
```
```bash
python -I tools/migration/build_import.py C:\minga-private
```
Read `C:\minga-private\import\PREVIEW.md` with the parish accountant. When approved, open `C:\minga-private\import\minga_import.sql` in the SQL editor and run it (≈7 MB; psql is faster: `psql "$DB_URL" -f minga_import.sql`). Then in the app: **Uhakiki wa Fedha** → *Excel dhidi ya mfumo* (should show 2,070 equal + 4 explained) and *Kumbukumbu za zamani* (pending rows to correct and approve).

Optional check before running it in production:
```bash
MINGA_PRIVATE_DIR=C:/minga-private npm test
```

Keep `C:\minga-private` encrypted or delete it after the import. Never commit it.

## 7. Tests
```bash
npm install
```
```bash
npm test
```
Runs every migration in an in-process PostgreSQL plus the financial, security (RLS) and setup-file tests. Run before every deployment.

## 8. Local training copy
```bash
npm run dev
```
Open `http://localhost:5600/login.html` (users printed in the console, password `Minga@2026`). Add `--import C:\minga-private` to explore the real imported data locally. Not for production.

## 9. Backups and recovery
- Supabase Pro: daily backups + Point-in-Time Recovery — enable PITR for the parish project.
- Weekly logical backup kept off-site:
```bash
pg_dump "$DB_URL" --format=custom --file minga_YYYYMMDD.dump
```
- Restore drill each quarter into a scratch project: `pg_restore --clean --no-owner -d "$SCRATCH_URL" minga_YYYYMMDD.dump`, then run `select * from public.finance_integrity_checks();` — all rows must be `ok`.
- Year end: lock months (*Uhasibu → Vipindi*), then *Funga mwaka wa fedha*.
