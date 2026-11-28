/* Minga Parish — AI assistant. The API gathers data with the signed-in JWT. */
(function () {
  const P = window.Parish, V = P.views;
  const monthOptions = () => `<option value="">Mwaka mzima</option>${P.MONTHS.map((name, i) => `<option value="${i + 1}">${name}</option>`).join('')}`;
  V.assistant = {
    title: 'Msaidizi wa AI',
    feature: 'ai_quick_ask',
    async render(el) {
      const canSearch = P.can('finance.read') && P.can('registry.read');
      const canSearchFamily = P.memberPortalMode && !!P.memberContext?.is_representative;
      const showSubject = canSearch || canSearchFamily;
      const canFinance = P.can('finance.read');
      const hasMember = !!P.access.parishioner_id;
      const year = P.year(), month = new Date().getMonth() + 1;
      const roleLabel = P.memberPortalMode ? 'Taarifa zako na za familia yako zilizoidhinishwa' : 'Ripoti za eneo unaloruhusiwa kuona';
      const prompts = [
        ...(canFinance ? [['Ripoti ya mwaka mzima', 'Nipe muhtasari wa mapato na matumizi ya mwaka huu.', 'year'], ['Makusanyo ya mwezi huu', 'Makusanyo ya mwezi huu yakoje?', 'month']] : []),
        ...(P.memberPortalMode && hasMember ? [['Taarifa zangu', 'Nipe muhtasari wa michango yangu kwa kipindi hiki.', 'self']] : []),
        ...(canSearchFamily ? [['Zaka ya familia', 'Nipe muhtasari wa Zaka ya familia yangu kwa kipindi hiki.', 'self']] : []),
      ];
      el.innerHTML = `<div class="ai-assistant">
        <header class="ai-assistant__intro"><span class="ai-assistant__icon material-symbols-outlined">auto_awesome</span><div><p class="pm-eyebrow">ULIZA KWA KISWAHILI</p><h1 class="pm-h1">Msaidizi wa AI</h1><p class="pm-muted">Uliza kuhusu ripoti, zaka, michango na taarifa zako. ${P.esc(roleLabel)}.</p></div></header>
        <section class="ai-assistant__workspace" aria-label="Mazungumzo na Msaidizi wa AI">
          <div class="ai-assistant__filters">
            <label>Mwaka<select data-ai-year>${Array.from({ length: 6 }, (_, i) => year - i).map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
            <label>Mwezi<select data-ai-month>${monthOptions()}</select></label>
            <details class="ai-assistant__dates"><summary>Kipindi maalum</summary><div><label>Kuanzia<input type="date" data-ai-from></label><label>Mpaka<input type="date" data-ai-to></label></div></details>
            ${showSubject ? `<label class="ai-assistant__subject-type">Taarifa ya<select data-ai-subject-type>${canSearch ? '<option value="person">Muumini</option><option value="family">Familia</option>' : '<option value="person">Mwanachama wa familia</option>'}</select></label><label class="ai-assistant__subject">Jina (hiari)<input type="search" data-ai-subject maxlength="100" placeholder="Mfano: Daniel Matope"></label>` : ''}
          </div>
          <div class="ai-assistant__suggestions">${prompts.map(([label, text, type]) => `<button class="ai-assistant__suggestion" type="button" data-ai-prompt="${P.esc(text)}" data-ai-preset="${type}">${P.esc(label)}</button>`).join('')}</div>
          <div class="ai-assistant__messages" data-ai-messages aria-live="polite"><div class="ai-assistant__welcome"><span class="material-symbols-outlined">chat_spark</span><b>Karibu, uliza swali lako</b><p>Majibu yanategemea taarifa zilizopo na ruhusa za akaunti yako.</p></div></div>
          <form class="ai-assistant__form" data-ai-form><label class="sr-only" for="ai-assistant-question">Swali lako</label><textarea id="ai-assistant-question" name="question" rows="2" maxlength="600" placeholder="Mfano: Makusanyo ya mwezi huu yakoje?" required></textarea><button class="pm-btn pm-btn--primary" type="submit"><span class="material-symbols-outlined">send</span><span>Uliza</span></button></form>
          <p class="ai-assistant__privacy"><span class="material-symbols-outlined">verified_user</span> Mfumo huchuja data kwa ruhusa zako na hutuma muhtasari unaohitajika kwa Cloudflare AI. Mazungumzo hayahifadhiwi kwenye database ya parokia; namba za simu hazitumwi.</p>
        </section>
      </div>`;

      const form = el.querySelector('[data-ai-form]'), input = form.elements.question, feed = el.querySelector('[data-ai-messages]');
      const history = [];
      let busy = false;
      const bubble = (role, text) => {
        const empty = feed.querySelector('.ai-assistant__welcome'); empty?.remove();
        const node = document.createElement('article');
        node.className = `ai-assistant__bubble ai-assistant__bubble--${role}`;
        node.innerHTML = `<span>${role === 'user' ? 'Wewe' : 'Msaidizi wa AI'}</span><p>${P.esc(text).replace(/\n/g, '<br>')}</p>`;
        feed.appendChild(node); feed.scrollTop = feed.scrollHeight;
        return node;
      };
      const ask = async text => {
        if (busy || !text.trim()) return;
        const from = el.querySelector('[data-ai-from]')?.value || '';
        const to = el.querySelector('[data-ai-to]')?.value || '';
        if (!!from !== !!to) { Toast.info('Jaza tarehe zote mbili za kipindi.'); return; }
        if (from && to && from > to) { Toast.info('Tarehe ya kuanzia iwe kabla ya tarehe ya mwisho.'); return; }
        busy = true; input.disabled = true;
        bubble('user', text.trim());
        const waiting = bubble('assistant', 'Natafuta taarifa zinazoruhusiwa…'); waiting.classList.add('is-pending');
        try {
          const { data: { session } = {} } = await supabase.auth.getSession();
          if (!session?.access_token) throw new Error('Ingia tena ili kutumia msaidizi.');
          const payload = {
            question: text.trim(), subject: el.querySelector('[data-ai-subject]')?.value || '',
            subjectType: el.querySelector('[data-ai-subject-type]')?.value || 'person',
            audience: P.memberPortalMode ? 'member' : 'staff',
            year: Number(el.querySelector('[data-ai-year]').value),
            month: el.querySelector('[data-ai-month]').value,
            from, to, history: history.slice(-6),
          };
          const response = await fetch('/api/ai-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Imeshindikana kupata jibu.');
          waiting.classList.remove('is-pending');
          waiting.querySelector('p').innerHTML = P.esc(result.answer).replace(/\n/g, '<br>');
          history.push({ role: 'user', content: text.trim().slice(0, 1000) }, { role: 'assistant', content: result.answer.slice(0, 1000) });
        } catch (error) {
          waiting.remove(); bubble('assistant', error.message || 'Msaidizi hajapatikana kwa sasa.');
        } finally {
          busy = false; input.disabled = false; input.value = ''; input.focus(); feed.scrollTop = feed.scrollHeight;
        }
      };
      form.addEventListener('submit', event => { event.preventDefault(); ask(input.value); });
      el.querySelectorAll('[data-ai-prompt]').forEach(button => button.addEventListener('click', () => {
        if (button.dataset.aiPreset === 'year') el.querySelector('[data-ai-month]').value = '';
        if (button.dataset.aiPreset === 'month') el.querySelector('[data-ai-month]').value = String(month);
        if (button.dataset.aiPreset === 'self') { const subject = el.querySelector('[data-ai-subject]'); if (subject) subject.value = ''; }
        input.value = button.dataset.aiPrompt; ask(input.value);
      }));
    },
  };
})();
