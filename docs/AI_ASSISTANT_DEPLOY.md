# Msaidizi wa AI: mipangilio ya Vercel

Endpoint ya `/api/ai-assistant` hutumia Cloudflare Workers AI na model `@cf/google/gemma-4-26b-a4b-it`.

## Vigezo vya Production

Kwenye Vercel → Project `minga-parishi` → Settings → Environment Variables, ongeza kwa mazingira ya **Production**:

| Jina | Aina | Thamani |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Account ID ya Cloudflare |
| `CLOUDFLARE_API_TOKEN` | Secret | API token ya Cloudflare yenye ruhusa ya Workers AI |

Cloudflare's REST API quickstart currently asks for Account → Workers AI → **Read** and **Edit** permissions. Hifadhi token kwenye Vercel pekee; usiiweke kwenye faili za `assets/` au kwenye chat.

Baada ya kuhifadhi variables, redeploy Production ili Function ipokee mipangilio mipya.

## Data na ruhusa

Function inathibitisha Supabase session na kusoma data kupitia Supabase kwa JWT ya mtumiaji aliyeingia. Haihitaji `SUPABASE_SERVICE_ROLE_KEY`. Ruhusa za RLS zinaendelea kutumika kwa dashboard, miamala, waumini na familia. Function hutuma muhtasari unaohitajika kwa swali kwa Cloudflare Workers AI na hairekodi mazungumzo kwenye database ya parokia.
