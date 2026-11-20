/* Five elected offices for each parish, kigango and jumuiya. */
(function () {
  const P = window.Parish, V = P.views;
  const ROLES = {
    parish: [['MWENYEKITI_PAROKIA', 'Mwenyekiti'], ['MWENYEKITI_MSAIDIZI_PAROKIA', 'Mwenyekiti msaidizi'], ['KATIBU_PAROKIA', 'Katibu'], ['KATIBU_MSAIDIZI_PAROKIA', 'Katibu msaidizi'], ['MWASIBU_PAROKIA', 'Mwasibu']],
    kigango: [['MWENYEKITI_KIGANGO', 'Mwenyekiti'], ['MWENYEKITI_MSAIDIZI_KIGANGO', 'Mwenyekiti msaidizi'], ['KATIBU_KIGANGO', 'Katibu'], ['KATIBU_MSAIDIZI_KIGANGO', 'Katibu msaidizi'], ['MWASIBU_KIGANGO', 'Mwasibu']],
    jumuiya: [['MWENYEKITI_JUMUIYA', 'Mwenyekiti'], ['MWENYEKITI_MSAIDIZI_JUMUIYA', 'Mwenyekiti msaidizi'], ['KATIBU_JUMUIYA', 'Katibu'], ['KATIBU_MSAIDIZI_JUMUIYA', 'Katibu msaidizi'], ['MWASIBU_JUMUIYA', 'Mwasibu']],
  };
  const esc = P.esc;
  V.leaders = {
    title: 'Viongozi', perm: 'registry.read',
    async render(el) {
      const canWrite = P.access.platform_admin || P.access.permissions.includes('registry.write');
      const [positions, rows] = await Promise.all([
        P.q(P.from('leadership_positions').select('*').eq('is_active', true).order('sort_order')),
        P.q(P.from('leadership_assignments').select('*, leadership_positions(title_sw,level,sort_order,code)').order('status').order('starts_on', { ascending: false })),
      ]);
      const allUnits = P.ref.units.filter(u => u.is_active && ['parish', 'kigango', 'jumuiya'].includes(u.unit_type));
      const scopedId = P.scopeUnit(), scopedUnit = scopedId && P.ref.unitsById[scopedId];
      const units = scopedUnit ? allUnits.filter(u => u.id === scopedUnit.id || (scopedUnit.unit_type === 'kigango' && u.parent_id === scopedUnit.id))
        : allUnits;
      const activeRows = rows.filter(r => r.status === 'active');
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Viongozi</h1><p class="pm-muted">Weka viongozi watano wa kila ngazi. Nafasi hizi za kuchaguliwa ni tofauti na ruhusa za kutumia mfumo.</p></div>
        ${canWrite ? '<div class="pm-actions"><button class="pm-btn pm-btn--primary" data-assign><span class="material-symbols-outlined">groups</span>Weka viongozi watano</button></div>' : ''}</div>
        ${canWrite ? `<section class="pm-card"><h2 class="pm-h3">Ugawaji wa nafasi</h2><p class="pm-muted">Chagua kitengo kisha gawa mwenyekiti, mwenyekiti msaidizi, katibu, katibu msaidizi na mwasibu kwa waumini wake.</p>
          <form class="pm-filters" data-form><label class="pm-wide">Parokia, kigango au jumuiya<select name="unit" required><option value="">Chagua kitengo…</option>${units.map(u => `<option value="${u.id}">${esc(({parish:'Parokia',kigango:'Kigango',jumuiya:'Jumuiya'})[u.unit_type]+' · '+u.label)}</option>`).join('')}</select></label>
          <div class="pm-wide" style="flex:1 0 100%" data-roles><p class="pm-muted">Chagua kitengo ili kujaza nafasi tano.</p></div><button class="pm-btn pm-btn--primary" data-save disabled>Hifadhi viongozi</button></form></section>` : ''}
        <section class="pm-card"><h2 class="pm-h3">Orodha ya viongozi</h2>${P.table(activeRows, [{key:'title',label:'Nafasi',html:r=>esc(r.leadership_positions?.title_sw)},
          {key:'org',label:'Kitengo',html:r=>esc(P.ref.unitsById[r.org_unit_id]?.label||'')},{key:'holder_name',label:'Jina'},{key:'phone',label:'Simu'},
          {key:'starts_on',label:'Kuanzia',fmt:P.date},{key:'ends_on',label:'Hadi',fmt:P.date},{key:'status',label:'Hali',html:r=>P.badge(r.status==='active'?'Hai':'Ameondoka',r.status==='active'?'teal':'muted')}],{empty:'Hakuna viongozi hawa waliohifadhiwa.'})}</section>
        `;
      if (!canWrite) return;
      const form = el.querySelector('[data-form]'), roleBox = form.querySelector('[data-roles]'), save = form.querySelector('[data-save]');
      const peopleFor = async unit => {
        const people = await P.q(P.from('parishioners').select('id,full_name,family_id,jumuiya_id').eq('parish_id', P.ref.parish.id).eq('membership_status','active').order('full_name').limit(5000));
        const missingJumuiya = people.filter(p=>!p.jumuiya_id&&p.family_id).map(p=>p.family_id);
        const familyIds = [...new Set(missingJumuiya)];
        const families = familyIds.length ? await P.q(P.from('families').select('id,jumuiya_id').in('id',familyIds)) : [];
        const familyJumuiya = Object.fromEntries(families.map(f=>[f.id,f.jumuiya_id]));
        const validUnits = unit.unit_type==='kigango' ? P.ref.units.filter(x=>x.unit_type==='jumuiya'&&x.parent_id===unit.id).map(x=>x.id) : [unit.id];
        return unit.unit_type==='parish' ? people : people.filter(p=>validUnits.includes(p.jumuiya_id||familyJumuiya[p.family_id]));
      };
      form.querySelector('[name=unit]').addEventListener('change', async e => {
        save.disabled = true; roleBox.innerHTML = P.loading();
        const unit = P.ref.unitsById[e.target.value];
        if (!unit || !ROLES[unit.unit_type]) { roleBox.innerHTML = '<p class="pm-muted">Chagua kitengo sahihi.</p>'; return; }
        const people = await peopleFor(unit);
        if (!people.length) { roleBox.innerHTML = '<p class="pm-muted">Hakuna muumini hai aliyepatikana kwenye kitengo hiki.</p>'; return; }
        const codes = ROLES[unit.unit_type], pos = positions.filter(p => codes.some(x=>x[0]===p.code));
        const opts = `<option value="">Chagua muumini…</option>${people.map(p=>`<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}`;
        roleBox.innerHTML = `<div class="pm-form">${codes.map(([code,label])=>{const p=pos.find(x=>x.code===code);return `<label>${esc(label)}<select required data-position="${p?.id||''}">${opts}</select></label>`;}).join('')}</div>`;
        save.disabled = pos.length !== 5;
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const selects = [...roleBox.querySelectorAll('select[data-position]')];
        const assignments = selects.map(s=>({position_id:s.dataset.position,parishioner_id:s.value}));
        if (assignments.length!==5 || assignments.some(a=>!a.position_id||!a.parishioner_id) || new Set(assignments.map(a=>a.position_id)).size!==5 || new Set(assignments.map(a=>a.parishioner_id)).size!==5) {
          Toast.error('Chagua waumini watano tofauti na uhakikishe nafasi zote zimejazwa.'); return;
        }
        save.disabled = true;
        try { await P.rpc('save_unit_leadership',{p_unit:form.elements.unit.value,p_assignments:assignments}); Toast.success('Viongozi watano wamehifadhiwa.'); P.reload(); }
        catch(err) { Toast.error(err.message); save.disabled = false; }
      });
    },
  };
})();
