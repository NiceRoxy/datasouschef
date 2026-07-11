/**
 * interview.js — DataSousChef Guided Interview Engine
 * Implements the full A–H interview from DataSousChef_Interview_Script_v1.md
 * Saves state to Firebase Firestore after each section.
 */

import { auth } from './firebase-config.js';

// Lazy Firestore loader — never blocks module init
let _db = null;
async function getDb() {
  if (_db) return _db;
  try {
    const cfg = await import('./firebase-config.js');
    _db = cfg.db || null;
  } catch (e) { /* non-fatal */ }
  return _db;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BACKEND_URL = 'https://generate-script-dnrmsfmerq-nw.a.run.app';
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'review'];

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  currentSection: 'A',
  currentColIndex: 0,   // for Section C column-by-column loop
  allColsDone: false,   // true when all columns have been typed in Section C
  contract: {
    file_name: '', file_format: 'csv', sheet_name: null,
    has_header: true, row_count_estimate: 'unknown', encoding: 'utf-8',
    columns: [],        // array of ColumnSpec objects
    date_order_rules: [],
    output_name: 'cleaned', output_format: 'same'
  }
};

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function saveToFirestore() {
  const user = auth.currentUser;
  if (!user) return;
  const indicator = document.getElementById('interview-autosave-indicator');
  if (indicator) indicator.textContent = '⏳ Saving…';
  try {
    const db = await getDb();
    if (!db) { if (indicator) indicator.textContent = ''; return; }
    const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    await setDoc(doc(db, 'interviews', user.uid, 'drafts', 'current'), {
      updatedAt: new Date().toISOString(),
      currentSection: state.currentSection,
      currentColIndex: state.currentColIndex,
      contract: state.contract
    });
    if (indicator) indicator.textContent = '✓ Saved';
    setTimeout(() => { if (indicator) indicator.textContent = ''; }, 2500);
  } catch (e) {
    console.warn('Firestore save failed:', e);
    if (indicator) indicator.textContent = '';
  }
}

async function loadFromFirestore() {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const db = await getDb();
    if (!db) return false;
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'interviews', user.uid, 'drafts', 'current'));
    if (snap.exists()) {
      const data = snap.data();
      state.currentSection = data.currentSection || 'A';
      state.currentColIndex = data.currentColIndex || 0;
      state.contract = data.contract || state.contract;
      return true;
    }
  } catch (e) {
    console.warn('Firestore load failed:', e);
  }
  return false;
}

async function clearFirestoreDraft() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const db = await getDb();
    if (!db) return;
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js');
    await deleteDoc(doc(db, 'interviews', user.uid, 'drafts', 'current'));
  } catch (e) { /* non-fatal */ }
}

// ── Column spec helpers ───────────────────────────────────────────────────────

function getOrCreateCol(name) {
  let col = state.contract.columns.find(c => c.name === name);
  if (!col) {
    col = {
      name, selected: true, col_type: 'text',
      rename_to: null,
      must_be_unique: null, on_duplicate: null, keep_duplicate: null, id_case: null,
      date_format_in: null, date_format_out: 'YYYY-MM-DD',
      decimal_places: null, rounding: 'half_up', numeric_symbols: null,
      valid_min: null, valid_max: null,
      valid_values: null, category_map: null, on_unmapped_category: 'report',
      missing_sentinels: null, missing_action: 'standardise',
      capitalisation: null, remove_chars: null, collapse_spaces: null,
      recode_map: null, recode_catchall: 'keep'
    };
    state.contract.columns.push(col);
  }
  return col;
}

function selectedCols() {
  return state.contract.columns.filter(c => c.selected);
}

// ── Navigation ────────────────────────────────────────────────────────────────

function showSection(sectionId) {
  document.querySelectorAll('.wizard-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  const page = document.getElementById(`interview-section-${sectionId}`);
  if (page) page.classList.add('active');
  const step = document.querySelector(`.wizard-step[data-section="${sectionId}"]`);
  if (step) step.classList.add('active');

  const btnBack = document.getElementById('wizard-btn-back');
  const btnNext = document.getElementById('wizard-btn-next');
  const btnSubmit = document.getElementById('wizard-btn-submit');
  const idx = SECTIONS.indexOf(sectionId);
  btnBack.style.visibility = idx === 0 ? 'hidden' : 'visible';
  if (sectionId === 'review') {
    btnNext.style.display = 'none';
    btnSubmit.style.display = 'block';
    buildReview();
  } else {
    btnNext.style.display = 'block';
    btnSubmit.style.display = 'none';
  }

  // Render dynamic sections
  if (sectionId === 'C') renderSectionC();
  if (sectionId === 'D') renderSectionD();
  if (sectionId === 'E') renderSectionE();
  if (sectionId === 'F') renderSectionF();
  if (sectionId === 'G') renderSectionG();
}

function nextSection() {
  collectCurrentSection();
  const idx = SECTIONS.indexOf(state.currentSection);
  if (idx < SECTIONS.length - 1) {
    // Section C stays until all columns are done
    if (state.currentSection === 'C' && !state.allColsDone) {
      advanceColumnC();
      return;
    }
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

// ── Section A: collect ────────────────────────────────────────────────────────

function collectA() {
  state.contract.file_name = document.getElementById('qa-filename').value.trim();
  state.contract.file_format = document.getElementById('qa-format').value;
  const sheet = document.getElementById('qa-sheet').value.trim();
  state.contract.sheet_name = sheet || null;
  state.contract.has_header = document.getElementById('qa-header').value === 'yes';
  state.contract.row_count_estimate = document.getElementById('qa-rows').value;
  state.contract.encoding = document.getElementById('qa-encoding').value;
  // Default output_name from file_name stem
  if (!state.contract.output_name || state.contract.output_name === 'cleaned') {
    const stem = state.contract.file_name.replace(/\.[^.]+$/, '') || 'cleaned';
    state.contract.output_name = stem + '_cleaned';
    const nameInput = document.getElementById('qh-name');
    if (nameInput && !nameInput.value) nameInput.value = state.contract.output_name;
  }
}

// ── Section B: file upload & column selection ─────────────────────────────────

function initSectionB() {
  const fileInput = document.getElementById('qb-file-upload');
  const status = document.getElementById('qb-file-status');
  const preview = document.getElementById('qb-column-preview');
  const manualArea = document.getElementById('qb-manual-cols');
  const selectionArea = document.getElementById('qb-selection-area');
  const checkboxesEl = document.getElementById('qb-column-checkboxes');

  function renderColumnCheckboxes(headers) {
    // Merge: preserve existing, add new
    const existing = new Set(state.contract.columns.map(c => c.name));
    headers.forEach(h => getOrCreateCol(h)); // ensures each column exists
    // Remove columns that disappeared (ask user)
    // For now: keep all existing, just add new ones

    checkboxesEl.innerHTML = '';
    state.contract.columns.forEach(col => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:0.4rem;cursor:pointer;background:var(--bg-body);border:1px solid var(--grey-200);border-radius:999px;padding:0.25rem 0.75rem;font-size:0.85rem;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = col.selected;
      cb.addEventListener('change', () => { col.selected = cb.checked; });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(col.name));
      checkboxesEl.appendChild(label);
    });
    selectionArea.style.display = 'block';

    // Column preview chips
    preview.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem;">${headers.length} columns detected:</p>` +
      `<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">${headers.map(h => `<span style="background:var(--mint);color:var(--navy-dark);font-size:0.78rem;padding:0.2rem 0.6rem;border-radius:999px;">${h}</span>`).join('')}</div>`;
    preview.style.display = 'block';
  }

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    status.textContent = 'Parsing file…';
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (!rows.length) { status.textContent = 'Could not read file.'; return; }
          const headers = rows[0].map(h => String(h).trim()).filter(Boolean);
          renderColumnCheckboxes(headers);
          status.textContent = `✓ ${headers.length} columns from "${wb.SheetNames[0]}"`;
          status.style.color = 'var(--sage-dark)';
        } catch (err) { status.textContent = `Error: ${err.message}`; }
      };
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true, preview: 5,
        complete: results => {
          if (results.meta && results.meta.fields) {
            renderColumnCheckboxes(results.meta.fields);
            status.textContent = `✓ ${results.meta.fields.length} columns from CSV`;
            status.style.color = 'var(--sage-dark)';
          } else {
            status.textContent = 'Could not read CSV. Check the first row has column headings.';
          }
        },
        error: err => { status.textContent = `Error: ${err.message}`; }
      });
    }
  });

  // Manual entry
  manualArea.addEventListener('blur', () => {
    const lines = manualArea.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length) {
      renderColumnCheckboxes(lines);
    }
  });

  // Select/deselect all
  document.getElementById('qb-select-all').addEventListener('click', () => {
    state.contract.columns.forEach(c => c.selected = true);
    checkboxesEl.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
  });
  document.getElementById('qb-deselect-all').addEventListener('click', () => {
    state.contract.columns.forEach(c => c.selected = false);
    checkboxesEl.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  });

  // Restore from state if columns already exist
  if (state.contract.columns.length) {
    renderColumnCheckboxes(state.contract.columns.map(c => c.name));
  }
}

// ── Section C: per-column type panel ─────────────────────────────────────────

function renderSectionC() {
  const cols = selectedCols();
  if (!cols.length) {
    document.getElementById('section-c-column-panel').innerHTML =
      '<p style="color:var(--text-muted);">No columns selected. Go back to Section B to select columns.</p>';
    state.allColsDone = true;
    checkDateOrderVisibility();
    return;
  }

  // Clamp index
  if (state.currentColIndex >= cols.length) {
    state.currentColIndex = cols.length - 1;
    state.allColsDone = true;
  }

  const col = cols[state.currentColIndex];
  const progress = document.getElementById('section-c-progress');
  progress.textContent = `Column ${state.currentColIndex + 1} of ${cols.length}: "${col.name}"`;

  const panel = document.getElementById('section-c-column-panel');
  panel.innerHTML = buildColTypePanel(col);
  attachColTypePanelListeners(col, panel);

  // Next button label
  const btnNext = document.getElementById('wizard-btn-next');
  if (state.currentColIndex < cols.length - 1) {
    btnNext.textContent = `Next column →`;
  } else {
    btnNext.textContent = 'Continue →';
    state.allColsDone = true;
  }

  checkDateOrderVisibility();
}

function buildColTypePanel(col) {
  const typeOptions = ['id', 'date', 'number', 'category', 'text']
    .map(t => `<option value="${t}" ${col.col_type === t ? 'selected' : ''}>${{id:'ID',date:'Date',number:'Number',category:'Category',text:'Leave as text'}[t]}</option>`)
    .join('');

  let typeSpecific = '';
  if (col.col_type === 'id') typeSpecific = buildIdPanel(col);
  else if (col.col_type === 'date') typeSpecific = buildDatePanel(col);
  else if (col.col_type === 'number') typeSpecific = buildNumberPanel(col);
  else if (col.col_type === 'category') typeSpecific = buildCategoryPanel(col);

  return `
    <div class="column-card" style="border:1px solid var(--grey-200);border-radius:var(--radius-md);padding:1.5rem;">
      <div class="form-group">
        <label>What kind of data is in <strong>"${col.name}"</strong>?</label>
        <select id="ctype-${col.name}">${typeOptions}</select>
      </div>
      <div class="form-group">
        <label><input type="checkbox" id="chas-missing-${col.name}" ${col.missing_sentinels ? 'checked' : ''}> This column has missing values</label>
      </div>
      <div id="type-specific-${col.name}">${typeSpecific}</div>
    </div>`;
}

function buildIdPanel(col) {
  return `
    <div class="form-group">
      <label>Should every record have a different value? (Must be unique?)</label>
      <select id="cid-unique-${col.name}">
        <option value="yes" ${col.must_be_unique==='yes'?'selected':''}>Yes, must be unique</option>
        <option value="no" ${col.must_be_unique==='no'?'selected':''}>No, repeats are expected</option>
        <option value="unsure" ${col.must_be_unique==='unsure'?'selected':''}>Not sure</option>
      </select>
    </div>
    <div id="cid-dup-panel-${col.name}" ${col.must_be_unique!=='yes'?'style="display:none;"':''}>
      <div class="form-group">
        <label>If duplicates are found:</label>
        <select id="cid-dup-${col.name}">
          <option value="report" ${col.on_duplicate==='report'?'selected':''}>Count and list in report only</option>
          <option value="remove" ${col.on_duplicate==='remove'?'selected':''}>Remove duplicate records</option>
        </select>
      </div>
      <div id="cid-keep-panel-${col.name}" ${col.on_duplicate!=='remove'?'style="display:none;"':''}>
        <div class="form-group">
          <label>Which record to keep?</label>
          <select id="cid-keep-${col.name}">
            <option value="first" ${col.keep_duplicate==='first'?'selected':''}>First occurrence</option>
            <option value="last" ${col.keep_duplicate==='last'?'selected':''}>Last occurrence</option>
          </select>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Standardise ID case to:</label>
      <select id="cid-case-${col.name}">
        <option value="none" ${col.id_case==='none'||!col.id_case?'selected':''}>Keep as is</option>
        <option value="upper" ${col.id_case==='upper'?'selected':''}>UPPERCASE</option>
        <option value="lower" ${col.id_case==='lower'?'selected':''}>lowercase</option>
      </select>
    </div>`;
}

function buildDatePanel(col) {
  const fmts = ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','mixed','unsure'];
  const fmtOpts = fmts.map(f => `<option value="${f}" ${col.date_format_in===f?'selected':''}>${f}</option>`).join('');
  const outFmts = ['YYYY-MM-DD','DD/MM/YYYY','keep'];
  const outOpts = outFmts.map(f => `<option value="${f}" ${col.date_format_out===f?'selected':''}>${f==='keep'?'Keep as they are':f}</option>`).join('');
  return `
    <div class="form-group">
      <label>What format do dates arrive in?</label>
      <select id="cdate-in-${col.name}">${fmtOpts}</select>
    </div>
    <div class="form-group">
      <label>What format should dates be in after cleaning?</label>
      <select id="cdate-out-${col.name}">${outOpts}</select>
    </div>`;
}

function buildNumberPanel(col) {
  return `
    <div class="form-group">
      <label>Should values have decimal places?</label>
      <select id="cnum-dec-${col.name}">
        <option value="integer" ${col.decimal_places===null?'selected':''}>No, whole numbers</option>
        <option value="decimal" ${col.decimal_places!==null?'selected':''}>Yes</option>
      </select>
    </div>
    <div id="cnum-places-panel-${col.name}" ${col.decimal_places===null?'style="display:none;"':''}>
      <div class="form-group">
        <label>How many decimal places?</label>
        <input type="number" id="cnum-places-${col.name}" min="1" max="10" value="${col.decimal_places||2}">
      </div>
    </div>
    <div class="form-group">
      <label>Do values contain symbols (£, %, commas)? List them:</label>
      <input type="text" id="cnum-syms-${col.name}" placeholder="e.g. £ % ," value="${(col.numeric_symbols||[]).join(' ')}">
    </div>
    <div class="form-group">
      <label>Valid range (optional — out-of-range values are flagged in report only):</label>
      <div style="display:flex;gap:1rem;">
        <input type="number" id="cnum-min-${col.name}" placeholder="Min" value="${col.valid_min??''}">
        <input type="number" id="cnum-max-${col.name}" placeholder="Max" value="${col.valid_max??''}">
      </div>
    </div>`;
}

function buildCategoryPanel(col) {
  const vv = (col.valid_values||[]).join('\n');
  const cm = col.category_map ? Object.entries(col.category_map).map(([k,v])=>`${k} → ${v}`).join('\n') : '';
  return `
    <div class="form-group">
      <label>What are the valid final values? (one per line)</label>
      <textarea id="ccat-valid-${col.name}" rows="3" placeholder="e.g.\nPass\nFail\nDeferred">${vv}</textarea>
    </div>
    <div class="form-group">
      <label>Map variants to valid values: (format: <em>variant → canonical</em>, one per line)</label>
      <textarea id="ccat-map-${col.name}" rows="4" placeholder="e.g.\npass → Pass\nPASSED → Pass\nFailed → Fail">${cm}</textarea>
    </div>
    <div class="form-group">
      <label>Values not in the list or mapping:</label>
      <select id="ccat-unmapped-${col.name}">
        <option value="report" ${col.on_unmapped_category==='report'?'selected':''}>Flag in report (recommended)</option>
        <option value="set_unknown" ${col.on_unmapped_category==='set_unknown'?'selected':''}>Set to "Unknown"</option>
        <option value="keep" ${col.on_unmapped_category==='keep'?'selected':''}>Keep unchanged</option>
      </select>
    </div>`;
}

function attachColTypePanelListeners(col, panel) {
  const typeSelect = panel.querySelector(`#ctype-${col.name}`);
  const typeSpecificEl = panel.querySelector(`#type-specific-${col.name}`);

  typeSelect.addEventListener('change', () => {
    col.col_type = typeSelect.value;
    if (col.col_type === 'id') typeSpecificEl.innerHTML = buildIdPanel(col);
    else if (col.col_type === 'date') typeSpecificEl.innerHTML = buildDatePanel(col);
    else if (col.col_type === 'number') typeSpecificEl.innerHTML = buildNumberPanel(col);
    else if (col.col_type === 'category') typeSpecificEl.innerHTML = buildCategoryPanel(col);
    else typeSpecificEl.innerHTML = '';
    attachTypeSpecificListeners(col, typeSpecificEl);
  });

  panel.querySelector(`#chas-missing-${col.name}`).addEventListener('change', e => {
    if (e.target.checked && !col.missing_sentinels) col.missing_sentinels = ['', 'NA', 'N/A'];
    else if (!e.target.checked) col.missing_sentinels = null;
  });

  attachTypeSpecificListeners(col, typeSpecificEl);
}

function attachTypeSpecificListeners(col, el) {
  if (!el) return;
  // ID
  const uniq = el.querySelector(`#cid-unique-${col.name}`);
  if (uniq) {
    uniq.addEventListener('change', () => {
      col.must_be_unique = uniq.value;
      const p = el.querySelector(`#cid-dup-panel-${col.name}`);
      if (p) p.style.display = uniq.value === 'yes' ? '' : 'none';
    });
    const dup = el.querySelector(`#cid-dup-${col.name}`);
    if (dup) {
      dup.addEventListener('change', () => {
        col.on_duplicate = dup.value;
        const kp = el.querySelector(`#cid-keep-panel-${col.name}`);
        if (kp) kp.style.display = dup.value === 'remove' ? '' : 'none';
      });
    }
  }
  // Number
  const decSel = el.querySelector(`#cnum-dec-${col.name}`);
  if (decSel) {
    decSel.addEventListener('change', () => {
      const pp = el.querySelector(`#cnum-places-panel-${col.name}`);
      if (pp) pp.style.display = decSel.value === 'decimal' ? '' : 'none';
      if (decSel.value === 'integer') col.decimal_places = null;
    });
  }
}

function collectColCPanel(col, panel) {
  if (!panel) return;
  const typeEl = panel.querySelector(`#ctype-${col.name}`);
  if (typeEl) col.col_type = typeEl.value;

  const hasMissing = panel.querySelector(`#chas-missing-${col.name}`);
  if (hasMissing && !hasMissing.checked) col.missing_sentinels = null;

  const ts = panel.querySelector(`#type-specific-${col.name}`);
  if (!ts) return;

  if (col.col_type === 'id') {
    col.must_be_unique = ts.querySelector(`#cid-unique-${col.name}`)?.value || null;
    col.on_duplicate = ts.querySelector(`#cid-dup-${col.name}`)?.value || null;
    col.keep_duplicate = ts.querySelector(`#cid-keep-${col.name}`)?.value || null;
    col.id_case = ts.querySelector(`#cid-case-${col.name}`)?.value || null;
  } else if (col.col_type === 'date') {
    col.date_format_in = ts.querySelector(`#cdate-in-${col.name}`)?.value || null;
    col.date_format_out = ts.querySelector(`#cdate-out-${col.name}`)?.value || 'YYYY-MM-DD';
  } else if (col.col_type === 'number') {
    const decSel = ts.querySelector(`#cnum-dec-${col.name}`);
    col.decimal_places = decSel?.value === 'decimal'
      ? parseInt(ts.querySelector(`#cnum-places-${col.name}`)?.value || '2') : null;
    const syms = ts.querySelector(`#cnum-syms-${col.name}`)?.value.trim();
    col.numeric_symbols = syms ? syms.split(/\s+/) : null;
    const mn = ts.querySelector(`#cnum-min-${col.name}`)?.value;
    const mx = ts.querySelector(`#cnum-max-${col.name}`)?.value;
    col.valid_min = mn !== '' && mn != null ? parseFloat(mn) : null;
    col.valid_max = mx !== '' && mx != null ? parseFloat(mx) : null;
  } else if (col.col_type === 'category') {
    const vvRaw = ts.querySelector(`#ccat-valid-${col.name}`)?.value.trim();
    col.valid_values = vvRaw ? vvRaw.split('\n').map(s => s.trim()).filter(Boolean) : null;
    const cmRaw = ts.querySelector(`#ccat-map-${col.name}`)?.value.trim();
    if (cmRaw) {
      col.category_map = {};
      cmRaw.split('\n').forEach(line => {
        const parts = line.split('→');
        if (parts.length === 2) col.category_map[parts[0].trim()] = parts[1].trim();
      });
    }
    col.on_unmapped_category = ts.querySelector(`#ccat-unmapped-${col.name}`)?.value || 'report';
  }
}

function advanceColumnC() {
  // Save current column
  const cols = selectedCols();
  const col = cols[state.currentColIndex];
  const panel = document.getElementById('section-c-column-panel');
  collectColCPanel(col, panel);

  state.currentColIndex++;
  if (state.currentColIndex >= cols.length) {
    state.allColsDone = true;
    checkDateOrderVisibility();
  }
  renderSectionC();
}

function checkDateOrderVisibility() {
  const dateColsExist = selectedCols().some(c => c.col_type === 'date');
  const section = document.getElementById('qc5-date-order-section');
  if (section) section.style.display = (state.allColsDone && dateColsExist) ? '' : 'none';
}

// Date order rule UI
function initDateOrderUI() {
  document.getElementById('qc5-add-rule').addEventListener('click', () => {
    const dateCols = selectedCols().filter(c => c.col_type === 'date').map(c => c.name);
    const opts = dateCols.map(n => `<option>${n}</option>`).join('');
    const rule = { earlier_col: dateCols[0] || '', later_col: dateCols[1] || dateCols[0] || '', on_violation: 'report' };
    state.contract.date_order_rules.push(rule);
    const list = document.getElementById('qc5-rules-list');
    const idx = state.contract.date_order_rules.length - 1;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:0.75rem;align-items:center;margin-bottom:0.5rem;';
    div.innerHTML = `
      <select class="dor-earlier" data-idx="${idx}">${opts}</select>
      <span>must come before</span>
      <select class="dor-later" data-idx="${idx}">${opts}</select>
      <select class="dor-action" data-idx="${idx}">
        <option value="report">Report only</option>
        <option value="blank_later">Blank the later date</option>
      </select>
      <button type="button" class="btn-ghost btn-small dor-remove" data-idx="${idx}">✕</button>`;
    list.appendChild(div);
    div.querySelector('.dor-earlier').addEventListener('change', e => { state.contract.date_order_rules[idx].earlier_col = e.target.value; });
    div.querySelector('.dor-later').addEventListener('change', e => { state.contract.date_order_rules[idx].later_col = e.target.value; });
    div.querySelector('.dor-action').addEventListener('change', e => { state.contract.date_order_rules[idx].on_violation = e.target.value; });
    div.querySelector('.dor-remove').addEventListener('click', () => {
      state.contract.date_order_rules.splice(idx, 1);
      div.remove();
    });
  });
}

// ── Section D: missing values ─────────────────────────────────────────────────

function renderSectionD() {
  const cols = selectedCols().filter(c => c.missing_sentinels !== null);
  const panels = document.getElementById('section-d-panels');
  const empty = document.getElementById('section-d-empty');
  if (!cols.length) {
    panels.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  panels.innerHTML = cols.map(col => `
    <div class="column-card" style="border:1px solid var(--grey-200);border-radius:var(--radius-md);padding:1.25rem;margin-bottom:1rem;">
      <h3 style="margin:0 0 0.75rem;font-size:1rem;">"${col.name}"</h3>
      <div class="form-group">
        <label>What represents "missing" in this column? (comma-separated)</label>
        <input type="text" id="dmiss-sent-${col.name}" value="${(col.missing_sentinels||[]).join(', ')}" placeholder="blank, NA, N/A, 99">
      </div>
      <div class="form-group">
        <label>What should the script do with missing values?</label>
        <select id="dmiss-action-${col.name}">
          <option value="standardise" ${col.missing_action==='standardise'?'selected':''}>Standardise to empty and report count</option>
          <option value="replace:Unknown" ${col.missing_action?.startsWith('replace:')?'selected':''}>Replace with a label</option>
          <option value="remove_record" ${col.missing_action==='remove_record'?'selected':''}>Remove the whole record</option>
          <option value="report_only" ${col.missing_action==='report_only'?'selected':''}>Report count only</option>
        </select>
      </div>
      <div id="dmiss-label-${col.name}" style="${col.missing_action?.startsWith('replace:') ? '' : 'display:none;'}">
        <div class="form-group">
          <label>Replacement label:</label>
          <input type="text" id="dmiss-label-val-${col.name}" value="${col.missing_action?.startsWith('replace:') ? col.missing_action.split(':')[1] : 'Unknown'}">
        </div>
      </div>
    </div>`).join('');

  cols.forEach(col => {
    const actionSel = document.getElementById(`dmiss-action-${col.name}`);
    const labelDiv = document.getElementById(`dmiss-label-${col.name}`);
    actionSel?.addEventListener('change', () => {
      if (labelDiv) labelDiv.style.display = actionSel.value === 'replace:Unknown' ? '' : 'none';
    });
  });
}

function collectD() {
  selectedCols().filter(c => c.missing_sentinels !== null).forEach(col => {
    const sent = document.getElementById(`dmiss-sent-${col.name}`)?.value;
    col.missing_sentinels = sent ? sent.split(',').map(s => s.trim()).filter(Boolean) : null;
    const action = document.getElementById(`dmiss-action-${col.name}`)?.value;
    if (action === 'replace:Unknown') {
      const label = document.getElementById(`dmiss-label-val-${col.name}`)?.value || 'Unknown';
      col.missing_action = `replace:${label}`;
    } else {
      col.missing_action = action || 'standardise';
    }
  });
}

// ── Section E: rename ─────────────────────────────────────────────────────────

function renderSectionE() {
  document.getElementById('section-e-panels').innerHTML = selectedCols().map(col => `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.75rem;">
      <span style="min-width:200px;font-weight:500;">"${col.name}"</span>
      <span style="color:var(--text-muted);">→</span>
      <input type="text" id="erename-${col.name}" placeholder="Leave blank to keep original name" value="${col.rename_to||''}" style="flex:1;">
    </div>`).join('');
}

function collectE() {
  selectedCols().forEach(col => {
    const v = document.getElementById(`erename-${col.name}`)?.value.trim();
    col.rename_to = v || null;
  });
}

// ── Section F: cleaning actions ───────────────────────────────────────────────

function renderSectionF() {
  document.getElementById('section-f-panels').innerHTML = selectedCols().map(col => `
    <div class="column-card" style="border:1px solid var(--grey-200);border-radius:var(--radius-md);padding:1.25rem;margin-bottom:1rem;">
      <h3 style="margin:0 0 0.75rem;font-size:1rem;">"${col.name}" [${col.col_type}]</h3>
      <div class="form-group">
        <label>Capitalisation:</label>
        <select id="fcap-${col.name}">
          <option value="" ${!col.capitalisation?'selected':''}>No change</option>
          <option value="upper" ${col.capitalisation==='upper'?'selected':''}>UPPERCASE</option>
          <option value="lower" ${col.capitalisation==='lower'?'selected':''}>lowercase</option>
          <option value="title" ${col.capitalisation==='title'?'selected':''}>Title Case</option>
        </select>
      </div>
      <div class="form-group">
        <label>Remove characters or patterns:</label>
        <input type="text" id="fremove-${col.name}" placeholder="e.g. # * ?" value="${col.remove_chars||''}">
      </div>
      ${col.col_type === 'text' ? `
      <div class="form-group">
        <label><input type="checkbox" id="fcollapse-${col.name}" ${col.collapse_spaces?'checked':''}> Collapse repeated internal spaces</label>
      </div>` : ''}
    </div>`).join('');
}

function collectF() {
  selectedCols().forEach(col => {
    const cap = document.getElementById(`fcap-${col.name}`)?.value;
    col.capitalisation = cap || null;
    const rm = document.getElementById(`fremove-${col.name}`)?.value.trim();
    col.remove_chars = rm || null;
    const collapse = document.getElementById(`fcollapse-${col.name}`);
    col.collapse_spaces = collapse ? collapse.checked : null;
  });
}

// ── Section G: recode ─────────────────────────────────────────────────────────

function renderSectionG() {
  const checkboxes = document.getElementById('qg-column-checkboxes');
  checkboxes.innerHTML = selectedCols().map(col => `
    <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;background:var(--bg-body);border:1px solid var(--grey-200);border-radius:999px;padding:0.25rem 0.75rem;font-size:0.85rem;">
      <input type="checkbox" class="qg-col-cb" data-col="${col.name}" ${col.recode_map?.length ? 'checked' : ''}> ${col.name}
    </label>`).join('');

  function updateGPanels() {
    const selected = [...document.querySelectorAll('.qg-col-cb:checked')].map(cb => cb.dataset.col);
    document.getElementById('section-g-panels').innerHTML = selected.map(name => {
      const col = state.contract.columns.find(c => c.name === name);
      const rows = (col.recode_map || []).map((r, i) => `
        <tr>
          <td><input type="text" class="recode-old" data-col="${name}" data-idx="${i}" value="${r.old_values.join(', ')}" placeholder="Old value(s), comma-separated"></td>
          <td><input type="text" class="recode-new" data-col="${name}" data-idx="${i}" value="${r.new_value}" placeholder="New value"></td>
          <td><input type="text" class="recode-cond" data-col="${name}" data-idx="${i}" value="${r.condition||''}" placeholder="Optional condition"></td>
          <td><button type="button" class="btn-ghost btn-small recode-del" data-col="${name}" data-idx="${i}">✕</button></td>
        </tr>`).join('');
      return `
        <div style="border:1px solid var(--grey-200);border-radius:var(--radius-md);padding:1.25rem;margin-bottom:1rem;">
          <h3 style="margin:0 0 0.75rem;font-size:1rem;">"${name}"</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:0.5rem;">
            <thead><tr><th>Old value(s)</th><th>New value</th><th>Condition (optional)</th><th></th></tr></thead>
            <tbody id="recode-tbody-${name}">${rows}</tbody>
          </table>
          <button type="button" class="btn-ghost btn-small" id="recode-add-${name}">+ Add row</button>
          <div class="form-group" style="margin-top:1rem;">
            <label>Values not covered by the mapping:</label>
            <select id="recode-catch-${name}">
              <option value="keep" ${(col.recode_catchall||'keep')==='keep'?'selected':''}>Keep unchanged</option>
              <option value="set_unknown" ${col.recode_catchall==='set_unknown'?'selected':''}>Set to "Unknown"</option>
              <option value="report" ${col.recode_catchall==='report'?'selected':''}>Flag in report</option>
            </select>
          </div>
        </div>`;
    }).join('');

    selected.forEach(name => {
      const col = state.contract.columns.find(c => c.name === name);
      if (!col.recode_map) col.recode_map = [];
      document.getElementById(`recode-add-${name}`)?.addEventListener('click', () => {
        col.recode_map.push({ old_values: [], new_value: '', condition: null });
        updateGPanels();
      });
    });

    document.querySelectorAll('.recode-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = state.contract.columns.find(c => c.name === btn.dataset.col);
        col.recode_map.splice(parseInt(btn.dataset.idx), 1);
        updateGPanels();
      });
    });
  }

  checkboxes.querySelectorAll('.qg-col-cb').forEach(cb => cb.addEventListener('change', updateGPanels));
  updateGPanels();
}

function collectG() {
  selectedCols().forEach(col => {
    const tbody = document.getElementById(`recode-tbody-${col.name}`);
    if (!tbody) { col.recode_map = null; return; }
    const rows = [...tbody.querySelectorAll('tr')];
    col.recode_map = rows.map((_, i) => ({
      old_values: (tbody.querySelector(`.recode-old[data-idx="${i}"]`)?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      new_value: tbody.querySelector(`.recode-new[data-idx="${i}"]`)?.value?.trim() || '',
      condition: tbody.querySelector(`.recode-cond[data-idx="${i}"]`)?.value?.trim() || null
    })).filter(r => r.old_values.length || r.new_value);
    if (!col.recode_map.length) col.recode_map = null;
    col.recode_catchall = document.getElementById(`recode-catch-${col.name}`)?.value || 'keep';
  });
}

// ── Section H: collect ────────────────────────────────────────────────────────

function collectH() {
  state.contract.output_name = document.getElementById('qh-name').value.trim() || 'cleaned';
  state.contract.output_format = document.getElementById('qh-format').value;
}

// ── Generic collect dispatcher ─────────────────────────────────────────────────

function collectCurrentSection() {
  switch (state.currentSection) {
    case 'A': collectA(); break;
    case 'C': {
      // collect current column before advancing
      const cols = selectedCols();
      if (cols.length && state.currentColIndex < cols.length) {
        const col = cols[state.currentColIndex];
        collectColCPanel(col, document.getElementById('section-c-column-panel'));
      }
      break;
    }
    case 'D': collectD(); break;
    case 'E': collectE(); break;
    case 'F': collectF(); break;
    case 'G': collectG(); break;
    case 'H': collectH(); break;
  }
}

// ── Review screen ─────────────────────────────────────────────────────────────

function buildReview() {
  const c = state.contract;
  let html = `
    <div style="background:var(--bg-body);border-radius:var(--radius-md);padding:1.25rem;margin-bottom:1rem;">
      <h3 style="margin:0 0 0.5rem;">File: ${c.file_name || '(not set)'}</h3>
      <p style="margin:0;font-size:0.88rem;color:var(--text-muted);">Format: ${c.file_format} · Rows: ${c.row_count_estimate} · Encoding: ${c.encoding}</p>
    </div>`;

  html += `<h3 style="font-size:1rem;margin-bottom:0.5rem;">Columns</h3>`;
  selectedCols().forEach(col => {
    html += `<div style="background:var(--white);border:1px solid var(--grey-200);border-radius:var(--radius-md);padding:1rem;margin-bottom:0.6rem;">
      <strong>"${col.name}"</strong> [${col.col_type}]`;
    if (col.rename_to) html += ` → renamed to <em>"${col.rename_to}"</em>`;
    html += '<br><span style="font-size:0.85rem;color:var(--text-muted);">';
    if (col.must_be_unique === 'yes') html += `Must be unique; duplicates: ${col.on_duplicate}. `;
    if (col.id_case && col.id_case !== 'none') html += `Case: ${col.id_case}. `;
    if (col.date_format_in) html += `Date in: ${col.date_format_in} → out: ${col.date_format_out}. `;
    if (col.valid_values?.length) html += `Valid values: ${col.valid_values.join(', ')}. `;
    if (col.missing_sentinels?.length) html += `Missing (${col.missing_sentinels.join(', ')}) → ${col.missing_action}. `;
    if (col.recode_map?.length) html += `${col.recode_map.length} recode rule(s). `;
    html += '</span></div>';
  });

  if (c.date_order_rules.length) {
    html += `<h3 style="font-size:1rem;margin-top:1rem;margin-bottom:0.5rem;">Date ordering rules</h3>`;
    c.date_order_rules.forEach(r => {
      html += `<p style="font-size:0.88rem;">"${r.earlier_col}" before "${r.later_col}" — violation: ${r.on_violation}</p>`;
    });
  }

  html += `<h3 style="font-size:1rem;margin-top:1rem;margin-bottom:0.5rem;">Output</h3>
    <p style="font-size:0.88rem;">${c.output_name} (${c.output_format})</p>`;

  document.getElementById('review-content').innerHTML = html;
}

// ── Submit: assemble contract and POST ────────────────────────────────────────

async function submitInterview() {
  const btn = document.getElementById('wizard-btn-submit');
  const saving = document.getElementById('review-saving');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  saving.style.display = '';

  collectH();
  await saveToFirestore();

  // Build the contract JSON matching backend DataContract
  const contract = {
    file_name: state.contract.file_name,
    file_format: state.contract.file_format,
    sheet_name: state.contract.sheet_name,
    has_header: state.contract.has_header,
    row_count_estimate: state.contract.row_count_estimate,
    encoding: state.contract.encoding,
    columns: state.contract.columns,
    date_order_rules: state.contract.date_order_rules,
    output_name: state.contract.output_name,
    output_format: state.contract.output_format
  };

  try {
    const resp = await fetch(`${BACKEND_URL}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contract)
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const scriptContent = await resp.text();

    // Download
    const blob = new Blob([scriptContent], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (state.contract.output_name || 'cleaned').replace(/[^a-z0-9_]/gi, '_');
    a.download = `${safeName}.py`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Clear draft
    await clearFirestoreDraft();

    // Switch to My Scripts view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-scripts')?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-view="scripts"]')?.classList.add('active');

  } catch (err) {
    alert('Failed to generate script: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Approve & Generate';
    saving.style.display = 'none';
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Try to restore from Firestore (waits for auth)
  auth.onAuthStateChanged(async user => {
    if (user) {
      const restored = await loadFromFirestore();
      if (restored) {
        showSection(state.currentSection);
      }
    }
  });

  // Procedure card → start interview
  document.getElementById('proc-audit')?.addEventListener('click', () => {
    // Switch view
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-questionnaire')?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    state.currentSection = 'A';
    showSection('A');
  });

  // "Start interview" continue bar button
  document.getElementById('btn-continue')?.addEventListener('click', () => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-questionnaire')?.classList.add('active');
    state.currentSection = 'A';
    showSection('A');
  });

  // Keyboard on proc-audit card
  document.getElementById('proc-audit')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') e.target.click();
  });

  // Next / Back
  document.getElementById('wizard-btn-next')?.addEventListener('click', nextSection);
  document.getElementById('wizard-btn-back')?.addEventListener('click', prevSection);
  document.getElementById('wizard-btn-submit')?.addEventListener('click', submitInterview);

  // Section A: show sheet input for Excel
  document.getElementById('qa-format')?.addEventListener('change', e => {
    const sheetGroup = document.getElementById('qa-sheet-group');
    if (sheetGroup) sheetGroup.style.display = ['xlsx', 'xls'].includes(e.target.value) ? '' : 'none';
  });

  // Section B init
  initSectionB();

  // Date order rule UI
  initDateOrderUI();

  // Show first section
  showSection('A');
});
