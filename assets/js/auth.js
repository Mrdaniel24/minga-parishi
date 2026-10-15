/**
 * Kanisa Hub Digital Management System
 * Authentication Module
 */

async function registerUser(userData) {
  try {
    const {
      email,
      password,
      full_name,
      phone,
      gender,
      marital_status,
      date_of_birth,
      department_id,
      address
    } = userData;

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: full_name || ''
        }
      }
    });

    if (authError) {
      return { success: false, error: authError.message };
    }

    if (!authData?.user) {
      return { success: false, error: 'Account creation failed. Please try again.' };
    }

    const profileData = {
      id: authData.user.id,
      email: email,
      full_name: full_name || null,
      phone: phone || null,
      gender: gender || null,
      marital_status: marital_status || null,
      date_of_birth: date_of_birth || null,
      department_id: department_id || null,
      address: address || null,
      role: 'member',
      status: 'active'
    };

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(profileData, { onConflict: 'id' });

    if (profileError) {
      return { success: false, error: 'Profile save failed: ' + profileError.message };
    }

    clearProfileCache?.();

    return { success: true, user: authData.user };
  } catch (e) {
    return { success: false, error: e.message || 'Registration failed unexpectedly.' };
  }
}

async function loginUser(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error('Supabase signInWithPassword error:', {
        code: error.code,
        message: error.message,
        status: error.status
      });

      return { success: false, error: `${error.code}: ${error.message}` };
    }

    clearProfileCache?.();

    return {
      success: true,
      session: data.session,
      user: data.user
    };
  } catch (e) {
    console.error('Login exception:', e);
    return { success: false, error: e.message || 'Login failed unexpectedly.' };
  }
}

async function logoutUser() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('Logout error:', e);
  } finally {
    clearProfileCache?.();
    window.location.href = getAbsolutePath('/public/login.html');
  }
}

function getAbsolutePath(path) {
  return `${window.location.origin}${path}`;
}

function redirectToDashboard(role) {
  switch (role) {
    case 'super_admin':
      window.location.href = getAbsolutePath('/super-admin/dashboard.html');
      break;
    case 'admin':
      window.location.href = getAbsolutePath('/admin/dashboard.html');
      break;
    default:
      window.location.href = getAbsolutePath('/member/dashboard.html');
      break;
  }
}

function canAccessRole(userRole, requiredRole) {
  return roleMeetsRequirement(userRole, requiredRole);
}

async function handleLogin(email, password) {
  const result = await loginUser(email, password);
  if (!result.success) return result;

  try {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, status, full_name, email')
      .eq('id', result.user.id)
      .single();

    if (profileError) {
      return {
        success: false,
        error: 'Could not fetch your profile. ' + profileError.message
      };
    }

    if (!profile) {
      return { success: false, error: 'Your profile was not found.' };
    }

    if (profile.status !== 'active') {
      await supabase.auth.signOut();
      clearProfileCache?.();
      return {
        success: false,
        error: 'Your account is ' + profile.status + '. Contact the church office.'
      };
    }

    clearProfileCache?.();
    redirectToDashboard(profile.role || 'member');

    return {
      success: true,
      role: profile.role
    };
  } catch (e) {
    return { success: false, error: e.message || 'Login flow failed unexpectedly.' };
  }
}

async function handleRegistration(formData) {
  try {
    const result = await registerUser(formData);
    if (!result.success) return result;

    // Try auto-login — this may fail if email confirmation is enabled
    const loginResult = await loginUser(formData.email, formData.password);
    if (!loginResult.success) {
      // Registration succeeded but auto-login failed (email confirmation required)
      // Redirect to login with a success message
      window.location.href = getAbsolutePath('/public/login.html?registered=1');
      return { success: true, needsConfirmation: true };
    }

    // ask to be linked to the parish register (jumuiya chosen on the form)
    if (formData.department_id) {
      try { await supabase.rpc('request_parish_link', { p: { department_id: formData.department_id, full_name: formData.full_name, phone: formData.phone } }); }
      catch (e) { console.warn('parish link request failed', e); }
    }
    clearProfileCache?.();
    redirectToDashboard('member');

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message || 'Unexpected registration error.' };
  }
}

async function redirectIfLoggedIn() {
  try {
    const session = await getSession();
    if (!session) return;

    const profile = await getUserProfile(true);
    if (!profile) return;

    if (profile.status && profile.status !== 'active') {
      await logoutUser();
      return;
    }

    redirectToDashboard(profile.role || 'member');
  } catch (e) {
    console.error('redirectIfLoggedIn error:', e);
  }
}

/**
 * Page guard using body[data-required-role]
 *
 * Examples:
 * <body data-required-role="admin">
 * <body data-required-role="super_admin">
 *
 * Rules:
 * - super_admin can access admin pages
 * - admin cannot access super_admin pages
 * - inactive users are signed out
 *
 * @returns {Promise<Object|null>} profile
 */
async function initPageGuard() {
  try {
    const session = await getSession();

    if (!session?.user) {
      window.location.href = getAbsolutePath('/public/login.html');
      return null;
    }

    // Cached profile/permissions let the page show at once; re-checked below.
    const cached = getCachedGuard(session.user.id);
    const profile = cached ? cached.profile : await getUserProfile(true);

    if (!profile) {
      await supabase.auth.signOut();
      clearProfileCache?.();
      window.location.href = getAbsolutePath('/public/login.html');
      return null;
    }

    if (profile.status !== 'active') {
      await supabase.auth.signOut();
      clearProfileCache?.();
      if (typeof Toast !== 'undefined') {
        Toast.error('Your account is inactive.');
      }
      window.location.href = getAbsolutePath('/public/login.html');
      return null;
    }

    const requiredRole = document.body?.dataset?.requiredRole || null;
    const userRole = profile.role || 'member';

    if (requiredRole && !canAccessRole(userRole, requiredRole)) {
      if (typeof Toast !== 'undefined') {
        Toast.error('You do not have permission to access this page.');
      }
      redirectToDashboard(userRole);
      return null;
    }

    hydrateUserIdentity(profile);

    // Hide nav items the user has no permission for
    if (profile.role === 'admin') {
      const perms = (cached && cached.permissions !== undefined) ? cached.permissions : await getAdminPermissions();
      applyNavPermissions(perms);
    }

    requestAnimationFrame(() => {
      document.body.style.opacity = '1';
    });

    if (cached) revalidateGuardCache(cached);

    // WhatsApp prompt — show on first visit after login if not yet set
    if ((profile.role === 'admin' || profile.role === 'super_admin') && !profile.whatsapp) {
      const snooze = localStorage.getItem('blb_wa_snoozed');
      const snoozed = snooze && (Date.now() - parseInt(snooze) < 24 * 60 * 60 * 1000);
      if (!snoozed) {
        setTimeout(() => showWhatsAppPrompt(profile, (val) => {
          profile.whatsapp = val;
        }), 1000);
      }
    }

    return profile;
  } catch (e) {
    console.error('initPageGuard error:', e);
    window.location.href = getAbsolutePath('/public/login.html');
    return null;
  }
}

/**
 * Fill common user placeholders if present in page
 * Supports:
 * [data-user-name]
 * [data-user-role]
 */
function hydrateUserIdentity(profile) {
  try {
    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = profile.full_name || profile.email || 'User';
    });

    document.querySelectorAll('[data-user-role]').forEach(el => {
      const role = profile.role || 'member';
      el.textContent = prettyRole(role);
    });
  } catch (e) {
    console.error('hydrateUserIdentity error:', e);
  }
}

function prettyRole(role) {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'admin': return 'Administrator';
    case 'member': return 'Member';
    default:
      return String(role || 'User')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, ch => ch.toUpperCase());
  }
}

/**
 * Hide nav links tagged with data-perm="<key>" when user lacks that permission.
 * Called automatically by initPageGuard() for admin-role users.
 * @param {Object|null} perms
 */
function applyNavPermissions(perms) {
  document.querySelectorAll('[data-perm]').forEach(el => {
    const key = el.dataset.perm;
    if (!hasPermission(perms, key)) {
      el.style.display = 'none';
    }
  });
}

/**
 * Optional page-level permission enforcement
 * Example:
 * await requireModulePermission('can_manage_members');
 *
 * @param {string} permissionKey
 * @returns {Promise<boolean>}
 */
async function requireModulePermission(permissionKey) {
  try {
    const perms = await getAdminPermissions();

    if (!perms) {
      if (typeof Toast !== 'undefined') {
        Toast.error('Permission record not found.');
      }
      const role = await getUserRole();
      redirectToDashboard(role || 'member');
      return false;
    }

    if (!hasPermission(perms, permissionKey)) {
      if (typeof Toast !== 'undefined') {
        Toast.error('You are not allowed to access this section.');
      }
      const role = await getUserRole();
      redirectToDashboard(role || 'member');
      return false;
    }

    return true;
  } catch (e) {
    console.error('requireModulePermission error:', e);
    return false;
  }
}

/**
 * Optional helper:
 * applies department filter if needed
 *
 * usage:
 * let query = supabase.from('profiles').select('*');
 * query = await applyDepartmentScope(query);
 *
 * @param {any} query
 * @param {string} [columnName='department_id']
 * @returns {Promise<any>}
 */
async function applyDepartmentScope(query, columnName = 'department_id') {
  const perms = await getAdminPermissions();
  if (isScopedToDepartment(perms)) {
    return query.eq(columnName, perms.department_id);
  }
  return query;
}

/**
 * Auto-bind logout buttons:
 * any element with [data-action="logout"]
 */
document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action="logout"]');
  if (!trigger) return;

  event.preventDefault();
  await logoutUser();
});

/**
 * Keep cache fresh on auth changes
 */
supabase.auth.onAuthStateChange((event) => {
  // This also fires on every page load (INITIAL_SESSION) and on token
  // refreshes — those don't change who is signed in, so keep the caches.
  if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
  const userChanged = event === 'SIGNED_OUT' || event === 'USER_UPDATED';
  clearProfileCache?.({ persisted: userChanged });
});

/**
 * Expose globally
 */
window.registerUser = registerUser;
window.loginUser = loginUser;
window.logoutUser = logoutUser;
window.handleLogin = handleLogin;
window.handleRegistration = handleRegistration;
window.redirectIfLoggedIn = redirectIfLoggedIn;
window.redirectToDashboard = redirectToDashboard;
window.initPageGuard = initPageGuard;
window.applyNavPermissions = applyNavPermissions;
window.requireModulePermission = requireModulePermission;
window.applyDepartmentScope = applyDepartmentScope;
window.canAccessRole = canAccessRole;
window.prettyRole = prettyRole;
window.hydrateUserIdentity = hydrateUserIdentity;

// ── WhatsApp Prompt ───────────────────────────────────────────────────────────
// Called from profile pages when admin hasn't set their WhatsApp number yet.
async function showWhatsAppPrompt(profile, onSaved) {
  if (!document.getElementById('blb-wa-css')) {
    const s = document.createElement('style');
    s.id = 'blb-wa-css';
    s.textContent = `
      #blb-wa-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.72);
        backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;padding:1rem;
        opacity:0;transition:opacity 0.35s ease;}
      #blb-wa-overlay.blb-wa-show{opacity:1;}
      #blb-wa-modal{background:linear-gradient(135deg,#0a1628 0%,#0d1f3c 50%,#0a1628 100%);
        border:1px solid rgba(255,255,255,0.06);border-radius:0.875rem;
        box-shadow:0 20px 60px rgba(0,0,0,0.55);width:100%;max-width:440px;
        position:relative;overflow:hidden;
        transform:scale(0.93) translateY(14px);
        transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);}
      #blb-wa-overlay.blb-wa-show #blb-wa-modal{transform:scale(1) translateY(0);}
      #blb-wa-modal::before{content:'';position:absolute;top:0;left:0;right:0;height:1.5px;
        background:linear-gradient(90deg,transparent,#fed01b 30%,#fed01b 70%,transparent);}
      #blb-wa-modal::after{content:'';position:absolute;top:-70px;left:50%;
        transform:translateX(-50%);width:220px;height:150px;pointer-events:none;
        background:radial-gradient(ellipse,rgba(254,208,27,0.07) 0%,transparent 70%);}
      #blb-wa-card{padding:1.75rem 1.75rem 1.5rem;position:relative;z-index:1;}
      .blb-wa-badge{display:inline-flex;align-items:center;gap:0.45rem;padding:0.28rem 0.7rem;
        border-radius:9999px;background:rgba(37,211,102,0.12);margin-bottom:1.2rem;}
      .blb-wa-badge-dot{width:6px;height:6px;border-radius:50%;background:#25d166;
        animation:blbWaPulse 1.8s ease-in-out infinite;}
      @keyframes blbWaPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(0.7)}}
      .blb-wa-badge-txt{font-family:'Plus Jakarta Sans',sans-serif;font-size:0.6rem;
        font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:rgba(37,211,102,0.9);}
      .blb-wa-label-row{display:flex;align-items:center;gap:0.7rem;margin-bottom:0.7rem;}
      .blb-wa-label-line{flex-shrink:0;height:1px;width:1.75rem;background:rgba(254,208,27,0.5);}
      .blb-wa-label-txt{font-family:'Plus Jakarta Sans',sans-serif;font-size:0.6rem;
        font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:rgba(254,208,27,0.8);}
      #blb-wa-title{font-family:'Inter',sans-serif;font-size:1.45rem;font-weight:900;
        letter-spacing:-0.03em;color:#fff;line-height:1.15;margin:0 0 0.6rem;}
      #blb-wa-desc{font-family:'Plus Jakarta Sans',sans-serif;font-size:0.875rem;font-weight:500;
        color:rgba(220,225,255,0.62);line-height:1.7;margin:0 0 1.25rem;}
      .blb-wa-input-wrap{position:relative;margin-bottom:0.5rem;}
      .blb-wa-input-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);
        color:rgba(255,255,255,0.3);font-size:18px;pointer-events:none;}
      #blb-wa-input{width:100%;background:rgba(255,255,255,0.06);
        border:1.5px solid rgba(255,255,255,0.1);border-radius:0.625rem;
        padding:0.72rem 0.875rem 0.72rem 2.4rem;font-family:'Plus Jakarta Sans',sans-serif;
        font-size:0.9rem;color:#fff;outline:none;
        transition:border-color 0.2s,background 0.2s;box-sizing:border-box;}
      #blb-wa-input::placeholder{color:rgba(255,255,255,0.28);}
      #blb-wa-input:focus{border-color:rgba(37,211,102,0.45);background:rgba(255,255,255,0.08);}
      #blb-wa-error{font-family:'Plus Jakarta Sans',sans-serif;font-size:0.77rem;
        color:#f87171;margin:0.35rem 0 0.75rem;display:none;}
      #blb-wa-error.show{display:block;}
      #blb-wa-save{width:100%;padding:0.72rem;background:#25d166;border:none;
        border-radius:0.625rem;font-family:'Plus Jakarta Sans',sans-serif;
        font-size:0.875rem;font-weight:700;color:#fff;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:6px;
        transition:background 0.15s,transform 0.1s;}
      #blb-wa-save:hover{background:#1fba5a;}
      #blb-wa-save:active{transform:scale(0.98);}
      #blb-wa-save:disabled{background:#374151;cursor:not-allowed;}
      #blb-wa-later{display:block;width:100%;background:none;border:none;
        font-family:'Plus Jakarta Sans',sans-serif;font-size:0.78rem;
        color:rgba(255,255,255,0.28);cursor:pointer;padding:0.6rem;
        text-align:center;transition:color 0.15s;margin-top:0.5rem;}
      #blb-wa-later:hover{color:rgba(255,255,255,0.5);}
      #blb-wa-footer{padding:0.8rem 1.75rem;border-top:1px solid rgba(255,255,255,0.05);
        text-align:center;font-family:'Plus Jakarta Sans',sans-serif;
        font-size:0.68rem;color:rgba(255,255,255,0.18);}
    `;
    document.head.appendChild(s);
  }

  const overlay = document.createElement('div');
  overlay.id = 'blb-wa-overlay';
  overlay.innerHTML = `
    <div id="blb-wa-modal">
      <div id="blb-wa-card">
        <div class="blb-wa-badge">
          <span class="blb-wa-badge-dot"></span>
          <span class="blb-wa-badge-txt">Hatua Muhimu</span>
        </div>
        <div class="blb-wa-label-row">
          <span class="blb-wa-label-line"></span>
          <span class="blb-wa-label-txt">Kanisa Hub Admin</span>
          <span class="blb-wa-label-line"></span>
        </div>
        <h2 id="blb-wa-title">Weka Namba Yako ya WhatsApp</h2>
        <p id="blb-wa-desc">Waumini wanaweza kukuwasiliana nawe moja kwa moja kupitia WhatsApp wakihitaji msaada. Namba hii itaonekana kwa waumini walioingia tu.</p>
        <div class="blb-wa-input-wrap">
          <span class="blb-wa-input-icon material-symbols-outlined">phone_iphone</span>
          <input id="blb-wa-input" type="tel" placeholder="+255 7XX XXX XXX" maxlength="20" autocomplete="tel"/>
        </div>
        <p id="blb-wa-error"></p>
        <button id="blb-wa-save">Hifadhi Namba</button>
        <button id="blb-wa-later">Sasa hivi si huru</button>
      </div>
      <div id="blb-wa-footer">Unaweza kubadilisha namba yako wakati wowote hapa kwenye Profile.</div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('blb-wa-show'), 60);

  function closePrompt() {
    overlay.classList.remove('blb-wa-show');
    setTimeout(() => overlay.remove(), 400);
  }

  document.getElementById('blb-wa-save').addEventListener('click', async () => {
    const input   = document.getElementById('blb-wa-input');
    const errorEl = document.getElementById('blb-wa-error');
    const saveBtn = document.getElementById('blb-wa-save');
    const val     = input.value.trim();
    errorEl.classList.remove('show');
    if (!val || val.replace(/\D/g, '').length < 9) {
      errorEl.textContent = 'Tafadhali weka namba sahihi (angalau tarakimu 9).';
      errorEl.classList.add('show');
      input.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Inahifadhi...';
    const { error } = await supabase
      .from('profiles')
      .update({ whatsapp: val })
      .eq('id', profile.id);
    if (error) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Hifadhi Namba';
      errorEl.textContent = 'Imeshindwa kuhifadhi. Tafadhali jaribu tena.';
      errorEl.classList.add('show');
      return;
    }
    closePrompt();
    if (typeof Toast !== 'undefined') Toast.success('Namba ya WhatsApp imehifadhiwa! 🎉');
    if (typeof onSaved === 'function') onSaved(val);
  });

  document.getElementById('blb-wa-later').addEventListener('click', () => {
    localStorage.setItem('blb_wa_snoozed', Date.now().toString());
    closePrompt();
  });
}
window.showWhatsAppPrompt = showWhatsAppPrompt;

