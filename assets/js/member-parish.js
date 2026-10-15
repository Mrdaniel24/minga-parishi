/* ============================================
   Kanisa Hub — the member's parish record
   (member/dashboard.html card, member/contributions.html page)

   Reads public.my_member_summary(): the signed-in person's register entry,
   jumuiya, giving, Zaka months, pledges and receipts — straight from the
   parish ledger, so it always matches the parish reports. If the account is
   not yet linked to the register, shows the link-request form.
   ============================================ */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tzs = v => 'TZS ' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const d = v => v ? new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
  const KIND = { zaka: 'Zaka', mavuno: 'Mavuno', ujenzi: 'Ujenzi', sadaka: 'Sadaka', shukrani: 'Shukrani', special: 'Michango maalumu', income_other: 'Mengineyo' };

  const card = (inner, extra = '') => `<section class="mp-card ${extra}">${inner}</section>`;

  async function linkForm(box, summary) {
    const req = summary.request;
    if (req && req.status === 'pending') {
      box.innerHTML = card(`<div class="mp-row"><span class="material-symbols-outlined mp-ico">hourglass_top</span><div>
        <h3>Ombi lako linasubiri uthibitisho</h3>
        <p>Umeomba kuunganishwa na rejista ya parokia kama <b>${esc(req.full_name)}</b>. Kiongozi wa jumuiya au msimamizi atathibitisha, kisha utaona michango, ahadi, zaka na risiti zako hapa.</p></div></div>`, 'mp-card--gold');
      return;
    }
    const { data: units } = await supabase.from('org_units').select('id,name,unit_type,parent_id').in('unit_type', ['kigango', 'jumuiya']).eq('is_active', true).order('name');
    const kig = Object.fromEntries((units || []).filter(u => u.unit_type === 'kigango').map(u => [u.id, u.name]));
    const opts = (units || []).filter(u => u.unit_type === 'jumuiya')
      .sort((a, b) => (kig[a.parent_id] || '').localeCompare(kig[b.parent_id] || '') || a.name.localeCompare(b.name))
      .map(u => `<option value="${u.id}" ${u.id === mine ? 'selected' : ''}>${esc(u.name)} — ${esc(kig[u.parent_id] || '')}</option>`).join('');
    const prof = (typeof getUserProfile === 'function' ? await getUserProfile() : null) || {};
    // preselect the jumuiya chosen at registration (profile department = jumuiya group)
    let mine = null;
    if (prof.department_id) {
      const { data: dep } = await supabase.from('departments').select('org_unit_id').eq('id', prof.department_id).maybeSingle();
      mine = dep && dep.org_unit_id;
    }
    box.innerHTML = card(`<div class="mp-row"><span class="material-symbols-outlined mp-ico">how_to_reg</span><div>
      <h3>Unganisha akaunti yako na rejista ya parokia</h3>
      <p>Chagua jumuiya yako. Ukithibitishwa utaona michango yako ya Zaka, Mavuno, Ujenzi na mingineyo, ahadi zako, risiti zako, na utapokea matangazo na mazungumzo ya jumuiya yako.</p></div></div>
      ${req && req.status === 'rejected' ? `<p class="mp-note">Ombi lako la awali lilikataliwa${req.decision_note ? ': ' + esc(req.decision_note) : ''}. Unaweza kuomba tena.</p>` : ''}
      <form class="mp-form" data-link>
        <label>Jina kamili<input name="full_name" required value="${esc(prof.full_name || '')}"></label>
        <label>Simu<input name="phone" value="${esc(prof.phone || '')}"></label>
        <label>Jumuiya<select name="jumuiya_id" required><option value="">Chagua jumuiya…</option>${opts}</select></label>
        <label>Familia (jina la mkuu wa familia)<input name="family_name" placeholder="mf. Familia ya …"></label>
        <button class="mp-btn">Tuma ombi</button></form>`);
    box.querySelector('[data-link]').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      const { error } = await supabase.rpc('request_parish_link', { p: Object.fromEntries(new FormData(e.target)) });
      btn.disabled = false;
      if (error) { (window.Toast ? Toast.error(error.message) : alert(error.message)); return; }
      window.Toast && Toast.success('Ombi limetumwa. Utaarifiwa likithibitishwa.');
      render(box, box.dataset.mode);
    });
  }

  async function render(box, mode = 'card') {
    box.dataset.mode = mode;
    box.innerHTML = card('<p class="mp-muted">Inapakia taarifa zako za parokia…</p>');
    const year = new Date().getFullYear();
    const { data: s, error } = await supabase.rpc('my_member_summary', { p_year: year });
    if (error) { box.innerHTML = card(`<p class="mp-muted">Taarifa za parokia hazipatikani kwa sasa (${esc(error.message)}).</p>`); return; }
    if (!s.linked) return linkForm(box, s);
    const p = s.parishioner;
    const zaka = new Set(s.zaka_months || []);
    const monthsDue = year < new Date().getFullYear() ? 12 : new Date().getMonth() + 1;
    const pledgeRows = (s.pledges || []);
    const outstanding = pledgeRows.reduce((t, x) => t + Number(x.outstanding || 0), 0);
    const head = `<div class="mp-id"><div><p class="mp-eyebrow">Parokia ya Mt. Aloyce Gonzaga – Minga</p><h3>${esc(p.full_name)}</h3>
        <p class="mp-muted">Jumuiya ya <b>${esc(p.jumuiya || '—')}</b> · Kigango cha ${esc(p.kigango || '—')}${p.family_name ? ` · ${esc(p.family_name)}` : ''}</p></div>
        ${mode === 'card' ? '<a class="mp-btn mp-btn--ghost" href="contributions.html">Michango yangu</a>' : ''}</div>
      <div class="mp-kpis">
        <div><p>Michango yangu ${year}</p><b>${tzs(s.mine_year)}</b></div>
        <div><p>Michango ya familia ${year}</p><b>${tzs(s.family_year)}</b></div>
        <div><p>Zaka — miezi ${year}</p><b>${zaka.size} / ${monthsDue}</b></div>
        <div><p>Deni la ahadi</p><b>${tzs(outstanding)}</b></div></div>`;
    if (mode === 'card') {
      box.innerHTML = card(head + `<div class="mp-zaka">${MONTHS.map((m, i) => `<span class="${zaka.has(i + 1) ? 'on' : i < monthsDue ? 'due' : ''}">${m}</span>`).join('')}</div>` +
        (s.jumuiya_campaigns || []).slice(0, 3).map(c => `<div class="mp-camp"><span>${esc(c.name)} — Jumuiya</span><small>${tzs(c.collected)} / ${tzs(c.target)}</small>
          <div class="mp-bar"><i style="width:${Math.min(100, Number(c.pct) || 0)}%"></i></div></div>`).join(''));
      return;
    }
    const byKind = Object.entries(s.by_kind || {});
    box.innerHTML = card(head) +
      card(`<h3>Zaka ${year}</h3><div class="mp-zaka mp-zaka--big">${MONTHS.map((m, i) => `<span class="${zaka.has(i + 1) ? 'on' : i < monthsDue ? 'due' : ''}">${m}</span>`).join('')}</div>
        <p class="mp-muted">Kijani = umetoa · Njano = mwezi umepita bila zaka iliyorekodiwa.</p>`) +
      card(`<h3>Ahadi zangu na za familia</h3>${pledgeRows.length ? `<div class="mp-table"><table><thead><tr><th>Kampeni</th><th>Ahadi</th><th>Imelipwa</th><th>Deni</th><th>Ziada</th><th>%</th></tr></thead><tbody>
        ${pledgeRows.map(x => `<tr><td>${esc(x.campaign_name)}${x.family_id ? ' <small>(familia)</small>' : ''}</td><td>${tzs(x.pledged)}</td><td>${tzs(x.paid)}</td><td><b>${tzs(x.outstanding)}</b></td><td>${Number(x.excess) ? tzs(x.excess) : '—'}</td>
        <td>${Number(x.completion_pct).toFixed(0)}%<div class="mp-bar"><i style="width:${Math.min(100, Number(x.completion_pct))}%"></i></div></td></tr>`).join('')}</tbody></table></div>` : '<p class="mp-muted">Hakuna ahadi zilizorekodiwa.</p>'}`) +
      card(`<h3>Muhtasari wa ${year} kwa aina</h3>${byKind.length ? `<div class="mp-kpis">${byKind.map(([k, v]) => `<div><p>${esc(KIND[k] || k)}</p><b>${tzs(v)}</b></div>`).join('')}</div>` : '<p class="mp-muted">Hakuna michango iliyorekodiwa mwaka huu.</p>'}`) +
      card(`<h3>Malipo ya karibuni (yangu na ya familia)</h3>${(s.recent || []).length ? `<div class="mp-table"><table><thead><tr><th>Tarehe</th><th>Aina</th><th>Mlipaji</th><th>Kiasi</th><th>Risiti</th></tr></thead><tbody>
        ${s.recent.map(r => `<tr><td>${d(r.txn_date)}</td><td>${esc(r.category_name)}${r.campaign_name ? `<br><small>${esc(r.campaign_name)}</small>` : ''}</td><td>${esc(r.payer_name || '')}</td><td><b>${tzs(r.net_amount)}</b></td>
        <td>${r.receipt_id ? `<a href="../parish/receipt.html?id=${r.receipt_id}" target="_blank">${esc(r.receipt_no)}</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mp-muted">Hakuna malipo yaliyorekodiwa bado.</p>'}
        <p class="mp-muted">Michango hurekodiwa na ofisi ya parokia au jumuiya; ukiona kosa, wasiliana na mhasibu wa parokia.</p>`);
  }

  window.renderMemberParish = render;
})();
