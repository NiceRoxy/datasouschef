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

  btnSubmit?.addEventListener('click', () => {
    // Simulate script generation
    alert("Data contract has been sent to the backend. Generating script...");
    
    // Switch to scripts view and add a mock entry
    const views = document.querySelectorAll('.view');
    views.forEach(v => v.classList.remove('active'));
    document.getElementById('view-scripts').classList.add('active');
    
    // Also update sidebar nav
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(n => n.classList.remove('active'));
    const scriptsNav = document.querySelector('.nav-item[data-view="scripts"]');
    if(scriptsNav) scriptsNav.classList.add('active');
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
