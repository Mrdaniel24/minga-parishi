/* Minga Parish — Vigango → Kigango → Jumuiya → Familia
   Everything about one community in one place, for the year chosen in the top bar. */
(function () {
  const P = window.Parish, V = P.views;
  const MODE = { assigned: 'Kupangiwa', pledge: 'Ahadi', free: 'Hiari' };
  const LEVEL = { parishioner: 'Kila muumini', family: 'Kila familia', jumuiya: 'Kila jumuiya', kigango: 'Kila kigango' };
  const FREQ = { yearly: 'Kwa mwaka', monthly: 'Kwa mwezi' };
  P.RULES = { MODE, LEVEL, FREQ };
  const yearCamps = () => P.ref.camps.filter(c => c.campaign_year === P.year() && c.status !== 'closed');
  const canRecord = () => P.can('finance.record');
  const canPledge = () => P.can('finance.pledge');
  const canWriteReg = () => P.access.platform_admin || (P.access.permissions || []).includes('registry.write');
  const due = v => Number(v) > 0 ? `<span class="pm-due">${P.tzs(v)}</span>` : '—';

  // record a payment inside a community, then refresh and open the receipt
  P.recordPayment = async (prefill = {}) => {
    const r = await P.paymentForm(prefill).catch(e => { Toast.error(P.friendlyError(e)); return null; });
    if (r && (r.status === 'posted' || r.status === 'already_posted')) {
      Toast.success(`Malipo yamehifadhiwa. Risiti ${r.receipt_no || ''}`);
      if (r.pledge && r.pledge.pledged) Toast.info(`Amelipa ${P.tzs(r.pledge.paid)} kati ya ${P.tzs(r.pledge.pledged)} — bado ${P.tzs(r.pledge.outstanding)}`);
      if (r.receipt_id) window.open(`receipt.html?id=${r.receipt_id}`, '_blank');
      P.reload();
    }
  };

  // obligation label for a campaign's rules
  P.rulesBadges = c => !c ? '' : `<span class="pm-rules">${c.giver_level ? P.badge(LEVEL[c.giver_level], 'teal') : P.badge('Yeyote', 'muted')}
    ${P.badge(MODE[c.amount_mode] || 'Ahadi', c.amount_mode === 'assigned' ? 'gold' : 'muted')} ${P.badge(FREQ[c.frequency] || 'Kwa mwaka', 'muted')}
    ${c.default_amount ? P.badge(P.tzs(c.default_amount) + (c.frequency === 'monthly' ? ' / mwezi' : ''), 'muted') : ''}</span>`;

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
          <p class="pm-muted">Chagua kigango, kisha jumuiya — kila kitu cha jumuiya (familia, zaka, michango, miamala) kiko ndani yake. Mwaka ${year}.</p></div>
          <div class="pm-actions"><button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <section class="pm-kpis">
          ${P.kpi('Vigango', P.num(rows.length), 'account_tree')}
          ${P.kpi('Familia', P.num(tot('families')), 'family_restroom')}
          ${P.kpi('Waumini', P.num(tot('parishioners')), 'groups')}
          ${P.kpi(`Makusanyo ya vigango ${year}`, P.tzs(tot('income')), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Pangiwa / Ahadi', P.tzs(tot('pledged')), 'assignment')}
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
            ${pct !== null ? `${P.progress(pct)}<small>${pct}% ya waliyopangiwa / ahadi imelipwa</small>` : ''}</a>`;
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
      const [rows, recent] = await Promise.all([
        P.rpc('unit_summary', { p_year: year, p_parent: k.id }),
        P.q(P.from('v_ledger').select('*').eq('org_unit_id', k.id).eq('status', 'posted').gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).order('txn_date', { ascending: false }).limit(50)),
      ]);
      const own = P.sum(recent, 'net_amount');
      const s = key => P.sum(rows, key);
      const foot = { unit_name: '<b>JUMLA</b>', families: P.num(s('families')), parishioners: P.num(s('parishioners')), zaka: P.tzs(s('zaka')), mavuno: P.tzs(s('mavuno')),
        ujenzi: P.tzs(s('ujenzi')), special: P.tzs(s('special') + s('sadaka') + s('other')), income: `<b>${P.tzs(s('income'))}</b>`, pledged: P.tzs(s('pledged')), outstanding: P.tzs(s('outstanding')) };
      el.innerHTML = `
        ${P.unitCrumbs(k.id)}
        <div class="pm-head"><div><p class="pm-eyebrow">Kigango</p><h1 class="pm-h1">${P.esc(k.name)}</h1>
          <p class="pm-muted">${rows.length} jumuiya · ${P.num(s('families'))} familia · ${P.num(s('parishioners'))} waumini · Mwaka ${year}</p></div>
          <div class="pm-actions">${canRecord() ? '<button class="pm-btn pm-btn--primary" data-pay><span class="material-symbols-outlined">add</span>Malipo ya kigango</button>' : ''}
            <button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button>
            <button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <section class="pm-kpis">
          ${P.kpi(`Makusanyo ${year}`, P.tzs(s('income') + own), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Zaka', P.tzs(s('zaka')), 'calendar_month')}
          ${P.kpi('Mavuno', P.tzs(s('mavuno')), 'agriculture')}
          ${P.kpi('Ujenzi', P.tzs(s('ujenzi')), 'construction')}
          ${P.kpi('Pangiwa / Ahadi', P.tzs(s('pledged')), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(s('outstanding')), 'pending_actions', 'pm-kpi--rose')}
        </section>
        ${P.reportHeader(`Kigango cha ${k.name} — ${year}`)}
        <section class="pm-card"><h3 class="pm-h3">Jumuiya za kigango hiki</h3>
          ${P.table(rows, [
            { key: 'unit_name', label: 'Jumuiya', html: r => `<a class="pm-link" href="#/jumuiya?id=${r.unit_id}">${P.esc(r.unit_name)}</a>` },
            { key: 'families', label: 'Familia', fmt: P.num, cls: 'pm-num' }, { key: 'parishioners', label: 'Waumini', fmt: P.num, cls: 'pm-num' },
            { key: 'zaka', label: 'Zaka', fmt: P.tzs, cls: 'pm-num' }, { key: 'mavuno', label: 'Mavuno', fmt: P.tzs, cls: 'pm-num' },
            { key: 'ujenzi', label: 'Ujenzi', fmt: P.tzs, cls: 'pm-num' },
            { key: 'special', label: 'Mingine', html: r => P.tzs(Number(r.special) + Number(r.sadaka) + Number(r.other)), cls: 'pm-num' },
            { key: 'income', label: 'Jumla', fmt: P.tzs, cls: 'pm-num pm-strong' },
            { key: 'pledged', label: 'Pangiwa/Ahadi', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Bado', html: r => due(r.outstanding), cls: 'pm-num' }],
            { foot, empty: 'Kigango hiki hakina jumuiya bado.' })}</section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Malipo ya kigango chenyewe (si ya jumuiya) ${year}</h3><small class="pm-muted">${P.tzs(own)}</small></div>
          ${P.table(recent, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' }, { key: 'category_name', label: 'Aina' },
            { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>` : (r.legacy_receipt_no ? `Excel #${P.esc(r.legacy_receipt_no)}` : '—') }],
            { empty: 'Hakuna malipo ya kigango chenyewe mwaka huu.' })}</section>`;
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Kigango ${k.name} ${year}`));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`kigango_${k.name}_${year}`, { Jumuiya: rows.map(r => ({
        Jumuiya: r.unit_name, Familia: Number(r.families), Waumini: Number(r.parishioners), Zaka: Number(r.zaka), Mavuno: Number(r.mavuno), Ujenzi: Number(r.ujenzi),
        Sadaka: Number(r.sadaka), Maalumu: Number(r.special), Mengine: Number(r.other), Jumla: Number(r.income), Pangiwa_Ahadi: Number(r.pledged), Bado: Number(r.outstanding) })) }));
      const pay = el.querySelector('[data-pay]');
      pay && pay.addEventListener('click', () => P.recordPayment({ org_unit_id: k.id }));
    },
  };

  /* ================= JUMUIYA (tabs) ================= */
  const TABS = [['muhtasari', 'Muhtasari', 'dashboard'], ['familia', 'Familia na Waumini', 'family_restroom'], ['zaka', 'Zaka', 'calendar_month'],
    ['michango', 'Michango', 'volunteer_activism'], ['miamala', 'Miamala', 'point_of_sale']];

  V.jumuiya = {
    title: 'Jumuiya',
    async render(el, params) {
      const j = P.ref.unitsById[params.id];
      if (!j) { el.innerHTML = P.empty('Jumuiya haipo.'); return; }
      const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'muhtasari';
      const year = P.year();
      el.innerHTML = `
        ${P.unitCrumbs(j.id)}
        <div class="pm-head"><div><p class="pm-eyebrow">Jumuiya · Kigango cha ${P.esc(P.kigangoOf(j.id)?.name || '')}</p><h1 class="pm-h1">${P.esc(j.name)}</h1>
          <p class="pm-muted">Mwaka ${year}</p></div>
          <div class="pm-actions">${canRecord() ? '<button class="pm-btn pm-btn--primary" data-pay><span class="material-symbols-outlined">add</span>Rekodi malipo</button>' : ''}
            ${canWriteReg() ? '<button class="pm-btn" data-newfam><span class="material-symbols-outlined">add</span>Familia mpya</button>' : ''}
            <button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <nav class="pm-tabs">${TABS.map(([k, l, i]) => `<a href="#/jumuiya?id=${j.id}&tab=${k}" class="${k === tab ? 'is-active' : ''}"><span class="material-symbols-outlined">${i}</span>${l}</a>`).join('')}</nav>
        ${P.reportHeader(`Jumuiya ya ${j.name} — ${TABS.find(t => t[0] === tab)[1]} ${year}`, `Kigango cha ${P.kigangoOf(j.id)?.name || ''}`)}
        <div data-tab>${P.loading()}</div>`;
      const pay = el.querySelector('[data-pay]');
      pay && pay.addEventListener('click', () => P.recordPayment({ jumuiya: j.id }));
      const nf = el.querySelector('[data-newfam]');
      nf && nf.addEventListener('click', () => P.famForm(null, { jumuiya: j.id }));
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Jumuiya ${j.name} ${year}`));
      await JTABS[tab](el.querySelector('[data-tab]'), j, year, params);
    },
  };

  const JTABS = {
    async muhtasari(box, j, year) {
      const k = P.kigangoOf(j.id);
      const [sum, pl, tx] = await Promise.all([
        P.rpc('unit_summary', { p_year: year, p_parent: k ? k.id : null }),
        P.q(P.from('v_pledge_balances').select('campaign_id,campaign_name,pledged,paid,outstanding,source').eq('jumuiya_id', j.id).eq('campaign_year', year).eq('status', 'active').limit(5000)),
        P.q(P.from('v_ledger').select('category_name,net_amount').eq('jumuiya_id', j.id).eq('status', 'posted').gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).limit(10000)),
      ]);
      const me = sum.find(r => r.unit_id === j.id) || {};
      const byCamp = {};
      pl.forEach(p => { const c = byCamp[p.campaign_id] ||= { campaign_id: p.campaign_id, name: p.campaign_name, pledged: 0, paid: 0, outstanding: 0, n: 0 };
        c.pledged += Number(p.pledged); c.paid += Number(p.paid); c.outstanding += Number(p.outstanding); c.n++; });
      const byCat = {};
      tx.forEach(t => { byCat[t.category_name] = (byCat[t.category_name] || 0) + Number(t.net_amount); });
      const camps = Object.values(byCamp).sort((a, b) => b.pledged - a.pledged);
      box.innerHTML = `
        <section class="pm-kpis">
          ${P.kpi('Familia', P.num(me.families), 'family_restroom')}
          ${P.kpi('Waumini', P.num(me.parishioners), 'groups')}
          ${P.kpi(`Makusanyo ${year}`, P.tzs(me.income), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Zaka', P.tzs(me.zaka), 'calendar_month')}
          ${P.kpi('Pangiwa / Ahadi', P.tzs(me.pledged), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(me.outstanding), 'pending_actions', 'pm-kpi--rose')}
        </section>
        <section class="pm-grid2">
          <div class="pm-card"><h3 class="pm-h3">Michango iliyopangwa / kuahidiwa ${year}</h3>
            ${P.table(camps, [{ key: 'name', label: 'Mchango', html: c => `<a class="pm-link" href="#/jumuiya?id=${j.id}&tab=michango&campaign=${c.campaign_id}">${P.esc(c.name)}</a><br><small class="pm-muted">${c.n} walipaji</small>` },
              { key: 'pledged', label: 'Pangiwa/Ahadi', fmt: P.tzs, cls: 'pm-num' }, { key: 'paid', label: 'Ametoa', fmt: P.tzs, cls: 'pm-num' },
              { key: 'outstanding', label: 'Bado', html: c => due(c.outstanding), cls: 'pm-num' },
              { key: 'pct', label: '%', html: c => c.pledged ? P.progress(c.paid / c.pledged * 100) : '—' }], { empty: 'Hakuna michango iliyopangwa kwa jumuiya hii mwaka huu.' })}</div>
          <div class="pm-card"><h3 class="pm-h3">Makusanyo kwa aina ${year}</h3>
            ${P.table(Object.entries(byCat).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v), [{ key: 'k', label: 'Aina' }, { key: 'v', label: 'Jumla', fmt: P.tzs, cls: 'pm-num' }],
              { empty: 'Hakuna malipo mwaka huu.', foot: { k: '<b>JUMLA</b>', v: `<b>${P.tzs(Object.values(byCat).reduce((a, b) => a + b, 0))}</b>` } })}</div>
        </section>`;
    },

    async familia(box, j, year) {
      const [fams, people] = await Promise.all([
        P.rpc('family_summary', { p_year: year, p_jumuiya: j.id }),
        P.q(P.from('parishioners').select('id,full_name,relationship,phone,family_id,membership_status,is_zaka_payer').eq('jumuiya_id', j.id).order('full_name').limit(2000)),
      ]);
      const byFam = {};
      people.forEach(p => { (byFam[p.family_id] ||= []).push(p); });
      const foot = { family_name: '<b>JUMLA</b>', members: P.num(P.sum(fams, 'members')), zaka: P.tzs(P.sum(fams, 'zaka')), income: `<b>${P.tzs(P.sum(fams, 'income'))}</b>`,
        pledged: P.tzs(P.sum(fams, 'pledged')), outstanding: P.tzs(P.sum(fams, 'outstanding')) };
      box.innerHTML = `<p class="pm-muted pm-small">${fams.length} familia · ${people.filter(p => p.membership_status === 'active').length} waumini. Bonyeza familia kuona kila kitu chake.</p>` +
        P.table(fams, [
          { key: 'family_code', label: 'Na.' },
          { key: 'family_name', label: 'Familia', html: f => `<a class="pm-link" href="#/family?id=${f.family_id}">${P.esc(f.family_name)}</a>${f.head_name ? `<br><small class="pm-muted">Mkuu: ${P.esc(f.head_name)}</small>` : ''}
              <br><small class="pm-muted">${(byFam[f.family_id] || []).map(p => P.esc(p.full_name.split(' ')[0])).join(', ')}</small>` },
          { key: 'members', label: 'Wanafamilia', cls: 'pm-num' },
          { key: 'zaka', label: `Zaka ${year}`, fmt: P.tzs, cls: 'pm-num' }, { key: 'income', label: `Michango yote ${year}`, fmt: P.tzs, cls: 'pm-num pm-strong' },
          { key: 'pledged', label: 'Pangiwa/Ahadi', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Bado', html: f => due(f.outstanding), cls: 'pm-num' },
          { key: 'last_payment', label: 'Malipo ya mwisho', fmt: P.date },
          { key: 'family_id', label: '', html: f => canRecord() ? `<button class="pm-btn pm-btn--sm" data-payfam="${f.family_id}" data-name="${P.esc(f.family_name)}">Lipa</button>` : '' }],
          { foot, empty: 'Jumuiya hii haina familia bado.' });
      box.querySelectorAll('[data-payfam]').forEach(b => b.addEventListener('click', () =>
        P.recordPayment({ jumuiya: j.id, payerName: b.dataset.name, payer: { kind: 'family', id: b.dataset.payfam } })));
    },

    async zaka(box, j, year) {
      const mk = i => `m${String(i + 1).padStart(2, '0')}`;
      const [tot, grid, people] = await Promise.all([
        P.rpc('zaka_grid_tree', { p_year: year, p_level: 'jumuiya', p_scope: j.id }),
        P.rpc('zaka_grid_tree', { p_year: year, p_level: 'parishioner', p_scope: j.id }),
        P.q(P.from('parishioners').select('id,full_name,family_id,is_zaka_payer,membership_status,families(family_name,family_code)').eq('jumuiya_id', j.id).eq('membership_status', 'active').limit(2000)),
      ]);
      const months = year < P.thisYear() ? 12 : year > P.thisYear() ? 0 : new Date().getMonth() + 1;
      const all = tot.find(r => r.group_id === j.id) || { total: 0 };
      const byName = grid.filter(r => r.group_id);
      const g = Object.fromEntries(byName.map(r => [r.group_id, r]));
      const named = P.sum(byName, 'total');
      // per-person tracking only where this jumuiya records zaka by name
      const perPerson = byName.length > 0;
      const rows = people.filter(p => g[p.id] || (perPerson && p.is_zaka_payer)).map(p => {
        const r = g[p.id] || {};
        const unpaid = P.MONTHS.filter((m, i) => i < months && !(Number(r[mk(i)]) > 0)).length;
        return { ...r, id: p.id, name: p.full_name, family_id: p.family_id, family: p.families?.family_name || '—', code: p.families?.family_code || '', total: Number(r.total || 0), months_unpaid: unpaid };
      });
      const mcols = P.MONTHS.map((m, i) => ({ key: mk(i), label: m, fmt: v => Number(v) ? P.num(v) : '', cls: 'pm-num' }));
      const pcols = P.MONTHS.map((m, i) => ({ key: mk(i), label: m, fmt: v => Number(v) ? P.num(v) : (i < months ? '<span class="pm-due">·</span>' : ''), cls: 'pm-num' }));
      const jrow = [{ ...all, label: `Jumla ya Jumuiya ya ${j.name}` }];
      const unnamed = Number(all.total || 0) - named;
      box.innerHTML = `<div class="pm-row"><p class="pm-muted pm-small">Zaka yote ya jumuiya kwa mwezi ${year}${unnamed > 0 ? ` — ${P.tzs(unnamed)} imewasilishwa na jumuiya kwa jumla (bila majina ya waliotoa), kama kwenye daftari la Excel` : ''}.</p>
          <div class="pm-actions">${canRecord() ? '<button class="pm-btn pm-btn--sm pm-btn--primary" data-zaka>Rekodi zaka</button>' : ''}<button class="pm-btn pm-btn--sm" data-xls>Excel</button></div></div>
        <section class="pm-card">${P.table(jrow, [{ key: 'label', label: 'Jumuiya' }, ...mcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' }], { empty: `Hakuna zaka iliyorekodiwa ${year}.` })}</section>
        <section class="pm-card"><h3 class="pm-h3">Kwa jina la muumini, kwa familia</h3>
        ${rows.length ? `<p class="pm-muted pm-small">${rows.length} waumini. ${perPerson ? 'Nukta nyekundu = mwezi ambao bado hajatoa.' : ''}</p>` : ''}` +
        P.groupedTable(rows, [{ key: 'name', label: 'Muumini' }, ...pcols, { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' },
          { key: 'months_unpaid', label: 'Hajatoa', html: r => r.months_unpaid ? `<span class="pm-due">${r.months_unpaid}</span>` : '0', cls: 'pm-num' }],
        { levels: [{ key: r => r.family_id, label: k => rows.find(r => r.family_id === k)?.family || '—',
          order: k => Number(rows.find(r => r.family_id === k)?.code) || 9999,
          html: k => `<a href="#/family?id=${k}">${P.esc(rows.find(r => r.family_id === k)?.family || '—')}</a>` }],
          sums: [...mcols.map(c => c.key), 'total'], fmt: v => v ? P.num(v) : '',
          empty: 'Jumuiya hii haijarekodi zaka kwa jina la kila muumini mwaka huu. Ukirekodi zaka ukichagua muumini, itaonekana hapa kwa familia yake.' }) + '</section>';
      const zb = box.querySelector('[data-zaka]');
      zb && zb.addEventListener('click', () => P.recordPayment({ jumuiya: j.id, category_id: P.ref.cats.find(c => c.code === 'ZAKA')?.id }));
      box.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`zaka_${j.name}_${year}`, {
        Jumuiya: jrow.map(r => ({ Jumuiya: j.name, ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(r[mk(i)]) || 0])), Jumla: Number(r.total || 0) })),
        Waumini: rows.map(r => ({ Familia: r.family, Muumini: r.name, ...Object.fromEntries(P.MONTHS.map((m, i) => [m, Number(r[mk(i)]) || 0])), Jumla: r.total, Hajatoa: r.months_unpaid })) }));
    },

    async michango(box, j, year, params) {
      const camps = yearCamps().filter(c => c.giver_level !== 'kigango');
      const pl = await P.q(P.from('v_pledge_balances').select('*').eq('jumuiya_id', j.id).eq('campaign_year', year).eq('status', 'active').limit(10000));
      const count = id => pl.filter(p => p.campaign_id === id).length;
      const ordered = [...camps].sort((a, b) => count(b.id) - count(a.id) || a.name.localeCompare(b.name));
      const sel = ordered.find(c => c.id === params.campaign) || ordered[0];
      if (!sel) { box.innerHTML = P.empty(`Hakuna michango (kampeni) ya mwaka ${year}. Iunde kwenye "Michango na Kampeni".`); return; }
      const rows = pl.filter(p => p.campaign_id === sel.id);
      const who = r => r.parishioner_name || r.family_name || r.org_unit_name;
      const chips = `<div class="pm-chips">${ordered.map(c => `<a class="pm-chip ${c.id === sel.id ? 'is-active' : ''}" href="#/jumuiya?id=${j.id}&tab=michango&campaign=${c.id}">${P.esc(c.name)} <small>${count(c.id) || ''}</small></a>`).join('')}</div>`;
      const assignBtn = canPledge() && sel.giver_level && sel.amount_mode === 'assigned' && sel.giver_level !== 'kigango'
        ? `<button class="pm-btn pm-btn--sm" data-assign>Pangia wote wa jumuiya hii</button>` : '';
      const pledgeBtn = canPledge() && sel.amount_mode !== 'free' ? '<button class="pm-btn pm-btn--sm" data-pledge>+ Ahadi / pangia mmoja</button>' : '';
      let table;
      if (sel.amount_mode === 'free' && !rows.length) {
        // free giving: who gave and how much (no obligation)
        const tx = await P.q(P.from('v_ledger').select('payer_name,net_amount,txn_date,family_id,parishioner_id').eq('campaign_id', sel.id).eq('jumuiya_id', j.id).eq('status', 'posted').limit(5000));
        const by = {};
        tx.forEach(t => { const k = t.family_id || t.parishioner_id || t.payer_name; const x = by[k] ||= { name: t.payer_name, total: 0, n: 0, last: t.txn_date }; x.total += Number(t.net_amount); x.n++; if (t.txn_date > x.last) x.last = t.txn_date; });
        const list = Object.values(by).sort((a, b) => b.total - a.total);
        table = P.table(list, [{ key: 'name', label: 'Mtoaji' }, { key: 'n', label: 'Mara', cls: 'pm-num' }, { key: 'total', label: 'Ametoa', fmt: P.tzs, cls: 'pm-num pm-strong' }, { key: 'last', label: 'Mwisho', fmt: P.date }],
          { empty: 'Hakuna aliyetoa bado (mchango wa hiari).', foot: { name: '<b>JUMLA</b>', total: `<b>${P.tzs(P.sum(list, 'total'))}</b>` } });
      } else {
        const foot = { who: '<b>JUMLA</b>', pledged: P.tzs(P.sum(rows, 'pledged')), paid: `<b>${P.tzs(P.sum(rows, 'paid'))}</b>`, outstanding: P.tzs(P.sum(rows, 'outstanding')), excess: P.tzs(P.sum(rows, 'excess')) };
        table = P.table(rows.sort((a, b) => String(who(a)).localeCompare(String(who(b)))), [
          { key: 'who', label: sel.giver_level === 'parishioner' ? 'Muumini' : sel.giver_level === 'family' ? 'Familia' : 'Mtoaji',
            html: r => (r.family_id ? `<a class="pm-link" href="#/family?id=${r.family_id}">${P.esc(who(r))}</a>` : P.esc(who(r))) },
          { key: 'source', label: 'Aina', html: r => r.source === 'assigned' ? P.badge('Amepangiwa', 'gold') : P.badge('Ameahidi', 'muted') },
          { key: 'pledged', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'paid', label: 'Ametoa', fmt: P.tzs, cls: 'pm-num' },
          { key: 'outstanding', label: 'Bado', html: r => due(r.outstanding), cls: 'pm-num' },
          { key: 'excess', label: 'Ziada', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' },
          { key: 'completion_pct', label: '%', html: r => `${P.pct(r.completion_pct)} ${P.progress(r.completion_pct)}` },
          { key: 'pledge_id', label: '', html: r => canRecord() && Number(r.outstanding) > 0 ? `<button class="pm-btn pm-btn--sm" data-paypl="${r.pledge_id}">Lipa</button>` : '' }],
          { foot, empty: sel.amount_mode === 'assigned' ? 'Bado hakuna aliyepangiwa — bonyeza "Pangia wote".' : 'Hakuna ahadi bado.' });
      }
      let monthly = '';
      if (sel.frequency === 'monthly') {
        const lvl = sel.giver_level === 'family' ? 'family' : sel.giver_level === 'jumuiya' ? 'jumuiya' : 'parishioner';
        const grid = await P.rpc('campaign_month_grid', { p_campaign: sel.id, p_level: lvl, p_scope: j.id });
        monthly = `<section class="pm-card"><h3 class="pm-h3">Kwa mwezi</h3>${P.table(grid, [{ key: 'group_name', label: 'Mtoaji' },
          ...P.MONTHS.map((m, i) => ({ key: `m${String(i + 1).padStart(2, '0')}`, label: m, fmt: v => Number(v) ? P.num(v) : '', cls: 'pm-num' })), { key: 'total', label: 'Jumla', fmt: P.num, cls: 'pm-num pm-strong' }], { empty: 'Hakuna malipo bado.' })}</section>`;
      }
      box.innerHTML = chips + `<section class="pm-card"><div class="pm-row"><div><h3 class="pm-h3">${P.esc(sel.name)}</h3>${P.rulesBadges(sel)}</div>
          <div class="pm-actions">${assignBtn}${pledgeBtn}${canRecord() ? '<button class="pm-btn pm-btn--sm pm-btn--primary" data-pay>Rekodi malipo</button>' : ''}</div></div>${table}</section>` + monthly;
      const reload = () => P.reload();
      const ab = box.querySelector('[data-assign]');
      ab && ab.addEventListener('click', async () => {
        const per = sel.giver_level === 'parishioner' && Object.keys(sel.relation_rates || {}).length;
        const v = await P.modal({ title: `Pangia wote — ${sel.name}`, submit: 'Pangia', body: `<p class="pm-muted">${LEVEL[sel.giver_level]} wa Jumuiya ya ${P.esc(j.name)} ambaye bado hajapangiwa atapangiwa kiasi hiki. Waliokwisha pangiwa au kuahidi hawabadilishwi.</p>
          <div class="pm-form"><label>Kiasi ${sel.frequency === 'monthly' ? 'kwa mwezi' : ''}<input name="amount" type="number" min="1" value="${sel.default_amount || ''}" ${per ? 'placeholder="Kwa uhusiano (Baba/Mama/Mtoto…)"' : 'required'}></label></div>
          ${per ? `<p class="pm-muted pm-small">Ukiacha wazi, viwango vya kanuni vinatumika: ${Object.entries(sel.relation_rates).map(([k, x]) => `${k} ${P.num(x)}`).join(' · ')}</p>` : ''}` });
        if (!v) return;
        const r = await P.rpc('assign_campaign', { p_campaign: sel.id, p_amount: v.amount ? Number(v.amount) : null, p_scope: j.id });
        Toast.success(`Wamepangiwa: ${r.created}${r.skipped_no_rate ? ` · bila kiwango: ${r.skipped_no_rate}` : ''}`); reload();
      });
      const pb = box.querySelector('[data-pledge]');
      pb && pb.addEventListener('click', async () => {
        let payer = null;
        const v = await P.modal({ title: `${sel.name} — mtu mmoja`, body: `<div class="pm-form">
          <label class="pm-span2">Muumini / familia<div class="pm-search"><input data-payer-search name="who" autocomplete="off" required><div data-payer-results class="pm-search__results"></div></div></label>
          <label>Kiasi<input name="amount" type="number" min="1" required value="${sel.default_amount || ''}"></label>
          <label>Aina<select name="source"><option value="pledge">Ameahidi</option><option value="assigned" ${sel.amount_mode === 'assigned' ? 'selected' : ''}>Amepangiwa</option></select></label></div>`,
          onOpen: m => P.payerPicker(m, { jumuiya: j.id, onPick: p => { payer = p; } }) });
        if (!v) return;
        if (!payer) { Toast.error('Chagua kutoka kwenye orodha.'); return; }
        await P.rpc('create_pledge', { p: { campaign_id: sel.id, amount: Number(v.amount) * (sel.frequency === 'monthly' ? 12 : 1), source: v.source, [`${payer.kind}_id`]: payer.id } });
        Toast.success('Imehifadhiwa.'); reload();
      });
      const payb = box.querySelector('[data-pay]');
      payb && payb.addEventListener('click', () => P.recordPayment({ jumuiya: j.id, category_id: sel.category_id, campaign_id: sel.id }));
      box.querySelectorAll('[data-paypl]').forEach(b => b.addEventListener('click', () => {
        const r = rows.find(x => x.pledge_id === b.dataset.paypl);
        P.recordPayment({ jumuiya: j.id, category_id: r.category_id, campaign_id: r.campaign_id, payerName: who(r),
          payer: r.parishioner_id ? { kind: 'parishioner', id: r.parishioner_id } : r.family_id ? { kind: 'family', id: r.family_id } : { kind: 'org_unit', id: r.org_unit_id } });
      }));
    },

    async miamala(box, j, year, params) {
      const cat = params.category || '';
      let q = P.from('v_ledger').select('*').eq('jumuiya_id', j.id).gte('txn_date', P.yearFrom()).lte('txn_date', `${year}-12-31`).neq('status', 'rejected')
        .order('txn_date', { ascending: false }).order('txn_no', { ascending: false }).limit(2000);
      if (cat) q = q.eq('category_id', cat);
      const rows = await P.q(q);
      box.innerHTML = `<form class="pm-filters" data-f><label>Aina<select name="category">${P.catOptions(null, { blank: 'Zote', selected: cat })}</select></label><button class="pm-btn">Chuja</button>
          <button type="button" class="pm-btn" data-xls>Excel</button></form>
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
      box.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`miamala_${j.name}_${year}`, { Miamala: rows.map(r => ({ Tarehe: r.txn_date, Familia: r.family_name, Mlipaji: r.payer_name,
        Aina: r.category_name, Kampeni: r.campaign_name, Kiasi: Number(r.net_amount), Njia: P.METHODS[r.payment_method], Risiti: r.receipt_no || r.legacy_receipt_no, Hali: r.status })) }));
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
        P.rpc('zaka_grid', { p_year: year, p_level: 'parishioner', p_scope: f.jumuiya_id }),
      ]);
      const g = Object.fromEntries(grid.map(r => [r.group_id, r]));
      const who = r => r.parishioner_name || r.family_name || r.org_unit_name;
      const members = f.parishioners.map(p => ({ ...p, ...(g[p.id] || {}), total: Number(g[p.id]?.total || 0) }));
      el.innerHTML = `
        ${P.unitCrumbs(f.jumuiya_id, [{ label: f.family_name }])}
        <div class="pm-head"><div><p class="pm-eyebrow">Familia ${f.family_code ? 'Na. ' + P.esc(f.family_code) : ''}</p><h1 class="pm-h1">${P.esc(f.family_name)}</h1>
          <p class="pm-muted">${members.length} wanafamilia${f.phone ? ' · ' + P.esc(f.phone) : ''} · Mwaka ${year}</p></div>
          <div class="pm-actions">${canRecord() ? '<button class="pm-btn pm-btn--primary" data-pay><span class="material-symbols-outlined">add</span>Rekodi malipo</button>' : ''}
            ${canWriteReg() ? '<button class="pm-btn" data-addp>+ Mwanafamilia</button><button class="pm-btn" data-editf>Hariri familia</button>' : ''}
            <a class="pm-btn" href="#/statement?family=${f.id}"><span class="material-symbols-outlined">description</span>Taarifa kamili</a></div></div>
        <section class="pm-kpis">
          ${P.kpi(`Michango ${year}`, P.tzs(P.sum(tx, 'net_amount')), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Zaka', P.tzs(P.sum(members, 'total')), 'calendar_month')}
          ${P.kpi('Pangiwa / Ahadi', P.tzs(P.sum(pl, 'pledged')), 'assignment')}
          ${P.kpi('Bado kulipwa', P.tzs(P.sum(pl, 'outstanding')), 'pending_actions', 'pm-kpi--rose')}
        </section>
        <section class="pm-card"><h3 class="pm-h3">Wanafamilia na zaka ${year}</h3>
          ${P.table(members, [{ key: 'full_name', label: 'Jina', html: p => P.esc(p.full_name) + (p.id === f.head_parishioner_id ? ' ' + P.badge('Mkuu', 'gold') : '') + (p.membership_status !== 'active' ? ' ' + P.badge(p.membership_status, 'muted') : '') },
            { key: 'relationship', label: 'Uhusiano' }, { key: 'phone', label: 'Simu' },
            ...P.MONTHS.map((m, i) => ({ key: `m${String(i + 1).padStart(2, '0')}`, label: m, fmt: v => Number(v) ? P.num(v) : '', cls: 'pm-num' })),
            { key: 'total', label: 'Zaka', fmt: P.num, cls: 'pm-num pm-strong' },
            { key: 'id', label: '', html: p => canWriteReg() ? `<button class="pm-btn pm-btn--sm" data-editp="${p.id}">Hariri</button>` : '' }], { empty: 'Familia haina wanafamilia bado.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Michango iliyopangwa / ahadi ${year}</h3>
          ${P.table(pl, [{ key: 'campaign_name', label: 'Mchango' }, { key: 'who', label: 'Wa', html: r => P.esc(who(r)) },
            { key: 'source', label: 'Aina', html: r => r.source === 'assigned' ? P.badge('Amepangiwa', 'gold') : P.badge('Ameahidi', 'muted') },
            { key: 'pledged', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'paid', label: 'Ametoa', fmt: P.tzs, cls: 'pm-num' },
            { key: 'outstanding', label: 'Bado', html: r => due(r.outstanding), cls: 'pm-num' },
            { key: 'pledge_id', label: '', html: r => canRecord() && Number(r.outstanding) > 0 ? `<button class="pm-btn pm-btn--sm" data-paypl="${r.pledge_id}">Lipa</button>` : '' }],
            { empty: 'Hakuna michango iliyopangwa kwa familia hii mwaka huu.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Malipo yote ${year}</h3>
          ${P.table(tx, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' },
            { key: 'category_name', label: 'Aina', html: r => P.esc(r.category_name) + (r.campaign_name ? `<br><small class="pm-muted">${P.esc(r.campaign_name)}</small>` : '') },
            { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' },
            { key: 'receipt_no', label: 'Risiti', html: r => r.receipt_no ? `<a class="pm-link" target="_blank" href="receipt.html?tx=${r.id}">${P.esc(r.receipt_no)}</a>` : (r.legacy_receipt_no ? `Excel #${P.esc(r.legacy_receipt_no)}` : '—') }],
            { empty: 'Hakuna malipo mwaka huu.' })}</section>`;
      const pay = el.querySelector('[data-pay]');
      pay && pay.addEventListener('click', () => P.recordPayment({ jumuiya: f.jumuiya_id, payerName: f.family_name, payer: { kind: 'family', id: f.id } }));
      el.querySelectorAll('[data-paypl]').forEach(b => b.addEventListener('click', () => {
        const r = pl.find(x => x.pledge_id === b.dataset.paypl);
        P.recordPayment({ jumuiya: f.jumuiya_id, category_id: r.category_id, campaign_id: r.campaign_id, payerName: who(r),
          payer: r.parishioner_id ? { kind: 'parishioner', id: r.parishioner_id } : { kind: 'family', id: r.family_id } });
      }));
      const famList = [f];
      const ap = el.querySelector('[data-addp]'); ap && ap.addEventListener('click', () => P.personForm(f, null, { families: famList }));
      const ef = el.querySelector('[data-editf]'); ef && ef.addEventListener('click', () => P.famForm(f, { jumuiya: f.jumuiya_id }));
      el.querySelectorAll('[data-editp]').forEach(b => b.addEventListener('click', async () => {
        const others = await P.q(P.from('families').select('id,family_name,jumuiya_id').eq('jumuiya_id', f.jumuiya_id).order('family_name').limit(500));
        P.personForm(f, f.parishioners.find(p => p.id === b.dataset.editp), { families: others });
      }));
    },
  };
})();
