/* ============================================
   Minga Parish — shared helpers for the parish
   management screens (parish/index.html).

   Every figure shown comes from Supabase (RLS +
   the posting/report functions in
   database/migrations). Nothing is calculated
   from hard-coded values here — the browser only
   formats what PostgreSQL returns.
   ============================================ */
(function () {
  const P = window.Parish = window.Parish || {};

  /* ── formatting ── */
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  P.tzs = v => (v === null || v === undefined || v === '') ? '—' : 'TZS ' + nf.format(Number(v));
  P.num = v => (v === null || v === undefined || v === '') ? '—' : nf.format(Number(v));
  P.pct = v => (v === null || v === undefined) ? '—' : `${Number(v).toFixed(Number(v) % 1 ? 1 : 0)}%`;
  P.date = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  P.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  P.today = () => new Date().toISOString().slice(0, 10);
  /* the working year: chosen once in the top bar, used by every page (remembered per browser) */
  P.thisYear = () => new Date().getFullYear();
  P.year = () => {
    if (P._year) return P._year;
    try { const y = Number(localStorage.getItem('pm-year')); if (y > 2000 && y < 2100) return (P._year = y); } catch (e) { /* storage blocked */ }
    return (P._year = P.thisYear());
  };
  P.setYear = y => { P._year = Number(y); try { localStorage.setItem('pm-year', String(y)); } catch (e) { /* ignore */ }
    document.querySelectorAll('[data-yearpick]').forEach(s => { s.value = String(y); }); };
  P.yearFrom = () => `${P.year()}-01-01`;
  P.yearTo = () => P.year() === P.thisYear() ? P.today() : `${P.year()}-12-31`;
  P.uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
  P.MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
  P.METHODS = { cash: 'Taslimu', cheque: 'Hundi', bank_transfer: 'Benki', mobile_money: 'Pesa kwa simu', envelope: 'Bahasha', other: 'Nyingine' };

  /* ── data access ── */
  P.friendlyError = e => {
    const m = (e && (e.message || e.details || e.hint)) || String(e);
    if (/permission denied|42501|row-level security/i.test(m) && !/Huna/.test(m)) return 'Huna ruhusa ya kufanya kitendo hiki.';
    if (/duplicate key.*ft_unique_external_ref/i.test(m)) return 'Namba hii ya kumbukumbu ya malipo imeshatumika — malipo haya yamesharekodiwa.';
    // the page is newer than the database: a patch has not been run yet
    if (/Could not find the function|schema cache|PGRST202/i.test(m)) return 'Database bado haijasasishwa kwa toleo hili la mfumo. Msimamizi aendeshe patch ya karibuni (database/patches) kwenye Supabase → SQL Editor, kisha jaribu tena.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Hakuna mtandao. Jaribu tena — malipo hayatarudiwa mara mbili.';
    return m.replace(/^.*?ERROR:\s*/, '');
  };
  P.rpc = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args || {});
    if (error) throw new Error(P.friendlyError(error));
    return data;
  };
  P.from = table => supabase.from(table);
  P.q = async promise => {
    const { data, error, count } = await promise;
    if (error) throw new Error(P.friendlyError(error));
    return count !== undefined && count !== null ? { data, count } : data;
  };

  /* reference data cached for the session (structure, categories, campaigns, years, accounts) */
  P.ref = null;
  P.loadRef = async (force) => {
    if (P.ref && !force) return P.ref;
    const [parish, units, cats, camps, years, accounts, funds] = await Promise.all([
      P.q(P.from('parishes').select('*').order('created_at').limit(1)),
      P.q(P.from('org_units').select('id,parent_id,unit_type,name,zone,ordinal,is_active').order('ordinal', { nullsFirst: true }).order('name')),
      P.q(P.from('contribution_categories').select('*').order('sort_order')),
      P.q(P.from('campaigns').select('*').order('campaign_year', { ascending: false }).order('name')),
      P.q(P.from('financial_years').select('*').order('starts_on', { ascending: false })),
      P.q(P.from('ledger_accounts').select('*').order('code')),
      P.q(P.from('funds').select('*').order('code')),
    ]);
    const byId = Object.fromEntries(units.map(u => [u.id, u]));
    units.forEach(u => {
      const k = u.unit_type === 'jumuiya' ? byId[u.parent_id] : null;
      u.label = k ? `${u.name} · ${k.name}` : u.name;
    });
    P.ref = { parish: parish[0] || {}, units, unitsById: byId, cats, catsById: Object.fromEntries(cats.map(c => [c.id, c])),
              camps, years, accounts, funds };
    return P.ref;
  };
  P.unitsOf = type => P.ref.units.filter(u => u.unit_type === type && u.is_active);

  /* ── tiny DOM helpers ── */
  P.h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  P.$ = (sel, root = document) => root.querySelector(sel);
  P.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  P.options = (items, { value = 'id', label = 'name', blank = null, selected = null } = {}) =>
    (blank !== null ? `<option value="">${P.esc(blank)}</option>` : '') +
    items.map(i => `<option value="${P.esc(i[value])}" ${String(i[value]) === String(selected) ? 'selected' : ''}>${P.esc(typeof label === 'function' ? label(i) : i[label])}</option>`).join('');
  P.unitOptions = (types = ['kigango', 'jumuiya', 'group'], opts = {}) => {
    const groups = types.map(t => {
      const lbl = { kigango: 'Vigango', jumuiya: 'Jumuiya', group: 'Vyama na Kanda' }[t] || t;
      return `<optgroup label="${lbl}">${P.options(P.unitsOf(t), { label: 'label', selected: opts.selected })}</optgroup>`;
    }).join('');
    return (opts.blank !== undefined ? `<option value="">${P.esc(opts.blank)}</option>` : '') + groups;
  };
  P.catOptions = (kinds, opts = {}) => P.options(P.ref.cats.filter(c => c.is_active && (!kinds || kinds.includes(c.kind)) && c.code !== 'TRANSFER'),
    { label: 'name_sw', ...opts });
  /* a new contribution type can be added right where a type is chosen */
  P.typeOptions = (kinds, opts = {}) => P.catOptions(kinds, opts) + `<option value="__new">+ Aina mpya ya mchango…</option>`;
  P.newTypeHtml = () => `<label class="pm-span2" data-newtype hidden>Jina la aina mpya ya mchango<input name="new_type_name" placeholder="mf. Harambee ya Kengele ya Kanisa"></label>
    <label data-newtype hidden>Kundi lake<select name="new_type_kind"><option value="special">Mchango maalumu</option><option value="ujenzi">Ujenzi</option>
      <option value="mavuno">Mavuno</option><option value="shukrani">Shukrani</option><option value="sadaka">Sadaka</option><option value="income_other">Mapato mengine</option></select></label>`;
  P.wireNewType = (root, sel, after) => {
    const sync = () => {
      const on = sel.value === '__new';
      root.querySelectorAll('[data-newtype]').forEach(x => { x.hidden = !on; x.querySelectorAll('input').forEach(i => { i.required = on; }); });
      if (on) setTimeout(() => root.querySelector('[name=new_type_name]')?.focus(), 30);
      after && after(on);
    };
    sel.addEventListener('change', sync); sync();
  };
  // form values → the type id, creating the new type first when "+ Aina mpya" was chosen
  P.resolveType = async (v, field = 'category_id') => {
    if (v[field] !== '__new') return v[field] || null;
    const r = await P.rpc('create_contribution_type', { p: { name: v.new_type_name, kind: v.new_type_kind } });
    await P.loadRef(true);
    if (r.created) Toast.success(`Aina mpya ya mchango "${r.name}" imeongezwa.`); else Toast.info(`"${r.name}" ilikuwepo tayari — imetumika hiyo.`);
    return r.id;
  };
  P.campOptions = (catId, opts = {}) => P.options(P.ref.camps.filter(c => (!catId || c.category_id === catId) && c.status !== 'closed'),
    { label: c => `${c.name}`, ...opts });

  P.badge = (text, tone = 'muted') => `<span class="pm-badge pm-badge--${tone}">${P.esc(text)}</span>`;
  P.progress = (pct) => {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="pm-progress" title="${P.pct(pct)}"><span style="width:${v}%"></span></div>`;
  };
  P.empty = (msg = 'Hakuna taarifa kwa vigezo ulivyochagua.') => `<div class="pm-empty"><span class="material-symbols-outlined">inbox</span>${P.esc(msg)}</div>`;
  P.loading = () => `<div class="pm-empty"><span class="material-symbols-outlined pm-spin">progress_activity</span>Inapakia…</div>`;
  P.kpi = (label, value, icon, tone = '') => `
    <div class="pm-kpi ${tone}"><span class="material-symbols-outlined">${icon}</span>
      <p>${P.esc(label)}</p><h3>${value}</h3></div>`;

  /* table: columns = [{ key, label, fmt?, cls?, html? }] */
  P.table = (rows, cols, { empty, foot, rowAttr, cls = '' } = {}) => {
    if (!rows || !rows.length) return P.empty(empty);
    const th = cols.map(c => `<th class="${c.cls || ''}">${P.esc(c.label)}</th>`).join('');
    const tr = rows.map(r => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map(c => {
      const v = c.html ? c.html(r) : c.fmt ? c.fmt(r[c.key], r) : P.esc(r[c.key] ?? '—');
      return `<td class="${c.cls || ''}">${v}</td>`;
    }).join('')}</tr>`).join('');
    const tf = foot ? `<tfoot><tr>${cols.map(c => `<td class="${c.cls || ''}">${foot[c.key] ?? ''}</td>`).join('')}</tr></tfoot>` : '';
    return `<div class="pm-table-wrap"><table class="pm-table ${cls}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${tf}</table></div>`;
  };
  P.sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

  /* ── Kigango → Jumuiya helpers (every page is organised the same way) ── */
  P.kigangoOf = id => {
    let u = P.ref.unitsById[id];
    while (u && u.unit_type !== 'kigango') u = P.ref.unitsById[u.parent_id];
    return u || null;
  };
  P.unitByName = (type, name) => P.ref.units.find(u => u.unit_type === type && u.name === name) || null;
  P.unitOrder = id => { const u = P.ref.unitsById[id]; return u ? (u.ordinal ?? 999) * 1000 : 999999; };
  // two linked selects: choosing a kigango limits the jumuiya list to its own
  P.cascadeHtml = ({ kigango = '', jumuiya = '', allLabel = 'Zote' } = {}) => {
    const kig = P.unitsOf('kigango');
    const jum = P.unitsOf('jumuiya');
    return `<label>Kigango<select name="kigango" data-cascade-k>${P.options(kig, { blank: allLabel, selected: kigango })}</select></label>
      <label>Jumuiya<select name="jumuiya" data-cascade-j><option value="">${P.esc(allLabel)}</option>${jum.map(j =>
        `<option value="${j.id}" data-k="${j.parent_id}" ${j.id === jumuiya ? 'selected' : ''}>${P.esc(j.name)}</option>`).join('')}</select></label>`;
  };
  P.wireCascade = root => {
    const k = root.querySelector('[data-cascade-k]'), j = root.querySelector('[data-cascade-j]');
    if (!k || !j) return;
    const sync = () => {
      [...j.options].forEach(o => { if (o.value) o.hidden = !!k.value && o.dataset.k !== k.value; });
      if (j.selectedOptions[0] && j.selectedOptions[0].hidden) j.value = '';
    };
    k.addEventListener('change', sync); sync();
    j.addEventListener('change', () => { const o = j.selectedOptions[0]; if (o && o.dataset.k && !k.value) { k.value = o.dataset.k; sync(); } });
  };
  // filter values → the unit to scope by (jumuiya wins over kigango)
  P.cascadeUnit = f => f.jumuiya || f.kigango || '';

  /* table grouped by levels (e.g. kigango → jumuiya) with a subtotal on every group row */
  P.groupedTable = (rows, cols, { levels = [], sums = [], empty, fmt = P.tzs, foot, cls = '' } = {}) => {
    if (!rows || !rows.length) return P.empty(empty);
    const th = cols.map(c => `<th class="${c.cls || ''}">${P.esc(c.label)}</th>`).join('');
    const idx = cols.map(c => c.key);
    const firstSum = Math.min(...sums.map(k => idx.indexOf(k)).filter(i => i >= 0), cols.length);
    const cell = (c, r) => `<td class="${c.cls || ''}">${c.html ? c.html(r) : c.fmt ? c.fmt(r[c.key], r) : P.esc(r[c.key] ?? '—')}</td>`;
    const out = [];
    const walk = (list, depth) => {
      if (depth >= levels.length) { list.forEach(r => out.push(`<tr>${cols.map(c => cell(c, r)).join('')}</tr>`)); return; }
      const L = levels[depth], groups = new Map();
      list.forEach(r => { const k = L.key(r) ?? '—'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
      const keys = [...groups.keys()].sort((a, b) => (L.order ? L.order(a) - L.order(b) : 0) || String(L.label(a)).localeCompare(String(L.label(b))));
      keys.forEach(k => {
        const g = groups.get(k);
        const span = Math.max(firstSum, 1);
        const lab = `<span class="pm-group-label">${L.html ? L.html(k, g) : P.esc(L.label(k))}</span> <small class="pm-muted">(${g.length})</small>`;
        const rest = cols.slice(span).map(c => `<td class="${c.cls || ''}">${sums.includes(c.key) ? fmt(P.sum(g, c.key)) : ''}</td>`).join('');
        out.push(`<tr class="pm-group-row pm-group-row--${depth}"><td colspan="${span}">${lab}</td>${rest}</tr>`);
        walk(g, depth + 1);
      });
    };
    walk(rows, 0);
    const tf = foot ? `<tfoot><tr>${cols.map(c => `<td class="${c.cls || ''}">${foot[c.key] ?? ''}</td>`).join('')}</tr></tfoot>` : '';
    return `<div class="pm-table-wrap"><table class="pm-table pm-table--grouped ${cls}"><thead><tr>${th}</tr></thead><tbody>${out.join('')}</tbody>${tf}</table></div>`;
  };

  /* page path: Parokia › Kigango › Jumuiya › … */
  P.crumbs = items => `<nav class="pm-crumbs">${items.map((it, i) => i < items.length - 1 && it.href
    ? `<a href="${it.href}">${P.esc(it.label)}</a><span class="material-symbols-outlined">chevron_right</span>` : `<b>${P.esc(it.label)}</b>`).join('')}</nav>`;
  P.unitCrumbs = (unitId, extra = []) => {
    const chain = [];
    let u = P.ref.unitsById[unitId];
    while (u && u.unit_type !== 'parish') { chain.unshift(u); u = P.ref.unitsById[u.parent_id]; }
    return P.crumbs([{ label: 'Vigango na Jumuiya', href: '#/units' },
      ...chain.map(x => ({ label: x.unit_type === 'kigango' ? `Kigango cha ${x.name}` : `Jumuiya ya ${x.name}`, href: `#/${x.unit_type}?id=${x.id}` })), ...extra]);
  };

  /* modal with a form; resolves with FormData object or null */
  P.modal = ({ title, body, submit = 'Hifadhi', wide = false, onOpen }) => new Promise(resolve => {
    const el = P.h(`<div class="pm-modal"><div class="pm-modal__box ${wide ? 'pm-modal__box--wide' : ''}">
      <header><h3>${P.esc(title)}</h3><button type="button" class="pm-icon-btn" data-close><span class="material-symbols-outlined">close</span></button></header>
      <form novalidate><div class="pm-modal__body">${body}</div>
        <footer>${submit ? `<button type="submit" class="pm-btn pm-btn--primary">${P.esc(submit)}</button>` : ''}
        <button type="button" class="pm-btn" data-close>Funga</button></footer></form></div></div>`);
    const close = v => { el.remove(); resolve(v); };
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) close(null); });
    el.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      if (!f.checkValidity()) { f.reportValidity(); return; }
      close(Object.fromEntries(new FormData(f).entries()));
    });
    document.body.appendChild(el);
    onOpen && onOpen(el);
    const first = el.querySelector('input,select,textarea'); first && first.focus();
  });
  P.confirm = (title, text, ok = 'Endelea') => P.modal({ title, body: `<p class="pm-muted">${P.esc(text)}</p>`, submit: ok }).then(v => v !== null);

  /* busy state for a button while an async action runs (prevents double submission) */
  P.busy = async (btn, fn) => {
    if (btn && btn.disabled) return;
    const old = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-symbols-outlined pm-spin">progress_activity</span> Subiri…'; }
    try { return await fn(); }
    catch (e) { Toast.error(P.friendlyError(e)); try { e.__shown = true; } catch (x) { /* frozen */ } throw e; }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  };

  /* ── exports ── */
  P.exportExcel = (filename, sheets) => {
    if (!window.XLSX) { Toast.error('Maktaba ya Excel haijapakia.'); return; }
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
  };
  P.print = (title) => {
    const t = document.title; document.title = title || t;
    window.print();
    setTimeout(() => { document.title = t; }, 500);
  };
  P.reportHeader = (title, subtitle = '') => {
    const p = P.ref.parish;
    return `<div class="pm-print-head">
      ${p.logo_url ? `<img src="${P.esc(p.logo_url)}" alt="">` : '<span class="material-symbols-outlined">church</span>'}
      <div><p>${P.esc(p.diocese || '')}</p><h2>${P.esc(p.official_name || '')}</h2><p>${P.esc(p.postal_address || '')}</p>
      <h3>${P.esc(title)}</h3>${subtitle ? `<p>${P.esc(subtitle)}</p>` : ''}<p class="pm-muted">Imetolewa: ${new Date().toLocaleString('en-GB')}</p></div></div>`;
  };

  /* search box for parishioners / families / communities used by payment & pledge forms */
  P.payerPicker = (root, { onPick, jumuiya } = {}) => {
    const input = root.querySelector('[data-payer-search]');
    const list = root.querySelector('[data-payer-results]');
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const v = input.value.trim();
      if (v.length < 2) { list.innerHTML = ''; return; }
      t = setTimeout(async () => {
        const like = `%${v}%`;
        const [people, fams] = await Promise.all([
          (jumuiya ? P.from('parishioners').select('id,full_name,family_id,jumuiya_id,families!parishioners_family_id_fkey(family_name)').eq('jumuiya_id', jumuiya)
                   : P.from('parishioners').select('id,full_name,family_id,jumuiya_id,families!parishioners_family_id_fkey(family_name)')).ilike('full_name', like).limit(jumuiya ? 15 : 8),
          (jumuiya ? P.from('families').select('id,family_name,jumuiya_id').eq('jumuiya_id', jumuiya)
                   : P.from('families').select('id,family_name,jumuiya_id')).ilike('family_name', like).limit(jumuiya ? 10 : 5),
        ].map(P.q)).catch(() => [[], []]);
        const units = P.ref.units.filter(u => u.is_active && u.unit_type !== 'parish' && (!jumuiya || u.id === jumuiya) && u.name.toLowerCase().includes(v.toLowerCase())).slice(0, 5);
        const j = id => P.ref.unitsById[id] ? P.ref.unitsById[id].label : '';
        list.innerHTML = [
          ...people.map(p => `<button type="button" data-kind="parishioner" data-id="${p.id}" data-name="${P.esc(p.full_name)}"><span class="material-symbols-outlined">person</span>${P.esc(p.full_name)}<small>${P.esc(p.families?.family_name || '')} · ${P.esc(j(p.jumuiya_id))}</small></button>`),
          ...fams.map(f => `<button type="button" data-kind="family" data-id="${f.id}" data-name="${P.esc(f.family_name)}"><span class="material-symbols-outlined">family_restroom</span>${P.esc(f.family_name)}<small>${P.esc(j(f.jumuiya_id))}</small></button>`),
          ...units.map(u => `<button type="button" data-kind="org_unit" data-id="${u.id}" data-name="${P.esc(u.name)}"><span class="material-symbols-outlined">groups</span>${P.esc(u.label)}<small>${u.unit_type}</small></button>`),
        ].join('') || `<p class="pm-muted pm-pad">Hakuna aliyepatikana — andika jina la mlipaji moja kwa moja.</p>`;
      }, 250);
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('button[data-kind]'); if (!b) return;
      input.value = b.dataset.name; list.innerHTML = '';
      onPick && onPick({ kind: b.dataset.kind, id: b.dataset.id, name: b.dataset.name });
    });
  };
})();
