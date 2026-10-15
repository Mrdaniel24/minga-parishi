/* Minga Parish — dashboard, payments (Miamala), Zaka, campaigns, pledges */
(function () {
  const P = window.Parish, V = P.views;

  /* ================= DASHIBODI ================= */
  V.dashboard = {
    title: 'Dashibodi',
    async render(el) {
      const year = P.year(), scope = P.scopeUnit();
      const d = await P.rpc('parish_dashboard', { p_year: year, p_scope: scope });
      const t = d.totals, c = d.counts;
      const scopeName = scope ? P.ref.unitsById[scope]?.label : P.ref.parish.official_name;
      el.innerHTML = `
        <div class="pm-head"><div><p class="pm-eyebrow">${P.esc(P.ref.parish.diocese || '')}</p>
          <h1 class="pm-h1">${P.esc(scopeName || '')}</h1>
          <p class="pm-muted">Mfumo wa Usimamizi wa Parokia · Mwaka ${year}</p></div>
          <div class="pm-actions">${P.can('finance.record') ? '<a class="pm-btn pm-btn--primary" href="#/payments?new=1"><span class="material-symbols-outlined">add</span>Rekodi Malipo</a>' : ''}
          <a class="pm-btn" href="#/reports"><span class="material-symbols-outlined">bar_chart</span>Ripoti</a></div></div>
        ${(d.alerts || []).length ? `<div class="pm-alert pm-alert--warn"><b>Tahadhari za uhakiki:</b> ${(d.alerts).map(a => `${P.esc(a.description)} (${a.problem_count})`).join(' · ')} — <a href="#/reconciliation">angalia</a></div>` : ''}
        <section class="pm-kpis">
          ${P.kpi('Waumini', P.num(c.parishioners), 'groups')}
          ${P.kpi('Familia', P.num(c.families), 'family_restroom')}
          ${P.kpi('Jumuiya', P.num(c.jumuiya), 'diversity_3')}
          ${P.kpi('Vigango', P.num(c.vigango), 'account_tree')}
        </section>
        <section class="pm-kpis">
          ${P.kpi('Makusanyo ya mwezi huu', P.tzs(t.income_month), 'today', 'pm-kpi--teal')}
          ${P.kpi(`Makusanyo ${year}`, P.tzs(t.income_year), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Matumizi', P.tzs(t.expenses_year), 'payments')}
          ${P.kpi('Fedha zilizopo', P.tzs(t.cash_available), 'account_balance_wallet', 'pm-kpi--gold')}
          ${P.kpi('Zaka', P.tzs(t.zaka), 'calendar_month')}
          ${P.kpi('Mavuno', P.tzs(t.mavuno), 'agriculture')}
          ${P.kpi('Ujenzi', P.tzs(t.ujenzi), 'construction')}
          ${P.kpi('Sadaka', P.tzs(t.sadaka), 'church')}
          ${P.kpi('Michango maalumu', P.tzs(t.special), 'volunteer_activism')}
          ${P.kpi('Ahadi ambazo hazijalipwa', P.tzs(t.outstanding_pledges), 'pending_actions', 'pm-kpi--rose')}
        </section>
        <section class="pm-grid2">
          <div class="pm-card"><h3 class="pm-h3">Mwenendo wa makusanyo ${year}</h3><canvas id="pm-trend" height="220"></canvas></div>
          <div class="pm-card"><h3 class="pm-h3">Kampeni za ${year}</h3>
            ${(d.campaigns || []).filter(x => Number(x.target) || Number(x.collected)).slice(0, 8).map(x => `
              <div class="pm-camp"><div><b>${P.esc(x.name)}</b><small>${P.tzs(x.collected)}${Number(x.target) ? ' / ' + P.tzs(x.target) : ''}</small></div>
              ${Number(x.target) ? P.progress(x.target_pct) : ''}</div>`).join('') || P.empty('Hakuna kampeni zenye malengo bado.')}
          </div>
        </section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Miamala ya karibuni</h3><a href="#/payments" class="pm-link">Ona yote</a></div>
          ${P.table(d.recent || [], [
            { key: 'txn_no', label: 'Na.' }, { key: 'txn_date', label: 'Tarehe', fmt: P.date },
            { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina' },
            { key: 'jumuiya_name', label: 'Jumuiya' }, { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' },
            { key: 'receipt_no', label: 'Risiti' }])}
        </section>`;
      if (window.Chart) {
        const m = d.monthly || [];
        new Chart(document.getElementById('pm-trend'), {
          type: 'bar',
          data: { labels: P.MONTHS, datasets: [
            { label: 'Mapato', data: m.map(x => x.income), backgroundColor: '#3d5650', borderRadius: 6 },
            { label: 'Matumizi', data: m.map(x => x.expense), backgroundColor: '#d4a72c', borderRadius: 6 }] },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => P.num(v) } } } },
        });
      }
    },
  };

  /* ================= MIAMALA (payments) ================= */
  async function paymentForm(prefill = {}) {
    const zakaCat = P.ref.cats.find(c => c.code === 'ZAKA');
    let payer = prefill.payer || null;
    const key = P.uuid();       // one key for this form: retries never post twice
    const body = `
      <div class="pm-form">
        <label class="pm-span2">Mlipaji (tafuta muumini, familia au jumuiya)
          <div class="pm-search"><input data-payer-search name="payer_name" autocomplete="off" placeholder="Andika jina…" value="${P.esc(prefill.payerName || '')}" required>
          <div data-payer-results class="pm-search__results"></div></div>
          <small data-payer-kind class="pm-muted">${payer ? 'Amechaguliwa kutoka kwenye rejista' : 'Jina huru (halijaunganishwa na rejista)'}</small></label>
        <label>Jumuiya / Kigango (kama mlipaji si muumini aliyesajiliwa)<select name="org_unit_id">${P.unitOptions(['jumuiya', 'kigango', 'group'], { blank: '— Parokia —', selected: prefill.org_unit_id })}</select></label>
        <label>Aina ya mchango<select name="category_id" required>${P.catOptions(null, { blank: 'Chagua…', selected: prefill.category_id })}</select></label>
        <label>Kampeni / Mwaka<select name="campaign_id"><option value="">—</option></select></label>
        <label data-period hidden>Zaka ya mwezi<input type="month" name="period_month" value="${new Date().toISOString().slice(0, 7)}"></label>
        <label>Kiasi (TZS)<input name="amount" type="number" min="1" step="1" required inputmode="numeric"></label>
        <label>Tarehe<input name="txn_date" type="date" value="${P.today()}" required></label>
        <label>Njia ya malipo<select name="payment_method">${Object.entries(P.METHODS).filter(([k]) => k !== 'envelope').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Namba ya kumbukumbu (benki/simu/hundi)<input name="reference_no" placeholder="mf. M-Pesa QJ7…"></label>
        <label class="pm-span2">Maelezo<input name="description" maxlength="300"></label>
      </div>`;
    const result = await P.modal({
      title: 'Rekodi malipo', submit: 'Thibitisha na Hifadhi', wide: true, body,
      onOpen(m) {
        const cat = m.querySelector('[name=category_id]'), camp = m.querySelector('[name=campaign_id]');
        const syncCat = () => {
          const c = P.ref.catsById[cat.value];
          camp.innerHTML = `<option value="">—</option>` + P.campOptions(cat.value, { selected: prefill.campaign_id ||
            (P.ref.camps.find(x => x.category_id === cat.value && x.campaign_year === P.year()) || {}).id });
          camp.disabled = !c || !c.is_pledgeable;
          m.querySelector('[data-period]').hidden = !(c && c.uses_period_month);
        };
        cat.addEventListener('change', syncCat); syncCat();
        P.payerPicker(m, { onPick: p => { payer = p; m.querySelector('[data-payer-kind]').textContent = `Amechaguliwa: ${p.kind === 'parishioner' ? 'muumini' : p.kind === 'family' ? 'familia' : 'jumuiya/kikundi'}`; } });
        m.querySelector('[data-payer-search]').addEventListener('input', () => { payer = null; m.querySelector('[data-payer-kind]').textContent = 'Jina huru (halijaunganishwa na rejista)'; });
        if (zakaCat && prefill.category_id === zakaCat.id) syncCat();
      },
    });
    if (!result) return null;
    const args = {
      idempotency_key: key, amount: Number(result.amount), txn_date: result.txn_date, category_id: result.category_id,
      campaign_id: result.campaign_id || null, payment_method: result.payment_method,
      reference_no: result.reference_no || null, description: result.description || null,
      period_month: result.period_month ? result.period_month + '-01' : null,
      payer_name: result.payer_name, org_unit_id: result.org_unit_id || null,
      receiving_officer: P.profile.full_name || P.profile.email,
    };
    if (payer) { args[`${payer.kind}_id`] = payer.id; if (payer.kind !== 'org_unit') args.org_unit_id = null; }
    let r = await P.rpc('post_payment', { p: args });
    if (r.status === 'possible_duplicate') {
      const ok = await P.confirm('Huenda ni malipo yaliyorudiwa', `${r.message} (Muamala Na. ${r.existing_txn_no}). Bonyeza "Ndiyo, ni mapya" kama ni malipo mengine.`, 'Ndiyo, ni mapya');
      if (!ok) return null;
      r = await P.rpc('post_payment', { p: { ...args, confirm_duplicate: true } });
    }
    return r;
  }
  P.paymentForm = paymentForm;

  V.payments = {
    title: 'Miamala', perm: 'finance.read',
    async render(el, params) {
      const f = { from: params.from || `${P.year()}-01-01`, to: params.to || P.today(), category: params.category || '', unit: params.unit || P.scopeUnit() || '', q: params.q || '', status: params.status || 'posted' };
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Miamala</h1><p class="pm-muted">Kila malipo huingizwa mara moja tu; ripoti zote za jumuiya, kigango na parokia husasishwa kutoka hapa.</p></div>
          <div class="pm-actions">${P.can('finance.record') ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Rekodi Malipo</button>' : ''}
          <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button></div></div>
        <form class="pm-filters">
          <label>Kuanzia<input type="date" name="from" value="${f.from}"></label>
          <label>Hadi<input type="date" name="to" value="${f.to}"></label>
          <label>Aina<select name="category">${P.catOptions(null, { blank: 'Zote', selected: f.category })}</select></label>
          <label>Jumuiya/Kigango<select name="unit">${P.unitOptions(['kigango', 'jumuiya', 'group'], { blank: 'Zote', selected: f.unit })}</select></label>
          <label>Hali<select name="status"><option value="posted">Yaliyothibitishwa</option><option value="pending" ${f.status === 'pending' ? 'selected' : ''}>Yanayosubiri</option><option value="all" ${f.status === 'all' ? 'selected' : ''}>Yote</option></select></label>
          <label>Tafuta<input name="q" value="${P.esc(f.q)}" placeholder="Mlipaji / risiti"></label>
          <button class="pm-btn">Chuja</button></form>
        <div data-list>${P.loading()}</div>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => {
        e.preventDefault(); P.go('#/payments?' + new URLSearchParams(Object.fromEntries(new FormData(e.target))).toString());
      });
      const newBtn = el.querySelector('[data-new]');
      const openNew = async () => {
        const r = await paymentForm().catch(e => { Toast.error(e.message); return null; });
        if (r && (r.status === 'posted' || r.status === 'already_posted')) {
          Toast.success(`Malipo yamehifadhiwa. Risiti ${r.receipt_no || ''}`);
          if (r.pledge && r.pledge.pledged) Toast.info(`Ahadi: amelipa ${P.tzs(r.pledge.paid)} kati ya ${P.tzs(r.pledge.pledged)} — bado ${P.tzs(r.pledge.outstanding)}${Number(r.pledge.excess) ? ', ziada ' + P.tzs(r.pledge.excess) : ''}`);
          if (r.receipt_id) window.open(`receipt.html?id=${r.receipt_id}`, '_blank');
          P.reload();
        }
      };
      newBtn && newBtn.addEventListener('click', openNew);
      if (params.new && newBtn) { history.replaceState(null, '', '#/payments'); openNew(); }

      let q = P.from('v_ledger').select('*').gte('txn_date', f.from).lte('txn_date', f.to).order('txn_date', { ascending: false }).order('txn_no', { ascending: false }).limit(500);
      if (f.status !== 'all') q = q.eq('status', f.status);
      if (f.category) q = q.eq('category_id', f.category);
      if (f.unit) {
        const u = P.ref.unitsById[f.unit];
        q = u.unit_type === 'kigango' ? q.eq('kigango_id', f.unit) : u.unit_type === 'jumuiya' ? q.eq('jumuiya_id', f.unit) : q.eq('org_unit_id', f.unit);
      }
      if (f.q) q = q.or(`payer_name.ilike.%${f.q.replace(/[,()]/g, ' ')}%,receipt_no.ilike.%${f.q.replace(/[,()]/g, ' ')}%,legacy_receipt_no.eq.${f.q.replace(/\D/g, '') || 0}`);
      const rows = await P.q(q);
      const canRev = P.can('finance.reverse');
      el.querySelector('[data-list]').innerHTML = `<p class="pm-muted pm-small">${rows.length} miamala${rows.length === 500 ? ' (500 ya kwanza — punguza vigezo)' : ''} · Jumla ${P.tzs(P.sum(rows, 'net_amount'))}</p>` +
        P.table(rows, [
          { key: 'txn_no', label: 'Na.' }, { key: 'txn_date', label: 'Tarehe', fmt: P.date },
          { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
          { key: 'jumuiya_name', label: 'Jumuiya', html: r => P.esc(r.jumuiya_name || r.org_unit_name || '—') + (r.kigango_name ? `<br><small class="pm-muted">${P.esc(r.kigango_name)}</small>` : '') },
          { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'payment_method', label: 'Njia', fmt: v => P.METHODS[v] || v },
          { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>${r.receipt_status === 'void' ? ' ' + P.badge('imefutwa', 'rose') : ''}` : (r.legacy_receipt_no ? `<small class="pm-muted">Excel #${P.esc(r.legacy_receipt_no)}</small>` : '—') },
          { key: 'status', label: 'Hali', html: r => r.sign < 0 ? P.badge('Reversal', 'rose') : r.reversed_by_id ? P.badge('Imerudishwa', 'rose') : r.status === 'pending' ? P.badge('Inasubiri', 'gold') : P.badge('Imethibitishwa', 'teal') },
          { key: 'id', label: '', html: r => canRev && r.status === 'posted' && r.sign > 0 && !r.reversed_by_id ? `<button class="pm-btn pm-btn--sm" data-reverse="${r.id}" data-no="${r.txn_no}">Rudisha</button>` : '' },
        ]);
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`miamala_${f.from}_${f.to}`, { Miamala: rows.map(r => ({
        Na: r.txn_no, Tarehe: r.txn_date, Mlipaji: r.payer_name, Aina: r.category_name, Kampeni: r.campaign_name, Jumuiya: r.jumuiya_name,
        Kigango: r.kigango_name, Kiasi: Number(r.net_amount), Njia: P.METHODS[r.payment_method], Kumbukumbu: r.reference_no, Risiti: r.receipt_no || r.legacy_receipt_no, Hali: r.status })) }));
      el.querySelectorAll('[data-reverse]').forEach(b => b.addEventListener('click', async () => {
        const v = await P.modal({ title: `Rudisha muamala Na. ${b.dataset.no}`, submit: 'Rudisha muamala',
          body: `<p class="pm-muted">Muamala hautafutwa. Muamala wa kurudisha (reversal) utaandikwa na jumla zote zitajirekebisha. Risiti itabatilishwa.</p>
                 <div class="pm-form"><label class="pm-span2">Sababu<input name="reason" required minlength="5"></label>
                 <label>Tarehe ya kurudisha<input type="date" name="date" value="${P.today()}" required></label></div>` });
        if (!v) return;
        await P.busy(b, () => P.rpc('reverse_transaction', { p_txn: b.dataset.reverse, p_reason: v.reason, p_idempotency_key: P.uuid(), p_date: v.date }));
        Toast.success('Muamala umerudishwa.'); P.reload();
      }));
    },
  };

  /* ================= ZAKA ================= */
  V.zaka = {
    title: 'Zaka', perm: 'finance.read',
    async render(el, params) {
      const year = Number(params.year || P.year()), level = params.level || 'jumuiya', scope = params.scope || P.scopeUnit() || '';
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Zaka ${year}</h1><p class="pm-muted">Januari–Desemba kwa kila mtu, familia, jumuiya au kigango. Hesabu zinatokana na malipo yaliyothibitishwa tu.</p></div>
          <div class="pm-actions">${P.can('finance.record') ? `<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Rekodi Zaka</button>` : ''}
          <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button><button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <form class="pm-filters">
          <label>Mwaka<select name="year">${[P.year() + 1, P.year(), P.year() - 1, P.year() - 2].map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          <label>Kwa<select name="level">${[['parishioner', 'Muumini'], ['family', 'Familia'], ['jumuiya', 'Jumuiya'], ['kigango', 'Kigango']].map(([k, v]) => `<option value="${k}" ${k === level ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Ndani ya<select name="scope">${P.unitOptions(['kigango', 'jumuiya'], { blank: 'Parokia nzima', selected: scope })}</select></label>
          <button class="pm-btn">Onyesha</button></form>
        <div data-out>${P.loading()}</div>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/zaka?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      const nb = el.querySelector('[data-new]');
      nb && nb.addEventListener('click', async () => {
        const r = await paymentForm({ category_id: P.ref.cats.find(c => c.code === 'ZAKA')?.id }).catch(e => { Toast.error(e.message); return null; });
        if (r && r.status === 'posted') { Toast.success(`Zaka imehifadhiwa. Risiti ${r.receipt_no}`); P.reload(); }
      });
      const rows = await P.rpc('zaka_grid', { p_year: year, p_level: level, p_scope: scope || null });
      const mcols = P.MONTHS.map((m, i) => ({ key: `m${String(i + 1).padStart(2, '0')}`, label: m, fmt: v => v ? P.num(v) : '', cls: 'pm-num' }));
      const foot = Object.fromEntries(mcols.map(c => [c.key, P.num(P.sum(rows, c.key))]));
      foot.total = `<b>${P.num(P.sum(rows, 'total'))}</b>`; foot.group_name = '<b>JUMLA</b>';
      const head = P.reportHeader(`Taarifa ya Zaka ${year}`, scope ? P.ref.unitsById[scope].label : 'Parokia nzima');
      el.querySelector('[data-out]').innerHTML = head + P.table(rows, [
        { key: 'group_name', label: level === 'parishioner' ? 'Muumini' : level === 'family' ? 'Familia' : level === 'jumuiya' ? 'Jumuiya' : 'Kigango' },
        ...(level === 'parishioner' || level === 'family' ? [{ key: 'jumuiya_name', label: 'Jumuiya' }] : []),
        ...mcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' },
        { key: 'months_paid', label: 'Miezi aliyotoa', cls: 'pm-num' }, { key: 'months_unpaid', label: 'Hajatoa', cls: 'pm-num' },
      ], { foot, empty: 'Hakuna zaka iliyorekodiwa kwa vigezo hivi.' });
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Zaka ${year}`));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`zaka_${year}_${level}`, { Zaka: rows.map(r => ({
        Jina: r.group_name, Jumuiya: r.jumuiya_name, ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(r[`m${String(i + 1).padStart(2, '0')}`]) || 0])),
        Jumla: Number(r.total), Miezi_aliyotoa: r.months_paid, Hajatoa: r.months_unpaid })) }));
    },
  };

  /* ================= MAVUNO / UJENZI / MICHANGO MAALUMU ================= */
  const KIND = { mavuno: ['mavuno'], ujenzi: ['ujenzi'], special: ['special'] };
  const KIND_TITLE = { mavuno: 'Mavuno', ujenzi: 'Ujenzi', special: 'Michango Maalumu' };
  V.campaigns = {
    title: 'Kampeni', perm: 'finance.read',
    async render(el, params) {
      const kind = params.kind || 'mavuno';
      const all = await P.q(P.from('v_campaign_progress').select('*').in('category_kind', KIND[kind]).order('campaign_year', { ascending: false }).order('name'));
      const sel = params.id ? all.find(c => c.campaign_id === params.id) : all.find(c => c.campaign_year === P.year()) || all[0];
      const level = params.level || 'jumuiya';
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">${KIND_TITLE[kind]}</h1><p class="pm-muted">Malengo (walichopangiwa), ahadi, makusanyo na kiasi kilichobaki — vyote vinahesabiwa kiotomatiki kutoka kwenye miamala.</p></div>
          <div class="pm-actions">${P.can('finance.configure') ? '<button class="pm-btn" data-newcamp><span class="material-symbols-outlined">add</span>Kampeni mpya</button>' : ''}</div></div>
        <section class="pm-card">${P.table(all, [
          { key: 'name', label: 'Kampeni', html: r => `<a class="pm-link" href="#/campaigns?kind=${kind}&id=${r.campaign_id}">${P.esc(r.name)}</a>` },
          { key: 'campaign_year', label: 'Mwaka' }, { key: 'target', label: 'Lengo', fmt: P.tzs, cls: 'pm-num' },
          { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' }, { key: 'collected', label: 'Imekusanywa', fmt: P.tzs, cls: 'pm-num' },
          { key: 'outstanding_pledges', label: 'Ahadi zilizobaki', fmt: P.tzs, cls: 'pm-num' },
          { key: 'target_pct', label: '% ya lengo', html: r => r.target_pct === null ? '—' : `${P.pct(r.target_pct)} ${P.progress(r.target_pct)}` },
          { key: 'payers', label: 'Walipaji', cls: 'pm-num' }], { empty: 'Hakuna kampeni bado.' })}</section>
        ${sel ? `<section class="pm-card"><div class="pm-row"><h3 class="pm-h3">${P.esc(sel.name)} — kwa ${level === 'kigango' ? 'kigango' : 'jumuiya'}</h3>
          <div class="pm-actions"><a class="pm-btn pm-btn--sm" href="#/campaigns?kind=${kind}&id=${sel.campaign_id}&level=${level === 'kigango' ? 'jumuiya' : 'kigango'}">Kwa ${level === 'kigango' ? 'jumuiya' : 'kigango'}</a>
          ${P.can('finance.configure') ? `<button class="pm-btn pm-btn--sm" data-target="${sel.campaign_id}">Weka lengo</button>` : ''}
          <button class="pm-btn pm-btn--sm" data-print>Chapa</button><button class="pm-btn pm-btn--sm" data-xls>Excel</button></div></div>
          <div data-org>${P.loading()}</div></section>` : ''}`;
      if (sel) {
        const rows = await P.rpc('campaign_org_progress', { p_campaign: sel.campaign_id, p_level: level });
        const foot = { org_unit_name: '<b>JUMLA</b>', target: P.tzs(P.sum(rows, 'target')), pledged: P.tzs(P.sum(rows, 'pledged')), collected: `<b>${P.tzs(P.sum(rows, 'collected'))}</b>`, balance: P.tzs(P.sum(rows, 'balance')), excess: P.tzs(P.sum(rows, 'excess')) };
        el.querySelector('[data-org]').innerHTML = P.reportHeader(`Taarifa ya ${sel.name}`, `Kwa ${level}`) + P.table(rows, [
          { key: 'org_unit_name', label: level === 'kigango' ? 'Kigango' : 'Jumuiya' }, ...(level === 'jumuiya' ? [{ key: 'kigango_name', label: 'Kigango' }] : []),
          { key: 'target', label: 'Walichopangiwa', fmt: P.tzs, cls: 'pm-num' }, { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'collected', label: 'Walichotoa', fmt: P.tzs, cls: 'pm-num pm-strong' }, { key: 'balance', label: 'Kiasi bado', fmt: P.tzs, cls: 'pm-num' },
          { key: 'excess', label: 'Ziada', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'pct', label: '% ya utoaji', html: r => r.pct === null ? '—' : `${P.pct(r.pct)} ${P.progress(r.pct)}` }, { key: 'payers', label: 'Walipaji', cls: 'pm-num' }], { foot });
        el.querySelector('[data-print]').addEventListener('click', () => P.print(sel.name));
        el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(sel.name, { [level]: rows.map(r => ({ Jina: r.org_unit_name, Kigango: r.kigango_name, Walichopangiwa: Number(r.target), Ahadi: Number(r.pledged), Walichotoa: Number(r.collected), Bado: Number(r.balance), Ziada: Number(r.excess), Asilimia: r.pct })) }));
        const tb = el.querySelector('[data-target]');
        tb && tb.addEventListener('click', async () => {
          const v = await P.modal({ title: `Lengo la ${sel.name}`, body: `<div class="pm-form">
            <label class="pm-span2">Jumuiya / Kigango<select name="org" required>${P.unitOptions(['jumuiya', 'kigango', 'group'], { blank: 'Chagua…' })}</select></label>
            <label>Msingi<select name="basis"><option value="fixed">Kiasi maalumu</option><option value="per_family">Familia × kiwango</option><option value="per_member">Waumini × kiwango</option></select></label>
            <label>Kiasi (kama ni maalumu)<input name="fixed" type="number" min="0"></label>
            <label>Idadi (familia/waumini)<input name="count" type="number" min="0"></label>
            <label>Kiwango kwa kila mmoja<input name="rate" type="number" min="0"></label></div>` });
          if (!v) return;
          const row = { campaign_id: sel.campaign_id, org_unit_id: v.org, basis: v.basis, fixed_amount: v.basis === 'fixed' ? Number(v.fixed) : null,
            unit_count: v.basis === 'fixed' ? null : Number(v.count), unit_rate: v.basis === 'fixed' ? null : Number(v.rate) };
          await P.q(P.from('campaign_targets').upsert(row, { onConflict: 'campaign_id,org_unit_id' }));
          Toast.success('Lengo limehifadhiwa.'); P.reload();
        });
      }
      const nc = el.querySelector('[data-newcamp]');
      nc && nc.addEventListener('click', async () => {
        const v = await P.modal({ title: 'Kampeni mpya', body: `<div class="pm-form">
          <label>Aina<select name="category_id" required>${P.catOptions(KIND[kind], { blank: 'Chagua…' })}</select></label>
          <label>Mwaka<input name="year" type="number" value="${P.year()}" required></label>
          <label class="pm-span2">Jina<input name="name" required placeholder="mf. Mavuno ${P.year()}"></label>
          <label>Lengo la jumla (hiari)<input name="target" type="number" min="0"></label>
          <label>Inaanza<input name="starts_on" type="date"></label><label>Inaisha<input name="ends_on" type="date"></label>
          <label class="pm-span2">Maelezo<input name="description"></label></div>` });
        if (!v) return;
        const fy = P.ref.years.find(y => y.label === String(v.year));
        await P.q(P.from('campaigns').insert({ parish_id: P.ref.parish.id, category_id: v.category_id, campaign_year: Number(v.year), name: v.name,
          financial_year_id: fy ? fy.id : null, target_amount: v.target ? Number(v.target) : null, starts_on: v.starts_on || null, ends_on: v.ends_on || null,
          description: v.description || null, recurs_annually: true }));
        await P.loadRef(true); Toast.success('Kampeni imeundwa.'); P.reload();
      });
    },
  };

  /* ================= AHADI NA MADENI ================= */
  V.pledges = {
    title: 'Ahadi na Madeni', perm: 'finance.read',
    async render(el, params) {
      const f = { campaign: params.campaign || '', unit: params.unit || P.scopeUnit() || '', only: params.only || 'outstanding', q: params.q || '' };
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Ahadi na Madeni</h1><p class="pm-muted">Ahadi − malipo = deni. Malipo yanayozidi ahadi yanaonyeshwa kama ziada, si deni hasi.</p></div>
          <div class="pm-actions">${P.can('finance.pledge') ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Ahadi mpya</button>' : ''}
          <button class="pm-btn" data-xls>Excel</button><button class="pm-btn" data-print>Chapa</button></div></div>
        <form class="pm-filters">
          <label>Kampeni<select name="campaign">${P.options(P.ref.camps, { blank: 'Zote', selected: f.campaign })}</select></label>
          <label>Jumuiya/Kigango<select name="unit">${P.unitOptions(['kigango', 'jumuiya'], { blank: 'Zote', selected: f.unit })}</select></label>
          <label>Onyesha<select name="only"><option value="outstanding">Wenye deni</option><option value="all" ${f.only === 'all' ? 'selected' : ''}>Wote</option><option value="excess" ${f.only === 'excess' ? 'selected' : ''}>Waliozidisha</option><option value="overdue" ${f.only === 'overdue' ? 'selected' : ''}>Waliochelewa</option></select></label>
          <label>Tafuta<input name="q" value="${P.esc(f.q)}"></label><button class="pm-btn">Chuja</button></form>
        <div data-out>${P.loading()}</div>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/pledges?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      let q = P.from('v_pledge_balances').select('*').eq('status', 'active').order('outstanding', { ascending: false }).limit(1000);
      if (f.campaign) q = q.eq('campaign_id', f.campaign);
      if (f.unit) q = P.ref.unitsById[f.unit].unit_type === 'kigango' ? q.eq('kigango_id', f.unit) : q.eq('jumuiya_id', f.unit);
      if (f.only === 'outstanding') q = q.gt('outstanding', 0);
      if (f.only === 'excess') q = q.gt('excess', 0);
      if (f.only === 'overdue') q = q.eq('is_overdue', true);
      if (f.q) q = q.or(`family_name.ilike.%${f.q}%,parishioner_name.ilike.%${f.q}%,org_unit_name.ilike.%${f.q}%`);
      const rows = await P.q(q);
      const who = r => r.parishioner_name || r.family_name || r.org_unit_name;
      const ju = r => P.ref.unitsById[r.jumuiya_id]?.label || '—';
      const foot = { who: '<b>JUMLA</b>', pledged: P.tzs(P.sum(rows, 'pledged')), paid: P.tzs(P.sum(rows, 'paid')), outstanding: `<b>${P.tzs(P.sum(rows, 'outstanding'))}</b>`, excess: P.tzs(P.sum(rows, 'excess')) };
      const can = P.can('finance.pledge');
      el.querySelector('[data-out]').innerHTML = P.reportHeader('Ahadi na Madeni', f.campaign ? P.ref.camps.find(c => c.id === f.campaign)?.name : 'Kampeni zote') +
        `<p class="pm-muted pm-small">${rows.length} ahadi</p>` + P.table(rows, [
          { key: 'who', label: 'Mwenye ahadi', html: r => P.esc(who(r)) }, { key: 'jumuiya', label: 'Jumuiya', html: ju },
          { key: 'campaign_name', label: 'Kampeni' }, { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'paid', label: 'Amelipa', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Deni', fmt: P.tzs, cls: 'pm-num pm-strong' },
          { key: 'excess', label: 'Ziada', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'completion_pct', label: '%', html: r => `${P.pct(r.completion_pct)} ${P.progress(r.completion_pct)}` },
          { key: 'pledge_id', label: '', html: r => can ? `<button class="pm-btn pm-btn--sm" data-act="${r.pledge_id}">Hatua</button>` : '' }], { foot });
      el.querySelector('[data-print]').addEventListener('click', () => P.print('Ahadi na Madeni'));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel('ahadi_na_madeni', { Ahadi: rows.map(r => ({ Mwenye_ahadi: who(r), Jumuiya: ju(r), Kampeni: r.campaign_name, Ahadi: Number(r.pledged), Amelipa: Number(r.paid), Deni: Number(r.outstanding), Ziada: Number(r.excess), Asilimia: Number(r.completion_pct) })) }));
      el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        const r = rows.find(x => x.pledge_id === b.dataset.act);
        const next = P.ref.camps.filter(c => c.category_id === r.category_id && c.campaign_year > r.campaign_year);
        const v = await P.modal({ title: `${who(r)} — ${r.campaign_name}`, submit: 'Tekeleza', body: `
          <p class="pm-muted">Ahadi ${P.tzs(r.pledged)} · amelipa ${P.tzs(r.paid)} · deni ${P.tzs(r.outstanding)}</p>
          <div class="pm-form"><label class="pm-span2">Hatua<select name="action">
            <option value="pay">Rekodi malipo ya ahadi hii</option><option value="amount">Badilisha kiasi cha ahadi</option>
            ${next.length && Number(r.outstanding) > 0 ? '<option value="carry">Hamishia deni kwenye kampeni ijayo</option>' : ''}
            <option value="cancel">Futa ahadi (kama haina malipo)</option></select></label>
            <label>Kiasi kipya (kubadilisha)<input name="amount" type="number" min="1"></label>
            <label>Kampeni ya kuhamishia<select name="to">${P.options(next, { blank: '—' })}</select></label>
            <label class="pm-span2">Sababu<input name="reason"></label></div>` });
        if (!v) return;
        if (v.action === 'pay') {
          const res = await paymentForm({ category_id: r.category_id, campaign_id: r.campaign_id, payerName: who(r),
            payer: r.parishioner_id ? { kind: 'parishioner', id: r.parishioner_id } : r.family_id ? { kind: 'family', id: r.family_id } : { kind: 'org_unit', id: r.org_unit_id } });
          if (res && res.status === 'posted') { Toast.success(`Imehifadhiwa. Risiti ${res.receipt_no}`); P.reload(); }
          return;
        }
        if (v.action === 'amount') await P.rpc('update_pledge_amount', { p_pledge: r.pledge_id, p_amount: Number(v.amount), p_reason: v.reason });
        if (v.action === 'carry') await P.rpc('carry_forward_pledge', { p_pledge: r.pledge_id, p_new_campaign: v.to });
        if (v.action === 'cancel') await P.rpc('cancel_pledge', { p_pledge: r.pledge_id, p_reason: v.reason || 'Imefutwa' });
        Toast.success('Imefanyika.'); P.reload();
      }));
      const nb = el.querySelector('[data-new]');
      nb && nb.addEventListener('click', async () => {
        let payer = null;
        const v = await P.modal({ title: 'Ahadi mpya', body: `<div class="pm-form">
          <label class="pm-span2">Mwenye ahadi (muumini, familia au jumuiya)<div class="pm-search"><input data-payer-search name="who" autocomplete="off" required>
            <div data-payer-results class="pm-search__results"></div></div></label>
          <label>Kampeni<select name="campaign_id" required>${P.options(P.ref.camps.filter(c => c.status !== 'closed' && P.ref.catsById[c.category_id]?.is_pledgeable), { blank: 'Chagua…', selected: f.campaign })}</select></label>
          <label>Kiasi cha ahadi<input name="amount" type="number" min="1" required></label>
          <label>Tarehe ya ahadi<input name="pledged_on" type="date" value="${P.today()}"></label>
          <label>Mwisho wa kulipa<input name="due_on" type="date"></label></div>`,
          onOpen: m => P.payerPicker(m, { onPick: p => { payer = p; } }) });
        if (!v) return;
        if (!payer) { Toast.error('Chagua mwenye ahadi kutoka kwenye orodha.'); return; }
        await P.rpc('create_pledge', { p: { campaign_id: v.campaign_id, amount: Number(v.amount), pledged_on: v.pledged_on, due_on: v.due_on || null, [`${payer.kind}_id`]: payer.id } });
        Toast.success('Ahadi imehifadhiwa.'); P.reload();
      });
    },
  };
})();
