# Minga Parish Management System

Mfumo wa Usimamizi wa **Parokia ya Mt. Aloyce Gonzaga – Minga** (Jimbo Katoliki Singida).
Unachukua nafasi ya workbook ya Excel "MIAMALA & RIPOTI ZOTE": malipo yanaingizwa mara moja, na ripoti zote
(familia, jumuiya, kigango, parokia, kampeni, ahadi, zaka, risiti, uhasibu) zinahesabiwa na PostgreSQL.

Mfumo unajitegemea: HTML/CSS/JS tupu + Supabase (Postgres, Auth, RLS). Hautegemei Kanisa Hub wala mfumo mwingine.

| Sehemu | Mahali |
|---|---|
| Kuingia | `login.html` (na `reset.html` ya kubadilisha nenosiri) |
| Mfumo wenyewe | `parish/index.html`, risiti `parish/receipt.html` |
| Mipangilio ya Supabase (URL + anon key) | `assets/js/config.js` |
| Database (kwa mpangilio) | `database/migrations/20261015_*.sql` |
| SQL moja ya kubandika kwenye Supabase | `database/supabase_setup.sql` (hutengenezwa: `npm run setup:sql`) |
| Uhamishaji wa Excel | `tools/migration/` (matokeo ni ya siri — hayaingii git) |
| Majaribio | `npm test` |
| Nyaraka | `docs/` — anza na `DEPLOYMENT.md`, `ADMIN_GUIDE.md`, `IMPLEMENTATION_STATUS.md`, `MIGRATION_RISKS.md` |

## Kuanza haraka (Supabase)
1. Supabase → project ya parokia → **SQL Editor** → bandika `database/supabase_setup.sql` → **Run**.
2. **Authentication → Users → Add user** → weka barua pepe na nenosiri lako (weka tiki *Auto Confirm User*).
3. SQL Editor:
   ```sql
   update public.profiles set role = 'super_admin', full_name = 'JINA LAKO' where email = 'BARUA_PEPE_YAKO';
   ```
4. Fungua `login.html` (au tovuti ya Vercel) na uingie.

Maelezo kamili: `docs/DEPLOYMENT.md`.

## Demo (kabla ya kumkabidhi mteja)
- `database/demo/demo_accounts.sql` → akaunti 10, moja kwa kila nafasi, nenosiri `Demo@2026`. Haiongezi data; zinaona data iliyoingizwa kutoka Excel.
- Ukurasa wa login unaonyesha vitufe vya kuingia kama kila nafasi (`DEMO: true` kwenye `assets/js/config.js`).
- Kabla ya kukabidhi: endesha `database/demo/demo_remove.sql` na weka `DEMO: false`.

## Kuendesha kwenye kompyuta (bila Supabase)
```bash
npm install
npm run dev
```
Fungua `http://localhost:5600/login.html` — watumiaji wa majaribio wanaonyeshwa kwenye terminal (nenosiri `Demo@2026`).
Data ni ya mfano; ukifunga server inapotea.
