/* Minga Parish — parish profile, structure, families & parishioners, leaders, users, settings */
(function () {
  const P = window.Parish, V = P.views;

  /* ================= TAARIFA ZA PAROKIA ================= */
  V.parish = {
    title: 'Taarifa za Parokia',
    async render(el) {
      const p = P.ref.parish, can = P.can('parish.configure');
      const verified = new Set(p.verified_fields || []);
      const F = [['official_name', 'Jina rasmi'], ['short_name', 'Jina fupi'], ['patron_saint', 'Somo wa parokia'], ['diocese', 'Jimbo'],
        ['region', 'Mkoa'], ['district', 'Wilaya'], ['postal_address', 'Anuani ya posta'], ['physical_address', 'Mahali'],
        ['phone', 'Simu'], ['email', 'Barua pepe'], ['parish_priest', 'Paroko'], ['established_year', 'Mwaka ilipoanzishwa'],
        ['logo_url', 'Nembo (URL ya picha)'], ['receipt_title', 'Kichwa cha risiti'], ['receipt_footer', 'Maandishi ya chini ya risiti'],
        ['report_header', 'Kichwa cha ripoti'], ['report_footer', 'Maandishi ya chini ya ripoti']];
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Taarifa za Parokia</h1>
          <p class="pm-muted">Taarifa zenye alama ✔ zimethibitishwa kutoka kwenye workbook ya parokia. Zilizo wazi zijazwe na msimamizi — mfumo haubuni taarifa.</p></div></div>
        <form class="pm-card pm-form" data-f>
          ${F.map(([k, l]) => `<label>${l} ${verified.has(k) ? '<span class="pm-ok">✔</span>' : ''}<input name="${k}" value="${P.esc(p[k] ?? '')}" ${can ? '' : 'readonly'}></label>`).join('')}
          <label class="pm-span2">Mapadri wasaidizi (tenganisha kwa koma)<input name="assistant_priests" value="${P.esc((p.assistant_priests || []).join(', '))}" ${can ? '' : 'readonly'}></label>
          <label class="pm-span2">Historia<textarea name="history" rows="3" ${can ? '' : 'readonly'}>${P.esc(p.history || '')}</textarea></label>
          <label>Dhamira (mission)<textarea name="mission" rows="2" ${can ? '' : 'readonly'}>${P.esc(p.mission || '')}</textarea></label>
          <label>Maono (vision)<textarea name="vision" rows="2" ${can ? '' : 'readonly'}>${P.esc(p.vision || '')}</textarea></label>
          <label>Mwezi wa kuanza mwaka wa fedha<input name="fy_start_month" type="number" min="1" max="12" value="${p.fy_start_month || 1}" ${can ? '' : 'readonly'}></label>
          <label>Akaunti za malipo (benki / M-Pesa) — moja kwa mstari<textarea name="payment_accounts" rows="3" ${can ? '' : 'readonly'}>${P.esc((p.payment_accounts || []).map(a => a.label || '').join('\n'))}</textarea></label>
          ${can ? '<div class="pm-span2"><button class="pm-btn pm-btn--primary">Hifadhi</button></div>' : ''}
        </form>`;
      el.querySelector('[data-f]').addEventListener('submit', async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        d.assistant_priests = d.assistant_priests ? d.assistant_priests.split(',').map(s => s.trim()).filter(Boolean) : [];
        d.payment_accounts = d.payment_accounts.split('\n').map(s => s.trim()).filter(Boolean).map(label => ({ label }));
        d.established_year = d.established_year ? Number(d.established_year) : null;
        d.fy_start_month = Number(d.fy_start_month || 1);
        const changed = F.map(f => f[0]).filter(k => (d[k] || '') !== (p[k] ?? '') && d[k]);
        d.verified_fields = [...new Set([...(p.verified_fields || []), ...changed])];
        Object.keys(d).forEach(k => { if (d[k] === '') d[k] = null; });
        await P.busy(e.submitter, () => P.q(P.from('parishes').update(d).eq('id', p.id)));
        await P.loadRef(true); Toast.success('Taarifa za parokia zimehifadhiwa.');
      });
    },
  };

  /* ================= VIGANGO NA JUMUIYA ================= */
  V.structure = {
    title: 'Vigango na Jumuiya', perm: 'registry.read',
    async render(el) {
      const [fams, people] = await Promise.all([
        P.q(P.from('families').select('jumuiya_id', { count: 'exact', head: false }).eq('status', 'active').limit(10000)),
        P.q(P.from('parishioners').select('jumuiya_id').eq('membership_status', 'active').limit(20000)),
      ]);
      const count = (arr, id) => arr.filter(x => x.jumuiya_id === id).length;
      const can = P.can('parish.configure');
      const kig = P.unitsOf('kigango');
      const groups = P.unitsOf('group');
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Vigango na Jumuiya</h1><p class="pm-muted">Parokia → Kigango → Jumuiya → Familia → Muumini. Majina yametoka kwenye workbook (HOMEDATA na named ranges).</p></div>
          <div class="pm-actions">${can ? '<button class="pm-btn pm-btn--primary" data-add><span class="material-symbols-outlined">add</span>Ongeza</button>' : ''}</div></div>
        <section class="pm-tree">${kig.map(k => {
          const js = P.unitsOf('jumuiya').filter(j => j.parent_id === k.id);
          const tf = js.reduce((s, j) => s + count(fams.data || fams, j.id), 0), tp = js.reduce((s, j) => s + count(people, j.id), 0);
          return `<div class="pm-card"><div class="pm-row"><h3 class="pm-h3">${P.esc(k.name)} ${P.badge('kigango', 'teal')}</h3>
            <small class="pm-muted">${js.length} jumuiya · ${tf} familia · ${tp} waumini</small>
            ${can ? `<button class="pm-icon-btn" data-edit="${k.id}" title="Hariri"><span class="material-symbols-outlined">edit</span></button>` : ''}</div>
            <ul class="pm-list">${js.map(j => `<li><a class="pm-link" href="#/registry?jumuiya=${j.id}">${P.esc(j.name)}</a><small>${count(fams.data || fams, j.id)} familia · ${count(people, j.id)} waumini</small>
              ${can ? `<button class="pm-icon-btn" data-edit="${j.id}"><span class="material-symbols-outlined">edit</span></button>` : ''}</li>`).join('')}</ul></div>`;
        }).join('')}
        <div class="pm-card"><h3 class="pm-h3">Vyama, Kanda na Kamati (ngazi ya parokia)</h3><ul class="pm-list">${groups.map(g => `<li>${P.esc(g.name)}${can ? `<button class="pm-icon-btn" data-edit="${g.id}"><span class="material-symbols-outlined">edit</span></button>` : ''}</li>`).join('')}</ul></div>
        </section>`;
      const edit = async (u) => {
        const v = await P.modal({ title: u ? `Hariri ${u.name}` : 'Ongeza kitengo', body: `<div class="pm-form">
          <label>Aina<select name="unit_type" ${u ? 'disabled' : ''}>${['kigango', 'jumuiya', 'group'].map(t => `<option ${u && u.unit_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Jina<input name="name" required value="${P.esc(u?.name || '')}"></label>
          <label>Ndani ya (kwa jumuiya: kigango)<select name="parent_id">${P.unitOptions(['kigango'], { blank: '— Parokia —', selected: u?.parent_id })}</select></label>
          <label>Hali<select name="is_active"><option value="true">Hai</option><option value="false" ${u && !u.is_active ? 'selected' : ''}>Haitumiki</option></select></label></div>` });
        if (!v) return;
        const root = P.ref.units.find(x => x.unit_type === 'parish');
        const row = { name: v.name, is_active: v.is_active === 'true', parent_id: v.parent_id || root.id };
        if (u) await P.q(P.from('org_units').update(row).eq('id', u.id));
        else await P.q(P.from('org_units').insert({ ...row, parish_id: P.ref.parish.id, unit_type: v.unit_type }));
        await P.loadRef(true); Toast.success('Imehifadhiwa. Historia ya miamala ya zamani inabaki kama ilivyo.'); P.reload();
      };
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => edit(P.ref.unitsById[b.dataset.edit])));
      const a = el.querySelector('[data-add]'); a && a.addEventListener('click', () => edit(null));
    },
  };

  /* family and parishioner forms (used here and on the jumuiya / family pages) */
  P.famForm = async (f, { jumuiya = '' } = {}) => {
    const v = await P.modal({ title: f ? 'Hariri familia' : 'Familia mpya', body: `<div class="pm-form">
      <label>Jina la familia<input name="family_name" required value="${P.esc(f?.family_name || '')}"></label>
      <label>Namba ya familia<input name="family_code" value="${P.esc(f?.family_code || '')}"></label>
      <label>Jumuiya<select name="jumuiya_id" required ${f ? 'disabled' : ''}>${P.unitOptions(['jumuiya'], { blank: 'Chagua…', selected: f?.jumuiya_id || jumuiya })}</select></label>
      <label>Simu<input name="phone" value="${P.esc(f?.phone || '')}"></label>
      <label class="pm-span2">Anuani<input name="address" value="${P.esc(f?.address || '')}"></label>
      ${f ? `<label>Mkuu wa familia<select name="head_parishioner_id">${P.options(f.parishioners, { label: 'full_name', blank: '—', selected: f.head_parishioner_id })}</select></label>
             <label>Hali<select name="status">${['active', 'inactive', 'moved'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}</div>
      ${f ? `<div class="pm-row-actions"><button type="button" class="pm-btn pm-btn--sm" data-movefam><span class="material-symbols-outlined">move_up</span>Hamisha familia jumuiya nyingine</button></div>` : ''}`,
      onOpen(m) {
        const mv = m.querySelector('[data-movefam]');
        mv && mv.addEventListener('click', () => { m.querySelector('[data-close]').click(); P.moveFamily(f); });
      } });
    if (!v) return;
    Object.keys(v).forEach(k => { if (v[k] === '') v[k] = null; });
    if (f) await P.q(P.from('families').update(v).eq('id', f.id));
    else await P.q(P.from('families').insert({ ...v, parish_id: P.ref.parish.id }));
    Toast.success('Familia imehifadhiwa.'); P.reload();
  };
  P.personForm = async (fam, p, { families = [] } = {}) => {
    // titles (vyeo) from the administrator's list, by level; those the person holds now are ticked
    const [positions, held] = await Promise.all([
      P.q(P.from('leadership_positions').select('id,title_sw,level,sort_order,is_active').in('level', ['jumuiya', 'kigango', 'parish']).order('sort_order')),
      p ? P.q(P.from('leadership_assignments').select('position_id').eq('parishioner_id', p.id).eq('status', 'active')) : [],
    ]);
    const had = new Set(held.map(h => h.position_id));
    const titles = new Set(had);
    const LEVEL = { jumuiya: 'Jumuiya', kigango: 'Kigango', parish: 'Parokia' };
    const shown = positions.filter(x => x.is_active !== false || had.has(x.id));
    const age = p?.birth_year ? P.thisYear() - p.birth_year : '';
    const v = await P.modal({ title: p ? 'Hariri muumini' : `Muumini mpya — ${fam.family_name}`, body: `<div class="pm-form">
      <label class="pm-span2">Jina kamili<input name="full_name" required value="${P.esc(p?.full_name || '')}"></label>
      <label>Jinsi<select name="gender"><option value="">—</option><option value="male" ${p?.gender === 'male' ? 'selected' : ''}>Me</option><option value="female" ${p?.gender === 'female' ? 'selected' : ''}>Ke</option></select></label>
      <label>Uhusiano<input name="relationship" list="pm-rel" value="${P.esc(p?.relationship || '')}"><datalist id="pm-rel">${['BABA', 'MAMA', 'MTOTO', 'MJUKUU', 'BIBI', 'BABU', 'KAKA', 'DADA', 'MJOMBA', 'SHANGAZI'].map(x => `<option>${x}</option>`).join('')}</datalist></label>
      <label>Simu<input name="phone" value="${P.esc(p?.phone || '')}"></label>
      <label>Umri (miaka)<input name="age" type="number" min="0" max="120" inputmode="numeric" value="${age}" placeholder="mf. 34"></label>
      <label>Mwaka wa kuzaliwa<input name="birth_year" type="number" min="1900" max="2100" value="${P.esc(p?.birth_year || '')}"></label>
      <label>Mlipa zaka<select name="is_zaka_payer"><option value="false">Hapana</option><option value="true" ${p?.is_zaka_payer ? 'selected' : ''}>Ndiyo</option></select></label>
      <label>Hali<select name="membership_status">${['active', 'inactive', 'moved', 'deceased', ...(p?.membership_status === 'removed' ? ['removed'] : [])].map(s => `<option value="${s}" ${p?.membership_status === s ? 'selected' : ''}>${P.MEMBER_STATUS[s]}${s === 'active' && p?.membership_status === 'removed' ? ' (mrudishe kwenye rejista)' : ''}</option>`).join('')}</select></label>
      ${p?.membership_status === 'removed' ? `<p class="pm-span2 pm-alert">Ameondolewa kwenye rejista${p.removed_on ? ' ' + P.date(String(p.removed_on).slice(0, 10)) : ''}${p.removed_reason ? ': ' + P.esc(p.removed_reason) : ''}. Chagua "Hai" kumrudisha.</p>` : ''}
      ${p ? `<label class="pm-span2">Hamishia familia nyingine (hiari)<select name="family_id">${P.options(families.length ? families : [fam], { label: 'family_name', selected: fam.id })}</select></label>` : ''}
      ${shown.length ? `<fieldset class="pm-span2 pm-titles"><legend>Vyeo (hiari) — mtu mmoja anaweza kuwa na vyeo zaidi ya kimoja</legend>
        ${Object.entries(LEVEL).map(([lv, lbl]) => {
          const list = shown.filter(x => x.level === lv);
          return list.length ? `<div><small class="pm-muted">${lbl}</small>${list.map(x => `<label class="pm-relall"><input type="checkbox" data-title="${x.id}" ${had.has(x.id) ? 'checked' : ''}> ${P.esc(x.title_sw)}${x.is_active === false ? ' <small class="pm-muted">(hakitumiki)</small>' : ''}</label>`).join('')}</div>` : '';
        }).join('')}</fieldset>` : ''}</div>
      ${p ? `<div class="pm-row-actions"><button type="button" class="pm-btn pm-btn--sm" data-moveperson><span class="material-symbols-outlined">move_up</span>Hamisha jumuiya / familia</button>
        ${p.membership_status !== 'removed' ? '<button type="button" class="pm-btn pm-btn--sm pm-btn--danger" data-delperson><span class="material-symbols-outlined">person_remove</span>Ondoa kwenye rejista</button>' : ''}</div>` : ''}`,
      onOpen(m) {
        const mv = m.querySelector('[data-moveperson]'), del = m.querySelector('[data-delperson]');
        mv && mv.addEventListener('click', () => { m.querySelector('[data-close]').click(); P.movePerson(p, fam); });
        del && del.addEventListener('click', () => { m.querySelector('[data-close]').click(); P.deletePerson(p); });
        // age and year of birth fill each other
        const a = m.querySelector('[name=age]'), y = m.querySelector('[name=birth_year]');
        a.addEventListener('input', () => { y.value = a.value !== '' ? P.thisYear() - Number(a.value) : ''; });
        y.addEventListener('input', () => { a.value = Number(y.value) > 1900 ? P.thisYear() - Number(y.value) : ''; });
        m.querySelectorAll('[data-title]').forEach(c => c.addEventListener('change', () => { if (c.checked) titles.add(c.dataset.title); else titles.delete(c.dataset.title); }));
      } });
    if (!v) return;
    delete v.age;
    const row = { ...v, birth_year: v.birth_year ? Number(v.birth_year) : null, is_zaka_payer: v.is_zaka_payer === 'true', gender: v.gender || null };
    const target = families.find(x => x.id === (row.family_id || fam.id)) || fam;
    row.family_id = target.id; row.jumuiya_id = target.jumuiya_id;
    let id = p?.id;
    if (p) await P.q(P.from('parishioners').update(row).eq('id', p.id));
    else id = (await P.q(P.from('parishioners').insert({ ...row, parish_id: P.ref.parish.id, registered_on: P.today() }).select('id').single())).id;
    const changed = titles.size !== had.size || [...titles].some(t => !had.has(t));
    if (changed) {
      try { await P.rpc('set_person_titles', { p_parishioner: id, p_positions: [...titles] }); }
      catch (e) { Toast.error(`Muumini amehifadhiwa, lakini vyeo havikuhifadhiwa: ${P.friendlyError(e)}`); P.reload(); return; }
    }
    Toast.success('Muumini amehifadhiwa.'); P.reload();
  };

  /* moving a member: to another family of the same jumuiya, a family of another
     jumuiya, or a new family there. Their payments follow when ticked. */
  const moneyTick = (what) => `<label class="pm-span2 pm-relall"><input type="checkbox" name="move_money" value="1" checked>
      Hamisha pia michango na miamala ${what} ya zamani (itaonekana kwenye jumuiya mpya)</label>
    <p class="pm-span2 pm-muted pm-small">Kiasi, tarehe na risiti hazibadiliki — ni jumuiya inayohesabiwa tu. Ukiondoa tiki, michango ya zamani inabaki kwenye jumuiya ya awali.</p>`;
  P.movePerson = async (p, fam) => {
    const curJ = p.jumuiya_id || fam?.jumuiya_id || '';
    const v = await P.modal({ title: `Hamisha — ${p.full_name}`, submit: 'Hamisha', body: `<div class="pm-form">
      <label class="pm-span2">Jumuiya anayohamia<select name="jumuiya_id" required>${P.unitOptions(['jumuiya'], { blank: 'Chagua…', selected: curJ })}</select></label>
      <label class="pm-span2">Familia<select name="family_id" required data-fams><option value="">Inapakia…</option></select></label>
      <label class="pm-span2" data-newfam hidden>Jina la familia mpya<input name="new_family_name" value="Familia ya ${P.esc(p.full_name)}"></label>
      ${moneyTick('yake')}
      <label class="pm-span2">Sababu (hiari)<input name="reason" maxlength="200" placeholder="mf. Amehamia mtaa mwingine"></label></div>`,
      onOpen(m) {
        const js = m.querySelector('[name=jumuiya_id]'), fs = m.querySelector('[data-fams]'), nf = m.querySelector('[data-newfam]');
        const syncNew = () => { nf.hidden = fs.value !== '__new'; nf.querySelector('input').required = fs.value === '__new'; };
        const load = async () => {
          fs.innerHTML = '<option value="">Inapakia…</option>';
          const list = js.value ? await P.q(P.from('families').select('id,family_name,family_code').eq('jumuiya_id', js.value).order('family_name').limit(1000)) : [];
          fs.innerHTML = `<option value="">Chagua familia…</option>` + list.filter(f => f.id !== fam?.id)
            .map(f => `<option value="${f.id}">${P.esc(f.family_name)}${f.family_code ? ` (Na. ${P.esc(f.family_code)})` : ''}</option>`).join('')
            + `<option value="__new">+ Aanzishe familia mpya</option>`;
          syncNew();
        };
        js.addEventListener('change', load); fs.addEventListener('change', syncNew); load();
      } });
    if (!v) return;
    const isNew = v.family_id === '__new';
    const r = await P.rpc('move_parishioner', { p_parishioner: p.id, p_family: isNew ? null : v.family_id, p_jumuiya: v.jumuiya_id,
      p_new_family_name: isNew ? v.new_family_name : null, p_move_money: !!v.move_money, p_reason: v.reason || null });
    Toast.success(`${p.full_name} amehamishwa${r.payments_moved ? ` pamoja na malipo ${r.payments_moved}` : ''}.`);
    P.go(`#/family?id=${r.family_id}`);
  };
  P.moveFamily = async (f) => {
    const v = await P.modal({ title: `Hamisha familia — ${f.family_name}`, submit: 'Hamisha', body: `<div class="pm-form">
      <label class="pm-span2">Jumuiya inayohamia<select name="jumuiya_id" required>${P.unitOptions(['jumuiya'], { blank: 'Chagua…' })}</select></label>
      <p class="pm-span2 pm-muted pm-small">Wanafamilia wote wanahamia pamoja na familia.</p>
      ${moneyTick('ya familia')}
      <label class="pm-span2">Sababu (hiari)<input name="reason" maxlength="200"></label></div>` });
    if (!v) return;
    const r = await P.rpc('move_family', { p_family: f.id, p_jumuiya: v.jumuiya_id, p_move_money: !!v.move_money, p_reason: v.reason || null });
    Toast.success(`Familia imehamishwa${r.payments_moved ? ` pamoja na malipo ${r.payments_moved}` : ''}.`);
    P.reload();
  };
  // removed from the register (soft delete): the record, payments, attendance and title history stay
  P.deletePerson = async (p) => {
    const n = await P.q(P.from('finance_transactions').select('id', { count: 'exact', head: true }).eq('parishioner_id', p.id)).catch(() => null);
    const count = n && n.count !== undefined ? n.count : null;
    const v = await P.modal({ title: `Ondoa ${p.full_name} kwenye rejista?`, submit: 'Ondoa', body: `<div class="pm-form">
      <p class="pm-span2">Hataonekana tena kwenye orodha za waumini hai, mahudhurio mapya wala SMS. Vyeo vyake vitamalizwa na akaunti yake (kama ipo) haitaunganishwa naye tena.</p>
      <p class="pm-span2 pm-alert">Hakuna kinachofutwa: ${count ? `malipo yake <b>${count}</b>` : 'malipo yake (kama yapo)'}, mahudhurio na historia ya vyeo vinabaki kwa jina lake. Akiondolewa kwa makosa, unaweza kumrudisha (Hariri → Hali: Hai). Kama amehamia jumuiya nyingine, tumia "Hamisha" badala yake.</p>
      <label class="pm-span2">Sababu<input name="reason" required minlength="3" maxlength="200" placeholder="mf. Amehamia parokia nyingine / ameandikishwa mara mbili"></label>
      <label class="pm-span2 pm-relall"><input type="checkbox" name="sure" value="1" required> Nimeelewa — mwondoe kwenye rejista</label></div>` });
    if (!v) return;
    const r = await P.rpc('delete_parishioner', { p_parishioner: p.id, p_reason: v.reason });
    Toast.success(`Ameondolewa kwenye rejista. Malipo ${r.payments_kept} na historia yake vimebaki.`);
    P.reload();
  };

  /* ================= FAMILIA NA WAUMINI ================= */
  V.registry = {
    title: 'Familia na Waumini', perm: 'registry.read',
    async render(el, params) {
      const jum = params.jumuiya || (P.scopeUnit() && P.ref.unitsById[P.scopeUnit()].unit_type === 'jumuiya' ? P.scopeUnit() : '');
      const q = params.q || '';
      el.innerHTML = `
        <div class="pm-head"><div><h1 class="pm-h1">Familia na Waumini</h1><p class="pm-muted">Rejista ya parokia. Muumini anaweza kuwa kwenye rejista bila kutumia mfumo mtandaoni.</p></div>
          <div class="pm-actions">${P.can('registry.write') || P.access.permissions.includes('registry.write') ? `<button class="pm-btn pm-btn--primary" data-newfam><span class="material-symbols-outlined">add</span>Familia mpya</button>` : ''}
          <button class="pm-btn" data-xls>Excel</button></div></div>
        <form class="pm-filters"><label>Jumuiya<select name="jumuiya">${P.unitOptions(['jumuiya'], { blank: 'Chagua jumuiya…', selected: jum })}</select></label>
          <label>Tafuta jina<input name="q" value="${P.esc(q)}"></label><button class="pm-btn">Onyesha</button></form>
        <div data-out></div>`;
      el.querySelector('.pm-filters').addEventListener('submit', e => { e.preventDefault(); P.go('#/registry?' + new URLSearchParams(Object.fromEntries(new FormData(e.target)))); });
      const out = el.querySelector('[data-out]');
      if (!jum && !q) { out.innerHTML = P.empty('Chagua jumuiya au tafuta jina.'); return; }
      out.innerHTML = P.loading();
      let fq = P.from('families').select('*, parishioners!parishioners_family_id_fkey(id,full_name,gender,relationship,phone,birth_year,is_zaka_payer,membership_status,removed_on,removed_reason,profile_id)').order('family_code');
      if (jum) fq = fq.eq('jumuiya_id', jum);
      if (q) {
        const ids = await P.q(P.from('parishioners').select('family_id').ilike('full_name', `%${q}%`).limit(200));
        const fids = [...new Set(ids.map(i => i.family_id).filter(Boolean))];
        fq = fids.length ? fq.or(`family_name.ilike.%${q}%,id.in.(${fids.join(',')})`) : fq.ilike('family_name', `%${q}%`);
      }
      const fams = await P.q(fq.limit(300));
      const canW = P.access.platform_admin || P.access.permissions.includes('registry.write');
      out.innerHTML = fams.length ? `<p class="pm-muted pm-small">${fams.length} familia · ${fams.reduce((s, f) => s + f.parishioners.length, 0)} waumini</p>` + fams.map(f => `
        <div class="pm-card pm-family"><div class="pm-row"><div><h3 class="pm-h3">${P.esc(f.family_name)}</h3>
          <small class="pm-muted">Na. ${P.esc(f.family_code || '—')} · ${P.esc(P.ref.unitsById[f.jumuiya_id]?.label || '')} ${f.phone ? '· ' + P.esc(f.phone) : ''}</small></div>
          <div class="pm-actions"><a class="pm-btn pm-btn--sm" href="#/statement?family=${f.id}">Taarifa ya michango</a>
          ${canW ? `<button class="pm-btn pm-btn--sm" data-addp="${f.id}">+ Muumini</button><button class="pm-btn pm-btn--sm" data-editf="${f.id}">Hariri</button>` : ''}</div></div>
          ${P.table(f.parishioners, [{ key: 'full_name', label: 'Jina', html: p => `${P.esc(p.full_name)}${p.id === f.head_parishioner_id ? ' ' + P.badge('Mkuu', 'gold') : ''}${p.profile_id ? ' ' + P.badge('ana akaunti', 'teal') : ''}` },
            { key: 'relationship', label: 'Uhusiano' }, { key: 'gender', label: 'Jinsi', fmt: g => g === 'male' ? 'Me' : g === 'female' ? 'Ke' : '—' },
            { key: 'birth_year', label: 'Umri', fmt: y => y ? P.thisYear() - y : '—', cls: 'pm-num' },
            { key: 'phone', label: 'Simu' }, { key: 'is_zaka_payer', label: 'Mlipa zaka', fmt: v => v ? 'Ndiyo' : '—' },
            { key: 'membership_status', label: 'Hali', html: p => p.membership_status === 'removed' ? P.badge(P.MEMBER_STATUS.removed, 'rose') : P.esc(P.MEMBER_STATUS[p.membership_status] || p.membership_status) },
            { key: 'id', label: '', html: p => `<a class="pm-btn pm-btn--sm" href="#/statement?parishioner=${p.id}">Michango</a>${canW ? ` <button class="pm-btn pm-btn--sm" data-editp="${p.id}" data-fam="${f.id}">Hariri</button>` : ''}` }])}
        </div>`).join('') : P.empty('Hakuna familia iliyopatikana.');
      const famById = Object.fromEntries(fams.map(f => [f.id, f]));
      const famForm = f => P.famForm(f, { jumuiya: jum });
      const personForm = (fam, p) => P.personForm(fam, p, { families: fams });
      const nf = el.querySelector('[data-newfam]'); nf && nf.addEventListener('click', () => famForm(null));
      out.querySelectorAll('[data-editf]').forEach(b => b.addEventListener('click', () => famForm(famById[b.dataset.editf])));
      out.querySelectorAll('[data-addp]').forEach(b => b.addEventListener('click', () => personForm(famById[b.dataset.addp], null)));
      out.querySelectorAll('[data-editp]').forEach(b => b.addEventListener('click', () => {
        const f = famById[b.dataset.fam]; personForm(f, f.parishioners.find(p => p.id === b.dataset.editp));
      }));
      el.querySelector('[data-xls]').addEventListener('click', () => P.exportExcel('rejista', { Waumini: fams.flatMap(f => f.parishioners.map(p => ({
        Familia: f.family_name, Na_familia: f.family_code, Jumuiya: P.ref.unitsById[f.jumuiya_id]?.label, Jina: p.full_name, Uhusiano: p.relationship,
        Jinsi: p.gender, Simu: p.phone, Mlipa_zaka: p.is_zaka_payer ? 'Ndiyo' : '', Hali: P.MEMBER_STATUS[p.membership_status] || p.membership_status }))) }));
    },
  };

  /* contribution statement for a family or a parishioner (also usable by members for themselves) */
  V.statement = {
    title: 'Taarifa ya Michango',
    async render(el, params) {
      const isFam = !!params.family, id = params.family || params.parishioner;
      const who = isFam ? await P.q(P.from('families').select('family_name,jumuiya_id').eq('id', id).single())
                        : await P.q(P.from('parishioners').select('full_name,jumuiya_id,family_id').eq('id', id).single());
      const name = isFam ? who.family_name : who.full_name;
      const col = isFam ? 'family_id' : 'parishioner_id';
      // a person's statement also shows what was paid and pledged by their family (Mavuno/Ujenzi are family pledges)
      const fam = !isFam && who.family_id;
      const [tx0, pl0, ftx, fpl] = await Promise.all([
        P.q(P.from('v_ledger').select('*').eq(col, id).eq('status', 'posted').order('txn_date', { ascending: false }).limit(1000)),
        P.q(P.from('v_pledge_balances').select('*').eq(col, id).order('campaign_year', { ascending: false })),
        fam ? P.q(P.from('v_ledger').select('*').eq('family_id', who.family_id).is('parishioner_id', null).eq('status', 'posted').order('txn_date', { ascending: false }).limit(1000)) : [],
        fam ? P.q(P.from('v_pledge_balances').select('*').eq('family_id', who.family_id).order('campaign_year', { ascending: false })) : [],
      ]);
      const notices = P.selfOnly && P.selfOnly() ? await P.announcementsHtml() : '';
      const tx = [...tx0, ...ftx].sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)));
      const pl = [...pl0, ...fpl];
      const byCat = {};
      tx.forEach(t => { const k = `${t.category_name} ${t.campaign_year || t.financial_year}`; byCat[k] = (byCat[k] || 0) + Number(t.net_amount); });
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">${P.esc(name)}</h1><p class="pm-muted">${P.esc(P.ref.unitsById[who.jumuiya_id]?.label || '')}</p></div>
        <div class="pm-actions">${P.selfOnly && P.selfOnly() ? '' : '<button class="pm-btn" onclick="history.back()">Rudi</button>'}<button class="pm-btn" data-print>Chapa</button></div></div>
        ${notices}
        ${P.reportHeader('Taarifa ya michango', name)}
        <section class="pm-card"><h3 class="pm-h3">Ahadi</h3>${P.table(pl, [{ key: 'campaign_name', label: 'Kampeni' }, { key: 'pledged', label: 'Ahadi', fmt: P.tzs, cls: 'pm-num' },
          { key: 'paid', label: 'Amelipa', fmt: P.tzs, cls: 'pm-num' }, { key: 'outstanding', label: 'Deni', fmt: P.tzs, cls: 'pm-num pm-strong' },
          { key: 'excess', label: 'Ziada', fmt: v => Number(v) ? P.tzs(v) : '—', cls: 'pm-num' }, { key: 'completion_pct', label: '%', fmt: P.pct }], { empty: 'Hakuna ahadi.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Muhtasari kwa aina</h3>${P.table(Object.entries(byCat).map(([k, v]) => ({ k, v })), [{ key: 'k', label: 'Aina / mwaka' }, { key: 'v', label: 'Jumla', fmt: P.tzs, cls: 'pm-num' }])}</section>
        <section class="pm-card"><h3 class="pm-h3">Malipo yote</h3>${P.table(tx, [{ key: 'txn_date', label: 'Tarehe', fmt: P.date }, { key: 'category_name', label: 'Aina' },
          { key: 'campaign_name', label: 'Kampeni' }, { key: 'period_month', label: 'Mwezi wa zaka', fmt: v => v ? v.slice(0, 7) : '' },
          { key: 'net_amount', label: 'Kiasi', fmt: P.tzs, cls: 'pm-num' }, { key: 'receipt_no', label: 'Risiti', html: r => P.esc(r.receipt_no || (r.legacy_receipt_no ? 'Excel #' + r.legacy_receipt_no : '—')) }])}</section>`;
      el.querySelector('[data-print]').addEventListener('click', () => P.print('Taarifa ya michango ' + name));
    },
  };

  /* ================= VIONGOZI ================= */
  V.leaders = {
    title: 'Viongozi', perm: 'registry.read',
    async render(el) {
      const [pos, rows] = await Promise.all([
        P.q(P.from('leadership_positions').select('*').order('sort_order')),
        P.q(P.from('leadership_assignments').select('*, leadership_positions(title_sw,level,sort_order)').order('status').order('starts_on', { ascending: false })),
      ]);
      const canW = P.access.platform_admin || P.access.permissions.includes('registry.write');
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Viongozi</h1><p class="pm-muted">Uongozi wa kanisa (Paroko, viongozi wa vigango na jumuiya…) — tofauti na ruhusa za kutumia mfumo.</p></div>
        <div class="pm-actions">${canW ? '<button class="pm-btn pm-btn--primary" data-new><span class="material-symbols-outlined">add</span>Kiongozi</button>' : ''}</div></div>
        <section class="pm-card">${P.table(rows, [{ key: 'title', label: 'Nafasi', html: r => P.esc(r.leadership_positions?.title_sw) },
          { key: 'org', label: 'Kitengo', html: r => P.esc(P.ref.unitsById[r.org_unit_id]?.label || '') }, { key: 'holder_name', label: 'Jina' }, { key: 'phone', label: 'Simu' },
          { key: 'starts_on', label: 'Kuanzia', fmt: P.date }, { key: 'ends_on', label: 'Hadi', fmt: P.date },
          { key: 'status', label: 'Hali', html: r => P.badge(r.status === 'active' ? 'Hai' : 'Ameondoka', r.status === 'active' ? 'teal' : 'muted') },
          { key: 'id', label: '', html: r => canW && r.status === 'active' ? `<button class="pm-btn pm-btn--sm" data-end="${r.id}">Maliza</button>` : '' }],
          { empty: 'Hakuna viongozi waliosajiliwa. Workbook haina orodha ya viongozi inayoweza kuthibitishwa — waongeze hapa.' })}</section>`;
      const nb = el.querySelector('[data-new]');
      nb && nb.addEventListener('click', async () => {
        let person = null;
        const v = await P.modal({ title: 'Kiongozi mpya', body: `<div class="pm-form">
          <label>Nafasi<select name="position_id" required>${P.options(pos.filter(x => x.is_active !== false), { label: 'title_sw', blank: 'Chagua…' })}</select></label>
          <label>Kitengo<select name="org_unit_id" required>${P.unitOptions(['kigango', 'jumuiya', 'group'], { blank: 'Chagua…' })}${(() => { const r = P.ref.units.find(u => u.unit_type === 'parish'); return `<option value="${r.id}">Parokia</option>`; })()}</select></label>
          <label class="pm-span2">Jina (tafuta kwenye rejista au andika)<div class="pm-search"><input data-payer-search name="holder_name" required autocomplete="off"><div data-payer-results class="pm-search__results"></div></div></label>
          <label>Simu<input name="phone"></label><label>Kuanzia<input name="starts_on" type="date" value="${P.today()}"></label></div>`,
          onOpen: m => P.payerPicker(m, { onPick: p => { person = p.kind === 'parishioner' ? p.id : null; } }) });
        if (!v) return;
        await P.q(P.from('leadership_assignments').insert({ ...v, parishioner_id: person, phone: v.phone || null, starts_on: v.starts_on || null }));
        Toast.success('Kiongozi amehifadhiwa.'); P.reload();
      });
      el.querySelectorAll('[data-end]').forEach(b => b.addEventListener('click', async () => {
        if (!await P.confirm('Maliza uongozi', 'Kiongozi huyu ataonyeshwa kama ameondoka leo.')) return;
        await P.q(P.from('leadership_assignments').update({ status: 'ended', ends_on: P.today() }).eq('id', b.dataset.end));
        P.reload();
      }));
    },
  };

  /* ================= WATUMIAJI ================= */
  // accounts that sign in by phone have a private address made from the number (migration 29)
  P.PHONE_DOMAIN = '@simu.parokia.local';
  P.loginOf = p => p ? (p.phone && (!p.email || String(p.email).endsWith(P.PHONE_DOMAIN)) ? `+${p.phone}` : (p.email || '')) : '';
  V.users = {
    title: 'Watumiaji', perm: 'users.manage',
    async render(el) {
      const [roles, grants, profs] = await Promise.all([
        P.q(P.from('parish_roles').select('*').order('sort_order')),
        P.q(P.from('parish_user_roles').select('*').order('granted_at', { ascending: false })),
        P.q(P.from('profiles').select('id,full_name,email,phone,role,status,created_at').order('full_name').limit(2000)),
      ]);
      const linked = await P.q(P.from('parishioners').select('id,full_name,profile_id').not('profile_id', 'is', null).limit(5000)).catch(() => []);
      const personOf = Object.fromEntries(linked.map(x => [x.profile_id, x]));
      const byUser = {};
      grants.forEach(g => { (byUser[g.user_id] ||= []).push(g); });
      const roleName = c => roles.find(r => r.code === c)?.name_sw || c;
      const isSuper = P.access.platform_admin;
      const canTouch = u => u.id !== P.profile.id && (isSuper || u.role !== 'super_admin');
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Watumiaji na Ruhusa</h1>
          <p class="pm-muted">Watumiaji wanaingia kwa <b>namba ya simu na nenosiri</b>. Akaunti zinaundwa hapa na Msimamizi; mtumiaji akisahau nenosiri, Msimamizi anamwekea jipya. Ruhusa zinatekelezwa na database (RLS), si kwa kuficha vitufe tu.</p></div>
        <div class="pm-actions"><button class="pm-btn pm-btn--primary" data-newuser><span class="material-symbols-outlined">person_add</span>Mtumiaji mpya</button>
          <button class="pm-btn" data-grant><span class="material-symbols-outlined">add_moderator</span>Toa nafasi</button></div></div>
        <form class="pm-filters" data-find><label class="pm-wide">Tafuta<input name="q" placeholder="Jina, namba ya simu au barua pepe"></label></form>
        <section class="pm-card">${P.table(profs, [
          { key: 'full_name', label: 'Mtumiaji', html: u => `<b>${P.esc(u.full_name || '—')}</b>${u.role === 'super_admin' ? ' ' + P.badge('Msimamizi wa Mfumo', 'gold') : ''}${u.status !== 'active' ? ' ' + P.badge('Amesimamishwa', 'rose') : ''}
              <br><small class="pm-muted">${P.esc(P.loginOf(u))}</small>${personOf[u.id] ? `<br><small>Muumini: <a class="pm-link" href="#/statement?parishioner=${personOf[u.id].id}">${P.esc(personOf[u.id].full_name)}</a></small>` : ''}` },
          { key: 'roles', label: 'Nafasi', html: u => (byUser[u.id] || []).map(g => `<span class="pm-chip">${P.esc(roleName(g.role_code))}${g.org_unit_id ? ' · ' + P.esc(P.ref.unitsById[g.org_unit_id]?.label || '') : ''}${u.id === P.profile.id ? '' : `<button type="button" title="Ondoa nafasi hii" data-revoke="${g.id}">×</button>`}</span>`).join(' ') || '<small class="pm-muted">Hana nafasi</small>' },
          { key: 'login', label: 'Kuingia', html: u => String(u.email || '').endsWith(P.PHONE_DOMAIN) ? P.badge('Simu', 'teal') : P.badge('Barua pepe', 'muted') },
          { key: 'id', label: '', html: u => canTouch(u) ? `<span class="pm-nowrap">
              <button class="pm-btn pm-btn--sm" data-pw="${u.id}" title="Weka nenosiri jipya"><span class="material-symbols-outlined">key</span>Nenosiri</button>
              <button class="pm-btn pm-btn--sm" data-phone="${u.id}" title="Aingie kwa namba hii ya simu"><span class="material-symbols-outlined">smartphone</span>Simu</button>
              <button class="pm-btn pm-btn--sm" data-role="${u.id}">+ Nafasi</button>
              <button class="pm-btn pm-btn--sm ${u.status === 'active' ? 'pm-btn--danger' : ''}" data-status="${u.id}">${u.status === 'active' ? 'Simamisha' : 'Rudisha'}</button></span>` : '' }],
          { rowAttr: u => `data-row="${P.esc([u.full_name, u.email, u.phone].join(' ').toLowerCase())}"`, empty: 'Hakuna akaunti.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Unganisha akaunti na muumini wa rejista</h3>
          <p class="pm-muted">Baada ya kuunganishwa, muumini ataona michango na ahadi zake tu.</p>
          <form class="pm-form" data-link><label>Namba ya simu au barua pepe ya akaunti<input name="login" required></label>
          <label>Muumini<div class="pm-search"><input data-payer-search name="who" required autocomplete="off"><div data-payer-results class="pm-search__results"></div></div></label>
          <div class="pm-span2"><button class="pm-btn">Unganisha</button></div></form></section>`;
      const byId = Object.fromEntries(profs.map(u => [u.id, u]));
      el.querySelector('[data-find] input').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase().replace(/^0/, '');
        el.querySelectorAll('tr[data-row]').forEach(tr => { tr.hidden = !!q && !tr.dataset.row.includes(q); });
      });
      el.querySelector('[data-find]').addEventListener('submit', e => e.preventDefault());
      const roleFields = (opt) => `<label>Nafasi${opt ? ' (hiari)' : ''}<select name="role_code" ${opt ? '' : 'required'}>${opt ? '<option value="">— Bila nafasi —</option>' : ''}${P.options(roles, { value: 'code', label: r => `${r.name_sw}${r.scoped ? ' (eneo)' : ''}` })}</select></label>
          <label>Eneo (kwa viongozi wa kigango/jumuiya)<select name="org_unit_id">${P.unitOptions(['kigango', 'jumuiya'], { blank: 'Parokia nzima' })}</select></label>`;
      const pwField = `<label>Nenosiri (angalau herufi 6)<input name="password" required minlength="6" autocomplete="new-password" data-pw-input>
          <small class="pm-muted"><button type="button" class="pm-linkbtn" data-genpw>Tengeneza nenosiri</button></small></label>`;
      const wirePw = m => { const b = m.querySelector('[data-genpw]'); b && b.addEventListener('click', () => {
        const w = ['Imani', 'Tumaini', 'Upendo', 'Amani', 'Neema', 'Baraka'][Math.floor(Math.random() * 6)];
        m.querySelector('[data-pw-input]').value = w + (1000 + Math.floor(Math.random() * 9000)); }); };
      const told = (login, pw) => P.modal({ title: 'Mpe mtumiaji taarifa hizi', submit: null, body: `<div class="pm-alert pm-alert--info">
          <p>Kuingia: <b>${P.esc(login)}</b></p><p>Nenosiri: <b>${P.esc(pw)}</b></p></div>
          <p class="pm-muted pm-small">Aingie kwenye ukurasa wa kuingia kwa namba yake ya simu na nenosiri hili. Mfumo hautumi SMS: mpe taarifa hizi wewe mwenyewe.</p>` });

      el.querySelector('[data-newuser]').addEventListener('click', async () => {
        let person = null;
        const v = await P.modal({ title: 'Mtumiaji mpya', wide: true, body: `<div class="pm-form">
            <label class="pm-span2">Jina kamili<input name="full_name" required></label>
            <label>Namba ya simu (ya kuingia)<input name="phone" required inputmode="tel" placeholder="mf. 0712 345 678"></label>
            ${pwField}
            ${roleFields(true)}
            <label class="pm-span2">Muumini wa rejista (hiari — kama ni muumini anayeona michango yake)<div class="pm-search"><input data-payer-search name="who" autocomplete="off"><div data-payer-results class="pm-search__results"></div></div></label>
            <label class="pm-span2">Barua pepe (hiari, kwa mawasiliano tu)<input name="email" type="email"></label></div>`,
          onOpen: m => { wirePw(m); P.payerPicker(m, { onPick: p => { person = p.kind === 'parishioner' ? p.id : null; } }); } });
        if (!v) return;
        const r = await P.rpc('admin_create_user', { p: { full_name: v.full_name, phone: v.phone, email: v.email || null, password: v.password,
          role_code: v.role_code || null, org_unit_id: v.role_code ? (v.org_unit_id || null) : null, parishioner_id: person } });
        await told(/^\d+$/.test(r.login) ? '+' + r.login : r.login, v.password);
        P.reload();
      });
      el.querySelectorAll('[data-pw]').forEach(b => b.addEventListener('click', async () => {
        const u = byId[b.dataset.pw];
        const v = await P.modal({ title: `Nenosiri jipya — ${u.full_name || P.loginOf(u)}`, body: `<div class="pm-form">${pwField}
            <p class="pm-span2 pm-muted pm-small">Nenosiri la zamani halitafanya kazi tena. Mpe mtumiaji nenosiri hili jipya wewe mwenyewe.</p></div>`, onOpen: wirePw });
        if (!v) return;
        await P.rpc('admin_set_password', { p_user: u.id, p_password: v.password });
        await told(P.loginOf(u), v.password);
      }));
      el.querySelectorAll('[data-phone]').forEach(b => b.addEventListener('click', async () => {
        const u = byId[b.dataset.phone];
        const v = await P.modal({ title: `Kuingia kwa simu — ${u.full_name || ''}`, body: `<div class="pm-form">
            <label class="pm-span2">Namba ya simu<input name="phone" required inputmode="tel" value="${P.esc(u.phone ? '0' + String(u.phone).slice(3) : '')}" placeholder="mf. 0712 345 678"></label>
            <p class="pm-span2 pm-muted pm-small">Kuanzia sasa mtumiaji huyu ataingia kwa namba hii badala ya ${P.esc(P.loginOf(u))}. Nenosiri lake halibadiliki.</p></div>` });
        if (!v) return;
        const r = await P.rpc('admin_set_login_phone', { p_user: u.id, p_phone: v.phone });
        Toast.success(`Ataingia kwa +${r.phone}.`); P.reload();
      }));
      el.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
        const u = byId[b.dataset.status], on = u.status !== 'active';
        if (!await P.confirm(on ? 'Rudisha akaunti?' : 'Simamisha akaunti?', on ? 'Mtumiaji ataweza kuingia tena.' : 'Mtumiaji hataweza kuingia kwenye mfumo hadi arudishwe. Kumbukumbu zake zinabaki.', on ? 'Rudisha' : 'Simamisha')) return;
        await P.rpc('admin_set_user_status', { p_user: u.id, p_active: on }); P.reload();
      }));
      const grant = async (u) => {
        const v = await P.modal({ title: u ? `Toa nafasi — ${u.full_name || P.loginOf(u)}` : 'Toa nafasi', body: `<div class="pm-form">
            ${u ? '' : '<label class="pm-span2">Namba ya simu au barua pepe ya mtumiaji<input name="login" required></label>'}
            ${roleFields(false)}</div>` });
        if (!v) return;
        const uid = u ? u.id : await P.rpc('find_user', { p_login: v.login });
        if (!uid) { Toast.error('Hakuna akaunti yenye namba/barua pepe hiyo. Iunde kwanza kwa "Mtumiaji mpya".'); return; }
        await P.q(P.from('parish_user_roles').insert({ user_id: uid, parish_id: P.ref.parish.id, role_code: v.role_code, org_unit_id: v.org_unit_id || null }));
        Toast.success('Nafasi imetolewa.'); P.reload();
      };
      el.querySelector('[data-grant]').addEventListener('click', () => grant(null));
      el.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => grant(byId[b.dataset.role])));
      el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
        if (!await P.confirm('Ondoa nafasi', 'Mtumiaji huyu atapoteza ruhusa hii mara moja.')) return;
        await P.q(P.from('parish_user_roles').delete().eq('id', b.dataset.revoke)); P.reload();
      }));
      let person = null;
      P.payerPicker(el.querySelector('[data-link]'), { onPick: p => { person = p.kind === 'parishioner' ? p.id : null; } });
      el.querySelector('[data-link]').addEventListener('submit', async e => {
        e.preventDefault();
        if (!person) { Toast.error('Chagua muumini (si familia) kutoka kwenye orodha.'); return; }
        const uid = await P.rpc('find_user', { p_login: new FormData(e.target).get('login') });
        if (!uid) { Toast.error('Hakuna akaunti yenye namba/barua pepe hiyo.'); return; }
        await P.q(P.from('parishioners').update({ profile_id: uid }).eq('id', person));
        Toast.success('Akaunti imeunganishwa na muumini.'); P.reload();
      });
    },
  };

  /* ================= MIPANGILIO ================= */
  V.settings = {
    title: 'Mipangilio', perm: 'parish.configure',
    async render(el) {
      const r = P.ref;
      const can = P.can('finance.configure');
      // "Kundi" = the report group a contribution type is totalled under (dashboard tiles, reports)
      const KINDS = { zaka: 'Zaka (kwa mwezi)', mavuno: 'Mavuno', ujenzi: 'Ujenzi', sadaka: 'Sadaka', shukrani: 'Shukrani',
        special: 'Michango maalumu', income_other: 'Mapato mengine', expense: 'Matumizi' };
      const fundName = id => r.funds.find(f => f.id === id)?.name || '';
      const POS_LEVEL = { jumuiya: 'Jumuiya', kigango: 'Kigango', parish: 'Parokia', group: 'Chama / Kanda' };
      const positions = await P.q(P.from('leadership_positions').select('*').order('sort_order').order('title_sw'));
      const status = on => on ? '' : ' ' + P.badge('Haitumiki', 'muted');
      const actions = (type, id) => can ? `<span class="pm-nowrap"><button class="pm-btn pm-btn--sm" data-edit-${type}="${id}">Hariri</button>
          <button class="pm-btn pm-btn--sm pm-btn--danger" data-del-${type}="${id}">Futa</button></span>` : '';
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Mipangilio ya Fedha</h1><p class="pm-muted">Aina za michango, mifuko na miaka ya fedha. Taarifa za parokia ziko kwenye "Taarifa za Parokia".</p></div>
        <div class="pm-actions">${can ? `<button class="pm-btn pm-btn--primary" data-newcat><span class="material-symbols-outlined">add</span>Aina ya mchango</button>
          <button class="pm-btn" data-newfund><span class="material-symbols-outlined">add</span>Mfuko</button>
          <button class="pm-btn" data-newfy><span class="material-symbols-outlined">add</span>Mwaka wa fedha</button>` : ''}</div></div>
        <section class="pm-card"><h3 class="pm-h3">Aina za michango na matumizi</h3>
          <p class="pm-muted pm-small">Aina yenye malipo haiwezi kufutwa (historia na ripoti zingeharibika) — izime kwa "Hariri → Haitumiki" ili isionekane kwenye malipo mapya.</p>
          ${P.table(r.cats.filter(c => c.code !== 'TRANSFER'), [{ key: 'name_sw', label: 'Jina', html: c => P.esc(c.name_sw) + status(c.is_active) + `<br><small class="pm-muted">${P.esc(c.code)}</small>` },
          { key: 'kind', label: 'Kundi', fmt: v => P.esc(KINDS[v] || v) }, { key: 'is_pledgeable', label: 'Ahadi', fmt: v => v ? 'Ndiyo' : '' }, { key: 'uses_period_month', label: 'Kwa mwezi', fmt: v => v ? 'Ndiyo' : '' },
          { key: 'fund_id', label: 'Mfuko', fmt: v => P.esc(fundName(v)) },
          { key: 'legacy_labels', label: 'Majina ya Excel', fmt: v => `<small class="pm-muted">${P.esc((v || []).slice(0, 3).join(' · '))}${(v || []).length > 3 ? ' …' : ''}</small>` },
          { key: 'id', label: '', html: c => actions('cat', c.id) }])}</section>
        <section class="pm-grid2"><div class="pm-card"><h3 class="pm-h3">Mifuko</h3>
          <p class="pm-muted pm-small">Mfuko ni "mfuko wa fedha" ambao aina ya mchango huingiza fedha zake (mf. Mfuko wa Ujenzi). Mfuko "maalumu" hutumika kwa kazi yake tu.</p>
          ${P.table(r.funds, [{ key: 'name', label: 'Jina', html: f => P.esc(f.name) + status(f.is_active !== false) + `<br><small class="pm-muted">${P.esc(f.code)}</small>` },
            { key: 'is_restricted', label: 'Maalumu', fmt: v => v ? 'Ndiyo' : '' }, { key: 'id', label: '', html: f => actions('fund', f.id) }])}</div>
        <div class="pm-card"><h3 class="pm-h3">Miaka ya fedha</h3>${P.table(r.years, [{ key: 'label', label: 'Mwaka' }, { key: 'starts_on', label: 'Kuanzia', fmt: P.date }, { key: 'ends_on', label: 'Hadi', fmt: P.date }, { key: 'status', label: 'Hali' }])}</div></section>
        <section class="pm-card"><div class="pm-row"><h3 class="pm-h3">Vyeo vya uongozi</h3>
            <button class="pm-btn pm-btn--sm" data-newpos><span class="material-symbols-outlined">add</span>Cheo kipya</button></div>
          <p class="pm-muted pm-small">Majina ya vyeo yanayochaguliwa kwenye rejista (mf. Katibu, Mwenyekiti, Mhazini wa jumuiya). Mtu mmoja anaweza kupewa vyeo zaidi ya kimoja. Cheo ambacho kimewahi kutumika hakifutwi — kinazimwa.</p>
          ${P.table(positions, [{ key: 'title_sw', label: 'Cheo', html: x => P.esc(x.title_sw) + status(x.is_active !== false) },
            { key: 'level', label: 'Ngazi', fmt: v => POS_LEVEL[v] || v }, { key: 'sort_order', label: 'Mpangilio', cls: 'pm-num' },
            { key: 'id', label: '', html: x => `<span class="pm-nowrap"><button class="pm-btn pm-btn--sm" data-edit-pos="${x.id}">Hariri</button>
              <button class="pm-btn pm-btn--sm pm-btn--danger" data-del-pos="${x.id}">Futa</button></span>` }], { empty: 'Hakuna vyeo bado.' })}</section>
        <section class="pm-card"><h3 class="pm-h3">Akaunti (chart of accounts)</h3>${P.table(r.accounts, [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Jina' }, { key: 'account_type', label: 'Aina' }, { key: 'money_kind', label: 'Fedha' }])}</section>`;

      // titles (vyeo): kept by the administrator, chosen in the register
      const posForm = x => `<div class="pm-form">
          <label class="pm-span2">Jina la cheo<input name="title_sw" required value="${P.esc(x?.title_sw || '')}" placeholder="mf. Mhazini wa Jumuiya"></label>
          <label>Ngazi<select name="level" ${x ? 'disabled' : ''}>${Object.entries(POS_LEVEL).map(([k, l]) => `<option value="${k}" ${(x?.level || 'jumuiya') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Mpangilio (namba ndogo kwanza)<input name="sort_order" type="number" value="${x?.sort_order ?? 300}"></label>
          ${x ? `<label>Hali<select name="is_active"><option value="true">Kinatumika</option><option value="false" ${x.is_active === false ? 'selected' : ''}>Hakitumiki</option></select></label>` : ''}</div>`;
      el.querySelector('[data-newpos]').addEventListener('click', async () => {
        const v = await P.modal({ title: 'Cheo kipya', body: posForm(null) });
        if (!v) return;
        const code = (v.title_sw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'CHEO') + '_' + P.uuid().slice(0, 4).toUpperCase();
        await P.q(P.from('leadership_positions').insert({ code, title_sw: v.title_sw.trim(), level: v.level, sort_order: Number(v.sort_order) || 300 }));
        Toast.success('Cheo kimeongezwa.'); P.reload();
      });
      el.querySelectorAll('[data-edit-pos]').forEach(b => b.addEventListener('click', async () => {
        const x = positions.find(y => y.id === b.dataset.editPos);
        const v = await P.modal({ title: `Hariri — ${x.title_sw}`, body: posForm(x) });
        if (!v) return;
        await P.q(P.from('leadership_positions').update({ title_sw: v.title_sw.trim(), sort_order: Number(v.sort_order) || 300, is_active: v.is_active === 'true' }).eq('id', x.id));
        Toast.success('Mabadiliko yamehifadhiwa.'); P.reload();
      }));
      el.querySelectorAll('[data-del-pos]').forEach(b => b.addEventListener('click', async () => {
        const x = positions.find(y => y.id === b.dataset.delPos);
        if (!await P.confirm(`Futa cheo "${x.title_sw}"?`, 'Kama kimewahi kutolewa kwa mtu, hakitafutwa bali kitazimwa (historia ya viongozi inabaki).', 'Futa')) return;
        const res = await P.rpc('delete_leadership_position', { p_id: x.id });
        Toast.success(res.status === 'deleted' ? 'Cheo kimefutwa.' : 'Cheo kimezimwa (kimewahi kutumika).'); P.reload();
      }));
      if (!can) return;

      const codeFrom = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
      const fundSelect = (selected, withNew) => `<select name="fund_id">${r.funds.filter(f => f.is_active !== false || f.id === selected)
        .map(f => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${P.esc(f.name)}</option>`).join('')}
        ${withNew ? '<option value="__new">+ Mfuko mpya…</option>' : ''}</select>`;
      const newFundFields = `<label class="pm-span2" data-newfund-fields hidden>Jina la mfuko mpya<input name="new_fund_name" placeholder="mf. Mfuko wa Elimu"></label>`;
      const wireNewFund = m => {
        const sel = m.querySelector('[name=fund_id]'), box = m.querySelector('[data-newfund-fields]');
        const sync = () => { box.hidden = sel.value !== '__new'; box.querySelector('input').required = sel.value === '__new'; };
        sel.addEventListener('change', sync); sync();
      };
      const ensureFund = async v => {
        if (v.fund_id !== '__new') return v.fund_id || null;
        const name = v.new_fund_name.trim();
        const f = await P.q(P.from('funds').insert({ parish_id: r.parish.id, name, code: codeFrom(name) || 'MFUKO' }).select().single());
        return f.id;
      };
      const catForm = c => `<div class="pm-form">
          <label>Jina<input name="name_sw" required value="${P.esc(c?.name_sw || '')}" placeholder="mf. Mchango wa Kwaya"></label>
          <label>Code <small class="pm-muted">(acha wazi: itatengenezwa)</small><input name="code" pattern="[A-Z0-9_]*" value="${P.esc(c?.code || '')}" ${c ? 'readonly' : ''}></label>
          <label>Kundi la ripoti<select name="kind" ${c ? 'disabled' : ''}>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${(c?.kind || 'special') === k ? 'selected' : ''}>${P.esc(l)}</option>`).join('')}</select></label>
          <label>Mfuko${fundSelect(c?.fund_id || r.funds.find(f => f.code === 'GENERAL')?.id, true)}</label>
          ${newFundFields}
          <label>Ina ahadi/malengo (kampeni)<select name="is_pledgeable"><option value="false">Hapana</option><option value="true" ${c?.is_pledgeable ? 'selected' : ''}>Ndiyo</option></select></label>
          <label>Inalipwa kwa mwezi (kama Zaka)<select name="uses_period_month"><option value="false">Hapana</option><option value="true" ${c?.uses_period_month ? 'selected' : ''}>Ndiyo</option></select></label>
          ${c ? `<label>Hali<select name="is_active"><option value="true">Inatumika</option><option value="false" ${c.is_active ? '' : 'selected'}>Haitumiki</option></select></label>` : ''}
          ${c ? '<p class="pm-muted pm-small pm-span2">Kundi la ripoti haliwezi kubadilishwa baada ya kuundwa, kwa sababu ripoti za zamani zimejengwa juu yake.</p>' : ''}</div>`;
      const done = async msg => { Toast.success(msg); await P.loadRef(true); P.reload(); };

      el.querySelector('[data-newcat]').addEventListener('click', async () => {
        const v = await P.modal({ title: 'Aina mpya ya mchango', body: catForm(null), onOpen: wireNewFund });
        if (!v) return;
        const fund_id = await ensureFund(v);
        await P.q(P.from('contribution_categories').insert({ parish_id: r.parish.id, code: v.code || codeFrom(v.name_sw), name_sw: v.name_sw.trim(),
          kind: v.kind, fund_id, is_pledgeable: v.is_pledgeable === 'true', uses_period_month: v.uses_period_month === 'true' }));
        await done('Aina ya mchango imeongezwa.');
      });
      el.querySelectorAll('[data-edit-cat]').forEach(b => b.addEventListener('click', async () => {
        const c = r.catsById[b.dataset.editCat];
        const v = await P.modal({ title: `Hariri — ${c.name_sw}`, body: catForm(c), onOpen: wireNewFund });
        if (!v) return;
        const fund_id = await ensureFund(v);
        await P.q(P.from('contribution_categories').update({ name_sw: v.name_sw.trim(), fund_id, is_pledgeable: v.is_pledgeable === 'true',
          uses_period_month: v.uses_period_month === 'true', is_active: v.is_active === 'true' }).eq('id', c.id));
        await done('Mabadiliko yamehifadhiwa.');
      }));
      el.querySelectorAll('[data-del-cat]').forEach(b => b.addEventListener('click', async () => {
        const c = r.catsById[b.dataset.delCat];
        if (!await P.confirm(`Futa "${c.name_sw}"?`, 'Inafutwa tu kama haijawahi kutumika. Kama ina malipo, mfumo utakataa — izime badala yake.', 'Futa')) return;
        await P.rpc('delete_contribution_category', { p_id: c.id });
        await done('Aina ya mchango imefutwa.');
      }));

      const fundForm = f => `<div class="pm-form">
          <label class="pm-span2">Jina<input name="name" required value="${P.esc(f?.name || '')}" placeholder="mf. Mfuko wa Elimu"></label>
          <label>Ni mfuko maalumu (fedha zake kwa kazi yake tu)<select name="is_restricted"><option value="false">Hapana</option><option value="true" ${f?.is_restricted ? 'selected' : ''}>Ndiyo</option></select></label>
          ${f ? `<label>Hali<select name="is_active"><option value="true">Unatumika</option><option value="false" ${f.is_active === false ? 'selected' : ''}>Hautumiki</option></select></label>` : ''}</div>`;
      el.querySelector('[data-newfund]').addEventListener('click', async () => {
        const v = await P.modal({ title: 'Mfuko mpya', body: fundForm(null) });
        if (!v) return;
        await P.q(P.from('funds').insert({ parish_id: r.parish.id, name: v.name.trim(), code: codeFrom(v.name) || 'MFUKO', is_restricted: v.is_restricted === 'true' }));
        await done('Mfuko umeongezwa.');
      });
      el.querySelectorAll('[data-edit-fund]').forEach(b => b.addEventListener('click', async () => {
        const f = r.funds.find(x => x.id === b.dataset.editFund);
        const v = await P.modal({ title: `Hariri — ${f.name}`, body: fundForm(f) });
        if (!v) return;
        await P.q(P.from('funds').update({ name: v.name.trim(), is_restricted: v.is_restricted === 'true', is_active: v.is_active === 'true' }).eq('id', f.id));
        await done('Mabadiliko yamehifadhiwa.');
      }));
      el.querySelectorAll('[data-del-fund]').forEach(b => b.addEventListener('click', async () => {
        const f = r.funds.find(x => x.id === b.dataset.delFund);
        if (!await P.confirm(`Futa "${f.name}"?`, 'Unafutwa tu kama hakuna aina ya mchango wala malipo yanayoutumia.', 'Futa')) return;
        await P.rpc('delete_fund', { p_id: f.id });
        await done('Mfuko umefutwa.');
      }));

      el.querySelector('[data-newfy]').addEventListener('click', async () => {
        const v = await P.modal({ title: 'Mwaka mpya wa fedha', body: `<div class="pm-form"><label>Jina<input name="label" required value="${P.year() + 1}"></label>
          <label>Kuanzia<input type="date" name="starts_on" required value="${P.year() + 1}-01-01"></label><label>Hadi<input type="date" name="ends_on" required value="${P.year() + 1}-12-31"></label></div>` });
        if (!v) return;
        await P.q(P.from('financial_years').insert({ ...v, parish_id: r.parish.id }));
        await done('Mwaka wa fedha umeongezwa.');
      });
    },
  };
})();
