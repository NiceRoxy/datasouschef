/* ============================================================
   DataSousChef — main.js
   Scroll animations, navbar, mobile menu, sign-up modal
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Navbar scroll effect ─────────────────────────────────── */
  const navbar = document.getElementById('navbar');

  const handleScroll = () => {
    if (window.scrollY > 24) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });

  /* ── Mobile hamburger menu ───────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
      // Animate hamburger bars
      const bars = hamburger.querySelectorAll('span');
      if (isOpen) {
        bars[0].style.transform = 'translateY(7px) rotate(45deg)';
        bars[1].style.opacity = '0';
        bars[2].style.transform = 'translateY(-7px) rotate(-45deg)';
      } else {
        bars[0].style.transform = '';
        bars[1].style.opacity = '';
        bars[2].style.transform = '';
      }
    });

    // Close mobile menu on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
        const bars = hamburger.querySelectorAll('span');
        bars[0].style.transform = '';
        bars[1].style.opacity = '';
        bars[2].style.transform = '';
      });
    });
  }

  /* ── Scroll reveal ───────────────────────────────────────── */
  const revealEls = document.querySelectorAll('.reveal');

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  revealEls.forEach(el => revealObserver.observe(el));

  /* ── Sign-up Modal ───────────────────────────────────────── */
  const modalOverlay   = document.getElementById('signup-modal');
  const modalFormView  = document.getElementById('modal-form-view');
  const modalSuccess   = document.getElementById('modal-success');
  const signupForm     = document.getElementById('signup-form');
  const closeBtn       = document.getElementById('modal-close');

  // All elements that open the modal
  const openTriggers = document.querySelectorAll('[data-open-signup]');

  const openModal = () => {
    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Reset to form view
    modalFormView.style.display = '';
    modalSuccess.classList.remove('show');
    // Focus first input
    setTimeout(() => {
      const firstInput = modalOverlay.querySelector('input');
      if (firstInput) firstInput.focus();
    }, 350);
  };

  const closeModal = () => {
    modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  openTriggers.forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
      // Reset to signup view if someone clicks get started
      document.getElementById('login-view').style.display = 'none';
      document.getElementById('signup-view').style.display = 'block';
    });
  });

  const loginTriggers = document.querySelectorAll('[data-open-login]');
  loginTriggers.forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
      // Switch to login view
      document.getElementById('signup-view').style.display = 'none';
      document.getElementById('login-view').style.display = 'block';
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  // Close on overlay click (outside modal box)
  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay?.classList.contains('open')) closeModal();
  });

  /* ── Form Error Helper ─────────────────────────────── */

  function showFormError(message) {
    let errorEl = document.getElementById('form-error');
    if (!errorEl) {
      errorEl = document.createElement('p');
      errorEl.id = 'form-error';
      errorEl.style.cssText = 'color:#c0392b;font-size:0.85rem;margin-bottom:0.75rem;text-align:center;font-weight:500;';
      signupForm.prepend(errorEl);
    }
    errorEl.textContent = message;
    setTimeout(() => { if (errorEl) errorEl.textContent = ''; }, 4000);
  }

  /* ── Smooth scroll for anchor links ─────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-h')) || 72;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ── Procedure card number counter animation ─────────────── */
  const procedureNumbers = document.querySelectorAll('.procedure-number');

  const numObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animation = 'fadeUp 0.6s ease both';
        numObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  procedureNumbers.forEach(el => numObserver.observe(el));

});
