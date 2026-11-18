/* Minga Parish — personal account settings. */
(function () {
  const P = window.Parish, V = P.views;
  /* ================= WASIFU WA MTUMIAJI ================= */
  V.profile = {
    title: 'Wasifu Wangu',
    async render(el) {
      const p = P.profile;
      let photoUrl = '';
      if (p.avatar_url) {
        const { data } = await supabase.storage.from('avatars').createSignedUrl(p.avatar_url, 3600);
        photoUrl = data?.signedUrl || '';
      }
      const photo = photoUrl ? `<img class="pm-profile-photo" src="${P.esc(photoUrl)}" alt="Picha ya wasifu">` : `<span class="material-symbols-outlined">account_circle</span>`;
      el.innerHTML = `<div class="pm-head"><div><h1 class="pm-h1">Wasifu Wangu</h1><p class="pm-muted">Sasisha jina, simu, nenosiri na picha yako.</p></div></div>
        <section class="pm-card pm-pad"><div class="pm-profile-photo-wrap">${photo}</div>
        <form class="pm-form" data-profile>
          <label class="pm-span2">Jina kamili<input name="full_name" required maxlength="160" value="${P.esc(p.full_name || '')}"></label>
          <label>Simu<input name="phone" type="tel" autocomplete="tel" value="${P.esc(p.phone || '')}" placeholder="+255…"></label>
          <label data-phone-otp hidden>Namba mpya imetumwa msimbo<input name="phone_otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
          <label>Picha ya wasifu<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label>
          <label>Nenosiri jipya<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Acha wazi bila kubadilisha"></label>
          <label>Thibitisha nenosiri<input name="password_confirm" type="password" minlength="8" autocomplete="new-password"></label>
          <div class="pm-span2"><button class="pm-btn pm-btn--primary">Hifadhi wasifu</button></div>
        </form></section>`;
      let pendingPhone = '';
      el.querySelector('[data-profile]').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.currentTarget, d = new FormData(f), name = String(d.get('full_name') || '').trim();
        const phone = String(d.get('phone') || '').trim();
        const password = String(d.get('password') || ''), confirm = String(d.get('password_confirm') || '');
        if (password && password !== confirm) { Toast.error('Nenosiri halijathibitishwa.'); return; }
        if (password && password.length < 8) { Toast.error('Nenosiri liwe na angalau herufi 8.'); return; }
        await P.busy(f.querySelector('button'), async () => {
          const updates = { full_name: name };
          const digits = phone.replace(/\D/g, '');
          const normalizedPhone = /^0[67]\d{8}$/.test(digits) ? `+255${digits.slice(1)}` : /^[67]\d{8}$/.test(digits) ? `+255${digits}` : /^255[67]\d{8}$/.test(digits) ? `+${digits}` : phone ? null : '';
          if (phone && !normalizedPhone) throw new Error('Andika namba sahihi ya simu ya Tanzania.');
          const { data: { user } = {} } = await supabase.auth.getUser();
          const currentDigits = String(user?.phone || '').replace(/\D/g, '');
          if (!normalizedPhone && currentDigits) throw new Error('Thibitisha namba mpya kabla ya kubadilisha simu iliyounganishwa na akaunti.');
          if (normalizedPhone && normalizedPhone.replace(/\D/g, '') !== currentDigits) {
            if (pendingPhone !== normalizedPhone) {
              const { error } = await supabase.auth.updateUser({ phone: normalizedPhone });
              if (error) throw new Error(P.friendlyError(error));
              pendingPhone = normalizedPhone;
              f.querySelector('[data-phone-otp]').hidden = false;
              f.querySelector('[data-phone-otp] input').required = true;
              f.querySelector('button').textContent = 'Thibitisha simu na hifadhi wasifu';
              throw new Error('Tumetuma msimbo kwa namba mpya. Iweke hapo juu kisha bonyeza hifadhi tena.');
            }
            const token = String(d.get('phone_otp') || '').trim();
            if (!/^\d{6}$/.test(token)) throw new Error('Weka msimbo wa tarakimu 6 tuliotuma kwa simu mpya.');
            const { error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token, type: 'phone_change' });
            if (error) throw new Error(P.friendlyError(error));
            updates.phone = normalizedPhone.replace(/\D/g, '');
          } else if (!normalizedPhone) updates.phone = null;
          const file = d.get('avatar');
          if (file && file.size) {
            if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Chagua picha ya JPG, PNG au WebP isiyozidi MB 3.');
            const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type];
            const path = `${p.id}/avatar.${ext}`;
            const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
            if (error) throw new Error(P.friendlyError(error));
            updates.avatar_url = path;
          }
          const authUpdates = { data: { full_name: name } };
          if (password) authUpdates.password = password;
          const { error: authError } = await supabase.auth.updateUser(authUpdates);
          if (authError) throw new Error(P.friendlyError(authError));
          const { error } = await P.from('profiles').update(updates).eq('id', p.id);
          if (error) throw new Error(P.friendlyError(error));
          Object.assign(p, updates); PM.profile = p; PM.paintUser();
          Toast.success('Wasifu umehifadhiwa.'); await P.reload();
        });
      });
    },
  };


})();
