/* Minga Parish — the payments behind a total, correcting a distribution,
   and proof documents (photo of a bank slip or a PDF).

   Any figure on a page can be made clickable with P.txLink(amount, filter):
   it opens the list of payments that make up that figure (ledger_drill in
   the database totals by the same rule as the page). From that list a wrong
   distribution can be corrected (redistribute_payments), a payment reversed,
   and a proof attached or opened. */
(function () {
  const P = window.Parish;
  const BUCKET = 'payment-proofs';
  const MAX_PROOF = 10 * 1024 * 1024;
  const month = v => v ? `${P.MONTHS[Number(String(v).slice(5, 7)) - 1]} ${String(v).slice(0, 4)}` : '';
  const DRILL_KEYS = ['unit', 'unit_self', 'family', 'parishioner', 'kinds', 'not_kinds', 'category', 'campaign', 'pledge', 'batch',
    'year', 'campaign_year', 'zaka_year', 'period_month', 'from', 'to', 'status'];

  /* ---------- clickable totals ---------- */
  P.txLink = (html, filter) => `<button type="button" class="pm-txlink" data-txns="${P.esc(JSON.stringify(filter))}" title="Bonyeza kuona miamala iliyoleta kiasi hiki">${html}</button>`;
  // a money value that opens its payments (plain text when there is nothing behind it)
  P.txMoney = (v, filter, fmt = P.tzs) => Number(v) ? P.txLink(fmt(v), filter) : fmt(v);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-txns]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    P.txnList(JSON.parse(b.dataset.txns)).catch(err => Toast.error(P.friendlyError(err)));
  }, true);

  const canFix = r => P.can('finance.reverse') || (P.can('finance.record') && r.recorded_by === P.profile.id);
  const live = r => r.status === 'posted' && Number(r.sign) > 0 && !r.reversed_by_id;

  /* ---------- the list ---------- */
  P.txnList = async (f) => {
    const p = Object.fromEntries(Object.entries(f).filter(([k, v]) => DRILL_KEYS.includes(k) && v !== '' && v != null));
    let changed = false, showAll = false, rows = [];
    await P.modal({ title: f.title || 'Miamala', wide: true, submit: null, body: `${f.sub ? `<p class="pm-muted pm-small">${f.sub}</p>` : ''}<div data-txlist>${P.loading()}</div>`,
      onOpen(m) {
        const box = m.querySelector('[data-txlist]');
        const load = async () => { rows = await P.rpc('ledger_drill', { p }); draw(); };
        // an action on a payment; when it changed something, the list (and later the page) is reloaded
        const act = fn => async () => { try { if (await fn()) { changed = true; await load(); } } catch (e) { Toast.error(P.friendlyError(e)); } };
        const draw = () => {
          const fixes = rows.filter(r => !live(r)).length;
          const shown = showAll ? rows : rows.filter(live);
          const canRev = P.can('finance.reverse'), canRec = P.can('finance.record');
          box.innerHTML = `
            <div class="pm-row"><p class="pm-small">${P.num(shown.length)} miamala · Jumla <b>${P.tzs(P.sum(rows, 'net_amount'))}</b>
              ${fixes ? `<br><label class="pm-muted"><input type="checkbox" data-all ${showAll ? 'checked' : ''}> Onyesha pia yaliyorudishwa na marekebisho (${fixes})</label>` : ''}</p>
              <div class="pm-actions">${f.add && canRec ? '<button type="button" class="pm-btn pm-btn--sm pm-btn--primary" data-add><span class="material-symbols-outlined">add</span>Ongeza malipo</button>' : ''}
                <button type="button" class="pm-btn pm-btn--sm" data-xls>Excel</button></div></div>` +
            P.table(shown, [
              { key: 'txn_no', label: 'Na.' }, { key: 'txn_date', label: 'Tarehe', fmt: P.date },
              { key: 'payer_name', label: 'Mlipaji', html: r => P.esc(r.payer_name || '—') + (r.family_name && r.family_name !== r.payer_name ? `<br><small class="pm-muted">${P.esc(r.family_name)}</small>` : '') },
              { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
              { key: 'period_month', label: 'Mwezi', fmt: month },
              { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num pm-strong' },
              { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>${r.receipt_status === 'void' ? ' ' + P.badge('imefutwa', 'rose') : ''}` : (r.legacy_receipt_no ? `<small class="pm-muted">Excel #${P.esc(r.legacy_receipt_no)}</small>` : '—') },
              { key: 'status', label: 'Hali', html: r => r.sign < 0 ? P.badge('Reversal', 'rose') : r.reversed_by_id ? P.badge('Imerudishwa', 'rose') : r.status === 'pending' ? P.badge('Inasubiri', 'gold') : r.batch_id ? P.badge('Mgawanyo', 'teal') : '' },
              { key: 'id', label: '', html: r => {
                const b = [];
                if (Number(r.attachments)) b.push(`<button type="button" class="pm-btn pm-btn--sm" data-proof="${r.id}" title="Ona uthibitisho"><span class="material-symbols-outlined">attach_file</span>${Number(r.attachments) > 1 ? r.attachments : ''}</button>`);
                if (live(r) && canRec) b.push(`<button type="button" class="pm-btn pm-btn--sm" data-attach="${r.id}" title="Ambatisha picha au PDF ya uthibitisho"><span class="material-symbols-outlined">upload_file</span></button>`);
                if (live(r) && canFix(r)) b.push(`<button type="button" class="pm-btn pm-btn--sm" data-fix="${r.id}">${r.batch_id ? 'Gawanya upya' : 'Rekebisha'}</button>`);
                if (live(r) && canRev) b.push(`<button type="button" class="pm-btn pm-btn--sm" data-reverse="${r.id}">Rudisha</button>`);
                return `<span class="pm-nowrap">${b.join(' ')}</span>`;
              } }],
              { empty: 'Hakuna miamala nyuma ya kiasi hiki.', foot: { payer_name: '<b>JUMLA</b>', net_amount: `<b>${P.tzs(P.sum(shown, 'net_amount'))}</b>` } });
          const all = box.querySelector('[data-all]');
          all && all.addEventListener('change', () => { showAll = all.checked; draw(); });
          box.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`miamala_${(f.title || '').replace(/\W+/g, '_')}`, { Miamala: shown.map(r => ({
            Na: r.txn_no, Tarehe: r.txn_date, Mlipaji: r.payer_name, Familia: r.family_name, Aina: r.category_name, Kampeni: r.campaign_name,
            Mwezi: month(r.period_month), Kiasi: Number(r.net_amount), Njia: P.METHODS[r.payment_method], Kumbukumbu: r.reference_no, Risiti: r.receipt_no || r.legacy_receipt_no })) }));
          const add = box.querySelector('[data-add]');
          add && add.addEventListener('click', act(() => P.quickPay({ ...f.add, noRefresh: true })));
          const byId = id => rows.find(r => r.id === id);
          box.querySelectorAll('[data-proof]').forEach(b => b.addEventListener('click', act(() => P.openProofs(b.dataset.proof))));
          box.querySelectorAll('[data-attach]').forEach(b => b.addEventListener('click', act(() => attachLater(byId(b.dataset.attach)))));
          box.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', act(() => P.redistribute(byId(b.dataset.fix)))));
          box.querySelectorAll('[data-reverse]').forEach(b => b.addEventListener('click', async () => {
            const r = byId(b.dataset.reverse);
            const v = await P.modal({ title: `Rudisha muamala Na. ${r.txn_no}`, submit: 'Rudisha muamala',
              body: `<p class="pm-muted">Muamala hautafutwa. Muamala wa kurudisha (reversal) utaandikwa na jumla zote zitajirekebisha. Risiti ${P.esc(r.receipt_no || '')} itabatilishwa.</p>
                     <div class="pm-form"><label class="pm-span2">Sababu<input name="reason" required minlength="5"></label>
                     <label>Tarehe ya kurudisha<input type="date" name="date" value="${P.today()}" required></label></div>` });
            if (!v) return;
            await P.busy(b, () => P.rpc('reverse_transaction', { p_txn: r.id, p_reason: v.reason, p_idempotency_key: P.uuid(), p_date: v.date }));
            Toast.success('Muamala umerudishwa.'); changed = true; load();
          }));
        };
        load().catch(e => { box.innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`; });
      } });
    if (changed) P.refresh();
  };

  /* ---------- correct a distribution ----------
     The payment (and the other lines of its batch) is shown as editable lines:
     payer, amount and (for Zaka) month. The total stays the same. */
  P.redistribute = async (row) => {
    const batch = row.batch_id ? (await P.rpc('ledger_drill', { p: { batch: row.batch_id } })).filter(r => live(r) && canFix(r)) : [row];
    const olds = batch.length ? batch : [row];
    const total = P.sum(olds, 'amount');
    const cat = P.ref.catsById[row.category_id];
    const monthly = !!(cat && cat.uses_period_month);
    const jum = row.jumuiya_id && P.ref.unitsById[row.jumuiya_id];
    const key = P.uuid();
    const lineHtml = l => `<div class="pm-redis__line" data-line data-kind="${l.kind || ''}" data-id="${l.id || ''}">
        <div class="pm-search"><input data-payer-search value="${P.esc(l.name || '')}" placeholder="Tafuta muumini au familia…" autocomplete="off"><div data-payer-results class="pm-search__results"></div></div>
        ${monthly ? `<input type="month" data-month value="${P.esc(l.month || '')}" title="Mwezi wa zaka">` : ''}
        <input type="number" min="1" step="1" inputmode="numeric" placeholder="Kiasi" data-amt value="${l.amount || ''}">
        <button type="button" class="pm-icon-btn" data-del title="Ondoa mstari"><span class="material-symbols-outlined">close</span></button></div>`;
    const payerOf = r => r.parishioner_id ? { kind: 'parishioner', id: r.parishioner_id, name: r.payer_name }
      : r.family_id ? { kind: 'family', id: r.family_id, name: r.family_name || r.payer_name }
      : r.org_unit_id ? { kind: 'org_unit', id: r.org_unit_id, name: r.org_unit_name || r.payer_name } : { name: r.payer_name };
    const start = olds.map(r => ({ ...payerOf(r), amount: Number(r.amount), month: r.period_month ? String(r.period_month).slice(0, 7) : '' }));
    let collect = null;
    const v = await P.modal({ title: olds.length > 1 ? `Gawanya upya — miamala ${olds.length}` : `Rekebisha muamala Na. ${row.txn_no}`, submit: 'Hifadhi marekebisho', wide: true,
      body: `<p class="pm-muted pm-small">Kiasi cha jumla ni <b>${P.tzs(total)}</b> (${P.esc(row.category_name)}${row.campaign_name ? ' · ' + P.esc(row.campaign_name) : ''}, ${P.date(row.txn_date)}).
          Badilisha mlipaji, kiasi${monthly ? ' au mwezi' : ''}; ongeza au ondoa mistari. Miamala ya awali itarudishwa (risiti zake zitabatilishwa) na kila mstari utapata risiti mpya. Hakuna kinachofutwa.</p>
        <div class="pm-redis" data-lines>${start.map(lineHtml).join('')}</div>
        <p><button type="button" class="pm-btn pm-btn--sm" data-addline><span class="material-symbols-outlined">add</span>Ongeza mstari</button></p>
        <div class="pm-split__sum" data-sum></div>
        <div class="pm-form mt-3"><label class="pm-span2">Sababu ya kurekebisha<input name="reason" required minlength="3" placeholder="mf. Zaka ya Juni iliandikwa kwa familia isiyo sahihi"></label></div>`,
      onOpen(m) {
        const list = m.querySelector('[data-lines]'), sumEl = m.querySelector('[data-sum]'), reason = m.querySelector('[name=reason]');
        const nOf = el => Math.max(0, Math.round(Number(el && el.value) || 0));
        const lines = () => [...list.querySelectorAll('[data-line]')].map(el => ({ el, kind: el.dataset.kind, id: el.dataset.id, amount: nOf(el.querySelector('[data-amt]')),
          month: el.querySelector('[data-month]')?.value || '' }));
        const sum = () => {
          const ls = lines(), given = P.sum(ls, 'amount'), left = total - given;
          const noPayer = ls.some(l => l.amount > 0 && !l.id);
          sumEl.innerHTML = `Jumla ya awali <b>${P.tzs(total)}</b> · Mgawanyo mpya <b>${P.tzs(given)}</b> · ${
            left === 0 ? '<span class="pm-ok">Imelingana ✓</span>' : left > 0 ? `<span class="pm-due">Imebaki ${P.tzs(left)}</span>` : `<span class="pm-due">Imezidi kwa ${P.tzs(-left)}</span>`}${
            noPayer ? ' · <span class="pm-due">Chagua mlipaji kwenye kila mstari (kutoka kwenye orodha)</span>' : ''}`;
          reason.setCustomValidity(noPayer ? 'Chagua mlipaji kwenye kila mstari kutoka kwenye orodha.'
            : !ls.some(l => l.amount > 0) ? 'Mgawanyo mpya hauna kiasi.'
            : given !== total ? `Mgawanyo mpya (${P.tzs(given)}) lazima ulingane na ${P.tzs(total)}.` : '');
        };
        const wire = el => {
          P.payerPicker(el, { jumuiya: jum ? jum.id : undefined, onPick: x => { el.dataset.kind = x.kind; el.dataset.id = x.id; sum(); } });
          el.querySelector('[data-payer-search]').addEventListener('input', () => { el.dataset.kind = ''; el.dataset.id = ''; sum(); });
          el.querySelector('[data-del]').addEventListener('click', () => { el.remove(); sum(); });
        };
        list.querySelectorAll('[data-line]').forEach(wire);
        list.addEventListener('input', e => { if (e.target.matches('[data-amt]')) sum(); });
        m.querySelector('[data-addline]').addEventListener('click', () => {
          const el = P.h(lineHtml({ month: start[0]?.month || '' }));
          list.appendChild(el); wire(el); el.querySelector('[data-payer-search]').focus(); sum();
        });
        collect = () => lines().filter(l => l.amount > 0).map(l => ({ [`${l.kind}_id`]: l.id, amount: l.amount, ...(monthly && l.month ? { period_month: l.month + '-01' } : {}) }));
        sum();
      } });
    if (!v) return false;
    const r = await P.rpc('redistribute_payments', { p: { idempotency_key: key, transaction_ids: olds.map(o => o.id), reason: v.reason,
      lines: collect(), receiving_officer: P.profile.full_name || P.profile.email } });
    const rc = r.receipts || [];
    Toast.success(`Marekebisho yamehifadhiwa. Risiti mpya: ${rc.map(x => x.receipt_no).join(', ')}`);
    return true;
  };

  /* ---------- proof of payment ---------- */
  P.proofField = () => `<label class="pm-span2">Uthibitisho wa malipo (hiari) — picha ya risiti ya benki au PDF, hadi MB 10
    <input type="file" name="proof" accept="image/*,application/pdf"></label>`;
  const mimeOf = file => file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.(jpe?g)$/i.test(file.name) ? 'image/jpeg'
    : /\.png$/i.test(file.name) ? 'image/png' : /\.(heic|heif)$/i.test(file.name) ? 'image/heic' : '');
  P.hasFile = file => !!(file && typeof file === 'object' && file.size > 0);
  P.attachProof = async (file, txnIds) => {
    const ids = [...new Set((txnIds || []).filter(Boolean))];
    if (!P.hasFile(file) || !ids.length) return false;
    const mime = mimeOf(file);
    if (mime !== 'application/pdf' && !mime.startsWith('image/')) throw new Error('Weka picha au PDF tu.');
    if (file.size > MAX_PROOF) throw new Error('Faili ni kubwa mno (mwisho MB 10).');
    const safe = (file.name || 'uthibitisho').replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${ids[0]}/${P.uuid()}-${safe}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (error) throw new Error(P.friendlyError(error));
    await P.rpc('add_payment_attachment', { p: { transaction_ids: ids, storage_path: path, file_name: file.name, mime_type: mime, size_bytes: file.size } });
    return true;
  };
  // after a payment is saved: a failed upload must not look like a failed payment
  P.attachAfterPost = async (file, txnIds) => {
    if (!P.hasFile(file)) return;
    try { if (await P.attachProof(file, txnIds)) Toast.success('Uthibitisho umeambatishwa.'); }
    catch (e) { Toast.error(`Malipo yamehifadhiwa, lakini uthibitisho haukupakiwa (${P.friendlyError(e)}). Fungua muamala kwenye orodha na ubonyeze "Ambatisha".`); }
  };
  const attachLater = async (r) => {
    const v = await P.modal({ title: `Ambatisha uthibitisho — muamala Na. ${r.txn_no}`, submit: 'Pakia',
      body: `<p class="pm-muted pm-small">${P.esc(r.payer_name || '')} · ${P.tzs(r.amount)} · ${P.date(r.txn_date)}${r.batch_id ? '. Kwa mgawanyo, uthibitisho unaambatishwa kwa mistari yake yote.' : ''}</p>
        <div class="pm-form">${P.proofField().replace('name="proof"', 'name="proof" required')}</div>` });
    if (!v || !P.hasFile(v.proof)) return false;
    const ids = r.batch_id ? (await P.rpc('ledger_drill', { p: { batch: r.batch_id } })).filter(live).map(x => x.id) : [r.id];
    await P.attachProof(v.proof, ids.length ? ids : [r.id]);
    Toast.success('Uthibitisho umeambatishwa.');
    return true;
  };
  const signed = async path => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
    if (error) throw new Error(P.friendlyError(error));
    return data.signedUrl;
  };
  P.openProofs = async (txnId) => {
    const files = await P.q(P.from('transaction_attachments').select('*').eq('transaction_id', txnId).order('created_at'));
    if (files.length === 1) {
      const w = window.open('', '_blank');      // opened now, while the click still counts (pop-up blockers)
      try { const url = await signed(files[0].storage_path); if (w) w.location = url; else location.href = url; }
      catch (e) { if (w) w.close(); Toast.error(P.friendlyError(e)); }
      return;
    }
    await P.modal({ title: 'Uthibitisho wa malipo', submit: null, body: P.table(files, [
      { key: 'file_name', label: 'Faili', html: a => `<button type="button" class="pm-link" data-open="${P.esc(a.storage_path)}">${P.esc(a.file_name)}</button>` },
      { key: 'size_bytes', label: 'Ukubwa', fmt: v => v ? `${Math.max(1, Math.round(v / 1024))} KB` : '' },
      { key: 'created_at', label: 'Imepakiwa', fmt: v => P.date(String(v).slice(0, 10)) }], { empty: 'Hakuna uthibitisho.' }),
      onOpen: m => m.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
        const w = window.open('', '_blank');
        try { const url = await signed(b.dataset.open); if (w) w.location = url; } catch (e) { if (w) w.close(); Toast.error(P.friendlyError(e)); }
      })) });
  };
})();
