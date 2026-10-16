/* ============================================
   Minga Parish — Responsive Sidebar Controller
   
   Vanilla JS to handle mobile sidebar toggle,
   overlay, swipe-to-close, and auto-close.
   Include AFTER responsive-sidebar.css on every dashboard page.
   ============================================ */

(function () {
  'use strict';

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar || !overlay) return;

  // ── State ──────────────────────────────────────
  let isOpen = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchCurrentX = 0;
  let isSwiping = false;
  const SWIPE_THRESHOLD = 80;

  // ── Open / Close ──────────────────────────────
  function openSidebar() {
    isOpen = true;
    sidebar.classList.add('sidebar-open');
    overlay.classList.add('overlay-visible');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    isOpen = false;
    sidebar.classList.remove('sidebar-open');
    overlay.classList.remove('overlay-visible');
    document.body.style.overflow = '';
    // Reset any inline transform from swiping
    sidebar.style.transform = '';
    sidebar.style.transition = '';
  }

  function toggleSidebar() {
    if (isOpen) closeSidebar();
    else openSidebar();
  }

  // ── Expose globally ───────────────────────────
  window.openSidebar = openSidebar;
  window.closeSidebar = closeSidebar;
  window.toggleSidebar = toggleSidebar;

  // ── Overlay click → close ─────────────────────
  overlay.addEventListener('click', closeSidebar);

  // ── Close button inside sidebar ───────────────
  const closeBtn = sidebar.querySelector('.sidebar-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSidebar);
  }

  // ── Hamburger button(s) ───────────────────────
  document.querySelectorAll('[data-sidebar-toggle]').forEach(btn => {
    btn.addEventListener('click', toggleSidebar);
  });

  // ── Close sidebar when clicking in-page links (mobile) ──
  // Links to another page are left alone: the next page opens with the
  // sidebar already closed, and animating it shut here only competed with
  // the navigation on slower phones.
  sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') || '';
      if (window.innerWidth < 768 && isOpen && href.startsWith('#')) closeSidebar();
    });
  });

  // ── Swipe to close (touch events) ─────────────
  sidebar.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCurrentX = touchStartX;
    isSwiping = false;
  }, { passive: true });

  sidebar.addEventListener('touchmove', (e) => {
    if (window.innerWidth >= 768) return;
    touchCurrentX = e.touches[0].clientX;
    const deltaX = touchCurrentX - touchStartX;
    const deltaY = Math.abs(e.touches[0].clientY - touchStartY);

    // Only activate swipe if horizontal movement > vertical
    if (!isSwiping && Math.abs(deltaX) > 10 && Math.abs(deltaX) > deltaY) {
      isSwiping = true;
    }

    if (isSwiping && deltaX < 0) {
      // Dragging left — move sidebar with finger
      const clampedDelta = Math.max(deltaX, -288); // sidebar width
      sidebar.style.transition = 'none';
      sidebar.style.transform = `translateX(${clampedDelta}px)`;
      
      // Update overlay opacity proportionally
      const progress = 1 - Math.abs(clampedDelta) / 288;
      overlay.style.opacity = progress;
    }
  }, { passive: true });

  sidebar.addEventListener('touchend', () => {
    if (window.innerWidth >= 768) return;
    
    const deltaX = touchCurrentX - touchStartX;
    
    if (isSwiping && deltaX < -SWIPE_THRESHOLD) {
      // Swipe was far enough — close
      closeSidebar();
    } else {
      // Snap back open
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      overlay.style.opacity = '';
    }
    
    isSwiping = false;
  }, { passive: true });

  // ── Edge swipe to open (from left edge) ───────
  let edgeSwipeStartX = 0;
  let edgeSwipeActive = false;

  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768 || isOpen) return;
    const startX = e.touches[0].clientX;
    // Only activate if touch starts within 20px of left edge
    if (startX <= 20) {
      edgeSwipeStartX = startX;
      edgeSwipeActive = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!edgeSwipeActive) return;
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - edgeSwipeStartX;
    
    if (deltaX > 60) {
      edgeSwipeActive = false;
      openSidebar();
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    edgeSwipeActive = false;
  }, { passive: true });

  // ── Auto-close on resize (mobile → desktop) ──
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth >= 768 && isOpen) {
        closeSidebar();
      }
    }, 150);
  });

  // ── Escape key → close ────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeSidebar();
    }
  });

})();
