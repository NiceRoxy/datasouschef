/**
 * interview.js — DataSousChef Interview Engine v2
 * Sections: A → B → C (merged D/E/F/G) → H → review
 */

import { auth } from './firebase-config.js';
import { generateReportingScript } from './reporting-generator.js';

// Lazy Firestore loader
let _db = null;
async function getDb() {
  if (_db) return _db;
  try { const cfg = await import('./firebase-config.js'); _db = cfg.db || null; } catch {}
  return _db;
}

// ── Constants ──────────────────────────────────────────────────────────────────
const BACKEND_URL = 'https://generate-script-dnrmsfmerq-nw.a.run.app';
const SECTIONS = ['A', 'B', 'C', 'H', 'review'];
const safeId = name => 'col_' + String(name).replace(/[^a-zA-Z0-9]/g, '_');

// ── State ──────────────────────────────────────────────────────────────────────
let state = {
  currentSection: 'A',
  currentColIndex: 0,
  allColsDone: false,
  contract: {
    file_name: '', file_format: 'csv', sheet_name: null,
    has_header: true, row_count_estimate: 'unknown', encoding: 'utf-8',
    columns: [], date_order_rules: [],
    output_name: 'cleaned', output_format: 'csv'
  }
};

// ── Firestore helpers ──────────────────────────────────────────────────────────
async function saveToFirestore() {
  const user = auth.currentUser; if (!user) return;
  const ind = document.getElementById('interview-autosave-indicator');
  if (ind) ind.textContent = '⏳ Saving…';
  try {
    const db = await getDb(); if (!db) { if (ind) ind.textContent = ''; return; }
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    await setDoc(doc(db, 'interviews', user.uid, 'drafts', 'current'), {
      updatedAt: new Date().toISOString(),
      currentSection: state.currentSection,
      currentColIndex: state.currentColIndex,
      contract: state.contract
    });
    if (ind) { ind.textContent = '✓ Saved'; setTimeout(() => { if (ind) ind.textContent = ''; }, 2500); }
  } catch (e) { console.warn('Firestore save failed:', e); if (ind) ind.textContent = ''; }
}

async function loadFromFirestore() {
  const user = auth.currentUser; if (!user) return false;
  try {
    const db = await getDb(); if (!db) return false;
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'interviews', user.uid, 'drafts', 'current'));
    if (snap.exists()) {
      const d = snap.data();
      state.currentSection = d.currentSection || 'A';
      state.currentColIndex = d.currentColIndex || 0;
      state.contract = d.contract || state.contract;
      return true;
    }
  } catch (e) { console.warn('Firestore load failed:', e); }
  return false;
}

async function clearFirestoreDraft() {
  const user = auth.currentUser; if (!user) return;
  try {
    const db = await getDb(); if (!db) return;
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    await deleteDoc(doc(db, 'interviews', user.uid, 'drafts', 'current'));
  } catch {}
}

async function saveScriptToFirestore(cleanScript, reportScript) {
  const user = auth.currentUser; if (!user) { console.warn('[DSC] saveScript: no user'); return null; }
  try {
    const db = await getDb();
    if (!db) { console.warn('[DSC] saveScript: no db'); return null; }
    const { collection, addDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    console.log('[DSC] saveScript: writing to users/', user.uid, '/scripts');
    const ref = await addDoc(collection(db, 'users', user.uid, 'scripts'), {
      name: state.contract.output_name || 'cleaned',
      createdAt: new Date().toISOString(),
      cleaningScript: cleanScript,
      reportingScript: reportScript,
      contract: state.contract
    });
    console.log('[DSC] saveScript: saved OK, doc id =', ref.id);
    return ref.id;
  } catch (e) {
    console.error('[DSC] saveScript FAILED:', e.code, e.message, e);
    return null;   // non-fatal — download still proceeds
  }
}

// ── Column helpers ─────────────────────────────────────────────────────────────
function getOrCreateCol(name) {
  let col = state.contract.columns.find(c => c.name === name);
  if (!col) {
    col = {
      name, selected: true, col_type: 'text', recode_to_type: null,
      rename_to: null, value_mapping: '', unmapped_action: 'system_missing', unmapped_custom: '',
      has_missing: false, missing_sentinels: '', missing_action: 'blank', missing_custom: '',
      strip_chars: ''
    };
    state.contract.columns.push(col);
  }
  return col;
}

function selectedCols() { return state.contract.columns.filter(c => c.selected); }

// ── Navigation ─────────────────────────────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.wizard-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`interview-section-${id}`)?.classList.add('active');
  document.querySelector(`.wizard-step[data-section="${id}"]`)?.classList.add('active');

  const idx = SECTIONS.indexOf(id);
  const btnBack = document.getElementById('wizard-btn-back');
  const btnNext = document.getElementById('wizard-btn-next');
  const btnSubmit = document.getElementById('wizard-btn-submit');
  const btnPrev = document.getElementById('wizard-btn-prev-col');

  if (btnBack) btnBack.style.visibility = idx === 0 ? 'hidden' : 'visible';
  if (btnPrev) btnPrev.style.display = 'none'; // reset; renderSectionC will show if needed

  if (id === 'review') {
    if (btnNext) btnNext.style.display = 'none';
    if (btnSubmit) btnSubmit.style.display = 'block';
    buildReview();
  } else {
    if (btnNext) { btnNext.style.display = 'block'; btnNext.textContent = 'Next →'; }
    if (btnSubmit) btnSubmit.style.display = 'none';
  }

  if (id === 'C') renderSectionC();
}

function nextSection() {
  collectCurrentSection();
  const idx = SECTIONS.indexOf(state.currentSection);
  if (state.currentSection === 'C' && !state.allColsDone) { advanceColumnC(); return; }
  if (idx < SECTIONS.length - 1) {
    state.currentSection = SECTIONS[idx + 1];
    state.currentColIndex = 0;
    showSection(state.currentSection);
    saveToFirestore();
  }
}

function prevSection() {
  collectCurrentSection();
  const idx = SECTIONS.indexOf(state.currentSection);
  if (idx > 0) {
    state.currentSection = SECTIONS[idx - 1];
    showSection(state.currentSection);
    saveToFirestore();
  }
}

function prevColumn() {
  const cols = selectedCols();
  if (state.currentColIndex > 0) {
    collectColPanel(cols[state.currentColIndex], document.getElementById('section-c-column-panel'));
    state.currentColIndex--;
    state.allColsDone = false;
    renderSectionC();
  }
}

// ── Section A ──────────────────────────────────────────────────────────────────
function collectA() {
  state.contract.file_name = document.getElementById('qa-filename')?.value.trim() || '';
  state.contract.file_format = document.getElementById('qa-format')?.value || 'csv';
  state.contract.sheet_name = document.getElementById('qa-sheet')?.value.trim() || null;
  state.contract.has_header = document.getElementById('qa-header')?.value !== 'no';
  state.contract.row_count_estimate = document.getElementById('qa-rows')?.value || 'unknown';
  state.contract.encoding = document.getElementById('qa-encoding')?.value || 'utf-8';
  if (!state.contract.output_name || state.contract.output_name === 'cleaned') {
    const stem = state.contract.file_name.replace(/\.[^.]+$/, '') || 'cleaned';
    state.contract.output_name = stem + '_cleaned';
    const ni = document.getElementById('qh-name');
    if (ni && !ni.value) ni.value = state.contract.output_name;
  }
}

// ── Section B ──────────────────────────────────────────────────────────────────
function initSectionB() {
  const fileInput = document.getElementById('qb-file-upload');
  const status    = document.getElementById('qb-file-status');
  const preview   = document.getElementById('qb-column-preview');
  const manual    = document.getElementById('qb-manual-cols');
  const selArea   = document.getElementById('qb-selection-area');
  const cbBox     = document.getElementById('qb-column-checkboxes');
  if (!fileInput) return;

  function renderCBs(headers) {
    headers.forEach(h => getOrCreateCol(h));
    cbBox.innerHTML = '';
    state.contract.columns.forEach(col => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:0.4rem;cursor:pointer;background:var(--bg-body);border:1px solid var(--grey-200);border-radius:999px;padding:0.25rem 0.75rem;font-size:0.85rem;';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = col.selected;
      cb.addEventListener('change', () => col.selected = cb.checked);
      lbl.appendChild(cb); lbl.appendChild(document.createTextNode(col.name));
      cbBox.appendChild(lbl);
    });
    if (selArea) selArea.style.display = 'block';
    if (preview) {
      preview.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem;">${headers.length} columns detected:</p>` +
        `<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">${headers.map(h => `<span style="background:var(--mint);color:var(--navy-dark);font-size:0.78rem;padding:0.2rem 0.6rem;border-radius:999px;">${h}</span>`).join('')}</div>`;
      preview.style.display = 'block';
    }
  }

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    if (status) status.textContent = 'Parsing…';
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
          if (!rows.length) { if (status) status.textContent = 'Could not read file.'; return; }
          const headers = rows[0].map(h => String(h).trim()).filter(Boolean);
          renderCBs(headers);
          if (status) { status.textContent = `✓ ${headers.length} columns from "${wb.SheetNames[0]}"`; status.style.color = 'var(--sage-dark)'; }
        } catch (err) { if (status) status.textContent = `Error: ${err.message}`; }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, { header: true, preview: 5,
        complete: r => {
          if (r.meta?.fields) { renderCBs(r.meta.fields); if (status) { status.textContent = `✓ ${r.meta.fields.length} columns`; status.style.color = 'var(--sage-dark)'; } }
          else if (status) status.textContent = 'Could not read CSV.';
        },
        error: err => { if (status) status.textContent = `Error: ${err.message}`; }
      });
    }
  });

  manual?.addEventListener('blur', () => {
    const lines = manual.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length) renderCBs(lines);
  });

  document.getElementById('qb-select-all')?.addEventListener('click', () => {
    state.contract.columns.forEach(c => c.selected = true);
    cbBox.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
  });
  document.getElementById('qb-deselect-all')?.addEventListener('click', () => {
    state.contract.columns.forEach(c => c.selected = false);
    cbBox.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  });

  if (state.contract.columns.length) renderCBs(state.contract.columns.map(c => c.name));
}

// ── Section C: per-column card ─────────────────────────────────────────────────
function renderSectionC() {
  const cols = selectedCols();
  const panel = document.getElementById('section-c-column-panel');
  const btnPrev = document.getElementById('wizard-btn-prev-col');
  const btnNext = document.getElementById('wizard-btn-next');
  const progress = document.getElementById('section-c-progress');

  if (!cols.length) {
    if (panel) panel.innerHTML = '<p style="color:var(--text-muted);">No columns selected. Go back to Section B.</p>';
    state.allColsDone = true; checkDateOrder(); return;
  }
  if (state.currentColIndex >= cols.length) { state.currentColIndex = cols.length - 1; state.allColsDone = true; }

  const col = cols[state.currentColIndex];
  if (progress) progress.textContent = `Column ${state.currentColIndex + 1} of ${cols.length}: "${col.name}"`;
  if (panel) { panel.innerHTML = buildColCard(col); attachColCardListeners(col, panel); }
  if (btnPrev) btnPrev.style.display = state.currentColIndex > 0 ? 'block' : 'none';
  if (btnNext) {
    const isLast = state.currentColIndex >= cols.length - 1;
    btnNext.textContent = isLast ? 'Continue →' : 'Next column →';
    state.allColsDone = isLast;
  }
  checkDateOrder();
}

function buildColCard(col) {
  const sid = safeId(col.name);
  const types = [['id','ID'],['date','Date'],['number','Number'],['category','Category'],['text','Text'],['recode','Recode to different type']];
  const typeOpts = types.map(([v,l]) => `<option value="${v}" ${col.col_type===v?'selected':''}>${l}</option>`).join('');

  const reTargets = [['id','ID'],['date','Date'],['number','Number'],['category','Category'],['text','Text']];
  const reTargetOpts = reTargets.map(([v,l]) => `<option value="${v}" ${col.recode_to_type===v?'selected':''}>${l}</option>`).join('');
  const showRecode = col.col_type === 'recode';

  const missingActions = buildMissingActions(col);

  return `
<div style="border:1px solid var(--grey-200);border-radius:var(--radius-md);padding:1.5rem;display:flex;flex-direction:column;gap:1.25rem;">

  <div class="form-group">
    <label>What kind of data is in <strong>"${col.name}"</strong>?</label>
    <select id="ctype-${sid}">${typeOpts}</select>
  </div>

  <div id="crecode-target-${sid}" style="${showRecode?'':'display:none;'}">
    <div class="form-group">
      <label>Recode into which type? <span style="font-size:0.82rem;color:var(--text-muted);">(original column is kept; a new column "${col.name}-New" will be created)</span></label>
      <select id="crecode-into-${sid}">${reTargetOpts}</select>
    </div>
  </div>

  <div class="form-group">
    <label>Rename this column to (optional):</label>
    <input type="text" id="crename-${sid}" placeholder="Leave blank to keep original name" value="${col.rename_to||''}">
  </div>

  <div class="form-group">
    <label>Map variants to valid values <span style="font-size:0.82rem;color:var(--text-muted);">(format: <em>old value → new value</em>, one per line)</span></label>
    <textarea id="cmap-${sid}" rows="4" placeholder="e.g.&#10;MALE → Male&#10;Female: 1, Male: 2&#10;01/01/2020 → 2020-01-01">${col.value_mapping||''}</textarea>
  </div>

  <div class="form-group">
    <label>Values not in the mapping:</label>
    <select id="cunmapped-${sid}">
      <option value="system_missing" ${col.unmapped_action==='system_missing'||!col.unmapped_action?'selected':''}>Define as system missing</option>
      <option value="keep" ${col.unmapped_action==='keep'?'selected':''}>Keep unchanged</option>
      <option value="other" ${col.unmapped_action==='other'?'selected':''}>Other (please specify)</option>
    </select>
    <input type="text" id="cunmapped-custom-${sid}" placeholder="Specify how to handle unmapped values"
      value="${col.unmapped_custom||''}"
      style="margin-top:0.5rem;${col.unmapped_action==='other'?'':'display:none;'}">
  </div>

  <div class="form-group">
    <label><input type="checkbox" id="chasmissing-${sid}" ${col.has_missing?'checked':''}> This column has missing values</label>
    <div id="cmissing-panel-${sid}" style="${col.has_missing?'':'display:none;'}margin-top:0.75rem;padding:1rem;background:rgba(52,84,99,0.04);border-radius:var(--radius-sm);display:flex;flex-direction:column;gap:0.75rem;">
      <div class="form-group">
        <label>What represents "missing"? <span style="font-size:0.82rem;color:var(--text-muted);">(comma-separated, e.g. blank, NA, 99)</span></label>
        <input type="text" id="cmiss-sent-${sid}" value="${col.missing_sentinels||''}" placeholder="blank, NA, N/A">
      </div>
      <div class="form-group">
        <label>What should happen to missing values?</label>
        <select id="cmiss-action-${sid}">${missingActions}</select>
        <input type="text" id="cmiss-custom-${sid}" placeholder="Enter replacement value"
          value="${col.missing_custom||''}"
          style="margin-top:0.5rem;${col.missing_action==='custom'?'':'display:none;'}">
      </div>
    </div>
  </div>

  <div id="cstrip-group-${sid}" style="${['text','category','recode'].includes(col.col_type)?'':'display:none;'}">
    <div class="form-group">
      <label>Strip these characters from values (optional):</label>
      <input type="text" id="cstrip-${sid}" placeholder="e.g. # * ?" value="${col.strip_chars||''}">
    </div>
  </div>

</div>`;
}

function buildMissingActions(col) {
  const type = col.col_type === 'recode' ? (col.recode_to_type || 'text') : col.col_type;
  const cur = col.missing_action || 'blank';
  const sel = v => cur === v ? 'selected' : '';
  const base = `
    <option value="blank" ${sel('blank')}>Blank / system missing (flag in report)</option>
    <option value="remove" ${sel('remove')}>Remove the record</option>
    <option value="custom" ${sel('custom')}>Custom value…</option>`;
  if (type === 'number') return `
    <option value="blank" ${sel('blank')}>Blank / NaN (system missing)</option>
    <option value="zero" ${sel('zero')}>Replace with 0</option>
    <option value="mean" ${sel('mean')}>Replace with mean</option>
    <option value="median" ${sel('median')}>Replace with median</option>
    <option value="remove" ${sel('remove')}>Remove the record</option>
    <option value="custom" ${sel('custom')}>Custom value…</option>`;
  if (type === 'category' || type === 'text') return `
    <option value="blank" ${sel('blank')}>Blank / system missing</option>
    <option value="unknown" ${sel('unknown')}>Replace with "Unknown"</option>
    <option value="zero_str" ${sel('zero_str')}>Replace with "0"</option>
    <option value="remove" ${sel('remove')}>Remove the record</option>
    <option value="custom" ${sel('custom')}>Custom value…</option>`;
  return base;
}

function attachColCardListeners(col, panel) {
  const sid = safeId(col.name);

  // Type selector
  panel.querySelector(`#ctype-${sid}`)?.addEventListener('change', e => {
    col.col_type = e.target.value;
    const reDiv = panel.querySelector(`#crecode-target-${sid}`);
    const stripDiv = panel.querySelector(`#cstrip-group-${sid}`);
    if (reDiv) reDiv.style.display = col.col_type === 'recode' ? '' : 'none';
    if (stripDiv) stripDiv.style.display = ['text','category','recode'].includes(col.col_type) ? '' : 'none';
    // Rebuild missing action options
    const missSel = panel.querySelector(`#cmiss-action-${sid}`);
    if (missSel) missSel.innerHTML = buildMissingActions(col);
  });

  // Recode target
  panel.querySelector(`#crecode-into-${sid}`)?.addEventListener('change', e => {
    col.recode_to_type = e.target.value;
    const missSel = panel.querySelector(`#cmiss-action-${sid}`);
    if (missSel) missSel.innerHTML = buildMissingActions(col);
  });

  // Unmapped action
  panel.querySelector(`#cunmapped-${sid}`)?.addEventListener('change', e => {
    col.unmapped_action = e.target.value;
    const customInput = panel.querySelector(`#cunmapped-custom-${sid}`);
    if (customInput) customInput.style.display = e.target.value === 'other' ? '' : 'none';
  });

  // Has missing checkbox
  panel.querySelector(`#chasmissing-${sid}`)?.addEventListener('change', e => {
    col.has_missing = e.target.checked;
    const mp = panel.querySelector(`#cmissing-panel-${sid}`);
    if (mp) mp.style.display = e.target.checked ? '' : 'none';
  });

  // Missing action
  panel.querySelector(`#cmiss-action-${sid}`)?.addEventListener('change', e => {
    col.missing_action = e.target.value;
    const ci = panel.querySelector(`#cmiss-custom-${sid}`);
    if (ci) ci.style.display = e.target.value === 'custom' ? '' : 'none';
  });
}

function collectColPanel(col, panel) {
  if (!panel) return;
  const sid = safeId(col.name);
  col.col_type        = panel.querySelector(`#ctype-${sid}`)?.value || col.col_type;
  col.recode_to_type  = col.col_type === 'recode' ? (panel.querySelector(`#crecode-into-${sid}`)?.value || null) : null;
  col.rename_to       = panel.querySelector(`#crename-${sid}`)?.value.trim() || null;
  col.value_mapping   = panel.querySelector(`#cmap-${sid}`)?.value.trim() || '';
  col.unmapped_action = panel.querySelector(`#cunmapped-${sid}`)?.value || 'system_missing';
  col.unmapped_custom = panel.querySelector(`#cunmapped-custom-${sid}`)?.value.trim() || '';
  col.has_missing     = panel.querySelector(`#chasmissing-${sid}`)?.checked || false;
  col.missing_sentinels = panel.querySelector(`#cmiss-sent-${sid}`)?.value.trim() || '';
  col.missing_action  = panel.querySelector(`#cmiss-action-${sid}`)?.value || 'blank';
  col.missing_custom  = panel.querySelector(`#cmiss-custom-${sid}`)?.value.trim() || '';
  col.strip_chars     = panel.querySelector(`#cstrip-${sid}`)?.value.trim() || '';
}

function advanceColumnC() {
  const cols = selectedCols();
  collectColPanel(cols[state.currentColIndex], document.getElementById('section-c-column-panel'));
  state.currentColIndex++;
  if (state.currentColIndex >= cols.length) { state.allColsDone = true; checkDateOrder(); }
  renderSectionC();
}

function checkDateOrder() {
  const hasDates = selectedCols().some(c => c.col_type === 'date');
  const s = document.getElementById('qc5-date-order-section');
  if (s) s.style.display = (state.allColsDone && hasDates) ? '' : 'none';
}

// ── Date ordering rules ────────────────────────────────────────────────────────
function initDateOrderUI() {
  document.getElementById('qc5-add-rule')?.addEventListener('click', () => {
    const dateCols = selectedCols().filter(c => c.col_type === 'date').map(c => c.name);
    const opts = dateCols.map(n => `<option>${n}</option>`).join('');
    const rule = { earlier_col: dateCols[0]||'', later_col: dateCols[1]||dateCols[0]||'', on_violation: 'report' };
    state.contract.date_order_rules.push(rule);
    const idx = state.contract.date_order_rules.length - 1;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:0.75rem;align-items:center;margin-bottom:0.5rem;';
    div.innerHTML = `<select class="dor-earlier" data-idx="${idx}">${opts}</select>
      <span>before</span><select class="dor-later" data-idx="${idx}">${opts}</select>
      <select class="dor-action" data-idx="${idx}"><option value="report">Report only</option><option value="blank_later">Blank later date</option></select>
      <button type="button" class="btn-ghost btn-small dor-remove" data-idx="${idx}">✕</button>`;
    document.getElementById('qc5-rules-list')?.appendChild(div);
    div.querySelector('.dor-earlier')?.addEventListener('change', e => { state.contract.date_order_rules[idx].earlier_col = e.target.value; });
    div.querySelector('.dor-later')?.addEventListener('change', e => { state.contract.date_order_rules[idx].later_col = e.target.value; });
    div.querySelector('.dor-action')?.addEventListener('change', e => { state.contract.date_order_rules[idx].on_violation = e.target.value; });
    div.querySelector('.dor-remove')?.addEventListener('click', () => { state.contract.date_order_rules.splice(idx,1); div.remove(); });
  });
}

// ── Section H ──────────────────────────────────────────────────────────────────
function collectH() {
  state.contract.output_name   = document.getElementById('qh-name')?.value.trim() || 'cleaned';
  state.contract.output_format = document.getElementById('qh-format')?.value || 'same';
}

// ── Collect dispatcher ─────────────────────────────────────────────────────────
function collectCurrentSection() {
  switch (state.currentSection) {
    case 'A': collectA(); break;
    case 'C': {
      const cols = selectedCols();
      if (cols.length && state.currentColIndex < cols.length)
        collectColPanel(cols[state.currentColIndex], document.getElementById('section-c-column-panel'));
      break;
    }
    case 'H': collectH(); break;
  }
}

// ── Review screen ──────────────────────────────────────────────────────────────
function buildReview() {
  const c = state.contract;
  const jumpLink = (sec, label) =>
    `<a href="#" class="review-jump" data-sec="${sec}" style="font-size:0.82rem;color:var(--sage-dark);text-decoration:underline;margin-right:1rem;">${label}</a>`;

  let html = `<div style="margin-bottom:1rem;">${jumpLink('A','A — File')}${jumpLink('B','B — Columns')}${jumpLink('C','C — Column rules')}${jumpLink('H','H — Output')}</div>`;

  html += `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
    <thead><tr style="border-bottom:2px solid var(--grey-200);">
      <th style="padding:0.5rem 0.75rem 0.5rem 0;text-align:left;">Column</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Renamed to</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Type</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Recode → new col</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Mapping (first 2 lines)</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Unmapped</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Missing</th>
      <th style="padding:0.5rem 0.75rem;text-align:left;">Strip</th>
    </tr></thead><tbody>`;
  selectedCols().forEach((col, i) => {
    const bg = i % 2 === 0 ? '' : 'background:rgba(52,84,99,0.03);';
    const mapPreview = (col.value_mapping||'').split('\n').slice(0,2).join('; ') || '—';
    const missInfo = col.has_missing
      ? `${col.missing_sentinels||'blank,NA'} → ${col.missing_action}${col.missing_custom?' ('+col.missing_custom+')':''}`
      : '—';
    html += `<tr style="${bg}">
      <td style="padding:0.5rem 0.75rem 0.5rem 0;font-weight:600;">${col.name}</td>
      <td style="padding:0.5rem 0.75rem;">${col.rename_to||'—'}</td>
      <td style="padding:0.5rem 0.75rem;">${col.col_type}</td>
      <td style="padding:0.5rem 0.75rem;">${col.recode_to_type ? col.recode_to_type+' (-New)' : '—'}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--text-muted);">${mapPreview}</td>
      <td style="padding:0.5rem 0.75rem;">${col.unmapped_action==='other' ? col.unmapped_custom||'other' : col.unmapped_action}</td>
      <td style="padding:0.5rem 0.75rem;font-size:0.8rem;">${missInfo}</td>
      <td style="padding:0.5rem 0.75rem;">${col.strip_chars||'—'}</td>
    </tr>`;
  });

  html += '</tbody></table>';

  if (c.date_order_rules.length) {
    html += `<h3 style="font-size:0.95rem;margin-top:1.5rem;">Date ordering rules</h3>`;
    c.date_order_rules.forEach(r => { html += `<p style="font-size:0.85rem;">"${r.earlier_col}" before "${r.later_col}" — ${r.on_violation}</p>`; });
  }

  html += `<h3 style="font-size:0.95rem;margin-top:1.5rem;">Output</h3>
    <p style="font-size:0.85rem;">${c.output_name} (${c.output_format})</p>`;

  const rc = document.getElementById('review-content');
  if (rc) rc.innerHTML = html;

  // Wire jump links
  document.querySelectorAll('.review-jump').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const sec = a.dataset.sec;
      state.currentSection = sec;
      if (sec === 'C') { state.currentColIndex = 0; state.allColsDone = false; }
      showSection(sec);
    });
  });
}

// ── Submit ─────────────────────────────────────────────────────────────────────
async function submitInterview() {
  const btn    = document.getElementById('wizard-btn-submit');
  const saving = document.getElementById('review-saving');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  collectH();

  // Show progress message with elapsed-time counter
  if (saving) {
    saving.style.display = '';
    saving.innerHTML = '⏳ <strong>Generating your script…</strong> This usually takes 3–8 minutes. Please keep this tab open.';
  }
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += 5;
    if (saving) saving.innerHTML =
      `⏳ <strong>Generating your script…</strong> ${elapsed}s elapsed — AI is writing your cleaning code. Please keep this tab open.`;
  }, 5000);

  try {
    const resp = await fetch(`${BACKEND_URL}/api/generate-script`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.contract)
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const cleanScript = await resp.text();
    const reportScript = generateReportingScript(state.contract);
    const outName = (state.contract.output_name || 'cleaned').replace(/[^a-z0-9_]/gi, '_');

    // Save to Firestore
    await saveScriptToFirestore(cleanScript, reportScript);
    await saveToFirestore();

    // Zip and download
    const zip = new JSZip();
    zip.file(`${outName}_clean.py`, cleanScript);
    zip.file(`${outName}_report.py`, reportScript);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${outName}.zip`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);

    await clearFirestoreDraft();

    // Navigate to My Scripts
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-scripts')?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-view="scripts"]')?.classList.add('active');

  } catch (err) {
    alert('Failed to generate script: ' + err.message); console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Approve & Generate'; }
    if (saving) saving.style.display = 'none';
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  auth.onAuthStateChanged(async user => {
    if (user) { const ok = await loadFromFirestore(); if (ok) showSection(state.currentSection); }
  });

  document.getElementById('proc-audit')?.addEventListener('click', () => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-questionnaire')?.classList.add('active');
    state.currentSection = 'A'; state.currentColIndex = 0; state.allColsDone = false;
    showSection('A');
  });

  document.getElementById('btn-continue')?.addEventListener('click', () => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-questionnaire')?.classList.add('active');
    state.currentSection = 'A'; state.currentColIndex = 0; state.allColsDone = false;
    showSection('A');
  });

  document.getElementById('wizard-btn-next')?.addEventListener('click', nextSection);
  document.getElementById('wizard-btn-back')?.addEventListener('click', prevSection);
  document.getElementById('wizard-btn-prev-col')?.addEventListener('click', prevColumn);
  document.getElementById('wizard-btn-submit')?.addEventListener('click', submitInterview);

  document.getElementById('qa-format')?.addEventListener('change', e => {
    const sg = document.getElementById('qa-sheet-group');
    if (sg) sg.style.display = ['xlsx','xls'].includes(e.target.value) ? '' : 'none';
  });

  initSectionB();
  initDateOrderUI();
  showSection('A');
});
