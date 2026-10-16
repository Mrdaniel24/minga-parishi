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
    document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = profile.full_name || profile.email; });
    document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = profile.email || ''; });
    document.querySelectorAll('[data-user-initials]').forEach(el => { el.textContent = initialsOf(profile.full_name || profile.email); });
    document.body.style.opacity = '1';
    return profile;
  };

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
    const h = t => items.push({ h: t });
    const a = (label, icon, href, perm) => items.push({ label, icon, href: R + href, perm });
    h('Parokia');
    a('Dashibodi', 'church', 'dashboard', '*');
    a('Familia na Waumini', 'family_restroom', 'registry', 'registry.read');
    a('Vigango na Jumuiya', 'account_tree', 'structure', 'registry.read');
    a('Viongozi', 'badge', 'leaders', 'registry.read');
    h('Fedha');
    a('Miamala', 'point_of_sale', 'payments', 'finance.read');
    a('Zaka', 'calendar_month', 'zaka', 'finance.read');
    a('Mavuno', 'agriculture', 'campaigns?kind=mavuno', 'finance.read');
    a('Ujenzi', 'construction', 'campaigns?kind=ujenzi', 'finance.read');
    a('Michango Maalumu', 'volunteer_activism', 'campaigns?kind=special', 'finance.read');
    a('Ahadi na Madeni', 'handshake', 'pledges', 'finance.read');
    a('Bahasha', 'mail', 'envelopes', 'finance.read');
    a('Matumizi', 'receipt', 'expenses', 'finance.read');
    a('Uhasibu', 'account_balance', 'accounting', 'finance.read');
    a('Risiti', 'receipt_long', 'receipts', 'finance.read');
    a('Ripoti', 'bar_chart', 'reports', 'finance.read');
    a('Uhakiki wa Fedha', 'fact_check', 'reconciliation', 'finance.read');
    h('Mfumo');
    a('Taarifa za Parokia', 'info', 'parish', '*');
    a('Watumiaji na Nafasi', 'admin_panel_settings', 'users', 'users.manage');
    a('Mipangilio ya Fedha', 'settings', 'settings', 'parish.configure');

    const isActive = href => {
      const route = location.hash || '#/dashboard';
      return route === href || (!href.includes('?') && route.split('?')[0] === href);
    };
    const nav = sidebar.querySelector('#pm-nav');
    nav.classList.add('kh-nav');
    nav.innerHTML = items.map(i => i.h
      ? `<p class="kh-nav-h" data-psection>${i.h}</p>`
      : `<a class="nav-item${isActive(i.href) ? ' nav-item-active' : ''}" href="${i.href}" data-pperm="${i.perm}" hidden>
           <span class="material-symbols-outlined">${i.icon}</span><span>${i.label}</span></a>`).join('');

    // show only the links the user's parish roles allow
    PM.applyAccess = acc => {
      const perms = new Set((acc && acc.permissions) || []);
      const any = acc && (acc.platform_admin || (acc.roles || []).length);
      nav.querySelectorAll('[data-pperm]').forEach(el => {
        const p = el.dataset.pperm;
        el.hidden = !(acc && (acc.platform_admin || (p === '*' ? any : perms.has(p))));
      });
      nav.querySelectorAll('[data-psection]').forEach(hd => {
        let n = hd.nextElementSibling, show = false;
        while (n && n.tagName === 'A') { if (!n.hidden) show = true; n = n.nextElementSibling; }
        hd.hidden = !show;
      });
      const role = (acc && acc.roles || [])[0];
      const label = acc && acc.platform_admin ? 'Msimamizi wa Mfumo'
        : role ? (role.org_unit ? `${role.role.replace(/_/g, ' ')} · ${role.org_unit}` : role.role.replace(/_/g, ' ')) : 'Hana nafasi';
      document.querySelectorAll('[data-user-role]').forEach(el => { el.textContent = label; });
    };
    window.addEventListener('hashchange', () => {
      nav.querySelectorAll('a.nav-item').forEach(el => el.classList.toggle('nav-item-active', isActive(el.getAttribute('href'))));
    });

    const brand = document.createElement('p');
    brand.className = 'kh-sidebar-brand';
    brand.innerHTML = '<b>Mfumo wa Parokia</b>';
    (sidebar.querySelector('.mt-auto') || sidebar).appendChild(brand);
  }

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
