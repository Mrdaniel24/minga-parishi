# Minga Parish Management System — Kanisa Hub by FocusTec

Mfumo wa Usimamizi wa **Parokia ya Mt. Aloyce Gonzaga – Minga** (Jimbo Katoliki Singida), uliojengwa juu ya Kanisa Hub.
Unachukua nafasi ya workbook ya Excel "MIAMALA & RIPOTI ZOTE": malipo yanaingizwa mara moja, na ripoti zote (familia, jumuiya, kigango, parokia, kampeni, ahadi, zaka, risiti, uhasibu) zinahesabiwa na PostgreSQL.

- Skrini za parokia: `parish/index.html` (kiungo **Mfumo wa Parokia** kwenye kila lango)
- Database: `database/migrations/20261015_0*.sql` (endesha kwa mpangilio)
- Uingizaji wa workbook: `tools/migration/` (matokeo ni ya siri — hayaingii git)
- Majaribio: `npm test`
- Nyaraka: `docs/` — anza na `IMPLEMENTATION_STATUS.md`, `DEPLOYMENT.md`, `ADMIN_GUIDE.md`, `MIGRATION_RISKS.md`

> Data halisi ya parokia iwekwe kwenye project mpya ya Supabase, si kwenye project ya demo hapa chini.

---

# Kanisa Hub by FocusTec — Demo

Mfumo wa usimamizi wa kanisa (Church Management System) — toleo la **demo** kwa ajili ya wateja wa FocusTec.
Kanisa ndani ya demo ni la mfano: **Kanisa la Neema**. Data zote ni za kubuni.

## Akaunti za demo
Password ya zote: `Demo@2026`

| Nafasi | Email |
|---|---|
| Super Admin | superadmin@kanisahub.demo |
| Admin (Kwaya Kuu) | admin@kanisahub.demo |
| Mshirika (Vijana) | member@kanisahub.demo |

## Muundo
- Frontend: HTML/CSS/JS tupu — `public/`, `member/`, `admin/`, `super-admin/`. Vercel haijengi chochote.
- CSS ya Tailwind imejengwa tayari: `assets/css/tailwind.css` (imo kwenye git). Ukibadilisha au kuongeza class za Tailwind kwenye ukurasa wowote, au rangi kwenye `assets/js/admin-tw-config.js`, ijenge upya kisha u-commit:
  ```
  npm install
  npm run build:css
  ```
- Lugha (SW/EN): `assets/js/i18n.js` — ongeza maneno mapya kwenye kamusi `EN2SW`.
- Backend: Supabase project `kanisa-hub-demo` (ref `ztafklfgtsaolyvaybop`) — tofauti kabisa na project ya BLB
- Hosting: Vercel (`vercel.json`)

## Haifanyi kazi kwenye demo
- Malipo ya mtandaoni (Snippe) na chatbot ya AI — zinahitaji edge functions na API keys ambazo hazijawekwa kwenye demo.
