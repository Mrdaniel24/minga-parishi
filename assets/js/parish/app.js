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
    document.title = `${view.title} | ${P.ref.parish.short_name || 'Parokia'} — Kanisa Hub`;
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
    const profile = await initPageGuard();
    if (!profile) return;
    P.profile = profile;
    P.homeHref = profile.role === 'super_admin' ? '../super-admin/dashboard.html' : profile.role === 'admin' ? '../admin/dashboard.html' : '../member/dashboard.html';
    try {
      [P.access] = await Promise.all([P.rpc('my_parish_access'), P.loadRef()]);
    } catch (e) {
      document.getElementById('pm-view').innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`;
      return;
    }
    const hasRole = P.access.platform_admin || (P.access.roles || []).length > 0;
    if (!hasRole) {
      document.getElementById('pm-view').innerHTML = `<div class="pm-card pm-pad"><h2 class="pm-h2">Huna nafasi kwenye mfumo wa parokia</h2>
        <p class="pm-muted">Akaunti yako haijapewa nafasi (mf. Mhasibu, Kiongozi wa Jumuiya). Wasiliana na Msimamizi wa Mfumo wa Parokia.</p>
        <p class="mt-4"><a class="pm-btn" href="${P.homeHref}">Rudi kwenye lango lako</a></p></div>`;
      return;
    }
    const p = P.ref.parish;
    document.querySelectorAll('[data-parish-name]').forEach(el => { el.textContent = p.official_name || 'Parokia'; });
    const role = (P.access.roles || [])[0];
    const roleEl = document.querySelector('.kh-profile__role');
    if (roleEl && role) roleEl.textContent = role.org_unit ? `${role.role.replace('_', ' ')} · ${role.org_unit}` : role.role.replace('_', ' ');
    // the sidebar menu is the shared one from admin-layout.js; refresh its parish items
    if (window.khApplyParishAccess) window.khApplyParishAccess(P.access);
    window.addEventListener('hashchange', route);
    route();
  };
})();
