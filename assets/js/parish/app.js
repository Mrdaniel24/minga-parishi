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

  async function route() {
    const raw = (location.hash || '#/dashboard').slice(2);
    const [name, qs] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    const view = P.views[name] || P.views.dashboard;
    const main = document.getElementById('pm-view');
    if (view.perm && !P.can(view.perm)) {
      main.innerHTML = P.empty('Huna ruhusa ya kuona ukurasa huu.');
      return;
    }
    document.title = `${view.title} | ${P.ref.parish.short_name || 'Parokia'}`;
    const crumb = document.querySelector('.kh-topbar__crumbs b');
    if (crumb) crumb.textContent = view.title;
    main.innerHTML = P.loading();
    try {
      await view.render(main, params);
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`;
    }
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
    const hasRole = P.access.platform_admin || (P.access.roles || []).length > 0;
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
