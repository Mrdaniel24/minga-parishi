# Deployment, import, backup

> Real parish data must go to a **new, private Supabase project** — never to the public demo project.

## 1. Create the project
1. Supabase → New project (region close to Tanzania, e.g. eu-central / af-south when available). Note the URL and anon key.
2. Authentication → Email: keep e-mail confirmation on; set Site URL to the production domain.

## 2. Base Kanisa Hub schema
Run `database/000_kanisa_hub_base.sql` (profiles, departments, events, announcements, sermons, media, chat, settings …). It was reconstructed from the pages because the demo never committed its schema; if you have owner access to the demo project you can compare it with a real dump (`supabase db dump --project-ref ztafklfgtsaolyvaybop --schema public`). Do **not** run `database/demo-seed.sql` or `demo-protect.sql`.

## 3. Parish migrations (in order)
Run each file from `database/migrations/` in the SQL editor:
`20261015_01_parish_core` → `02_finance_core` → `03_finance_functions` → `04_finance_views` → `05_rls` → `06_reference_seed` → `07_legacy_import` → `08_scheduled_reports` → `09_integration`.
All are re-runnable. For scheduled snapshots enable **pg_cron** (Database → Extensions) *before* running 08.

## 4. First administrator
1. Register the administrator's account on the site.
2. SQL editor:
```sql
insert into public.parish_user_roles (user_id, parish_id, role_code)
select id, public.default_parish_id(), 'parish_admin' from auth.users where email = 'ADMIN_EMAIL_HERE';
```
Further roles are granted in the app (*Watumiaji*).

## 5. Point the frontend at the project
Edit `assets/js/supabase-client.js`: `SUPABASE_URL` and `SUPABASE_ANON_KEY` → the new project. Deploy (Vercel project from this repository, branch of your choice).

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
Runs every migration in an in-process PostgreSQL and the 19 financial/RLS tests. Run before every deployment.

## 8. Local training copy
```bash
node tools/dev/local-supabase.mjs --port 5600
```
Open `http://localhost:5600/public/login.html` (users printed in the console, password `Minga@2026`). Add `--import C:\minga-private` to explore the real imported data locally. Not for production.

## 9. Backups and recovery
- Supabase Pro: daily backups + Point-in-Time Recovery — enable PITR for the parish project.
- Weekly logical backup kept off-site:
```bash
pg_dump "$DB_URL" --format=custom --file minga_YYYYMMDD.dump
```
- Restore drill each quarter into a scratch project: `pg_restore --clean --no-owner -d "$SCRATCH_URL" minga_YYYYMMDD.dump`, then run `select * from public.finance_integrity_checks();` — all rows must be `ok`.
- Year end: lock months (*Uhasibu → Vipindi*), then *Funga mwaka wa fedha*.
