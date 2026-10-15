"""
Minga Parish legacy workbook -> normalized JSON (PRIVATE OUTPUT).

    python -I tools/migration/extract_workbook.py <workbook.xlsm> <private_out_dir>

Reads, in one pass (macros are never executed — openpyxl does not run VBA):
  * HOMEBOOK / HOMEDATA       parish identity, structure, category labels
  * AKAUNTI BOOK-MIAMALA YOTE the transaction ledger + its SUM subtotals and
                              WALICHOPANGIWA (target) cells
  * PAROKIA DATA BASE         families, people, Mavuno/Ujenzi pledges and the
                              hand-typed monthly Zaka grid (kept for reconciliation
                              only — never imported as payments)
  * MICHANGO-2026             per-jumuiya campaign assessments for 2026

Jumuiya blocks are located with the workbook's own named ranges (see mapping.json).
The output contains personal and financial data: write it OUTSIDE the repository
or into private/ (git-ignored). Never commit it.
"""
import sys, os, re, json, datetime, hashlib
import openpyxl
from openpyxl.utils import column_index_from_string as CI

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER, REGISTER = 'AKAUNTI BOOK-MIAMALA YOTE', 'PAROKIA DATA BASE'
SUM_RE = re.compile(r'^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$')
REF_RE = re.compile(r"^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$")


def norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().upper()


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def parse_date(v):
    if isinstance(v, datetime.datetime): return v.date().isoformat(), None
    if isinstance(v, datetime.date): return v.isoformat(), None
    if isinstance(v, str):
        m = re.match(r'^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\s*$', v)
        if m:
            d, mth, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try: return datetime.date(y, mth, d).isoformat(), 'text date dd/mm/yyyy'
            except ValueError: return None, f'invalid text date {v!r}'
        return None, f'unparseable date {v!r}'
    return None, 'missing date' if v is None else f'unexpected date value {v!r}'


def jdefault(o):
    if isinstance(o, (datetime.date, datetime.datetime, datetime.time)): return o.isoformat()
    return str(o)


def named_ranges(wb):
    out = {}
    for name, dn in wb.defined_names.items():
        m = REF_RE.match(dn.attr_text or '')
        if m:
            out[name] = {'sheet': m.group(1), 'r1': int(m.group(3)), 'r2': int(m.group(5) or m.group(3))}
    return out


def blocks_for(sheet, ranges, wanted, max_row):
    """[(start, end, key)] for the named ranges of one sheet; single-cell names run to the next block."""
    items = sorted((r['r1'], r['r2'], k) for k, r in ranges.items() if r['sheet'] == sheet and k in wanted)
    out = []
    for i, (a, b, k) in enumerate(items):
        nxt = items[i + 1][0] - 1 if i + 1 < len(items) else max_row
        out.append((a, b if b > a else nxt, k))
    return out


def main(path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    mapping = json.load(open(os.path.join(HERE, 'mapping.json'), encoding='utf-8'))
    sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    wbf = openpyxl.load_workbook(path, data_only=False)
    wbv = openpyxl.load_workbook(path, data_only=True)
    ranges = named_ranges(wbf)

    ledger_map = {j['ledger']: j for j in mapping['jumuiya'] if j.get('ledger')}
    register_map = {j['register']: j for j in mapping['jumuiya'] if j.get('register')}

    hb = wbv['HOMEBOOK']
    identity = {'diocese': hb['D4'].value, 'parish_name': hb['D5'].value, 'address': hb['D6'].value,
                'receipt_title': hb['D7'].value, 'default_receiving_officer': hb['C22'].value}

    # ------------------------------------------------------------------ ledger
    wsf, wsv = wbf[LEDGER], wbv[LEDGER]
    year_cols = {}
    for c in range(1, 30):
        h = wsv.cell(16, c).value
        m = re.search(r'(20\d\d)', str(h or ''))
        if h and 'KIASI' in str(h).upper() and m: year_cols[c] = int(m.group(1))
    wanted = set(ledger_map) | set(mapping['ledger_kigango_blocks']) | {mapping['ledger_parish_block']}
    lblocks = blocks_for(LEDGER, ranges, wanted, wsf.max_row)

    def ledger_block(r):
        for a, b, k in lblocks:
            if a <= r <= b: return k
        return None

    txns, subtotals, issues = [], [], []
    section, section_row = None, None
    for r in range(17, wsf.max_row + 1):
        fv = lambda c: wsf.cell(r, c).value
        vv = lambda c: wsv.cell(r, c).value
        fi = fv(9)
        if isinstance(fi, str) and fi.startswith('=HOMEBOOK!$L$'):
            section, section_row = str(vv(9) or '').strip(), r
            continue
        E, fe = vv(5), fv(5)
        block = ledger_block(r)
        if isinstance(fe, str) and fe.upper().startswith('=CONCATENATE'):
            st = {'row': r, 'key': E, 'block': block, 'section': section, 'F': vv(6), 'G': vv(7),
                  'target_formula': fv(11) if isinstance(fv(11), str) else None, 'target': num(vv(11)),
                  'unit_count': num(vv(10)), 'sums': {}, 'N': {'formula': fv(14), 'excel': vv(14)},
                  'O': {'formula': fv(15), 'excel': vv(15)}}
            for c, yr in year_cols.items():
                f = fv(c); m = SUM_RE.match(str(f or '').replace('$', ''))
                st['sums'][yr] = {'formula': f, 'excel': vv(c), 'range': [int(m.group(2)), int(m.group(4))] if m else None}
            subtotals.append(st)
            continue
        is_label = (isinstance(fe, str) and fe.startswith('=')) or any(
            isinstance(fv(c), str) and fv(c).startswith('=HOMEBOOK') for c in (8, 11, 12, 13))
        amounts = {yr: num(vv(c)) for c, yr in year_cols.items() if num(vv(c))}
        has_receipt = num(E) is not None
        if is_label or not (has_receipt or amounts):
            continue
        if not amounts:
            if any(vv(c) is not None for c in year_cols):
                issues.append({'severity': 'warning', 'sheet': LEDGER, 'row': r, 'issue': 'non-numeric amount',
                               'detail': {str(yr): vv(c) for c, yr in year_cols.items()}})
            continue
        d, dnote = parse_date(vv(9))
        for yr, amt in amounts.items():
            col = [c for c, y in year_cols.items() if y == yr][0]
            txns.append({'row': r, 'col': col, 'receipt_no': int(E) if has_receipt else None,
                         'kigango': norm(vv(6)), 'jumuiya': str(vv(7) or '').strip(), 'payer': str(vv(8) or '').strip(),
                         'date': d, 'date_raw': None if dnote is None else str(vv(9)), 'date_note': dnote,
                         'time': vv(10), 'purpose': str(vv(11) or '').strip(), 'amount': amt,
                         'amount_formula': fv(col) if isinstance(fv(col), str) else None, 'ledger_year': yr,
                         'method': str(vv(14) or '').strip(), 'received_by': str(vv(15) or '').strip(),
                         'block': block, 'section': section, 'section_row': section_row})

    # ---------------------------------------------------------------- register
    rf, rv = wbf[REGISTER], wbv[REGISTER]
    rblocks = blocks_for(REGISTER, ranges, set(register_map), rf.max_row)
    people = []
    zaka_col = lambda m, y: CI('Q') + (m - 1) * 4 + (y - 2025)
    for a, b, key in rblocks:
        for r in range(a, b + 1):
            g, h, name = num(rv.cell(r, 7).value), num(rv.cell(r, 8).value), rv.cell(r, 9).value
            if g is None or h is None or not isinstance(name, str) or not name.strip():
                continue
            row = {'row': r, 'block': key, 'family_no': int(g), 'sno': int(h), 'name': name.strip(),
                   'gender': norm(rv.cell(r, 10).value), 'relation': norm(rv.cell(r, 11).value),
                   'cheo': norm(rv.cell(r, 12).value), 'zaka_flag': norm(rv.cell(r, 13).value),
                   'age': num(rv.cell(r, 15).value), 'phone': str(rv.cell(r, 16).value or '').strip(),
                   'zaka': {}, 'pledges': {}}
            for y in (2025, 2026):
                for m in range(1, 13):
                    v = num(rv.cell(r, zaka_col(m, y)).value)
                    if v: row['zaka'][f'{y}-{m:02d}'] = v
            for label, (pc, tc) in {'MAVUNO-2025': ('BU', 'BV'), 'MAVUNO-2026': ('BX', 'BY'), 'MAVUNO-2027': ('CA', 'CB'),
                                    'UJENZI-2025': ('CD', 'CE'), 'UJENZI-2026': ('CG', 'CH'), 'UJENZI-2027': ('CJ', 'CK')}.items():
                p, t = num(rv.cell(r, CI(pc)).value), num(rv.cell(r, CI(tc)).value)
                if p or t: row['pledges'][label] = {'pledged': p, 'paid_typed': t, 'cell': f'{pc}{r}'}
            people.append(row)

    # --------------------------------------------- campaign assessments 2026
    mi = wbv['MICHANGO-2026 ']
    heads = {c: str(mi.cell(11, c).value).strip() for c in range(4, 13) if mi.cell(11, c).value}
    assessments, group = [], None
    for r in range(10, 95):
        b, c = mi.cell(r, 2).value, mi.cell(r, 3).value
        for v in (b, c, mi.cell(r, 4).value):     # the heading sits in B, C or D depending on the block
            if isinstance(v, str) and ('KIGANGO' in v.upper() or 'KISINAGOGI' in v.upper()): group = v.strip()
        if num(b) is not None and c:
            t = {h: num(mi.cell(r, col).value) for col, h in heads.items() if num(mi.cell(r, col).value) is not None and h.upper() != 'JUMLA'}
            # Ntunduu's column I is labelled "KUMPONGEZA KATEKISTA" (I71), not "KONGAMANO LA UTOTO"
            if r >= 72 and r <= 82 and 'KONGAMANO LA UTOTO' in t:
                t['KUMPONGEZA KATEKISTA'] = t.pop('KONGAMANO LA UTOTO')
            assessments.append({'row': r, 'group': group, 'unit': str(c).strip(), 'targets': t})

    out = {'source': os.path.basename(path), 'sha256': sha, 'extracted_at': datetime.datetime.now().isoformat(),
           'identity': identity, 'year_columns': {str(c): y for c, y in year_cols.items()},
           'ledger_blocks': lblocks, 'register_blocks': rblocks,
           'transactions': txns, 'subtotals': subtotals, 'people': people, 'assessments_2026': assessments,
           'issues': issues}
    with open(os.path.join(out_dir, 'workbook.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, default=jdefault)
    print(f'sha256={sha[:12]} transactions={len(txns)} subtotals={len(subtotals)} people={len(people)} '
          f'assessments={len(assessments)} ledger_blocks={len(lblocks)} register_blocks={len(rblocks)} issues={len(issues)}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
