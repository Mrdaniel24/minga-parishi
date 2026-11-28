/* Parish / kigango / jumuiya chat. Database RLS decides which rooms and
   messages the signed-in account may read or send. */
(function () {
  const P = window.Parish, V = P.views;
  const roomIcon = type => ({ parish: 'church', kigango: 'account_tree', jumuiya: 'groups' }[type] || 'forum');
  const roomLabel = type => ({ parish: 'Parokia nzima', kigango: 'Mazungumzo ya kigango', jumuiya: 'Mazungumzo ya jumuiya' }[type] || 'Mazungumzo');
  const chatError = error => {
    const message = error?.message || String(error);
    if (/chat_(rooms|messages)/i.test(message) && /(does not exist|schema cache|PGRST205|42P01)/i.test(message)) {
      return 'Chat bado haijawezeshwa kwenye database. Msimamizi aendeshe database/patches/2026-11-27_parish_chat.sql kwenye Supabase SQL Editor.';
    }
    return P.friendlyError(error);
  };
  const roomContext = room => {
    const unit = room.org_unit_id ? P.ref.unitsById[room.org_unit_id] : null;
    const parent = unit?.parent_id ? P.ref.unitsById[unit.parent_id] : null;
    if (room.scope_type === 'jumuiya' && parent) return `Jumuiya · Kigango cha ${parent.name}`;
    if (room.scope_type === 'kigango') return `Kigango · ${P.ref.parish.short_name || P.ref.parish.official_name || 'Parokia'}`;
    return roomLabel(room.scope_type);
  };
  let activeChannel = null;
  const removeActiveChannel = () => {
    if (activeChannel) supabase.removeChannel(activeChannel);
    activeChannel = null;
  };
  window.addEventListener('hashchange', () => {
    if (!/^#\/chat(?:\?|$)/.test(location.hash)) removeActiveChannel();
  });

  V.chat = {
    title: 'Chat',
    async render(box) {
      removeActiveChannel();
      box.innerHTML = `<section class="chat-page">
        <header class="chat-page__intro"><div><span class="chat-eyebrow">Mawasiliano ya parokia</span><h2>Chat za Parokia</h2><p>Chagua eneo lako; mazungumzo yanafuata muundo wa Parokia.</p></div><span class="chat-lock"><span class="material-symbols-outlined">verified_user</span> Kila eneo lina mazungumzo yake</span></header>
        <div class="chat-layout"><aside class="chat-rooms" aria-label="Vyumba vya mazungumzo"><div class="chat-rooms__heading"><b>MAZUNGUMZO</b><span data-room-count>…</span></div><div data-room-list class="chat-rooms__list"><div class="chat-state">Inatafuta mazungumzo…</div></div></aside>
          <section class="chat-conversation"><div class="chat-conversation__head" data-chat-head><span class="material-symbols-outlined">forum</span><div><b>Chagua mazungumzo</b><small>Ujumbe wa eneo ulilochagua utaonekana hapa.</small></div><span class="chat-connection" data-chat-connection aria-live="polite">Chagua eneo</span></div>
            <div class="chat-messages" data-chat-messages aria-live="polite"><div class="chat-empty"><span class="material-symbols-outlined">forum</span><b>Karibu kwenye Chat</b><span>Chagua Parokia, Kigango au Jumuiya kuanza.</span></div></div>
            <form class="chat-compose-form" data-chat-form><label class="sr-only" for="chat-message-input">Ujumbe</label><textarea id="chat-message-input" name="body" rows="1" maxlength="2000" placeholder="Andika ujumbe…" disabled required></textarea><button type="submit" aria-label="Tuma ujumbe" disabled><span class="material-symbols-outlined">send</span></button></form>
            <p class="chat-footnote">Ujumbe wa Kigango huonekana kwa Kigango na Jumuiya zake; wa Jumuiya hubaki kwa Jumuiya hiyo.</p>
          </section>
        </div>
      </section>`;

      const list = box.querySelector('[data-room-list]'), count = box.querySelector('[data-room-count]');
      const head = box.querySelector('[data-chat-head]'), messages = box.querySelector('[data-chat-messages]');
      const connection = box.querySelector('[data-chat-connection]');
      const form = box.querySelector('[data-chat-form]'), input = form.elements.body, submit = form.querySelector('button');
      let rooms = [], selected = null, loadingSeq = 0;
      const fmtTime = value => new Date(value).toLocaleString('sw-TZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const scrollBottom = () => { messages.scrollTop = messages.scrollHeight; };
      const roomButton = room => `<button class="chat-room" type="button" data-room-id="${P.esc(room.id)}" aria-label="Fungua ${P.esc(room.title)}"><span class="chat-room__icon material-symbols-outlined">${roomIcon(room.scope_type)}</span><span class="chat-room__copy"><b>${P.esc(room.title)}</b><small>${roomLabel(room.scope_type)}</small></span><span class="material-symbols-outlined chat-room__arrow">chevron_right</span></button>`;
      const renderRoomTree = () => {
        const parishRooms = rooms.filter(room => room.scope_type === 'parish');
        const unitRooms = rooms.filter(room => room.scope_type !== 'parish');
        const groups = new Map();
        unitRooms.forEach(room => {
          const unit = P.ref.unitsById[room.org_unit_id];
          const parentId = room.scope_type === 'kigango' ? room.org_unit_id : unit?.parent_id;
          const parent = parentId ? P.ref.unitsById[parentId] : null;
          const key = parent?.id || `other-${room.id}`;
          if (!groups.has(key)) groups.set(key, { id: parent?.id || '', name: parent ? `Kigango cha ${parent.name}` : 'Jumuiya', kigango: null, children: [] });
          const group = groups.get(key);
          if (room.scope_type === 'kigango') group.kigango = room;
          else group.children.push(room);
        });
        const groupList = [...groups.values()].sort((a, b) => P.unitOrder(a.id) - P.unitOrder(b.id) || a.name.localeCompare(b.name, 'sw'));
        groupList.forEach(group => group.children.sort((a, b) => a.title.localeCompare(b.title, 'sw')));
        return `${parishRooms.length ? `<section class="chat-room-section"><p>PAROKIA</p>${parishRooms.map(roomButton).join('')}</section>` : ''}${groupList.map((group, index) => {
          const roomsInGroup = [...(group.kigango ? [group.kigango] : []), ...group.children];
          const open = groupList.length === 1 || index === 0;
          return `<details class="chat-branch" ${open ? 'open' : ''}><summary><span class="material-symbols-outlined">account_tree</span><b>${P.esc(group.name)}</b><small>${roomsInGroup.length} ${roomsInGroup.length === 1 ? 'chumba' : 'vyumba'}</small></summary><div class="chat-branch__rooms">${group.kigango ? roomButton(group.kigango) : ''}${group.children.map(roomButton).join('')}</div></details>`;
        }).join('')}`;
      };
      const renderMessages = rows => {
        if (!rows.length) {
          messages.innerHTML = `<div class="chat-empty"><span class="material-symbols-outlined">waving_hand</span><b>Hakuna ujumbe bado</b><span>Anza mazungumzo katika ${P.esc(selected.title)}.</span></div>`;
          return;
        }
        messages.innerHTML = rows.map(m => `<article class="chat-message${m.sender_id === P.profile.id ? ' chat-message--mine' : ''}"><b>${P.esc(m.sender_name || 'Muumini')}</b><p>${P.esc(m.body).replace(/\n/g, '<br>')}</p><time>${P.esc(fmtTime(m.created_at))}</time></article>`).join('');
        scrollBottom();
      };
      const loadMessages = async () => {
        if (!selected) return;
        const roomId = selected.id, seq = ++loadingSeq;
        // Fetch the newest page, then restore chronological order for display.
        const rows = await P.q(P.from('chat_messages').select('id,room_id,sender_id,sender_name,body,created_at').eq('room_id', roomId).order('created_at', { ascending: false }).limit(100));
        if (seq === loadingSeq && selected?.id === roomId) renderMessages(rows.reverse());
      };
      const setConnection = (state, text) => {
        connection.dataset.state = state;
        connection.textContent = text;
      };
      const chooseRoom = async room => {
        if (!room) return;
        removeActiveChannel();
        selected = room;
        loadingSeq++;
        list.querySelectorAll('[data-room-id]').forEach(el => el.classList.toggle('is-active', el.dataset.roomId === room.id));
        [...list.querySelectorAll('[data-room-id]')].find(el => el.dataset.roomId === room.id)?.closest('.chat-branch')?.setAttribute('open', '');
        head.querySelector('.material-symbols-outlined').textContent = roomIcon(room.scope_type);
        head.querySelector('div').innerHTML = `<b>${P.esc(room.title)}</b><small>${P.esc(roomContext(room))}</small>`;
        input.disabled = false; submit.disabled = false;
        setConnection('connecting', 'Inaunganisha…');
        messages.innerHTML = '<div class="chat-state">Inapakia ujumbe…</div>';
        const roomId = room.id;
        activeChannel = supabase.channel(`parish-chat-${roomId}-${P.uuid()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, payload => {
            if (payload.new.room_id === selected?.id) loadMessages().catch(() => {});
          }).subscribe(status => {
            if (selected?.id !== roomId) return;
            if (status === 'SUBSCRIBED') setConnection('online', 'Imeunganishwa');
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('offline', 'Muunganisho umekatika');
          });
        try { await loadMessages(); }
        catch (e) {
          if (selected?.id !== roomId) return;
          messages.innerHTML = `<div class="chat-alert">${P.esc(chatError(e))}</div>`;
          setConnection('offline', 'Haijaunganishwa');
        }
      };
      try {
        rooms = await P.q(P.from('chat_rooms').select('id,parish_id,org_unit_id,scope_type,title').order('scope_type').order('title'));
        count.textContent = String(rooms.length);
        if (!rooms.length) { list.innerHTML = '<div class="chat-state">Hakuna chumba cha mazungumzo kilichoruhusiwa kwa akaunti hii.</div>'; return; }
        const order = { parish: 0, kigango: 1, jumuiya: 2 };
        rooms.sort((a, b) => (order[a.scope_type] - order[b.scope_type]) || a.title.localeCompare(b.title, 'sw'));
        list.innerHTML = renderRoomTree();
        list.querySelectorAll('[data-room-id]').forEach(el => el.addEventListener('click', () => chooseRoom(rooms.find(room => room.id === el.dataset.roomId))));
        const preferred = rooms.find(room => room.scope_type === 'jumuiya') || rooms.find(room => room.scope_type === 'parish') || rooms[0];
        if (preferred) chooseRoom(preferred);
      } catch (e) { list.innerHTML = `<div class="chat-alert">${P.esc(chatError(e))}</div>`; }

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const body = input.value.trim();
        if (!selected || !body || submit.disabled) return;
        const roomId = selected.id;
        submit.disabled = true;
        try {
          // Sender identity and audience scope are assigned by the database trigger.
          const { error } = await supabase.from('chat_messages').insert({ room_id: roomId, body });
          if (error) throw error;
          if (selected?.id === roomId) { input.value = ''; input.style.height = ''; await loadMessages(); }
        } catch (e) {
          if (selected?.id === roomId) { const note = document.createElement('div'); note.className = 'chat-alert chat-alert--inline'; note.textContent = chatError(e); messages.append(note); scrollBottom(); }
        } finally { submit.disabled = !selected; input.focus(); }
      });
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; });
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
    }
  };
})();
