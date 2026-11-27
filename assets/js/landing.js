(() => {
  const root = document.querySelector('.showcase');
  if (!root) return;
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
})();
