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
          <label>Picha ya wasifu<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label>
          <label>Nenosiri jipya<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Acha wazi bila kubadilisha"></label>
          <label>Thibitisha nenosiri<input name="password_confirm" type="password" minlength="8" autocomplete="new-password"></label>
          <div class="pm-span2"><button class="pm-btn pm-btn--primary">Hifadhi wasifu</button></div>
        </form></section>`;
      el.querySelector('[data-profile]').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.currentTarget, d = new FormData(f), name = String(d.get('full_name') || '').trim();
        const phone = String(d.get('phone') || '').trim();
        const password = String(d.get('password') || ''), confirm = String(d.get('password_confirm') || '');
        if (password && password !== confirm) { Toast.error('Nenosiri halijathibitishwa.'); return; }
        if (password && password.length < 8) { Toast.error('Nenosiri liwe na angalau herufi 8.'); return; }
        await P.busy(f.querySelector('button'), async () => {
          const updates = { full_name: name, phone: phone || null };
          const file = d.get('avatar');
          if (file && file.size) {
            if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Chagua picha ya JPG, PNG au WebP isiyozidi MB 3.');
            const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type];
            const path = `${p.id}/avatar.${ext}`;
            const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
            if (error) throw new Error(P.friendlyError(error));
            updates.avatar_url = path;
          }
          const authUpdates = { data: { full_name: name, phone: phone || null } };
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
