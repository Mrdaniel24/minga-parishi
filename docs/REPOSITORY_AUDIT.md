# Repository audit — Kanisa Hub demo (starting point)

Source: `github.com/Mrdaniel24/kanisa-hub-demo` at `c48e106`. The Minga Parish work is on branch `minga-parish` in a separate clone, so the public demo is untouched.

## Architecture

| Layer | What exists |
|---|---|
| Frontend | Static HTML + vanilla JS. Portals `public/` (site, login, register, visitor form), `member/` (9 pages), `admin/` (13), `super-admin/` (14). Prebuilt Tailwind (`assets/css/tailwind.css`), shared theme (`admin-tw-config.js`, `admin-theme.css`, `admin-layout.js`), SW/EN switcher (`i18n.js`) |
| Auth | Supabase Auth (email + password). `auth.js` / `router.js` page guard: `profiles.role` ∈ member < admin < super_admin, `profiles.status` must be active; admin module permissions in `admin_permissions` (`can_manage_members`, `can_manage_contributions` …), optionally scoped to one department. Guard results cached 10 min in sessionStorage (UI only) |
| Data | Supabase project `ztafklfgtsaolyvaybop` (demo). Tables used by the pages: `profiles`, `departments`, `admin_permissions`, `contributions`, `events`, `announcements`, `sermons`, `media_items`, `media_gallery_*`, `messages`, `pinned_messages`, `chat_restrictions`, `visitors`, `service_times`, `church_contacts`, `system_settings` |
| Migrations in repo | Only patches (`database/*.sql`: homepage CMS, public read fixes, demo seed/protect). **The base schema is not in the repository** |
| Hosting | Vercel static (`vercel.json`), auto-deploy from `main` |

## Feature inventory (demo)

Working: login/registration, member/admin/super-admin dashboards, members & departments, events, announcements, sermons, media gallery, homepage CMS, department group chat, visitor registration, basic `contributions` list/totals (single amount + category, no pledges, no ledger), reports page (contribution charts), SW/EN switch, responsive sidebar.
Not configured in the demo: online payments (Snippe edge function), AI chatbot.

## Gaps against the Minga requirements

| Requirement | Demo | Now |
|---|---|---|
| Parish identity on reports/receipts | "Kanisa la Neema" hard-coded in 5 places | `parishes` table; footer/login/receipts/reports personalised |
| Parish → kigango → jumuiya → family → person | departments only | `org_units`, `families`, `parishioners`, history |
| Ledger with reversals, receipts, double entry | `contributions` rows editable/deletable | `finance_transactions` + journals + receipts, immutable when posted |
| Pledges, targets, balances | none | `pledges`, `campaign_targets`, balance views |
| Zaka months, Mavuno, Ujenzi, special campaigns | single category text | categories + campaigns + calculation functions |
| Scoped roles (kigango/jumuiya leaders, auditor …) | admin scoped to department | `parish_user_roles` + RLS `has_perm(perm, org_unit)` |
| Excel migration + reconciliation | none | extractor, generator, loader, parity results |
| Automated tests | none | `npm test` — 19 database tests (PGlite) |

## Security assessment

| Finding | Severity | Status |
|---|---|---|
| Demo account passwords published in README; demo protect triggers | fine for a demo, unacceptable for real data | Minga must use **its own Supabase project** (`DEPLOYMENT.md`) |
| Base schema / RLS of existing tables not in version control | High (cannot review or reproduce) | Dump and commit the base schema when creating the Minga project (step 2 of deployment) |
| `contributions` editable/deletable by admins | High for finance | New money flows use the immutable ledger; old `contributions` page left for the demo features only |
| Menu hiding by `data-perm` / guard cache is UI-only | Info | Parish data is enforced by RLS policies and SECURITY DEFINER functions with their own permission checks (tested) |
| Anon key in `supabase-client.js` | Normal for Supabase | No service-role key anywhere in the frontend (checked) |
| `registerUser` upserts `profiles.role = 'member'` from the browser | Depends on DB trigger `protect_profile_role_changes` (referenced by the demo seed, not in repo) | Verify the trigger exists in the Minga project |

## Reuse

Reused as-is: login/registration, page guard, theme, sidebar/mobile navigation, toast/loader helpers, i18n switcher, events/announcements/media/sermons/chat. New parish screens live in `parish/` (one app shell + `assets/js/parish/*.js`) and are linked from every portal's sidebar ("Mfumo wa Parokia").
