/* ============================================
   Minga Parish — app shell: access check and the
   hash router (#/payments?x=y) for parish/index.html.
   Views register themselves in Parish.views.
   ============================================ */
(function () {
  const P = window.Parish;
  P.views = P.views || {};

  P.can = perm => !perm || P.access.platform_admin || (P.access.permissions || []).includes(perm);
  P.scopeUnit = () => {      // single scoped role (kigango/jumuiya leader) -> default filter
    const r = (P.access.roles || []).filter(r => r.org_unit_id);
    const wide = (P.access.roles || []).some(r => !r.org_unit_id);
    return !P.access.platform_admin && !wide && r.length === 1 ? r[0].org_unit_id : null;
  };

  P.selfOnly = () => !P.access.platform_admin && !(P.access.permissions || []).length && !!P.access.parishioner_id;

  let routeSeq = 0;
  async function route() {
    let raw = (location.hash || '#/dashboard').slice(2);
    // a member (no staff permissions) sees only their own giving
    if (P.selfOnly()) raw = `statement?parishioner=${P.access.parishioner_id}`;
    const [name, qs] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    const view = P.views[name] || P.views.dashboard;
    const main = document.getElementById('pm-view');
    if (view.perm && !P.can(view.perm)) {
      routeSeq++;
      main.innerHTML = P.empty('Huna ruhusa ya kuona ukurasa huu.');
      return;
    }
    document.title = `${view.title} | ${P.ref.parish.short_name || 'Parokia'}`;
    const crumb = document.querySelector('.kh-topbar__crumbs b');
    if (crumb) crumb.textContent = view.title;
    // each visit renders into its own box: if the user moves on (or the page is
    // re-routed) while data is still loading, the late render writes into a box
    // that is no longer on screen instead of failing on the new page
    const token = ++routeSeq;
    const box = document.createElement('div');
    box.innerHTML = P.loading();
    main.replaceChildren(box);
    try {
      await view.render(box, params);
    } catch (e) {
      console.error(e);
      if (token === routeSeq) box.innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`;
    }
    if (token !== routeSeq) return;
    window.scrollTo(0, 0);
  }
  P.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  P.reload = route;

  P.start = async function () {
    const profile = await PM.guard();
    if (!profile) return;
    P.profile = profile;
    try {
      [P.access] = await Promise.all([P.rpc('my_parish_access'), P.loadRef()]);
    } catch (e) {
      document.getElementById('pm-view').innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`;
      return;
    }
    const staff = P.access.platform_admin || (P.access.permissions || []).length > 0;
    if (!staff && (P.access.roles || []).length && !P.access.parishioner_id) {
      document.getElementById('pm-view').innerHTML = `<div class="pm-card pm-pad"><h2 class="pm-h2">Akaunti yako bado haijaunganishwa na jina lako</h2>
        <p class="pm-muted">Ukiunganishwa na jina lako kwenye rejista ya parokia, hapa utaona zaka, ahadi na risiti zako. Mwombe Katibu wa Parokia akuunganishe (Watumiaji na Nafasi → Unganisha akaunti).</p>
        <p class="mt-4"><button class="pm-btn" data-action="logout">Toka</button></p></div>`;
      if (PM.applyAccess) PM.applyAccess(P.access);
      return;
    }
    const hasRole = P.access.platform_admin || (P.access.roles || []).length > 0 || !!P.access.parishioner_id;
    if (!hasRole) {
      document.getElementById('pm-view').innerHTML = `<div class="pm-card pm-pad"><h2 class="pm-h2">Huna nafasi kwenye mfumo wa parokia</h2>
        <p class="pm-muted">Akaunti yako (${P.esc(profile.email)}) haijapewa nafasi bado (mf. Mhasibu, Katibu, Kiongozi wa Jumuiya). Mwombe Msimamizi wa Mfumo akupe nafasi, kisha ingia tena.</p>
        <p class="mt-4"><button class="pm-btn" data-action="logout">Toka</button></p></div>`;
      if (PM.applyAccess) PM.applyAccess(P.access);
      return;
    }
    const p = P.ref.parish;
    document.querySelectorAll('[data-parish-name]').forEach(el => { el.textContent = p.official_name || 'Parokia'; });
    if (PM.applyAccess) PM.applyAccess(P.access);
    window.addEventListener('hashchange', route);
    route();
  };
})();
