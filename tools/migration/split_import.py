"""
Split <private_dir>/import/minga_import.sql into parts small enough for the
Supabase SQL Editor (one big 7 MB statement is too much for the browser editor).

    python -I tools/migration/split_import.py <private_dir> [--max-kb 900]

Writes <private_dir>/import/parts/sehemu_01.sql, sehemu_02.sql, ... Run them IN ORDER,
each one on its own (SQL Editor → paste → Run). Each part is its own transaction:
if one fails, nothing of that part is saved and you can run it again after fixing
the cause. Part 1 refuses to run if this workbook was already imported; the last
part checks the Excel subtotals and marks the import as finished.

The parts contain personal and financial data: keep them in the private folder,
never in git, and delete them after the import.
"""
import os
import re
import sys


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    pdir = args[0]
    max_kb = int(args[args.index('--max-kb') + 1]) if '--max-kb' in args else 900
    src = os.path.join(pdir, 'import', 'minga_import.sql')
    lines = open(src, encoding='utf-8').read().split('\n')

    start = next(i for i, l in enumerate(lines) if l.startswith('do $imp$'))
    end = next(i for i, l in enumerate(lines) if l.startswith('end $imp$;'))
    sha = re.search(r"source_sha256 = '([0-9a-f]{64})'", lines[start + 1] if 'source_sha256' in lines[start + 1] else '\n'.join(lines[start:start + 4])).group(1)

    # the opening of the block (guard + batch row + set_config) ends at the set_config line
    open_end = next(i for i in range(start, end) if "set_config('minga.import_batch'" in lines[i])
    first_body = lines[start + 1:open_end + 1]
    body = lines[open_end + 1:end]

    # keep the final subtotal check + "imported" status for the last part
    tail_from = next(i for i, l in enumerate(body) if 'reconcile_legacy_subtotals' in l)
    tail = body[tail_from:]
    body = body[:tail_from]

    head_decl = "do $imp$ declare v_parish uuid := public.default_parish_id(); v_batch uuid; n int; begin"
    resume = [
        f"  select id into v_batch from public.import_batches where source_sha256 = '{sha}' and status = 'approved' order by created_at desc limit 1;",
        "  if v_batch is null then raise exception 'Endesha sehemu ya 1 kwanza (import haijaanzishwa, au tayari imekamilika)'; end if;",
        "  perform set_config('minga.import_batch', v_batch::text, true);",
    ]

    parts, cur, size = [], [], 0
    limit = max_kb * 1024
    for l in body:
        b = len(l.encode('utf-8')) + 1
        if cur and size + b > limit:
            parts.append(cur)
            cur, size = [], 0
        cur.append(l)
        size += b
    if cur:
        parts.append(cur)

    out_dir = os.path.join(pdir, 'import', 'parts')
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.startswith('sehemu_') and f.endswith('.sql'):
            os.remove(os.path.join(out_dir, f))
    total = len(parts) + 1
    files = []
    for i in range(total):
        no = i + 1
        hdr = [f"-- PRIVATE: Minga Parish import, sehemu {no} kati ya {total}. Contains personal and financial data. Do not commit.",
               f"-- Endesha sehemu kwa mpangilio: 1, 2, 3 … {total}. Hii ni sehemu ya {no}.",
               "begin;", "", head_decl]
        if no == 1:
            block = first_body + parts[0]
        elif no < total:
            block = resume + parts[i]
        else:
            block = resume + tail
        done = (f"  raise notice 'Sehemu {no} kati ya {total} imekamilika';" if no < total
                else "  raise notice 'Import imekamilika: angalia Uhakiki wa Fedha kwenye mfumo';")
        text = '\n'.join(hdr + block + [done, "end $imp$;", "commit;", ""])
        if no == total:
            text += "analyze;\n"
        name = os.path.join(out_dir, f"sehemu_{no:02d}.sql")
        open(name, 'w', encoding='utf-8', newline='\n').write(text)
        files.append((name, len(text.encode('utf-8'))))
    for n, s in files:
        print(f"{os.path.basename(n)}  {s / 1024:,.0f} KB")
    print(f"{total} parts in {out_dir}")


if __name__ == '__main__':
    main()
