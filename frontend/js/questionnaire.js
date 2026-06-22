document.addEventListener('DOMContentLoaded', () => {

  let selectedProcs = [];
  let currentStep = 1;
  const totalSteps = 5;

  const btnNext = document.getElementById('wizard-btn-next');
  const btnBack = document.getElementById('wizard-btn-back');
  const btnSubmit = document.getElementById('wizard-btn-submit');
  
  const stepMapping = {
    1: '1',
    2: 'diagnose',
    3: 'crosscol',
    4: 'link',
    5: '5'
  };

  // Listen for the start of the wizard
  document.addEventListener('start-questionnaire', (e) => {
    let procs = e.detail.procs;
    
    // Apply user logic rules:
    // Link Datasets -> requires Cross-Column and Diagnose
    if (procs.includes('link') && !procs.includes('crosscol')) procs.push('crosscol');
    // Cross-Column -> requires Diagnose
    if (procs.includes('crosscol') && !procs.includes('diagnose')) procs.push('diagnose');

    selectedProcs = procs;
    currentStep = 1;
    
    // Setup progress bar visibility
    document.getElementById('nav-step-diag').style.display = selectedProcs.includes('diagnose') ? 'block' : 'none';
    document.getElementById('nav-step-cross').style.display = selectedProcs.includes('crosscol') ? 'block' : 'none';
    document.getElementById('nav-step-link').style.display = selectedProcs.includes('link') ? 'block' : 'none';
    
    updateWizardUI();
  });

  function getNextValidStep(step, direction) {
    let nextStep = step + direction;
    while(nextStep > 1 && nextStep < totalSteps) {
      const procNeeded = stepMapping[nextStep];
      if (selectedProcs.includes(procNeeded)) {
        return nextStep;
      }
      nextStep += direction;
    }
    return nextStep;
  }

  function updateWizardUI() {
    // Hide all pages
    for (let i = 1; i <= totalSteps; i++) {
      const page = document.getElementById(`wizard-page-${i}`);
      const nav = document.querySelector(`.wizard-step[data-step="${i}"]`);
      if (page) page.classList.remove('active');
      if (nav) nav.classList.remove('active');
    }

    // Show current page
    const currentPage = document.getElementById(`wizard-page-${currentStep}`);
    const currentNav = document.querySelector(`.wizard-step[data-step="${currentStep}"]`);
    if (currentPage) currentPage.classList.add('active');
    if (currentNav) currentNav.classList.add('active');

    // Update buttons
    if (currentStep === 1) {
      btnBack.style.visibility = 'hidden';
    } else {
      btnBack.style.visibility = 'visible';
    }

    if (currentStep === totalSteps) {
      btnNext.style.display = 'none';
      btnSubmit.style.display = 'block';
      buildSummary();
    } else {
      btnNext.style.display = 'block';
      btnSubmit.style.display = 'none';
    }
  }

  btnNext?.addEventListener('click', () => {
    currentStep = getNextValidStep(currentStep, 1);
    updateWizardUI();
  });

  btnBack?.addEventListener('click', () => {
    currentStep = getNextValidStep(currentStep, -1);
    updateWizardUI();
  });

  btnSubmit?.addEventListener('click', async () => {
    // 1. Build the data contract
    const contract = {
      dataset_name: document.getElementById('q-dataset-name').value || "Unnamed Dataset",
      dataset_format: document.getElementById('q-dataset-format').value,
      dataset_encoding: document.getElementById('q-dataset-encoding').value,
      dataset_rows: document.getElementById('q-dataset-rows').value || "Unknown",
      selected_procedures: selectedProcs,
      columns_to_clean: [],
      cross_col_description: null,
      cross_col_rules: [],
      link_config: null
    };

    if (selectedProcs.includes('diagnose')) {
      const diagnosePath = document.querySelector('input[name="diagnose_path"]:checked').value;
      if (diagnosePath === 'upload' && parsedDummyData) {
        // Path A
        contract.columns_to_clean = parsedDummyData.headers.map(h => ({
          name: h,
          expected_type: 'unsure',
          meaning: 'Extracted from uploaded dummy data'
        }));
        // We could also pass parsedDummyData.sample_rows to the backend if needed, 
        // but for now, we just pass the headers.
      } else {
        // Path B
        const colCards = document.querySelectorAll('.column-card');
        colCards.forEach(card => {
          const typeSelect = card.querySelector('.col-type');
          const missingSelect = card.querySelector('.col-missing');
          const missingCode = card.querySelector('.col-missing-code');
          const contextVal = card.querySelector('.col-context-val');

          contract.columns_to_clean.push({
            name: card.querySelector('.col-name').value || "Unnamed",
            expected_type: typeSelect ? typeSelect.value : 'text',
            missing_values: missingSelect ? missingSelect.value : 'no',
            missing_code: missingCode ? missingCode.value : '',
            context: contextVal ? contextVal.value : '',
            meaning: card.querySelector('.col-meaning').value || ""
          });
        });
      }
    }

    if (selectedProcs.includes('crosscol')) {
      contract.cross_col_description = document.getElementById('q-crosscol-desc').value;
      contract.cross_col_rules = []; // We removed the checkboxes, it's just free text now
    }

    if (selectedProcs.includes('link')) {
      contract.link_config = {
        link_problem: document.getElementById('q-link-problem').value,
        link_primary: document.getElementById('q-link-primary').value,
        link_names: document.getElementById('q-link-names').value,
        link_keys: document.getElementById('q-link-keys').value,
        link_consistency: document.getElementById('q-link-consistency').value,
        link_match_type: document.getElementById('q-link-match-type').value,
        link_join_type: document.getElementById('q-link-join-type').value,
        link_on_unmatched: document.getElementById('q-link-on-unmatched').value
      };
    }

    // Update UI to show loading state
    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = "Generating...";
    btnSubmit.disabled = true;

    try {
      // 2. Send to backend
      const response = await fetch('http://127.0.0.1:8000/api/generate-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contract)
      });

      if (!response.ok) {
        throw new Error("Server responded with " + response.status);
      }

      const scriptContent = await response.text();

      // 3. Trigger download of the python file
      const blob = new Blob([scriptContent], { type: 'text/x-python' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Create a nice filename
      let safeName = contract.dataset_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!safeName) safeName = "dataset";
      a.download = `clean_${safeName}.py`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Switch to scripts view
      const views = document.querySelectorAll('.view');
      views.forEach(v => v.classList.remove('active'));
      document.getElementById('view-scripts').classList.add('active');
      
      const navItems = document.querySelectorAll('.nav-item');
      navItems.forEach(n => n.classList.remove('active'));
      const scriptsNav = document.querySelector('.nav-item[data-view="scripts"]');
      if(scriptsNav) scriptsNav.classList.add('active');

    } catch (err) {
      alert("Failed to generate script: " + err.message + "\\n\\nMake sure the local FastAPI backend is running on port 8000!");
      console.error(err);
    } finally {
      btnSubmit.textContent = originalText;
      btnSubmit.disabled = false;
    }
  });

  /* ── Diagnose Path Toggle ── */
  const pathRadios = document.querySelectorAll('input[name="diagnose_path"]');
  const pathA = document.getElementById('path-a-upload');
  const pathB = document.getElementById('path-b-form');
  
  pathRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'upload') {
        pathA.style.display = 'block';
        pathB.style.display = 'none';
      } else {
        pathA.style.display = 'none';
        pathB.style.display = 'block';
      }
    });
  });

  /* ── Path A: CSV Parsing ── */
  let parsedDummyData = null; // Store { headers: [], sample_rows: [] }
  const fileInput = document.getElementById('dummy-file-upload');
  const fileStatus = document.getElementById('dummy-file-status');
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      Papa.parse(file, {
        header: true,
        preview: 3, // only read first 3 rows for privacy/speed
        complete: function(results) {
          if (results.meta && results.meta.fields) {
            parsedDummyData = {
              headers: results.meta.fields,
              sample_rows: results.data
            };
            fileStatus.textContent = `Successfully extracted ${results.meta.fields.length} headers and 3 sample rows.`;
          } else {
            fileStatus.textContent = `Error reading CSV. Please ensure it has headers.`;
            fileStatus.style.color = '#c94040';
          }
        },
        error: function(err) {
          fileStatus.textContent = `Error: ${err.message}`;
          fileStatus.style.color = '#c94040';
        }
      });
    });
  }

  /* ── Dynamic Column Builder for Path B ── */
  const btnAddColumn = document.getElementById('btn-add-column');
  const columnList = document.getElementById('column-list');
  let columnCount = 0;

  function createColumnCard() {
    columnCount++;
    const id = columnCount;
    const div = document.createElement('div');
    div.className = 'column-card';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
        <h3 style="margin:0; font-size:1rem; color:var(--navy-dark);">Column ${id}</h3>
        <button type="button" class="btn-ghost btn-small remove-column" data-id="${id}" style="color:#c94040; border-color:#f2dfde;">Remove</button>
      </div>
      <div class="form-row" style="display:flex; gap:1rem;">
        <div class="form-group" style="flex:1;">
          <label>Column header</label>
          <input type="text" class="col-name" placeholder="Exactly as in file">
        </div>
        <div class="form-group" style="flex:1;">
          <label>Data type</label>
          <select class="col-type">
            <option value="text">Free text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="category">Category</option>
            <option value="identifier">Identifier (ID)</option>
            <option value="unsure">Unsure</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Are there missing values?</label>
        <select class="col-missing">
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
        <input type="text" class="col-missing-code" placeholder="If yes, how are they coded? (e.g. NA, blank)" style="display:none; margin-top:0.5rem;">
      </div>
      <div class="form-group col-context-group">
        <!-- Contextual options injected here -->
      </div>
      <div class="form-group">
        <label>What should the clean data look like?</label>
        <input type="text" class="col-meaning" placeholder="e.g. Group numbers into categories, format dates to DD/MM/YYYY">
      </div>
    `;

    // Event listeners for dynamic fields
    const missingSelect = div.querySelector('.col-missing');
    const missingCode = div.querySelector('.col-missing-code');
    missingSelect.addEventListener('change', (e) => {
      missingCode.style.display = e.target.value === 'yes' ? 'block' : 'none';
    });

    const typeSelect = div.querySelector('.col-type');
    const contextGroup = div.querySelector('.col-context-group');
    typeSelect.addEventListener('change', (e) => {
      const type = e.target.value;
      let html = '';
      if (type === 'number') {
        html = `<label>Number constraints</label><input type="text" class="col-context-val" placeholder="e.g. Must be whole number, range 0-100">`;
      } else if (type === 'date') {
        html = `<label>Current date format</label><input type="text" class="col-context-val" placeholder="e.g. DD-MM-YYYY or text like '1st Jan'">`;
      } else if (type === 'category') {
        html = `<label>Allowed categories</label><input type="text" class="col-context-val" placeholder="e.g. Male, Female, Non-binary">`;
      } else if (type === 'unsure') {
        html = `<label>Dummy samples</label><input type="text" class="col-context-val" placeholder="Provide a few examples of the data">`;
      }
      contextGroup.innerHTML = html;
    });

    return div;
  }

  btnAddColumn?.addEventListener('click', () => {
    columnList.appendChild(createColumnCard());
  });

  // Handle remove column
  columnList?.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-column')) {
      e.target.closest('.column-card').remove();
    }
  });

  // Add one empty column by default
  if (columnList) {
    columnList.appendChild(createColumnCard());
  }

  function buildSummary() {
    const summaryContainer = document.getElementById('confirmation-summary');
    if (!summaryContainer) return;

    const datasetName = document.getElementById('q-dataset-name').value || "Unnamed Dataset";
    const datasetFormat = document.getElementById('q-dataset-format').value;
    const datasetRows = document.getElementById('q-dataset-rows').value || "Unknown";

    let html = `
      <div style="background:var(--white); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--grey-200); margin-bottom: 1rem;">
        <h3 style="margin-top:0;">Dataset: ${datasetName}</h3>
        <p style="margin:0; font-size:0.9rem; color:var(--text-muted);">Format: ${datasetFormat} | Rows: ${datasetRows}</p>
      </div>
    `;

    if (selectedProcs.includes('diagnose')) {
      const diagnosePath = document.querySelector('input[name="diagnose_path"]:checked').value;
      if (diagnosePath === 'upload' && parsedDummyData) {
        html += `<h4>Columns to clean (${parsedDummyData.headers.length})</h4><ul style="margin-bottom:1rem; padding-left:1.5rem; color:var(--text-muted);">`;
        parsedDummyData.headers.forEach(h => html += `<li>${h} (from dummy data)</li>`);
        html += `</ul>`;
      } else {
        const colCards = document.querySelectorAll('.column-card');
        html += `<h4>Columns to clean (${colCards.length})</h4><ul style="margin-bottom:1rem; padding-left:1.5rem; color:var(--text-muted);">`;
        colCards.forEach(card => {
          const name = card.querySelector('.col-name').value || "Unnamed column";
          html += `<li>${name}</li>`;
        });
        html += `</ul>`;
      }
    }

    if (selectedProcs.includes('crosscol')) {
      const desc = document.getElementById('q-crosscol-desc').value;
      html += `<h4>Cross-column rules</h4><p style="font-size:0.9rem; color:var(--text-muted);">${desc || 'None specified'}</p>`;
    }

    if (selectedProcs.includes('link')) {
      const linkNames = document.getElementById('q-link-names').value || "Unnamed datasets";
      html += `<h4>Link Datasets</h4><p style="font-size:0.9rem; color:var(--text-muted);">${linkNames}</p>`;
    }

    summaryContainer.innerHTML = html;
  }

});
