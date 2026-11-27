(() => {
  const root = document.querySelector('.showcase');
  if (!root) return;
  const landingHeader = document.querySelector('[data-landing-header]');
  const menuToggle = landingHeader?.querySelector('[data-menu-toggle]');
  if (landingHeader && menuToggle) {
    const setMenuOpen = open => {
      landingHeader.classList.toggle('is-menu-open', open);
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Funga menyu' : 'Fungua menyu');
    };
    menuToggle.addEventListener('click', () => setMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true'));
    landingHeader.querySelectorAll('.landing-nav a').forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenuOpen(false); });
    const updateHeader = () => landingHeader.classList.toggle('is-scrolled', window.scrollY > 20);
    window.addEventListener('scroll', updateHeader, { passive: true });
    updateHeader();
  }
  const slides = [...root.querySelectorAll('.slide')];
  const dots = [...root.querySelectorAll('[data-dot]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, timer = null, paused = false;
  const show = next => {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
    dots.forEach((dot, i) => { const on = i === index; dot.classList.toggle('active', on); dot.setAttribute('aria-pressed', String(on)); });
  };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const start = () => { stop(); if (!paused && !reduced.matches) timer = setInterval(() => show(index + 1), 5500); };
  root.querySelector('[data-prev]').addEventListener('click', () => { show(index - 1); start(); });
  root.querySelector('[data-next]').addEventListener('click', () => { show(index + 1); start(); });
  dots.forEach(dot => dot.addEventListener('click', () => { show(Number(dot.dataset.dot)); start(); }));
  root.addEventListener('mouseenter', () => { paused = true; stop(); });
  root.addEventListener('mouseleave', () => { paused = false; start(); });
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) start(); });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  reduced.addEventListener?.('change', start);
  start();

  const chatPreview = document.querySelector('#chat-preview');
  if (chatPreview) {
    const chatLevels = [
      {
        label: 'Ngazi ya Parokia', name: 'Parokia', icon: '✣',
        description: 'Taarifa na mijadala inayowahusu waumini wote wa parokia.', audience: 'Waumini wote wa parokia',
        title: 'Parokia ya Mt. Aloyce Gonzaga', subtitle: 'Minga · Parokia nzima', scope: 'Parokia',
        context: 'Ujumbe unaonekana kwa waumini wote wa parokia',
        message: 'Karibuni kwenye taarifa za parokia yetu.', sender: 'Katibu wa Parokia', time: '10:42',
        reply: 'Asante, nimepokea taarifa.', replyTime: '10:45'
      },
      {
        label: 'Ngazi ya Kigango', name: 'Kigango', icon: '⌘',
        description: 'Mawasiliano ya kigango yanayowafikia viongozi na jumuiya zake.', audience: 'Waumini wa kigango na jumuiya zake',
        title: 'Kigango cha Minga', subtitle: 'Parokia ya Minga', scope: 'Kigango',
        context: 'Ujumbe unafika kigangoni na jumuiya zake',
        message: 'Kikao cha kigango kitafanyika Jumapili baada ya misa.', sender: 'Katibu wa Kigango', time: '11:08',
        reply: 'Nimepokea, tutafika kwa wakati.', replyTime: '11:12'
      },
      {
        label: 'Ngazi ya Jumuiya', name: 'Jumuiya', icon: '◎',
        description: 'Taarifa za karibu zinazowahusu wanajumuiya wa eneo husika.', audience: 'Wanajumuiya husika',
        title: 'Jumuiya ya Mt. Yosefu', subtitle: 'Kigango cha Minga · Minga', scope: 'Jumuiya',
        context: 'Ujumbe unaonekana ndani ya jumuiya hii',
        message: 'Tukutane kwa sala ya jumuiya Ijumaa saa 10 jioni.', sender: 'Katibu wa Jumuiya', time: '12:16',
        reply: 'Asante kwa taarifa, nitakuwepo.', replyTime: '12:20'
      }
    ];
    const story = document.querySelector('[data-chat-slide]');
    const progress = [...(story?.querySelectorAll('.chat-progress i') || [])];
    const setText = (selector, value) => {
      const node = chatPreview.querySelector(selector);
      if (node) node.textContent = value;
    };
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let chatIndex = 0;
    let chatTimer = null;
    let chatPaused = false;
    const showChatLevel = next => {
      chatIndex = (next + chatLevels.length) % chatLevels.length;
      const chat = chatLevels[chatIndex];
      chatPreview.classList.add('is-changing');
      story?.classList.add('is-changing');
      window.setTimeout(() => {
        if (story) {
          story.querySelector('[data-chat-level-label]').textContent = chat.label;
          story.querySelector('[data-chat-level-title]').textContent = chat.name;
          story.querySelector('[data-chat-slide-icon]').textContent = chat.icon;
          story.querySelector('[data-chat-level-description]').textContent = chat.description;
          story.querySelector('[data-chat-audience]').textContent = chat.audience;
          story.querySelector('[data-chat-step]').innerHTML = `${String(chatIndex + 1).padStart(2, '0')} <i>/ 03</i>`;
          progress.forEach((item, i) => item.classList.toggle('is-current', i === chatIndex));
        }
        setText('[data-chat-title]', chat.title);
        setText('[data-chat-subtitle]', chat.subtitle);
        setText('[data-chat-context]', chat.context);
        setText('[data-chat-scope]', chat.scope);
        setText('[data-chat-message]', chat.message);
        setText('[data-chat-sender]', chat.sender);
        setText('[data-chat-time]', chat.time);
        setText('[data-chat-reply]', chat.reply);
        setText('[data-chat-reply-time]', chat.replyTime);
        requestAnimationFrame(() => {
          chatPreview.classList.remove('is-changing');
          story?.classList.remove('is-changing');
        });
      }, 300);
    };
    const stopChatRotation = () => { if (chatTimer) clearInterval(chatTimer); chatTimer = null; };
    const startChatRotation = () => {
      stopChatRotation();
      if (!chatPaused && !document.hidden && !reducedMotion.matches) {
        chatTimer = setInterval(() => showChatLevel(chatIndex + 1), 6200);
      }
    };
    const chatStage = document.querySelector('.chat-visual');
    chatStage?.addEventListener('mouseenter', () => { chatPaused = true; stopChatRotation(); });
    chatStage?.addEventListener('mouseleave', () => { chatPaused = false; startChatRotation(); });
    chatStage?.addEventListener('focusin', stopChatRotation);
    chatStage?.addEventListener('focusout', event => {
      if (!chatStage.contains(event.relatedTarget)) startChatRotation();
    });
    document.addEventListener('visibilitychange', startChatRotation);
    reducedMotion.addEventListener?.('change', startChatRotation);
    startChatRotation();
  }

  const billingOptions = [...document.querySelectorAll('[data-billing]')];
  billingOptions.forEach(option => option.addEventListener('click', () => {
    const yearly = option.dataset.billing === 'yearly';
    billingOptions.forEach(item => {
      const active = item === option;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-monthly][data-yearly]').forEach(price => {
      price.classList.add('price-changing');
      window.setTimeout(() => {
        price.textContent = `TZS ${yearly ? price.dataset.yearly : price.dataset.monthly}`;
        price.classList.remove('price-changing');
      }, 120);
    });
    document.querySelectorAll('[data-period]').forEach(period => { period.textContent = yearly ? '/ mwaka' : '/ mwezi'; });
    document.querySelectorAll('[data-equivalent]').forEach(note => { note.hidden = !yearly; });
  }));

  const plans = [...document.querySelectorAll('.plan')];
  if ('IntersectionObserver' in window && !reduced.matches) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.15 });
    plans.forEach((plan, i) => {
      plan.style.setProperty('--plan-delay', `${i * 130}ms`);
      observer.observe(plan);
    });
  } else plans.forEach(plan => plan.classList.add('is-visible'));

  const motionTargets = [...document.querySelectorAll(
    '.site-header .brand, .site-header nav a, .site-header > .button, .hero-copy > *, .showcase, .section-heading > *, .feature, .chat-copy > *, .chat-copy li, .chat-visual, .billing-switch, .pricing-footnote, .closing > *, .site-footer > *'
  )];
  const headings = [...document.querySelectorAll('.hero h1, .section-heading h2, .chat-copy h2, .closing h2')];
  const animateWords = element => {
    const readable = element.textContent.replace(/\s+/g, ' ').trim();
    element.setAttribute('aria-label', readable);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const fragment = document.createDocumentFragment();
      (node.nodeValue.match(/\s+|[^\s]+/g) || []).forEach(part => {
        if (/^\s+$/.test(part)) fragment.append(document.createTextNode(part));
        else {
          const word = document.createElement('span');
          word.className = 'motion-word';
          word.style.setProperty('--word-delay', `${Math.min([...element.querySelectorAll('.motion-word')].length * 42, 420)}ms`);
          word.textContent = part;
          fragment.append(word);
        }
      });
      node.replaceWith(fragment);
    });
  };
  headings.forEach(animateWords);

  if ('IntersectionObserver' in window && !reduced.matches) {
    const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      }
    }), { threshold: 0.12, rootMargin: '0px 0px -28px 0px' });
    motionTargets.forEach((element, i) => {
      element.classList.add('reveal-on-scroll');
      element.style.setProperty('--reveal-delay', `${(i % 5) * 75}ms`);
      revealObserver.observe(element);
    });
  } else motionTargets.forEach(element => element.classList.add('is-in'));
})();
