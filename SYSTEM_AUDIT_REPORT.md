# Ripoti ya Ukaguzi wa Mfumo — Minga Parish Management System

**Tarehe:** 10 Novemba 2026
**Toleo lililokaguliwa:** tawi `minga-parish`, commit `6384b5f` (pamoja na migrations 00–31)
**Mazingira ya majaribio:** database ya ndani (PGlite) kupitia `npm test` na server ya ndani `npm run dev` (data ya mfano "Mfano"). **Supabase halisi haikuguswa.**

> Hakuna data ya parokia (waumini, miamala, risiti) iliyobadilishwa au kufutwa. Majaribio yote yalifanyika kwenye database ya muda inayofutika server ikizimwa.

## Awamu ya 2 — maboresho yaliyofanyika (10 Nov 2026)

Baada ya ukaguzi, mapendekezo 5 yalitekelezwa (migration 33 + skrini). Yote yamejaribiwa kwa majaribio ya database na kwenye kivinjari (server ya ndani):

| Boresho | Kilichofanyika | Ushahidi |
|---|---|---|
| Jumla zinazobonyezeka (Dashibodi, Ripoti, Kampeni) | Dashibodi: makusanyo ya mwezi/mwaka, Zaka, Mavuno, Ujenzi, Sadaka, Michango maalumu, kampeni; Matumizi → ukurasa wa Matumizi; Ahadi → ripoti ya madeni. Ripoti: makusanyo kwa aina, kwa ngazi (kigango/jumuiya/familia/muumini), kwa mwezi (kila kisanduku na jumla ya mwaka), mapato/matumizi, mwaka kwa mwaka, kampeni kwa jumuiya. Kampeni: "Imekusanywa". Ripoti ya viongozi: "Michango yake" na "Ya familia" (vichujio vipya `gyear`, `family_only` kwenye `ledger_drill`). | Kivinjari: jumla **6/6 Dashibodi, 36/36 Ripoti, 1/1 Kampeni, 2/2 viongozi** zililingana kabisa na miamala inayofunguka. |
| Kumwondoa muumini bila kufuta (soft delete) | `delete_parishioner` sasa inaweka `membership_status = 'removed'` + tarehe, sababu, aliyeondoa. Malipo yanabaki yameunganishwa naye, mahudhurio na historia ya vyeo vinabaki. Haonekani kwenye orodha za waumini hai, mahudhurio mapya, SMS wala kutafuta mlipaji. Familia inaonyesha "Wasio hai" (sababu na tarehe); "Hariri → Hali: Hai" inamrudisha. Hali za muumini sasa ni za Kiswahili. | Majaribio ya DB (mahudhurio yanabaki, vyeo `ended` na mtu bado yupo, kurudishwa kunafuta kumbukumbu ya kuondolewa). Kivinjari: kuondoa → "Wasio hai" → kurudisha. |
| SMS kwa waliolipa zaka kweli | Makundi mapya: **Waliolipa zaka** na **Walipa zaka ambao hawajalipa**, kwa mwaka au mwezi. Inahesabu zaka ya muumini mwenyewe au ya familia yake (kwa jina la familia); malipo yaliyorudishwa hayahesabiwi. Mwaka/mwezi vinahifadhiwa na ujumbe. | Majaribio ya DB (mwaka, mwezi, familia, reversal). Kivinjari: hesabu 8 / 0 kwa miezi tofauti, ujumbe umehifadhiwa "— Nov 2026". |
| Ripoti ya viongozi | Kichujio cha **cheo maalum**; chaguo "Sasa na vilivyoisha {mwaka}" / "Sasa tu"; vyeo vilivyoisha vinaonyeshwa vimekatwa mstari na tarehe "(hadi dd/mm/yyyy)"; Excel ina safu "Vyeo_vilivyoisha". | Majaribio ya DB + kivinjari (cheo kilichoisha kinaonekana / kinafichwa; kichujio cha cheo). |
| SMS iliyokwama | Kitufe **"Rekebisha hali"** kwa SMS iliyo "Inatumwa…": mtumaji anaangalia kwa mtoa huduma, kisha anachagua "Zilitumwa" au "Hazikutumwa" (+ maelezo). Inaandikwa kwenye audit_log; "Imeshindikana" inaweza kutumwa tena au kufutwa. | Majaribio ya DB (ruhusa, audit, kutuma tena). Kivinjari: Inatumwa… → Rekebisha → Imeshindikana "imewekwa kwa mkono". |

**Majaribio baada ya awamu ya 2:** `npm test` → 77: **76 PASS, 0 FAIL, 1 SKIP**. Patch `2026-11-10_audit_fixes.sql` (migrations 32+33) ilijaribiwa kwenye database yenye migrations 00–31 (kama Supabase halisi): iliingia mara mbili bila kosa, data iliyokuwepo ilibaki.

> **Muhimu kwa kupandisha:** skrini mpya zinaita functions mpya (`leaders_contributions` yenye vigezo 4, `sms_resolve`, n.k.). **Patch iendeshwe kwenye Supabase kwanza**, ndipo faili za JS zipandishwe GitHub/Vercel — vinginevyo ripoti ya viongozi na SMS zitaonyesha kosa.

## Muhtasari wa matokeo (ukaguzi wa kwanza)

| No. | Kipengele | Hali | Tatizo lililopatikana | Hatua iliyochukuliwa |
|---|---|---|---|---|
| 01 | Jumla zinazobonyezeka | **PASS (kwa sehemu)** | Jumla za Zaka, Miamala, Vigango → Jumuiya → Familia → Muumini, kampeni za jumuiya na Zaka ya viongozi zinabonyezeka; jumla 6 zilizojaribiwa kwenye kivinjari zililingana na miamala yake 100%. **Hazibonyezeki:** Dashibodi, ukurasa wa *Ripoti*, *Michango na Kampeni* (parokia nzima), na safu "Michango yake / Ya familia / Deni" kwenye ripoti ya viongozi. Safu ya "Kumbukumbu" (reference) ilikuwa haionekani kwenye orodha (ilikuwa kwenye Excel tu). | Kumbukumbu ya malipo sasa inaonekana chini ya namba ya muamala (`txns.js`). Kufanya Dashibodi/Ripoti zibonyezeke = pendekezo. |
| 02 | Kurekebisha mgawanyo (Gawanya upya / Rekebisha) | **PASS** | Imejaribiwa kwenye kivinjari: TZS 3,000 Nov → TZS 2,000 Nov + TZS 1,000 familia nyingine Sep. Jumla ilibaki 3,000, ripoti ya Zaka ilionyesha Sep 1,000 / Nov 23,000, miamala ya awali inabaki (reversal), risiti mpya zilitolewa, mfumo ulionyesha "Imebaki TZS 1,000" kabla ya kulinganisha. DB inakataa mgawanyo usiolingana, mlipaji mara mbili, na mtumiaji asiye na ruhusa; audit_log inaandika aliyefanya, muda, mgawanyo wa zamani na mpya. | Hakuna kilichohitajika. |
| 03 | Umri / mwaka wa kuzaliwa | **PASS** | Fomu ina "Umri" na "Mwaka wa kuzaliwa" vinavyojazana; DB inahifadhi `birth_year` tu (hakuna mgongano), umri unahesabiwa kila mwaka upya; waumini bila mwaka wanaonyesha "—". | Hakuna. Pendekezo dogo: "Hali" ya muumini inaonyesha maneno ya Kiingereza (`active`, `moved`…). |
| 04 | Viambatisho vya malipo | **PASS** | Kivinjari: PNG ilipakiwa na kufunguliwa; `.txt` ilikataliwa ("Weka picha au PDF tu"); PDF ya MB 11 ilikataliwa ("mwisho MB 10"). Ukaguzi uko pande 3: kivinjari, function `add_payment_attachment`, na bucket ya Storage (binafsi, MB 10, aina maalum). Anayeona malipo ndiye anayeona uthibitisho. | Hakuna. **Kasoro ndogo:** faili likikataliwa, fomu inajifunga — mtumiaji lazima aanze upya. **Hatari ndogo:** `add_payment_attachment` haikagui kuwa njia ya faili inaanza na id ya muamala husika. |
| 05 | Vyeo vya uongozi | **PASS** | Msimamizi anaunda/hariri/zima vyeo (Mipangilio → Cheo kipya); vyeo vimegawanywa Jumuiya/Kigango/Parokia; mtu mmoja vyeo vingi; cheo kinamalizwa (`ended`) badala ya kufutwa. | Hakuna. Angalia pia 08 (vyeo vilivyoisha haviingii ripoti ya viongozi). |
| 06 | Kuhamisha / kufuta muumini | **FAIL → IMEREKEBISHWA (kwa sehemu)** | Kuhamisha: PASS (miamala, risiti, tarehe na kiasi havibadiliki; audit_log). Kufuta: **(a)** sababu ilikuwa inaombwa kwenye skrini tu — API ilikubali kufuta bila sababu; **(b)** ni *hard delete*: rekodi ya muumini inafutwa (nakala yake inabaki ndani ya `audit_log`), na **mahudhurio yake yanafutwa pamoja naye** (`on delete cascade`). Malipo yanabaki kwa jina lake na familia. | (a) Imerekebishwa: migration 32 — DB sasa inakataa kufuta bila sababu (herufi ≥ 3). (b) Pendekezo: badala ya kufuta, weka `membership_status = 'removed'` (soft delete) ili historia ya mahudhurio ibaki. |
| 07 | Mwaka mpya wa fedha | **PASS** | Malipo ya kwanza ya mwaka mpya yanaufungua mwaka wenyewe; Zaka ya Desemba inahesabiwa kwa mwaka wake (kwa `period_month`) hata ikilipwa Januari; miaka iliyofungwa inakataa malipo; ripoti za mwaka uliopita zinapatikana (chagua mwaka juu). | Hakuna. |
| 08 | Ripoti ya michango ya viongozi | **PASS (kwa sehemu)** | Inaonyesha jina, vyeo, jumuiya, Zaka, miezi (x/y), michango yake, ya familia, ahadi, deni, jumla; vichujio: mwaka, kigango/jumuiya, ngazi ya cheo. Zaka inabonyezeka. **Haipo:** kichujio cha cheo maalum (mf. Katibu tu); viongozi ambao cheo chao kimeisha mwaka huo hawaonekani (inasoma vyeo `active` tu). | Pendekezo. |
| 09 | Usajili kwa namba ya simu | **PASS** | `admin_create_user`: jina, simu, nenosiri (≥6), nafasi, kuunganisha na muumini; namba inasafishwa (0712…, +255…, 712…); namba mbili zinazofanana zinakataliwa; akaunti za barua pepe zinaendelea; msimamizi anaweza kubadili akaunti ya barua pepe kuwa ya simu. | Hakuna. |
| 10 | Mahudhurio | **PASS** | Hali tatu (present/excused/absent = Alikuja/Ruhusa/Hakuja); mahudhurio moja kwa kila muumini kwa kila kikao (primary key); kikao kimoja kwa tarehe+jina; tarehe ya baadaye inakataliwa; anayerekodi lazima awe na `attendance.record` kwenye jumuiya hiyo; asilimia ya mwaka kupitia `attendance_summary`. | Hakuna (angalia 06b: kufuta muumini kunafuta mahudhurio yake). |
| 11 | Kuingia kwa namba ya simu | **FAIL → IMEREKEBISHWA** | Kivinjari: namba isiyojulikana/nenosiri baya → ujumbe mmoja wa jumla (haufichui kipi kimekosewa) ✓; kuingia kwa barua pepe ✓; nenosiri linahifadhiwa na Supabase Auth (bcrypt) ✓; kutoka (logout) ✓. **Hitilafu ya usalama:** akaunti iliyosimamishwa ilitolewa nje na kivinjari tu — database (`has_perm`) haikuangalia hali ya akaunti, kwa hiyo mtu aliyesimamishwa angeweza kuendelea kusoma na kurekodi malipo kupitia API kwa token yake. | Imerekebishwa: migration 32 — `has_perm` na `has_perm_anywhere` sasa zinarudisha `false` kwa akaunti isiyo `active`. Jaribio jipya linathibitisha (haoni miamala, hawezi kurekodi; akirudishwa, ruhusa zinarudi). Muda wa session = mipangilio ya Supabase Auth (haijajaribiwa). |
| 12 | Matangazo na SMS | **BLOCKED (SMS) / PASS (Matangazo)** | Matangazo: kwa wote, ofisi, viongozi, waumini, vigango/jumuiya maalum ✓ (jaribio la DB). SMS: orodha ya namba inafungwa inapoundwa, namba moja mara moja (hakuna marudio), inatumwa mara moja tu, kumbukumbu (`sms_messages`, `sms_recipients`, audit_log) ✓. **Haikutumwa SMS halisi** — hakuna funguo za Beem/NextSMS kwenye mazingira ya majaribio. **Pengo:** chaguo "waliolipa Zaka" linatumia alama *ni mlipa zaka* (`is_zaka_payer`), si *amelipa kweli* mwaka/mwezi huu. Ujumbe ukikwama kwenye "sending" hakuna kitufe cha kuurekebisha. | Pendekezo. |
| 13 | Zaka ya jumuiya kugawanywa | **PASS** | Majaribio ya DB: 200,000 → familia 1 + wanafamilia 2, risiti moja kila mstari, zote Zaka ya mwezi sahihi; mgawanyo usiolingana unakataliwa na hakuna kinachohifadhiwa; mlipaji mara mbili anakataliwa; asiye na `finance.record` anakataliwa; idempotency inazuia kurudia. | Hakuna. |

## Takwimu

1. **Vipengele vilivyokaguliwa:** 13
2. **Vinafanya kazi vizuri (PASS):** 9 — 02, 03, 04, 05, 07, 09, 10, 13, na Matangazo ya 12
3. **Vina kasoro (PASS kwa sehemu):** 2 — 01 (jumla nyingine hazibonyezeki), 08 (kichujio cha cheo, vyeo vilivyoisha)
4. **Havijatekelezwa kikamilifu:** soft delete ya muumini (06b); SMS kwa "waliolipa Zaka kweli" (12)
5. **Vimerekebishwa wakati wa ukaguzi:** 06 (sababu ya kufuta), 11 (akaunti iliyosimamishwa), 01 (safu ya Kumbukumbu)
6. **Vinahitaji huduma ya nje:** 12 SMS (Beem Africa au NextSMS, Sender ID iliyoidhinishwa)

## 7. Mabadiliko ya database

- **Mpya:** `database/migrations/20261015_32_audit_fixes.sql`, na nakala yake ya kuendeshwa kwenye Supabase halisi: `database/patches/2026-11-10_audit_fixes.sql`
  - `has_perm`, `has_perm_anywhere`: zinahitaji `profiles.status = 'active'`
  - `delete_parishioner`: inahitaji sababu
  - Haibadilishi data yoyote; inaweza kuendeshwa tena bila madhara.
- **Patches za zamani:** `2026-10-31_zaka_miamala_vyeo.sql` = migrations 22–25, `2026-11-02_hatua_6_12.sql` = migrations 26–31. Nimethibitisha kuwa maudhui yake ni sawa kabisa na migrations. **Sikuweza kuthibitisha kama zimeshaendeshwa kwenye Supabase halisi** (sikuruhusiwa kugusa database halisi). Zote zimeandikwa "Safe to run again".

## 8. Faili zilizobadilishwa

| Faili | Badiliko |
|---|---|
| `database/migrations/20261015_32_audit_fixes.sql` | mpya (marekebisho mawili ya DB) |
| `database/patches/2026-11-10_audit_fixes.sql` | mpya (sawa na migration 32, kwa Supabase halisi) |
| `database/supabase_setup.sql` | imetengenezwa upya (`npm run setup:sql`): ina migration 32 na mwisho wa mistari umesawazishwa (ilikuwa na CRLF iliyofanya jaribio moja lishindwe) |
| `assets/js/parish/txns.js` | Kumbukumbu ya malipo inaonekana kwenye orodha ya miamala |
| `tests/db/audit_fixes.test.mjs` | majaribio mapya 2 |
| `SYSTEM_AUDIT_REPORT.md` | ripoti hii |
| **Awamu ya 2:** | |
| `database/migrations/20261015_33_maboresho.sql` | mpya: soft delete, SMS ya zaka (iliyolipwa / haijalipwa), `sms_resolve`, `leaders_contributions` (cheo, vyeo vilivyoisha), `ledger_drill` (`gyear`, `family_only`) |
| `database/patches/2026-11-10_audit_fixes.sql` | sasa ina migrations 32 **na** 33 |
| `assets/js/parish/core.js` | majina ya hali ya muumini (Kiswahili); kutafuta mlipaji hakuonyeshi walioondolewa |
| `assets/js/parish/views-finance.js` | Dashibodi na Kampeni: jumla zinabonyezeka |
| `assets/js/parish/views-accounting.js` | Ripoti: jumla zinabonyezeka |
| `assets/js/parish/views-community.js` | ripoti ya viongozi (vichujio, vyeo vilivyoisha, jumla zinabonyezeka); SMS (makundi ya zaka, Rekebisha hali) |
| `assets/js/parish/views-registry.js` | kuondoa muumini (maneno mapya), hali kwa Kiswahili, kumrudisha |
| `assets/js/parish/views-units.js` | familia: "Wasio hai" |
| `assets/js/parish/txns.js` | vichujio vipya vya drill |
| `tests/db/maboresho.test.mjs` | majaribio mapya 4 |
| `tests/db/hatua_6_12.test.mjs` | jaribio la kufuta muumini limesasishwa kwa soft delete |

## 9. Majaribio yaliyoendeshwa (matokeo halisi)

**Kabla ya marekebisho:** `npm test` → 71 majaribio: 69 PASS, 1 FAIL (`supabase_setup.sql contains every migration` — CRLF), 1 SKIP (import ya Excel inahitaji faili la siri `MINGA_PRIVATE_DIR`).

**Majaribio mapya (yalishindwa kwanza, kuthibitisha hitilafu):**
- akaunti iliyosimamishwa bado ilikuwa na `has_perm = true` ✖
- kufuta muumini bila sababu kulikubaliwa ✖

**Baada ya marekebisho:** `npm test` → 73 majaribio: **72 PASS, 0 FAIL, 1 SKIP**.

**Kivinjari (server ya ndani, akaunti ya demo Mhasibu):**
- kuingia: namba isiyojulikana + nenosiri baya → "Namba ya simu au nenosiri si sahihi." ✓; kuingia kwa demo ✓
- menyu: Dashibodi juu ya Vigango na Jumuiya ✓
- jumla 6 za Zaka zilibonyezwa → jumla ya miamala = kiasi kilichobonyezwa (6/6) ✓
- Rekebisha TZS 3,000 → 2,000 Nov + 1,000 Sep familia nyingine ✓ (risiti mpya MNG-2026-000050/51)
- viambatisho: .txt imekataliwa ✓, PDF MB 11 imekataliwa ✓, PNG imepakiwa na kufunguliwa ✓
- kurasa za Dashibodi, Miamala, Ripoti, Kampeni, Viongozi zinafunguka

**Hayakujaribiwa:** kutuma SMS halisi; Storage na Auth ya Supabase halisi; muda wa session kuisha; mpangilio wa simu (mobile) kwa kina; import ya Excel.

## 10. Hatari zilizobaki na mapendekezo

**Haraka (usalama):**
1. **Akaunti za demo ziko wazi kwenye repo ya umma** (`assets/js/config.js`: `DEMO: true`, nenosiri `Demo@2026`, pamoja na `superadmin@minga.demo`). Kama `demo_accounts.sql` iliendeshwa kwenye Supabase halisi, mtu yeyote anaweza kuingia kama Msimamizi Mkuu. → Endesha `database/demo/demo_remove.sql`, weka `DEMO: false`.
2. **Endesha `database/patches/2026-11-10_audit_fixes.sql`** kwenye Supabase halisi (SQL Editor) baada ya kuhakikisha patches za 31 Okt na 2 Nov zimeshaendeshwa.

**Ya kuongeza:**
3. ~~Soft delete ya muumini~~ — **imefanyika (awamu ya 2)**.
4. ~~Jumla za Dashibodi, Ripoti, Kampeni na ripoti ya viongozi zibonyezeke~~ — **imefanyika**. Bado hazibonyezeki: "Fedha zilizopo" na "Deni" (si miamala ya mapato).
5. ~~SMS kwa waliolipa zaka kweli~~ — **imefanyika** (pamoja na "hawajalipa").
6. ~~Ripoti ya viongozi: kichujio cha cheo, vyeo vilivyoisha~~ — **imefanyika**. Kumbuka: cheo kinachoendelea kinaonekana kwenye kila mwaka (kama awali), kwa sababu vyeo vingi havina tarehe ya kuanza.
7. ~~Kitufe cha kurekebisha SMS iliyokwama~~ — **imefanyika**.
8. Akaunti ikisimamishwa, izuiwe pia kwenye Supabase Auth (`banned_until`) ili isiweze kuingia kabisa.

**Ya kurekebisha (madogo):**
9. Fomu ya kiambatisho isijifunge faili likikataliwa.
10. `add_payment_attachment` ikague kuwa njia ya faili inaanza na id ya muamala.
11. ~~Hali ya muumini ionyeshwe kwa Kiswahili~~ — **imefanyika** (Hai, Hashiriki, Amehama, Marehemu, Ameondolewa).
12. `docs/IMPLEMENTATION_STATUS.md` imepitwa na wakati (inasema SMS haijajengwa).
13. `database/patches/` ina nakala za migrations za zamani; patch ya 31 Okt inasema inachukua nafasi ya `2026-10-31_zaka_split.sql`, lakini faili hiyo haipo tena — kwa hiyo hakuna mgongano wa sasa.

**Ya kupunguza:**
14. Futa vitufe vya demo kwenye ukurasa wa kuingia mara mfumo unapoanza kutumika.
15. Faili za `database/patches/` zilizokwisha endeshwa zinaweza kuhamishiwa `database/patches/archive/` ili kuepuka kuendesha patch isiyo sahihi kwa makosa.
