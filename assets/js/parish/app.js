/* ============================================
   Minga Parish — app shell: access check and the
   hash router (#/payments?x=y) for parish/index.html.
   Views register themselves in Parish.views.
   ============================================ */
(function () {
  const P = window.Parish;
  P.views = P.views || {};

  P.can = perm => !perm || P.access.platform_admin || (P.access.permissions || []).includes(perm);
  P.hasFeature = feature => feature === 'core'
    ? (P.subscription?.core_enabled ?? true)
    : !!P.subscription?.features?.[feature];
  P.scopeUnit = () => {      // single scoped role (kigango/jumuiya leader) -> default filter
    const r = (P.access.roles || []).filter(r => r.org_unit_id);
    const wide = (P.access.roles || []).some(r => !r.org_unit_id);
    return !P.access.platform_admin && !wide && r.length === 1 ? r[0].org_unit_id : null;
  };

  P.selfOnly = () => !P.access.platform_admin && !(P.access.permissions || []).length && !!P.access.parishioner_id;
  const MEMBER_ROUTES = new Set(['member-home','member-giving','member-family','member-requests','member-link','profile','assistant']);

  let routeSeq = 0;
  async function route() {
    let raw = (location.hash || '#/dashboard').slice(2);
    if ((P.memberPortalMode || P.selfOnly()) && !MEMBER_ROUTES.has(raw.split('?')[0])) {
      raw = P.access.parishioner_id ? 'member-home' : 'member-link';
      history.replaceState(null, '', '#/' + raw);
    }
    const [name, qs] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    if (name === 'accounting' || name === 'reconciliation') history.replaceState(null, '', '#/dashboard');
    const view = name === 'accounting' || name === 'reconciliation' ? P.views.dashboard : (P.views[name] || P.views.dashboard);
    const main = document.getElementById('pm-view');
    if (view.feature && !P.hasFeature(view.feature)) {
      routeSeq++;
      main.innerHTML = P.empty('Kipengele hiki kinapatikana kwenye kifurushi cha Ripoti na Majibu ya Haraka.');
      return;
    }
    if (!P.hasFeature('core') && !P.access.platform_admin && name !== 'subscriptions') {
      routeSeq++;
      main.innerHTML = `<section class="pm-card pm-pad"><h1 class="pm-h2">Demo ya kuangalia</h1><p class="pm-muted">Akaunti hii haina kifurushi kinachowezesha taarifa halisi za parokia. Wasiliana nasi kuchagua kifurushi cha Usimamizi wa Parokia.</p><a class="pm-btn pm-btn--primary" href="https://focustec.co.tz/" target="_blank" rel="noopener noreferrer">Wasiliana nasi</a></section>`;
      return;
    }
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
    // a refresh after saving keeps the old page on screen until the new one is ready
    const quiet = keep !== null;
    if (!quiet) main.replaceChildren(box);
    try {
      await view.render(box, params);
    } catch (e) {
      console.error(e);
      if (token === routeSeq) box.innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`;
    }
    if (token !== routeSeq) return;
    if (quiet) main.replaceChildren(box);
    window.scrollTo(0, keep ?? 0);
  }
  let keep = null;
  P.go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  P.reload = route;
  // refresh the page after saving without jumping back to the top
  P.refresh = () => { keep = window.scrollY; return route().finally(() => { keep = null; }); };

  P.start = async function () {
    const profile = await PM.guard();
    if (!profile) return;
    P.profile = profile;
    try {
      [P.access] = await Promise.all([P.rpc('my_parish_access'), P.loadRef()]);
      P.memberContext = await P.rpc('member_portal_context');
    } catch (e) {
      document.getElementById('pm-view').innerHTML = `<div class="pm-alert pm-alert--error">${P.esc(P.friendlyError(e))}</div>`;
      return;
    }
    const staff = P.access.platform_admin || (P.access.permissions || []).length > 0;
    const hasMember = !!P.access.parishioner_id;
    let savedMode = 'staff';
    try { savedMode = localStorage.getItem('minga-portal-mode') || 'staff'; } catch (e) { /* storage may be disabled */ }
    P.memberPortalMode = !staff || (hasMember && savedMode === 'member');
    const p = P.ref.parish;
    document.querySelectorAll('[data-parish-name]').forEach(el => { el.textContent = p.official_name || 'Parokia'; });
    if (PM.applyAccess) PM.applyAccess(P.access);
    P.subscription = await P.rpc('my_parish_subscription_access').catch(() => ({
      plan_code: 'parish', status: 'legacy', core_enabled: true, legacy: true,
      features: { core: true, ai_quick_ask: false },
    }));
    if (PM.applyAccess) PM.applyAccess(P.access);
    PM.fillYears && PM.fillYears(P.ref.years.map(y => y.label));
    if (P.hasFeature('core')) P.initChatWidget && P.initChatWidget();
    // Scoped leaders land on their role-specific dashboard; members still use
    // the member portal, and the dashboard shortcuts lead into their own unit.
    if (P.memberPortalMode && (!location.hash || location.hash === '#/dashboard')) history.replaceState(null, '', hasMember ? '#/member-home' : '#/member-link');
    window.addEventListener('hashchange', route);
    route();
  };
})();
