"""
Build the (PRIVATE) import package from extract_workbook.py output.

    python -I tools/migration/build_import.py <private_dir>

Reads  <private_dir>/workbook.json  and tools/migration/mapping.json
Writes <private_dir>/import/minga_import.sql   SQL to run as database owner
       <private_dir>/import/PREVIEW.md         what will be imported, for approval
       <private_dir>/import/issues.json        every row that needs a human decision

Nothing here is executed against a database; an administrator reviews
PREVIEW.md, then runs minga_import.sql (Supabase SQL editor or psql).
"""
import sys, os, re, json, uuid, collections, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, 'mapping.json'), encoding='utf-8'))
NS = uuid.UUID('6f1c2a3e-9b6d-4e0a-8f5e-4d4b1d0c2a11')       # deterministic ids => re-runs are idempotent
IN_KIND = re.compile(r'MIFUGO|MAZAO|MAHINDI|MAHARAGE|UWELE|DEBE|VITU HALISI|\bKG\b')


def key(s):
    return re.sub(r'[^A-Z0-9]+', ' ', str(s or '').upper()).strip()


def q(s):
    return 'null' if s is None else "'" + str(s).replace("'", "''") + "'"


def uid(*parts):
    return str(uuid.uuid5(NS, '|'.join(str(p) for p in parts)))


def main(pdir):
    W = json.load(open(os.path.join(pdir, 'workbook.json'), encoding='utf-8'))
    out_dir = os.path.join(pdir, 'import'); os.makedirs(out_dir, exist_ok=True)
    sha = W['sha256']

    # ---------------- lookups
    label_to_cat = {}
    for c in M['categories']:
        label_to_cat[key(c['code'])] = c['code']
        for l in c['labels']: label_to_cat[key(l)] = c['code']
    cats = {c['code']: c for c in M['categories']}
    jum_by_ledger = {j['ledger']: j for j in M['jumuiya'] if j.get('ledger')}
    jum_by_register = {j['register']: j for j in M['jumuiya'] if j.get('register')}
    jum_alias = collections.defaultdict(list)          # alias -> [jumuiya]
    for j in M['jumuiya']:
        for a in {key(x) for x in j['aliases'] + [j['name']]}: jum_alias[a].append(j)
    group_alias = {key(a): g for g in M['parish_groups'] for a in g['aliases'] + [g['name']]}
    kig_alias = {key(a): k['name'] for k in M['kigango'] for a in k['aliases'] + [k['name']]}
    months = {key(k): v for k, v in M['zaka_months'].items()}

    def find_jumuiya(text, kigango=None):
        c = jum_alias.get(key(text), [])
        if kigango: c = [j for j in c if j['kigango'] == kigango]
        return c[0] if len(c) == 1 else None

    # ---------------- register: families and parishioners
    families, people, fam_ids = [], [], {}
    person_index = collections.defaultdict(list)     # (jumuiya name, normalized person name) -> [person id]
    for p in W['people']:
        j = jum_by_register[p['block']]
        fk = (p['block'], p['family_no'])
        if fk not in fam_ids:
            fam_ids[fk] = uid('family', *fk)
            families.append({'id': fam_ids[fk], 'jumuiya': j['name'], 'code': str(p['family_no']), 'members': [], 'block': p['block'], 'row': p['row']})
        fam = next(f for f in reversed(families) if f['id'] == fam_ids[fk])
        pid = uid('person', p['block'], p['row'])
        g = {'ME': 'male', 'KE': 'female', 'F': 'female', 'FE': 'female'}.get(p['gender'])
        phone = re.sub(r'\D', '', p['phone'])
        phone = ('0' + phone if len(phone) == 9 else phone) or None
        rec = {'id': pid, 'family_id': fam['id'], 'jumuiya': j['name'], 'name': re.sub(r'\s+', ' ', p['name']).strip(),
               'gender': g, 'relation': p['relation'] or None, 'zaka': p['zaka_flag'] == 'ZAKA', 'phone': phone,
               'legacy': {'sheet': 'PAROKIA DATA BASE', 'row': p['row'], 'family_no': p['family_no'], 'sno': p['sno'],
                          'age_recorded': p['age'], 'cheo': p['cheo'] or None}}
        people.append(rec); fam['members'].append((p['sno'], p['relation'], rec))
        person_index[(j['name'], key(p['name']))].append(pid)
    for f in families:
        mem = sorted(f['members'], key=lambda m: m[0])
        head = next((m for m in mem if m[1] == 'BABA'), None) or next((m for m in mem if m[1] == 'MAMA'), None) or mem[0]
        f['head_id'] = head[2]['id']
        f['name'] = 'Familia ya ' + head[2]['name']

    # ---------------- family pledges (PANGIWA / AHADI in the register)
    pledges = []
    for p in W['people']:
        fid = fam_ids[(p['block'], p['family_no'])]
        for label, v in p['pledges'].items():
            cat, yr = label.split('-')
            if v['pledged'] and v['pledged'] > 0:
                pledges.append({'id': uid('pledge', fid, cat, yr), 'family_id': fid, 'category': cat, 'year': int(yr),
                                'amount': v['pledged'], 'legacy': {'sheet': 'PAROKIA DATA BASE', 'cell': v['cell'],
                                                                   'paid_typed_in_register': v['paid_typed']}})
    seen = set(); dup_pledges = []
    for pl in pledges:
        k = (pl['family_id'], pl['category'], pl['year'])
        if k in seen: dup_pledges.append(pl)
        seen.add(k)
    pledges = [pl for pl in pledges if pl not in dup_pledges]

    # ---------------- campaign targets 2026 (MICHANGO-2026)
    head_to_cat = {'POSHO MAKATEKISTA & MAFRATERI': 'MAKATEKISTA', 'KUWAPONGEZI MAPADRI NA MAKATEKISTA': 'KUPONGEZA_MAPADRI',
                   'KUMPONGEZA BABA ASKOFU': 'ZAWADI_ASKOFU', 'ZAWADI KRISTO MFUFUKA': 'KRISTO_MFUFUKA',
                   'KONGAMANO LA UTOTO': 'KONGAMANO_UTOTO', 'KUSOMESHA MAFRATERI': 'MAFRATERI', 'RADIO MARIA': 'RADIO_MARIA',
                   'MCHANGO WA VIWAWA': 'VIWAWA', 'KUMPONGEZA KATEKISTA': 'PONGEZI_MAKATEKISTA'}
    targets, issues = [], []
    jum_targets = set()
    kig_rows = []
    for a in W['assessments_2026']:
        grp = key(a['group']).replace('KIGANGO CHA ', '').replace('KISINAGOGI CHA ', '').replace('MT EDWARD ', '')
        kig = kig_alias.get(grp)
        if key(a['unit']) in kig_alias:          # kigango-level line (rows 50-53)
            kig_rows.append((kig_alias[key(a['unit'])], a)); continue
        # the group heading is not always in the same column (C21 vs B10/D34), so fall back to a unique name
        j = find_jumuiya(a['unit'], kig) or find_jumuiya(a['unit'])
        if not j:
            issues.append({'severity': 'error', 'sheet': 'MICHANGO-2026', 'row': a['row'], 'issue': f"unknown jumuiya {a['unit']!r} in {a['group']!r}"}); continue
        for h, v in a['targets'].items():
            cat = head_to_cat.get(key(h).replace(' ', ' ')) or head_to_cat.get(h)
            if not cat: issues.append({'severity': 'warning', 'sheet': 'MICHANGO-2026', 'row': a['row'], 'issue': f'unmapped column {h!r}'}); continue
            targets.append({'org': f"jumuiya|{j['name']}", 'category': cat, 'amount': v, 'cell': f"MICHANGO-2026!row{a['row']}"})
            jum_targets.add((j['kigango'], cat))
    for kig, a in kig_rows:
        for h, v in a['targets'].items():
            cat = head_to_cat.get(h)
            if cat and (kig, cat) not in jum_targets:
                targets.append({'org': f'kigango|{kig}', 'category': cat, 'amount': v, 'cell': f"MICHANGO-2026!row{a['row']}"})

    # ---------------- ledger transactions
    rows, stats = [], collections.Counter()
    for t in W['transactions']:
        legacy = {'sheet': 'AKAUNTI BOOK-MIAMALA YOTE', 'row': t['row'], 'ledger_year': t['ledger_year'], 'block': t['block'],
                  'section': t['section'], 'purpose': t['purpose'], 'receipt_no': t['receipt_no'], 'method': t['method'],
                  'received_by': t['received_by'], 'kigango_col': t['kigango'], 'jumuiya_col': t['jumuiya']}
        row_issues = []
        label = t['purpose'] or t['section'] or ''
        cat = label_to_cat.get(key(label))
        if not cat and IN_KIND.search(key(label)):
            cat = 'VITU_HALISI'
        if not cat and t['section']:
            cat = label_to_cat.get(key(t['section']))
            if cat: row_issues.append(f'purpose {label!r} not recognised; used section heading')
        if not cat:
            cat = 'HAIJULIKANI'; row_issues.append(f'unknown purpose {label!r}')
        if t['purpose'] and t['section'] and label_to_cat.get(key(t['purpose'])) and label_to_cat.get(key(t['section'])) \
                and label_to_cat[key(t['purpose'])] != label_to_cat[key(t['section'])]:
            legacy['filed_under'] = t['section']           # informational: Excel block heading differs from the row's purpose
        if cat == 'VITU_HALISI':
            row_issues.append('in-kind contribution (goods): confirm the recorded value before it counts as money')
        if cat == 'HAIJULIKANI':
            row_issues.append('suspense category: classify before posting')

        # attribution
        org = None
        if t['block'] in jum_by_ledger:
            org = f"jumuiya|{jum_by_ledger[t['block']]['name']}"
        elif t['block'] in M['ledger_kigango_blocks'] or t['block'] is None:
            kig = M['ledger_kigango_blocks'].get(t['block']) or kig_alias.get(key(t['kigango']))
            j = find_jumuiya(t['jumuiya'], kig) if kig else None
            if j: org = f"jumuiya|{j['name']}"
            elif key(t['jumuiya']) in group_alias: org = f"group|{group_alias[key(t['jumuiya'])]['name']}"
            elif kig: org = f'kigango|{kig}'
            if t['block'] is None:
                row_issues.append('vigango jumuiya section (rows 13877+): may overlap the kigango blocks above — confirm it is not counted twice')
        else:                                        # parish block
            if key(t['jumuiya']) in group_alias: org = f"group|{group_alias[key(t['jumuiya'])]['name']}"
            else:
                j = find_jumuiya(t['jumuiya'])
                if j: org = f"jumuiya|{j['name']}"

        # dates
        date = t['date']
        if not date:
            date = f"{t['ledger_year']}-12-31"
            legacy['date_assumed'] = True
            row_issues.append(f"date {t['date_note']}{': ' + t['date_raw'] if t['date_raw'] else ''} — placeholder {date} set, correct it before posting")
        elif not date.startswith(('2024', '2025', '2026')):
            legacy['date_recorded'] = date; legacy['date_assumed'] = True
            row_issues.append(f"date {date} outside 2024–2026 — placeholder {t['ledger_year']}-12-31 set, correct it before posting")
            date = f"{t['ledger_year']}-12-31"

        # campaign year / zaka month
        m_year = re.search(r'(20\d\d)', label)
        year = int(m_year.group(1)) if m_year else t['ledger_year']
        campaign_year = year if cats[cat].get('pledge') else None
        period = None
        if cats[cat].get('period'):
            mm = next((n for name, n in months.items() if name in key(label)), None)
            num = re.match(r'^\s*(\d{1,2})\s*[:\s]', label)
            if mm and num and int(num.group(1)) != mm:
                row_issues.append(f'zaka label {label!r}: number {num.group(1)} and month name disagree; month name used')
            if not mm:
                mm = int(date[5:7]); legacy['period_from_date'] = True
            period = f'{year}-{mm:02d}-01'

        # payer -> parishioner (exact name match inside the same jumuiya only)
        pid = None
        if org and org.startswith('jumuiya|'):
            cand = person_index.get((org.split('|', 1)[1], key(t['payer'])), [])
            if len(cand) == 1: pid = cand[0]; stats['payer_linked'] += 1
        if t['receipt_no'] is None: legacy['no_receipt_no'] = True; stats['no_receipt_no'] += 1

        status = 'pending' if row_issues and any(k in ' '.join(row_issues) for k in
                                                 ('placeholder', 'in-kind', 'suspense', 'rows 13877+', 'outside 2024')) else 'posted'
        stats[status] += 1
        rows.append({'key': uid('txn', sha, t['row'], t['col']), 'amount': t['amount'], 'txn_date': date, 'period_month': period,
                     'category': cat, 'campaign_year': campaign_year, 'org': org, 'parishioner_id': pid,
                     'payer_name': t['payer'] or None, 'payment_method': M['payment_methods'].get(t['method'].upper(), 'other'),
                     'description': None, 'legacy_receipt_no': str(t['receipt_no']) if t['receipt_no'] is not None else None,
                     'legacy': legacy, 'status': status, 'issues': row_issues})
        for i in row_issues:
            issues.append({'severity': 'warning' if status == 'posted' else 'review', 'sheet': 'AKAUNTI BOOK-MIAMALA YOTE',
                           'row': t['row'], 'issue': i, 'amount': t['amount']})

    dup_receipts = collections.Counter(r['legacy_receipt_no'] for r in rows if r['legacy_receipt_no'])
    for rn, c in dup_receipts.items():
        if c > 1: issues.append({'severity': 'warning', 'sheet': 'AKAUNTI BOOK-MIAMALA YOTE', 'issue': f'receipt number {rn} used on {c} rows'})

    # ---------------- subtotal parity targets (block-level)
    explain = {(434, 2025): 'Excel SUM range includes two other subtotals (L355, L365): double counted 945,000',
               (434, 2026): 'Excel SUM range includes the header cell M367 (the year label 2026) as money',
               (601, 2025): 'Excel SUM range includes subtotal L494: double counted 4,039,150',
               (6638, 2026): 'Excel SUM range includes subtotal M6609: double counted 50,000'}
    subs = []
    for s in W['subtotals']:
        for yr, v in s['sums'].items():
            if v['range'] and isinstance(v['excel'], (int, float)):
                col = 'L' if str(yr) == '2025' else 'M'
                subs.append({'cell': f"{col}{s['row']}", 'key': s['key'], 'formula': v['formula'], 'excel': v['excel'],
                             'r1': v['range'][0], 'r2': v['range'][1], 'year': int(yr), 'explanation': explain.get((s['row'], int(yr)))})

    # ---------------- campaigns needed
    need_campaigns = sorted({(r['category'], r['campaign_year']) for r in rows if r['campaign_year']} |
                            {(p['category'], p['year']) for p in pledges} | {(t['category'], 2026) for t in targets})

    # ---------------- SQL
    sql = ['-- PRIVATE: generated import for Minga Parish. Contains personal and financial data. Do not commit.',
           f'-- source workbook sha256 {sha}', 'begin;', '',
           "do $imp$ declare v_parish uuid := public.default_parish_id(); v_batch uuid; n int; begin",
           f"  if exists (select 1 from public.import_batches where source_sha256 = {q(sha)} and status = 'imported') then",
           "    raise exception 'Workbook hii imeshaingizwa (this workbook was already imported)';",
           "  end if;",
           f"  insert into public.import_batches (parish_id, source_name, source_sha256, status, summary) values (v_parish, {q(W['source'])}, {q(sha)}, 'approved',",
           f"    {q(json.dumps({'transactions': len(rows), 'families': len(families), 'parishioners': len(people), 'pledges': len(pledges), 'targets': len(targets), 'stats': stats}))}::jsonb)",
           "    returning id into v_batch;",
           "  perform set_config('minga.import_batch', v_batch::text, true);"]
    for cat, yr in need_campaigns:
        c = cats[cat]
        sql.append(f"  insert into public.campaigns (parish_id, category_id, financial_year_id, campaign_year, name, starts_on, ends_on, recurs_annually)"
                   f" select v_parish, id, (select id from public.financial_years where parish_id = v_parish and label = '{yr}'), {yr}, {q(c['name_sw'] + ' ' + str(yr))},"
                   f" '{yr}-01-01', '{yr}-12-31', true from public.contribution_categories where parish_id = v_parish and code = {q(cat)}"
                   f" on conflict (parish_id, category_id, campaign_year, name) do nothing;")
    for f in families:
        sql.append(f"  insert into public.families (id, parish_id, family_code, family_name, jumuiya_id, legacy_ref) values ({q(f['id'])}, v_parish, {q(f['code'])}, {q(f['name'])},"
                   f" public.org_unit_by_key(v_parish, {q('jumuiya|' + f['jumuiya'])}), {q(json.dumps({'sheet': 'PAROKIA DATA BASE', 'block': f['block'], 'first_row': f['row']}))}::jsonb) on conflict (id) do nothing;")
    for p in people:
        sql.append(f"  insert into public.parishioners (id, parish_id, full_name, gender, phone, family_id, relationship, jumuiya_id, is_zaka_payer, legacy_ref) values ("
                   f"{q(p['id'])}, v_parish, {q(p['name'])}, {q(p['gender'])}, {q(p['phone'])}, {q(p['family_id'])}, {q(p['relation'])},"
                   f" public.org_unit_by_key(v_parish, {q('jumuiya|' + p['jumuiya'])}), {str(p['zaka']).lower()}, {q(json.dumps(p['legacy']))}::jsonb) on conflict (id) do nothing;")
    for f in families:
        sql.append(f"  update public.families set head_parishioner_id = {q(f['head_id'])} where id = {q(f['id'])};")
    for pl in pledges:
        sql.append(f"  insert into public.pledges (id, parish_id, campaign_id, family_id, amount, pledged_on, jumuiya_id, kigango_id, legacy_ref)"
                   f" select {q(pl['id'])}, v_parish, cp.id, f.id, {pl['amount']}, '{pl['year']}-01-01', f.jumuiya_id, public.org_ancestor_of_type(f.jumuiya_id, 'kigango'), {q(json.dumps(pl['legacy']))}::jsonb"
                   f" from public.families f, public.campaigns cp join public.contribution_categories c on c.id = cp.category_id"
                   f" where f.id = {q(pl['family_id'])} and c.code = {q(pl['category'])} and cp.campaign_year = {pl['year']} and cp.parish_id = v_parish on conflict (id) do nothing;")
    for t in targets:
        sql.append(f"  insert into public.campaign_targets (campaign_id, org_unit_id, basis, fixed_amount, notes)"
                   f" select cp.id, public.org_unit_by_key(v_parish, {q(t['org'])}), 'fixed', {t['amount']}, {q('Imetoka ' + t['cell'])}"
                   f" from public.campaigns cp join public.contribution_categories c on c.id = cp.category_id where cp.parish_id = v_parish and c.code = {q(t['category'])} and cp.campaign_year = 2026"
                   f" on conflict (campaign_id, org_unit_id) do nothing;")
    for i in range(0, len(rows), 400):
        chunk = json.dumps(rows[i:i + 400], ensure_ascii=False, default=str)
        sql.append(f"  n := public.import_legacy_transactions(v_batch, $j${chunk}$j$::jsonb);")
    for i in issues:
        sql.append(f"  insert into public.import_issues (batch_id, severity, sheet, cell_ref, issue, detail) values (v_batch, {q('warning' if i['severity'] == 'review' else i['severity'])},"
                   f" {q(i.get('sheet'))}, {q(str(i.get('row', '')))}, {q(i['issue'])}, {q(json.dumps({'amount': i.get('amount')}))}::jsonb);")
    sql.append(f"  perform public.reconcile_legacy_subtotals(v_batch, $j${json.dumps(subs, ensure_ascii=False, default=str)}$j$::jsonb);")
    sql.append("  update public.import_batches set status = 'imported', approved_at = now() where id = v_batch;")
    sql += ['end $imp$;', 'commit;', '', '-- refresh planner statistics after the bulk load', 'analyze;', '']
    open(os.path.join(out_dir, 'minga_import.sql'), 'w', encoding='utf-8', newline='\n').write('\n'.join(sql))
    json.dump(issues, open(os.path.join(out_dir, 'issues.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    # ---------------- preview
    by_cat = collections.defaultdict(lambda: collections.Counter())
    for r in rows: by_cat[r['category']][(r['status'], r['legacy']['ledger_year'])] += r['amount']
    lines = ['# Minga Parish — legacy import preview', '',
             f"Source: `{W['source']}` (sha256 `{sha[:16]}…`), extracted {W['extracted_at'][:16]}", '',
             '| Item | Count |', '|---|---:|',
             f'| Families | {len(families)} |', f'| Parishioners | {len(people)} |',
             f'| Family pledges (Mavuno/Ujenzi, from register PANGIWA) | {len(pledges)} |',
             f'| Duplicate pledge cells ignored | {len(dup_pledges)} |',
             f'| Campaign targets 2026 (MICHANGO-2026) | {len(targets)} |',
             f"| Ledger rows → posted | {stats['posted']} |", f"| Ledger rows → pending review | {stats['pending']} |",
             f"| Rows without a receipt number | {stats['no_receipt_no']} |",
             f"| Payers linked to a register person (exact name, same jumuiya) | {stats['payer_linked']} |",
             f'| Subtotals checked for parity | {len(subs)} |', '',
             '## Amounts by category (TZS)', '', '| Category | 2025 posted | 2026 posted | Pending review |', '|---|---:|---:|---:|']
    for cat in sorted(by_cat):
        c = by_cat[cat]
        pend = sum(v for (s, y), v in c.items() if s == 'pending')
        lines.append(f"| {cats[cat]['name_sw']} | {c[('posted', 2025)]:,.0f} | {c[('posted', 2026)]:,.0f} | {pend:,.0f} |")
    tot = lambda s: sum(r['amount'] for r in rows if r['status'] == s)
    lines += [f"| **Total** | | **{tot('posted'):,.0f}** posted | **{tot('pending'):,.0f}** |", '',
              '## Issues needing a decision', '']
    ic = collections.Counter(re.sub(r"'.*?'|\d[\d/:\-]*", '…', i['issue']) for i in issues)
    lines += [f'- {n} × {k}' for k, n in ic.most_common()]
    lines += ['', 'Pending rows are imported but count in no total until an accountant corrects and approves them '
              '(Uhakiki wa Fedha → Kumbukumbu za zamani).', '']
    open(os.path.join(out_dir, 'PREVIEW.md'), 'w', encoding='utf-8').write('\n'.join(lines))
    print(f"families={len(families)} people={len(people)} pledges={len(pledges)} targets={len(targets)} rows={len(rows)} "
          f"posted={stats['posted']} pending={stats['pending']} linked={stats['payer_linked']} issues={len(issues)} subtotals={len(subs)}")


if __name__ == '__main__':
    main(sys.argv[1])
