/* ============================================
   Minga Parish — page shell for parish/index.html
   Sign-in guard, sidebar (profile card + menu), top bar,
   footer, toasts and the phone layout helpers.
   What a user may see is decided by the database (RLS);
   the menu only hides links the user has no permission for.
   ============================================ */
(function () {
  const PM = window.PM = window.PM || {};
  const LOGIN = new URL('../login.html', location.href).href;   // pages using the shell live in parish/
  PM.loginHref = LOGIN;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initialsOf = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  /* ── toasts ── */
  window.Toast = {
    box: null,
    show(message, type = 'info', ms = 4000) {
      if (!this.box) {
        this.box = document.createElement('div');
        this.box.className = 'pm-toasts';
        document.body.appendChild(this.box);
      }
      const icons = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
      const t = document.createElement('div');
      t.className = `pm-toast pm-toast--${type}`;
      t.setAttribute('role', type === 'error' ? 'alert' : 'status');
      t.innerHTML = `<span class="material-symbols-outlined">${icons[type] || 'info'}</span><span>${esc(message)}</span>`;
      t.addEventListener('click', () => t.remove());
      this.box.appendChild(t);
      setTimeout(() => t.remove(), ms);
    },
    success(m) { this.show(m, 'success'); },
    error(m) { this.show(m, 'error', 6500); },
    warning(m) { this.show(m, 'warning'); },
    info(m) { this.show(m, 'info'); },
  };

  /* ── sign-in guard: returns the profile, or sends the user to the login page ── */
  PM.guard = async function () {
    const { data: { session } = {} } = await supabase.auth.getSession();
    if (!session) { location.replace(LOGIN); return null; }
    if (session.user?.user_metadata?.must_change_password) { location.replace(new URL('../reset.html?required=1', location.href).href); return null; }
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error || !profile) {
      await supabase.auth.signOut();
      location.replace(LOGIN + '?e=profile');
      return null;
    }
    if (profile.status !== 'active') {
      await supabase.auth.signOut();
      location.replace(LOGIN + '?e=inactive');
      return null;
    }
    PM.profile = profile;
    PM.paintUser();
    document.body.style.opacity = '1';
    return profile;
  };

  // fills every [data-user-*] slot (the top bar may be built after the guard ran)
  // an account that signs in by phone shows its number, not its private sign-in address
  PM.loginLabel = p => p && p.phone && (!p.email || String(p.email).endsWith('@simu.parokia.local')) ? '+' + p.phone : (p && p.email) || '';
  PM.paintUser = function () {
    const p = PM.profile;
    if (p) {
      document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = p.full_name || PM.loginLabel(p); });
      document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = PM.loginLabel(p); });
      document.querySelectorAll('[data-user-initials]').forEach(el => { el.textContent = initialsOf(p.full_name || PM.loginLabel(p)); });
    }
    if (PM.roleLabel) document.querySelectorAll('[data-user-role]').forEach(el => { el.textContent = PM.roleLabel; });
  };
  // the working year (top bar + phone header); changing it re-draws the current page
  PM.fillYears = labels => {
    const P = window.Parish;
    const ys = [...new Set([...(labels || []).map(Number).filter(Boolean), P.thisYear(), P.year()])].sort((a, b) => b - a);
    document.querySelectorAll('[data-yearpick]').forEach(sel => {
      sel.innerHTML = ys.map(y => `<option ${y === P.year() ? 'selected' : ''}>${y}</option>`).join('');
      if (sel.dataset.wired) return;
      sel.dataset.wired = '1';
      sel.addEventListener('change', () => {
        P.setYear(sel.value);
        document.querySelectorAll('[data-yearpick]').forEach(x => { x.value = sel.value; });
        P.reload && P.reload();
      });
    });
  };
  const ROLE_SW = { parish_admin: 'Msimamizi wa Parokia', parish_priest: 'Paroko', accountant: 'Mhasibu', treasurer: 'Mtunza Hazina',
    kigango_leader: 'Kiongozi wa Kigango', jumuiya_leader: 'Kiongozi wa Jumuiya', data_entry: 'Karani', auditor: 'Mkaguzi', member: 'Muumini' };

  PM.logout = async function () {
    try { await supabase.auth.signOut(); } catch (e) { /* offline: still leave */ }
    location.replace(LOGIN);
  };

  /* ── sidebar: profile card + menu ── */
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    // the profile card replaces the plain heading block in the page markup
    [...sidebar.children].forEach(el => { if (el.tagName === 'DIV' && el.querySelector('h1')) el.classList.add('kh-old-brand'); });
    const card = document.createElement('div');
    card.className = 'kh-profile';
    card.innerHTML = `
      <div class="kh-profile__ring"><div class="kh-profile__avatar"><span data-user-initials>?</span></div></div>
      <p class="kh-profile__name" data-user-name>Inapakia…</p>
      <p class="kh-profile__email" data-user-email></p>
      <span class="kh-profile__role" data-user-role>Parokia</span>`;
    const closeBtn = sidebar.querySelector('.sidebar-close-btn');
    sidebar.insertBefore(card, closeBtn ? closeBtn.nextSibling : sidebar.firstChild);

    const R = '#/';
    const items = [];
    const h = (t, portal = 'staff') => items.push({ h: t, portal });
    const a = (label, icon, href, perm, portal = 'staff') => items.push({ label, icon, href: R + href, perm, portal });
    h('Akaunti Yangu', 'member');
    a('Nyumbani', 'home', 'member-home', 'member', 'member');
    a('Michango Yangu', 'volunteer_activism', 'member-giving', 'member', 'member');
    a('Familia Yangu', 'family_restroom', 'member-family', 'member', 'member');
    a('Maombi Yangu', 'assignment', 'member-requests', 'member', 'member');
    a('Unganisha na rejista', 'link', 'member-link', 'member', 'member');
    a('Wasifu Wangu', 'manage_accounts', 'profile', 'member', 'member');
    h('Yangu');
    a('Michango Yangu', 'volunteer_activism', 'statement', 'self');
    h('Parokia');
    a('Dashibodi', 'dashboard', 'dashboard', '*');
    a('Vigango na Jumuiya', 'account_tree', 'units', 'registry.read|finance.read');
    a('Tafuta Muumini', 'person_search', 'registry', 'registry.read');
    h('Muhtasari wa parokia nzima');
    a('Miamala ya Parokia', 'point_of_sale', 'payments', 'finance.read');
    a('Michango (vigango vyote)', 'volunteer_activism', 'campaigns', 'finance.read');
    a('Ripoti', 'bar_chart', 'reports', 'finance.read');
    a('Michango ya Viongozi', 'military_tech', 'leaderreport', 'finance.read');
    h('Ofisi ya Fedha');
    a('Uhakiki wa malipo', 'fact_check', 'payment-approvals', 'finance.approve');
    a('Matumizi', 'receipt', 'expenses', 'finance.read');

    a('Risiti', 'receipt_long', 'receipts', 'finance.read');
    h('Mfumo');
    a('Muundo wa Parokia', 'lan', 'structure', 'registry.read');
    a('Viongozi', 'badge', 'leaders', 'registry.read');
    a('Taarifa za Parokia', 'info', 'parish', '*');
    a('Matangazo na SMS', 'campaign', 'comms', 'comms.send');
    a('Watumiaji na Nafasi', 'admin_panel_settings', 'users', 'users.manage');
    a('Mipangilio ya Fedha', 'settings', 'settings', 'parish.configure');
    a('Wasifu Wangu', 'manage_accounts', 'profile', null);
    h('Maombi ya Waumini');
    a('Maombi ya familia', 'fact_check', 'member-requests-office', 'registry.write');

    const isActive = href => {
      const route = location.hash || '#/dashboard';
      // the pages inside a kigango / jumuiya / familia belong to "Vigango na Jumuiya"
      if (href === '#/units' && /^#\/(kigango|jumuiya|family)\b/.test(route)) return true;
      if (href === '#/campaigns' && /^#\/mchango\b/.test(route)) return true;
      return route === href || (!href.includes('?') && route.split('?')[0] === href);
    };
    const nav = sidebar.querySelector('#pm-nav');
    nav.classList.add('kh-nav');
    nav.innerHTML = items.map(i => i.h
      ? `<p class="kh-nav-h" data-psection data-portal="${i.portal}">${i.h}</p>`
      : `<a class="nav-item${isActive(i.href) ? ' nav-item-active' : ''}" href="${i.href}" data-pperm="${i.perm}" data-portal="${i.portal || 'staff'}" hidden>
           <span class="material-symbols-outlined">${i.icon}</span><span>${i.label}</span></a>`).join('');

    // show only the links the user's parish roles allow
    PM.applyAccess = acc => {
      PM.access = acc;
      const perms = new Set((acc && acc.permissions) || []);
      const any = acc && (acc.platform_admin || (acc.roles || []).length);
      const memberMode = !!window.Parish?.memberPortalMode;
      nav.querySelectorAll('[data-pperm]').forEach(el => {
        const p = el.dataset.pperm;
        const memberAllowed = p === 'member' && memberMode;
        const staffAllowed = el.dataset.portal !== 'member' && !memberMode && (p === 'self' ? !!acc?.parishioner_id : !!acc && (acc.platform_admin || (p === '*' ? any : p.split('|').some(x => perms.has(x)))));
        el.hidden = !(memberAllowed || staffAllowed);
      });
      nav.querySelectorAll('[data-psection]').forEach(hd => { hd.hidden = hd.dataset.portal === 'member' ? !memberMode : memberMode; });
      nav.querySelectorAll('[data-psection]').forEach(hd => {
        let n = hd.nextElementSibling, show = false;
        while (n && n.tagName === 'A') { if (!n.hidden) show = true; n = n.nextElementSibling; }
        hd.hidden = !show;
      });
      const mobile = document.querySelector('.mobile-bottom-nav');
      const accountRoles = acc?.roles || [];
      const hasParishWideRole = !!acc?.platform_admin || accountRoles.some(r => !r.org_unit_id);
      const scopedLeader = !hasParishWideRole && accountRoles.length === 1
        ? accountRoles.find(r => ['kigango_leader', 'jumuiya_leader'].includes(r.role) && r.org_unit_id && ['kigango', 'jumuiya'].includes(r.unit_type))
        : null;
      if (mobile) mobile.innerHTML = memberMode
        ? `<a href="#/member-home" class="bottom-nav-item"><span class="material-symbols-outlined">home</span><span>Nyumbani</span></a><a href="#/member-giving" class="bottom-nav-item"><span class="material-symbols-outlined">volunteer_activism</span><span>Michango</span></a><a href="#/member-family" class="bottom-nav-item"><span class="material-symbols-outlined">family_restroom</span><span>Familia</span></a><a href="#/member-requests" class="bottom-nav-item"><span class="material-symbols-outlined">assignment</span><span>Maombi</span></a>${accCanStaff(acc) ? '<button data-portal-mode-toggle class="bottom-nav-item"><span class="material-symbols-outlined">swap_horiz</span><span>Watumishi</span></button>' : '<button data-sidebar-toggle class="bottom-nav-item"><span class="material-symbols-outlined">menu</span><span>Zaidi</span></button>'}`
        : scopedLeader?.role === 'jumuiya_leader'
          ? `<a href="#/dashboard" class="bottom-nav-item"><span class="material-symbols-outlined">dashboard</span><span>Nyumbani</span></a><a href="#/jumuiya?id=${scopedLeader.org_unit_id}&tab=mahudhurio" class="bottom-nav-item"><span class="material-symbols-outlined">how_to_reg</span><span>Mahudhurio</span></a><a href="#/jumuiya?id=${scopedLeader.org_unit_id}&tab=familia" class="bottom-nav-item"><span class="material-symbols-outlined">family_restroom</span><span>Familia</span></a><a href="#/reports?scope=${scopedLeader.org_unit_id}" class="bottom-nav-item"><span class="material-symbols-outlined">bar_chart</span><span>Ripoti</span></a><button data-sidebar-toggle class="bottom-nav-item"><span class="material-symbols-outlined">menu</span><span>Zaidi</span></button>`
          : scopedLeader?.role === 'kigango_leader'
            ? `<a href="#/dashboard" class="bottom-nav-item"><span class="material-symbols-outlined">dashboard</span><span>Nyumbani</span></a><a href="#/kigango?id=${scopedLeader.org_unit_id}" class="bottom-nav-item"><span class="material-symbols-outlined">account_tree</span><span>Jumuiya</span></a><a href="#/reports?scope=${scopedLeader.org_unit_id}" class="bottom-nav-item"><span class="material-symbols-outlined">bar_chart</span><span>Ripoti</span></a><button data-sidebar-toggle class="bottom-nav-item"><span class="material-symbols-outlined">menu</span><span>Zaidi</span></button>`
            : `<a href="#/dashboard" class="bottom-nav-item"><span class="material-symbols-outlined">dashboard</span><span>Dashibodi</span></a><a href="#/units" class="bottom-nav-item"><span class="material-symbols-outlined">account_tree</span><span>Vigango</span></a><a href="#/payments" class="bottom-nav-item"><span class="material-symbols-outlined">point_of_sale</span><span>Miamala</span></a><a href="#/reports" class="bottom-nav-item"><span class="material-symbols-outlined">bar_chart</span><span>Ripoti</span></a><button data-sidebar-toggle class="bottom-nav-item"><span class="material-symbols-outlined">menu</span><span>Zaidi</span></button>`;
      const role = (acc && acc.roles || [])[0];
      const label = memberMode && !acc?.parishioner_id ? 'Unganisha na rejista'
        : memberMode ? 'Muumini'
        : acc && acc.platform_admin ? 'Msimamizi wa Mfumo'
        : acc && !(acc.permissions || []).length && acc.parishioner_id ? 'Muumini'
        : role ? (ROLE_SW[role.role] || role.role.replace(/_/g, ' ')) + (role.org_unit ? ` · ${role.org_unit}` : '') : 'Hana nafasi';
      PM.roleLabel = label;
      PM.paintModeButton && PM.paintModeButton();
      PM.paintUser();
    };
    const mode = document.createElement('button');
    mode.type = 'button'; mode.className = 'nav-item member-mode-switch'; mode.dataset.modeToggle = '1'; mode.hidden = true;
    mode.innerHTML = '<span class="material-symbols-outlined">swap_horiz</span><span data-mode-label>Member Portal</span>';
    sidebar.querySelector('.mt-auto')?.prepend(mode);
    PM.paintModeButton = () => {
      const staff = accCanStaff(PM.access);
      mode.hidden = !staff || !PM.access?.parishioner_id;
      mode.querySelector('[data-mode-label]').textContent = window.Parish?.memberPortalMode ? 'Dashboard ya Watumishi' : 'Member Portal';
    };
    const accCanStaff = a => !!a && (a.platform_admin || (a.permissions || []).length > 0);
    const switchPortal = () => {
      if (!accCanStaff(PM.access) || !PM.access?.parishioner_id) return;
      const P = window.Parish;
      P.memberPortalMode = !P.memberPortalMode;
      try { localStorage.setItem('minga-portal-mode', P.memberPortalMode ? 'member' : 'staff'); } catch (e) { /* interface still switches for this session */ }
      PM.applyAccess(PM.access);
      P.go(P.memberPortalMode ? '#/member-home' : '#/dashboard');
    };
    mode.addEventListener('click', switchPortal);
    document.addEventListener('click', e => { if (e.target.closest('[data-portal-mode-toggle]')) switchPortal(); });
    const paintMobileNav = () => {
      nav.querySelectorAll('a.nav-item').forEach(el => el.classList.toggle('nav-item-active', isActive(el.getAttribute('href'))));
      const route = location.hash || '#/dashboard';
      document.querySelectorAll('.mobile-bottom-nav a.bottom-nav-item').forEach(el => {
        const href = el.getAttribute('href') || '';
        el.classList.toggle('bottom-nav-active', href === route || (!href.includes('?') && href === route.split('?')[0]) || (href.includes('?') && href.split('?')[0] === route.split('?')[0] && new URLSearchParams(href.split('?')[1]).get('tab') === new URLSearchParams(route.split('?')[1] || '').get('tab')));
      });
    };
    paintMobileNav();
    window.addEventListener('hashchange', paintMobileNav);

    const brand = document.createElement('p');
    brand.className = 'kh-sidebar-brand';
    brand.innerHTML = '<b>Mfumo wa Parokia</b>';
    (sidebar.querySelector('.mt-auto') || sidebar).appendChild(brand);
  }

  // an action that fails (e.g. "this type has payments, it cannot be deleted") must
  // tell the user why, even when the button handler does not catch the error itself
  window.addEventListener('unhandledrejection', e => {
    const err = e.reason;
    if (!err || err.__shown) return;
    const P = window.Parish;
    Toast.error(P && P.friendlyError ? P.friendlyError(err) : String(err.message || err));
  });

  document.addEventListener('click', e => {
    const out = e.target.closest('[data-action="logout"]');
    if (out) { e.preventDefault(); PM.logout(); }
  });

  /* ── top bar + footer ── */
  const buildMainChrome = () => {
    const main = document.querySelector('main.main-responsive');
    if (!main) return;
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const bar = document.createElement('div');
    bar.className = 'kh-topbar';
    bar.innerHTML = `
      <div class="kh-topbar__crumbs"><span>Parokia</span><span class="material-symbols-outlined">chevron_right</span><b>Dashibodi</b></div>
      <div class="kh-topbar__right">
        <label class="pm-yearpick" title="Mwaka wa kazi: kurasa zote zinaonyesha mwaka huu"><span class="material-symbols-outlined">event</span>Mwaka
          <select data-yearpick></select></label>
        <span class="kh-topbar__date"><span class="material-symbols-outlined">calendar_today</span>${today}</span>
        <span class="kh-topbar__user">
          <p><span class="n" data-user-name>Inapakia…</span><br><span class="r" data-user-role></span></p>
          <span class="kh-topbar__avatar"><span data-user-initials>?</span></span>
        </span>
        <button class="kh-topbar__btn" data-action="logout" title="Toka"><span class="material-symbols-outlined">logout</span></button>
      </div>`;
    main.insertBefore(bar, main.firstChild);
    const footer = document.createElement('footer');
    footer.className = 'kh-footer';
    footer.innerHTML = `<span>© ${new Date().getFullYear()} <b data-parish-name>Parokia</b></span><span><span class="kh-footer__dot"></span>Mfumo wa Usimamizi wa Parokia</span>`;
    main.appendChild(footer);
    PM.paintUser();
    PM.paintModeButton && PM.paintModeButton();
    if (window.Parish && window.Parish.ref) PM.fillYears(window.Parish.ref.years.map(y => y.label));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildMainChrome);
  else buildMainChrome();

  /* ── phone layout: tables become labelled row cards ── */
  const addClass = (el, cls) => { if (el && !el.classList.contains(cls)) el.classList.add(cls); };
  const decorate = () => {
    const main = document.querySelector('main');
    if (!main) return;
    main.querySelectorAll('table').forEach(table => {
      const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      if (!heads.length) return;
      if (table.classList.contains('pm-keep-table')) return;    // month grids stay a table and scroll sideways
      addClass(table, 'kh-cards');
      addClass(table.parentElement, 'kh-table-wrap');
      table.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => {
          if (td.hasAttribute('colspan')) { addClass(tr, 'kh-span'); return; }
          if (heads[i] && td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i]);
        });
        const last = tr.lastElementChild;
        if (last && last.querySelector('button, a')) addClass(last, 'kh-actions');
      });
    });
  };
  let queued = false;
  const start = () => {
    decorate();
    const main = document.querySelector('main');
    if (main) new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => { queued = false; decorate(); }, 60);
    }).observe(main, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
