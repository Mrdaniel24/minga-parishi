/* Minga Parish — expenses, accounting, receipts, reports, reconciliation, envelopes */
(function () {
  const P = window.Parish, V = P.views;

  /* ================= MATUMIZI ================= */
  V.expenses = {
    title: 'Matumizi', perm: 'finance.read',
    async render(el) {
      const [pending, posted] = await Promise.all([
        P.q(P.from('approval_requests').select('*').eq('request_type','expense').eq('status', 'pending').order('requested_at', { ascending: false })),
        P.q(P.from('v_ledger').select('*').eq('kind', 'expense').order('txn_date', { ascending: false }).limit(300)),
      ]);
      const txIds = pending.map(p => p.transaction_id).filter(Boolean);
      const ptx = txIds.length ? await P.q(P.from('v_ledger').select('*').in('id', txIds)) : [];
      const txById = Object.fromEntries(ptx.map(t => [t.id, t]));
      const canRec = P.can('finance.expense.record'), canApp = P.can('finance.approve');
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Matumizi</h1><p class="pm-muted">Matumizi hurekodiwa na mtu mmoja na kuidhinishwa na mwingine. Hayaingii kwenye hesabu kabla ya kuidhinishwa.</p></div>
        <div class="pm-actions">${canRec ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Rekodi matumizi</button>' : ''}</div></div>
        <section class="pm-card"><h3 class="pm-h3">Yanayosubiri idhini (${pending.length})</h3>${P.table(pending.map(a => ({ ...a, t: txById[a.transaction_id] || {} })), [
          { key: 'd', label: 'Tarehe', html: a => P.date(a.t.txn_date) }, { key: 'x', label: 'Maelezo', html: a => P.esc(a.t.description || '') },
          { key: 'c', label: 'Aina', html: a => P.esc(a.t.category_name || '') }, { key: 'f', label: 'Mfuko', html: a => P.esc(a.t.fund_name || '') },
          { key: 'a', label: 'Kiasi', html: a => P.tzs(a.t.amount), cls: 'pm-num' },
          { key: 'id', label: '', html: a => canApp && a.requested_by !== P.profile.id ? `<button class="pm-btn pm-btn--sm pm-btn--primary" data-ok="${a.id}">Idhinisha</button> <button class="pm-btn pm-btn--sm" data-no="${a.id}">Kataa</button>` : '<small class="pm-muted">Inasubiri mwingine</small>' }],
          { empty: 'Hakuna matumizi yanayosubiri.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Matumizi yaliyoidhinishwa</h3>${P.table(posted.filter(t => t.status === 'posted'), [
          { key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'description', label: 'Maelezo' }, { key: 'payer_name', label: 'Aliyelipwa' },
          { key: 'category_name', label: 'Aina' }, { key: 'fund_name', label: 'Mfuko' }, { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }])}</section>`;
      const decide = (id, ok) => async (e) => {
        const note = ok ? null : (await P.modal({ title: 'Sababu ya kukataa', body: '<div class="pm-form"><label class="pm-span2">Sababu<input name="n" required></label></div>' }))?.n;
        if (!ok && !note) return;
        await P.busy(e.target, () => P.rpc('decide_approval', { p_request: id, p_approve: ok, p_note: note }));
        Toast.success(ok ? 'Imeidhinishwa.' : 'Imekataliwa.'); P.reload();
      };
      el.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', decide(b.dataset.ok, true)));
      el.querySelectorAll('[data-no]').forEach(b => b.addEventListener('click', decide(b.dataset.no, false)));
      const nb = el.querySelector('[data-new]');
      nb && nb.addEventListener('click', async () => {
        const key = P.uuid();
        const v = await P.modal({ title: 'Rekodi matumizi', wide: true, body: `<div class="pm-form">
          <label class="pm-span2">Maelezo<input name="description" required></label>
          <label>Aina ya matumizi<select name="category_id" required>${P.catOptions(['expense'], { blank: 'Chagua…' })}</select></label>
          <label>Kiasi<input name="amount" type="number" min="1" required></label>
          <label>Tarehe<input name="txn_date" type="date" value="${P.today()}" required></label>
          <label>Aliyelipwa<input name="payee"></label>
          <label>Njia<select name="payment_method">${['cash', 'cheque', 'bank_transfer', 'mobile_money'].map(k => `<option value="${k}">${P.METHODS[k]}</option>`).join('')}</select></label>
          <label>Namba ya kumbukumbu<input name="reference_no"></label>
        </div>` });
        if (!v) return;
        const r = await P.rpc('record_expense', { p: { ...v, idempotency_key: key, amount: Number(v.amount) } });
        Toast.success(`Imerekodiwa (Na. ${r.txn_no}) — inasubiri idhini.`); P.reload();
      });
    },
  };

  V['payment-approvals'] = {
    title: 'Uhakiki wa Malipo', perm: 'finance.approve',
    async render(el) {
      const reqs = await P.q(P.from('approval_requests').select('id,transaction_id,requested_by,requested_at')
        .eq('request_type','payment_submission').eq('status','pending').order('requested_at',{ascending:true}).limit(500));
      const ids = reqs.map(r => r.transaction_id).filter(Boolean);
      const [tx, proofs] = await Promise.all([
        ids.length ? P.q(P.from('v_ledger').select('*').in('id',ids)) : [],
        ids.length ? P.q(P.from('transaction_attachments').select('transaction_id').in('transaction_id',ids)) : [],
      ]);
      const txById = Object.fromEntries(tx.map(t => [t.id,t]));
      const proofSet = new Set(proofs.map(x => x.transaction_id));
      const txMeta=ids.length?await P.q(P.from('finance_transactions').select('id,batch_id').in('id',ids)):[];
      const batchById=Object.fromEntries(txMeta.map(x=>[x.id,x.batch_id]));
      const groups=new Map();
      for(const r of reqs){const t=txById[r.transaction_id]||{}, batch=batchById[r.transaction_id], key=batch||r.id; if(!groups.has(key))groups.set(key,{id:r.id,batch_id:batch,rows:[],t,requested_by:r.requested_by});groups.get(key).rows.push({...r,t});}
      const reviewRows=[...groups.values()].map(g=>({...g,ids:g.rows.map(x=>x.transaction_id),has_proof:g.rows.every(x=>proofSet.has(x.transaction_id)),total:g.rows.reduce((n,x)=>n+(Number(x.t.amount)||0),0)}));
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Uhakiki wa malipo</h1><p class="pm-muted">Kagua risiti na mgao. Risiti yenye mistari mingi itaidhinishwa au kukataliwa kwa pamoja.</p></div></div>
        <section class="pm-card"><h2 class="pm-h3">Yanayosubiri (${reqs.length})</h2>${P.table(reviewRows,[
          {key:'date',label:'Tarehe',html:r=>P.date(r.t.txn_date)},
          {key:'payer',label:'Mlipaji / kundi',html:r=>r.rows.length>1?`Malipo yenye michango ${r.rows.length}`:P.esc(r.t.payer_name||'—')},
          {key:'lines',label:'Mgao',html:r=>r.rows.map(x=>`${P.esc(x.t.category_name||'Mchango')} · ${P.esc(x.t.payer_name||'—')} — ${P.tzs(x.t.amount)}`).join('<br>')},
          {key:'unit',label:'Eneo',html:r=>P.esc([...new Set(r.rows.map(x=>[x.t.jumuiya_name,x.t.kigango_name].filter(Boolean).join(' · ')||'Parokia'))].join(', '))},
          {key:'amount',label:'Jumla',html:r=>P.tzs(r.total),cls:'pm-num'},
          {key:'reference_no',label:'Kumbukumbu',html:r=>P.esc(r.t.reference_no||'—')},
          {key:'proof',label:'Risiti',html:r=>r.has_proof?`<button class="pm-btn pm-btn--sm" data-proof="${r.ids[0]}">Angalia risiti</button>`:P.badge('Risiti haijapakiwa','rose')},
          {key:'actions',label:'Uamuzi',html:r=>r.has_proof?`<button class="pm-btn pm-btn--sm pm-btn--primary" data-approve="${r.batch_id||''}" data-request="${r.id}">Idhinisha${r.rows.length>1?' kundi':''}</button> <button class="pm-btn pm-btn--sm" data-reject="${r.batch_id||''}" data-request="${r.id}">Kataa${r.rows.length>1?' kundi':''}</button>`:'<small class="pm-muted">Subiri risiti ipakiwe</small>'}
        ],{empty:'Hakuna malipo yanayosubiri uhakiki.'})}</section>`;
      el.querySelectorAll('[data-proof]').forEach(b=>b.addEventListener('click',()=>P.openProofs(b.dataset.proof)));
      el.querySelectorAll('[data-approve],[data-reject]').forEach(b=>b.addEventListener('click',async()=>{
        const approve=b.hasAttribute('data-approve'), id=b.dataset.approve||b.dataset.reject;
        const request=b.dataset.request;
        let note=null;
        if(!approve){const v=await P.modal({title:'Sababu ya kukataa malipo',submit:'Kataa malipo',body:'<div class="pm-form"><label class="pm-span2">Sababu<input name="note" required minlength="3"></label></div>'});if(!v)return;note=v.note;}
        try {
          const r=await P.busy(b,()=>id?P.rpc('decide_payment_submission_batch',{p_batch:id,p_approve:approve,p_note:note}):P.rpc('decide_approval',{p_request:request,p_approve:approve,p_note:note}));
          Toast.success(approve?`Malipo yameidhinishwa. Risiti ${r.receipt_no||''}`:'Malipo yamekataliwa; sababu imehifadhiwa.');
          P.reload();
        } catch(e) { if (!e.__shown) Toast.error(P.friendlyError(e)); }
      }));
    },
  };

  /* ================= UHASIBU ================= */
  V.accounting = {
    title: 'Uhasibu', perm: 'finance.read',
    async render(el, params) {
      const acc = params.account || (P.ref.accounts.find(a => a.money_kind) || {}).id;
      const from = params.from || P.yearFrom(), to = params.to || P.yearTo();
      const [bal, funds, periods, book] = await Promise.all([
        P.q(P.from('v_account_balances').select('*').order('code')),
        P.q(P.from('v_fund_balances').select('*').order('code')),
        P.q(P.from('accounting_periods').select('*, financial_years(label,status)').order('period_start', { ascending: false }).limit(24)),
        acc ? P.rpc('cashbook', { p_account: acc, p_from: from, p_to: to }) : [],
      ]);
      const canLock = P.can('finance.period.lock');
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Uhasibu</h1><p class="pm-muted">Kila muamala huandika journal yenye debit = credit. Salio za akaunti na mifuko zinatokana na journal hiyo.</p></div></div>
        <section class="pm-grid2"><div class="pm-card"><h3 class="pm-h3">Salio la akaunti (trial balance)</h3>${P.table(bal.filter(b => Number(b.total_debit) || Number(b.total_credit)), [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Akaunti' }, { key: 'account_type', label: 'Aina' },
          { key: 'total_debit', label: 'Debit', fmt: P.num, cls: 'pm-num' }, { key: 'total_credit', label: 'Credit', fmt: P.num, cls: 'pm-num' }, { key: 'balance', label: 'Salio', fmt: P.tzs, cls: 'pm-num pm-strong' }],
          { foot: { name: '<b>JUMLA</b>', total_debit: P.num(P.sum(bal, 'total_debit')), total_credit: P.num(P.sum(bal, 'total_credit')) } })}</div>
        <div class="pm-card"><h3 class="pm-h3">Mifuko</h3>${P.table(funds, [{ key: 'name', label: 'Mfuko', html: f => P.esc(f.name) + (f.is_restricted ? ' ' + P.badge('maalumu', 'gold') : '') },
          { key: 'income', label: 'Mapato', fmt: P.tzs, cls: 'pm-num' }, { key: 'expenses', label: 'Matumizi', fmt: P.tzs, cls: 'pm-num' }, { key: 'balance', label: 'Salio', fmt: P.tzs, cls: 'pm-num pm-strong' }])}</div></section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Cashbook</h3>
          <form class="pm-filters pm-filters--inline"><select name="account">${P.options(P.ref.accounts.filter(a => a.money_kind), { label: a => `${a.code} ${a.name}`, selected: acc })}</select>
          <input type="date" name="from" value="${from}"><input type="date" name="to" value="${to}"><button class="pm-btn pm-btn--sm">Onyesha</button>
          <button type="button" class="pm-btn pm-btn--sm" data-print>Chapa</button></form></div>
          ${P.reportHeader('Cashbook', `${P.ref.accounts.find(a => a.id === acc)?.name || ''} · ${from} – ${to}`)}
          ${P.table(book, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'txn_no', label: 'Na.' }, { key: 'receipt_no', label: 'Risiti' },
            { key: 'description', label: 'Maelezo' }, { key: 'payer', label: 'Mlipaji' }, { key: 'money_in', label: 'Ingia', fmt: v => v === null ? '' : P.num(v), cls: 'pm-num' },
            { key: 'money_out', label: 'Toka', fmt: v => v === null ? '' : P.num(v), cls: 'pm-num' }, { key: 'balance', label: 'Salio', fmt: P.num, cls: 'pm-num pm-strong' }])}</section>
        <section class="pm-card"><h3 class="pm-h3">Vipindi vya hesabu</h3>${P.table(periods, [{ key: 'period_start', label: 'Mwezi', fmt: v => v.slice(0, 7) },
          { key: 'fy', label: 'Mwaka', html: p => P.esc(p.financial_years?.label) }, { key: 'is_locked', label: 'Hali', html: p => p.is_locked ? P.badge('Kimefungwa', 'rose') : P.badge('Wazi', 'teal') },
          { key: 'id', label: '', html: p => canLock && p.financial_years?.status === 'open' ? `<button class="pm-btn pm-btn--sm" data-lock="${p.id}" data-v="${!p.is_locked}">${p.is_locked ? 'Fungua' : 'Funga'}</button>` : '' }])}
          ${canLock ? `<p class="pm-pad"><button class="pm-btn" data-close>Funga mwaka wa fedha…</button></p>` : ''}</section>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/accounting?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      el.querySelector('[data-print]').addEventListener('click', () => P.print('Cashbook'));
      el.querySelectorAll('[data-lock]').forEach(b => b.addEventListener('click', async () => {
        await P.busy(b, () => P.rpc('set_period_lock', { p_period: b.dataset.lock, p_locked: b.dataset.v === 'true' })); P.reload();
      }));
      const cb = el.querySelector('[data-close]');
      cb && cb.addEventListener('click', async () => {
        const v = await P.modal({ title: 'Funga mwaka wa fedha', submit: 'Funga mwaka', body: `<p class="pm-muted">Baada ya kufunga, hakuna muamala unaoweza kuongezwa kwenye mwaka huo. Matumizi yanayosubiri lazima yaamuliwe kwanza.</p>
          <div class="pm-form"><label>Mwaka<select name="fy">${P.options(P.ref.years.filter(y => y.status === 'open'), { label: 'label' })}</select></label></div>` });
        if (!v) return;
        await P.rpc('close_financial_year', { p_fy: v.fy }); await P.loadRef(true); Toast.success('Mwaka umefungwa.'); P.reload();
      });
    },
  };

  /* ================= RISITI ================= */
  V.receipts = {
    title: 'Risiti', perm: 'finance.read',
    async render(el, params) {
      const q = params.q || '';
      const f = { kigango: params.kigango || '', jumuiya: params.jumuiya || '', family: params.family || '', person: params.person || '', category: params.category || '' };
      const families = f.jumuiya
        ? await P.q(P.from('families').select('id,family_name,family_code').eq('jumuiya_id', f.jumuiya).eq('status', 'active').order('family_code').limit(2000))
        : [];
      const people = f.family
        ? await P.q(P.from('parishioners').select('id,full_name').eq('family_id', f.family).eq('membership_status', 'active').order('full_name').limit(2000))
        : [];
      const applyArea = query => {
        if (f.kigango) query = query.eq('kigango_id', f.kigango);
        if (f.jumuiya) query = query.eq('jumuiya_id', f.jumuiya);
        if (f.family) query = query.eq('family_id', f.family);
        if (f.person) query = query.eq('parishioner_id', f.person);
        return query;
      };
      const categoryRows = await P.q(applyArea(P.from('v_receipt_register').select('category_name')).limit(10000));
      const availableNames = new Set(categoryRows.map(r => r.category_name).filter(Boolean));
      const availableCategories = P.ref.cats.filter(c => c.is_active && c.code !== 'TRANSFER' && availableNames.has(c.name_sw));
      if (!availableCategories.some(c => c.id === f.category)) f.category = '';
      let qb = applyArea(P.from('v_receipt_register').select('*')).order('issued_at', { ascending: false }).limit(300);
      if (q) qb = qb.or(`receipt_no.ilike.%${q}%,payer_name.ilike.%${q}%`);
      const selectedCategory = P.ref.catsById[f.category];
      if (selectedCategory) qb = qb.eq('category_name', selectedCategory.name_sw);
      const rows = await P.q(qb);
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Rejista ya Risiti</h1><p class="pm-muted">Risiti hutolewa kiotomatiki kwa kila malipo yaliyothibitishwa. Namba hazijirudii; risiti ya muamala uliorudishwa hubatilishwa.</p></div>
        <div class="pm-actions"><button class="pm-btn" data-xls>Excel</button></div></div>
        <form class="pm-filters">
          ${P.cascadeHtml({ kigango: f.kigango, jumuiya: f.jumuiya })}
          <label>Familia<select name="family" ${f.jumuiya ? '' : 'disabled'}><option value="">${f.jumuiya ? 'Familia zote' : 'Chagua jumuiya kwanza'}</option>${P.options(families, { label: x => `${x.family_code ? `${x.family_code} · ` : ''}${x.family_name}`, selected: f.family })}</select></label>
          <label>Muumini<select name="person" ${f.family ? '' : 'disabled'}><option value="">${f.family ? 'Waumini wote' : 'Chagua familia kwanza'}</option>${P.options(people, { label: 'full_name', selected: f.person })}</select></label>
          <label>Aina ya mchango<select name="category"><option value="">Aina zote zilizopo hapa</option>${P.options(availableCategories, { label: 'name_sw', selected: f.category })}</select></label>
          <label>Tafuta (namba au mlipaji)<input name="q" value="${P.esc(q)}"></label><button class="pm-btn">Tafuta</button>
        </form>
        <section class="pm-card">${P.table(rows, [{ key: 'receipt_no', label: 'Risiti', html: r => `<a class="pm-link" target="_blank" href="receipt.html?id=${r.id}">${P.esc(r.receipt_no)}</a>` },
          { key: 'issued_at', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina' },
          { key: 'kigango_name', label: 'Kigango' }, { key: 'jumuiya_name', label: 'Jumuiya' }, { key: 'amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'payment_method', label: 'Njia', fmt: v => P.METHODS[v] || v },
          { key: 'status', label: 'Hali', html: r => r.status === 'valid' ? P.badge('Halali', 'teal') : P.badge('Imebatilishwa', 'rose') }, { key: 'print_count', label: 'Imechapwa', cls: 'pm-num' }])}</section>`;
      const form = el.querySelector('.pm-filters');
      P.wireCascade(form);
      const kigango = form.querySelector('[name="kigango"]'), jumuiya = form.querySelector('[name="jumuiya"]');
      const family = form.querySelector('[name="family"]'), person = form.querySelector('[name="person"]');
      const reloadArea = () => {
        form.querySelector('[name="category"]').value = '';
        P.go('#/receipts?' + new URLSearchParams(Object.fromEntries(new FormData(form))));
      };
      kigango.addEventListener('change', () => { family.value = ''; person.value = ''; reloadArea(); });
      jumuiya.addEventListener('change', () => { family.value = ''; person.value = ''; reloadArea(); });
      family.addEventListener('change', () => { person.value = ''; reloadArea(); });
      form.addEventListener('submit', e => { e.preventDefault(); P.go('#/receipts?' + new URLSearchParams(Object.fromEntries(new FormData(form)))); });
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel('rejista_ya_risiti', { Risiti: rows.map(r => ({ Risiti: r.receipt_no, Tarehe: r.issued_at, Mlipaji: r.payer_name, Aina: r.category_name, Kigango: r.kigango_name, Jumuiya: r.jumuiya_name, Kiasi: Number(r.amount), Hali: r.status })) }));
    },
  };

  /* ================= TAARIFA YA FEDHA ================= */
  const periodRange = (period, index, year) => {
    let a, b;
    if (period === 'month') { a = new Date(year, index - 1, 1); b = new Date(year, index, 0); }
    else if (period === 'quarter') { const m = (index - 1) * 3; a = new Date(year, m, 1); b = new Date(year, m + 3, 0); }
    else if (period === 'half') { const m = (index - 1) * 6; a = new Date(year, m, 1); b = new Date(year, m + 6, 0); }
    else if (period === 'nine') { a = new Date(year, 0, 1); b = new Date(year, 9, 0); }
    else { a = new Date(year, 0, 1); b = new Date(year, 11, 31); }
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(a), to: iso(b) };
  };
  V.financeReport = {
    title: 'Taarifa ya Fedha', perm: 'finance.read',
    async render(el, params) {
      const period = params.period || 'month', year = Number(params.year || P.year());
      const index = Number(params.period_index || (new Date().getMonth() + 1));
      const scope = params.scope || P.scopeUnit() || '';
      const defaults = periodRange(['month', 'quarter', 'half', 'nine'].includes(period) ? period : 'year', index, year);
      const from = params.from || defaults.from, to = params.to || defaults.to;
      const scopeLbl = scope ? P.ref.unitsById[scope]?.label || 'Eneo lililochaguliwa' : 'Parokia nzima';
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Taarifa ya fedha</h1><p class="pm-muted">Ripoti moja ya kipindi: kadiriwa, halisi, tofauti na salio. Chagua mwezi, robo mwaka, nusu mwaka, miezi tisa au mwaka mzima.</p></div>
        <div class="pm-actions"><button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button><button class="pm-btn" data-print><span class="material-symbols-outlined">picture_as_pdf</span>PDF / Chapa</button></div></div>
        <form class="pm-filters">
          <label>Mwaka<input type="number" name="year" min="2000" max="2100" value="${year}"></label>
          <label>Kipindi<select name="period"><option value="month" ${period==='month'?'selected':''}>Mwezi</option><option value="quarter" ${period==='quarter'?'selected':''}>Robo mwaka</option><option value="half" ${period==='half'?'selected':''}>Nusu mwaka</option><option value="nine" ${period==='nine'?'selected':''}>Miezi tisa (Jan–Sep)</option><option value="year" ${period==='year'?'selected':''}>Mwaka mzima</option><option value="custom" ${period==='custom'?'selected':''}>Tarehe maalum</option></select></label>
          <label data-index-wrap style="${['month','quarter','half'].includes(period)?'':'display:none'}">Namba ya kipindi<select name="period_index">${Array.from({length:period==='quarter'?4:period==='half'?2:12},(_,i)=>`<option value="${i+1}" ${index===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label>
          <label data-from-wrap style="${period==='custom'?'':'display:none'}">Kuanzia<input type="date" name="from" value="${from}"></label><label data-to-wrap style="${period==='custom'?'':'display:none'}">Hadi<input type="date" name="to" value="${to}"></label>
          <label class="pm-wide">Eneo<select name="scope">${P.unitOptions(['kigango','jumuiya'],{blank:'Parokia nzima',selected:scope})}</select></label>
          <button class="pm-btn pm-btn--primary">Tengeneza ripoti</button></form>
        <section class="pm-card" data-out>${P.loading()}</section>`;
      const form = el.querySelector('.pm-filters'), typeSelect = form.elements.period;
      const syncPeriod = () => {
        const count = typeSelect.value === 'quarter' ? 4 : typeSelect.value === 'half' ? 2 : 12;
        const indexSelect = form.elements.period_index, old = Math.min(Number(indexSelect.value) || 1, count);
        indexSelect.innerHTML = Array.from({length:count},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join(''); indexSelect.value=String(old);
        el.querySelector('[data-index-wrap]').style.display=['month','quarter','half'].includes(typeSelect.value)?'':'none';
        el.querySelector('[data-from-wrap]').style.display=typeSelect.value==='custom'?'':'none';
        el.querySelector('[data-to-wrap]').style.display=typeSelect.value==='custom'?'':'none';
      };
      typeSelect.addEventListener('change',syncPeriod);
      form.addEventListener('submit',e=>{
        e.preventDefault(); const values=Object.fromEntries(new FormData(form));
        if(values.period==='custom'){
          if(!values.from||!values.to||values.to<values.from){Toast.error('Weka tarehe sahihi za mwanzo na mwisho.');return;}
        } else {const range=periodRange(values.period,Number(values.period_index||1),Number(values.year));values.from=range.from;values.to=range.to;}
        P.go('#/reports?'+new URLSearchParams({...values,group:'finance'}));
      });
      const data=await P.rpc('financial_period_report',{p_from:from,p_to:to,p_scope:scope||null});
      const rows=data.lines||[], incomeRows=rows.filter(x=>x.kind!=='expense'), expenseRows=rows.filter(x=>x.kind==='expense');
      const cols=[{key:'name',label:'Kipengele'},{key:'budget_amount',label:'Kadiriwa',fmt:P.tzs,cls:'pm-num'},
        {key:'actual_amount',label:'Halisi',fmt:P.tzs,cls:'pm-num'},{key:'variance_amount',label:'Ziada / Pungufu',fmt:P.tzs,cls:'pm-num pm-strong'},
        {key:'variance_reason',label:'Sababu',html:x=>P.esc(x.variance_reason||'—')}];
      const sumFoot=list=>({name:'<b>JUMLA</b>',budget_amount:P.tzs(P.sum(list,'budget_amount')),actual_amount:`<b>${P.tzs(P.sum(list,'actual_amount'))}</b>`,variance_amount:P.tzs(P.sum(list,'variance_amount'))});
      const cards=`<div class="pm-kpis">${P.kpi('Salio la mwanzo',P.tzs(data.opening_balance),'account_balance')}${P.kpi('Mapato',P.tzs(data.income_total),'trending_up')}${P.kpi('Matumizi',P.tzs(data.expense_total),'trending_down')}${P.kpi('Salio la mwisho',P.tzs(data.closing_balance),'savings')}</div>`;
      const edit=P.can('finance.configure')?'<button class="pm-btn pm-btn--sm" data-budget>Weka / hariri bajeti na sababu</button>':'';
      const out=el.querySelector('[data-out]');
      out.innerHTML=P.reportHeader('Taarifa ya fedha',`${scopeLbl} · ${P.date(from)} – ${P.date(to)}`)+cards+`<p class="pm-muted pm-small">Marekebisho ya salio yaliyothibitishwa: ${P.tzs(data.adjustment_total||0)}</p>`+edit+
        `<h2 class="pm-h3">A. Mapato</h2>${P.table(incomeRows,cols,{foot:sumFoot(incomeRows),empty:'Hakuna mapato yaliyorekodiwa kwenye kipindi hiki.'})}<h2 class="pm-h3">B. Matumizi</h2>${P.table(expenseRows,cols,{foot:sumFoot(expenseRows),empty:'Hakuna matumizi yaliyorekodiwa kwenye kipindi hiki.'})}<p class="pm-muted pm-small pm-print-foot">Salio la mwanzo ni fedha iliyokuwepo kabla ya kipindi. Mapato na matumizi yanahesabu miamala iliyothibitishwa pekee; uhamisho wa ndani hauhesabiwi mara mbili. Tofauti ni halisi ukitoa kadiriwa; sababu hujazwa na msimamizi.</p>`;
      if(P.can('finance.configure')) out.querySelector('[data-budget]').addEventListener('click',async()=>{
        const choices=P.ref.cats.filter(c=>c.is_active&&c.code!=='TRANSFER');
        const v=await P.modal({title:'Bajeti na sababu ya tofauti',body:`<div class="pm-form"><label>Aina ya mapato/matumizi<select name="category_id" required>${P.options(choices,{label:'name_sw',blank:'Chagua…'})}</select></label><label>Bajeti ya kipindi (TZS)<input name="budget_amount" type="number" min="0" step="1" required></label><label class="pm-span2">Sababu ya tofauti (ikiwezekana)<textarea name="variance_reason" rows="3" maxlength="500"></textarea></label></div><p class="pm-muted pm-small">Kipindi: ${P.date(from)} – ${P.date(to)}. Bajeti itahifadhiwa kwa ${P.esc(scopeLbl)}.</p>`,submit:'Hifadhi bajeti'});
        if(!v)return;await P.rpc('save_financial_period_budget',{p:{org_unit_id:scope||null,period_start:from,period_end:to,category_id:v.category_id,budget_amount:v.budget_amount,variance_reason:v.variance_reason}});Toast.success('Bajeti imehifadhiwa.');P.reload();
      });
      el.querySelector('[data-print]').addEventListener('click',()=>P.print('Taarifa ya fedha',{orientation:'landscape'}));
      const xlsRows=list=>list.map(x=>({'Kipengele':x.name,'Kadiriwa':Number(x.budget_amount),'Halisi':Number(x.actual_amount),'Tofauti':Number(x.variance_amount),'Sababu':x.variance_reason||''}));
      el.querySelector('[data-xls]').addEventListener('click',()=>P.exportExcel('Taarifa_ya_fedha',{Muhtasari:[{Eneo:scopeLbl,Kipindi:`${from} - ${to}`,'Salio la mwanzo':Number(data.opening_balance),'Mapato':Number(data.income_total),'Matumizi':Number(data.expense_total),'Marekebisho':Number(data.adjustment_total||0),'Salio la mwisho':Number(data.closing_balance)}],Mapato:xlsRows(incomeRows),Matumizi:xlsRows(expenseRows)}));
    },
  };

  /* ================= RIPOTI: kitovu na fomu za A4 ================= */
  const REPORT_GROUPS = [
    ['parish_read', 'Ripoti za kusoma parokiani'], ['jumuiya', 'Ripoti za kwenda nazo jumuiyani'],
    ['kigango', 'Ripoti za michango ya vigango'], ['parish', 'Ripoti za kiparokia'],
    ['finance', 'Taarifa za fedha'], ['forms', 'Fomu mbalimbali'],
  ];
  const REPORT_TYPES = {
    parish_read: [['family', 'Michango inayopangiwa familia'], ['zaka', 'Zaka ya kila mwezi kwa muumini'], ['assigned', 'Michango inayopangiwa jumuiya'], ['parish_summary', 'Muhtasari wa michango parokiani']],
    jumuiya: [['tracker', 'Ufuatiliaji wa michango ya jumuiya'], ['zaka', 'Zaka ya kila mwezi kwa waumini'], ['family', 'Mavuno na Ujenzi kwa familia']],
    kigango: [['kigango', 'Michango ya kigango kimoja'], ['all_kigango', 'Michango ya vigango vyote']],
    parish: [['parish_summary', 'Muhtasari wa michango yote'], ['family', 'Utoaji wa kila familia parokiani']],
    finance: [['finance_period', 'Mapato na Matumizi (mwezi / robo / mwaka)']],
    forms: [['zaka_form', 'Fomu ya Zaka'], ['family_form', 'Fomu ya Mavuno na Ujenzi'], ['free_form', 'Fomu huru']],
  };
  const REPORT_TITLES = Object.fromEntries(Object.values(REPORT_TYPES).flat().map(x => [x[0], x[1]]));
  const reportScopeName = id => {
    if (!id) return 'Parokia nzima';
    const u = P.ref.unitsById[id];
    return u ? `${u.unit_type === 'kigango' ? 'Kigango cha' : 'Jumuiya ya'} ${u.name}` : 'Eneo lililochaguliwa';
  };
  const reportScopeUnits = id => {
    if (!id) return null;
    const u = P.ref.unitsById[id];
    if (!u) return [];
    return u.unit_type === 'kigango' ? [u.id, ...P.unitsOf('jumuiya').filter(j => j.parent_id === u.id).map(j => j.id)] : [u.id];
  };
  const reportScopeJumuiyaIds = id => {
    if (!id) return null;
    const u=P.ref.unitsById[id];
    if(u?.unit_type==='kigango') return P.unitsOf('jumuiya').filter(j=>j.parent_id===id).map(j=>j.id);
    return u?.unit_type==='jumuiya'?[id]:[];
  };
  const reportSort = (rows, key) => [...rows].sort((a,b) => {
    if (key === 'name') return String(a.name || a.family_name || '').localeCompare(String(b.name || b.family_name || ''), 'sw');
    const value = r => key==='pledged' ? (r.pledged??r.target??r.total) : key==='paid' ? (r.paid??r.collected??r.total) : key==='balance' ? (r.balance??r.months_unpaid) : (r.pct??r.completion_pct??r.months_paid);
    return (Number(value(b)) || 0) - (Number(value(a)) || 0);
  });
  const reportGroupCampaigns = (ids, year, eligible) => {
    const all = P.ref.camps.filter(c => Number(c.campaign_year) === Number(year) && c.status !== 'closed');
    const eligibleCampaigns = all.filter(eligible || (() => true));
    const chosen = ids.length ? eligibleCampaigns.filter(c => ids.includes(c.id)) : [];
    return chosen;
  };
  const reportCampaignPicker = (campaigns, selected, max = 0) => `<details class="pm-report-campaigns" data-campaign-picker><summary>Chagua michango <small data-campaign-count>${selected.length} imechaguliwa</small></summary>
    <div class="pm-report-campaign-list">${campaigns.length ? campaigns.map(c => `<label><input type="checkbox" name="campaign_id" value="${P.esc(c.id)}" ${selected.includes(c.id) ? 'checked' : ''}><span>${P.esc(c.name)} <small>${P.esc(c.category_name || P.ref.catsById[c.category_id]?.name_sw || '')}</small></span></label>`).join('') : '<p class="pm-muted">Hakuna michango ya mwaka huu.</p>'}</div>
    ${max ? `<small class="pm-muted" data-campaign-limit>Chagua hadi michango ${max}.</small>` : ''}</details>`;
  const reportMembersAndFamilies = async scope => {
    let fq = P.from('families').select('id,family_name,family_code,head_parishioner_id,jumuiya_id').eq('status','active').order('family_name').limit(10000);
    const units = reportScopeJumuiyaIds(scope);
    if (units) fq = fq.in('jumuiya_id', units.length?units:['00000000-0000-0000-0000-000000000000']);
    const families = await P.q(fq);
    const ids = families.map(f => f.id);
    if (!ids.length) return { families, people: [] };
    const people = await P.q(P.from('parishioners').select('id,full_name,phone,family_id,jumuiya_id').in('family_id', ids).eq('membership_status','active').order('full_name').limit(10000));
    return { families, people };
  };
  const reportZakaRows = async (year, scope) => {
    const grid = await P.rpc('zaka_grid_tree', { p_year: year, p_level: 'parishioner', p_scope: scope || null });
    const units = reportScopeJumuiyaIds(scope);
    let q = P.from('parishioners').select('id,full_name,phone,family_id,jumuiya_id').eq('membership_status','active').order('full_name').limit(10000);
    if (units) q = q.in('jumuiya_id', units.length?units:['00000000-0000-0000-0000-000000000000']);
    const people = await P.q(q), byId = Object.fromEntries(grid.map(r => [r.group_id, r]));
    const now=new Date(), elapsed=Number(year)<now.getFullYear()?12:Number(year)>now.getFullYear()?0:now.getMonth()+1;
    return people.map(p => {
      const g = byId[p.id] || {};
      const row = { id: p.id, name: p.full_name, phone: p.phone, family_id: p.family_id, jumuiya_name: P.ref.unitsById[p.jumuiya_id]?.name || '', total: Number(g.total) || 0,
        months_paid: Number(g.months_paid) || 0, months_unpaid: g.group_id?Number(g.months_unpaid)||0:elapsed };
      for (let i=1;i<=12;i++) row[`m${String(i).padStart(2,'0')}`] = Number(g[`m${String(i).padStart(2,'0')}`]) || 0;
      return row;
    });
  };
  const renderZakaReport = async (out, year, scope, sort) => {
    const rows = reportSort(await reportZakaRows(year, scope).then(x => x.map(r => ({...r, balance: r.months_unpaid}))), sort);
    const cols = [{key:'name',label:'Muumini'},{key:'phone',label:'Simu'},{key:'jumuiya_name',label:'Jumuiya'}, ...P.MONTHS.map((m,i)=>({key:`m${String(i+1).padStart(2,'0')}`,label:m,fmt:v=>Number(v)?P.tzs(v):'—',cls:'pm-num'})),
      {key:'total',label:'Jumla',fmt:P.tzs,cls:'pm-num pm-strong'},{key:'months_paid',label:'Amelipa miezi',fmt:v=>P.num(v),cls:'pm-num'},{key:'months_unpaid',label:'Bado miezi',fmt:v=>P.num(v),cls:'pm-num'}];
    const monthFoot={name:'<b>JUMLA</b>',total:`<b>${P.tzs(P.sum(rows,'total'))}</b>`,months_paid:P.num(P.sum(rows,'months_paid')),months_unpaid:P.num(P.sum(rows,'months_unpaid'))};
    P.MONTHS.forEach((_,i)=>monthFoot[`m${String(i+1).padStart(2,'0')}`]=P.tzs(P.sum(rows,`m${String(i+1).padStart(2,'0')}`)));
    out.innerHTML = P.reportHeader(`Taarifa ya Zaka ${year}`, `${reportScopeName(scope)} · Zaka ya kila mwezi kwa muumini`) + P.table(rows,cols,{foot:monthFoot,empty:'Hakuna waumini au malipo ya Zaka kwenye eneo hili.'});
    return {rows, cols};
  };
  const renderFamilyContribution = async (out, campaigns, year, scope, sort) => {
    const ids=campaigns.map(c=>c.id);
    let q=P.from('v_pledge_balances').select('*').eq('campaign_year',year).eq('status','active').limit(10000);
    if(ids.length) q=q.in('campaign_id',ids);
    const scopeUnit=P.ref.unitsById[scope];
    if(scopeUnit?.unit_type==='kigango'){
      const jumIds=P.unitsOf('jumuiya').filter(j=>j.parent_id===scope).map(j=>j.id);
      if(jumIds.length)q=q.in('jumuiya_id',jumIds);else q=q.eq('jumuiya_id','00000000-0000-0000-0000-000000000000');
    } else if(scopeUnit?.unit_type==='jumuiya') q=q.eq('jumuiya_id',scope);
    const pledges=await P.q(q);
    const chosen=campaigns.length?campaigns:P.ref.camps.filter(c=>Number(c.campaign_year)===Number(year)&&c.status!=='closed'&&(c.giver_level==='family'||['mavuno','ujenzi'].includes(P.ref.catsById[c.category_id]?.kind)));
    let html=P.reportHeader(`Utoaji wa familia ${year}`,`${reportScopeName(scope)} · ${chosen.map(c=>c.name).join(' + ')||'Michango inayopangiwa familia'}`);
    const sets=[];
    for(const c of chosen){
      const by={};
      pledges.filter(r=>r.campaign_id===c.id).forEach(r=>{
        const key=r.family_id||`person:${r.parishioner_id}`;
        const x=by[key]||=( {family_name:r.family_name||r.parishioner_name||'—',jumuiya_name:r.jumuiya_name||P.ref.unitsById[r.jumuiya_id]?.name||'',pledged:0,paid:0,balance:0,excess:0,completion_pct:0} );
        x.pledged+=Number(r.pledged)||0;x.paid+=Number(r.paid)||0;x.balance+=Number(r.outstanding)||0;x.excess+=Number(r.excess)||0;
      });
      let rows=Object.values(by).map(r=>({...r,completion_pct:r.pledged?Math.round(r.paid/r.pledged*1000)/10:0}));
      rows=reportSort(rows.map(r=>({...r,pct:r.completion_pct})),sort);
      const foot={family_name:'<b>JUMLA</b>',pledged:P.tzs(P.sum(rows,'pledged')),paid:`<b>${P.tzs(P.sum(rows,'paid'))}</b>`,balance:P.tzs(P.sum(rows,'balance')),excess:P.tzs(P.sum(rows,'excess')),completion_pct:P.pct(P.sum(rows,'pledged')?P.sum(rows,'paid')/P.sum(rows,'pledged')*100:0)};
      html+=`<h2 class="pm-h3">${P.esc(c.name)}</h2>${P.table(rows,[{key:'family_name',label:'Familia / Mlipaji'},{key:'jumuiya_name',label:'Jumuiya'},{key:'pledged',label:'Pangiwa',fmt:P.tzs,cls:'pm-num'},{key:'paid',label:'Amelipa',fmt:P.tzs,cls:'pm-num'},{key:'balance',label:'Bado',fmt:P.tzs,cls:'pm-num'},{key:'excess',label:'Ziada',fmt:P.tzs,cls:'pm-num'},{key:'completion_pct',label:'% ya utekelezaji',fmt:P.pct,cls:'pm-num'}],{foot,empty:'Hakuna mgao wa familia kwa mchango huu.'})}`;
      sets.push({campaign:c.name,rows});
    }
    out.innerHTML=html;
    return {sets};
  };
  const renderCampaignUnitReport = async (out, campaigns, year, scope, sort, allKigango=false) => {
    let html=P.reportHeader(allKigango?'Michango ya vigango vyote':`Michango ${year}`,`${reportScopeName(scope)} · ${campaigns.map(c=>c.name).join(' + ')||'Michango yote'}`), sets=[];
    for(const c of campaigns){
      const scopeType=P.ref.unitsById[scope]?.unit_type;
      const scopedType=allKigango?'kigango':(scopeType==='kigango'||scopeType==='jumuiya'?'jumuiya':'kigango');
      let rows=await P.rpc('campaign_org_progress',{p_campaign:c.id,p_level:scopedType});
      if(!allKigango&&scopeType==='kigango') rows=rows.filter(r=>P.ref.unitsById[r.org_unit_id]?.parent_id===scope);
      else if(!allKigango&&scopeType==='jumuiya') rows=rows.filter(r=>r.org_unit_id===scope);
      rows=reportSort(rows.map(r=>({...r,name:r.org_unit_name,paid:Number(r.collected)||0,pct:r.pct})),sort);
      const unitLabel=scopedType==='kigango'?'Kigango':'Jumuiya';
      const foot={org_unit_name:'<b>JUMLA</b>',target:P.tzs(P.sum(rows,'target')),collected:`<b>${P.tzs(P.sum(rows,'collected'))}</b>`,balance:P.tzs(P.sum(rows,'balance')),pct:P.pct(P.sum(rows,'target')?P.sum(rows,'collected')/P.sum(rows,'target')*100:0),payers:P.num(P.sum(rows,'payers'))};
      html+=`<h2 class="pm-h3">${P.esc(c.name)}</h2>${P.table(rows,[{key:'org_unit_name',label:unitLabel},{key:'kigango_name',label:'Kigango'},{key:'target',label:'Pangiwa',fmt:P.tzs,cls:'pm-num'},{key:'collected',label:'Kilichotolewa',fmt:P.tzs,cls:'pm-num'},{key:'balance',label:'Bado',fmt:P.tzs,cls:'pm-num'},{key:'pct',label:'% ya utekelezaji',fmt:P.pct,cls:'pm-num'},{key:'payers',label:'Walipaji',fmt:P.num,cls:'pm-num'}],{foot,empty:'Hakuna mgao au malipo ya mchango huu.'})}`;
      sets.push({campaign:c.name,rows});
    }
    out.innerHTML=html; return {sets};
  };
  const renderParishSummary = async (out, year, campaigns, scope, sort) => {
    const rows0=await P.q(P.from('v_campaign_progress').select('*').eq('campaign_year',year).order('name').limit(1000)), ids=campaigns.map(c=>c.id), units=reportScopeUnits(scope);
    let rows=rows0.filter(r=>!ids.length||ids.includes(r.campaign_id));
    const scopeType=P.ref.unitsById[scope]?.unit_type;
    if(units?.length&&scopeType){
      rows=await Promise.all(rows.map(async r=>{
        const progress=await P.rpc('campaign_org_progress',{p_campaign:r.campaign_id,p_level:scopeType});
        const inScope=progress.filter(x=>x.org_unit_id===scope);
        return {...r,target:P.sum(inScope,'target'),pledged:P.sum(inScope,'pledged'),collected:P.sum(inScope,'collected'),outstanding_pledges:P.sum(inScope,'balance')};
      }));
    }
    rows=reportSort(rows.map(r=>({...r,name:r.name,paid:Number(r.collected)||0,balance:Number(r.outstanding_pledges)||Math.max((Number(r.target)||0)-(Number(r.collected)||0),0),pct:r.target?Number(r.collected)/Number(r.target)*100:0})),sort);
    const foot={name:'<b>JUMLA</b>',target:P.tzs(P.sum(rows,'target')),collected:`<b>${P.tzs(P.sum(rows,'collected'))}</b>`,balance:P.tzs(P.sum(rows,'balance')),pledged:P.tzs(P.sum(rows,'pledged'))};
    out.innerHTML=P.reportHeader(`Muhtasari wa michango ${year}`,reportScopeName(scope))+P.table(rows,[{key:'name',label:'Mchango'},{key:'category_name',label:'Aina'},{key:'target',label:'Lengo / Pangiwa',fmt:P.tzs,cls:'pm-num'},{key:'pledged',label:'Ahadi',fmt:P.tzs,cls:'pm-num'},{key:'collected',label:'Imekusanywa',fmt:P.tzs,cls:'pm-num'},{key:'balance',label:'Bado',fmt:P.tzs,cls:'pm-num'},{key:'pct',label:'%',fmt:P.pct,cls:'pm-num'}],{foot,empty:`Hakuna michango ya ${year} kwa eneo hili.`}); return {rows};
  };
  const renderJumuiyaTracker = async (out, year, scope, sort) => {
    const unit=P.ref.unitsById[scope]; if(!unit||unit.unit_type!=='jumuiya'){out.innerHTML=P.empty('Chagua jumuiya moja ili kuandaa ripoti ya kufuatilia michango.');return {rows:[]};}
    const [campaignRows,zakaRows,pledges]=await Promise.all([
      P.rpc('unit_contributions',{p_year:year,p_unit:scope}),reportZakaRows(year,scope),
      P.q(P.from('v_pledge_balances').select('*').eq('jumuiya_id',scope).eq('campaign_year',year).eq('status','active').limit(10000)),
    ]);
    const campaignTotals=campaignRows.map(r=>({name:r.campaign_name,category_name:r.category_name,pledged:Number(r.obligation)||0,collected:Number(r.collected)||Number(r.paid)||0,balance:Number(r.balance)||0,pct:Number(r.pct)||0,kind:'Mchango'}));
    const monthsElapsed=year<new Date().getFullYear()?12:year>new Date().getFullYear()?0:new Date().getMonth()+1;
    const zakaTotal=P.sum(zakaRows,'total'), zakaUnpaid=zakaRows.reduce((s,r)=>s+Math.max(monthsElapsed-r.months_paid,0),0);
    const status=[...campaignTotals,{name:`Zaka ${year}`,category_name:'Zaka ya kila mwezi',pledged:0,collected:zakaTotal,balance:0,pct:zakaRows.length?P.sum(zakaRows,'months_paid')/(zakaRows.length*Math.max(monthsElapsed,1))*100:0,kind:`${zakaUnpaid} miezi bado`}];
    const detailed={};
    pledges.forEach(r=>{const key=r.campaign_id;const x=(detailed[key]||={name:r.campaign_name,rows:[]});x.rows.push({name:r.family_name||r.parishioner_name||r.org_unit_name,pledged:Number(r.pledged)||0,paid:Number(r.paid)||0,balance:Number(r.outstanding)||0});});
    let sorted=reportSort(status.map(r=>({...r,paid:r.collected,balance:r.balance,pct:r.pct})),sort);
    const dash=`<section class="pm-report-dashboard"><div class="pm-kpis">${P.kpi('Michango',P.num(status.length),'volunteer_activism')}${P.kpi('Jumla iliyolipwa',P.tzs(P.sum(campaignTotals,'collected')+zakaTotal),'payments')}${P.kpi('Miezi ya Zaka bado',P.num(zakaUnpaid),'calendar_month')}${P.kpi('Familia',P.num(new Set(pledges.map(p=>p.family_id).filter(Boolean)).size),'family_restroom')}</div>
      <h2 class="pm-h3">Hali ya michango yote</h2>${P.table(sorted,[{key:'name',label:'Mchango'},{key:'category_name',label:'Aina'},{key:'pledged',label:'Pangiwa',fmt:P.tzs,cls:'pm-num'},{key:'collected',label:'Imelipwa',fmt:P.tzs,cls:'pm-num'},{key:'balance',label:'Bado',fmt:P.tzs,cls:'pm-num'},{key:'pct',label:'Utekelezaji',fmt:P.pct,cls:'pm-num'},{key:'kind',label:'Maelezo'}],{empty:'Hakuna michango iliyopangwa.'})}</section>`;
    let body=P.reportHeader(`Ufuatiliaji wa michango ${year}`,reportScopeName(scope))+dash;
    for(const g of Object.values(detailed)) body+=`<h2 class="pm-h3">${P.esc(g.name)}</h2>${P.table(reportSort(g.rows,sort),[{key:'name',label:'Familia / Mlipaji'},{key:'pledged',label:'Pangiwa',fmt:P.tzs,cls:'pm-num'},{key:'paid',label:'Amelipa',fmt:P.tzs,cls:'pm-num'},{key:'balance',label:'Bado',fmt:P.tzs,cls:'pm-num'}],{empty:'Hakuna mgao kwa sasa.'})}`;
    body+=`<h2 class="pm-h3">Zaka ya waumini ${year}</h2>${P.table(zakaRows.map(r=>({...r,balance:r.months_unpaid})),[{key:'name',label:'Muumini'},{key:'phone',label:'Simu'},{key:'total',label:'Zaka imelipwa',fmt:P.tzs,cls:'pm-num'},{key:'months_paid',label:'Miezi amelipa',fmt:P.num,cls:'pm-num'},{key:'months_unpaid',label:'Miezi bado',fmt:P.num,cls:'pm-num'}],{empty:'Hakuna taarifa za Zaka.'})}`;
    out.innerHTML=body; return {rows:sorted,campaignRows,zakaRows,pledges};
  };
  const renderReportForms = async (out, type, scope, year, labels) => {
    const {families,people}=await reportMembersAndFamilies(scope);
    const familyPerson=Object.fromEntries(people.map(p=>[p.id,p]));
    const famRow=f=>{const p=familyPerson[f.head_parishioner_id]||people.find(x=>x.family_id===f.id);return {family_name:f.family_name,phone:f.phone||p?.phone||'',head_name:p?.full_name||''};};
    let html='',orientation='landscape';
    if(type==='zaka_form'){
      const rows=people.map(p=>({name:p.full_name,family_name:families.find(f=>f.id===p.family_id)?.family_name||'',phone:p.phone||''}));
      html=P.reportHeader(`Fomu ya utoaji wa Zaka ${year}`,reportScopeName(scope))+P.table(rows.map((r,i)=>({no:i+1,...r,...Object.fromEntries(P.MONTHS.map((_,j)=>[`m${j+1}`, '']))})),[{key:'no',label:'Na.'},{key:'name',label:'Jina la muumini'},{key:'family_name',label:'Familia'},{key:'phone',label:'Namba ya simu'},...P.MONTHS.map((m,i)=>({key:`m${i+1}`,label:m})),{key:'total',label:'Jumla'}],{empty:'Hakuna waumini katika eneo hili.'});
    } else if(type==='family_form'){
      html=P.reportHeader(`Fomu ya Mavuno na Ujenzi ${year}`,reportScopeName(scope))+`<p class="pm-muted">Jaza mawasilisho ya familia; kiasi na thamani za mazao/mifugo hujazwa wakati wa kupokea.</p>`+P.table(families.map((f,i)=>({no:i+1,...famRow(f)})),[{key:'no',label:'Na.'},{key:'family_name',label:'Familia'},{key:'phone',label:'Simu'},{key:'mavuno',label:'Mavuno (TZS)'},{key:'mifugo',label:'Mifugo'},{key:'mazao',label:'Mazao'},{key:'thamani',label:'Thamani (TZS)'},{key:'ujenzi',label:'Ujenzi (TZS)'},{key:'zaka',label:'Zaka (TZS)'},{key:'shukrani',label:'Shukrani / Baraka'}],{empty:'Hakuna familia katika eneo hili.'});
    } else {
      const custom=(labels||'').split(/[\n,;]/).map(x=>x.trim()).filter(Boolean).slice(0,8);
      orientation=custom.length>3?'landscape':'portrait';
      const rows=families.map((f,i)=>({no:i+1,...famRow(f),...Object.fromEntries(custom.map((_,j)=>[`c${j}`, '']))}));
      html=P.reportHeader(`Fomu huru ${year}`,reportScopeName(scope))+P.table(rows,[{key:'no',label:'Na.'},{key:'family_name',label:'Familia'},{key:'phone',label:'Namba ya simu'},...custom.map((label,i)=>({key:`c${i}`,label}))],{empty:'Hakuna familia katika eneo hili.'});
    }
    out.innerHTML=html; return {families,people,orientation};
  };
  V.reports = {
    title:'Ripoti', perm:'finance.read',
    async render(el,params){
      if((params.group==='finance'&&params.type==='finance_period')||params.period||params.from||(!params.group&&!params.type&&params.scope)) return V.financeReport.render(el,params);
      const group=params.group||'', type=params.type||'', year=Number(params.year||P.year()), scope=params.scope||P.scopeUnit()||'', sort=params.sort||'name';
      const reportCamps=P.ref.camps.filter(c=>Number(c.campaign_year)===year&&c.status!=='closed');
      const defaultFam=reportCamps.filter(c=>['mavuno','ujenzi'].includes(P.ref.catsById[c.category_id]?.kind)).slice(0,2).map(c=>c.id);
      const ids=String(params.campaigns||'').split(',').filter(Boolean), hasCampaignParam=Object.prototype.hasOwnProperty.call(params,'campaigns'), selected=hasCampaignParam?ids:((type==='family')?defaultFam:[]);
      const typeDefs=REPORT_TYPES[group]||[];
      const typesOptions=typeDefs.map(([v,l])=>`<option value="${v}" ${v===type?'selected':''}>${l}</option>`).join('');
      const filterCampaigns=['family','assigned','kigango','all_kigango','parish_summary'].includes(type);
      const maxCampaigns=['family','assigned'].includes(type)?2:0;
      const scopeTypes=group==='jumuiya'?['jumuiya']:['kigango','jumuiya'];
      const scopeOptions=P.unitOptions(scopeTypes,{blank:group==='jumuiya'?'Chagua jumuiya…':'Parokia nzima',selected:scope});
      el.innerHTML=`<div class="pm-head"><div><h1 class="pm-h1">Ripoti</h1><p class="pm-muted">Chagua kundi, eneo na ripoti. Kila ripoti huweka tarehe ya kuchapishwa na ukurasa wa A4 unaofaa.</p></div></div>
        <section class="pm-card pm-report-controls"><form class="pm-form pm-report-filters" data-report-form>
          <label>Kundi la ripoti<select name="group"><option value="">Chagua kundi…</option>${REPORT_GROUPS.map(([v,l])=>`<option value="${v}" ${v===group?'selected':''}>${l}</option>`).join('')}</select></label>
          <label>Ripoti<select name="type" data-report-type><option value="">Chagua ripoti…</option>${typesOptions}</select></label>
          <label>Mwaka<input type="number" name="year" min="2000" max="2100" value="${year}"></label>
          <label>Eneo<select name="scope">${scopeOptions}</select></label>
          <label>Mpangilio wa ukurasa<select name="orientation"><option value="auto" ${(params.orientation||'auto')==='auto'?'selected':''}>Uliopendekezwa</option><option value="portrait" ${params.orientation==='portrait'?'selected':''}>Portrait</option><option value="landscape" ${params.orientation==='landscape'?'selected':''}>Landscape</option></select></label>
          <label>Panga kwa<select name="sort"><option value="name" ${sort==='name'?'selected':''}>Jina</option><option value="pledged" ${sort==='pledged'?'selected':''}>Kiasi kilichopangiwa</option><option value="paid" ${sort==='paid'?'selected':''}>Kilicholipwa</option><option value="balance" ${sort==='balance'?'selected':''}>Kiasi kilichobaki</option><option value="pct" ${sort==='pct'?'selected':''}>Asilimia ya utekelezaji</option></select></label>
          <label class="pm-span2" data-campaign-wrap ${filterCampaigns?'':'hidden'}>${reportCampaignPicker(type==='family'?reportCamps.filter(c=>c.giver_level==='family'||['mavuno','ujenzi'].includes(P.ref.catsById[c.category_id]?.kind)):reportCamps,selected,maxCampaigns)}</label>
          <label class="pm-span2" data-free-labels ${type==='free_form'?'':'hidden'}>Vichwa vya safu za fomu huru<input name="labels" maxlength="300" value="${P.esc(params.labels||'')}" placeholder="Mfano: Mavuno, Mifugo, Mazao, Maelezo"></label>
          <div class="pm-span2 pm-actions"><button class="pm-btn pm-btn--primary"><span class="material-symbols-outlined">description</span>Tengeneza ripoti</button></div>
        </form></section>
        <section class="pm-card" data-report-output>${group&&type?P.loading():P.empty('Chagua kundi la ripoti ili kuona aina za ripoti zake.')}</section>`;
      const form=el.querySelector('[data-report-form]'), groupField=form.elements.group, typeField=form.elements.type, campaignWrap=el.querySelector('[data-campaign-wrap]'), freeLabels=el.querySelector('[data-free-labels]');
      const syncForm=()=>{
        const defs=REPORT_TYPES[groupField.value]||[]; typeField.innerHTML='<option value="">Chagua ripoti…</option>'+defs.map(([v,l])=>`<option value="${v}" ${v===type?'selected':''}>${l}</option>`).join('');
        if(!defs.some(x=>x[0]===typeField.value)) typeField.value='';
        campaignWrap.hidden=!['family','assigned','kigango','all_kigango','parish_summary'].includes(typeField.value);
        freeLabels.hidden=typeField.value!=='free_form';
        form.elements.scope.innerHTML=P.unitOptions(groupField.value==='jumuiya'?['jumuiya']:['kigango','jumuiya'],{blank:groupField.value==='jumuiya'?'Chagua jumuiya…':'Parokia nzima',selected:scope});
        const max=['family','assigned'].includes(typeField.value)?2:0;
        let checked=[...campaignWrap.querySelectorAll('[name=campaign_id]:checked')].map(x=>x.value);
        if(typeField.value==='family'&&!checked.length)checked=defaultFam;
        const eligible=typeField.value==='family'?reportCamps.filter(c=>c.giver_level==='family'||['mavuno','ujenzi'].includes(P.ref.catsById[c.category_id]?.kind)):reportCamps;
        campaignWrap.innerHTML=reportCampaignPicker(eligible,checked.filter(id=>eligible.some(c=>c.id===id)),max);
        const lim=campaignWrap.querySelector('[data-campaign-limit]'); if(lim)lim.hidden=!max;
      };
      groupField.addEventListener('change',()=>{syncForm();typeField.focus();});
      typeField.addEventListener('change',syncForm);
      form.addEventListener('change',e=>{
        if(e.target.name!=='campaign_id')return; const boxes=[...form.querySelectorAll('[name=campaign_id]:checked')];
        const max=['family','assigned'].includes(typeField.value)?2:0;
        if(max&&boxes.length>max){e.target.checked=false;Toast.info(`Chagua hadi michango ${max}.`);}
        form.querySelector('[data-campaign-count]').textContent=`${form.querySelectorAll('[name=campaign_id]:checked').length} imechaguliwa`;
      });
      form.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(form),vals=Object.fromEntries(fd),currentType=typeField.value,needsCampaign=['family','assigned','kigango','all_kigango','parish_summary'].includes(currentType);vals.campaigns=[...form.querySelectorAll('[name=campaign_id]:checked')].map(x=>x.value).join(',');if(needsCampaign&&!vals.campaigns){Toast.info('Chagua angalau mchango mmoja.');return;}P.go('#/reports?'+new URLSearchParams(vals));});
      syncForm();
      if(!group||!type)return;
      const out=el.querySelector('[data-report-output]'), campaigns=reportGroupCampaigns(selected,year,type==='family'?c=>c.giver_level==='family'||['mavuno','ujenzi'].includes(P.ref.catsById[c.category_id]?.kind):null);
      if(filterCampaigns&&!campaigns.length){out.innerHTML=P.empty('Chagua angalau mchango mmoja kwenye orodha kisha tengeneza ripoti.');return;}
      const exportBtn=data=>data?.rows||data?.sets?'<button class="pm-btn pm-btn--sm" data-report-excel><span class="material-symbols-outlined">download</span>Excel</button>':'';
      try{
        let data=null,orientation=['zaka','zaka_form','family_form','family','assigned','tracker','kigango','all_kigango','parish_summary'].includes(type)?'landscape':'portrait';
        if(type==='zaka')data=await renderZakaReport(out,year,scope,sort);
        else if(type==='family')data=await renderFamilyContribution(out,campaigns,year,scope,sort);
        else if(type==='assigned')data=await renderCampaignUnitReport(out,campaigns,year,scope,sort);
        else if(type==='kigango'||type==='all_kigango')data=await renderCampaignUnitReport(out,campaigns,year,scope,sort,type==='all_kigango');
        else if(type==='parish_summary')data=await renderParishSummary(out,year,campaigns,scope,sort);
        else if(type==='tracker')data=await renderJumuiyaTracker(out,year,scope,sort);
        else if(['zaka_form','family_form','free_form'].includes(type)){data=await renderReportForms(out,type,scope,year,params.labels||'');orientation=data.orientation||orientation;}
        out.classList.add('pm-report-print');
        if(params.orientation!=='portrait'&&params.orientation!=='landscape') out.dataset.orientation=orientation;
        const actions=document.createElement('div');actions.className='pm-report-output-actions';actions.innerHTML=exportBtn(data)+'<button class="pm-btn pm-btn--primary pm-btn--sm" data-report-print><span class="material-symbols-outlined">print</span>Chapa / PDF</button>';
        out.prepend(actions);
        out.querySelector('[data-report-print]').addEventListener('click',()=>P.print(REPORT_TITLES[type]||'Ripoti',{orientation:params.orientation==='portrait'||params.orientation==='landscape'?params.orientation:orientation}));
        const excel=out.querySelector('[data-report-excel]');
        excel?.addEventListener('click',()=>{
          if(data?.rows)P.exportExcel(`ripoti_${type}_${year}`,{Ripoti:data.rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='number'?v:String(v??'')]))) });
          else if(data?.sets)P.exportExcel(`ripoti_${type}_${year}`,Object.fromEntries(data.sets.map((s,i)=>[`Mchango ${i+1}`,s.rows.map(r=>({Jina:r.family_name||r.name||r.org_unit_name,Pangiwa:Number(r.pledged||r.target),Amelipa:Number(r.paid||r.collected),Bado:Number(r.balance)}))])));
          else Toast.info('Ripoti hii iko tayari kuchapishwa au kuhifadhiwa kama PDF.');
        });
      }catch(err){out.innerHTML=`<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(err))}</div>`;}
    },
  };
  /* ================= UHAKIKI WA FEDHA ================= */
  V.reconciliation = {
    title: 'Uhakiki wa Fedha', perm: 'finance.read',
    async render(el, params) {
      const tab = params.tab || 'checks';
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Uhakiki wa Fedha</h1><p class="pm-muted">Ukaguzi wa uadilifu wa hesabu, ulinganisho na workbook ya Excel, na kumbukumbu za zamani zinazosubiri uhakiki.</p></div></div>
        <nav class="pm-tabs">${[['checks', 'Ukaguzi'], ['parity', 'Excel dhidi ya mfumo'], ['legacy', 'Kumbukumbu za zamani zinazosubiri'], ['issues', 'Masuala ya uingizaji']].map(([k, v]) => `<a href="#/reconciliation?tab=${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('')}</nav>
        <section class="pm-card" data-out>${P.loading()}</section>`;
      const out = el.querySelector('[data-out]');
      if (tab === 'checks') {
        const rows = await P.rpc('finance_integrity_checks');
        out.innerHTML = P.table(rows, [{ key: 'description', label: 'Ukaguzi' }, { key: 'problem_count', label: 'Matatizo', cls: 'pm-num' },
          { key: 'ok', label: 'Hali', html: c => c.ok ? P.badge('Sawa', 'teal') : P.badge('Angalia', 'rose') }]);
      } else if (tab === 'parity') {
        const rows = await P.q(P.from('reconciliation_results').select('*').order('status').order('id').limit(3000));
        const s = rows.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
        out.innerHTML = `<p>${P.badge(`${s.match || 0} zinalingana`, 'teal')} ${P.badge(`${s.difference || 0} tofauti`, s.difference ? 'rose' : 'muted')}</p>
          <p class="pm-muted pm-small">Kila jumla ya SUM kwenye "AKAUNTI BOOK" imelinganishwa na jumla ya miamala iliyoingizwa katika safu zile zile.</p>` +
          P.table(rows.filter(x => x.status !== 'match').concat(rows.filter(x => x.status === 'match').slice(0, 50)), [
            { key: 'cell_ref', label: 'Seli' }, { key: 'description', label: 'Maelezo' }, { key: 'excel_formula', label: 'Formula' },
            { key: 'excel_value', label: 'Excel', fmt: P.num, cls: 'pm-num' }, { key: 'system_value', label: 'Mfumo', fmt: P.num, cls: 'pm-num' },
            { key: 'difference', label: 'Tofauti', fmt: P.num, cls: 'pm-num' }, { key: 'status', label: 'Hali', html: x => x.status === 'match' ? P.badge('Sawa', 'teal') : P.badge('Tofauti', 'rose') },
            { key: 'explanation', label: 'Maelezo ya tofauti' }], { empty: 'Hakuna uingizaji wa workbook uliofanyika bado.' });
      } else if (tab === 'legacy') {
        const reqs = await P.q(P.from('approval_requests').select('*').eq('request_type', 'legacy_review').eq('status', 'pending').limit(500));
        const ids = reqs.map(r => r.transaction_id);
        const tx = ids.length ? await P.q(P.from('v_ledger').select('*').in('id', ids)) : [];
        const byId = Object.fromEntries(tx.map(t => [t.id, t]));
        const can = P.can('finance.approve');
        out.innerHTML = `<p class="pm-muted">${reqs.length} kumbukumbu · TZS ${P.num(P.sum(tx, 'amount'))} — hazihesabiwi kwenye jumla yoyote hadi ziidhinishwe.</p>` +
          P.table(reqs.map(r => ({ ...r, t: byId[r.transaction_id] || {} })), [
            { key: 'row', label: 'Safu ya Excel', html: r => P.esc(r.payload?.legacy?.row || '') }, { key: 'd', label: 'Tarehe', html: r => P.date(r.t.txn_date) + (r.payload?.legacy?.date_assumed ? ' ' + P.badge('si sahihi', 'rose') : '') },
            { key: 'p', label: 'Mlipaji', html: r => P.esc(r.t.payer_name || '') }, { key: 'c', label: 'Aina', html: r => P.esc(r.t.category_name || '') },
            { key: 'j', label: 'Jumuiya', html: r => P.esc(r.t.jumuiya_name || r.t.org_unit_name || r.t.kigango_name || '') }, { key: 'a', label: 'Kiasi', html: r => P.tzs(r.t.amount), cls: 'pm-num' },
            { key: 'i', label: 'Suala', html: r => `<small>${P.esc((r.payload?.issues || []).join('; '))}</small>` },
            { key: 'id', label: '', html: r => can ? `<button class="pm-btn pm-btn--sm" data-fix="${r.id}">Rekebisha / Idhinisha</button>` : '' }], { empty: 'Hakuna kumbukumbu zinazosubiri.' });
        out.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', async () => {
          const r = reqs.find(x => x.id === b.dataset.fix), t = byId[r.transaction_id];
          const v = await P.modal({ title: `Kumbukumbu ya Excel safu ${r.payload?.legacy?.row}`, wide: true, submit: 'Hifadhi', body: `
            <p class="pm-muted">${P.esc((r.payload?.issues || []).join(' · '))}</p>
            <div class="pm-form"><label>Tarehe sahihi<input type="date" name="txn_date" value="${t.txn_date}" required></label>
            <label>Aina<select name="category_id">${P.catOptions(null, { selected: t.category_id })}</select></label>
            <label>Jumuiya / kitengo<select name="org_unit_id">${P.unitOptions(['jumuiya', 'kigango', 'group'], { blank: '— Parokia —', selected: t.org_unit_id })}</select></label>
            <label>Kiasi (TZS)<input type="number" name="amount" value="${t.amount}" min="1"></label>
            <label class="pm-span2">Uamuzi<select name="decision"><option value="save">Hifadhi marekebisho tu</option><option value="approve">Hifadhi na idhinisha (iingie kwenye hesabu)</option><option value="reject">Kataa (isiingie kwenye hesabu kamwe)</option></select></label>
            <label class="pm-span2">Maelezo<input name="note"></label></div>` });
          if (!v) return;
          await P.rpc('update_pending_transaction', { p_txn: t.id, p: { txn_date: v.txn_date, category_id: v.category_id, org_unit_id: v.org_unit_id || null, amount: Number(v.amount) } });
          if (v.decision !== 'save') await P.rpc('decide_approval', { p_request: r.id, p_approve: v.decision === 'approve', p_note: v.note || null });
          Toast.success('Imehifadhiwa.'); P.reload();
        }));
      } else {
        const rows = await P.q(P.from('import_issues').select('*').order('id').limit(1000));
        out.innerHTML = P.table(rows, [{ key: 'severity', label: 'Kiwango' }, { key: 'sheet', label: 'Karatasi' }, { key: 'cell_ref', label: 'Safu' }, { key: 'issue', label: 'Suala' }],
          { empty: 'Hakuna masuala ya uingizaji.' });
      }
    },
  };

  /* ================= BAHASHA ================= */
  V.envelopes = {
    title: 'Bahasha', perm: 'finance.read',
    async render(el, params) {
      const batches = await P.q(P.from('envelope_batches').select('*').order('created_at', { ascending: false }));
      const sel = params.batch || batches[0]?.id;
      const envs = sel ? await P.q(P.from('envelopes').select('*, parishioners(full_name), families(family_name)').eq('batch_id', sel).order('envelope_no')) : [];
      const st = envs.reduce((a, e) => (a[e.status] = (a[e.status] || 0) + 1, a), {});
      const can = P.can('finance.record');
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Bahasha</h1><p class="pm-muted">Kugawa bahasha si mapato. Bahasha ikirudishwa, malipo yake yanarekodiwa kama muamala wa kawaida na hapo ndipo yanahesabiwa.</p></div>
        <div class="pm-actions">${P.can('finance.configure') ? '<button class="pm-btn pm-btn--primary" data-newb><span class="material-symbols-outlined">add</span>Kundi jipya la bahasha</button>' : ''}</div></div>
        <form class="pm-filters"><label>Kundi<select name="batch">${P.options(batches, { selected: sel })}</select></label><button class="pm-btn">Onyesha</button></form>
        ${sel ? `<section class="pm-kpis">${P.kpi('Jumla', envs.length, 'mail')}${P.kpi('Zimegawiwa', (st.distributed || 0) + (st.returned || 0), 'outgoing_mail')}${P.kpi('Zimerudishwa', st.returned || 0, 'mark_email_read', 'pm-kpi--teal')}${P.kpi('Hazijarudi', st.distributed || 0, 'pending', 'pm-kpi--rose')}</section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Bahasha</h3>${can ? `<button class="pm-btn pm-btn--sm" data-gen>Tengeneza namba</button>` : ''}</div>
        ${P.table(envs, [{ key: 'envelope_no', label: 'Na.' }, { key: 'who', label: 'Amepewa', html: e => P.esc(e.parishioners?.full_name || e.families?.family_name || P.ref.unitsById[e.org_unit_id]?.label || '—') },
          { key: 'expected_amount', label: 'Kiasi kinachotarajiwa', fmt: P.tzs, cls: 'pm-num' }, { key: 'status', label: 'Hali', html: e => P.badge({ unissued: 'Haijatolewa', distributed: 'Imegawiwa', returned: 'Imerudishwa', lost: 'Imepotea', cancelled: 'Imefutwa' }[e.status], e.status === 'returned' ? 'teal' : e.status === 'distributed' ? 'gold' : 'muted') },
          { key: 'id', label: '', html: e => !can ? '' : e.status === 'unissued' ? `<button class="pm-btn pm-btn--sm" data-assign="${e.id}">Gawa</button>` : e.status === 'distributed' ? `<button class="pm-btn pm-btn--sm pm-btn--primary" data-ret="${e.id}">Imerudishwa + malipo</button>` : '' }])}</section>` : P.empty('Hakuna makundi ya bahasha bado.')}`;
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/envelopes?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      const nb = el.querySelector('[data-newb]');
      nb && nb.addEventListener('click', async () => {
        const v = await P.modal({ title: 'Kundi jipya la bahasha', body: `<div class="pm-form"><label class="pm-span2">Jina<input name="name" required placeholder="mf. Bahasha za Mtoto Yesu ${P.year()}"></label>
          <label>Aina ya mchango<select name="category_id" required>${P.catOptions(null, { blank: 'Chagua…' })}</select></label>
          <label>Kampeni<select name="campaign_id">${P.options(P.ref.camps, { blank: '—' })}</select></label>
          <label>Kiasi kwa bahasha (hiari)<input name="expected_amount_per_envelope" type="number" min="0"></label><label>Mwisho wa kurudisha<input name="due_on" type="date"></label></div>` });
        if (!v) return;
        Object.keys(v).forEach(k => { if (v[k] === '') v[k] = null; });
        const [b] = await P.q(P.from('envelope_batches').insert({ ...v, parish_id: P.ref.parish.id, issued_on: P.today() }).select());
        P.go(`#/envelopes?batch=${b.id}`);
      });
      const gen = el.querySelector('[data-gen]');
      gen && gen.addEventListener('click', async () => {
        const v = await P.modal({ title: 'Tengeneza namba za bahasha', body: `<div class="pm-form"><label>Kuanzia namba<input name="a" type="number" value="${envs.length + 1}" min="1" required></label><label>Hadi namba<input name="b" type="number" min="1" required></label>
          <label class="pm-span2">Jumuiya (hiari)<select name="org">${P.unitOptions(['jumuiya', 'kigango'], { blank: '—' })}</select></label></div>` });
        if (!v) return;
        const b = batches.find(x => x.id === sel);
        const rows = []; for (let n = Number(v.a); n <= Number(v.b) && rows.length < 2000; n++) rows.push({ batch_id: sel, envelope_no: String(n).padStart(4, '0'), org_unit_id: v.org || null, expected_amount: b.expected_amount_per_envelope });
        await P.q(P.from('envelopes').upsert(rows, { onConflict: 'batch_id,envelope_no', ignoreDuplicates: true })); P.reload();
      });
      el.querySelectorAll('[data-assign]').forEach(btn => btn.addEventListener('click', async () => {
        let payer = null;
        const v = await P.modal({ title: 'Gawa bahasha', body: `<div class="pm-form"><label class="pm-span2">Kwa (muumini/familia/jumuiya)<div class="pm-search"><input data-payer-search name="w" required autocomplete="off"><div data-payer-results class="pm-search__results"></div></div></label></div>`,
          onOpen: m => P.payerPicker(m, { onPick: p => { payer = p; } }) });
        if (!v || !payer) return;
        await P.q(P.from('envelopes').update({ status: 'distributed', distributed_on: P.today(), [`${payer.kind}_id`]: payer.id }).eq('id', btn.dataset.assign)); P.reload();
      }));
      el.querySelectorAll('[data-ret]').forEach(btn => btn.addEventListener('click', async () => {
        const e = envs.find(x => x.id === btn.dataset.ret), b = batches.find(x => x.id === sel);
        const v = await P.modal({ title: `Bahasha Na. ${e.envelope_no} imerudishwa`, body: `<div class="pm-form"><label>Kiasi kilichokuwemo (TZS)<input name="amount" type="number" min="1" required value="${e.expected_amount || ''}"></label><label>Tarehe<input type="date" name="d" value="${P.today()}"></label></div>` });
        if (!v) return;
        const payerArgs = e.parishioner_id ? { parishioner_id: e.parishioner_id } : e.family_id ? { family_id: e.family_id } : e.org_unit_id ? { org_unit_id: e.org_unit_id } : { payer_name: `Bahasha ${e.envelope_no}` };
        const r = await P.rpc('post_payment', { p: { idempotency_key: P.uuid(), amount: Number(v.amount), txn_date: v.d, category_id: b.category_id, campaign_id: b.campaign_id, payment_method: 'envelope', envelope_id: e.id, ...payerArgs, confirm_duplicate: true, receiving_officer: P.profile.full_name } });
        Toast.success(`Malipo ya bahasha yamehifadhiwa. Risiti ${r.receipt_no}`); P.reload();
      }));
    },
  };
})();

