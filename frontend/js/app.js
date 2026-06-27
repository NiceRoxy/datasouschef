/* ============================================================
   DataSousChef — app.js
   App shell interactions: navigation, procedure selection,
   readme toggle, mobile sidebar
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── View switching ──────────────────────────────────────── */
  const views   = document.querySelectorAll('.view');
  const navItems = document.querySelectorAll('.nav-item[data-view]');

  function showView(viewId) {
    views.forEach(v => v.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));

    const target = document.getElementById('view-' + viewId);
    if (target) target.classList.add('active');

    const activeNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (activeNav) activeNav.classList.add('active');

    // Update topbar breadcrumb
    const crumb = document.getElementById('topbar-page');
    const labels = {
      dashboard: 'Overview',
      home:    'New Task',
      scripts: 'My Scripts',
      help:    'Help & Guidance'
    };
    if (crumb) crumb.textContent = labels[viewId] || viewId;

    // Close mobile sidebar on navigation
    closeSidebar();
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      showView(item.dataset.view);
    });
  });



  /* ── Dashboard Quick Actions ────────────────────────────── */
  const dashStartTaskBtn = document.getElementById('dash-start-task');
  const dashViewAllBtn   = document.getElementById('dash-view-all-scripts');

  if (dashStartTaskBtn) {
    dashStartTaskBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Navigating to home view...');
      showView('home');
    });
  }
  if (dashViewAllBtn) {
    dashViewAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showView('scripts');
    });
  }

  /* ── Procedure multi-select ──────────────────────────────── */
  const procCards    = document.querySelectorAll('.proc-select-card');
  const continueBar  = document.getElementById('continue-bar');
  const continueBtn  = document.getElementById('btn-continue');
  const selectedTags = document.getElementById('selected-tags');
  const statusText   = document.getElementById('continue-status-text');

  const PROC_LABELS = {
    diagnose: 'Diagnose & Standardise',
    crosscol: 'Cross-Column Checks',
    link:     'Link Datasets'
  };

  let selectedProcs = new Set();

  procCards.forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.proc;
      if (selectedProcs.has(key)) {
        selectedProcs.delete(key);
        card.classList.remove('selected');
        card.setAttribute('aria-checked', 'false');
      } else {
        selectedProcs.add(key);
        card.classList.add('selected');
        card.setAttribute('aria-checked', 'true');
      }
      updateContinueBar();
    });

    // Keyboard support
    card.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        card.click();
      }
    });
  });

  function updateContinueBar() {
    if (selectedProcs.size > 0) {
      continueBar.classList.add('ready');
      continueBtn.classList.add('enabled');

      // Build tags
      selectedTags.innerHTML = '';
      selectedProcs.forEach(key => {
        const tag = document.createElement('span');
        tag.className = 'selected-tag';
        tag.textContent = PROC_LABELS[key];
        selectedTags.appendChild(tag);
      });

      statusText.textContent = selectedProcs.size === 1
        ? '1 procedure selected'
        : `${selectedProcs.size} procedures selected`;

    } else {
      continueBar.classList.remove('ready');
      continueBtn.classList.remove('enabled');
      selectedTags.innerHTML = '';
      statusText.textContent = 'Select at least one option above';
    }
  }

  // Continue button (routes to questionnaire)
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      if (selectedProcs.size === 0) return;
      showView('questionnaire');
      const event = new CustomEvent('start-questionnaire', { detail: { procs: Array.from(selectedProcs) } });
      document.dispatchEvent(event);
    });
  }

  /* ── Read me / explainer toggle ─────────────────────────── */
  const readmeToggle = document.getElementById('readme-toggle');
  const readmePanel  = document.getElementById('readme-panel');

  if (readmeToggle && readmePanel) {
    readmeToggle.addEventListener('click', () => {
      const isOpen = readmePanel.classList.toggle('open');
      readmeToggle.classList.toggle('open', isOpen);
      readmeToggle.setAttribute('aria-expanded', isOpen);
      readmePanel.setAttribute('aria-hidden', !isOpen);
      const icon = readmeToggle.querySelector('.readme-toggle-icon');
      if (icon) icon.textContent = isOpen ? '▲' : '▼';
    });
  }

  /* ── Mobile sidebar ──────────────────────────────────────── */
  const sidebar        = document.getElementById('app-sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const menuBtn        = document.getElementById('mobile-menu-btn');

  function openSidebar() {
    sidebar?.classList.add('open');
    sidebarOverlay?.classList.add('open');
    menuBtn?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar?.classList.remove('open');
    sidebarOverlay?.classList.remove('open');
    menuBtn?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  menuBtn?.addEventListener('click', () => {
    sidebar?.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  sidebarOverlay?.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  /* ── Trial progress bar animation ───────────────────────── */
  // Day 1 of 3 = 33%; animate in on load
  const trialFill = document.querySelector('.trial-bar-fill');
  if (trialFill) {
    trialFill.style.width = '0%';
    setTimeout(() => { trialFill.style.width = '33.33%'; }, 400);
  }

  /* ── Topbar help button → help view ─────────────────────── */
  const topbarHelpBtn = document.getElementById('topbar-help-btn');
  if (topbarHelpBtn) {
    topbarHelpBtn.addEventListener('click', () => showView('help'));
  }

  /* ── Edit Profile Modal ──────────────────────────────────── */
  const editProfileModal = document.getElementById('edit-profile-modal');
  const editProfileClose = document.getElementById('edit-profile-close');
  const editProfileSave  = document.getElementById('edit-profile-save');
  const editProfileError = document.getElementById('edit-profile-error');

  function openEditProfile() {
    if (!editProfileModal) return;
    editProfileModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Pre-fill with Firebase user data if available
    if (window._firebaseUser) {
      const nameInput = document.getElementById('edit-profile-name');
      const emailInput = document.getElementById('edit-profile-email');
      if (nameInput) nameInput.value = window._firebaseUser.displayName || '';
      if (emailInput) emailInput.value = window._firebaseUser.email || '';
    }
  }

  function closeEditProfile() {
    if (!editProfileModal) return;
    editProfileModal.style.display = 'none';
    document.body.style.overflow = '';
    if (editProfileError) { editProfileError.style.display = 'none'; editProfileError.textContent = ''; }
  }

  // Wire all "Edit Profile" buttons
  document.querySelectorAll('.btn-ghost.btn-small').forEach(btn => {
    if (btn.textContent.trim() === 'Edit Profile') {
      btn.addEventListener('click', openEditProfile);
    }
  });

  editProfileClose?.addEventListener('click', closeEditProfile);
  editProfileModal?.addEventListener('click', (e) => { if (e.target === editProfileModal) closeEditProfile(); });

  editProfileSave?.addEventListener('click', async () => {
    const nameInput = document.getElementById('edit-profile-name');
    const newName = nameInput ? nameInput.value.trim() : '';
    if (!newName) {
      if (editProfileError) { editProfileError.textContent = 'Display name cannot be blank.'; editProfileError.style.display = 'block'; }
      return;
    }

    editProfileSave.disabled = true;
    editProfileSave.textContent = 'Saving...';

    try {
      if (window._firebaseUser) {
        // updateProfile is imported via auth.js and exposed on window
        await window._updateFirebaseProfile(window._firebaseUser, { displayName: newName });
        // Update all displayed names in the UI
        document.querySelectorAll('.user-name, .profile-name').forEach(el => el.textContent = newName);
        const avatar = document.querySelector('.user-avatar');
        if (avatar) avatar.textContent = newName.charAt(0).toUpperCase();
      }
      closeEditProfile();
    } catch (err) {
      if (editProfileError) { editProfileError.textContent = err.message; editProfileError.style.display = 'block'; }
    } finally {
      editProfileSave.disabled = false;
      editProfileSave.textContent = 'Save Changes';
    }
  });

  // Default view: execute at the very end after all variables are initialized to avoid TDZ ReferenceError.
  showView('dashboard');

});
