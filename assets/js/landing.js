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
})();
