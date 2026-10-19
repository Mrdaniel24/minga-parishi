/* Minga Parish — expenses, accounting, receipts, reports, reconciliation, envelopes */
(function () {
  const P = window.Parish, V = P.views;

  /* ================= MATUMIZI ================= */
  V.expenses = {
    title: 'Matumizi', perm: 'finance.read',
    async render(el) {
      const [pending, posted] = await Promise.all([
        P.q(P.from('approval_requests').select('*').eq('status', 'pending').neq('request_type', 'legacy_review').order('requested_at', { ascending: false })),
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
          <label>Tukio (hiari)<input name="event_note" placeholder="mf. Sherehe ya somo"></label></div>` });
        if (!v) return;
        const r = await P.rpc('record_expense', { p: { ...v, idempotency_key: key, amount: Number(v.amount), description: v.event_note ? `${v.description} (${v.event_note})` : v.description } });
        Toast.success(`Imerekodiwa (Na. ${r.txn_no}) — inasubiri idhini.`); P.reload();
      });
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

  /* ================= RIPOTI ================= */
  const REPORTS = [
    ['collections', 'Makusanyo kwa kipindi (siku / wiki / mwezi / mwaka)'], ['monthly', 'Makusanyo ya kila mwezi (mwaka mzima)'],
    ['by_level', 'Michango kwa familia / jumuiya / kigango / parokia'], ['campaign', 'Kampeni (Mavuno, Ujenzi, maalumu) kwa jumuiya/kigango'],
    ['outstanding', 'Ahadi ambazo hazijalipwa'], ['income_expense', 'Mapato na matumizi'], ['funds', 'Salio la mifuko'],
    ['yoy', 'Ulinganisho wa miaka'], ['receipts', 'Rejista ya risiti'], ['zaka', 'Zaka (Jan–Des)'],
  ];
  V.reports = {
    title: 'Ripoti', perm: 'finance.read',
    async render(el, params) {
      const r = params.r || 'collections', scope = params.scope || P.scopeUnit() || '';
      const from = params.from || (P.year() === P.thisYear() ? `${P.year()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01` : P.yearFrom()), to = params.to || P.yearTo();
      const year = Number(params.year || P.year()), level = params.level || 'jumuiya', cat = params.category || '', camp = params.campaign || '';
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Ripoti</h1><p class="pm-muted">Ripoti zote zinatoka kwenye kumbukumbu moja ya miamala — hakuna kunakili kati ya karatasi.</p></div>
        <div class="pm-actions"><button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button><button class="pm-btn" data-print><span class="material-symbols-outlined">picture_as_pdf</span>PDF / Chapa</button></div></div>
        <form class="pm-filters">
          <label class="pm-wide">Ripoti<select name="r">${REPORTS.map(([k, v]) => `<option value="${k}" ${k === r ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Kuanzia<input type="date" name="from" value="${from}"></label><label>Hadi<input type="date" name="to" value="${to}"></label>
          <label>Mwaka<input type="number" name="year" value="${year}"></label>
          <label>Ngazi<select name="level">${[['parish', 'Parokia'], ['kigango', 'Kigango'], ['jumuiya', 'Jumuiya'], ['family', 'Familia'], ['parishioner', 'Muumini']].map(([k, v]) => `<option value="${k}" ${k === level ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Aina<select name="category">${P.catOptions(null, { blank: 'Zote', selected: cat })}</select></label>
          <label>Kampeni<select name="campaign">${P.options(P.ref.camps, { blank: '—', selected: camp })}</select></label>
          <label>Eneo<select name="scope">${P.unitOptions(['kigango', 'jumuiya'], { blank: 'Parokia nzima', selected: scope })}</select></label>
          <button class="pm-btn pm-btn--primary">Tengeneza</button></form>
        <section class="pm-card" data-out>${P.loading()}</section>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/reports?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      const out = el.querySelector('[data-out]');
      const title = REPORTS.find(x => x[0] === r)[1];
      const scopeLbl = scope ? P.ref.unitsById[scope].label : 'Parokia nzima';
      let rows = [], cols = [], foot = null, sub = scopeLbl, excel = null;
      if (r === 'collections' || r === 'by_level') {
        rows = await P.rpc('contribution_totals', { p_from: from, p_to: to, p_level: r === 'collections' ? 'parish' : level, p_category: cat || null, p_campaign: camp || null, p_scope: scope || null });
        if (r === 'collections') { rows = rows.map(x => ({ ...x, group_name: x.category_name })); }
        cols = [{ key: 'group_name', label: r === 'collections' ? 'Aina ya mchango' : 'Jina' }, ...(r === 'by_level' ? [{ key: 'category_name', label: 'Aina' }] : []),
          { key: 'payments', label: 'Malipo', cls: 'pm-num' }, { key: 'reversals', label: 'Yaliyorudishwa', cls: 'pm-num' }, { key: 'total', label: 'Jumla', fmt: P.tzs, cls: 'pm-num pm-strong' }];
        foot = { group_name: '<b>JUMLA</b>', total: `<b>${P.tzs(P.sum(rows, 'total'))}</b>`, payments: P.num(P.sum(rows, 'payments')) };
        sub = `${scopeLbl} · ${from} – ${to}`;
      } else if (r === 'monthly' || r === 'income_expense') {
        rows = await P.rpc('monthly_totals', { p_year: year, p_scope: scope || null });
        rows = rows.map((m, i) => ({ ...m, mwezi: P.MONTHS[i], net: Number(m.income) - Number(m.expense) }));
        cols = r === 'monthly' ? [{ key: 'mwezi', label: 'Mwezi' }, ...['zaka', 'mavuno', 'ujenzi', 'sadaka', 'special', 'other'].map(k => ({ key: k, label: k[0].toUpperCase() + k.slice(1), fmt: P.num, cls: 'pm-num' })), { key: 'income', label: 'Jumla', fmt: P.tzs, cls: 'pm-num pm-strong' }]
          : [{ key: 'mwezi', label: 'Mwezi' }, { key: 'income', label: 'Mapato', fmt: P.tzs, cls: 'pm-num' }, { key: 'expense', label: 'Matumizi', fmt: P.tzs, cls: 'pm-num' }, { key: 'net', label: 'Ziada / Upungufu', fmt: P.tzs, cls: 'pm-num pm-strong' }];
        foot = Object.fromEntries(cols.slice(1).map(c => [c.key, c.fmt(P.sum(rows, c.key))])); foot.mwezi = '<b>JUMLA</b>';
        sub = `${scopeLbl} · ${year}`;
      } else if (r === 'campaign') {
        if (!camp) { out.innerHTML = P.empty('Chagua kampeni.'); return; }
        rows = await P.rpc('campaign_org_progress', { p_campaign: camp, p_level: level === 'kigango' ? 'kigango' : 'jumuiya' });
        cols = [{ key: 'org_unit_name', label: 'Jina' }, { key: 'target', label: 'Walichopangiwa', fmt: P.tzs, cls: 'pm-num' }, { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'collected', label: 'Walichotoa', fmt: P.tzs, cls: 'pm-num pm-strong' }, { key: 'balance', label: 'Bado', fmt: P.tzs, cls: 'pm-num' }, { key: 'excess', label: 'Ziada', fmt: P.tzs, cls: 'pm-num' }, { key: 'pct', label: '%', fmt: P.pct, cls: 'pm-num' }];
        foot = { org_unit_name: '<b>JUMLA</b>', target: P.tzs(P.sum(rows, 'target')), collected: `<b>${P.tzs(P.sum(rows, 'collected'))}</b>`, balance: P.tzs(P.sum(rows, 'balance')), excess: P.tzs(P.sum(rows, 'excess')) };
        sub = P.ref.camps.find(c => c.id === camp)?.name;
      } else if (r === 'outstanding') {
        let q = P.from('v_pledge_balances').select('*').eq('status', 'active').gt('outstanding', 0).order('outstanding', { ascending: false }).limit(2000);
        if (camp) q = q.eq('campaign_id', camp);
        if (scope) q = P.ref.unitsById[scope].unit_type === 'kigango' ? q.eq('kigango_id', scope) : q.eq('jumuiya_id', scope);
        rows = (await P.q(q)).map(x => ({ ...x, who: x.parishioner_name || x.family_name || x.org_unit_name, jum: P.ref.unitsById[x.jumuiya_id]?.label }));
        cols = [{ key: 'who', label: 'Mwenye ahadi' }, { key: 'jum', label: 'Jumuiya' }, { key: 'campaign_name', label: 'Kampeni' }, { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'paid', label: 'Amelipa', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Deni', fmt: P.tzs, cls: 'pm-num pm-strong' }];
        foot = { who: '<b>JUMLA</b>', pledged: P.tzs(P.sum(rows, 'pledged')), paid: P.tzs(P.sum(rows, 'paid')), outstanding: `<b>${P.tzs(P.sum(rows, 'outstanding'))}</b>` };
      } else if (r === 'funds') {
        rows = await P.q(P.from('v_fund_balances').select('*'));
        cols = [{ key: 'name', label: 'Mfuko' }, { key: 'income', label: 'Mapato', fmt: P.tzs, cls: 'pm-num' }, { key: 'expenses', label: 'Matumizi', fmt: P.tzs, cls: 'pm-num' }, { key: 'balance', label: 'Salio', fmt: P.tzs, cls: 'pm-num pm-strong' }];
        foot = { name: '<b>JUMLA</b>', balance: `<b>${P.tzs(P.sum(rows, 'balance'))}</b>` }; sub = 'Hadi leo';
      } else if (r === 'yoy') {
        const [a, b] = await Promise.all([P.rpc('monthly_totals', { p_year: year - 1, p_scope: scope || null }), P.rpc('monthly_totals', { p_year: year, p_scope: scope || null })]);
        rows = P.MONTHS.map((m, i) => ({ mwezi: m, prev: Number(a[i].income), cur: Number(b[i].income), diff: Number(b[i].income) - Number(a[i].income) }));
        cols = [{ key: 'mwezi', label: 'Mwezi' }, { key: 'prev', label: String(year - 1), fmt: P.tzs, cls: 'pm-num' }, { key: 'cur', label: String(year), fmt: P.tzs, cls: 'pm-num' }, { key: 'diff', label: 'Tofauti', fmt: P.tzs, cls: 'pm-num pm-strong' }];
        foot = { mwezi: '<b>JUMLA</b>', prev: P.tzs(P.sum(rows, 'prev')), cur: P.tzs(P.sum(rows, 'cur')), diff: P.tzs(P.sum(rows, 'diff')) };
      } else if (r === 'receipts') {
        rows = await P.q(P.from('v_receipt_register').select('*').gte('issued_at', from).lte('issued_at', to + 'T23:59:59').order('seq'));
        cols = [{ key: 'receipt_no', label: 'Risiti' }, { key: 'issued_at', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina' }, { key: 'amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'status', label: 'Hali' }];
        foot = { receipt_no: '<b>JUMLA (halali)</b>', amount: P.tzs(P.sum(rows.filter(x => x.status === 'valid'), 'amount')) }; sub = `${from} – ${to}`;
      } else if (r === 'zaka') { if (year !== P.year()) P.setYear(year); const su = scope && P.ref.unitsById[scope]; P.go(`#/zaka${su ? (su.unit_type === 'jumuiya' ? `?k=${P.kigangoOf(su.id)?.id || ''}&j=${su.id}` : `?k=${su.id}`) : ''}`); return; }
      out.innerHTML = P.reportHeader(title, sub) + P.table(rows, cols, { foot }) +
        `<p class="pm-muted pm-small pm-print-foot">${P.esc(P.ref.parish.report_footer || 'Mfumo wa Usimamizi wa Parokia')}</p>`;
      el.querySelector('[data-print]').addEventListener('click', () => P.print(title));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(title.slice(0, 40), { Ripoti: rows.map(x => Object.fromEntries(cols.map(c => [c.label, typeof x[c.key] === 'string' && !isNaN(x[c.key]) && x[c.key] !== '' ? Number(x[c.key]) : x[c.key]]))) }));
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

