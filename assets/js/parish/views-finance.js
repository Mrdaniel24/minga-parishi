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

  // every member of a level (vigango / jumuiya of a kigango / families of a jumuiya / members of a family),
  // so the list is complete even where nothing was paid yet
  P.levelMembers = async (level, parent) => {
    if (level === 'kigango') return P.unitsOf('kigango').map(u => ({ id: u.id, name: u.name }));
    if (level === 'jumuiya') return P.ref.units.filter(u => u.parent_id === parent && u.is_active && ['jumuiya', 'group'].includes(u.unit_type)).map(u => ({ id: u.id, name: u.name }));
    if (level === 'family') return (await P.q(P.from('families').select('id,family_name,family_code').eq('jumuiya_id', parent).eq('status', 'active').limit(1000)))
      .map(f => ({ id: f.id, name: f.family_name, code: f.family_code }));
    return (await P.q(P.from('parishioners').select('id,full_name').eq('family_id', parent).eq('membership_status', 'active').limit(200))).map(p => ({ id: p.id, name: p.full_name }));
  };
  P.levelSort = (level, list) => list.sort(level === 'kigango' || level === 'jumuiya'
    ? (a, b) => P.unitOrder(a.group_id) - P.unitOrder(b.group_id) || String(a.group_name).localeCompare(String(b.group_name))
    : level === 'family' ? (a, b) => (Number(a.code) || 9999) - (Number(b.code) || 9999) || String(a.group_name).localeCompare(String(b.group_name))
    : (a, b) => String(a.group_name).localeCompare(String(b.group_name)));

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
        <label>Aina ya mchango<select name="category_id" required>${P.typeOptions(null, { blank: 'Chagua…', selected: prefill.category_id })}</select></label>
        ${P.newTypeHtml()}
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
        P.wireNewType(m, cat);
        P.payerPicker(m, { jumuiya: prefill.jumuiya, onPick: p => { payer = p; m.querySelector('[data-payer-kind]').textContent = `Amechaguliwa: ${p.kind === 'parishioner' ? 'muumini' : p.kind === 'family' ? 'familia' : 'jumuiya/kikundi'}`; } });
        m.querySelector('[data-payer-search]').addEventListener('input', () => { payer = null; m.querySelector('[data-payer-kind]').textContent = 'Jina huru (halijaunganishwa na rejista)'; });
        if (zakaCat && prefill.category_id === zakaCat.id) syncCat();
      },
    });
    if (!result) return null;
    const categoryId = await P.resolveType(result);
    const args = {
      idempotency_key: key, amount: Number(result.amount), txn_date: result.txn_date, category_id: categoryId,
      campaign_id: result.category_id === '__new' ? null : result.campaign_id || null, payment_method: result.payment_method,
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

  /* ================= MIAMALA — Vigango → Kigango → Jumuiya → Familia → Muumini =================
     Each level shows one line per unit below it (totals computed in the database),
     plus one line for what was paid at that level itself. Click to go one level
     down; the last level shows the payments. */
  V.payments = {
    title: 'Miamala', perm: 'finance.read',
    async render(el, params) {
      const scoped = P.scopeUnit() ? P.ref.unitsById[P.scopeUnit()] : null;
      const f = { from: params.from || P.yearFrom(), to: params.to || P.yearTo(), category: params.category || '', status: params.status || 'posted', q: params.q || '' };
      // where we are: k = kigango ('none' = parokiani), j = jumuiya ('none' = the kigango itself),
      // fa = familia ('none' = the jumuiya itself), p = muumini ('none' = the family itself)
      const at = { k: params.k || '', j: params.j || '', fa: params.fa || '', p: params.p || '', all: params.all || '' };
      if (scoped && !params.k) {
        if (scoped.unit_type === 'kigango') at.k = scoped.id;
        if (scoped.unit_type === 'jumuiya') { at.k = P.kigangoOf(scoped.id)?.id || ''; at.j = scoped.id; }
      }
      const link = (o = {}) => '#/payments?' + new URLSearchParams(Object.entries({ ...f, ...at, all: '', ...o }).filter(([, v]) => v !== '' && v != null)).toString();
      const [fam, per] = await Promise.all([
        at.fa && at.fa !== 'none' ? P.q(P.from('families').select('id,family_name,family_code').eq('id', at.fa).maybeSingle()) : null,
        at.p && at.p !== 'none' ? P.q(P.from('parishioners').select('id,full_name').eq('id', at.p).maybeSingle()) : null,
      ]);
      const kName = at.k === 'none' ? 'Parokiani' : at.k ? `Kigango cha ${P.ref.unitsById[at.k]?.name || ''}` : '';
      const jName = at.j === 'none' ? 'Kigango chenyewe' : at.j ? `Jumuiya ya ${P.ref.unitsById[at.j]?.name || ''}` : '';
      const fName = at.fa === 'none' ? 'Jumuiya yenyewe' : fam ? fam.family_name : '';
      const pName = at.p === 'none' ? 'Familia yenyewe' : per ? per.full_name : '';
      const crumbs = [{ label: 'Vigango vyote', href: link({ k: '', j: '', fa: '', p: '' }) }];
      if (at.k) crumbs.push({ label: kName, href: link({ j: '', fa: '', p: '' }) });
      if (at.j) crumbs.push({ label: jName, href: link({ fa: '', p: '' }) });
      if (at.fa) crumbs.push({ label: fName, href: link({ p: '' }) });
      if (at.p) crumbs.push({ label: pName, href: link({}) });
      // which level is listed: the next one down, or the payments when we are at the bottom
      const leaf = at.k === 'none' || at.j === 'none' || at.fa === 'none' || at.p || f.q;
      const level = leaf ? null : !at.k ? 'kigango' : !at.j ? 'jumuiya' : !at.fa ? 'family' : 'parishioner';
      const parent = { kigango: null, jumuiya: at.k, family: at.j, parishioner: at.fa }[level];
      const LBL = { kigango: ['Kigango', 'Parokiani — sadaka za Jumapili, shukrani na malipo ya parokia yenyewe'], jumuiya: ['Jumuiya', 'Kigango chenyewe (si kupitia jumuiya)'],
        family: ['Familia', 'Jumuiya yenyewe (jumla ya jumuiya, bila familia)'], parishioner: ['Muumini', 'Familia yenyewe (familia nzima)'] };
      el.innerHTML = `
        ${P.crumbs(crumbs.map((c, i) => i === crumbs.length - 1 ? { label: c.label } : c))}
        <div class="pm-head"><div><h1 class="pm-h1">Miamala${crumbs.length > 1 ? ' — ' + P.esc(crumbs[crumbs.length - 1].label) : ''}</h1>
          <p class="pm-muted">${level ? `Bonyeza ${LBL[level][0].toLowerCase()} kuingia ndani zaidi, hadi miamala yenyewe.` : 'Miamala yenyewe.'} ${P.date(f.from)} – ${P.date(f.to)}.</p></div>
          <div class="pm-actions">${P.can('finance.record') ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Rekodi Malipo</button>' : ''}
          <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button></div></div>
        <form class="pm-filters">
          <label>Kuanzia<input type="date" name="from" value="${f.from}"></label>
          <label>Hadi<input type="date" name="to" value="${f.to}"></label>
          <label>Aina<select name="category">${P.catOptions(null, { blank: 'Zote', selected: f.category })}</select></label>
          <label>Hali<select name="status"><option value="posted">Yaliyothibitishwa</option><option value="pending" ${f.status === 'pending' ? 'selected' : ''}>Yanayosubiri</option><option value="all" ${f.status === 'all' ? 'selected' : ''}>Yote</option></select></label>
          <label>Tafuta (ngazi hii)<input name="q" value="${P.esc(f.q)}" placeholder="Mlipaji / risiti"></label>
          <button class="pm-btn">Chuja</button></form>
        <div data-list>${P.loading()}</div>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => {
        e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); Object.assign(f, v); P.go(link({ all: '' }));
      });
      const newBtn = el.querySelector('[data-new]');
      const openNew = async () => {
        const pre = at.j && at.j !== 'none' ? { jumuiya: at.j } : at.k && at.k !== 'none' ? { org_unit_id: at.k } : {};
        if (fam) Object.assign(pre, { payer: { kind: 'family', id: fam.id }, payerName: fam.family_name });
        if (per) Object.assign(pre, { payer: { kind: 'parishioner', id: per.id }, payerName: per.full_name });
        const r = await paymentForm(pre).catch(e => { Toast.error(P.friendlyError(e)); return null; });
        if (r && (r.status === 'posted' || r.status === 'already_posted')) {
          Toast.success(`Malipo yamehifadhiwa. Risiti ${r.receipt_no || ''}`);
          if (r.receipt_id) window.open(`receipt.html?id=${r.receipt_id}`, '_blank');
          P.refresh();
        }
      };
      newBtn && newBtn.addEventListener('click', openNew);
      if (params.new && newBtn) { history.replaceState(null, '', '#/payments'); openNew(); }
      const out = el.querySelector('[data-list]');

      /* ---------- a level: one line per unit below ---------- */
      if (level) {
        const [rows, members] = await Promise.all([
          P.rpc('ledger_tree', { p_from: f.from, p_to: f.to, p_level: level, p_parent: parent, p_category: f.category || null, p_status: f.status }),
          P.levelMembers(level, parent)]);
        const itself = rows.find(r => !r.group_id);
        const zero = { n: 0, zaka: 0, mavuno: 0, ujenzi: 0, sadaka: 0, other: 0, total: 0 };
        const byId = Object.fromEntries(rows.filter(r => r.group_id).map(r => [r.group_id, r]));
        const known = new Set(members.map(m => m.id));
        const list = P.levelSort(level, [...members.map(m => ({ ...zero, ...(byId[m.id] || {}), group_id: m.id, group_name: m.name, code: m.code })),
          ...rows.filter(r => r.group_id && !known.has(r.group_id))]);
        if (itself) list.unshift({ ...itself, group_name: LBL[level][1], self: true });
        const key = { kigango: 'k', jumuiya: 'j', family: 'fa', parishioner: 'p' }[level];
        const money = v => Number(v) ? P.tzs(v) : '—';
        const S = k => P.sum(list, k);
        out.innerHTML = `<p class="pm-muted pm-small">${P.num(S('n'))} miamala · Jumla <b>${P.tzs(S('total'))}</b> ·
            <a class="pm-link" href="${link({ all: '1' })}">Ona miamala yote ya ngazi hii</a></p>` +
          P.table(list, [
            { key: 'group_name', label: LBL[level][0], html: r => `<a class="pm-link ${r.self ? 'pm-muted' : ''}" href="${link({ [key]: r.group_id || 'none' })}">${P.esc(r.group_name || '—')}</a>` },
            { key: 'n', label: 'Miamala', fmt: P.num, cls: 'pm-num' },
            { key: 'zaka', label: 'Zaka', fmt: money, cls: 'pm-num' }, { key: 'mavuno', label: 'Mavuno', fmt: money, cls: 'pm-num' },
            { key: 'ujenzi', label: 'Ujenzi', fmt: money, cls: 'pm-num' }, { key: 'sadaka', label: 'Sadaka', fmt: money, cls: 'pm-num' },
            { key: 'other', label: 'Mingine', fmt: money, cls: 'pm-num' }, { key: 'total', label: 'Jumla', fmt: P.tzs, cls: 'pm-num pm-strong' },
            { key: 'group_id', label: '', html: r => `<a class="pm-btn pm-btn--sm" href="${link({ [key]: r.group_id || 'none' })}">Fungua</a>` }],
            { empty: 'Hakuna miamala kwa vigezo hivi.', foot: { group_name: '<b>JUMLA</b>', n: P.num(S('n')), zaka: P.tzs(S('zaka')), mavuno: P.tzs(S('mavuno')),
              ujenzi: P.tzs(S('ujenzi')), sadaka: P.tzs(S('sadaka')), other: P.tzs(S('other')), total: `<b>${P.tzs(S('total'))}</b>` } }) +
          (at.all ? '<h3 class="pm-h3 mt-4">Miamala yote ya ngazi hii</h3><div data-rows></div>' : '');
        el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`miamala_${f.from}_${f.to}`, { [LBL[level][0]]: list.map(r => ({
          [LBL[level][0]]: r.group_name, Miamala: Number(r.n), Zaka: Number(r.zaka), Mavuno: Number(r.mavuno), Ujenzi: Number(r.ujenzi), Sadaka: Number(r.sadaka), Mingine: Number(r.other), Jumla: Number(r.total) })) }));
        if (!at.all) return;
      }

      /* ---------- the payments themselves ---------- */
      const box = level ? out.querySelector('[data-rows]') : out;
      const scope = q => {
        if (at.p && at.p !== 'none') return q.eq('parishioner_id', at.p);
        if (at.p === 'none') return q.eq('family_id', at.fa).is('parishioner_id', null);
        if (at.fa && at.fa !== 'none') return q.eq('family_id', at.fa);
        if (at.fa === 'none') return q.eq('tree_jumuiya_id', at.j).is('family_id', null);
        if (at.j && at.j !== 'none') return q.eq('tree_jumuiya_id', at.j);
        if (at.j === 'none') return q.eq('tree_kigango_id', at.k).is('tree_jumuiya_id', null);
        if (at.k && at.k !== 'none') return q.eq('tree_kigango_id', at.k);
        if (at.k === 'none') return q.is('tree_kigango_id', null);
        return q;
      };
      const PAGE = 200;
      let rows = [], done = false;
      const fetchPage = async () => {
        let q = P.from('v_ledger_tree').select('*').eq('kind', 'income').gte('txn_date', f.from).lte('txn_date', f.to)
          .order('txn_date', { ascending: false }).order('txn_no', { ascending: false }).range(rows.length, rows.length + PAGE - 1);
        q = f.status === 'all' ? q.neq('status', 'rejected') : q.eq('status', f.status);
        if (f.category) q = q.eq('category_id', f.category);
        if (f.q) q = q.or(`payer_name.ilike.%${f.q.replace(/[,()]/g, ' ')}%,receipt_no.ilike.%${f.q.replace(/[,()]/g, ' ')}%,legacy_receipt_no.eq.${f.q.replace(/\D/g, '') || 0}`);
        const page = await P.q(scope(q));
        rows = rows.concat(page); done = page.length < PAGE;
      };
      await fetchPage();
      const canRev = P.can('finance.reverse');
      const cols = [
        { key: 'txn_no', label: 'Na.' }, { key: 'txn_date', label: 'Tarehe', fmt: P.date },
        { key: 'payer_name', label: 'Mlipaji', html: r => P.esc(r.payer_name || '—') + (r.family_name && r.family_name !== r.payer_name ? `<br><small class="pm-muted">${P.esc(r.family_name)}</small>` : '') },
        { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
        { key: 'period_month', label: 'Mwezi', fmt: v => v ? `${P.MONTHS[Number(String(v).slice(5, 7)) - 1]} ${String(v).slice(0, 4)}` : '' },
        { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num pm-strong' },
        { key: 'payment_method', label: 'Njia', fmt: v => P.METHODS[v] || v },
        { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>${r.receipt_status === 'void' ? ' ' + P.badge('imefutwa', 'rose') : ''}` : (r.legacy_receipt_no ? `<small class="pm-muted">Excel #${P.esc(r.legacy_receipt_no)}</small>` : '—') },
        { key: 'status', label: 'Hali', html: r => r.sign < 0 ? P.badge('Reversal', 'rose') : r.reversed_by_id ? P.badge('Imerudishwa', 'rose') : r.status === 'pending' ? P.badge('Inasubiri', 'gold') : '' },
        { key: 'id', label: '', html: r => canRev && r.status === 'posted' && r.sign > 0 && !r.reversed_by_id ? `<button class="pm-btn pm-btn--sm" data-reverse="${r.id}" data-no="${r.txn_no}">Rudisha</button>` : '' },
      ];
      const draw = () => {
        box.innerHTML = `<p class="pm-muted pm-small">${P.num(rows.length)}${done ? '' : '+'} miamala${done ? ` · Jumla <b>${P.tzs(P.sum(rows, 'net_amount'))}</b>` : ''}</p>` +
          P.table(rows, cols, { empty: 'Hakuna miamala kwa vigezo hivi.' }) +
          (done ? '' : `<p class="mt-4"><button class="pm-btn" data-more>Onyesha ${PAGE} zaidi</button></p>`);
        const more = box.querySelector('[data-more]');
        more && more.addEventListener('click', async () => { more.disabled = true; await fetchPage(); draw(); });
        box.querySelectorAll('[data-reverse]').forEach(b => b.addEventListener('click', async () => {
          const v = await P.modal({ title: `Rudisha muamala Na. ${b.dataset.no}`, submit: 'Rudisha muamala',
            body: `<p class="pm-muted">Muamala hautafutwa. Muamala wa kurudisha (reversal) utaandikwa na jumla zote zitajirekebisha. Risiti itabatilishwa.</p>
                   <div class="pm-form"><label class="pm-span2">Sababu<input name="reason" required minlength="5"></label>
                   <label>Tarehe ya kurudisha<input type="date" name="date" value="${P.today()}" required></label></div>` });
          if (!v) return;
          await P.busy(b, () => P.rpc('reverse_transaction', { p_txn: b.dataset.reverse, p_reason: v.reason, p_idempotency_key: P.uuid(), p_date: v.date }));
          Toast.success('Muamala umerudishwa.'); P.refresh();
        }));
      };
      draw();
      if (!level) el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`miamala_${f.from}_${f.to}`, { Miamala: rows.map(r => ({
        Na: r.txn_no, Tarehe: r.txn_date, Mlipaji: r.payer_name, Familia: r.family_name, Aina: r.category_name, Kampeni: r.campaign_name, Jumuiya: r.jumuiya_name,
        Kigango: r.kigango_name, Kiasi: Number(r.net_amount), Njia: P.METHODS[r.payment_method], Kumbukumbu: r.reference_no, Risiti: r.receipt_no || r.legacy_receipt_no, Hali: r.status })) }));
    },
  };

  /* ================= ZAKA — Vigango → Kigango → Jumuiya → Familia =================
     One line per unit at each level (Januari–Desemba); click to go one level down.
     The last step opens the family, where each member's zaka is filled in. */
  V.zaka = {
    title: 'Zaka', perm: 'finance.read',
    async render(el, params) {
      const year = P.year();
      const scoped = P.scopeUnit() ? P.ref.unitsById[P.scopeUnit()] : null;
      const at = { k: params.k || '', j: params.j || '' };
      if (scoped && !params.k) {
        if (scoped.unit_type === 'kigango') at.k = scoped.id;
        if (scoped.unit_type === 'jumuiya') { at.k = P.kigangoOf(scoped.id)?.id || ''; at.j = scoped.id; }
      }
      const link = o => '#/zaka?' + new URLSearchParams(Object.entries({ ...at, ...o }).filter(([, v]) => v)).toString();
      const level = !at.k ? 'kigango' : !at.j ? 'jumuiya' : 'family';
      const scope = at.j || at.k || null;
      const crumbs = [{ label: 'Vigango vyote', href: link({ k: '', j: '' }) }];
      if (at.k) crumbs.push({ label: `Kigango cha ${P.ref.unitsById[at.k]?.name || ''}`, href: link({ j: '' }) });
      if (at.j) crumbs.push({ label: `Jumuiya ya ${P.ref.unitsById[at.j]?.name || ''}` });
      const LBL = { kigango: ['Kigango', 'Parokiani (zaka iliyolipwa parokiani moja kwa moja)'], jumuiya: ['Jumuiya', 'Kigango chenyewe (si kupitia jumuiya)'],
        family: ['Familia', 'Jumuiya yenyewe (jumla iliyowasilishwa na jumuiya)'] };
      el.innerHTML = `
        ${P.crumbs(crumbs.map((c, i) => i === crumbs.length - 1 ? { label: c.label } : c))}
        <div class="pm-head"><div><h1 class="pm-h1">Zaka ${year}${crumbs.length > 1 ? ' — ' + P.esc(crumbs[crumbs.length - 1].label) : ''}</h1>
          <p class="pm-muted">${level === 'family' ? 'Bonyeza familia kufungua wanafamilia na kujaza zaka yao.' : `Bonyeza ${LBL[level][0].toLowerCase()} kuingia ndani zaidi.`} Mwaka unabadilishwa juu kabisa.</p></div>
          <div class="pm-actions">${at.j ? `<a class="pm-btn pm-btn--primary" href="#/jumuiya?id=${at.j}&tab=zaka"><span class="material-symbols-outlined">edit_calendar</span>Jaza zaka ya jumuiya hii</a>` : ''}
          <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button><button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <div data-out>${P.loading()}</div>`;
      const [rows, members] = await Promise.all([P.rpc('zaka_grid_tree', { p_year: year, p_level: level, p_scope: scope }), P.levelMembers(level, scope)]);
      const mk = i => `m${String(i + 1).padStart(2, '0')}`;
      const itself = rows.find(r => !r.group_id);
      const byId = Object.fromEntries(rows.filter(r => r.group_id).map(r => [r.group_id, r]));
      const known = new Set(members.map(m => m.id));
      const list = P.levelSort(level, [...members.map(m => ({ total: 0, ...(byId[m.id] || {}), group_id: m.id, group_name: m.name, code: m.code })),
        ...rows.filter(r => r.group_id && !known.has(r.group_id))]);
      if (itself) list.unshift({ ...itself, group_name: LBL[level][1], self: true });
      const go = r => r.self ? null : level === 'kigango' ? link({ k: r.group_id }) : level === 'jumuiya' ? link({ j: r.group_id }) : `#/family?id=${r.group_id}`;
      const mcols = P.MONTHS.map((m, i) => ({ key: mk(i), label: m, fmt: v => Number(v) ? P.num(v) : '', cls: 'pm-num' }));
      const foot = Object.fromEntries(mcols.map(c => [c.key, P.num(P.sum(list, c.key))]));
      foot.total = `<b>${P.num(P.sum(list, 'total'))}</b>`; foot.group_name = '<b>JUMLA</b>';
      el.querySelector('[data-out]').innerHTML = P.reportHeader(`Zaka ${year}`, crumbs.map(c => c.label).join(' › ')) +
        `<p class="pm-muted pm-small">${list.filter(r => !r.self).length} ${LBL[level][0].toLowerCase()} (${list.filter(r => !r.self && Number(r.total)).length} zenye zaka) · Jumla <b>${P.tzs(P.sum(list, 'total'))}</b></p>` +
        P.table(list, [
          { key: 'group_name', label: LBL[level][0], html: r => go(r) ? `<a class="pm-link" href="${go(r)}">${P.esc(r.group_name || '—')}</a>` : `<span class="pm-muted">${P.esc(r.group_name)}</span>` },
          ...mcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' },
          ...(level === 'family' ? [] : [{ key: 'months_unpaid', label: 'Miezi bila zaka', html: r => r.self ? '' : r.months_unpaid ?? (Number(r.total) ? 0 : '—'), cls: 'pm-num' }]),
          { key: 'group_id', label: '', html: r => go(r) ? `<a class="pm-btn pm-btn--sm" href="${go(r)}">Fungua</a>` : '' }],
          { foot, cls: 'pm-keep-table', empty: level === 'family' ? 'Hakuna zaka iliyolipwa kwa jina la familia mwaka huu — fungua "Jaza zaka ya jumuiya hii".' : 'Hakuna zaka iliyorekodiwa.' });
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Zaka ${year}`));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`zaka_${year}`, { Zaka: list.map(r => ({
        [LBL[level][0]]: r.group_name, ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(r[mk(i)]) || 0])), Jumla: Number(r.total) })) }));
    },
  };

  /* ================= MICHANGO NA KAMPENI (kanuni za kila mwaka) ================= */
  const KTABS = [['', 'Zote'], ['mavuno', 'Mavuno'], ['ujenzi', 'Ujenzi'], ['special', 'Maalumu'], ['other', 'Mingine']];
  const kindOf = k => ['mavuno', 'ujenzi', 'special'].includes(k) ? k : 'other';
  /* ---- contribution rules form: shows only what the choices need ----
     who gives → how the amount is set → (only for "kupangiwa") the amount, or for
     "kila muumini" a tick per relationship with its own amount.
     "How often" and the rarely used fields sit under "Mipangilio zaidi". */
  const RELS = [['BABA', 'Baba'], ['MAMA', 'Mama'], ['MTOTO', 'Mtoto'], ['MJUKUU', 'Mjukuu'], ['WENGINE', 'Wengine']];
  const relLabel = k => (RELS.find(r => r[0] === k) || [k, k.charAt(0) + k.slice(1).toLowerCase()])[1];
  P.ratesText = r => Object.entries(r || {}).map(([k, v]) => `${relLabel(k)} ${P.num(v)}`).join(' · ');
  const relValues = rates => {
    const r = { ...(rates || {}) };
    if (r.WENGINE == null) { const other = Object.keys(r).find(k => !RELS.some(x => x[0] === k)); if (other) r.WENGINE = r[other]; }
    return r;
  };
  const rulesForm = (c = {}, more = '') => {
    const giver = c.giver_level === undefined ? 'family' : (c.giver_level || '');
    const mode = c.amount_mode || 'assigned';
    const rv = relValues(c.relation_rates);
    const opt = (list, sel) => list.map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
    return `<div class="pm-span2 pm-rulesform" data-rules>
      <div class="pm-form">
        <label>Nani anatoa<select name="giver_level" data-r-giver>${opt([['family', 'Kila familia'], ['parishioner', 'Kila muumini'], ['jumuiya', 'Kila jumuiya'], ['kigango', 'Kila kigango'], ['', 'Yeyote anayetaka (kama sadaka)']], giver)}</select></label>
        <label data-r-modewrap>Kiasi kinapatikanaje<select name="amount_mode" data-r-mode>${opt([['assigned', 'Kupangiwa — parokia inaweka kiasi'], ['pledge', 'Ahadi — kila mmoja anaahidi chake'], ['free', 'Hiari — anatoa anachoweza']], mode)}</select></label>
        <label class="pm-span2" data-r-flat><span data-r-flatlabel>Kiasi kwa kila familia (TZS)</span><input name="default_amount" type="number" min="1" inputmode="numeric" value="${c.default_amount ?? ''}" placeholder="mf. 100000"></label>
      </div>
      <div class="pm-relbox" data-r-rel>
        <p class="pm-small"><b>Nani kwenye familia analipa, na kiasi gani?</b> Weka alama ✓ kwa wanaolipa.</p>
        <label class="pm-relrow pm-relall"><input type="checkbox" data-r-all> <b>Wote</b></label>
        ${RELS.map(([k, l]) => `<div class="pm-relrow"><label><input type="checkbox" name="rel_${k}" value="1" data-r-tick ${rv[k] != null ? 'checked' : ''}> ${l}</label>
          <input type="number" name="amt_${k}" min="1" inputmode="numeric" placeholder="Kiasi (TZS)" data-r-amt value="${rv[k] ?? ''}"></div>`).join('')}
        <small class="pm-muted">Wengine = bibi, babu, kaka, dada… na wasioandikwa uhusiano kwenye rejista.</small>
      </div>
      <p class="pm-small pm-muted" data-r-hint></p>
      <details class="pm-more"><summary>Mipangilio zaidi</summary><div class="pm-form">
        <label>Mara ngapi<select name="frequency">${opt([['yearly', 'Kwa mwaka (kawaida)'], ['monthly', 'Kila mwezi']], c.frequency || 'yearly')}</select></label>
        ${more}</div></details>
    </div>`;
  };
  const wireRules = root => {
    const g = root.querySelector('[data-r-giver]'), m = root.querySelector('[data-r-mode]');
    if (!g) return;
    const ticks = [...root.querySelectorAll('[data-r-tick]')], all = root.querySelector('[data-r-all]');
    const amt = t => root.querySelector(`[name="amt_${t.name.slice(4)}"]`);
    const show = (sel, on) => root.querySelectorAll(sel).forEach(x => { x.hidden = !on; });
    const HINT = {
      assigned: { family: 'Kila familia itapangiwa kiasi hiki. Tumia "Pangia wote", au pangia familia moja moja ndani ya familia yake.',
        parishioner: 'Kila muumini aliyewekewa alama atapangiwa kiasi chake. Wasiowekewa alama hawapangiwi.',
        jumuiya: 'Kila jumuiya itapangiwa kiasi hiki; asilimia inahesabiwa jumuiya inapolipa.', kigango: 'Kila kigango kitapangiwa kiasi hiki.' },
      pledge: 'Kila mmoja ataahidi kiasi chake; mfumo utahesabu alicholipa na kilichobaki.',
      free: 'Hakuna deni — mfumo unarekodi tu kilichotolewa.', none: 'Mtu yeyote anatoa anachoweza, kama sadaka — hakuna kupangiwa wala deni.' };
    const sync = () => {
      const giver = g.value, assigned = !!giver && m.value === 'assigned';
      show('[data-r-modewrap]', !!giver);
      show('[data-r-flat]', assigned && giver !== 'parishioner');
      show('[data-r-rel]', assigned && giver === 'parishioner');
      const lbl = root.querySelector('[data-r-flatlabel]');
      if (lbl) lbl.textContent = `Kiasi kwa ${({ family: 'kila familia', jumuiya: 'kila jumuiya', kigango: 'kila kigango' })[giver] || 'kila mmoja'} (TZS)`;
      ticks.forEach(t => { amt(t).disabled = !t.checked; });
      if (all) all.checked = ticks.every(t => t.checked);
      root.querySelector('[data-r-hint]').textContent = !giver ? HINT.none : m.value === 'assigned' ? HINT.assigned[giver] : HINT[m.value];
    };
    g.addEventListener('change', sync); m.addEventListener('change', sync);
    ticks.forEach(t => t.addEventListener('change', () => { if (t.checked) { const a = amt(t); setTimeout(() => a.focus(), 20); } sync(); }));
    all && all.addEventListener('change', () => {
      const first = ticks.map(amt).find(a => a.value)?.value || '';
      ticks.forEach(t => { t.checked = all.checked; if (all.checked && !amt(t).value) amt(t).value = first; });
      sync();
    });
    sync();
  };
  const rulesRow = v => {
    const giver = v.giver_level || null;
    const mode = giver ? (v.amount_mode || 'pledge') : 'free';
    const rates = {};
    if (mode === 'assigned' && giver === 'parishioner') RELS.forEach(([k]) => { if (v[`rel_${k}`] && Number(v[`amt_${k}`]) > 0) rates[k] = Number(v[`amt_${k}`]); });
    return { giver_level: giver, amount_mode: mode, frequency: v.frequency || 'yearly', relation_rates: rates,
      default_amount: mode === 'assigned' && giver && giver !== 'parishioner' && Number(v.default_amount) > 0 ? Number(v.default_amount) : null };
  };
  const rulesProblem = v => {
    const r = rulesRow(v);
    if (r.amount_mode === 'assigned' && r.giver_level === 'parishioner' && !Object.keys(r.relation_rates).length) return 'Weka alama ✓ kwa angalau mmoja (mf. Baba) na uandike kiasi chake.';
    return null;
  };
  // ask again until the rules make sense
  const rulesModal = async opts => {
    for (;;) {
      const v = await P.modal({ ...opts, onOpen: m => { wireRules(m); opts.onOpen && opts.onOpen(m); } });
      if (!v) return null;
      const err = rulesProblem(v);
      if (!err) return v;
      Toast.error(err);
    }
  };

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
        ${sel ? `<section class="pm-card"><div class="pm-row"><div><h3 class="pm-h3">${P.esc(sel.name)} — ${params.k ? `Kigango cha ${P.esc(P.ref.unitsById[params.k]?.name || '')}` : 'vigango vyote'}</h3>${P.rulesBadges(sel)}</div>
          <div class="pm-actions">${P.can('finance.pledge') && sel.giver_level && sel.amount_mode === 'assigned' ? '<button class="pm-btn pm-btn--sm" data-assign>Pangia wote (parokia nzima)</button>' : ''}
          ${cfg ? `<button class="pm-btn pm-btn--sm" data-target="${sel.campaign_id}">Weka lengo</button>` : ''}
          <button class="pm-btn pm-btn--sm" data-print>Chapa</button><button class="pm-btn pm-btn--sm" data-xls>Excel</button></div></div>
          <div data-org>${P.loading()}</div></section>` : `<p class="pm-muted pm-small">Bonyeza jina la mchango kuona vigango → jumuiya → familia.</p>`}
        ${sel ? '<h3 class="pm-h3 mt-4">Michango yote ya mwaka</h3>' : ''}<section class="pm-card">${P.table(list, [
          { key: 'name', label: 'Mchango', html: r => `<a class="pm-link" href="#/campaigns?kind=${kind}&id=${r.campaign_id}">${P.esc(r.name)}</a><br><small class="pm-muted">${P.esc(r.category_name)}</small>` },
          { key: 'rules', label: 'Kanuni', html: r => P.rulesBadges(r) },
          { key: 'target', label: 'Lengo', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'pledged', label: 'Pangiwa/Ahadi', fmt: P.tzs, cls: 'pm-num' }, { key: 'collected', label: 'Imekusanywa', fmt: P.tzs, cls: 'pm-num pm-strong' },
          { key: 'outstanding_pledges', label: 'Bado', fmt: v => Number(v) ? `<span class="pm-due">${P.tzs(v)}</span>` : '—', cls: 'pm-num' },
          { key: 'payers', label: 'Walipaji', cls: 'pm-num' },
          { key: 'campaign_id', label: '', html: r => cfg ? `<button class="pm-btn pm-btn--sm" data-rules="${r.campaign_id}">Kanuni</button>` : '' }],
          { empty: `Hakuna michango ya mwaka ${year}${missing.length ? ' — bonyeza "Anzisha" kunakili ya mwaka uliopita.' : '.'}` })}
          ${hidden && !params.all ? `<p class="pm-small pm-muted">${hidden} michango haijapangiwa wala kulipwa mwaka huu — <a class="pm-link" href="#/campaigns?kind=${kind}&all=1">ionyeshe</a>.</p>` : ''}</section>
`;
      el.querySelectorAll('[data-rules]').forEach(b => b.addEventListener('click', async () => {
        const c = rules[b.dataset.rules];
        const v = await rulesModal({ title: `Kanuni — ${c.name}`, body: `<div class="pm-form">${rulesForm(c)}</div>` });
        if (!v) return;
        await P.q(P.from('campaigns').update(rulesRow(v)).eq('id', c.id));
        await P.loadRef(true); Toast.success('Kanuni zimehifadhiwa.'); P.reload();
      }));
      if (sel) {
        // vigango first; a kigango opens its jumuiya; a jumuiya opens its own page (families)
        const lvl = params.k ? 'jumuiya' : 'kigango';
        let rows = await P.rpc('campaign_org_progress', { p_campaign: sel.campaign_id, p_level: lvl });
        if (params.k) rows = rows.filter(r => P.kigangoOf(r.org_unit_id)?.id === params.k);
        rows.sort((a, b) => P.unitOrder(a.org_unit_id) - P.unitOrder(b.org_unit_id));
        const here = `#/campaigns?kind=${kind}&id=${sel.campaign_id}`;
        const open = r => lvl === 'kigango' ? `${here}&k=${r.org_unit_id}` : `#/jumuiya?id=${r.org_unit_id}&tab=michango&campaign=${sel.campaign_id}`;
        const foot = { org_unit_name: '<b>JUMLA</b>', target: P.tzs(P.sum(rows, 'target')), pledged: P.tzs(P.sum(rows, 'pledged')), collected: `<b>${P.tzs(P.sum(rows, 'collected'))}</b>`, balance: P.tzs(P.sum(rows, 'balance')), excess: P.tzs(P.sum(rows, 'excess')) };
        el.querySelector('[data-org]').innerHTML = P.crumbs([{ label: 'Vigango vyote', href: here }, ...(params.k ? [{ label: `Kigango cha ${P.ref.unitsById[params.k]?.name || ''}` }] : [])].map((c, i, all) => i === all.length - 1 ? { label: c.label } : c)) +
          P.reportHeader(`Taarifa ya ${sel.name}`, params.k ? `Kigango cha ${P.ref.unitsById[params.k]?.name || ''}` : 'Vigango vyote') + P.table(rows, [
          { key: 'org_unit_name', label: lvl === 'kigango' ? 'Kigango' : 'Jumuiya', html: r => `<a class="pm-link" href="${open(r)}">${P.esc(r.org_unit_name)}</a>` },
          { key: 'target', label: 'Lengo / pangiwa', fmt: P.tzs, cls: 'pm-num' }, { key: 'pledged', label: 'Familia/waumini pangiwa', fmt: P.tzs, cls: 'pm-num' },
          { key: 'collected', label: 'Walichotoa', fmt: P.tzs, cls: 'pm-num pm-strong' }, { key: 'balance', label: 'Bado', fmt: P.tzs, cls: 'pm-num' },
          { key: 'pct', label: '%', html: r => r.pct === null ? '—' : `${P.pct(r.pct)} ${P.progress(r.pct)}` }, { key: 'payers', label: 'Walipaji', cls: 'pm-num' },
          { key: 'org_unit_id', label: '', html: r => `<a class="pm-btn pm-btn--sm" href="${open(r)}">Fungua</a>` }],
          { foot, empty: 'Hakuna aliyepangiwa wala kulipa mchango huu.' });
        el.querySelector('[data-print]').addEventListener('click', () => P.print(sel.name));
        el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(sel.name, { [lvl]: rows.map(r => ({ Kigango: r.kigango_name, Jina: r.org_unit_name, Lengo: Number(r.target), Pangiwa_Ahadi: Number(r.pledged), Walichotoa: Number(r.collected), Bado: Number(r.balance), Ziada: Number(r.excess), Asilimia: r.pct })) }));
        const ab = el.querySelector('[data-assign]');
        ab && ab.addEventListener('click', async () => {
          const v = await P.modal({ title: `Pangia wote — ${sel.name}`, submit: 'Pangia', body: `<p class="pm-muted">${P.RULES.LEVEL[sel.giver_level]} wa parokia nzima ambaye bado hajapangiwa wala kuahidi atapangiwa kiasi hiki${sel.frequency === 'monthly' ? ' (kila mwezi × 12)' : ''}. Waliokwisha pangiwa hawabadilishwi.</p>
            <div class="pm-form">${Object.keys(sel.relation_rates || {}).length
              ? `<p class="pm-span2"><b>Kwa kanuni:</b> ${P.esc(P.ratesText(sel.relation_rates))}</p>`
              : `<label>Kiasi<input name="amount" type="number" min="1" required value="${sel.default_amount || ''}"></label>`}
            <label>Ndani ya<select name="scope">${P.unitOptions(['kigango', 'jumuiya'], { blank: 'Parokia nzima' })}</select></label></div>` });
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
        const v = await rulesModal({ title: `Mchango mpya — ${year}`, wide: true, body: `<div class="pm-form">
          <label>Aina ya mchango<select name="category_id" required>${P.typeOptions(['mavuno', 'ujenzi', 'special', 'shukrani', 'sadaka', 'income_other'], { blank: 'Chagua…' })}</select></label>
          <label>Jina<input name="name" required placeholder="mf. Mavuno ${year}"></label>
          ${P.newTypeHtml()}
          ${rulesForm({}, `<label>Mwaka<input name="year" type="number" value="${year}" required></label>
            <label>Lengo la jumla la parokia (hiari)<input name="target" type="number" min="0"></label>
            <label>Unarudiwa kila mwaka?<select name="recurs"><option value="1">Ndiyo</option><option value="">Hapana, mara moja tu</option></select></label>
            <label class="pm-span2">Maelezo<input name="description"></label>`)}</div>`,
          onOpen: m => P.wireNewType(m, m.querySelector('[name=category_id]')) });
        if (!v) return;
        v.category_id = await P.resolveType(v);
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
