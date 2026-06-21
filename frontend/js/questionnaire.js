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
    selectedProcs = e.detail.procs;
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
      const colCards = document.querySelectorAll('.column-card');
      colCards.forEach(card => {
        contract.columns_to_clean.push({
          name: card.querySelector('.col-name').value || "Unnamed",
          expected_type: card.querySelector('.col-type').value,
          meaning: card.querySelector('.col-meaning').value || ""
        });
      });
    }

    if (selectedProcs.includes('crosscol')) {
      contract.cross_col_description = document.getElementById('q-crosscol-desc').value;
      const checked = document.querySelectorAll('.check-box-group input:checked');
      checked.forEach(chk => contract.cross_col_rules.push(chk.value));
    }

    if (selectedProcs.includes('link')) {
      contract.link_config = {
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

  /* ── Dynamic Column Builder for Procedure 1 ── */
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
          <label>Expected type</label>
          <select class="col-type">
            <option value="text">Free text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="category">Category</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Meaning</label>
        <input type="text" class="col-meaning" placeholder="What does this represent?">
      </div>
    `;
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
      const colCards = document.querySelectorAll('.column-card');
      html += `<h4>Columns to clean (${colCards.length})</h4><ul style="margin-bottom:1rem; padding-left:1.5rem; color:var(--text-muted);">`;
      colCards.forEach(card => {
        const name = card.querySelector('.col-name').value || "Unnamed column";
        html += `<li>${name}</li>`;
      });
      html += `</ul>`;
    }

    if (selectedProcs.includes('crosscol')) {
      const checked = document.querySelectorAll('.check-box-group input:checked');
      html += `<h4>Cross-column rules (${checked.length})</h4><ul style="margin-bottom:1rem; padding-left:1.5rem; color:var(--text-muted);">`;
      checked.forEach(chk => {
        html += `<li>${chk.parentElement.textContent.trim()}</li>`;
      });
      html += `</ul>`;
    }

    if (selectedProcs.includes('link')) {
      const linkNames = document.getElementById('q-link-names').value || "Unnamed datasets";
      html += `<h4>Link Datasets</h4><p style="font-size:0.9rem; color:var(--text-muted);">${linkNames}</p>`;
    }

    summaryContainer.innerHTML = html;
  }

});
