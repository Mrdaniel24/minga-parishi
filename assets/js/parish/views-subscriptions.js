/* System administrator: manually assign and audit parish subscriptions. */
(function () {
  const P = window.Parish, V = P.views;
  const PLAN = {
    demo: ['Demo ya Kuangalia', 'Taarifa za mfano pekee; hakuna ruhusa za data halisi.'],
    parish: ['Usimamizi wa Parokia · TZS 50,000', 'Mfumo wa parokia kwa data halisi, ripoti za kawaida na roles za sasa.'],
    ai: ['Ripoti na Majibu ya Haraka · TZS 70,000', 'Kifurushi cha parokia pamoja na AI Quick Ask.'],
  };
  const STATUS = { legacy: 'Kifurushi cha awali', active: 'Hai', trialing: 'Majaribio', past_due: 'Malipo yanasubiri', suspended: 'Imesimamishwa', cancelled: 'Imeghairiwa', expired: 'Muda umeisha' };
  V.subscriptions = {
    title: 'Vifurushi vya Parokia', perm: 'platform_admin',
    async render(el) {
      const rows = await P.rpc('admin_list_parish_subscriptions');
      const active = (s, start, end) => ['active','trialing'].includes(s) && (!start || new Date(start) <= new Date()) && (!end || new Date(end) > new Date());
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Vifurushi vya Parokia</h1><p class="pm-muted">Weka kifurushi na muda wa matumizi kwa kila parokia. Hii ni usimamizi wa mikataba; malipo bado yanaingizwa kwa uthibitisho wa msimamizi.</p></div></div>
        <section class="pm-card pm-pad"><div class="pm-table-wrap"><table class="pm-table"><thead><tr><th>Parokia</th><th>Kifurushi</th><th>Hali</th><th>Kipindi</th><th>Kinakwisha</th><th></th></tr></thead><tbody>
          ${rows.map(r => `<tr><td><b>${P.esc(r.parish_name)}</b></td><td>${P.esc(PLAN[r.plan_code]?.[0] || r.plan_code)}</td><td>${P.badge(STATUS[r.status] || r.status, active(r.status,r.starts_at,r.ends_at) ? 'teal' : 'muted')}</td><td>${r.billing_cycle === 'yearly' ? 'Mwaka' : r.billing_cycle === 'monthly' ? 'Mwezi' : 'Kwa mkono'}</td><td>${r.ends_at ? P.date(r.ends_at.slice(0,10)) : 'Bila tarehe'}</td><td><button class="pm-btn pm-btn--sm" data-sub-edit="${P.esc(r.parish_id)}">Weka / Hariri</button></td></tr>`).join('')}
        </tbody></table></div><p class="pm-muted pm-small">Parokia za awali zisizo na rekodi zimeachwa kwenye kifurushi cha msingi ili huduma zao ziendelee hadi msimamizi azipangie subscription.</p></section>`;
      const byId = Object.fromEntries(rows.map(r => [r.parish_id,r]));
      const edit = async row => {
        const today = new Date().toLocaleDateString('en-CA');
        const start = row.starts_at?.slice(0,10) || today;
        const end = row.ends_at?.slice(0,10) || '';
        const body = `<div class="pm-form">
          <label class="pm-span2">Parokia<input value="${P.esc(row.parish_name)}" readonly></label>
          <label>Kifurushi<select name="plan_code" required>${Object.entries(PLAN).map(([code,[name]]) => `<option value="${code}" ${row.plan_code === code ? 'selected' : ''}>${P.esc(name)}</option>`).join('')}</select></label>
          <label>Hali<select name="status" required>${[['active','Hai'],['trialing','Majaribio'],['past_due','Malipo yanasubiri'],['suspended','Imesimamishwa'],['cancelled','Imeghairiwa']].map(([v,n]) => `<option value="${v}" ${(row.status === v || (!row.status && v === 'active')) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Kipindi<select name="billing_cycle"><option value="monthly" ${row.billing_cycle === 'monthly' ? 'selected' : ''}>Kwa mwezi</option><option value="yearly" ${row.billing_cycle === 'yearly' ? 'selected' : ''}>Kwa mwaka (punguzo 20%)</option><option value="manual" ${!['monthly','yearly'].includes(row.billing_cycle) ? 'selected' : ''}>Maalum / demo</option></select></label>
          <label>Kuanzia<input type="date" name="starts_on" value="${P.esc(start)}" required></label>
          <label class="pm-span2">Inaisha (acha wazi kama haijawekwa)<input type="date" name="ends_on" value="${P.esc(end)}"></label>
          <label class="pm-span2">Maelezo ya msimamizi<input name="notes" maxlength="500" value="${P.esc(row.notes || '')}" placeholder="Namba ya risiti au maelezo ya mkataba"></label>
        </div><p class="pm-muted pm-small">Kubadilisha hali kuwa “Hai” kunawasha kifurushi mara moja. Mfumo huu bado haupokei au kuthibitisha malipo moja kwa moja.</p>`;
        const values = await P.modal({ title: `Kifurushi — ${row.parish_name}`, body, submit: 'Hifadhi kifurushi', wide: true });
        if (!values) return;
        if (values.ends_on && values.ends_on < values.starts_on) { Toast.error('Tarehe ya mwisho iwe baada ya tarehe ya kuanza.'); return; }
        await P.rpc('admin_set_parish_subscription', {
          p_parish_id: row.parish_id, p_plan_code: values.plan_code, p_status: values.status,
          p_billing_cycle: values.billing_cycle,
          p_starts_at: `${values.starts_on}T00:00:00Z`,
          p_ends_at: values.ends_on ? `${values.ends_on}T23:59:59Z` : null,
          p_notes: values.notes || null,
        });
        Toast.success('Kifurushi kimehifadhiwa.'); P.reload();
      };
      el.querySelectorAll('[data-sub-edit]').forEach(btn => btn.addEventListener('click', () => edit(byId[btn.dataset.subEdit])));
    },
  };
})();
