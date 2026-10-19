/* Minga Parish — Vigango → Kigango → Jumuiya → Familia → Muumini
   Everything is found AND filled in where it belongs: open a kigango, then a
   jumuiya, then a familia, and record zaka or a contribution right there.
   All figures are for the year chosen in the top bar. */
(function () {
  const P = window.Parish, V = P.views;
  const MODE = { assigned: 'Kupangiwa', pledge: 'Ahadi', free: 'Hiari' };
  const LEVEL = { parishioner: 'Kila muumini', family: 'Kila familia', jumuiya: 'Kila jumuiya', kigango: 'Kila kigango' };
  const FREQ = { yearly: 'Kwa mwaka', monthly: 'Kwa mwezi' };
  const MONTH_LONG = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
  P.RULES = { MODE, LEVEL, FREQ };
  const canRecord = () => P.can('finance.record');
  const canPledge = () => P.can('finance.pledge');
  const canWriteReg = () => P.access.platform_admin || (P.access.permissions || []).includes('registry.write');
  const due = v => Number(v) > 0 ? `<span class="pm-due">${P.tzs(v)}</span>` : '—';
  const mk = i => `m${String(i + 1).padStart(2, '0')}`;
  const zakaCat = () => P.ref.cats.find(c => c.code === 'ZAKA');
  const monthsDue = year => year < P.thisYear() ? 12 : year > P.thisYear() ? 0 : new Date().getMonth() + 1;
  const FAM_FK = 'families!parishioners_family_id_fkey';

  // the full payment form (any payer, any contribution), then refresh in place
  P.recordPayment = async (prefill = {}) => {
    const r = await P.paymentForm(prefill).catch(e => { Toast.error(P.friendlyError(e)); return null; });
    if (r && (r.status === 'posted' || r.status === 'already_posted')) {
      Toast.success(`Malipo yamehifadhiwa. Risiti ${r.receipt_no || ''}`);
      if (r.pledge && r.pledge.pledged) Toast.info(`Amelipa ${P.tzs(r.pledge.paid)} kati ya ${P.tzs(r.pledge.pledged)} — bado ${P.tzs(r.pledge.outstanding)}`);
      if (r.receipt_id) window.open(`receipt.html?id=${r.receipt_id}`, '_blank');
      P.refresh();
    }
  };

  /* Quick entry: who pays and for what is already known (e.g. clicking the
     March box of a parishioner's zaka) — only the amount is typed. */
  P.quickPay = async ({ title, sub = '', payer, payerName, category_id, campaign_id = null, period_month = null, amount = '' }) => {
    const key = P.uuid();
    const v = await P.modal({ title, submit: 'Hifadhi', body: `
      ${sub ? `<p class="pm-muted pm-small">${sub}</p>` : ''}
      <div class="pm-form">
        <label>Kiasi (TZS)<input name="amount" type="number" min="1" step="1" inputmode="numeric" required value="${amount || ''}"></label>
        <label>Tarehe ya kupokea<input name="txn_date" type="date" required value="${P.today()}"></label>
        <label>Njia ya malipo<select name="payment_method">${Object.entries(P.METHODS).filter(([k]) => k !== 'envelope').map(([k, x]) => `<option value="${k}">${x}</option>`).join('')}</select></label>
        <label>Namba ya kumbukumbu (hiari)<input name="reference_no" placeholder="mf. M-Pesa QJ7…"></label>
      </div>`,
      onOpen: m => setTimeout(() => m.querySelector('[name=amount]').focus(), 30) });
    if (!v) return null;
    const args = { idempotency_key: key, amount: Number(v.amount), txn_date: v.txn_date, category_id, campaign_id, payment_method: v.payment_method,
      reference_no: v.reference_no || null, period_month, payer_name: payerName, receiving_officer: P.profile.full_name || P.profile.email,
      [`${payer.kind}_id`]: payer.id };
    try {
      let r = await P.rpc('post_payment', { p: args });
      if (r.status === 'possible_duplicate') {
        const ok = await P.confirm('Huenda ni malipo yaliyorudiwa', `${r.message} (Muamala Na. ${r.existing_txn_no}). Bonyeza "Ndiyo, ni mapya" kama ni malipo mengine.`, 'Ndiyo, ni mapya');
        if (!ok) return null;
        r = await P.rpc('post_payment', { p: { ...args, confirm_duplicate: true } });
      }
      Toast.success(`${P.tzs(v.amount)} imehifadhiwa — ${payerName}. Risiti ${r.receipt_no || ''}`);
      P.refresh();
      return r;
    } catch (e) { Toast.error(P.friendlyError(e)); return null; }
  };

  // a zaka month box: shows what was paid, and opens quick entry when clicked
  const zakaBox = (val, i, months, data, track = true) => {
    const paid = Number(val) > 0;
    const cls = paid ? 'is-paid' : track && i < months ? 'is-due' : '';
    const txt = paid ? P.num(val) : track && i < months ? '·' : '';
    return canRecord() ? `<button type="button" class="pm-cell ${cls}" data-zk="${P.esc(JSON.stringify({ ...data, m: i }))}" title="Jaza zaka ya ${MONTH_LONG[i]}">${txt || '<span>+</span>'}</button>`
      : `<span class="pm-cell ${cls}">${txt}</span>`;
  };
  const wireZaka = (root, year) => root.querySelectorAll('[data-zk]').forEach(b => b.addEventListener('click', () => {
    const d = JSON.parse(b.dataset.zk);
    P.quickPay({ title: `Zaka ya ${MONTH_LONG[d.m]} ${year}`, sub: `<b>${P.esc(d.name)}</b>${d.where ? ' · ' + P.esc(d.where) : ''}`,
      payer: { kind: d.kind, id: d.id }, payerName: d.name, category_id: zakaCat()?.id, period_month: `${year}-${String(d.m + 1).padStart(2, '0')}-01` });
  }));

  // obligation label for a campaign's rules
  P.rulesBadges = c => !c ? '' : `<span class="pm-rules">${c.giver_level ? P.badge(LEVEL[c.giver_level], 'teal') : P.badge('Yeyote', 'muted')}
    ${P.badge(MODE[c.amount_mode] || 'Ahadi', c.amount_mode === 'assigned' ? 'gold' : 'muted')} ${P.badge(FREQ[c.frequency] || 'Kwa mwaka', 'muted')}
    ${c.default_amount ? P.badge(P.tzs(c.default_amount) + (c.frequency === 'monthly' ? ' / mwezi' : ''), 'muted') : ''}</span>`;

  /* ---------- what a jumuiya / kigango was assigned, paid and still owes ---------- */
  const whoPays = r => Number(r.target) > 0 ? P.badge(r.own_target ? 'Imepangiwa' : 'Jumuiya zimepangiwa', 'gold')
    : r.giver_level === 'family' ? P.badge('Kila familia', 'teal') : r.giver_level === 'parishioner' ? P.badge('Kila muumini', 'teal')
    : Number(r.pledged) > 0 ? P.badge('Ahadi', 'muted') : P.badge('Hiari', 'muted');
  const period = r => {
    const late = r.due_on && Number(r.balance) > 0 && String(r.due_on).slice(0, 10) < P.today();
    return `${r.starts_on ? P.date(r.starts_on) : ''}${r.due_on ? ` – ${P.date(r.due_on)}` : ''}${late ? '<br>' + P.badge('Muda umepita', 'rose') : ''}`;
  };
  const gave = r => Number(r.target) > 0 ? Number(r.collected) : Math.max(Number(r.paid), Number(r.collected));
  // notes written by the Excel import ("Imetoka MICHANGO-2026!row35") are for auditors, not for this page
  const note = n => (n || '').split('; ').filter(x => !/^Imetoka /.test(x)).join('; ');

  // assign a contribution to a jumuiya / kigango: what money, how much, from when, by when
  const targetForm = async (unit, year, row = null) => {
    const camps = P.ref.camps.filter(c => c.campaign_year === year && c.status !== 'closed' && P.ref.catsById[c.category_id]?.kind !== 'zaka');
    const children = unit.unit_type === 'kigango'
      ? P.ref.units.filter(u => u.is_active && u.parent_id === unit.id && ['jumuiya', 'group'].includes(u.unit_type)).sort((a, b) => P.unitOrder(a.id) - P.unitOrder(b.id) || a.name.localeCompare(b.name))
      : [];
    const v = await P.modal({ title: row ? `${row.campaign_name} — ${unit.name}` : `Pangia ${unit.unit_type === 'kigango' ? 'kigango cha' : 'jumuiya ya'} ${unit.name}`, wide: true, body: `
      <p class="pm-muted pm-small">Andika ni pesa ya nini, kiasi, na muda wa kulipa. Mfumo utahesabu kilicholipwa na asilimia kiotomatiki.</p>
      <div class="pm-form">
        ${row ? `<input type="hidden" name="campaign_id" value="${row.campaign_id}">` : `
        <label class="pm-span2">Ni pesa ya nini<select name="campaign_id" data-camp>${P.options(camps, { blank: '— Mchango mpya (andika jina chini) —' })}</select></label>
        <label data-new>Aina<select name="category_id"><option value="__new">+ Aina mpya ya mchango (jina hapo pembeni)</option>${P.catOptions(['mavuno', 'ujenzi', 'special', 'shukrani', 'sadaka', 'income_other'])}</select></label>
        <label data-new>Jina la mchango<input name="name" placeholder="mf. Ujenzi wa choo ${year}"></label>`}
        <label>Kiasi alichopangiwa (TZS)<input name="amount" type="number" min="0" required value="${row ? Number(row.target) || '' : ''}"></label>
        <label>Kuanzia<input name="starts_on" type="date" value="${row?.starts_on ? String(row.starts_on).slice(0, 10) : `${year}-01-01`}"></label>
        <label>Mwisho wa kulipa<input name="due_on" type="date" value="${row?.due_on ? String(row.due_on).slice(0, 10) : `${year}-12-31`}"></label>
        <label class="pm-span2">Maelezo (hiari)<input name="notes" value="${P.esc(note(row?.notes))}"></label>
        ${children.length ? `<label class="pm-span2 pm-relall"><input type="checkbox" name="distribute_to_jumuiya" value="true" data-distribute> Gawa kwa jumuiya zake</label>
        <div class="pm-span2" data-allocations hidden>
          <p class="pm-muted pm-small">Weka sehemu ya jumla kwa kila jumuiya. Jumla ya mgao isizidi kiasi cha kigango. Kiasi kilichobaki kitabaki kwa kigango chenyewe.</p>
          <div class="pm-form" data-allocation-list>${children.map(u => `<label>${P.esc(u.name)} (TZS)<input name="allocation_${u.id}" type="number" min="0" step="1" inputmode="numeric" data-allocation="${u.id}" value=""></label>`).join('')}</div>
          <small class="pm-muted" data-allocation-total></small>
        </div>` : ''}
      </div>${row ? '<p class="pm-small pm-muted">Weka kiasi 0 kuondoa mgao huu.</p>' : ''}`,
      onOpen: m => {
        const s = m.querySelector('[data-camp]');
        if (s) {
        const sync = () => m.querySelectorAll('[data-new]').forEach(x => { x.hidden = !!s.value; x.querySelectorAll('input').forEach(i => { i.required = !s.value; }); });
          s.addEventListener('change', sync); sync();
        }
        const toggle = m.querySelector('[data-distribute]');
        if (!toggle) return;
        const list = m.querySelector('[data-allocations]'), total = m.querySelector('[name=amount]'), summary = m.querySelector('[data-allocation-total]');
        const updateTotal = () => {
          const allocated = [...m.querySelectorAll('[data-allocation]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
          const limit = Number(total.value) || 0;
          summary.textContent = `Jumla ya jumuiya: ${P.tzs(allocated)} kati ya ${P.tzs(limit)}${allocated > limit ? ' — imezidi kiasi cha kigango.' : ''}`;
          summary.classList.toggle('pm-due', allocated > limit);
        };
        const loadExisting = async campaignId => {
          if (!campaignId) {
            toggle.checked = false;
            m.querySelectorAll('[data-allocation]').forEach(input => { input.value = ''; });
            list.hidden = true;
            updateTotal();
            return;
          }
          const ids = children.map(u => u.id);
          if (!ids.length) return;
          const rows = await P.q(P.from('kigango_target_allocations').select('jumuiya_id,amount').eq('campaign_id', campaignId).eq('kigango_id', unit.id));
          const byUnit = new Map(rows.map(x => [x.jumuiya_id, x]));
          m.querySelectorAll('[data-allocation]').forEach(input => {
            const child = byUnit.get(input.dataset.allocation);
            input.value = child ? Number(child.amount) : '';
          });
          toggle.checked = rows.length > 0;
          list.hidden = !toggle.checked;
          updateTotal();
        };
        toggle.addEventListener('change', () => { list.hidden = !toggle.checked; updateTotal(); });
        m.querySelectorAll('[data-allocation], [name=amount]').forEach(input => input.addEventListener('input', updateTotal));
        m.querySelector('form').addEventListener('submit', e => {
          if (!toggle.checked) return;
          const allocated = [...m.querySelectorAll('[data-allocation]')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
          if (allocated > (Number(total.value) || 0)) {
            e.preventDefault(); e.stopImmediatePropagation();
            Toast.error('Jumla ya mgao wa jumuiya haiwezi kuzidi kiasi cha kigango.');
          }
        }, true);
        const campaign = row?.campaign_id || s?.value;
        if (campaign) loadExisting(campaign).catch(e => Toast.error(P.friendlyError(e)));
        s && s.addEventListener('change', () => loadExisting(s.value).catch(e => Toast.error(P.friendlyError(e))));
      } });
    if (!v) return;
    if (!v.campaign_id && v.category_id === '__new') {
      // a brand-new contribution: its type takes the name given (without the year)
      v.new_type_name = String(v.name || '').replace(/\s*\b(19|20)\d\d\b\s*$/, '').trim();
      v.new_type_kind = 'special';
      v.category_id = await P.resolveType(v);
    }
    if (!v.campaign_id && !v.category_id) { Toast.error('Chagua mchango, au andika jina la mchango mpya.'); return; }
    const target = { org_unit_id: unit.id, campaign_id: v.campaign_id || null, category_id: v.category_id || null, name: v.name || null, year,
      amount: Number(v.amount) || 0, starts_on: v.starts_on || null, due_on: v.due_on || null, notes: v.notes || null };
    if (children.length) {
      target.distribute_to_jumuiya = v.distribute_to_jumuiya === 'true';
      target.allocations = children.map(u => ({ org_unit_id: u.id, amount: Number(v[`allocation_${u.id}`]) || 0 }));
      await P.rpc('set_kigango_targets', { p: target });
    } else await P.rpc('set_unit_target', { p: target });
    if (!v.campaign_id) await P.loadRef(true);
    Toast.success('Imehifadhiwa.'); P.refresh();
  };

  P.targetForm = (...a) => targetForm(...a);
  // table of contributions for one unit (used on the jumuiya and kigango pages)
  const contribTable = (rows, unit, opts = {}) => {
    const foot = { campaign_name: '<b>JUMLA</b>', obligation: P.tzs(P.sum(rows, 'obligation')), gave: `<b>${P.tzs(rows.reduce((s, r) => s + gave(r), 0))}</b>`, balance: P.tzs(P.sum(rows, 'balance')) };
    return P.table(rows, [
      { key: 'campaign_name', label: 'Mchango (pesa ya nini)', html: r => `<a class="pm-link" href="${opts.link ? opts.link(r) : '#/mchango?id=' + r.campaign_id}"><b>${P.esc(r.campaign_name)}</b></a>${note(r.notes) ? `<br><small class="pm-muted">${P.esc(note(r.notes))}</small>` : ''}` },
      { key: 'who', label: 'Nani analipa', html: whoPays },
      { key: 'period', label: 'Muda', html: period },
      { key: 'obligation', label: 'Kiasi', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
      { key: 'gave', label: 'Ametoa', html: r => P.tzs(gave(r)), cls: 'pm-num pm-strong' },
      { key: 'balance', label: 'Bado', html: r => due(r.balance), cls: 'pm-num' },
      { key: 'pct', label: '%', html: r => r.pct === null ? '—' : `${P.pct(r.pct)} ${P.progress(r.pct)}` },
      { key: 'campaign_id', label: '', html: r => opts.actions ? opts.actions(r) : '' }],
      { foot, empty: opts.empty || 'Hakuna mchango uliopangwa wala kulipwa mwaka huu.' });
  };

  /* ================= VIGANGO (all) ================= */
  V.units = {
    title: 'Vigango na Jumuiya',
    async render(el) {
      const own = P.scopeUnit() && P.ref.unitsById[P.scopeUnit()];
      if (own && (own.unit_type === 'kigango' || own.unit_type === 'jumuiya')) { P.go(`#/${own.unit_type}?id=${own.id}`); return; }
      const year = P.year();
      const rows = await P.rpc('unit_summary', { p_year: year, p_parent: null });
      const tot = k => P.sum(rows, k);
      el.innerHTML = `
        ${P.crumbs([{ label: 'Vigango na Jumuiya' }])}
        <div class="pm-head"><div><h1 class="pm-h1">Vigango na Jumuiya</h1>
          <p class="pm-muted">Chagua kigango → jumuiya → familia. Zaka na michango vinajazwa humo humo. Mwaka ${year}.</p></div>
          <div class="pm-actions"><button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <section class="pm-kpis">
          ${P.kpi('Vigango', P.num(rows.length), 'account_tree')}
          ${P.kpi('Familia', P.num(tot('families')), 'family_restroom')}
          ${P.kpi('Waumini', P.num(tot('parishioners')), 'groups')}
          ${P.kpi(`Makusanyo ya vigango ${year}`, P.tzs(tot('income')), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Waliyopangiwa', P.tzs(tot('pledged')), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(tot('outstanding')), 'pending_actions', 'pm-kpi--rose')}
        </section>
        <section class="pm-units">${rows.map(k => {
          const nJ = P.ref.units.filter(u => u.parent_id === k.unit_id && u.unit_type === 'jumuiya' && u.is_active).length;
          const pct = Number(k.pledged) ? Math.round(Number(k.paid) / Number(k.pledged) * 100) : null;
          return `<a class="pm-unit" href="#/kigango?id=${k.unit_id}">
            <h3>${P.esc(k.unit_name)}<span class="material-symbols-outlined">chevron_right</span></h3>
            <small>${nJ} jumuiya · ${P.num(k.families)} familia · ${P.num(k.parishioners)} waumini</small>
            <dl><dt>Makusanyo ${year}</dt><dd>${P.tzs(k.income)}</dd>
              <dt>Zaka</dt><dd>${P.tzs(k.zaka)}</dd><dt>Mavuno</dt><dd>${P.tzs(k.mavuno)}</dd><dt>Ujenzi</dt><dd>${P.tzs(k.ujenzi)}</dd>
              <dt>Bado kulipwa</dt><dd class="${Number(k.outstanding) ? 'is-due' : ''}">${P.tzs(k.outstanding)}</dd></dl>
            ${pct !== null ? `${P.progress(pct)}<small>${pct}% ya walichopangiwa imelipwa</small>` : ''}</a>`;
        }).join('')}</section>`;
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Vigango ${year}`));
    },
  };

  /* ================= KIGANGO ================= */
  V.kigango = {
    title: 'Kigango',
    async render(el, params) {
      const k = P.ref.unitsById[params.id];
      if (!k) { el.innerHTML = P.empty('Kigango hakipo.'); return; }
      const year = P.year();
      const [rows, contrib, recent] = await Promise.all([
        P.rpc('unit_summary', { p_year: year, p_parent: k.id }),
        P.rpc('unit_contributions', { p_year: year, p_unit: k.id }),
        P.q(P.from('v_ledger').select('*').eq('org_unit_id', k.id).eq('status', 'posted').gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).order('txn_date', { ascending: false }).limit(50)),
      ]);
      const own = P.sum(recent, 'net_amount');
      const s = key => P.sum(rows, key);
      const foot = { unit_name: '<b>JUMLA</b>', families: P.num(s('families')), parishioners: P.num(s('parishioners')), zaka: P.tzs(s('zaka')), mavuno: P.tzs(s('mavuno')),
        ujenzi: P.tzs(s('ujenzi')), income: `<b>${P.tzs(s('income'))}</b>`, pledged: P.tzs(s('pledged')), outstanding: P.tzs(s('outstanding')) };
      el.innerHTML = `
        ${P.unitCrumbs(k.id)}
        <div class="pm-head"><div><p class="pm-eyebrow">Kigango</p><h1 class="pm-h1">${P.esc(k.name)}</h1>
          <p class="pm-muted">${rows.length} jumuiya · ${P.num(s('families'))} familia · ${P.num(s('parishioners'))} waumini · Mwaka ${year}</p></div>
          <div class="pm-actions">${canPledge() ? '<button class="pm-btn" data-target><span class="material-symbols-outlined">assignment_add</span>Pangia kigango</button>' : ''}
            ${canRecord() ? '<button class="pm-btn pm-btn--primary" data-pay><span class="material-symbols-outlined">add</span>Malipo ya kigango</button>' : ''}
            <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button>
            <button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <section class="pm-kpis">
          ${P.kpi(`Makusanyo ${year}`, P.tzs(s('income') + own), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Zaka', P.tzs(s('zaka')), 'calendar_month')}
          ${P.kpi('Mavuno', P.tzs(s('mavuno')), 'agriculture')}
          ${P.kpi('Ujenzi', P.tzs(s('ujenzi')), 'construction')}
          ${P.kpi('Waliyopangiwa', P.tzs(s('pledged')), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(s('outstanding')), 'pending_actions', 'pm-kpi--rose')}
        </section>
        ${P.reportHeader(`Kigango cha ${k.name} — ${year}`)}
        <section class="pm-card"><h3 class="pm-h3">Jumuiya za kigango hiki <small class="pm-muted">— bonyeza jumuiya kuingia ndani</small></h3>
          ${P.table(rows, [
            { key: 'unit_name', label: 'Jumuiya', html: r => `<a class="pm-link" href="#/jumuiya?id=${r.unit_id}">${P.esc(r.unit_name)}</a>` },
            { key: 'families', label: 'Familia', fmt: P.num, cls: 'pm-num' }, { key: 'parishioners', label: 'Waumini', fmt: P.num, cls: 'pm-num' },
            { key: 'zaka', label: 'Zaka', fmt: P.tzs, cls: 'pm-num' }, { key: 'mavuno', label: 'Mavuno', fmt: P.tzs, cls: 'pm-num' },
            { key: 'ujenzi', label: 'Ujenzi', fmt: P.tzs, cls: 'pm-num' },
            { key: 'income', label: 'Makusanyo yote', fmt: P.tzs, cls: 'pm-num pm-strong' },
            { key: 'pledged', label: 'Pangiwa', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Bado', html: r => due(r.outstanding), cls: 'pm-num' },
            { key: 'pct', label: '%', html: r => Number(r.pledged) ? `${P.pct(Number(r.paid) / Number(r.pledged) * 100)} ${P.progress(Number(r.paid) / Number(r.pledged) * 100)}` : '—' }],
            { foot, empty: 'Kigango hiki hakina jumuiya bado.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Michango ${year} — kigango chote</h3>
          ${contribTable(contrib, k, { link: r => `#/mchango?id=${r.campaign_id}&k=${k.id}`, actions: r => r.own_target && canPledge() ? `<button class="pm-btn pm-btn--sm" data-edit="${r.campaign_id}">Badilisha</button>` : '' })}</section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Malipo ya kigango chenyewe ${year}</h3><small class="pm-muted">${P.tzs(own)}</small></div>
          ${P.table(recent, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina' },
            { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>` : (r.legacy_receipt_no ? `Excel #${P.esc(r.legacy_receipt_no)}` : '—') }],
            { empty: 'Hakuna malipo ya kigango chenyewe mwaka huu.' })}</section>`;
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Kigango ${k.name} ${year}`));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`kigango_${k.name}_${year}`, {
        Jumuiya: rows.map(r => ({ Jumuiya: r.unit_name, Familia: Number(r.families), Waumini: Number(r.parishioners), Zaka: Number(r.zaka), Mavuno: Number(r.mavuno), Ujenzi: Number(r.ujenzi),
          Makusanyo: Number(r.income), Pangiwa: Number(r.pledged), Bado: Number(r.outstanding) })),
        Michango: contrib.map(r => ({ Mchango: r.campaign_name, Kiasi: Number(r.obligation), Ametoa: gave(r), Bado: Number(r.balance), Asilimia: r.pct })) }));
      const pay = el.querySelector('[data-pay]');
      pay && pay.addEventListener('click', () => P.recordPayment({ org_unit_id: k.id }));
      const tb = el.querySelector('[data-target]');
      tb && tb.addEventListener('click', () => targetForm(k, year));
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => targetForm(k, year, contrib.find(r => r.campaign_id === b.dataset.edit))));
    },
  };

  /* ================= JUMUIYA (tabs) ================= */
  const TABS = [['familia', 'Familia', 'family_restroom'], ['zaka', 'Zaka', 'calendar_month'], ['michango', 'Michango', 'volunteer_activism'],
    ['miamala', 'Miamala', 'point_of_sale'], ['muhtasari', 'Muhtasari', 'dashboard']];

  V.jumuiya = {
    title: 'Jumuiya',
    async render(el, params) {
      const j = P.ref.unitsById[params.id];
      if (!j) { el.innerHTML = P.empty('Jumuiya haipo.'); return; }
      const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'familia';
      const year = P.year();
      el.innerHTML = `
        ${P.unitCrumbs(j.id)}
        <div class="pm-head"><div><p class="pm-eyebrow">Jumuiya · Kigango cha ${P.esc(P.kigangoOf(j.id)?.name || '')}</p><h1 class="pm-h1">${P.esc(j.name)}</h1>
          <p class="pm-muted">Mwaka ${year}</p></div>
          <div class="pm-actions">${canWriteReg() ? '<button class="pm-btn" data-newfam><span class="material-symbols-outlined">add</span>Familia mpya</button>' : ''}
            <button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <nav class="pm-tabs">${TABS.map(([k, l, i]) => `<a href="#/jumuiya?id=${j.id}&tab=${k}" class="${k === tab ? 'is-active' : ''}"><span class="material-symbols-outlined">${i}</span>${l}</a>`).join('')}</nav>
        ${P.reportHeader(`Jumuiya ya ${j.name} — ${TABS.find(t => t[0] === tab)[1]} ${year}`, `Kigango cha ${P.kigangoOf(j.id)?.name || ''}`)}
        <div data-tab>${P.loading()}</div>`;
      const nf = el.querySelector('[data-newfam]');
      nf && nf.addEventListener('click', () => P.famForm(null, { jumuiya: j.id }));
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Jumuiya ${j.name} ${year}`));
      await JTABS[tab](el.querySelector('[data-tab]'), j, year, params);
    },
  };

  const JTABS = {
    /* families with their zaka and Mavuno / Ujenzi — like the register in the workbook */
    async familia(box, j, year) {
      const [fams, people, pl] = await Promise.all([
        P.rpc('family_summary', { p_year: year, p_jumuiya: j.id }),
        P.q(P.from('parishioners').select('id,full_name,family_id').eq('jumuiya_id', j.id).eq('membership_status', 'active').order('full_name').limit(2000)),
        P.q(P.from('v_pledge_balances').select('family_id,parishioner_id,category_code,pledged,paid,outstanding').eq('jumuiya_id', j.id).eq('campaign_year', year).eq('status', 'active').limit(5000)),
      ]);
      const famOf = Object.fromEntries(people.map(p => [p.id, p.family_id]));
      const byFam = {};
      people.forEach(p => { (byFam[p.family_id] ||= []).push(p); });
      const ob = {};
      pl.forEach(p => { const f = p.family_id || famOf[p.parishioner_id]; if (!f) return;
        const code = ['MAVUNO', 'UJENZI'].includes(p.category_code) ? p.category_code : 'OTHER';
        const x = (ob[f] ||= {})[code] ||= { pledged: 0, paid: 0, outstanding: 0 };
        x.pledged += Number(p.pledged); x.paid += Number(p.paid); x.outstanding += Number(p.outstanding); });
      const rows = fams.map(f => {
        const o = ob[f.family_id] || {};
        return { ...f, mav_p: o.MAVUNO?.pledged || 0, mav_t: o.MAVUNO?.paid || 0, mav_b: o.MAVUNO?.outstanding || 0,
          uje_p: o.UJENZI?.pledged || 0, uje_t: o.UJENZI?.paid || 0, uje_b: o.UJENZI?.outstanding || 0 };
      });
      const money = v => Number(v) ? P.num(v) : '—';
      const foot = { family_name: '<b>JUMLA</b>', members: P.num(P.sum(rows, 'members')), zaka: `<b>${P.num(P.sum(rows, 'zaka'))}</b>`,
        mav_p: P.num(P.sum(rows, 'mav_p')), mav_t: P.num(P.sum(rows, 'mav_t')), mav_b: P.num(P.sum(rows, 'mav_b')),
        uje_p: P.num(P.sum(rows, 'uje_p')), uje_t: P.num(P.sum(rows, 'uje_t')), uje_b: P.num(P.sum(rows, 'uje_b')) };
      box.innerHTML = `<p class="pm-muted pm-small">${rows.length} familia · ${people.length} waumini. <b>Bonyeza familia</b> kuona wanafamilia na kujaza zaka na michango yao.</p>` +
        P.table(rows, [
          { key: 'family_code', label: 'Na.' },
          { key: 'family_name', label: 'Familia', html: f => `<a class="pm-link" href="#/family?id=${f.family_id}">${P.esc(f.family_name)}</a>
              <br><small class="pm-muted">${(byFam[f.family_id] || []).map(p => P.esc(p.full_name.split(' ')[0])).join(', ')}</small>` },
          { key: 'members', label: 'Watu', cls: 'pm-num' },
          { key: 'zaka', label: `Zaka ${year}`, fmt: money, cls: 'pm-num pm-strong' },
          { key: 'mav_p', label: 'Mavuno pangiwa', fmt: money, cls: 'pm-num' }, { key: 'mav_t', label: 'Toa', fmt: money, cls: 'pm-num' },
          { key: 'mav_b', label: 'Bado', fmt: v => Number(v) ? `<span class="pm-due">${P.num(v)}</span>` : '—', cls: 'pm-num' },
          { key: 'uje_p', label: 'Ujenzi pangiwa', fmt: money, cls: 'pm-num' }, { key: 'uje_t', label: 'Toa', fmt: money, cls: 'pm-num' },
          { key: 'uje_b', label: 'Bado', fmt: v => Number(v) ? `<span class="pm-due">${P.num(v)}</span>` : '—', cls: 'pm-num' },
          { key: 'family_id', label: '', html: f => `<a class="pm-btn pm-btn--sm" href="#/family?id=${f.family_id}">Fungua</a>` }],
          { foot, empty: 'Jumuiya hii haina familia bado.' });
    },

    /* zaka: the jumuiya's monthly total (as the workbook records it) and every
       zaka payer by family — click a month box to fill it in */
    async zaka(box, j, year) {
      const [tot, grid, people] = await Promise.all([
        P.rpc('zaka_grid_tree', { p_year: year, p_level: 'jumuiya', p_scope: j.id }),
        P.rpc('zaka_grid_tree', { p_year: year, p_level: 'parishioner', p_scope: j.id }),
        P.q(P.from('parishioners').select(`id,full_name,family_id,is_zaka_payer,${FAM_FK}(family_name,family_code)`).eq('jumuiya_id', j.id).eq('membership_status', 'active').limit(2000)),
      ]);
      const months = monthsDue(year);
      const all = tot.find(r => r.group_id === j.id) || { total: 0 };
      const byName = grid.filter(r => r.group_id);
      const g = Object.fromEntries(byName.map(r => [r.group_id, r]));
      const track = byName.length > 0;     // this jumuiya records zaka by name
      const rows = people.filter(p => p.is_zaka_payer || g[p.id]).map(p => {
        const r = g[p.id] || {};
        const fam = p.families || {};
        return { ...r, id: p.id, name: p.full_name, family_id: p.family_id, family: fam.family_name || '—', code: fam.family_code || '', total: Number(r.total || 0),
          months_unpaid: P.MONTHS.filter((m, i) => i < months && !(Number(r[mk(i)]) > 0)).length };
      });
      const jcols = P.MONTHS.map((m, i) => ({ key: mk(i), label: m, cls: 'pm-num pm-cellcol',
        html: r => zakaBox(r[mk(i)], i, months, { kind: 'org_unit', id: j.id, name: `Jumuiya ya ${j.name}` }, false) }));
      const pcols = P.MONTHS.map((m, i) => ({ key: mk(i), label: m, cls: 'pm-num pm-cellcol',
        html: r => zakaBox(r[mk(i)], i, months, { kind: 'parishioner', id: r.id, name: r.name, where: r.family }, track) }));
      const unnamed = Number(all.total || 0) - P.sum(byName, 'total');
      box.innerHTML = `
        <p class="pm-muted pm-small">${canRecord() ? '<b>Bonyeza kisanduku cha mwezi</b> kujaza zaka. ' : ''}Zaka inaweza kulipwa na jumuiya kwa jumla (kama kwenye Excel) au na kila muumini kwa jina lake.</p>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Zaka iliyowasilishwa na jumuiya</h3>
          ${unnamed > 0 ? `<small class="pm-muted">${P.tzs(unnamed)} bila majina ya waliotoa</small>` : ''}</div>
          ${P.table([{ ...all, label: `Jumuiya ya ${j.name}` }], [{ key: 'label', label: 'Jumuiya' }, ...jcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' }], { cls: 'pm-keep-table' })}</section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Zaka kwa kila muumini, kwa familia</h3>
          <div class="pm-actions"><button class="pm-btn pm-btn--sm" data-xls>Excel</button></div></div>
          <p class="pm-muted pm-small">${rows.length} walipa zaka.${track ? ' Nukta nyekundu = mwezi ambao bado hajatoa.' : ''}</p>` +
        P.groupedTable(rows, [{ key: 'name', label: 'Muumini' }, ...pcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' },
          ...(track ? [{ key: 'months_unpaid', label: 'Hajatoa', html: r => r.months_unpaid ? `<span class="pm-due">${r.months_unpaid}</span>` : '0', cls: 'pm-num' }] : [])],
        { levels: [{ key: r => r.family_id, label: k => rows.find(r => r.family_id === k)?.family || '—',
          order: k => Number(rows.find(r => r.family_id === k)?.code) || 9999,
          html: k => `<a href="#/family?id=${k}">${P.esc(rows.find(r => r.family_id === k)?.family || '—')}</a>` }],
          sums: [...pcols.map(c => c.key), 'total'], fmt: v => v ? P.num(v) : '', cls: 'pm-keep-table',
          empty: 'Hakuna waumini waliowekwa kama walipa zaka kwenye jumuiya hii. Hariri muumini (kwenye familia yake) na uweke "Analipa zaka".' }) + '</section>';
      wireZaka(box, year);
      box.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`zaka_${j.name}_${year}`, {
        Jumuiya: [{ Jumuiya: j.name, ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(all[mk(i)]) || 0])), Jumla: Number(all.total || 0) }],
        Waumini: rows.map(r => ({ Familia: r.family, Muumini: r.name, ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(r[mk(i)]) || 0])), Jumla: r.total })) }));
    },

    /* what the jumuiya was assigned (what money, how much, by when) and the % paid */
    async michango(box, j, year, params) {
      const mlink = r => `#/mchango?id=${r.campaign_id}&k=${P.kigangoOf(j.id)?.id || ''}&j=${j.id}`;
      if (params.campaign) { P.go(mlink({ campaign_id: params.campaign })); return; }
      const rows = await P.rpc('unit_contributions', { p_year: year, p_unit: j.id });
      const sel = params.campaign ? rows.find(r => r.campaign_id === params.campaign) || { campaign_id: params.campaign, ...(P.ref.camps.find(c => c.id === params.campaign) || {}) } : null;
      const actions = r => {
        const b = [];
        if (canRecord() && (Number(r.target) > 0 || !Number(r.pledged))) b.push(`<button class="pm-btn pm-btn--sm pm-btn--primary" data-lipa="${r.campaign_id}">Lipa</button>`);
        b.push(`<a class="pm-btn pm-btn--sm" href="${mlink(r)}">Fungua</a>`);
        if (canPledge() && r.own_target) b.push(`<button class="pm-btn pm-btn--sm" data-edit="${r.campaign_id}">Badilisha</button>`);
        return `<span class="pm-nowrap">${b.join(' ')}</span>`;
      };
      box.innerHTML = `<div class="pm-row"><p class="pm-muted pm-small">Michango ambayo jumuiya hii imepangiwa au imelipa mwaka ${year}. Bonyeza mchango kuona familia na wanaolipa wake tu.</p>
          <div class="pm-actions">${canPledge() ? '<button class="pm-btn pm-btn--primary" data-target><span class="material-symbols-outlined">assignment_add</span>Pangia mchango</button>' : ''}</div></div>
        <section class="pm-card">${contribTable(rows, j, { link: mlink, actions, empty: 'Jumuiya hii haijapangiwa mchango wowote mwaka huu. Bonyeza "Pangia mchango".' })}</section>
        <div data-detail></div>`;
      const tb = box.querySelector('[data-target]');
      tb && tb.addEventListener('click', () => targetForm(j, year));
      box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => targetForm(j, year, rows.find(r => r.campaign_id === b.dataset.edit))));
      box.querySelectorAll('[data-lipa]').forEach(b => b.addEventListener('click', () => {
        const r = rows.find(x => x.campaign_id === b.dataset.lipa);
        P.quickPay({ title: r.campaign_name, sub: `Jumuiya ya <b>${P.esc(j.name)}</b>${Number(r.balance) ? ` · bado ${P.tzs(r.balance)}` : ''}`,
          payer: { kind: 'org_unit', id: j.id }, payerName: `Jumuiya ya ${j.name}`, category_id: r.category_id, campaign_id: r.campaign_id, amount: Number(r.balance) || '' });
      }));
      if (sel) await campaignDetail(box.querySelector('[data-detail]'), j, year, sel);
    },

    async miamala(box, j, year, params) {
      const cat = params.category || '';
      let q = P.from('v_ledger').select('*').eq('jumuiya_id', j.id).gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).neq('status', 'rejected')
        .order('txn_date', { ascending: false }).order('txn_no', { ascending: false }).limit(2000);
      if (cat) q = q.eq('category_id', cat);
      const rows = await P.q(q);
      box.innerHTML = `<form class="pm-filters" data-f><label>Aina<select name="category">${P.catOptions(null, { blank: 'Zote', selected: cat })}</select></label><button class="pm-btn">Chuja</button>
          ${canRecord() ? '<button type="button" class="pm-btn pm-btn--primary" data-pay>Rekodi malipo mengine</button>' : ''}<button type="button" class="pm-btn" data-xls>Excel</button></form>
        <p class="pm-muted pm-small">${rows.length} miamala · Jumla ${P.tzs(P.sum(rows.filter(r => r.status === 'posted'), 'net_amount'))}</p>` +
        P.groupedTable(rows, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' },
          { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
          { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'payment_method', label: 'Njia', fmt: v => P.METHODS[v] || v },
          { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>` : (r.legacy_receipt_no ? `<small class="pm-muted">Excel #${P.esc(r.legacy_receipt_no)}</small>` : '—') },
          { key: 'status', label: 'Hali', html: r => r.status === 'pending' ? P.badge('Inasubiri', 'gold') : r.sign < 0 ? P.badge('Reversal', 'rose') : '' }],
          { levels: [{ key: r => r.family_id || '', label: k => k ? (rows.find(r => r.family_id === k)?.family_name || 'Familia') : 'Jumuiya nzima / bila familia', order: k => k ? 1 : 0,
            html: k => k ? `<a href="#/family?id=${k}">${P.esc(rows.find(r => r.family_id === k)?.family_name || 'Familia')}</a>` : 'Jumuiya nzima / bila familia' }],
            sums: ['net_amount'], empty: 'Hakuna miamala ya jumuiya hii mwaka huu.' });
      box.querySelector('[data-f]').addEventListener('submit', e => { e.preventDefault(); P.go(`#/jumuiya?id=${j.id}&tab=miamala&category=${new FormData(e.target).get('category')}`); });
      const pb = box.querySelector('[data-pay]'); pb && pb.addEventListener('click', () => P.recordPayment({ jumuiya: j.id }));
      box.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`miamala_${j.name}_${year}`, { Miamala: rows.map(r => ({ Tarehe: r.txn_date, Familia: r.family_name, Mlipaji: r.payer_name,
        Aina: r.category_name, Kampeni: r.campaign_name, Kiasi: Number(r.net_amount), Njia: P.METHODS[r.payment_method], Risiti: r.receipt_no || r.legacy_receipt_no, Hali: r.status })) }));
    },

    async muhtasari(box, j, year) {
      const k = P.kigangoOf(j.id);
      const [sum, contrib, tx] = await Promise.all([
        P.rpc('unit_summary', { p_year: year, p_parent: k ? k.id : null }),
        P.rpc('unit_contributions', { p_year: year, p_unit: j.id }),
        P.q(P.from('v_ledger').select('category_name,net_amount').eq('jumuiya_id', j.id).eq('status', 'posted').gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).limit(10000)),
      ]);
      const me = sum.find(r => r.unit_id === j.id) || {};
      const byCat = {};
      tx.forEach(t => { byCat[t.category_name] = (byCat[t.category_name] || 0) + Number(t.net_amount); });
      box.innerHTML = `
        <section class="pm-kpis">
          ${P.kpi('Familia', P.num(me.families), 'family_restroom')}
          ${P.kpi('Waumini', P.num(me.parishioners), 'groups')}
          ${P.kpi(`Makusanyo ${year}`, P.tzs(me.income), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Zaka', P.tzs(me.zaka), 'calendar_month')}
          ${P.kpi('Waliyopangiwa', P.tzs(me.pledged), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(me.outstanding), 'pending_actions', 'pm-kpi--rose')}
        </section>
        <section class="pm-grid2">
          <div class="pm-card"><h3 class="pm-h3">Michango ${year}</h3>
            ${P.table(contrib, [{ key: 'campaign_name', label: 'Mchango', html: r => `<a class="pm-link" href="#/mchango?id=${r.campaign_id}&k=${P.kigangoOf(j.id)?.id || ''}&j=${j.id}">${P.esc(r.campaign_name)}</a>` },
              { key: 'obligation', label: 'Kiasi', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
              { key: 'gave', label: 'Ametoa', html: r => P.tzs(gave(r)), cls: 'pm-num' },
              { key: 'pct', label: '%', html: r => r.pct === null ? '—' : P.progress(r.pct) }], { empty: 'Hakuna michango mwaka huu.' })}</div>
          <div class="pm-card"><h3 class="pm-h3">Makusanyo kwa aina ${year}</h3>
            ${P.table(Object.entries(byCat).map(([c, v]) => ({ c, v })).sort((a, b) => b.v - a.v), [{ key: 'c', label: 'Aina' }, { key: 'v', label: 'Jumla', fmt: P.tzs, cls: 'pm-num' }],
              { empty: 'Hakuna malipo mwaka huu.', foot: { c: '<b>JUMLA</b>', v: `<b>${P.tzs(Object.values(byCat).reduce((a, b) => a + b, 0))}</b>` } })}</div>
        </section>`;
    },
  };

  /* per family / per person amounts of one contribution inside a jumuiya (Mavuno, Ujenzi…) */
  async function campaignDetail(box, j, year, sel) {
    const pl = await P.q(P.from('v_pledge_balances').select('*').eq('jumuiya_id', j.id).eq('campaign_id', sel.campaign_id).eq('status', 'active').limit(5000));
    const camp = P.ref.camps.find(c => c.id === sel.campaign_id) || sel;
    const who = r => r.parishioner_name || r.family_name || r.org_unit_name;
    const rows = pl.sort((a, b) => String(who(a)).localeCompare(String(who(b))));
    const foot = { who: '<b>JUMLA</b>', pledged: P.tzs(P.sum(rows, 'pledged')), paid: `<b>${P.tzs(P.sum(rows, 'paid'))}</b>`, outstanding: P.tzs(P.sum(rows, 'outstanding')) };
    const assignBtn = canPledge() && camp.giver_level && camp.amount_mode === 'assigned' && camp.giver_level !== 'kigango' && camp.giver_level !== 'jumuiya'
      ? '<button class="pm-btn pm-btn--sm" data-assign>Pangia wote wa jumuiya hii</button>' : '';
    box.innerHTML = `<section class="pm-card"><div class="pm-row"><div><h3 class="pm-h3">${P.esc(camp.name || sel.campaign_name)} — kwa ${camp.giver_level === 'parishioner' ? 'kila muumini' : 'kila familia'}</h3>${P.rulesBadges(camp)}</div>
        <div class="pm-actions">${assignBtn}<a class="pm-btn pm-btn--sm" href="#/jumuiya?id=${j.id}&tab=michango">Funga</a></div></div>
      ${P.table(rows, [
        { key: 'who', label: camp.giver_level === 'parishioner' ? 'Muumini' : 'Familia', html: r => (r.family_id ? `<a class="pm-link" href="#/family?id=${r.family_id}">${P.esc(who(r))}</a>` : P.esc(who(r))) },
        { key: 'source', label: 'Aina', html: r => r.source === 'assigned' ? P.badge('Amepangiwa', 'gold') : P.badge('Ameahidi', 'muted') },
        { key: 'pledged', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'paid', label: 'Ametoa', fmt: P.tzs, cls: 'pm-num' },
        { key: 'outstanding', label: 'Bado', html: r => due(r.outstanding), cls: 'pm-num' },
        { key: 'completion_pct', label: '%', html: r => `${P.pct(r.completion_pct)} ${P.progress(r.completion_pct)}` },
        { key: 'pledge_id', label: '', html: r => canRecord() && Number(r.outstanding) > 0 ? `<button class="pm-btn pm-btn--sm pm-btn--primary" data-paypl="${r.pledge_id}">Lipa</button>` : '' }],
        { foot, empty: 'Bado hakuna aliyepangiwa.' })}</section>`;
    box.querySelectorAll('[data-paypl]').forEach(b => b.addEventListener('click', () => {
      const r = rows.find(x => x.pledge_id === b.dataset.paypl);
      payPledge(r);
    }));
    const ab = box.querySelector('[data-assign]');
    ab && ab.addEventListener('click', async () => {
      const per = camp.giver_level === 'parishioner' && Object.keys(camp.relation_rates || {}).length;
      const v = await P.modal({ title: `Pangia wote — ${camp.name}`, submit: 'Pangia', body: `<p class="pm-muted">${LEVEL[camp.giver_level]} wa Jumuiya ya ${P.esc(j.name)} ambaye bado hajapangiwa atapangiwa kiasi hiki. Waliokwisha pangiwa hawabadilishwi.</p>
        <div class="pm-form">${per ? `<p class="pm-span2"><b>Kwa kanuni:</b> ${P.esc(P.ratesText(camp.relation_rates))}</p>`
          : `<label>Kiasi<input name="amount" type="number" min="1" value="${camp.default_amount || ''}" required></label>`}</div>` });
      if (!v) return;
      const r = await P.rpc('assign_campaign', { p_campaign: camp.id, p_amount: v.amount ? Number(v.amount) : null, p_scope: j.id });
      Toast.success(`Wamepangiwa: ${r.created}`); P.refresh();
    });
  }

  // pay against one family's / person's amount
  const payPledge = r => P.quickPay({ title: r.campaign_name, sub: `<b>${P.esc(r.parishioner_name || r.family_name || r.org_unit_name)}</b> · amepangiwa ${P.tzs(r.pledged)}, ametoa ${P.tzs(r.paid)}, bado ${P.tzs(r.outstanding)}`,
    payer: r.parishioner_id ? { kind: 'parishioner', id: r.parishioner_id } : r.family_id ? { kind: 'family', id: r.family_id } : { kind: 'org_unit', id: r.org_unit_id },
    payerName: r.parishioner_name || r.family_name || r.org_unit_name, category_id: r.category_id, campaign_id: r.campaign_id, amount: Number(r.outstanding) || '' });

  /* ================= MCHANGO MMOJA — one contribution, level by level =================
     Radio Maria 2026 → vigango → jumuiya → familia → muumini. Only this contribution;
     assign (pangia) and record payments (lipa) right on the line they belong to. */
  V.mchango = {
    title: 'Mchango', perm: 'finance.read',
    async render(el, params) {
      const camp = P.ref.camps.find(c => c.id === params.id);
      if (!camp) { el.innerHTML = P.empty('Mchango haupo. Rudi kwenye Michango uchague mchango.'); return; }
      const cat = P.ref.catsById[camp.category_id] || {};
      const scoped = P.scopeUnit() ? P.ref.unitsById[P.scopeUnit()] : null;
      const at = { k: params.k || '', j: params.j || '', fa: params.fa || '' };
      if (scoped && !params.k) {
        if (scoped.unit_type === 'kigango') at.k = scoped.id;
        if (scoped.unit_type === 'jumuiya') { at.k = P.kigangoOf(scoped.id)?.id || ''; at.j = scoped.id; }
      }
      const link = (o = {}) => '#/mchango?' + new URLSearchParams(Object.entries({ id: camp.id, ...at, ...o }).filter(([, v]) => v)).toString();
      const fam = at.fa && at.fa !== 'none' ? await P.q(P.from('families').select('id,family_name,jumuiya_id').eq('id', at.fa).maybeSingle()) : null;
      const leaf = at.k === 'none' || at.j === 'none' || at.fa === 'none';
      const level = leaf ? null : !at.k ? 'kigango' : !at.j ? 'jumuiya' : !at.fa ? 'family' : 'parishioner';
      const parent = { kigango: null, jumuiya: at.k, family: at.j, parishioner: at.fa }[level];
      const jumuiya = at.j && at.j !== 'none' ? P.ref.unitsById[at.j] : null;
      const crumbs = [{ label: 'Michango', href: '#/campaigns' }, { label: camp.name, href: link({ k: '', j: '', fa: '' }) }];
      if (at.k) crumbs.push({ label: at.k === 'none' ? 'Parokiani' : `Kigango cha ${P.ref.unitsById[at.k]?.name || ''}`, href: link({ j: '', fa: '' }) });
      if (at.j) crumbs.push({ label: at.j === 'none' ? 'Kigango chenyewe' : `Jumuiya ya ${jumuiya?.name || ''}`, href: link({ fa: '' }) });
      if (at.fa) crumbs.push({ label: at.fa === 'none' ? 'Jumuiya yenyewe' : fam?.family_name || 'Familia', href: link({}) });
      const LBL = { kigango: ['Kigango', 'Parokiani (si kupitia kigango)'], jumuiya: ['Jumuiya', 'Kigango chenyewe'],
        family: ['Familia', 'Jumuiya yenyewe (jumla ya jumuiya)'], parishioner: ['Muumini', 'Familia nzima'] };
      const giver = camp.giver_level;
      const assigned = camp.amount_mode === 'assigned';
      // the last level where someone gives: the family for "kila familia", the person for "kila muumini"
      const lastLevel = giver === 'parishioner' ? 'parishioner' : 'family';

      el.innerHTML = `${P.crumbs(crumbs.map((c, i) => i === crumbs.length - 1 ? { label: c.label } : c))}
        <div class="pm-head"><div><p class="pm-eyebrow">${P.esc(cat.name_sw || 'Mchango')} · Mwaka ${camp.campaign_year}</p>
          <h1 class="pm-h1">${P.esc(camp.name)}</h1>${P.rulesBadges(camp)}</div>
          <div class="pm-actions" data-top></div></div>
        <section class="pm-kpis" data-kpis></section>
        <div data-body>${P.loading()}</div>`;
      const top = el.querySelector('[data-top]'), body = el.querySelector('[data-body]');
      const btn = (attr, label, icon, primary) => `<button class="pm-btn ${primary ? 'pm-btn--primary' : ''}" ${attr}>${icon ? `<span class="material-symbols-outlined">${icon}</span>` : ''}${label}</button>`;

      let rows = [];
      if (level) {
        const [tree, members] = await Promise.all([
          P.rpc('campaign_tree', { p_campaign: camp.id, p_level: level, p_parent: parent }),
          level === 'parishioner'
            ? P.q(P.from('parishioners').select('id,full_name,relationship').eq('family_id', at.fa).eq('membership_status', 'active').limit(200)).then(r => r.map(p => ({ id: p.id, name: p.full_name, rel: p.relationship })))
            : P.levelMembers(level, parent)]);
        const zero = { target: 0, pledged: 0, paid: 0, collected: 0, obligation: 0, gave: 0, balance: 0, pct: null, payers: 0, pledges: 0 };
        const byId = Object.fromEntries(tree.filter(r => r.group_id).map(r => [r.group_id, r]));
        const known = new Set(members.map(m => m.id));
        rows = P.levelSort(level, [...members.map(m => ({ ...zero, ...(byId[m.id] || {}), group_id: m.id, group_name: m.name, code: m.code, rel: m.rel })),
          ...tree.filter(r => r.group_id && !known.has(r.group_id))]);
        const self = tree.find(r => !r.group_id);
        if (self) rows.unshift({ ...self, group_name: LBL[level][1], self: true });
      }
      // totals of what is on screen
      // totals: what is assigned here minus everything given here (also money handed in as a lump)
      const T = k => k === 'balance' ? Math.max(P.sum(rows, 'obligation') - P.sum(rows, 'gave'), 0) : P.sum(rows, k);
      el.querySelector('[data-kpis]').innerHTML = level ? `
        ${P.kpi(assigned ? 'Waliyopangiwa' : 'Ahadi', P.tzs(T('obligation')), 'assignment')}
        ${P.kpi('Wametoa', P.tzs(T('gave')), 'savings', 'pm-kpi--teal')}
        ${P.kpi('Bado', P.tzs(T('balance')), 'pending_actions', 'pm-kpi--rose')}
        ${P.kpi('Asilimia', T('obligation') ? P.pct(T('gave') / T('obligation') * 100) : '—', 'percent')}` : '';

      const key = { kigango: 'k', jumuiya: 'j', family: 'fa' }[level];
      const opens = r => level !== 'parishioner' && !(level === 'family' && lastLevel === 'family');
      const name = r => r.self ? `<span class="pm-muted">${P.esc(r.group_name)}</span>`
        : opens(r) ? `<a class="pm-link" href="${link({ [key]: r.group_id })}">${P.esc(r.group_name || '—')}</a>`
        : `<b>${P.esc(r.group_name || '—')}</b>${r.rel ? ` <small class="pm-muted">${P.esc(r.rel)}</small>` : ''}`;
      // who pays on a line: the jumuiya (its own line), a family or a person
      const payerOf = r => level === 'family' ? (r.self ? { kind: 'org_unit', id: at.j, name: `Jumuiya ya ${jumuiya?.name || ''}` } : { kind: 'family', id: r.group_id, name: r.group_name })
        : level === 'parishioner' ? (r.self ? { kind: 'family', id: at.fa, name: fam?.family_name } : { kind: 'parishioner', id: r.group_id, name: r.group_name }) : null;
      const canPay = r => P.can('finance.record') && !!payerOf(r);
      const canAssignLine = r => P.can('finance.pledge') && assigned && !r.self && !Number(r.pledged)
        && ((level === 'family' && giver === 'family') || (level === 'parishioner' && giver === 'parishioner'));
      const actions = r => `<span class="pm-nowrap">${canPay(r) ? `<button class="pm-btn pm-btn--sm pm-btn--primary" data-lipa="${r.group_id || 'self'}">Lipa</button> ` : ''}${
        canAssignLine(r) ? `<button class="pm-btn pm-btn--sm" data-pangia="${r.group_id}">Pangia</button> ` : ''}${
        !r.self && opens(r) ? `<a class="pm-btn pm-btn--sm" href="${link({ [key]: r.group_id })}">Fungua</a>` : ''}</span>`;
      const money = v => Number(v) ? P.tzs(v) : '—';

      // the jumuiya's own amount for this contribution (kupangiwa kwa jumuiya)
      let jt = null;
      if (level === 'family' && (giver === 'jumuiya' || rows.find(r => r.self && Number(r.target)))) {
        const t = await P.q(P.from('campaign_targets').select('target_amount,starts_on,due_on,notes').eq('campaign_id', camp.id).eq('org_unit_id', at.j).maybeSingle()).catch(() => null);
        const self = rows.find(r => r.self) || {};
        jt = { campaign_id: camp.id, campaign_name: camp.name, target: t?.target_amount || 0, starts_on: t?.starts_on, due_on: t?.due_on, notes: t?.notes };
        const all = T('gave');
        body.insertAdjacentHTML('beforebegin', `<section class="pm-card pm-unitduty"><div class="pm-row"><div>
            <h3 class="pm-h3">Jumuiya ya ${P.esc(jumuiya?.name || '')} imepangiwa ${jt.target ? P.tzs(jt.target) : '— (bado haijapangiwa)'}</h3>
            <p class="pm-muted pm-small">${jt.target ? `Imetoa ${P.tzs(all)} · bado ${P.tzs(Math.max(jt.target - all, 0))} · ${P.pct(Math.min(all / jt.target, 9.99) * 100)}` : 'Weka kiasi ambacho jumuiya hii inatakiwa kutoa.'}
            ${jt.due_on ? ` · mwisho wa kulipa ${P.date(jt.due_on)}` : ''}</p>${jt.target ? P.progress(all / jt.target * 100) : ''}</div>
          <div class="pm-actions">${P.can('finance.pledge') ? btn('data-jt', jt.target ? 'Badilisha kiasi' : 'Pangia jumuiya', 'assignment_add') : ''}
            ${P.can('finance.record') ? btn('data-jpay', 'Lipa (jumuiya)', 'payments', true) : ''}</div></div></section>`);
      }

      // buttons at the top for this level
      const tops = [];
      if (level === 'family' && assigned && P.can('finance.pledge') && ['family', 'parishioner'].includes(giver)) tops.push(btn('data-assignall', 'Pangia wote wa jumuiya hii', 'group_add'));
      if (level === 'parishioner' && assigned && P.can('finance.pledge') && giver === 'parishioner') tops.push(btn('data-assignall', 'Pangia wote wa familia hii', 'group_add'));
      if (P.can('finance.record')) tops.push(btn('data-other', 'Rekodi malipo', 'add', !jt));
      top.innerHTML = tops.join('');

      // the list for this level
      const scope = q => {
        if (at.fa === 'none') return q.eq('tree_jumuiya_id', at.j).is('family_id', null);
        if (at.fa) return q.eq('family_id', at.fa);
        if (at.j === 'none') return q.eq('tree_kigango_id', at.k).is('tree_jumuiya_id', null);
        if (at.j) return q.eq('tree_jumuiya_id', at.j);
        if (at.k === 'none') return q.is('tree_kigango_id', null);
        if (at.k) return q.eq('tree_kigango_id', at.k);
        return q;
      };
      const pays = await P.q(scope(P.from('v_ledger_tree').select('id,txn_date,payer_name,family_name,net_amount,receipt_no,legacy_receipt_no,jumuiya_name,status')
        .eq('campaign_id', camp.id).eq('status', 'posted').eq('kind', 'income').order('txn_date', { ascending: false }).limit(level === 'kigango' ? 15 : 100)));
      body.innerHTML = (level ? `<section class="pm-card"><h3 class="pm-h3">${LBL[level][0] === 'Muumini' ? 'Wanafamilia' : LBL[level][0] === 'Familia' ? 'Familia za jumuiya hii' : LBL[level][0] === 'Jumuiya' ? 'Jumuiya za kigango hiki' : 'Vigango'}</h3>
          ${P.table(rows, [
            { key: 'group_name', label: LBL[level][0], html: name },
            { key: 'obligation', label: assigned ? 'Pangiwa' : 'Ahadi / Lengo', fmt: money, cls: 'pm-num' },
            { key: 'gave', label: 'Ametoa', fmt: money, cls: 'pm-num pm-strong' },
            { key: 'balance', label: 'Bado', html: r => Number(r.balance) ? `<span class="pm-due">${P.tzs(r.balance)}</span>` : '—', cls: 'pm-num' },
            { key: 'pct', label: '%', html: r => r.pct === null || r.pct === undefined ? '—' : `${P.pct(r.pct)} ${P.progress(r.pct)}` },
            { key: 'group_id', label: '', html: actions }],
            { foot: { group_name: '<b>JUMLA</b>', obligation: P.tzs(T('obligation')), gave: `<b>${P.tzs(T('gave'))}</b>`, balance: P.tzs(T('balance')) } })}</section>` : '') +
        `<section class="pm-card"><h3 class="pm-h3">Malipo ya ${P.esc(camp.name)}${level === 'kigango' ? ' — ya karibuni' : ' hapa'}</h3>
          ${P.table(pays, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji', html: r => P.esc(r.payer_name || '—') + (r.family_name && r.family_name !== r.payer_name ? `<br><small class="pm-muted">${P.esc(r.family_name)}</small>` : '') },
            { key: 'jumuiya_name', label: 'Jumuiya', fmt: v => P.esc(v || '—') }, { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num pm-strong' },
            { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>` : (r.legacy_receipt_no ? `<small class="pm-muted">Excel #${P.esc(r.legacy_receipt_no)}</small>` : '—') }],
            { empty: 'Hakuna malipo bado.' })}</section>`;

      // ---- actions ----
      const lipa = (payer, owed) => P.quickPay({ title: camp.name, sub: `<b>${P.esc(payer.name || '')}</b>${owed ? ` · bado ${P.tzs(owed)}` : ''}`,
        payer: { kind: payer.kind, id: payer.id }, payerName: payer.name, category_id: camp.category_id, campaign_id: camp.id, amount: owed || '' });
      el.querySelectorAll('[data-lipa]').forEach(b => b.addEventListener('click', () => {
        const r = rows.find(x => (x.group_id || 'self') === b.dataset.lipa || (b.dataset.lipa === 'self' && x.self));
        lipa(payerOf(r), Number(r.balance));
      }));
      el.querySelectorAll('[data-pangia]').forEach(b => b.addEventListener('click', async () => {
        const r = rows.find(x => x.group_id === b.dataset.pangia);
        const rate = r.rel && camp.relation_rates ? (camp.relation_rates[String(r.rel).toUpperCase()] ?? camp.relation_rates.WENGINE) : null;
        const v = await P.modal({ title: `Pangia — ${r.group_name}`, submit: 'Pangia', body: `<p class="pm-muted">${P.esc(camp.name)}</p>
          <div class="pm-form"><label>Kiasi alichopangiwa (TZS)<input name="amount" type="number" min="1" required value="${rate || camp.default_amount || ''}"></label></div>` });
        if (!v) return;
        await P.rpc('create_pledge', { p: { campaign_id: camp.id, amount: Number(v.amount) * (camp.frequency === 'monthly' ? 12 : 1), source: 'assigned', [level === 'family' ? 'family_id' : 'parishioner_id']: r.group_id } });
        Toast.success('Amepangiwa.'); P.refresh();
      }));
      const aa = el.querySelector('[data-assignall]');
      aa && aa.addEventListener('click', async () => {
        const per = giver === 'parishioner' && Object.keys(camp.relation_rates || {}).length;
        const where = level === 'family' ? `Jumuiya ya ${jumuiya?.name || ''}` : fam?.family_name;
        const v = await P.modal({ title: `Pangia wote — ${camp.name}`, submit: 'Pangia', body: `<p class="pm-muted">${P.RULES.LEVEL[giver]} wa ${P.esc(where)} ambaye bado hajapangiwa atapangiwa. Waliokwisha pangiwa hawabadilishwi.</p>
          <div class="pm-form">${per ? `<p class="pm-span2"><b>Kwa kanuni:</b> ${P.esc(P.ratesText(camp.relation_rates))}</p>`
            : `<label>Kiasi kwa kila ${giver === 'family' ? 'familia' : 'mmoja'}<input name="amount" type="number" min="1" required value="${camp.default_amount || ''}"></label>`}</div>` });
        if (!v) return;
        if (level === 'parishioner') {
          // one family: assign each member without an amount yet
          let n = 0;
          for (const r of rows.filter(x => !x.self && !Number(x.pledged))) {
            const amt = v.amount ? Number(v.amount) : (camp.relation_rates || {})[String(r.rel || '').toUpperCase()] ?? (camp.relation_rates || {}).WENGINE;
            if (!amt) continue;
            await P.rpc('create_pledge', { p: { campaign_id: camp.id, amount: Number(amt), source: 'assigned', parishioner_id: r.group_id } }); n++;
          }
          Toast.success(`Wamepangiwa: ${n}`);
        } else {
          const r = await P.rpc('assign_campaign', { p_campaign: camp.id, p_amount: v.amount ? Number(v.amount) : null, p_scope: at.j });
          Toast.success(`Wamepangiwa: ${r.created}${r.skipped_no_rate ? ` · hawakuwekewa alama: ${r.skipped_no_rate}` : ''}`);
        }
        P.refresh();
      });
      const jtb = el.querySelector('[data-jt]'); jtb && jtb.addEventListener('click', () => P.targetForm(jumuiya, camp.campaign_year, jt));
      const jp = el.querySelector('[data-jpay]');
      jp && jp.addEventListener('click', () => lipa({ kind: 'org_unit', id: at.j, name: `Jumuiya ya ${jumuiya?.name || ''}` }, Math.max(Number(jt?.target || 0) - T('gave'), 0)));
      const ot = el.querySelector('[data-other]');
      ot && ot.addEventListener('click', () => P.recordPayment({ category_id: camp.category_id, campaign_id: camp.id,
        ...(jumuiya ? { jumuiya: jumuiya.id } : at.k && at.k !== 'none' ? { org_unit_id: at.k } : {}),
        ...(fam ? { payer: { kind: 'family', id: fam.id }, payerName: fam.family_name } : {}) }));
    },
  };

  /* ================= FAMILIA ================= */
  V.family = {
    title: 'Familia',
    async render(el, params) {
      const year = P.year();
      const f = await P.q(P.from('families').select('*, parishioners!parishioners_family_id_fkey(id,full_name,gender,relationship,phone,birth_year,is_zaka_payer,membership_status,profile_id)').eq('id', params.id).maybeSingle());
      if (!f) { el.innerHTML = P.empty('Familia haipo, au huna ruhusa ya kuiona.'); return; }
      const ids = f.parishioners.map(p => p.id);
      const [pl, tx, grid] = await Promise.all([
        P.q(P.from('v_pledge_balances').select('*').eq('campaign_year', year).eq('status', 'active').or(`family_id.eq.${f.id}${ids.length ? `,parishioner_id.in.(${ids.join(',')})` : ''}`).limit(500)),
        P.q(P.from('v_ledger').select('*').eq('family_id', f.id).eq('status', 'posted').gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).order('txn_date', { ascending: false }).limit(1000)),
        P.rpc('zaka_grid_tree', { p_year: year, p_level: 'parishioner', p_scope: f.jumuiya_id }),
      ]);
      const g = Object.fromEntries(grid.filter(r => r.group_id).map(r => [r.group_id, r]));
      const months = monthsDue(year);
      const who = r => r.parishioner_name || r.family_name || r.org_unit_name;
      const order = { BABA: 1, MAMA: 2 };
      const members = f.parishioners.filter(p => p.membership_status === 'active')
        .map(p => ({ ...p, ...(g[p.id] || {}), id: p.id, total: Number(g[p.id]?.total || 0) }))
        .sort((a, b) => (a.id === f.head_parishioner_id ? -1 : b.id === f.head_parishioner_id ? 1 : 0) || (order[a.relationship] || 9) - (order[b.relationship] || 9));
      const track = members.some(m => m.total > 0);
      const jName = P.ref.unitsById[f.jumuiya_id]?.name || '';
      el.innerHTML = `
        ${P.unitCrumbs(f.jumuiya_id, [{ label: f.family_name }])}
        <div class="pm-head"><div><p class="pm-eyebrow">Familia ${f.family_code ? 'Na. ' + P.esc(f.family_code) : ''} · Jumuiya ya ${P.esc(jName)}</p><h1 class="pm-h1">${P.esc(f.family_name)}</h1>
          <p class="pm-muted">${members.length} wanafamilia${f.phone ? ' · ' + P.esc(f.phone) : ''} · Mwaka ${year}</p></div>
          <div class="pm-actions">${canWriteReg() ? '<button class="pm-btn" data-addp>+ Mwanafamilia</button><button class="pm-btn" data-editf>Hariri familia</button>' : ''}
            <a class="pm-btn" href="#/statement?family=${f.id}"><span class="material-symbols-outlined">description</span>Taarifa kamili</a></div></div>
        <section class="pm-kpis">
          ${P.kpi(`Michango ${year}`, P.tzs(P.sum(tx, 'net_amount')), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Zaka', P.tzs(P.sum(members, 'total')), 'calendar_month')}
          ${P.kpi('Waliyopangiwa', P.tzs(P.sum(pl, 'pledged')), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(P.sum(pl, 'outstanding')), 'pending_actions', 'pm-kpi--rose')}
        </section>
        <section class="pm-card"><h3 class="pm-h3">Wanafamilia na zaka ${year}</h3>
          ${canRecord() ? '<p class="pm-muted pm-small"><b>Bonyeza kisanduku cha mwezi</b> kujaza zaka ya muumini.</p>' : ''}
          ${P.table(members, [{ key: 'full_name', label: 'Jina', html: p => `<b>${P.esc(p.full_name)}</b>` + (p.id === f.head_parishioner_id ? ' ' + P.badge('Mkuu', 'gold') : '') + `<br><small class="pm-muted">${P.esc(p.relationship || '')}${p.is_zaka_payer ? '' : ' · hajawekwa kulipa zaka'}</small>` },
            ...P.MONTHS.map((m, i) => ({ key: mk(i), label: m, cls: 'pm-num pm-cellcol',
              html: p => zakaBox(p[mk(i)], i, months, { kind: 'parishioner', id: p.id, name: p.full_name, where: f.family_name }, track && p.is_zaka_payer) })),
            { key: 'total', label: 'Zaka', fmt: P.num, cls: 'pm-num pm-strong' },
            { key: 'id', label: '', html: p => canWriteReg() ? `<button class="pm-btn pm-btn--sm" data-editp="${p.id}">Hariri</button>` : '' }], { empty: 'Familia haina wanafamilia bado.', cls: 'pm-keep-table' })}</section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Michango ya familia ${year} (Mavuno, Ujenzi…)</h3>
          <div class="pm-actions">${canPledge() ? '<button class="pm-btn pm-btn--sm" data-assign><span class="material-symbols-outlined">assignment_add</span>Pangia familia</button>' : ''}</div></div>
          ${P.table(pl, [{ key: 'campaign_name', label: 'Mchango' }, { key: 'who', label: 'Wa', html: r => P.esc(who(r)) },
            { key: 'source', label: 'Aina', html: r => r.source === 'assigned' ? P.badge('Amepangiwa', 'gold') : P.badge('Ameahidi', 'muted') },
            { key: 'pledged', label: 'Pangiwa', fmt: P.tzs, cls: 'pm-num' }, { key: 'paid', label: 'Toa', fmt: P.tzs, cls: 'pm-num' },
            { key: 'outstanding', label: 'Bado', html: r => due(r.outstanding), cls: 'pm-num' },
            { key: 'completion_pct', label: '%', html: r => `${P.pct(r.completion_pct)} ${P.progress(r.completion_pct)}` },
            { key: 'pledge_id', label: '', html: r => canRecord() && Number(r.outstanding) > 0 ? `<button class="pm-btn pm-btn--sm pm-btn--primary" data-paypl="${r.pledge_id}">Lipa</button>` : '' }],
            { empty: 'Familia hii haijapangiwa mchango mwaka huu. Bonyeza "Pangia familia".' })}</section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Malipo yote ya familia ${year}</h3>
          ${canRecord() ? '<button class="pm-btn pm-btn--sm" data-pay>Rekodi malipo mengine</button>' : ''}</div>
          ${P.table(tx, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' },
            { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
            { key: 'period_month', label: 'Mwezi', fmt: v => v ? MONTH_LONG[Number(String(v).slice(5, 7)) - 1] : '' },
            { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' },
            { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>` : (r.legacy_receipt_no ? `Excel #${P.esc(r.legacy_receipt_no)}` : '—') }],
            { empty: 'Hakuna malipo mwaka huu.' })}</section>`;
      wireZaka(el, year);
      const pay = el.querySelector('[data-pay]');
      pay && pay.addEventListener('click', () => P.recordPayment({ jumuiya: f.jumuiya_id, payerName: f.family_name, payer: { kind: 'family', id: f.id } }));
      el.querySelectorAll('[data-paypl]').forEach(b => b.addEventListener('click', () => payPledge(pl.find(x => x.pledge_id === b.dataset.paypl))));
      const as = el.querySelector('[data-assign]');
      as && as.addEventListener('click', async () => {
        const camps = P.ref.camps.filter(c => c.campaign_year === year && c.status !== 'closed' && c.amount_mode !== 'free'
          && !['jumuiya', 'kigango'].includes(c.giver_level) && P.ref.catsById[c.category_id]?.kind !== 'zaka');
        const v = await P.modal({ title: `Pangia — ${f.family_name}`, body: `<div class="pm-form">
          <label class="pm-span2">Mchango<select name="campaign_id" required>${P.options(camps, { blank: 'Chagua…' })}</select></label>
          <label>Wa nani<select name="who"><option value="family:${f.id}">Familia nzima</option>${members.map(p => `<option value="parishioner:${p.id}">${P.esc(p.full_name)}</option>`).join('')}</select></label>
          <label>Kiasi alichopangiwa<input name="amount" type="number" min="1" required></label>
          <label>Aina<select name="source"><option value="assigned">Amepangiwa</option><option value="pledge">Ameahidi mwenyewe</option></select></label></div>` });
        if (!v) return;
        const [kind, id] = v.who.split(':');
        const c = P.ref.camps.find(x => x.id === v.campaign_id);
        await P.rpc('create_pledge', { p: { campaign_id: v.campaign_id, amount: Number(v.amount) * (c?.frequency === 'monthly' ? 12 : 1), source: v.source, [`${kind}_id`]: id } });
        Toast.success('Imehifadhiwa.'); P.refresh();
      });
      const ap = el.querySelector('[data-addp]'); ap && ap.addEventListener('click', () => P.personForm(f, null, { families: [f] }));
      const ef = el.querySelector('[data-editf]'); ef && ef.addEventListener('click', () => P.famForm(f, { jumuiya: f.jumuiya_id }));
      el.querySelectorAll('[data-editp]').forEach(b => b.addEventListener('click', async () => {
        const others = await P.q(P.from('families').select('id,family_name,jumuiya_id').eq('jumuiya_id', f.jumuiya_id).order('family_name').limit(500));
        P.personForm(f, f.parishioners.find(p => p.id === b.dataset.editp), { families: others });
      }));
    },
  };
})();

