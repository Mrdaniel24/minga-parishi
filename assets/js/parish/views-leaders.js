/* Role-specific home for Kigango and Jumuiya leaders. */
(function () {
  const P = window.Parish;
  const dashboard = P.views.dashboard;
  if (!dashboard) return;
  const parishDashboardRender = dashboard.render;

  const leaderRole = () => {
    const roles = P.access.roles || [];
    if (P.access.platform_admin || roles.some(r => !r.org_unit_id)) return null;
    const scoped = roles.filter(r => r.org_unit_id);
    return scoped.length === 1 && ['kigango_leader', 'jumuiya_leader'].includes(scoped[0].role) ? scoped[0] : null;
  };

  dashboard.render = async (el, params) => {
    const role = leaderRole();
    const unit = role && P.ref.unitsById[role.org_unit_id];
    if (!role || !unit || !unit.is_active || !['kigango', 'jumuiya'].includes(unit.unit_type)) {
      return parishDashboardRender.call(dashboard, el, params);
    }

    const year = P.year();
    const kigango = unit.unit_type === 'kigango';
    const title = kigango ? `Kigango cha ${unit.name}` : `Jumuiya ya ${unit.name}`;
    const children = kigango
      ? P.ref.units.filter(u => u.parent_id === unit.id && u.unit_type === 'jumuiya' && u.is_active)
      : [];
    const scopedDashboard = P.rpc('parish_dashboard', { p_year: year, p_scope: unit.id });
    const childRows = kigango ? P.rpc('unit_summary', { p_year: year, p_parent: unit.id }) : Promise.resolve([]);
    const familyRows = kigango ? Promise.resolve([]) : P.rpc('family_summary', { p_year: year, p_jumuiya: unit.id });
    const attendance = !kigango
      ? P.q(P.from('attendance_sessions').select('id,held_on,title', { count: 'exact' })
        .eq('org_unit_id', unit.id).gte('held_on', `${year}-01-01`).lte('held_on', `${year}-12-31`)
        .order('held_on', { ascending: false }).limit(5))
      : Promise.resolve({ data: [], count: 0 });
    const [d, childrenSummary, families, sessions, notices] = await Promise.all([
      scopedDashboard, childRows, familyRows, attendance, P.announcementsHtml(),
    ]);
    const counts = d.counts || {}, totals = d.totals || {};
    const recentSession = sessions.data?.[0];
    const shortcuts = kigango
      ? `<a href="#/kigango?id=${unit.id}"><span class="material-symbols-outlined">account_tree</span><b>Muhtasari wa kigango</b><small>Ona takwimu na taarifa za jumuiya</small></a>
         <a href="#/reports?scope=${unit.id}"><span class="material-symbols-outlined">bar_chart</span><b>Taarifa ya fedha</b><small>Ona mapato, matumizi na salio la eneo</small></a>`
      : `<a href="#/jumuiya?id=${unit.id}&tab=mahudhurio"><span class="material-symbols-outlined">how_to_reg</span><b>Mahudhurio</b><small>${P.can('attendance.record') ? 'Rekodi au pitia mikutano' : 'Pitia mikutano ya jumuiya'}</small></a>
         <a href="#/jumuiya?id=${unit.id}&tab=familia"><span class="material-symbols-outlined">family_restroom</span><b>Familia na waumini</b><small>Fungua orodha ya familia za jumuiya</small></a>
         <a href="#/jumuiya?id=${unit.id}&tab=zaka"><span class="material-symbols-outlined">calendar_month</span><b>Zaka</b><small>Pitia taarifa za zaka za mwaka</small></a>`;
    const attendanceKpi = !kigango
      ? P.kpi('Mikutano mwaka huu', P.num(sessions.count || 0), 'event_available')
      : P.kpi('Jumuiya hai', P.num(children.length), 'diversity_3');

    el.innerHTML = `
      <div class="pm-leader-home">
        <header class="pm-leader-hero">
          <div><p class="pm-eyebrow">DASHIBODI YA ${kigango ? 'KIONGOZI WA KIGANGO' : 'KIONGOZI WA JUMUIYA'}</p>
            <h1>${P.esc(title)}</h1>
            <p>${P.esc(P.ref.parish.short_name || P.ref.parish.official_name || 'Parokia')} · Mwaka ${year}</p>
            ${!kigango ? `<small>Kigango: ${P.esc(P.kigangoOf(unit.id)?.name || '—')}</small>` : ''}
          </div>
          <span class="material-symbols-outlined" aria-hidden="true">${kigango ? 'account_tree' : 'diversity_3'}</span>
        </header>

        ${notices}

        <section class="pm-kpis pm-leader-kpis" aria-label="Muhtasari wa eneo">
          ${P.kpi('Waumini hai', P.num(counts.parishioners || 0), 'groups')}
          ${P.kpi('Familia hai', P.num(counts.families || 0), 'family_restroom')}
          ${attendanceKpi}
          ${P.kpi(`Makusanyo ${year}`, P.tzs(totals.income_year || 0), 'savings', 'pm-kpi--teal')}
          ${P.kpi('Ahadi zilizobaki', P.tzs(totals.outstanding_pledges || 0), 'pending_actions', 'pm-kpi--gold')}
        </section>

        <section class="pm-card pm-leader-shortcuts" aria-labelledby="leader-shortcuts-title">
          <div class="pm-row"><div><h2 id="leader-shortcuts-title" class="pm-h3">Kazi za haraka</h2>
            <p class="pm-muted pm-small">Fungua taarifa na shughuli za ${P.esc(title.toLowerCase())}.</p></div></div>
          <div class="pm-leader-links">${shortcuts}</div>
        </section>

        ${kigango ? `<section class="pm-card pm-leader-section">
          <div class="pm-row"><div><h2 class="pm-h3">Jumuiya za kigango</h2><p class="pm-muted pm-small">Chagua jumuiya kufungua taarifa zake.</p></div>
            <a class="pm-btn pm-btn--sm" href="#/kigango?id=${unit.id}">Ona kigango</a></div>
          <nav class="pm-unit-name-list pm-leader-units" aria-label="Jumuiya za kigango hiki">${children.map(j => {
            const summary = childrenSummary.find(row => row.unit_id === j.id) || {};
            return `<a href="#/jumuiya?id=${j.id}"><span><b>Jumuiya ya ${P.esc(j.name)}</b><small>${P.num(summary.families || 0)} familia · ${P.num(summary.parishioners || 0)} waumini</small></span><span class="material-symbols-outlined" aria-hidden="true">chevron_right</span></a>`;
          }).join('') || '<p class="pm-muted">Hakuna jumuiya hai zilizounganishwa na kigango hiki.</p>'}</nav>
        </section>` : `<section class="pm-card pm-leader-section">
          <div class="pm-row"><div><h2 class="pm-h3">Mahudhurio ya jumuiya</h2><p class="pm-muted pm-small">${recentSession ? `Mkutano wa mwisho: ${P.date(recentSession.held_on)} · ${P.esc(recentSession.title)}` : `Bado hakuna mkutano uliohifadhiwa mwaka ${year}.`}</p></div>
            <a class="pm-btn pm-btn--sm pm-btn--primary" href="#/jumuiya?id=${unit.id}&tab=mahudhurio">${P.can('attendance.record') ? 'Fungua mahudhurio' : 'Ona mahudhurio'}</a></div>
          <div class="pm-leader-family-summary"><span><b>${P.num(families.length)}</b><small>Familia hai</small></span><span><b>${P.num(counts.parishioners || 0)}</b><small>Waumini hai</small></span><span><b>${P.num(sessions.count || 0)}</b><small>Mikutano ${year}</small></span></div>
        </section>`}

        <section class="pm-card pm-leader-section"><div class="pm-row"><h2 class="pm-h3">Miamala ya karibuni</h2>
          <a class="pm-link" href="#/reports?scope=${unit.id}">Taarifa ya fedha</a></div>
          <div class="pm-mobile-hide">${P.table(d.recent || [], [
            { key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'payer_name', label: 'Mlipaji' },
            { key: 'category_name', label: 'Aina' }, { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' },
            { key: 'receipt_no', label: 'Risiti' },
          ], { empty: `Bado hakuna miamala ya ${year} kwenye eneo hili.` })}</div>
          ${P.mobileTransactionList(d.recent || [], `Bado hakuna miamala ya ${year} kwenye eneo hili.`)}
        </section>
      </div>`;
  };

})();
