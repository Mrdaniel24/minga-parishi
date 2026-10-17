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
          <a class="pm-btn" href="#/units"><span class="material-symbols-outlined">account_tree</span>Vigango na Jumuiya</a><a class="pm-btn" href="#/reports"><span class="material-symbols-outlined">bar_chart</span>Ripoti</a></div></div>
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
    const jum = prefill.jumuiya ? P.ref.unitsById[prefill.jumuiya] : null;      // recording inside one jumuiya
    const periodDefault = P.year() === P.thisYear() ? new Date().toISOString().slice(0, 7) : `${P.year()}-12`;
    const key = P.uuid();       // one key for this form: retries never post twice
    const body = `
      <div class="pm-form">
        <label class="pm-span2">Mlipaji (tafuta muumini, familia au jumuiya${jum ? ` — ndani ya Jumuiya ya ${P.esc(jum.name)}` : ''})
          <div class="pm-search"><input data-payer-search name="payer_name" autocomplete="off" placeholder="Andika jina…" value="${P.esc(prefill.payerName || '')}" required>
          <div data-payer-results class="pm-search__results"></div></div>
          <small data-payer-kind class="pm-muted">${payer ? 'Amechaguliwa kutoka kwenye rejista' : 'Jina huru (halijaunganishwa na rejista)'}</small></label>
        <label>Jumuiya / Kigango (kama mlipaji si muumini aliyesajiliwa)<select name="org_unit_id">${P.unitOptions(['jumuiya', 'kigango', 'group'], { blank: '— Parokia —', selected: prefill.org_unit_id || prefill.jumuiya })}</select></label>
        <label>Aina ya mchango<select name="category_id" required>${P.catOptions(null, { blank: 'Chagua…', selected: prefill.category_id })}</select></label>
        <label>Kampeni / Mwaka<select name="campaign_id"><option value="">—</option></select></label>
        <label data-period hidden>Malipo ya mwezi<input type="month" name="period_month" value="${prefill.period_month || periodDefault}"></label>
        <label>Kiasi (TZS)<input name="amount" type="number" min="1" step="1" required inputmode="numeric"></label>
        <label>Tarehe<input name="txn_date" type="date" value="${P.today()}" required></label>
        <label>Njia ya malipo<select name="payment_method">${Object.entries(P.METHODS).filter(([k]) => k !== 'envelope').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Namba ya kumbukumbu (benki/simu/hundi)<input name="reference_no" placeholder="mf. M-Pesa QJ7…"></label>
        <label class="pm-span2">Maelezo<input name="description" maxlength="300"></label>
      </div>`;
    const result = await P.modal({
      title: jum ? `Rekodi malipo — Jumuiya ya ${jum.name}` : 'Rekodi malipo', submit: 'Thibitisha na Hifadhi', wide: true, body,
      onOpen(m) {
        const cat = m.querySelector('[name=category_id]'), camp = m.querySelector('[name=campaign_id]');
        const syncPeriod = () => {
          const c = P.ref.catsById[cat.value], k = P.ref.camps.find(x => x.id === camp.value);
          m.querySelector('[data-period]').hidden = !((c && c.uses_period_month) || (k && k.frequency === 'monthly'));
        };
        const syncCat = () => {
          const c = P.ref.catsById[cat.value];
          const hasCamps = P.ref.camps.some(x => x.category_id === cat.value);
          camp.innerHTML = `<option value="">—</option>` + P.campOptions(cat.value, { selected: prefill.campaign_id ||
            (P.ref.camps.find(x => x.category_id === cat.value && x.campaign_year === P.year()) || {}).id });
          camp.disabled = !c || (!c.is_pledgeable && !hasCamps);
          syncPeriod();
        };
        cat.addEventListener('change', syncCat); camp.addEventListener('change', syncPeriod); syncCat();
        P.payerPicker(m, { jumuiya: prefill.jumuiya, onPick: p => { payer = p; m.querySelector('[data-payer-kind]').textContent = `Amechaguliwa: ${p.kind === 'parishioner' ? 'muumini' : p.kind === 'family' ? 'familia' : 'jumuiya/kikundi'}`; } });
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
      const scoped = P.scopeUnit() ? P.ref.unitsById[P.scopeUnit()] : null;
      const f = { from: params.from || P.yearFrom(), to: params.to || P.yearTo(), category: params.category || '', q: params.q || '', status: params.status || 'posted',
        kigango: params.kigango ?? (scoped?.unit_type === 'kigango' ? scoped.id : scoped ? P.kigangoOf(scoped.id)?.id || '' : ''),
        jumuiya: params.jumuiya ?? (scoped?.unit_type === 'jumuiya' ? scoped.id : ''), group: params.group || 'unit' };
      f.unit = P.cascadeUnit(f);
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Miamala</h1><p class="pm-muted">Kila malipo huingizwa mara moja tu; ripoti zote za jumuiya, kigango na parokia husasishwa kutoka hapa.</p></div>
          <div class="pm-actions">${P.can('finance.record') ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Rekodi Malipo</button>' : ''}
          <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button></div></div>
        <form class="pm-filters">
          <label>Kuanzia<input type="date" name="from" value="${f.from}"></label>
          <label>Hadi<input type="date" name="to" value="${f.to}"></label>
          <label>Aina<select name="category">${P.catOptions(null, { blank: 'Zote', selected: f.category })}</select></label>
          ${P.cascadeHtml({ kigango: f.kigango, jumuiya: f.jumuiya })}
          <label>Panga<select name="group"><option value="unit">Kigango → Jumuiya</option><option value="date" ${f.group === 'date' ? 'selected' : ''}>Kwa tarehe</option></select></label>
          <label>Hali<select name="status"><option value="posted">Yaliyothibitishwa</option><option value="pending" ${f.status === 'pending' ? 'selected' : ''}>Yanayosubiri</option><option value="all" ${f.status === 'all' ? 'selected' : ''}>Yote</option></select></label>
          <label>Tafuta<input name="q" value="${P.esc(f.q)}" placeholder="Mlipaji / risiti"></label>
          <button class="pm-btn">Chuja</button></form>
        <div data-list>${P.loading()}</div>`;
      P.wireCascade(el.querySelector('.pm-filters'));
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
      const cols = [
          { key: 'txn_no', label: 'Na.' }, { key: 'txn_date', label: 'Tarehe', fmt: P.date },
          { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
          { key: 'jumuiya_name', label: 'Jumuiya', html: r => P.esc(r.jumuiya_name || r.org_unit_name || '—') + (r.kigango_name ? `<br><small class="pm-muted">${P.esc(r.kigango_name)}</small>` : '') },
          { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'payment_method', label: 'Njia', fmt: v => P.METHODS[v] || v },
          { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>${r.receipt_status === 'void' ? ' ' + P.badge('imefutwa', 'rose') : ''}` : (r.legacy_receipt_no ? `<small class="pm-muted">Excel #${P.esc(r.legacy_receipt_no)}</small>` : '—') },
          { key: 'status', label: 'Hali', html: r => r.sign < 0 ? P.badge('Reversal', 'rose') : r.reversed_by_id ? P.badge('Imerudishwa', 'rose') : r.status === 'pending' ? P.badge('Inasubiri', 'gold') : P.badge('Imethibitishwa', 'teal') },
          { key: 'id', label: '', html: r => canRev && r.status === 'posted' && r.sign > 0 && !r.reversed_by_id ? `<button class="pm-btn pm-btn--sm" data-reverse="${r.id}" data-no="${r.txn_no}">Rudisha</button>` : '' },
        ];
      const kgOf = r => r.kigango_id || (r.org_unit_id && P.kigangoOf(r.org_unit_id)?.id) || '';
      const levels = [
        { key: kgOf, label: k => k ? `Kigango cha ${P.ref.unitsById[k]?.name || ''}` : 'Parokia (bila kigango)', order: k => k ? P.unitOrder(k) : -1,
          html: (k, g) => k ? `<a href="#/kigango?id=${k}">Kigango cha ${P.esc(P.ref.unitsById[k]?.name || '')}</a>` : 'Parokia (bila kigango)' },
        { key: r => r.jumuiya_id || '', label: k => k ? `Jumuiya ya ${P.ref.unitsById[k]?.name || ''}` : 'Kigango chenyewe / bila jumuiya',
          order: k => k ? P.unitOrder(k) : -1, html: k => k ? `<a href="#/jumuiya?id=${k}&tab=miamala">Jumuiya ya ${P.esc(P.ref.unitsById[k]?.name || '')}</a>` : 'Kigango chenyewe / bila jumuiya' },
      ];
      const head = `<p class="pm-muted pm-small">${rows.length} miamala${rows.length === 500 ? ' (500 ya kwanza — punguza vigezo)' : ''} · Jumla ${P.tzs(P.sum(rows, 'net_amount'))}</p>`;
      el.querySelector('[data-list]').innerHTML = head + (f.group === 'date' ? P.table(rows, cols)
        : P.groupedTable(rows, cols, { levels: f.jumuiya ? [] : f.kigango ? levels.slice(1) : levels, sums: ['net_amount'] }));
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
      const year = P.year(), level = params.level || 'jumuiya';
      const f = { kigango: params.kigango || '', jumuiya: params.jumuiya || '' };
      const own = P.scopeUnit() && P.ref.unitsById[P.scopeUnit()];
      if (!f.kigango && !f.jumuiya && own) f[own.unit_type === 'jumuiya' ? 'jumuiya' : 'kigango'] = own.id;
      const scope = P.cascadeUnit(f);
      const LV = [['jumuiya', 'Jumuiya'], ['family', 'Familia'], ['parishioner', 'Muumini'], ['kigango', 'Kigango']];
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Zaka ${year}</h1><p class="pm-muted">Imepangwa Kigango → Jumuiya${level === 'parishioner' ? ' → Familia' : ''}. Bonyeza jumuiya kuona zaka ya kila muumini wake. Mwaka unabadilishwa juu kabisa.</p></div>
          <div class="pm-actions"><a class="pm-btn pm-btn--primary" href="#/units"><span class="material-symbols-outlined">account_tree</span>Jaza zaka: Vigango → Jumuiya → Familia</a>
          <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button><button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <form class="pm-filters">
          <label>Onyesha kwa<select name="level">${LV.map(([k, v]) => `<option value="${k}" ${k === level ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${P.cascadeHtml({ ...f, allLabel: 'Zote' })}
          <button class="pm-btn">Onyesha</button></form>
        <div data-out>${P.loading()}</div>`;
      P.wireCascade(el);
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/zaka?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      const rows = await P.rpc('zaka_grid_tree', { p_year: year, p_level: level, p_scope: scope || null });
      const mk = i => `m${String(i + 1).padStart(2, '0')}`;
      const mcols = P.MONTHS.map((m, i) => ({ key: mk(i), label: m, fmt: v => Number(v) ? P.num(v) : '', cls: 'pm-num' }));
      const foot = Object.fromEntries(mcols.map(c => [c.key, P.num(P.sum(rows, c.key))]));
      foot.total = `<b>${P.num(P.sum(rows, 'total'))}</b>`; foot.group_name = '<b>JUMLA</b>';
      const uname = id => P.ref.unitsById[id]?.name || '—';
      const kLevel = { key: r => r.kigango_id || '', label: k => k ? `Kigango cha ${uname(k)}` : 'Parokiani', order: k => P.unitOrder(k),
        html: k => k ? `<a href="#/kigango?id=${k}">Kigango cha ${P.esc(uname(k))}</a>` : 'Parokiani (zaka iliyolipwa parokiani moja kwa moja)' };
      const jLevel = { key: r => r.jumuiya_id || '', label: k => k ? uname(k) : 'Bila jumuiya',
        html: k => k ? `<a href="#/jumuiya?id=${k}&tab=zaka">Jumuiya ya ${P.esc(uname(k))}</a>` : 'Bila jumuiya' };
      const levels = level === 'kigango' ? [] : level === 'jumuiya' ? [kLevel] : [kLevel, jLevel];
      const nameCol = { key: 'group_name', label: LV.find(x => x[0] === level)[1], html: r =>
        level === 'jumuiya' ? `<a class="pm-link" href="#/jumuiya?id=${r.group_id}&tab=zaka">${P.esc(r.group_name)}</a>`
        : level === 'kigango' ? `<a class="pm-link" href="#/kigango?id=${r.group_id}">${P.esc(r.group_name)}</a>`
        : r.family_id ? `<a class="pm-link" href="#/family?id=${r.family_id}">${P.esc(r.group_name)}</a>` : P.esc(r.group_name || 'Parokiani (bila jumuiya)') };
      const head = P.reportHeader(`Taarifa ya Zaka ${year}`, scope ? P.ref.unitsById[scope].label : 'Parokia nzima');
      el.querySelector('[data-out]').innerHTML = head + P.groupedTable(rows, [nameCol, ...mcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' },
        { key: 'months_paid', label: 'Miezi', cls: 'pm-num' }, { key: 'months_unpaid', label: 'Hajatoa', html: r => r.months_unpaid ? `<span class="pm-due">${r.months_unpaid}</span>` : '0', cls: 'pm-num' }],
        { levels, sums: [...mcols.map(c => c.key), 'total'], fmt: v => v ? P.num(v) : '', foot, empty: 'Hakuna zaka iliyorekodiwa kwa vigezo hivi.' });
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Zaka ${year}`));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`zaka_${year}_${level}`, { Zaka: rows.map(r => ({
        Kigango: uname(r.kigango_id), Jumuiya: r.jumuiya_id ? uname(r.jumuiya_id) : '', Jina: r.group_name,
        ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(r[mk(i)]) || 0])), Jumla: Number(r.total), Miezi_aliyotoa: r.months_paid, Hajatoa: r.months_unpaid })) }));
    },
  };

  /* ================= MICHANGO NA KAMPENI (kanuni za kila mwaka) ================= */
  const KTABS = [['', 'Zote'], ['mavuno', 'Mavuno'], ['ujenzi', 'Ujenzi'], ['special', 'Maalumu'], ['other', 'Mingine']];
  const kindOf = k => ['mavuno', 'ujenzi', 'special'].includes(k) ? k : 'other';
  const parseRates = t => Object.fromEntries(String(t || '').split(/[,;\n]/).map(x => x.split(/[=:]/).map(y => y.trim())).filter(x => x[0] && Number(x[1]) > 0).map(([k, v]) => [k.toUpperCase(), Number(v)]));
  const ratesText = r => Object.entries(r || {}).map(([k, v]) => `${k}=${v}`).join(', ');
  // the form for a campaign's rules (who gives, how the amount is set, how often)
  const rulesForm = (c = {}) => {
    const R = P.RULES;
    const opt = (map, sel) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
    return `<fieldset class="pm-form pm-span2"><legend class="pm-small pm-muted">Kanuni za mchango huu kwa mwaka huu</legend>
      <label>Nani anatoa<select name="giver_level"><option value="">Yeyote (hakuna mpangilio)</option>${opt(R.LEVEL, c.giver_level)}</select></label>
      <label>Kiasi kinapatikanaje<select name="amount_mode">${opt(R.MODE, c.amount_mode || 'pledge')}</select></label>
      <label>Mara ngapi<select name="frequency">${opt(R.FREQ, c.frequency || 'yearly')}</select></label>
      <label>Kiasi cha kawaida (kupangiwa)<input name="default_amount" type="number" min="0" value="${c.default_amount ?? ''}" placeholder="mf. 100000"></label>
      <label class="pm-span2">Viwango kwa uhusiano (kila muumini, hiari)<input name="relation_rates" value="${P.esc(ratesText(c.relation_rates))}" placeholder="BABA=5000, MAMA=5000, MTOTO=2000"></label>
      <p class="pm-small pm-muted pm-span2">Kupangiwa = parokia inaweka kiasi kwa kila mmoja (tumia "Pangia wote"). Ahadi = kila mmoja anaahidi kiasi chake. Hiari = anatoa anachoweza, hakuna deni.</p></fieldset>`;
  };
  const rulesRow = v => ({ giver_level: v.giver_level || null, amount_mode: v.amount_mode || 'pledge', frequency: v.frequency || 'yearly',
    default_amount: v.default_amount ? Number(v.default_amount) : null, relation_rates: parseRates(v.relation_rates) });

  V.campaigns = {
    title: 'Michango na Kampeni', perm: 'finance.read',
    async render(el, params) {
      const year = P.year(), kind = params.kind || '';
      const cfg = P.can('finance.configure');
      const prog = await P.q(P.from('v_campaign_progress').select('*').eq('campaign_year', year).neq('category_kind', 'zaka').order('name'));
      const rules = Object.fromEntries(P.ref.camps.map(c => [c.id, c]));
      const all = prog.map(r => ({ ...r, ...(rules[r.campaign_id] ? { giver_level: rules[r.campaign_id].giver_level, amount_mode: rules[r.campaign_id].amount_mode,
        frequency: rules[r.campaign_id].frequency, default_amount: rules[r.campaign_id].default_amount, relation_rates: rules[r.campaign_id].relation_rates } : {}) }));
      const active = r => Number(r.target) > 0 || Number(r.pledged) > 0 || Number(r.collected) > 0;
      const list = all.filter(r => (!kind || kindOf(r.category_kind) === kind) && (params.all || active(r)));
      const hidden = all.filter(r => (!kind || kindOf(r.category_kind) === kind) && !active(r)).length;
      const sel = params.id ? all.find(c => c.campaign_id === params.id) : null;
      const prevYear = P.ref.camps.filter(c => c.campaign_year === year - 1 && c.recurs_annually);
      const missing = prevYear.filter(c => !P.ref.camps.some(x => x.campaign_year === year && x.category_id === c.category_id));
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Michango na Kampeni ${year}</h1>
          <p class="pm-muted">Kila mchango una kanuni zake za mwaka huu: nani anatoa (kila muumini / familia / jumuiya / kigango), kiasi (kupangiwa / ahadi / hiari) na mara ngapi (kwa mwaka / kwa mwezi). Badilisha mwaka juu kuona au kupanga mwaka mwingine.</p></div>
          <div class="pm-actions">${cfg && missing.length ? `<button class="pm-btn" data-copy><span class="material-symbols-outlined">content_copy</span>Anzisha ${missing.length} ya ${year} kutoka ${year - 1}</button>` : ''}
            ${cfg ? '<button class="pm-btn pm-btn--primary" data-newcamp><span class="material-symbols-outlined">add</span>Mchango mpya</button>' : ''}</div></div>
        <div class="pm-chips">${KTABS.map(([k, l]) => `<a class="pm-chip ${k === kind ? 'is-active' : ''}" href="#/campaigns?kind=${k}">${l} <small>${all.filter(r => (!k || kindOf(r.category_kind) === k) && active(r)).length}</small></a>`).join('')}</div>
        <section class="pm-card">${P.table(list, [
          { key: 'name', label: 'Mchango', html: r => `<a class="pm-link" href="#/campaigns?kind=${kind}&id=${r.campaign_id}">${P.esc(r.name)}</a><br><small class="pm-muted">${P.esc(r.category_name)}</small>` },
          { key: 'rules', label: 'Kanuni', html: r => P.rulesBadges(r) },
          { key: 'target', label: 'Lengo', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'pledged', label: 'Pangiwa/Ahadi', fmt: P.tzs, cls: 'pm-num' }, { key: 'collected', label: 'Imekusanywa', fmt: P.tzs, cls: 'pm-num pm-strong' },
          { key: 'outstanding_pledges', label: 'Bado', fmt: v => Number(v) ? `<span class="pm-due">${P.tzs(v)}</span>` : '—', cls: 'pm-num' },
          { key: 'payers', label: 'Walipaji', cls: 'pm-num' },
          { key: 'campaign_id', label: '', html: r => cfg ? `<button class="pm-btn pm-btn--sm" data-rules="${r.campaign_id}">Kanuni</button>` : '' }],
          { empty: `Hakuna michango ya mwaka ${year}${missing.length ? ' — bonyeza "Anzisha" kunakili ya mwaka uliopita.' : '.'}` })}
          ${hidden && !params.all ? `<p class="pm-small pm-muted">${hidden} michango haijapangiwa wala kulipwa mwaka huu — <a class="pm-link" href="#/campaigns?kind=${kind}&all=1">ionyeshe</a>.</p>` : ''}</section>
        ${sel ? `<section class="pm-card"><div class="pm-row"><div><h3 class="pm-h3">${P.esc(sel.name)} — kwa Kigango → Jumuiya</h3>${P.rulesBadges(sel)}</div>
          <div class="pm-actions">${P.can('finance.pledge') && sel.giver_level && sel.amount_mode === 'assigned' ? '<button class="pm-btn pm-btn--sm" data-assign>Pangia wote (parokia nzima)</button>' : ''}
          ${cfg ? `<button class="pm-btn pm-btn--sm" data-target="${sel.campaign_id}">Weka lengo</button>` : ''}
          <button class="pm-btn pm-btn--sm" data-print>Chapa</button><button class="pm-btn pm-btn--sm" data-xls>Excel</button></div></div>
          <div data-org>${P.loading()}</div></section>` : `<p class="pm-muted pm-small">Bonyeza jina la mchango kuona kila kigango na jumuiya.</p>`}`;
      el.querySelectorAll('[data-rules]').forEach(b => b.addEventListener('click', async () => {
        const c = rules[b.dataset.rules];
        const v = await P.modal({ title: `Kanuni — ${c.name}`, body: `<div class="pm-form">${rulesForm(c)}</div>` });
        if (!v) return;
        await P.q(P.from('campaigns').update(rulesRow(v)).eq('id', c.id));
        await P.loadRef(true); Toast.success('Kanuni zimehifadhiwa.'); P.reload();
      }));
      if (sel) {
        const rows = await P.rpc('campaign_org_progress', { p_campaign: sel.campaign_id, p_level: 'jumuiya' });
        rows.forEach(r => { r.kigango_id = P.kigangoOf(r.org_unit_id)?.id || ''; });
        const foot = { org_unit_name: '<b>JUMLA</b>', target: P.tzs(P.sum(rows, 'target')), pledged: P.tzs(P.sum(rows, 'pledged')), collected: `<b>${P.tzs(P.sum(rows, 'collected'))}</b>`, balance: P.tzs(P.sum(rows, 'balance')), excess: P.tzs(P.sum(rows, 'excess')) };
        el.querySelector('[data-org]').innerHTML = P.reportHeader(`Taarifa ya ${sel.name}`, 'Kwa kigango na jumuiya') + P.groupedTable(rows, [
          { key: 'org_unit_name', label: 'Jumuiya', html: r => `<a class="pm-link" href="#/jumuiya?id=${r.org_unit_id}&tab=michango&campaign=${sel.campaign_id}">${P.esc(r.org_unit_name)}</a>` },
          { key: 'target', label: 'Lengo', fmt: P.tzs, cls: 'pm-num' }, { key: 'pledged', label: 'Pangiwa/Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'collected', label: 'Walichotoa', fmt: P.tzs, cls: 'pm-num pm-strong' }, { key: 'balance', label: 'Bado', fmt: P.tzs, cls: 'pm-num' },
          { key: 'excess', label: 'Ziada', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'pct', label: '%', html: r => r.pct === null ? '—' : `${P.pct(r.pct)} ${P.progress(r.pct)}` }, { key: 'payers', label: 'Walipaji', cls: 'pm-num' }],
          { levels: [{ key: r => r.kigango_id, label: k => k ? `Kigango cha ${P.ref.unitsById[k].name}` : 'Bila kigango', order: k => P.unitOrder(k),
            html: k => k ? `<a href="#/kigango?id=${k}">Kigango cha ${P.esc(P.ref.unitsById[k].name)}</a>` : 'Bila kigango' }],
            sums: ['target', 'pledged', 'collected', 'balance', 'excess', 'payers'], fmt: P.tzs, foot });
        el.querySelector('[data-print]').addEventListener('click', () => P.print(sel.name));
        el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(sel.name, { Jumuiya: rows.map(r => ({ Kigango: r.kigango_name, Jumuiya: r.org_unit_name, Lengo: Number(r.target), Pangiwa_Ahadi: Number(r.pledged), Walichotoa: Number(r.collected), Bado: Number(r.balance), Ziada: Number(r.excess), Asilimia: r.pct })) }));
        const ab = el.querySelector('[data-assign]');
        ab && ab.addEventListener('click', async () => {
          const v = await P.modal({ title: `Pangia wote — ${sel.name}`, submit: 'Pangia', body: `<p class="pm-muted">${P.RULES.LEVEL[sel.giver_level]} wa parokia nzima ambaye bado hajapangiwa wala kuahidi atapangiwa kiasi hiki${sel.frequency === 'monthly' ? ' (× miezi 12)' : ''}. Waliokwisha pangiwa hawabadilishwi.</p>
            <div class="pm-form"><label>Kiasi<input name="amount" type="number" min="1" value="${sel.default_amount || ''}"></label>
            <label>Ndani ya<select name="scope">${P.unitOptions(['kigango', 'jumuiya'], { blank: 'Parokia nzima' })}</select></label></div>
            ${Object.keys(sel.relation_rates || {}).length ? `<p class="pm-small pm-muted">Ukiacha kiasi wazi: ${P.esc(ratesText(sel.relation_rates))}</p>` : ''}` });
          if (!v) return;
          const r = await P.rpc('assign_campaign', { p_campaign: sel.campaign_id, p_amount: v.amount ? Number(v.amount) : null, p_scope: v.scope || null });
          Toast.success(`Wamepangiwa: ${r.created}${r.skipped_no_rate ? ` · bila kiwango: ${r.skipped_no_rate}` : ''}`); P.reload();
        });
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
      const fyId = y => P.ref.years.find(x => x.label === String(y))?.id || null;
      const cp = el.querySelector('[data-copy]');
      cp && cp.addEventListener('click', async () => {
        if (!fyId(year)) { Toast.error(`Mwaka wa fedha ${year} haujafunguliwa (Uhasibu).`); return; }
        await P.q(P.from('campaigns').insert(missing.map(c => ({ parish_id: c.parish_id, category_id: c.category_id, campaign_year: year, financial_year_id: fyId(year),
          name: String(c.name).replace(String(year - 1), String(year)).includes(String(year)) ? String(c.name).replace(String(year - 1), String(year)) : `${c.name} ${year}`,
          starts_on: `${year}-01-01`, ends_on: `${year}-12-31`, recurs_annually: true, description: c.description,
          giver_level: c.giver_level, amount_mode: c.amount_mode, frequency: c.frequency, default_amount: c.default_amount, relation_rates: c.relation_rates || {} }))));
        await P.loadRef(true); Toast.success(`Michango ${missing.length} ya ${year} imeanzishwa pamoja na kanuni zake.`); P.reload();
      });
      const nc = el.querySelector('[data-newcamp]');
      nc && nc.addEventListener('click', async () => {
        const v = await P.modal({ title: `Mchango mpya — ${year}`, wide: true, body: `<div class="pm-form">
          <label>Aina<select name="category_id" required>${P.catOptions(['mavuno', 'ujenzi', 'special', 'shukrani', 'sadaka', 'income_other'], { blank: 'Chagua…' })}</select></label>
          <label>Mwaka<input name="year" type="number" value="${year}" required></label>
          <label class="pm-span2">Jina<input name="name" required placeholder="mf. Mavuno ${year}"></label>
          ${rulesForm({})}
          <label>Lengo la jumla (hiari)<input name="target" type="number" min="0"></label>
          <label>Kila mwaka<select name="recurs"><option value="1">Ndiyo, unarudiwa kila mwaka</option><option value="">Hapana, mara moja</option></select></label>
          <label class="pm-span2">Maelezo<input name="description"></label></div>
          <p class="pm-small pm-muted">Aina mpya ya mchango (isiyokuwepo kwenye orodha) inaongezwa kwenye Mipangilio → Aina za michango.</p>` });
        if (!v) return;
        await P.q(P.from('campaigns').insert({ parish_id: P.ref.parish.id, category_id: v.category_id, campaign_year: Number(v.year), name: v.name,
          financial_year_id: fyId(v.year), target_amount: v.target ? Number(v.target) : null, starts_on: `${v.year}-01-01`, ends_on: `${v.year}-12-31`,
          description: v.description || null, recurs_annually: !!v.recurs, ...rulesRow(v) }));
        await P.loadRef(true); Toast.success('Mchango umeundwa.'); P.reload();
      });
    },
  };

  /* ================= AHADI NA MADENI ================= */
  V.pledges = {
    title: 'Ahadi na Madeni', perm: 'finance.read',
    async render(el, params) {
      const year = P.year();
      const f = { campaign: params.campaign || '', kigango: params.kigango || '', jumuiya: params.jumuiya || '', only: params.only || 'outstanding', q: params.q || '' };
      const own = P.scopeUnit() && P.ref.unitsById[P.scopeUnit()];
      if (!f.kigango && !f.jumuiya && own) f[own.unit_type === 'jumuiya' ? 'jumuiya' : 'kigango'] = own.id;
      const unit = P.cascadeUnit(f);
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Ahadi na Madeni ${year}</h1><p class="pm-muted">Waliopangiwa au kuahidi − walicholipa = deni, kwa Kigango → Jumuiya. Malipo yanayozidi yanaonyeshwa kama ziada.</p></div>
          <div class="pm-actions">${P.can('finance.pledge') ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Ahadi mpya</button>' : ''}
          <button class="pm-btn" data-xls>Excel</button><button class="pm-btn" data-print>Chapa</button></div></div>
        <form class="pm-filters">
          <label>Mchango<select name="campaign">${P.options(P.ref.camps.filter(c => c.campaign_year === year), { blank: `Yote ya ${year}`, selected: f.campaign })}</select></label>
          ${P.cascadeHtml({ kigango: f.kigango, jumuiya: f.jumuiya })}
          <label>Onyesha<select name="only"><option value="outstanding">Wenye deni</option><option value="all" ${f.only === 'all' ? 'selected' : ''}>Wote</option><option value="excess" ${f.only === 'excess' ? 'selected' : ''}>Waliozidisha</option><option value="overdue" ${f.only === 'overdue' ? 'selected' : ''}>Waliochelewa</option></select></label>
          <label>Tafuta<input name="q" value="${P.esc(f.q)}"></label><button class="pm-btn">Chuja</button></form>
        <div data-out>${P.loading()}</div>`;
      P.wireCascade(el);
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/pledges?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      let q = P.from('v_pledge_balances').select('*').eq('status', 'active').order('outstanding', { ascending: false }).limit(5000);
      q = f.campaign ? q.eq('campaign_id', f.campaign) : q.eq('campaign_year', year);
      if (unit) q = q.in('jumuiya_id', [unit, ...P.ref.units.filter(u => u.parent_id === unit).map(u => u.id)]);
      if (f.only === 'outstanding') q = q.gt('outstanding', 0);
      if (f.only === 'excess') q = q.gt('excess', 0);
      if (f.only === 'overdue') q = q.eq('is_overdue', true);
      if (f.q) q = q.or(`family_name.ilike.%${f.q}%,parishioner_name.ilike.%${f.q}%,org_unit_name.ilike.%${f.q}%`);
      const rows = await P.q(q);
      const who = r => r.parishioner_name || r.family_name || r.org_unit_name;
      const ju = r => P.ref.unitsById[r.jumuiya_id]?.label || '—';
      rows.forEach(r => { r.k_id = P.kigangoOf(r.jumuiya_id)?.id || r.kigango_id || ''; });
      const uname = id => P.ref.unitsById[id]?.name || '—';
      const foot = { who: '<b>JUMLA</b>', pledged: P.tzs(P.sum(rows, 'pledged')), paid: P.tzs(P.sum(rows, 'paid')), outstanding: `<b>${P.tzs(P.sum(rows, 'outstanding'))}</b>`, excess: P.tzs(P.sum(rows, 'excess')) };
      const can = P.can('finance.pledge');
      el.querySelector('[data-out]').innerHTML = P.reportHeader('Ahadi na Madeni', f.campaign ? P.ref.camps.find(c => c.id === f.campaign)?.name : 'Kampeni zote') +
        `<p class="pm-muted pm-small">${rows.length} ahadi</p>` + P.groupedTable(rows, [
          { key: 'who', label: 'Mwenye ahadi', html: r => (r.family_id ? `<a class="pm-link" href="#/family?id=${r.family_id}">${P.esc(who(r))}</a>` : P.esc(who(r))) + (r.source === 'assigned' ? ' ' + P.badge('Amepangiwa', 'gold') : '') },
          { key: 'campaign_name', label: 'Kampeni' }, { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'paid', label: 'Amelipa', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Deni', fmt: P.tzs, cls: 'pm-num pm-strong' },
          { key: 'excess', label: 'Ziada', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'completion_pct', label: '%', html: r => `${P.pct(r.completion_pct)} ${P.progress(r.completion_pct)}` },
          { key: 'pledge_id', label: '', html: r => can ? `<button class="pm-btn pm-btn--sm" data-act="${r.pledge_id}">Hatua</button>` : '' }],
          { foot, sums: ['pledged', 'paid', 'outstanding', 'excess'], empty: 'Hakuna ahadi kwa vigezo hivi.', levels: [
            { key: r => r.k_id, label: k => k ? `Kigango cha ${uname(k)}` : 'Bila kigango', order: k => P.unitOrder(k), html: k => k ? `<a href="#/kigango?id=${k}">Kigango cha ${P.esc(uname(k))}</a>` : 'Bila kigango' },
            { key: r => r.jumuiya_id || '', label: k => k ? uname(k) : 'Kigango chenyewe', html: k => k && P.ref.unitsById[k]?.unit_type === 'jumuiya' ? `<a href="#/jumuiya?id=${k}&tab=michango">Jumuiya ya ${P.esc(uname(k))}</a>` : P.esc(k ? uname(k) : 'Kigango chenyewe') }] });
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
          <label>Kampeni<select name="campaign_id" required>${P.options(P.ref.camps.filter(c => c.status !== 'closed' && c.campaign_year === year && c.amount_mode !== 'free' && P.ref.catsById[c.category_id]?.is_pledgeable), { blank: 'Chagua…', selected: f.campaign })}</select></label>
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
