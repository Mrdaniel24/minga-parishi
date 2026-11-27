/* Parish / kigango / jumuiya chat. Database RLS decides which rooms and
   messages the signed-in account may read or send. */
(function () {
  const P = window.Parish, V = P.views;
  const roomIcon = type => ({ parish: 'church', kigango: 'account_tree', jumuiya: 'groups' }[type] || 'forum');
  const roomLabel = type => ({ parish: 'Parokia', kigango: 'Vigango', jumuiya: 'Jumuiya' }[type] || 'Eneo');
  let activeChannel = null;
  window.addEventListener('hashchange', () => {
    if (!/^#\/chat(?:\?|$)/.test(location.hash) && activeChannel) {
      supabase.removeChannel(activeChannel);
      activeChannel = null;
    }
  });

  V.chat = {
    title: 'Chat',
    async render(box) {
      if (activeChannel) { supabase.removeChannel(activeChannel); activeChannel = null; }
      box.innerHTML = `<section class="chat-page">
        <header class="chat-page__intro"><div><span class="chat-eyebrow">Mawasiliano ya parokia</span><h2>Chat za Parokia</h2><p>Chagua eneo uone ujumbe unaokuhusu.</p></div><span class="chat-lock"><span class="material-symbols-outlined">verified_user</span> Ruhusa za eneo zinalindwa</span></header>
        <div class="chat-layout"><aside class="chat-rooms" aria-label="Vyumba vya mazungumzo"><div class="chat-rooms__heading"><b>MAZUNGUMZO</b><span data-room-count>…</span></div><div data-room-list class="chat-rooms__list"><div class="chat-state">Inatafuta mazungumzo…</div></div></aside>
          <section class="chat-conversation"><div class="chat-conversation__head" data-chat-head><span class="material-symbols-outlined">forum</span><div><b>Chagua mazungumzo</b><small>Ujumbe wa eneo ulilochagua utaonekana hapa.</small></div></div>
            <div class="chat-messages" data-chat-messages aria-live="polite"><div class="chat-empty"><span class="material-symbols-outlined">forum</span><b>Karibu kwenye Chat</b><span>Chagua Parokia, Kigango au Jumuiya kuanza.</span></div></div>
            <form class="chat-compose-form" data-chat-form><label class="sr-only" for="chat-message-input">Ujumbe</label><textarea id="chat-message-input" name="body" rows="1" maxlength="2000" placeholder="Andika ujumbe…" disabled required></textarea><button type="submit" aria-label="Tuma ujumbe" disabled><span class="material-symbols-outlined">send</span></button></form>
            <p class="chat-footnote">Ujumbe unaonekana kwa watu wenye ruhusa katika eneo hili pekee.</p>
          </section>
        </div>
      </section>`;

      const list = box.querySelector('[data-room-list]'), count = box.querySelector('[data-room-count]');
      const head = box.querySelector('[data-chat-head]'), messages = box.querySelector('[data-chat-messages]');
      const form = box.querySelector('[data-chat-form]'), input = form.elements.body, submit = form.querySelector('button');
      let rooms = [], selected = null, loadingSeq = 0;
      const fmtTime = value => new Date(value).toLocaleString('sw-TZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const scrollBottom = () => { messages.scrollTop = messages.scrollHeight; };
      const renderMessages = rows => {
        if (!rows.length) {
          messages.innerHTML = `<div class="chat-empty"><span class="material-symbols-outlined">waving_hand</span><b>Hakuna ujumbe bado</b><span>Anza mazungumzo katika ${P.esc(selected.title)}.</span></div>`;
          return;
        }
        messages.innerHTML = rows.map(m => `<article class="chat-message${m.sender_id === P.profile.id ? ' chat-message--mine' : ''}"><b>${P.esc(m.sender_name || 'Muumini')}</b><p>${P.esc(m.body).replace(/\n/g, '<br>')}</p><time>${P.esc(fmtTime(m.created_at))}</time></article>`).join('');
        scrollBottom();
      };
      const loadMessages = async () => {
        const seq = ++loadingSeq;
        const rows = await P.q(P.from('chat_messages').select('id,room_id,sender_id,sender_name,body,created_at').eq('room_id', selected.id).order('created_at', { ascending: true }).limit(200));
        if (seq === loadingSeq) renderMessages(rows);
      };
      const chooseRoom = async room => {
        selected = room;
        list.querySelectorAll('[data-room-id]').forEach(el => el.classList.toggle('is-active', el.dataset.roomId === room.id));
        head.innerHTML = `<span class="material-symbols-outlined">${roomIcon(room.scope_type)}</span><div><b>${P.esc(room.title)}</b><small>${roomLabel(room.scope_type)} · ${room.scope_type === 'parish' ? 'Parokia nzima' : 'Ujumbe wa eneo husika'}</small></div>`;
        input.disabled = false; submit.disabled = false; input.focus();
        messages.innerHTML = '<div class="chat-state">Inapakia ujumbe…</div>';
        try { await loadMessages(); }
        catch (e) { messages.innerHTML = `<div class="chat-alert">${P.esc(P.friendlyError(e))}</div>`; }
        if (activeChannel) supabase.removeChannel(activeChannel);
        activeChannel = supabase.channel(`parish-chat-${room.id}-${P.uuid()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${room.id}` }, payload => {
            if (payload.new.room_id === selected?.id) loadMessages().catch(() => {});
          }).subscribe();
      };
      try {
        rooms = await P.q(P.from('chat_rooms').select('id,parish_id,org_unit_id,scope_type,title').order('scope_type').order('title'));
        count.textContent = String(rooms.length);
        if (!rooms.length) { list.innerHTML = '<div class="chat-state">Hakuna chumba cha mazungumzo kwa eneo la akaunti hii.</div>'; return; }
        const order = { parish: 0, kigango: 1, jumuiya: 2 };
        rooms.sort((a, b) => (order[a.scope_type] - order[b.scope_type]) || a.title.localeCompare(b.title, 'sw'));
        list.innerHTML = rooms.map(room => `<button class="chat-room" type="button" data-room-id="${P.esc(room.id)}"><span class="chat-room__icon material-symbols-outlined">${roomIcon(room.scope_type)}</span><span class="chat-room__copy"><b>${P.esc(room.title)}</b><small>${roomLabel(room.scope_type)}</small></span><span class="material-symbols-outlined chat-room__arrow">chevron_right</span></button>`).join('');
        list.querySelectorAll('[data-room-id]').forEach(el => el.addEventListener('click', () => chooseRoom(rooms.find(r => r.id === el.dataset.roomId))));
        const preferred = rooms.find(r => r.scope_type === 'jumuiya') || rooms.find(r => r.scope_type === 'parish') || rooms[0];
        if (preferred && window.matchMedia('(min-width: 760px)').matches) chooseRoom(preferred);
      } catch (e) { list.innerHTML = `<div class="chat-alert">${P.esc(P.friendlyError(e))}</div>`; }

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const body = input.value.trim();
        if (!selected || !body || submit.disabled) return;
        submit.disabled = true;
        try {
          const { error } = await supabase.from('chat_messages').insert({ room_id: selected.id, sender_id: P.profile.id, sender_name: P.profile.full_name || 'Muumini', body });
          if (error) throw error;
          input.value = '';
          await loadMessages();
        } catch (e) {
          const note = document.createElement('div'); note.className = 'chat-alert chat-alert--inline'; note.textContent = P.friendlyError(e); messages.append(note); scrollBottom();
        } finally { submit.disabled = !selected; input.focus(); }
      });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    }
  };
})();
