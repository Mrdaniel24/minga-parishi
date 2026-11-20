/* Minga Parish — communication:
   mahudhurio ya
   jumuiya (attendance, recorded by the jumuiya leader), matangazo
   (announcements shown on the first page) and SMS kwa wingi. */
(function () {
  const P = window.Parish;
  const V = P.views;
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
  const SMS_TEMPLATES = {
    zaka_year: 'Kristo, @jina, taarifa ya utume wako ya @mwaka — Zaka: JAN-@zaka_jan, FEB-@zaka_feb, MAR-@zaka_mar, APR-@zaka_apr, MEI-@zaka_mei, JUN-@zaka_jun, JUL-@zaka_jul, AGO-@zaka_ago, SEP-@zaka_sep, OKT-@zaka_okt, NOV-@zaka_nov, DES-@zaka_des. Mungu akubariki.',
    zaka_month: 'Kristo, @jina. Zaka yako ya @mwezi @mwaka: TZS @kiasi. Umeshalipa miezi @miezi_iliyolipwa. Mungu akubariki.',
    unit: 'Tumsifu Yesu Kristo, @jina. Taarifa kutoka @jumuiya, Kigango cha @kigango: [andika ujumbe hapa]. Tarehe @tarehe.',
    general: 'Tumsifu Yesu Kristo, @jina. [Andika ujumbe wako hapa]. Tarehe @tarehe.',
  };
  const SMS_TOKENS = [
    ['jina', 'Jina la muumini'], ['familia', 'Jina la familia'], ['jumuiya', 'Jumuiya'], ['kigango', 'Kigango'],
    ['tarehe', 'Tarehe ya leo'], ['mwezi', 'Mwezi uliochaguliwa'], ['mwaka', 'Mwaka wa taarifa'],
    ['kiasi', 'Jumla ya Zaka kwa kipindi kilichochaguliwa'], ['miezi_iliyolipwa', 'Idadi ya miezi ya Zaka iliyolipwa'],
    ['zaka_jan', 'Zaka ya Januari'], ['zaka_feb', 'Zaka ya Februari'], ['zaka_mar', 'Zaka ya Machi'],
    ['zaka_apr', 'Zaka ya Aprili'], ['zaka_mei', 'Zaka ya Mei'], ['zaka_jun', 'Zaka ya Juni'],
    ['zaka_jul', 'Zaka ya Julai'], ['zaka_ago', 'Zaka ya Agosti'], ['zaka_sep', 'Zaka ya Septemba'],
    ['zaka_okt', 'Zaka ya Oktoba'], ['zaka_nov', 'Zaka ya Novemba'], ['zaka_des', 'Zaka ya Desemba'],
  ];
  const smsParts = text => {
    const value = String(text || '');
    if (/[^\x00-\x7f]/.test(value)) {
      const units = [...value].reduce((n, c) => n + (c.codePointAt(0) > 0xffff ? 2 : 1), 0);
      return units <= 70 ? 1 : Math.ceil(units / 67);
    }
    const extension = '^{}\\[]~|€';
    const units = [...value].reduce((n, c) => n + (extension.includes(c) ? 2 : 1), 0);
    return units <= 160 ? 1 : Math.ceil(units / 153);
  };
  const zakaWhen = m => {
    const zakaContext = ['zaka_payers', 'zaka_paid', 'zaka_unpaid'].includes(m.audience) || /@(kiasi|mwezi|mwaka|miezi_iliyolipwa|zaka_)/.test(m.body || '');
    return zakaContext && m.zaka_year ? ` — ${m.zaka_month ? P.MONTHS[m.zaka_month - 1] + ' ' : ''}${m.zaka_year}` : '';
  };
  const STATUS = { draft: ['Haijatumwa', 'muted'], sending: ['Inatumwa…', 'gold'], sent: ['Imetumwa', 'teal'], failed: ['Imeshindikana', 'rose'] };
  const unitPicker = (sel = []) => `<div class="pm-span2 pm-unitpick" data-units hidden>${P.unitsOf('kigango').map(k => `
      <div><label class="pm-relall"><input type="checkbox" name="u" value="${k.id}" ${sel.includes(k.id) ? 'checked' : ''}> <b>Kigango cha ${P.esc(k.name)}</b> (chote)</label>
      ${P.unitsOf('jumuiya').filter(j => j.parent_id === k.id).map(j => `<label><input type="checkbox" name="u" value="${j.id}" ${sel.includes(j.id) ? 'checked' : ''}> ${P.esc(j.name)}</label>`).join('')}</div>`).join('')}</div>`;
  const pickedUnits = m => [...m.querySelectorAll('input[name=u]:checked')].map(i => i.value);
  const unitNames = ids => (ids || []).map(id => P.ref.unitsById[id]?.label).filter(Boolean).join(', ');

  V.comms = {
    title: 'Matangazo na SMS', perm: 'comms.send',
    async render(el, params) {
      const tab = ['matangazo', 'michango'].includes(params.tab) ? params.tab : 'sms';
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Matangazo na SMS</h1>
          <p class="pm-muted">Tangazo linaonekana kwenye ukurasa wa kwanza wa watumiaji uliowachagua. SMS zinakwenda kwenye namba za simu zilizo kwenye rejista.</p></div>
        <div class="pm-actions">${tab === 'matangazo' ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">campaign</span>Tangazo jipya</button>'
          : tab === 'michango' ? '<a class="pm-btn pm-btn--primary" href="#/comms?tab=sms&audience=all"><span class="material-symbols-outlined">sms</span>Andaa SMS</a>'
          : '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">sms</span>SMS mpya</button>'}</div></div>
        <nav class="pm-tabs"><a href="#/comms?tab=sms" class="${tab === 'sms' ? 'is-active' : ''}"><span class="material-symbols-outlined">sms</span>SMS za Zaka</a>
          <a href="#/comms?tab=michango" class="${tab === 'michango' ? 'is-active' : ''}"><span class="material-symbols-outlined">volunteer_activism</span>SMS za Michango</a>
          <a href="#/comms?tab=matangazo" class="${tab === 'matangazo' ? 'is-active' : ''}"><span class="material-symbols-outlined">campaign</span>Matangazo</a></nav>
        <div data-tab>${P.loading()}</div>`;
      const box = el.querySelector('[data-tab]');
      if (tab === 'matangazo') return announcementsTab(el, box);
      if (tab === 'michango') return contributionSmsTab(box);
      return smsTab(el, box, params);
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

  function contributionSmsTab(box) {
    box.innerHTML = `<section class="pm-card pm-michango-sms"><div class="pm-michango-sms-head"><div><h2>SMS za Michango</h2><p class="pm-muted">Kampeni za michango zilizopo. Chagua mwaka, kisha andaa SMS kwa wapokeaji unaowahitaji.</p></div>
        <label>Mwaka<select data-campaign-year>${[P.thisYear() + 1, P.thisYear(), P.thisYear() - 1, P.thisYear() - 2].map(y => `<option ${y === P.year() ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div>
      <div class="pm-michango-sms-list" data-campaign-list></div></section>`;
    const load = () => {
      const year = Number(box.querySelector('[data-campaign-year]').value);
      const campaigns = (P.ref.camps || []).filter(c => Number(c.campaign_year) === year && c.status !== 'closed'
        && P.ref.cats.find(cat => cat.id === c.category_id)?.kind !== 'zaka')
        .sort((a,b) => String(a.name).localeCompare(String(b.name), 'sw'));
      const target = box.querySelector('[data-campaign-list]');
      target.innerHTML = campaigns.length ? campaigns.map(c => {
        const category = P.ref.cats.find(cat => cat.id === c.category_id);
        return `<div class="pm-michango-sms-row"><span><b>${P.esc(c.name)}</b><small>${P.esc(category?.name_sw || 'Mchango')} · ${P.esc(String(c.campaign_year))}</small></span><span class="pm-michango-sms-tag">${P.esc(c.status === 'active' ? 'Unaendelea' : 'Umeandaliwa')}</span></div>`;
      }).join('') : '<p class="pm-muted">Hakuna kampeni za michango kwa mwaka huu.</p>';
    };
    box.querySelector('[data-campaign-year]').addEventListener('change', load);
    load();
  }

  async function smsTab(el, box, params = {}) {
    const defaultAudience = AUD_SMS[params.audience] ? params.audience : 'zaka_unpaid';
    const [rows, cfg] = await Promise.all([
      P.q(P.from('sms_messages').select('*').order('created_at', { ascending: false }).limit(200)),
      fetch(new URL('../api/sms', location.href), { method: 'GET' }).then(r => r.ok ? r.json() : { configured: false }).catch(() => ({ configured: false })),
    ]);
    box.innerHTML = `<section class="pm-card pm-zaka-sms"><div class="pm-zaka-sms-head"><div><h2>Zaka kwa mwezi</h2><p class="pm-muted">Chagua mwezi kuona walipa zaka na ambao hawajalipa, kwa kigango na jumuiya.</p></div>
        <div class="pm-zaka-sms-period"><label>Mwaka<select data-zaka-year>${[P.thisYear() + 1, P.thisYear(), P.thisYear() - 1, P.thisYear() - 2].map(y => `<option ${y === P.year() ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <label>Mwezi<select data-zaka-month>${P.MONTHS.map((mn, i) => `<option value="${i + 1}" ${i + 1 === new Date().getMonth() + 1 ? 'selected' : ''}>${mn}</option>`).join('')}</select></label></div></div>
        <div class="pm-zaka-sms-roster" data-zaka-roster><p class="pm-muted">Inapakia taarifa za Zaka…</p></div></section>
      ${cfg.configured ? `<div class="pm-alert pm-alert--info">SMS zinatumwa kupitia ${P.esc(cfg.provider || 'mtoa huduma')}${cfg.sender ? ` kwa jina "${P.esc(cfg.sender)}"` : ''}.</div>`
        : `<div class="pm-alert pm-alert--warn">Mtoa huduma wa SMS bado hajawekwa kwenye server (mf. Beem Africa au NextSMS — inahitaji akaunti ya kulipia na Sender ID).
           Hadi atakapowekwa, unaweza kuandaa ujumbe hapa na <b>kupakua namba</b> (Excel) ili kutuma kwa simu au kwa huduma nyingine.</div>`}
      <section class="pm-card">${P.table(rows, [
        { key: 'created_at', label: 'Tarehe', fmt: v => P.date(String(v).slice(0, 10)) },
        { key: 'body', label: 'Template ya ujumbe', html: m => `${P.esc(m.body.slice(0, 160))}${m.body.length > 160 ? '…' : ''}<br><small class="pm-muted">${m.body.length} herufi · takriban SMS ${smsParts(m.body)} kwa kila mtu</small>` },
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
    let smsPrefill = null;
    const loadZakaRoster = async () => {
      const target = box.querySelector('[data-zaka-roster]');
      if (!target) return;
      const year = Number(box.querySelector('[data-zaka-year]').value), month = Number(box.querySelector('[data-zaka-month]').value);
      target.innerHTML = '<p class="pm-muted">Inapakia…</p>';
      try {
        const units = await P.rpc('sms_zaka_roster', { p_year: year, p_month: month });
        const groups = (units || []).filter(u => u.unit_type === 'kigango');
      target.innerHTML = groups.length ? groups.map(k => {
          const children = (units || []).filter(u => u.unit_type === 'jumuiya' && u.parent_id === k.unit_id && Number(u.paid_count) + Number(u.unpaid_count) > 0);
          const counts = u => `<span class="pm-zaka-sms-counts"><span>Walio ${P.num(u.paid_count)}</span><span>Hawajalipa ${P.num(u.unpaid_count)}</span></span>`;
          const actions = (u, label='') => `<div class="pm-zaka-sms-actions"><button type="button" data-zaka-list="zaka_paid" data-unit="${u.unit_id}" data-unit-label="${P.esc(label || 'Kigango cha ' + k.unit_name)}">Walio lipa <b>${P.num(u.paid_count)}</b></button><button type="button" data-zaka-list="zaka_unpaid" data-unit="${u.unit_id}" data-unit-label="${P.esc(label || 'Kigango cha ' + k.unit_name)}">Hawajalipa <b>${P.num(u.unpaid_count)}</b></button></div>`;
          return `<details class="pm-zaka-sms-unit"><summary class="pm-zaka-sms-kigango"><b>Kigango cha ${P.esc(k.unit_name)}</b>${counts(k)}</summary><div class="pm-zaka-sms-unit-content">${actions(k)}${children.length ? `<div class="pm-zaka-sms-jumuiya-list">${children.map(j => `<details class="pm-zaka-sms-jumuiya"><summary><b>Jumuiya ya ${P.esc(j.unit_name)}</b>${counts(j)}</summary>${actions(j, 'Jumuiya ya ' + j.unit_name)}</details>`).join('')}</div>` : '<p class="pm-muted pm-small">Hakuna Jumuiya zilizosajiliwa hapa.</p>'}</div></details>`;
        }).join('') : '<p class="pm-muted">Hakuna vigango vya kuonyesha.</p>';
      } catch (e) { target.innerHTML = `<div class="pm-alert pm-alert--warn">${P.esc(P.friendlyError(e))}</div>`; }
    };
    box.querySelectorAll('[data-zaka-year], [data-zaka-month]').forEach(s => s.addEventListener('change', loadZakaRoster));
    const showZakaList = async b => {
      const year = Number(box.querySelector('[data-zaka-year]').value), month = Number(box.querySelector('[data-zaka-month]').value);
      const audience = b.dataset.zakaList, unitId = b.dataset.unit, unitLabel = b.dataset.unitLabel;
      try {
        let people;
        try { people = await P.rpc('sms_zaka_recipient_tree', { p_year: year, p_month: month, p_unit: unitId, p_audience: audience }); }
        catch (err) {
          if (!/sms_zaka_recipient_tree|schema cache|could not find the function/i.test(err.message || '')) throw err;
          people = (await P.rpc('sms_zaka_recipients', { p_year: year, p_month: month, p_unit: unitId, p_audience: audience }))
            .map(p => ({ ...p, family_id: null, family_name: 'Majina ya waumini', family_code: null }));
        }
        const monthName = P.MONTHS[month - 1];
        const heading = audience === 'zaka_paid' ? 'Waliolipa' : 'Hawajalipa';
        const families = Object.values((people || []).reduce((map, person) => {
          const key = person.family_id || 'no-family';
          (map[key] ||= { id: key, name: person.family_name || 'Bila familia iliyowekwa', code: person.family_code, people: [] }).people.push(person);
          return map;
        }, {}));
        const choice = await P.modal({ title: `${heading} · ${unitLabel}`, submit: people?.length ? 'Andaa SMS kwa hawa' : null, wide: true,
          body: `<p class="pm-muted pm-zaka-sms-list-subtitle">${P.esc(unitLabel)} · ${P.esc(monthName)} ${year} · ${P.num(people?.length || 0)} waumini</p>
            <div class="pm-zaka-sms-people">${families.length ? families.map(f => `<details class="pm-zaka-sms-family"><summary><b>${P.esc(f.name)}</b>${f.code ? `<small>${P.esc(f.code)}</small>` : ''}<span>${P.num(f.people.length)} waumini</span></summary><div>${f.people.map(p => `<p>${P.esc(p.full_name)}</p>`).join('')}</div></details>`).join('') : '<p class="pm-muted">Hakuna waumini kwenye kundi hili kwa kipindi ulichochagua.</p>'}</div>` });
        if (choice && people?.length) {
          smsPrefill = { audience, unit_id: unitId, unit_label: unitLabel, year, month };
          el.querySelector('[data-new]').click();
        }
      } catch (err) { Toast.error(P.friendlyError(err)); }
    };
    box.addEventListener('click', e => { const b = e.target.closest('[data-zaka-list]'); if (b) showZakaList(b); });
    loadZakaRoster();
    el.querySelector('[data-new]').addEventListener('click', async () => {
      const prefill = smsPrefill; smsPrefill = null;
      let units = prefill?.unit_id ? [prefill.unit_id] : [];
      const defaultFor = audience => audience.startsWith('zaka_') || audience === 'zaka_payers' ? 'zaka_month' : audience === 'units' ? 'unit' : 'general';
      const v = await P.modal({ title: 'SMS mpya', submit: cfg.configured ? 'Andaa na Tuma' : 'Andaa', wide: true, body: `<div class="pm-form">
          ${prefill ? `<input type="hidden" name="audience" value="${prefill.audience}"><div class="pm-span2 pm-sms-fixed-audience"><small>Wapokeaji</small><b>${P.esc(AUD_SMS[prefill.audience])}</b><span>${P.esc(prefill.unit_label)} · ${P.esc(P.MONTHS[prefill.month - 1])} ${prefill.year}</span></div>`
            : `<label class="pm-span2">Kwa nani<select name="audience">${Object.entries(AUD_SMS).map(([k, l]) => `<option value="${k}" ${k === defaultAudience ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
          ${prefill?.unit_id ? `<input type="hidden" name="zaka_scope" value="${prefill.unit_id}">` : unitPicker([])}
          ${prefill ? '' : '<label class="pm-span2 pm-relall" data-zakaonly hidden><input type="checkbox" name="zaka_only" value="1"> Walipa zaka tu kwenye maeneo hayo</label>'}
          ${prefill ? `<input type="hidden" name="zaka_year" value="${prefill.year}"><input type="hidden" name="zaka_month" value="${prefill.month}">`
            : `<label>Mwaka wa taarifa<select name="zaka_year">${[P.thisYear() + 1, P.thisYear(), P.thisYear() - 1, P.thisYear() - 2].map(y => `<option ${y === P.year() ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          <label>Mwezi wa taarifa<select name="zaka_month"><option value="">Mwaka mzima</option>${P.MONTHS.map((mn, i) => `<option value="${i + 1}">${mn}</option>`).join('')}</select></label>
          <p class="pm-span2 pm-muted pm-small">Mwaka na mwezi huchagua taarifa zitakazoingizwa kwenye tokeni za Zaka. Kwa “Waliolipa/Hawajalipa”, pia hutumika kuchuja wapokeaji.</p>`}
          <label class="pm-span2">Chagua template<select name="template_kind"><option value="general">Ujumbe wa kawaida</option><option value="unit">Taarifa ya Jumuiya/Kigango</option><option value="zaka_month">Taarifa ya Zaka ya mwezi</option><option value="zaka_year">Muhtasari wa Zaka wa mwaka</option><option value="custom">Ujumbe wangu mwenyewe</option></select></label>
          <label class="pm-span2">Ujumbe / template<textarea name="body" required rows="5" maxlength="918"></textarea>
            <small class="pm-muted" data-len>0 herufi</small><div class="pm-sms-token-menu" data-token-menu hidden></div>
            <small class="pm-muted">Andika <b>@</b> ili kuchagua taarifa ya kuingiza. Unaweza pia kurekebisha template utakavyo.</small></label>
          <p class="pm-span2 pm-alert pm-alert--info" data-count>Inahesabu…</p>
          <section class="pm-span2 pm-sms-preview"><h4>Mfano wa ujumbe kwa mpokeaji mmoja</h4><p data-preview>Inatayarisha mfano…</p><small data-preview-meta></small></section></div>`,
        onOpen(m) {
          const s = m.querySelector('[name=audience]'), u = m.querySelector('[data-units]'), z = m.querySelector('[data-zakaonly]'), out = m.querySelector('[data-count]');
          const when = () => ['zaka_paid', 'zaka_unpaid'].includes(s.value) ? { zaka_year: Number(m.querySelector('[name=zaka_year]').value), zaka_month: m.querySelector('[name=zaka_month]').value ? Number(m.querySelector('[name=zaka_month]').value) : null } : {};
          const ta = m.querySelector('[name=body]'), len = m.querySelector('[data-len]'), template = m.querySelector('[name=template_kind]');
          const preview = m.querySelector('[data-preview]'), previewMeta = m.querySelector('[data-preview-meta]'), tokenMenu = m.querySelector('[data-token-menu]');
          let edited = false, menuStart = -1, menuEnd = -1;
          const setTemplate = kind => { template.value = kind; ta.value = SMS_TEMPLATES[kind] || ''; edited = kind === 'custom'; updateLength(); };
          const updateLength = () => { len.textContent = `${ta.value.length} herufi kwenye template · takriban SMS ${smsParts(ta.value)} kwa mpokeaji kabla ya kujazwa`; };
          const findTokens = () => {
            const before = ta.value.slice(0, ta.selectionStart), match = before.match(/@([a-z0-9_]*)$/i);
            if (!match) { tokenMenu.hidden = true; return; }
            const query = match[1].toLowerCase();
            const matches = SMS_TOKENS.filter(([key]) => key.startsWith(query)).slice(0, 9);
            if (!matches.length) { tokenMenu.hidden = true; return; }
            menuStart = ta.selectionStart - match[0].length;
            menuEnd = ta.selectionStart;
            tokenMenu.innerHTML = matches.map(([key, label]) => `<button type="button" data-insert-token="@${key}"><b>@${key}</b><small>${P.esc(label)}</small></button>`).join('');
            tokenMenu.hidden = false;
          };
          tokenMenu.addEventListener('click', e => {
            const b = e.target.closest('[data-insert-token]'); if (!b) return;
            const start = Math.max(0, menuStart), end = menuEnd, token = b.dataset.insertToken;
            ta.setRangeText(token, start, end, 'end'); tokenMenu.hidden = true; edited = true; updateLength(); refresh(); ta.focus();
          });
          ta.addEventListener('input', () => { edited = true; if (template.value !== 'custom') template.value = 'custom'; updateLength(); findTokens(); refresh(); });
          ta.addEventListener('keyup', findTokens); ta.addEventListener('click', findTokens);
          template.addEventListener('change', () => {
            if (template.value !== 'custom') setTemplate(template.value);
            if (template.value === 'zaka_month' && !m.querySelector('[name=zaka_month]').value) m.querySelector('[name=zaka_month]').value = String(new Date().getMonth() + 1);
            refresh();
          });
          let t;
          const refresh = () => { clearTimeout(t); t = setTimeout(async () => {
            if (!prefill?.unit_id) units = pickedUnits(m);
            try {
              const r = await P.rpc('sms_preview', { p: { body: ta.value, audience: s.value, unit_ids: units,
                zaka_only: !!m.querySelector('[name=zaka_only]:checked'), zaka_year: Number(m.querySelector('[name=zaka_year]').value),
                zaka_month: m.querySelector('[name=zaka_month]').value ? Number(m.querySelector('[name=zaka_month]').value) : null, ...when() } });
              out.innerHTML = `Ujumbe utaandaliwa kwa namba <b>${P.num(r.recipients)}</b> (kila namba mara moja). Waumini ${P.num(r.without_phone)} hawana simu kwenye rejista.`;
              preview.textContent = r.sample?.body || (r.recipients ? 'Andika ujumbe ili kuona mfano.' : 'Hakuna mpokeaji wa kuonyesha.');
              previewMeta.textContent = r.sample ? `Mfano: ${r.sample.name} · ${r.sample_length} herufi · takriban SMS ${smsParts(r.sample.body)}` : '';
            } catch (e) { out.textContent = P.friendlyError(e); preview.textContent = 'Mfano haupatikani kwa sasa.'; previewMeta.textContent = ''; }
          }, 250); };
          const sync = () => {
            if (u) u.hidden = !['units','zaka_paid','zaka_unpaid'].includes(s.value);
            if (z) z.hidden = s.value !== 'units';
            if (!edited) setTemplate(defaultFor(s.value));
            refresh();
          };
          if (['zaka_paid','zaka_unpaid','zaka_payers'].includes(s.value) && !m.querySelector('[name=zaka_month]').value)
            m.querySelector('[name=zaka_month]').value = String(new Date().getMonth() + 1);
          setTemplate(defaultFor(s.value));
          if (s.tagName === 'SELECT') s.addEventListener('change', sync);
          m.addEventListener('change', e => { if (['u', 'zaka_only', 'zaka_year', 'zaka_month'].includes(e.target.name)) refresh(); });
          sync();
        } });
      if (!v) return;
      if (['units','zaka_paid','zaka_unpaid'].includes(v.audience) && !units.length) { Toast.error('Chagua angalau kigango au jumuiya moja ili kubainisha eneo la ujumbe.'); return; }
      const zk = { zaka_year: Number(v.zaka_year), zaka_month: v.zaka_month ? Number(v.zaka_month) : null };
      const r = await P.rpc('sms_create', { p: { body: v.body, audience: v.audience, unit_ids: ['units','zaka_paid','zaka_unpaid'].includes(v.audience) ? units : [], zaka_only: !!v.zaka_only, ...zk } });
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
      const list = await P.q(P.from('sms_recipients').select('phone,full_name,personalized_body').eq('message_id', m.id).order('full_name').limit(20000));
      P.exportExcel(`sms_${String(m.created_at).slice(0, 10)}`, { Namba: list.map(x => ({ Jina: x.full_name, Simu: x.phone, Ujumbe: x.personalized_body || m.body })) });
    }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await P.confirm('Futa SMS hii?', 'Ujumbe na orodha yake ya namba vitafutwa.', 'Futa')) return;
      await P.rpc('sms_delete', { p_id: b.dataset.del }); P.refresh();
    }));
  }
})();
