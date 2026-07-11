/**
 * scripts.js — My Scripts view
 * Loads user scripts from Firestore, renders cards with download & delete.
 */
import { auth } from './firebase-config.js';

let _db = null;
async function getDb() {
  if (_db) return _db;
  try { const cfg = await import('./firebase-config.js'); _db = cfg.db || null; } catch {}
  return _db;
}

async function loadScripts() {
  const listEl    = document.getElementById('scripts-list');
  const emptyEl   = document.getElementById('scripts-empty');
  const loadingEl = document.getElementById('scripts-loading');
  if (!listEl) return;

  if (loadingEl) { loadingEl.style.display = ''; loadingEl.textContent = 'Loading your scripts…'; }
  if (emptyEl)   emptyEl.style.display  = 'none';
  listEl.innerHTML = '';

  // Wait for Firebase Auth to finish initialising (currentUser can be null briefly)
  const user = await new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(u => { unsub(); resolve(u); });
  });

  if (!user) {
    if (loadingEl) loadingEl.textContent = 'Sign in to view your scripts.';
    return;
  }

  try {
    const db = await getDb();
    if (!db) { if (loadingEl) loadingEl.textContent = ''; return; }
    const { collection, getDocs, orderBy, query, deleteDoc, doc } =
      await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');

    const q = query(collection(db, 'users', user.uid, 'scripts'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);

    if (loadingEl) loadingEl.style.display = 'none';

    if (snap.empty) {
      if (emptyEl) emptyEl.style.display = '';
      if (navBadge) navBadge.textContent = '0';
      return;
    }

    if (navBadge) navBadge.textContent = snap.size;

    snap.forEach(docSnap => {
      const data = docSnap.data();
      const id   = docSnap.id;
      const date = data.createdAt ? new Date(data.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '';
      const name = data.name || 'cleaned';

      const card = document.createElement('div');
      card.className = 'script-card';
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <div class="script-card-icon" aria-hidden="true">🐍</div>
        <div class="script-card-info">
          <p class="script-card-name">${name}_clean.py + ${name}_report.py</p>
          <p class="script-card-meta">Audit &amp; Clean &middot; Generated ${date}</p>
        </div>
        <span class="script-card-status status-success">Ready</span>
        <button class="script-card-download" data-id="${id}" aria-label="Download ${name}.zip">⬇ Download</button>
        <button class="btn-ghost btn-small" style="color:#c94040;" data-id="${id}" data-del aria-label="Delete ${name}">🗑</button>`;

      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
        try {
          await deleteDoc(doc(db, 'users', user.uid, 'scripts', id));
          card.remove();
          if (!listEl.children.length) {
            if (emptyEl) emptyEl.style.display = '';
            if (navBadge) navBadge.textContent = '0';
          } else {
            if (navBadge) navBadge.textContent = String(parseInt(navBadge.textContent || '1') - 1);
          }
        } catch (e) { alert('Delete failed: ' + e.message); }
      });

      card.querySelector('.script-card-download').addEventListener('click', async () => {
        try {
          const outName = name.replace(/[^a-z0-9_]/gi, '_');
          const zip = new JSZip();
          zip.file(`${outName}_clean.py`,  data.cleaningScript  || '# no cleaning script saved');
          zip.file(`${outName}_report.py`, data.reportingScript || '# no reporting script saved');
          const blob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${outName}.zip`;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a); URL.revokeObjectURL(url);
        } catch (e) { alert('Download failed: ' + e.message); }
      });

      listEl.appendChild(card);
    });

  } catch (e) {
    console.error('Scripts load error:', e);
    if (loadingEl) loadingEl.textContent = 'Could not load scripts. Please try again.';
  }
}

// ── Wire up to navigation events ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dsc:show-view', e => {
    if (e.detail.viewId === 'scripts') loadScripts();
  });
});
