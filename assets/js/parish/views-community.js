/* Minga Parish — leaders and communication:
   michango ya viongozi (report for the leadership only), mahudhurio ya
   jumuiya (attendance, recorded by the jumuiya leader), matangazo
   (announcements shown on the first page) and SMS kwa wingi. */
(function () {
  const P = window.Parish;
  const V = P.views;
  const monthsDue = y => y < P.thisYear() ? 12 : y > P.thisYear() ? 0 : new Date().getMonth() + 1;
  const LEVEL = { jumuiya: 'Jumuiya', kigango: 'Kigango', parish: 'Parokia', group: 'Chama' };

  /* ================= MICHANGO YA VIONGOZI ================= */
  V.leaderreport = {
    title: 'Michango ya Viongozi', perm: 'finance.read',
    async render(el, params) {
      const year = P.year();
      const sc = P.scopeUnit() && P.ref.unitsById[P.scopeUnit()];
      const kig = params.kigango || (sc?.unit_type === 'kigango' ? sc.id : sc?.unit_type === 'jumuiya' ? sc.parent_id : '');
      const jum = params.jumuiya || (sc?.unit_type === 'jumuiya' ? sc.id : '');
      const lvl = params.level || '';
      const pos = params.position || '';
      const showEnded = params.ended !== '0';
      const positions = await P.q(P.from('leadership_positions').select('id,title_sw,level,sort_order,is_active').in('level', ['jumuiya', 'kigango', 'parish']).order('sort_order')).catch(() => []);
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Michango ya Viongozi ${year}</h1>
          <p class="pm-muted">Viongozi wenye vyeo (Katibu, Mwenyekiti, Mhazini…) na michango yao ya mwaka. Ripoti hii inaonwa na viongozi na ofisi ya parokia tu.</p></div>
        <div class="pm-actions"><button class="pm-btn" data-xls><span class="material-symbols-outlined">download</span>Excel</button>
          <button class="pm-btn" data-print><span class="material-symbols-outlined">print</span>Chapa</button></div></div>
        <form class="pm-filters">${P.cascadeHtml({ kigango: kig, jumuiya: jum, allLabel: 'Zote' })}
          <label>Ngazi ya cheo<select name="level"><option value="">Zote</option>${Object.entries(LEVEL).slice(0, 3).map(([k, v]) => `<option value="${k}" ${k === lvl ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Cheo<select name="position"><option value="">Vyote</option>${Object.entries(LEVEL).slice(0, 3).map(([lv, lbl]) => {
            const list = positions.filter(x => x.level === lv);
            return list.length ? `<optgroup label="${lbl}">${list.map(x => `<option value="${x.id}" ${x.id === pos ? 'selected' : ''}>${P.esc(x.title_sw)}${x.is_active === false ? ' (hakitumiki)' : ''}</option>`).join('')}</optgroup>` : '';
          }).join('')}</select></label>
          <label>Vyeo vya<select name="ended"><option value="">Sasa na vilivyoisha ${year}</option><option value="0" ${showEnded ? '' : 'selected'}>Sasa tu</option></select></label>
          <button class="pm-btn pm-btn--primary">Onyesha</button></form>
        <section class="pm-card" data-out>${P.loading()}</section>`;
      P.wireCascade(el);
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault();
        P.go('#/leaderreport?' + new URLSearchParams(Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v)))); });
      const scope = jum || kig || null;
      let rows;
      try { rows = await P.rpc('leaders_contributions', { p_year: year, p_scope: scope, p_position: pos || null, p_include_ended: showEnded }); }
      catch (e) {
        // database not patched yet (migration 33): the old report, without the new filters
        rows = await P.rpc('leaders_contributions', { p_year: year, p_scope: scope });
        Toast.info('Vichujio vipya vya ripoti hii vitafanya kazi baada ya patch ya database (2026-11-10).');
      }
      if (lvl) rows = rows.filter(r => (r.levels || '').split(',').includes(lvl));
      const due = monthsDue(year);
      const unit = r => P.ref.unitsById[r.jumuiya_id]?.label || '—';
      const cols = [
        { key: 'full_name', label: 'Kiongozi', html: r => `<a class="pm-link" href="#/statement?parishioner=${r.parishioner_id}">${P.esc(r.full_name)}</a>`
            + (r.titles ? `<br><small class="pm-muted">${P.esc(r.titles)}</small>` : '')
            + (r.ended_titles ? `<br><small class="pm-muted"><s>${P.esc(r.ended_titles)}</s></small> ${r.titles ? '' : P.badge('cheo kimeisha', 'muted')}` : '') },
        { key: 'jumuiya_id', label: 'Jumuiya', html: r => P.esc(unit(r)) },
        { key: 'zaka', label: `Zaka ${year}`, cls: 'pm-num pm-strong', html: r => P.txMoney(r.zaka, { title: `Zaka ${year} — ${r.full_name}`, parishioner: r.parishioner_id, kinds: ['zaka'], zaka_year: year }, P.num) },
        { key: 'zaka_months', label: 'Miezi', cls: 'pm-num', html: r => due ? `<span class="${r.zaka_months < due ? 'pm-due' : ''}">${r.zaka_months}/${due}</span>` : P.num(r.zaka_months) },
        { key: 'personal', label: 'Michango yake', cls: 'pm-num', html: r => P.txMoney(r.personal, { title: `Michango ${year} — ${r.full_name}`, parishioner: r.parishioner_id, not_kinds: ['zaka', 'expense'], gyear: year }, P.num) },
        { key: 'family', label: 'Ya familia yake', cls: 'pm-num', html: r => r.family_id ? P.txMoney(r.family, { title: `Michango ${year} kwa jina la ${r.family_name || 'familia'}`, family: r.family_id, family_only: true, not_kinds: ['zaka', 'expense'], gyear: year }, P.num) : P.num(r.family) },
        { key: 'pledged', label: 'Ahadi', fmt: P.num, cls: 'pm-num' },
        { key: 'outstanding', label: 'Deni', cls: 'pm-num', html: r => Number(r.outstanding) ? `<span class="pm-due">${P.num(r.outstanding)}</span>` : '—' },
        { key: 'total', label: 'Jumla', fmt: P.tzs, cls: 'pm-num pm-strong' }];
      const foot = { full_name: `<b>JUMLA (${rows.length})</b>`, zaka: `<b>${P.num(P.sum(rows, 'zaka'))}</b>`, personal: P.num(P.sum(rows, 'personal')),
        family: P.num(P.sum(rows, 'family')), pledged: P.num(P.sum(rows, 'pledged')), outstanding: P.num(P.sum(rows, 'outstanding')), total: `<b>${P.tzs(P.sum(rows, 'total'))}</b>` };
      const sub = scope ? P.ref.unitsById[scope].label : 'Parokia nzima';
      el.querySelector('[data-out]').innerHTML = P.reportHeader(`Michango ya Viongozi ${year}`, sub) +
        P.table(rows, cols, { foot, empty: 'Hakuna viongozi wenye vyeo kwenye eneo hili. Vyeo vinatolewa kwenye fomu ya muumini (Hariri → Vyeo).' }) +
        `<p class="pm-muted pm-small">"Miezi" = miezi ya ${year} aliyolipa zaka (kati ya ${due} iliyokwisha pita). "Ya familia yake" = michango iliyotolewa kwa jina la familia (mf. Mavuno, Ujenzi).</p>`;
      el.querySelector('[data-print]').addEventListener('click', () => P.print(`Michango ya Viongozi ${year}`));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel(`michango_viongozi_${year}`, { Viongozi: rows.map(r => ({
        Kiongozi: r.full_name, Vyeo: r.titles || '', Vyeo_vilivyoisha: r.ended_titles || '', Jumuiya: unit(r), Simu: r.phone || '', Zaka: Number(r.zaka), Miezi_ya_zaka: r.zaka_months,
        Michango_yake: Number(r.personal), Ya_familia: Number(r.family), Ahadi: Number(r.pledged), Deni: Number(r.outstanding), Jumla: Number(r.total) })) }));
    },
  };

  /* ================= MAHUDHURIO (tab of the jumuiya page) ================= */
  P.attendanceTab = async (box, j, year) => {
    const canW = P.can('attendance.record');
    const [sessions, summary] = await Promise.all([
      P.q(P.from('attendance_sessions').select('*, attendance_marks(parishioner_id,status)').eq('org_unit_id', j.id)
        .gte('held_on', `${year}-01-01`).lte('held_on', `${year}-12-31`).order('held_on', { ascending: false })),
      P.rpc('attendance_summary', { p_unit: j.id, p_year: year }),
    ]);
    const cnt = (s, st) => (s.attendance_marks || []).filter(m => m.status === st).length;
    box.innerHTML = `<div class="pm-row"><p class="pm-muted pm-small">${sessions.length} mikusanyiko ${year} · ${summary.length} waumini.
        ${canW ? 'Bonyeza "Mahudhurio mapya" baada ya sala / mkutano wa jumuiya.' : ''}</p>
        ${canW ? '<button class="pm-btn pm-btn--primary" data-newatt><span class="material-symbols-outlined">how_to_reg</span>Mahudhurio mapya</button>' : ''}</div>
      <section class="pm-grid2">
        <div class="pm-card"><h3 class="pm-h3">Mikusanyiko</h3>${P.table(sessions, [
          { key: 'held_on', label: 'Tarehe', fmt: P.date }, { key: 'title', label: 'Kikao' },
          { key: 'p', label: 'Walihudhuria', cls: 'pm-num pm-strong', html: s => P.num(cnt(s, 'present')) },
          { key: 'e', label: 'Ruhusa', cls: 'pm-num', html: s => P.num(cnt(s, 'excused')) },
          { key: 'id', label: '', html: s => canW ? `<button class="pm-btn pm-btn--sm" data-editatt="${s.id}">Fungua</button>` : '' }],
          { empty: 'Hakuna mahudhurio yaliyojazwa mwaka huu.' })}</div>
        <div class="pm-card"><h3 class="pm-h3">Kila muumini</h3>${P.table(summary, [
          { key: 'full_name', label: 'Muumini' },
          { key: 'present', label: 'Alikuja', cls: 'pm-num' }, { key: 'excused', label: 'Ruhusa', cls: 'pm-num' },
          { key: 'absent', label: 'Hakuja', cls: 'pm-num', html: r => r.absent ? `<span class="pm-due">${r.absent}</span>` : '0' },
          { key: 'rate', label: '%', cls: 'pm-num pm-strong', html: r => r.rate === null ? '—' : P.pct(r.rate) }], { empty: 'Jumuiya hii haina waumini.' })}</div>
      </section>`;
    const open = async (s) => {
      const people = summary;
      const mark = Object.fromEntries((s?.attendance_marks || []).map(m => [m.parishioner_id, m.status]));
      const opt = (id, st, label) => `<label class="pm-att__opt pm-att__opt--${st}"><input type="radio" name="m_${id}" value="${st}" ${(mark[id] || (s ? 'absent' : 'present')) === st ? 'checked' : ''}>${label}</label>`;
      const v = await P.modal({ title: s ? `Mahudhurio — ${P.date(s.held_on)}` : `Mahudhurio mapya — Jumuiya ya ${j.name}`, wide: true, body: `<div class="pm-form">
          <label>Tarehe<input type="date" name="held_on" required max="${P.today()}" value="${s?.held_on ? String(s.held_on).slice(0, 10) : P.today()}"></label>
          <label>Kikao<input name="title" required list="pm-att-titles" value="${P.esc(s?.title || 'Sala ya jumuiya')}">
            <datalist id="pm-att-titles"><option>Sala ya jumuiya</option><option>Mkutano wa jumuiya</option><option>Misa ya jumuiya</option><option>Kazi ya jumuiya</option></datalist></label>
          <label class="pm-span2">Maelezo (hiari)<input name="notes" maxlength="300" value="${P.esc(s?.notes || '')}"></label>
          <div class="pm-span2 pm-row"><small class="pm-muted" data-attcount></small>
            <span><button type="button" class="pm-btn pm-btn--sm" data-all="present">Wote walikuja</button> <button type="button" class="pm-btn pm-btn--sm" data-all="absent">Wote hawakuja</button></span></div>
          <div class="pm-span2 pm-att">${people.map(p => `<div class="pm-att__row"><span>${P.esc(p.full_name)}</span>
            <span>${opt(p.parishioner_id, 'present', 'Alikuja')}${opt(p.parishioner_id, 'excused', 'Ruhusa')}${opt(p.parishioner_id, 'absent', 'Hakuja')}</span></div>`).join('') || P.empty('Jumuiya hii haina waumini hai.')}</div>
          ${s ? '<div class="pm-span2"><button type="button" class="pm-btn pm-btn--sm pm-btn--danger" data-delatt>Futa mahudhurio haya</button></div>' : ''}</div>`,
        onOpen(m) {
          const count = () => { m.querySelector('[data-attcount]').textContent = `Walihudhuria: ${m.querySelectorAll('input[value=present]:checked').length} kati ya ${people.length}`; };
          m.addEventListener('change', count); count();
          m.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => { m.querySelectorAll(`input[value=${b.dataset.all}]`).forEach(i => { i.checked = true; }); count(); }));
          const d = m.querySelector('[data-delatt]');
          d && d.addEventListener('click', async () => {
            if (!await P.confirm('Futa mahudhurio?', 'Mahudhurio ya siku hii yataondolewa.', 'Futa')) return;
            await P.busy(d, () => P.rpc('delete_attendance', { p_id: s.id }));
            m.querySelector('[data-close]').click(); Toast.success('Mahudhurio yamefutwa.'); P.refresh();
          });
        } });
      if (!v) return;
      const marks = people.map(p => ({ parishioner_id: p.parishioner_id, status: v[`m_${p.parishioner_id}`] || 'absent' }));
      await P.rpc('save_attendance', { p: { id: s?.id || null, org_unit_id: j.id, held_on: v.held_on, title: v.title, notes: v.notes, marks } });
      Toast.success(`Mahudhurio yamehifadhiwa: ${marks.filter(x => x.status === 'present').length} walikuja.`); P.refresh();
    };
    const nb = box.querySelector('[data-newatt]'); nb && nb.addEventListener('click', () => open(null));
    box.querySelectorAll('[data-editatt]').forEach(b => b.addEventListener('click', () => open(sessions.find(s => s.id === b.dataset.editatt))));
  };

  /* ================= MATANGAZO (shown on the first page) ================= */
  P.announcementsHtml = async () => {
    let list = [];
    try { list = await P.rpc('my_announcements'); } catch (e) { return ''; }   // database not patched yet: show nothing
    if (!list || !list.length) return '';
    return `<section class="pm-notices">${list.map(a => `<article class="pm-notice"><span class="material-symbols-outlined">campaign</span>
      <div><h3>${P.esc(a.title)}</h3><p>${P.esc(a.body).replace(/\n/g, '<br>')}</p><small class="pm-muted">${P.date(a.starts_on)}${a.ends_on ? ' – ' + P.date(a.ends_on) : ''}</small></div></article>`).join('')}</section>`;
  };

  /* ================= MATANGAZO NA SMS ================= */
  const AUD_ANN = { all: 'Watumiaji wote', staff: 'Ofisi na viongozi wenye nafasi kwenye mfumo', leaders: 'Viongozi tu', members: 'Waumini (akaunti za waumini)', units: 'Vigango / jumuiya nilizochagua' };
  const AUD_SMS = { all: 'Waumini wote wenye namba ya simu', zaka_payers: 'Walipa zaka tu (wote waliowekwa kulipa)', zaka_paid: 'Waliolipa zaka (mwaka / mwezi)',
    zaka_unpaid: 'Walipa zaka ambao hawajalipa (mwaka / mwezi)', leaders: 'Viongozi wenye vyeo tu', units: 'Vigango / jumuiya nilizochagua' };
  const zakaWhen = m => m.zaka_year ? ` — ${m.zaka_month ? P.MONTHS[m.zaka_month - 1] + ' ' : ''}${m.zaka_year}` : '';
  const STATUS = { draft: ['Haijatumwa', 'muted'], sending: ['Inatumwa…', 'gold'], sent: ['Imetumwa', 'teal'], failed: ['Imeshindikana', 'rose'] };
  const unitPicker = (sel = []) => `<div class="pm-span2 pm-unitpick" data-units hidden>${P.unitsOf('kigango').map(k => `
      <div><label class="pm-relall"><input type="checkbox" name="u" value="${k.id}" ${sel.includes(k.id) ? 'checked' : ''}> <b>Kigango cha ${P.esc(k.name)}</b> (chote)</label>
      ${P.unitsOf('jumuiya').filter(j => j.parent_id === k.id).map(j => `<label><input type="checkbox" name="u" value="${j.id}" ${sel.includes(j.id) ? 'checked' : ''}> ${P.esc(j.name)}</label>`).join('')}</div>`).join('')}</div>`;
  const pickedUnits = m => [...m.querySelectorAll('input[name=u]:checked')].map(i => i.value);
  const unitNames = ids => (ids || []).map(id => P.ref.unitsById[id]?.label).filter(Boolean).join(', ');

  V.comms = {
    title: 'Matangazo na SMS', perm: 'comms.send',
    async render(el, params) {
      const tab = params.tab === 'sms' ? 'sms' : 'matangazo';
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Matangazo na SMS</h1>
          <p class="pm-muted">Tangazo linaonekana kwenye ukurasa wa kwanza wa watumiaji uliowachagua. SMS zinakwenda kwenye namba za simu zilizo kwenye rejista.</p></div>
        <div class="pm-actions">${tab === 'sms' ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">sms</span>SMS mpya</button>'
          : '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">campaign</span>Tangazo jipya</button>'}</div></div>
        <nav class="pm-tabs"><a href="#/comms?tab=matangazo" class="${tab === 'matangazo' ? 'is-active' : ''}"><span class="material-symbols-outlined">campaign</span>Matangazo</a>
          <a href="#/comms?tab=sms" class="${tab === 'sms' ? 'is-active' : ''}"><span class="material-symbols-outlined">sms</span>SMS kwa wingi</a></nav>
        <div data-tab>${P.loading()}</div>`;
      const box = el.querySelector('[data-tab]');
      if (tab === 'matangazo') return announcementsTab(el, box);
      return smsTab(el, box);
    },
  };

  async function announcementsTab(el, box) {
    const rows = await P.q(P.from('parish_announcements').select('*').order('created_at', { ascending: false }).limit(200));
    const today = P.today();
    const d10 = v => v ? String(v).slice(0, 10) : '';
    const live = a => a.is_active && d10(a.starts_on) <= today && (!a.ends_on || d10(a.ends_on) >= today);
    box.innerHTML = `<section class="pm-card">${P.table(rows, [
      { key: 'title', label: 'Tangazo', html: a => `<b>${P.esc(a.title)}</b><br><small class="pm-muted">${P.esc(a.body.slice(0, 140))}${a.body.length > 140 ? '…' : ''}</small>` },
      { key: 'audience', label: 'Linaonwa na', html: a => P.esc(a.audience === 'units' ? unitNames(a.unit_ids) : AUD_ANN[a.audience]) },
      { key: 'starts_on', label: 'Kuanzia', fmt: P.date }, { key: 'ends_on', label: 'Hadi', fmt: v => v ? P.date(v) : 'Bila mwisho' },
      { key: 'is_active', label: 'Hali', html: a => live(a) ? P.badge('Linaonekana', 'teal') : P.badge(a.is_active ? 'Si sasa' : 'Limezimwa', 'muted') },
      { key: 'id', label: '', html: a => `<span class="pm-nowrap"><button class="pm-btn pm-btn--sm" data-edit="${a.id}">Hariri</button>
          <button class="pm-btn pm-btn--sm pm-btn--danger" data-del="${a.id}">Futa</button></span>` }], { empty: 'Hakuna matangazo bado.' })}</section>`;
    const save = async a => {
      let units = a?.unit_ids || [];
      const v = await P.modal({ title: a ? 'Hariri tangazo' : 'Tangazo jipya', wide: true, body: `<div class="pm-form">
          <label class="pm-span2">Kichwa<input name="title" required maxlength="120" value="${P.esc(a?.title || '')}" placeholder="mf. Harambee ya Kanisa Jumapili"></label>
          <label class="pm-span2">Ujumbe<textarea name="body" required rows="5" maxlength="2000">${P.esc(a?.body || '')}</textarea></label>
          <label class="pm-span2">Linaonwa na<select name="audience">${Object.entries(AUD_ANN).map(([k, l]) => `<option value="${k}" ${(a?.audience || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${unitPicker(a?.unit_ids || [])}
          <label>Kuanzia<input type="date" name="starts_on" required value="${d10(a?.starts_on) || P.today()}"></label>
          <label>Hadi (hiari)<input type="date" name="ends_on" value="${d10(a?.ends_on)}"></label>
          ${a ? `<label>Hali<select name="is_active"><option value="true">Linaonekana</option><option value="false" ${a.is_active ? '' : 'selected'}>Limezimwa</option></select></label>` : ''}</div>`,
        onOpen(m) {
          const s = m.querySelector('[name=audience]'), u = m.querySelector('[data-units]');
          const sync = () => { u.hidden = s.value !== 'units'; }; s.addEventListener('change', sync); sync();
          // the ticks share one name, so they are read here rather than from the form values
          m.addEventListener('change', e => { if (e.target.name === 'u') units = pickedUnits(m); });
        } });
      if (!v) return;
      if (v.audience !== 'units') units = [];
      if (v.audience === 'units' && !units.length) { Toast.error('Chagua angalau kigango au jumuiya moja.'); return; }
      const row = { title: v.title.trim(), body: v.body.trim(), audience: v.audience, unit_ids: units, starts_on: v.starts_on, ends_on: v.ends_on || null };
      if (a) await P.q(P.from('parish_announcements').update({ ...row, is_active: v.is_active === 'true' }).eq('id', a.id));
      else await P.q(P.from('parish_announcements').insert({ ...row, parish_id: P.ref.parish.id, created_by: P.profile.id }));
      Toast.success('Tangazo limehifadhiwa.'); P.refresh();
    };
    el.querySelector('[data-new]').addEventListener('click', () => save(null));
    box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => save(rows.find(a => a.id === b.dataset.edit))));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await P.confirm('Futa tangazo?', 'Tangazo hili litaondolewa kwa watumiaji wote.', 'Futa')) return;
      await P.q(P.from('parish_announcements').delete().eq('id', b.dataset.del)); P.refresh();
    }));
  }

  async function smsTab(el, box) {
    const [rows, cfg] = await Promise.all([
      P.q(P.from('sms_messages').select('*').order('created_at', { ascending: false }).limit(200)),
      fetch(new URL('../api/sms', location.href), { method: 'GET' }).then(r => r.ok ? r.json() : { configured: false }).catch(() => ({ configured: false })),
    ]);
    box.innerHTML = `${cfg.configured ? `<div class="pm-alert pm-alert--info">SMS zinatumwa kupitia ${P.esc(cfg.provider || 'mtoa huduma')}${cfg.sender ? ` kwa jina "${P.esc(cfg.sender)}"` : ''}.</div>`
        : `<div class="pm-alert pm-alert--warn">Mtoa huduma wa SMS bado hajawekwa kwenye server (mf. Beem Africa au NextSMS — inahitaji akaunti ya kulipia na Sender ID).
           Hadi atakapowekwa, unaweza kuandaa ujumbe hapa na <b>kupakua namba</b> (Excel) ili kutuma kwa simu au kwa huduma nyingine.</div>`}
      <section class="pm-card">${P.table(rows, [
        { key: 'created_at', label: 'Tarehe', fmt: v => P.date(String(v).slice(0, 10)) },
        { key: 'body', label: 'Ujumbe', html: m => `${P.esc(m.body.slice(0, 160))}${m.body.length > 160 ? '…' : ''}<br><small class="pm-muted">${m.body.length} herufi · SMS ${Math.ceil(m.body.length / 160)} kwa kila mtu</small>` },
        { key: 'audience', label: 'Kwa', html: m => P.esc((m.audience === 'units' ? unitNames(m.unit_ids) : AUD_SMS[m.audience]) + zakaWhen(m) + (m.zaka_only && m.audience !== 'zaka_payers' ? ' (walipa zaka)' : '')) },
        { key: 'recipients', label: 'Namba', cls: 'pm-num' },
        { key: 'status', label: 'Hali', html: m => P.badge(...(STATUS[m.status] || [m.status, 'muted'])) + (m.result?.manual ? '<br><small class="pm-muted">imewekwa kwa mkono</small>' : '') },
        { key: 'id', label: '', html: m => `<span class="pm-nowrap"><button class="pm-btn pm-btn--sm" data-xls="${m.id}">Namba (Excel)</button>
            ${m.status === 'sending' ? `<button class="pm-btn pm-btn--sm" data-resolve="${m.id}" title="SMS imekwama kwenye 'Inatumwa…'">Rekebisha hali</button>` : ''}
            ${cfg.configured && !['sent', 'sending'].includes(m.status) ? `<button class="pm-btn pm-btn--sm pm-btn--primary" data-send="${m.id}">Tuma</button>` : ''}
            ${['draft', 'failed'].includes(m.status) ? `<button class="pm-btn pm-btn--sm pm-btn--danger" data-del="${m.id}">Futa</button>` : ''}</span>` }],
        { empty: 'Hakuna SMS zilizoandaliwa bado.' })}</section>`;

    const send = async (id, btn) => {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await P.busy(btn, async () => {
        const res = await fetch(new URL('../api/sms', location.href), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ message_id: id }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `SMS hazikutumwa (${res.status})`);
        return j;
      });
      Toast.success(`SMS zimetumwa kwa namba ${r.sent || ''}.`); P.refresh();
    };
    el.querySelector('[data-new]').addEventListener('click', async () => {
      let units = [];
      const v = await P.modal({ title: 'SMS mpya', submit: cfg.configured ? 'Andaa na Tuma' : 'Andaa', wide: true, body: `<div class="pm-form">
          <label class="pm-span2">Ujumbe<textarea name="body" required rows="4" maxlength="918" placeholder="mf. Tumsifu Yesu Kristu! Harambee ya kanisa ni Jumapili 10/11 baada ya Misa."></textarea>
            <small class="pm-muted" data-len>0 herufi</small></label>
          <label class="pm-span2">Kwa nani<select name="audience">${Object.entries(AUD_SMS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
          ${unitPicker([])}
          <label class="pm-span2 pm-relall" data-zakaonly hidden><input type="checkbox" name="zaka_only" value="1"> Walipa zaka tu kwenye maeneo hayo</label>
          <label data-zakawhen hidden>Mwaka wa zaka<select name="zaka_year">${[P.thisYear() + 1, P.thisYear(), P.thisYear() - 1, P.thisYear() - 2].map(y => `<option ${y === P.year() ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          <label data-zakawhen hidden>Mwezi<select name="zaka_month"><option value="">Mwaka mzima</option>${P.MONTHS.map((mn, i) => `<option value="${i + 1}">${mn}</option>`).join('')}</select></label>
          <p class="pm-span2 pm-muted pm-small" data-zakawhen hidden>Zaka iliyolipwa na muumini mwenyewe, au na familia yake kwa jina la familia. Malipo yaliyorudishwa (reversal) hayahesabiwi.</p>
          <p class="pm-span2 pm-alert pm-alert--info" data-count>Inahesabu…</p></div>`,
        onOpen(m) {
          const s = m.querySelector('[name=audience]'), u = m.querySelector('[data-units]'), z = m.querySelector('[data-zakaonly]'), out = m.querySelector('[data-count]');
          const zw = [...m.querySelectorAll('[data-zakawhen]')];
          const when = () => ['zaka_paid', 'zaka_unpaid'].includes(s.value) ? { zaka_year: Number(m.querySelector('[name=zaka_year]').value), zaka_month: m.querySelector('[name=zaka_month]').value ? Number(m.querySelector('[name=zaka_month]').value) : null } : {};
          const ta = m.querySelector('[name=body]'), len = m.querySelector('[data-len]');
          ta.addEventListener('input', () => { len.textContent = `${ta.value.length} herufi · SMS ${Math.max(1, Math.ceil(ta.value.length / 160))} kwa kila mtu`; });
          let t;
          const count = () => { clearTimeout(t); t = setTimeout(async () => {
            units = pickedUnits(m);
            try {
              const r = await P.rpc('sms_preview', { p: { audience: s.value, unit_ids: units, zaka_only: m.querySelector('[name=zaka_only]').checked, ...when() } });
              out.innerHTML = `Itakwenda kwa namba <b>${P.num(r.recipients)}</b> (kila namba mara moja). Waumini ${P.num(r.without_phone)} kwenye rejista hawana namba ya simu.`;
            } catch (e) { out.textContent = P.friendlyError(e); }
          }, 250); };
          const sync = () => { u.hidden = s.value !== 'units'; z.hidden = s.value !== 'units'; zw.forEach(x => { x.hidden = !['zaka_paid', 'zaka_unpaid'].includes(s.value); }); count(); };
          s.addEventListener('change', sync); m.addEventListener('change', e => { if (['u', 'zaka_only', 'zaka_year', 'zaka_month'].includes(e.target.name)) count(); });
          sync();
        } });
      if (!v) return;
      if (v.audience === 'units' && !units.length) { Toast.error('Chagua angalau kigango au jumuiya moja.'); return; }
      const zk = ['zaka_paid', 'zaka_unpaid'].includes(v.audience) ? { zaka_year: Number(v.zaka_year), zaka_month: v.zaka_month ? Number(v.zaka_month) : null } : {};
      const r = await P.rpc('sms_create', { p: { body: v.body, audience: v.audience, unit_ids: v.audience === 'units' ? units : [], zaka_only: !!v.zaka_only, ...zk } });
      Toast.success(`SMS imeandaliwa kwa namba ${r.recipients}.`);
      if (cfg.configured && await P.confirm('Tuma sasa?', `Ujumbe utatumwa kwa namba ${r.recipients}. Gharama ya SMS inalipwa kwa mtoa huduma.`, 'Tuma')) {
        try { await send(r.id, null); } catch (e) { /* shown by P.busy */ P.refresh(); }
      } else P.refresh();
    });
    box.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', async () => {
      const m = rows.find(x => x.id === b.dataset.send);
      if (!await P.confirm('Tuma SMS?', `Ujumbe utatumwa kwa namba ${m.recipients}.`, 'Tuma')) return;
      send(m.id, b).catch(() => P.refresh());
    }));
    // a message stuck on "sending" (server stopped half way): the sender checks with the provider, then says what happened
    box.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', async () => {
      const m = rows.find(x => x.id === b.dataset.resolve);
      const since = m.claimed_at ? new Date(m.claimed_at).toLocaleString('en-GB') : '';
      const v = await P.modal({ title: 'SMS imekwama kwenye "Inatumwa…"', submit: 'Hifadhi', body: `<div class="pm-form">
          <p class="pm-span2 pm-muted">Ujumbe huu ulianza kutumwa ${since ? `<b>${P.esc(since)}</b>` : ''} lakini mfumo haukupata jibu la mwisho. <b>Kwanza angalia kwenye akaunti yako ya mtoa huduma</b>${cfg.provider ? ` (${P.esc(cfg.provider)})` : ''} kama SMS zilifika — usiutume tena bila kuangalia, utalipia mara mbili.</p>
          <label class="pm-span2 pm-relall"><input type="radio" name="outcome" value="sent" required> Zilitumwa — mtoa huduma anaonyesha zimetoka</label>
          <label class="pm-span2 pm-relall"><input type="radio" name="outcome" value="failed" required> Hazikutumwa — niweze kutuma tena au kufuta</label>
          <label class="pm-span2">Maelezo (hiari)<input name="note" maxlength="200" placeholder="mf. Beem inaonyesha 120 zimetoka saa 10:15"></label></div>` });
      if (!v) return;
      await P.rpc('sms_resolve', { p_id: m.id, p_sent: v.outcome === 'sent', p_note: v.note || null });
      Toast.success(v.outcome === 'sent' ? 'SMS imewekwa "Imetumwa".' : 'SMS imewekwa "Imeshindikana" — unaweza kuituma tena.');
      P.refresh();
    }));
    box.querySelectorAll('[data-xls]').forEach(b => b.addEventListener('click', async () => {
      const m = rows.find(x => x.id === b.dataset.xls);
      const list = await P.q(P.from('sms_recipients').select('phone,full_name').eq('message_id', m.id).order('full_name').limit(20000));
      P.exportExcel(`sms_${String(m.created_at).slice(0, 10)}`, { Namba: list.map(x => ({ Jina: x.full_name, Simu: x.phone, Ujumbe: m.body })) });
    }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await P.confirm('Futa SMS hii?', 'Ujumbe na orodha yake ya namba vitafutwa.', 'Futa')) return;
      await P.rpc('sms_delete', { p_id: b.dataset.del }); P.refresh();
    }));
  }
})();
