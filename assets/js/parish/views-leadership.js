/* Elected leadership directory and roster management. */
(function () {
  const P = window.Parish, V = P.views;
  const ROLES = {
    parish: [['MWENYEKITI_PAROKIA', 'Mwenyekiti'], ['MWENYEKITI_MSAIDIZI_PAROKIA', 'Mwenyekiti msaidizi'], ['KATIBU_PAROKIA', 'Katibu'], ['KATIBU_MSAIDIZI_PAROKIA', 'Katibu msaidizi'], ['MWASIBU_PAROKIA', 'Mwasibu']],
    kigango: [['MWENYEKITI_KIGANGO', 'Mwenyekiti'], ['MWENYEKITI_MSAIDIZI_KIGANGO', 'Mwenyekiti msaidizi'], ['KATIBU_KIGANGO', 'Katibu'], ['KATIBU_MSAIDIZI_KIGANGO', 'Katibu msaidizi'], ['MWASIBU_KIGANGO', 'Mwasibu']],
    jumuiya: [['MWENYEKITI_JUMUIYA', 'Mwenyekiti'], ['MWENYEKITI_MSAIDIZI_JUMUIYA', 'Mwenyekiti msaidizi'], ['KATIBU_JUMUIYA', 'Katibu'], ['KATIBU_MSAIDIZI_JUMUIYA', 'Katibu msaidizi'], ['MWASIBU_JUMUIYA', 'Mwasibu']],
  };
  const esc = P.esc;
  const levelName = unit => unit?.unit_type === 'parish' ? 'Parokia' : unit?.unit_type === 'kigango' ? `Kigango cha ${unit.name}` : `Jumuiya ya ${unit?.name || ''}`;

  V.leaders = {
    title: 'Viongozi', perm: 'registry.read',
    async render(el) {
      const canWrite = P.access.platform_admin || P.access.permissions.includes('registry.write');
      const [positions, rows] = await Promise.all([
        P.q(P.from('leadership_positions').select('*').eq('is_active', true).order('sort_order')),
        P.q(P.from('leadership_assignments').select('*, leadership_positions(title_sw,level,sort_order,code)').eq('status', 'active').order('starts_on', { ascending: false })),
      ]);
      const activeUnits = P.ref.units.filter(u => u.is_active && ['parish', 'kigango', 'jumuiya'].includes(u.unit_type));
      const parish = activeUnits.find(u => u.unit_type === 'parish');
      const scopedId = P.scopeUnit(), scopedUnit = scopedId && P.ref.unitsById[scopedId];
      const visibleKigangos = activeUnits.filter(u => u.unit_type === 'kigango' &&
        (!scopedUnit || scopedUnit.unit_type === 'parish' || scopedUnit.unit_type === 'kigango' && u.id === scopedUnit.id));
      const visibleJumuiya = activeUnits.filter(u => u.unit_type === 'jumuiya' &&
        (!scopedUnit || scopedUnit.unit_type === 'parish' || scopedUnit.unit_type === 'kigango' && u.parent_id === scopedUnit.id || scopedUnit.unit_type === 'jumuiya' && u.id === scopedUnit.id));
      const canAssignParish = !scopedUnit || scopedUnit.unit_type === 'parish';
      const permittedTargets = new Set([
        ...(canAssignParish && parish ? [parish.id] : []),
        ...visibleKigangos.map(u => u.id),
        ...visibleJumuiya.map(u => u.id),
      ]);
      const activeRows = rows.filter(r => permittedTargets.has(r.org_unit_id));
      const byUnit = id => activeRows.filter(r => r.org_unit_id === id)
        .sort((a, b) => (a.leadership_positions?.sort_order || 0) - (b.leadership_positions?.sort_order || 0));
      const isRosterComplete = unitId => byUnit(unitId).length === 5;
      const roster = (unit, entries) => {
        if (!entries.length) return '';
        const person = r => `<article class="pm-leadership-person"><strong>${esc(r.holder_name || 'Jina halijawekwa')}</strong><span>${esc(r.leadership_positions?.title_sw || 'Kiongozi')}</span><small>${esc(levelName(unit))}</small></article>`;
        return `<div class="pm-leadership-roster">${entries.map(person).join('')}</div>`;
      };
      const chairOf = (unit, entries) => entries.find(r => r.leadership_positions?.code === ({ parish: 'MWENYEKITI_PAROKIA', kigango: 'MWENYEKITI_KIGANGO', jumuiya: 'MWENYEKITI_JUMUIYA' })[unit.unit_type]);
      const unitSummary = (unit, entries) => {
        const chair = chairOf(unit, entries);
        return `<span>${esc(unit.unit_type === 'kigango' ? `Kigango cha ${unit.name}` : `Jumuiya ya ${unit.name}`)}</span>${chair ? `<small>${esc(chair.holder_name || 'Mwenyekiti')}</small>` : ''}`;
      };
      const otherLeaders = (unit, entries) => roster(unit, entries.filter(r => r !== chairOf(unit, entries)));

      const unitOptions = [
        canAssignParish && parish ? `<option value="${parish.id}">Parokia nzima</option>` : '',
        scopedUnit?.unit_type === 'jumuiya' ? `<optgroup label="Kigango cha ${esc(P.ref.unitsById[scopedUnit.parent_id]?.name || '')}"><option value="${scopedUnit.id}">Jumuiya ya ${esc(scopedUnit.name)}${isRosterComplete(scopedUnit.id) ? ' ✓' : ''}</option></optgroup>` : '',
        ...visibleKigangos.map(k => {
          const children = visibleJumuiya.filter(j => j.parent_id === k.id);
          return `<optgroup label="Kigango cha ${esc(k.name)}"><option value="${k.id}">Kigango chenyewe${isRosterComplete(k.id) ? ' ✓' : ''}</option>${children.map(j => `<option value="${j.id}">Jumuiya ya ${esc(j.name)}${isRosterComplete(j.id) ? ' ✓' : ''}</option>`).join('')}</optgroup>`;
        }),
      ].join('');
      const populatedKigangos = visibleKigangos.filter(k => byUnit(k.id).length || visibleJumuiya.some(j => j.parent_id === k.id && byUnit(j.id).length));
      const populatedJumuiya = k => visibleJumuiya.filter(j => j.parent_id === k.id && byUnit(j.id).length);
      const directory = scopedUnit?.unit_type === 'jumuiya'
        ? (byUnit(scopedUnit.id).length ? `<details class="pm-leadership-unit" open><summary>${unitSummary(scopedUnit, byUnit(scopedUnit.id))}</summary>${otherLeaders(scopedUnit, byUnit(scopedUnit.id))}</details>` : '')
        : `${canAssignParish && parish && byUnit(parish.id).length ? `<details class="pm-leadership-unit"><summary><span>Parokia</span>${chairOf(parish, byUnit(parish.id)) ? `<small>${esc(chairOf(parish, byUnit(parish.id)).holder_name)}</small>` : ''}</summary>${otherLeaders(parish, byUnit(parish.id))}</details>` : ''}${populatedKigangos.map(k => {
          const leaders = byUnit(k.id), children = populatedJumuiya(k);
          return `<details class="pm-leadership-unit"><summary>${unitSummary(k, leaders)}</summary>${otherLeaders(k, leaders)}${children.length ? `<div class="pm-leadership-children">${children.map(j => `<details class="pm-leadership-unit pm-leadership-unit--child"><summary>${unitSummary(j, byUnit(j.id))}</summary>${otherLeaders(j, byUnit(j.id))}</details>`).join('')}</div>` : ''}</details>`;
        }).join('')}`;
      el.innerHTML = `<div class="pm-head pm-leadership-head"><div><h1 class="pm-h1">Viongozi</h1><p class="pm-muted">Parokia, Vigango na Jumuiya</p></div></div>
        ${canWrite ? `<section class="pm-card pm-leadership-card"><h2 class="pm-h3">Weka viongozi</h2>
          <label class="pm-leadership-target-label">Eneo la uongozi<select data-target-select><option value="">Chagua eneo</option>${unitOptions}</select></label>
          <div class="pm-leadership-editor" data-editor hidden></div>
        </section>` : ''}
        <section class="pm-card pm-leadership-card"><h2 class="pm-h3">Viongozi waliowekwa</h2><div class="pm-leadership-directory">${directory || '<p class="pm-leadership-empty">Hakuna viongozi waliochaguliwa bado.</p>'}</div></section>`;

      if (!canWrite) return;
      const editor = el.querySelector('[data-editor]');
      const peopleFor = async unit => {
        const people = await P.q(P.from('parishioners').select('id,full_name,family_id,jumuiya_id').eq('parish_id', P.ref.parish.id).eq('membership_status', 'active').order('full_name').limit(5000));
        const familyIds = [...new Set(people.filter(p => !p.jumuiya_id && p.family_id).map(p => p.family_id))];
        const families = familyIds.length ? await P.q(P.from('families').select('id,jumuiya_id').in('id', familyIds)) : [];
        const familyJumuiya = Object.fromEntries(families.map(f => [f.id, f.jumuiya_id]));
        if (unit.unit_type === 'parish') return people;
        const memberUnits = unit.unit_type === 'kigango'
          ? activeUnits.filter(x => x.unit_type === 'jumuiya' && x.parent_id === unit.id).map(x => x.id)
          : [unit.id];
        return people.filter(p => memberUnits.includes(p.jumuiya_id || familyJumuiya[p.family_id]));
      };
      const chooseUnit = async unitId => {
        const unit = activeUnits.find(u => u.id === unitId);
        if (!unitId) { editor.hidden = true; editor.innerHTML = ''; return; }
        if (!unit || !permittedTargets.has(unit.id)) return;
        editor.hidden = false;
        editor.innerHTML = `<div class="pm-leadership-editor__head"><h3>${esc(levelName(unit))}</h3></div><p class="pm-leadership-hint">Jaza nafasi unazotaka; zilizoachwa hubaki kama zilivyo.</p><div data-role-fields>${P.loading()}</div><button type="button" class="pm-btn pm-btn--primary" data-save disabled>Hifadhi viongozi</button>`;
        editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const fields = editor.querySelector('[data-role-fields]'), save = editor.querySelector('[data-save]');
        try {
          const [people, roleCodes] = await Promise.all([peopleFor(unit), Promise.resolve(ROLES[unit.unit_type])]);
          if (!people.length) { fields.innerHTML = '<p class="pm-leadership-empty">Hakuna muumini hai aliyepatikana hapa.</p>'; return; }
          const pos = positions.filter(p => roleCodes.some(x => x[0] === p.code));
          fields.innerHTML = `<div class="pm-form">${roleCodes.map(([code, label]) => {
            const position = pos.find(p => p.code === code);
            const currentPerson = byUnit(unit.id).find(r => r.position_id === position?.id)?.parishioner_id;
            const opts = `<option value="">Chagua muumini</option>${people.map(person => `<option value="${person.id}" ${person.id === currentPerson ? 'selected' : ''}>${esc(person.full_name)}</option>`).join('')}`;
            return `<label>${esc(label)}<select data-position="${position?.id || ''}">${opts}</select></label>`;
          }).join('')}</div>`;
          save.disabled = pos.length !== 5;
          save.addEventListener('click', async () => {
            const selects = [...fields.querySelectorAll('select[data-position]')];
            const assignments = selects.filter(s => s.value).map(s => ({ position_id: s.dataset.position, parishioner_id: s.value }));
            if (!assignments.length || assignments.some(a => !a.position_id) || new Set(assignments.map(a => a.position_id)).size !== assignments.length) {
              Toast.error('Chagua angalau kiongozi mmoja.'); return;
            }
            save.disabled = true;
            try { await P.rpc('save_unit_leadership', { p_unit: unit.id, p_assignments: assignments }); Toast.success('Viongozi wamehifadhiwa.'); P.reload(); }
            catch (err) { Toast.error(err.message); save.disabled = false; }
          });
        } catch (err) { fields.innerHTML = `<p class="pm-leadership-empty">${esc(err.message || 'Imeshindikana kupakia waumini.')}</p>`; }
      };
      el.querySelector('[data-target-select]').addEventListener('change', e => chooseUnit(e.target.value));
    },
  };

})();
