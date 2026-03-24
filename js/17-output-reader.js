/*
=====================================================================
FILE: js/17-output-reader.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Read AMPS output files (ASCII/CSV) and feed them into
         the computation pipeline via computeFromTimeSeries().

  Phase 3 will add NetCDF4/HDF5 binary readers; for now this module
  handles the ASCII column format that AMPS can produce, plus CSV.

PUBLIC API
  initOutputDropzone()          — wire up the file drop zone
  parseAmpsAsciiOutput(text)    — parse AMPS ASCII output → data object
  loadOutputFile(file)          — entry point: File → parse → compute

DEPENDS ON: 14-radbridge.js (computeFromTimeSeries, computePreview)
LAST UPDATED: 2026-03-06
=====================================================================
*/

/**
 * Wire up the output file drop zone in the Results view.
 * Called once during init.
 */
function initOutputDropzone() {
  const dz = $('output-dropzone');
  if (!dz) return;

  dz.addEventListener('dragover', function(e) {
    e.preventDefault();
    dz.classList.add('dz-hover');
  });
  dz.addEventListener('dragleave', function() {
    dz.classList.remove('dz-hover');
  });
  dz.addEventListener('drop', function(e) {
    e.preventDefault();
    dz.classList.remove('dz-hover');
    const files = e.dataTransfer.files;
    if (files.length > 0) loadOutputFile(files[0]);
  });
  dz.addEventListener('click', function() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.txt,.dat,.csv,.nc,.h5,.hdf5,.ascii';
    inp.onchange = function() {
      if (inp.files.length > 0) loadOutputFile(inp.files[0]);
    };
    inp.click();
  });
}

/**
 * Load and process an output file.
 * @param {File} file
 */
function loadOutputFile(file) {
  const dz = $('output-dropzone');
  const ext = file.name.split('.').pop().toLowerCase();

  /* Show loading state */
  if (dz) {
    dz.innerHTML = `
      <div class="dz-icon">⏳</div>
      <div class="dz-primary" style="color:var(--amber)">Loading ${file.name}...</div>
      <div class="dz-sub">${(file.size / 1024 / 1024).toFixed(1)} MB</div>
    `;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let data;
      if (ext === 'csv' || ext === 'txt' || ext === 'dat' || ext === 'ascii') {
        data = parseAmpsAsciiOutput(e.target.result);
      } else if (ext === 'nc' || ext === 'h5' || ext === 'hdf5') {
        /* Binary readers — placeholder for Phase 3 */
        throw new Error('NetCDF4/HDF5 support coming in Phase 3. Please export as ASCII.');
      } else {
        throw new Error('Unsupported file format: .' + ext);
      }

      if (data) {
        computeFromTimeSeries(data);
        S.vizOutputLoaded = true;

        if (dz) {
          dz.innerHTML = `
            <div class="dz-icon">✅</div>
            <div class="dz-primary" style="color:var(--green)">${file.name}</div>
            <div class="dz-sub">${data.spectra.length} time steps · ${data.Egrid.length} energy bins · loaded</div>
          `;
          dz.classList.add('loaded');
        }
      }
    } catch (err) {
      console.error('[output-reader]', err);
      if (dz) {
        dz.innerHTML = `
          <div class="dz-icon">❌</div>
          <div class="dz-primary" style="color:var(--red)">Error loading file</div>
          <div class="dz-sub">${err.message}</div>
        `;
      }
    }
  };

  if (ext === 'nc' || ext === 'h5' || ext === 'hdf5') {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

/**
 * Parse AMPS ASCII output.
 *
 * Expected format (column-based):
 *   Line 1: header starting with # or !
 *   Columns: TIME  E1  E2  E3 ... EN  Rc
 *   Each row = one time step; E columns are j(E) values
 *
 * Also supports simpler CSV with header row:
 *   time, Rc, J_1MeV, J_5MeV, J_10MeV, ...
 *
 * @param {string} text — file content
 * @returns {object|null} { times, dt, spectra, Rcs, Egrid }
 */
function parseAmpsAsciiOutput(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('File too short (need header + data).');

  /* Find header line (first line starting with # or containing alpha chars) */
  let headerIdx = 0;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    if (lines[i].trim().startsWith('#') || lines[i].trim().startsWith('!') || /[a-zA-Z]/.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  const header = lines[headerIdx].replace(/^[#!]\s*/, '').trim();
  const cols   = header.split(/[\s,;]+/).filter(c => c.length > 0);

  /* Try to identify columns */
  const dataLines = lines.slice(headerIdx + 1).filter(l => !l.trim().startsWith('#') && !l.trim().startsWith('!'));
  if (dataLines.length === 0) throw new Error('No data rows found.');

  /* Parse all data rows */
  const rows = [];
  for (const line of dataLines) {
    const vals = line.trim().split(/[\s,;]+/).map(Number);
    if (vals.length >= 3 && vals.every(v => isFinite(v))) {
      rows.push(vals);
    }
  }
  if (rows.length === 0) throw new Error('No valid numeric rows found.');

  /* Heuristic: identify Rc column (header containing 'Rc' or 'cutoff') */
  let rcCol = -1;
  let timeCol = 0;
  for (let c = 0; c < cols.length; c++) {
    const cl = cols[c].toLowerCase();
    if (cl.includes('rc') || cl.includes('cutoff') || cl.includes('rigidity')) rcCol = c;
    if (cl.includes('time') || cl === 't') timeCol = c;
  }

  /* Energy columns: everything that isn't time or Rc */
  const eCols = [];
  const Energies = [];
  for (let c = 0; c < cols.length; c++) {
    if (c === timeCol || c === rcCol) continue;
    /* Try to extract energy value from header like "J_10MeV" or "10" or "E=10" */
    const m = /([\d.]+)/.exec(cols[c]);
    if (m) {
      eCols.push(c);
      Energies.push(parseFloat(m[1]));
    }
  }

  if (eCols.length === 0) {
    /* Fallback: assume columns 1..N-1 are energies, with Rc as last */
    const nCols = rows[0].length;
    rcCol = nCols - 1;
    for (let c = 1; c < nCols - 1; c++) {
      eCols.push(c);
      /* Guess energies: log-spaced 1–1000 */
      Energies.push(Math.pow(10, (c - 1) / (nCols - 3) * 3));
    }
  }

  const Egrid = new Float64Array(Energies);
  const Nt = rows.length;
  const spectra = [];
  const Rcs = new Float64Array(Nt);
  const times = [];

  for (let t = 0; t < Nt; t++) {
    const row = rows[t];
    times.push(timeCol >= 0 ? row[timeCol] : t);
    Rcs[t] = rcCol >= 0 ? row[rcCol] : 0;

    const j = new Float64Array(eCols.length);
    for (let e = 0; e < eCols.length; e++) {
      j[e] = row[eCols[e]] || 0;
    }
    spectra.push(j);
  }

  /* Estimate dt */
  const dt = times.length > 1 ? Math.abs(times[1] - times[0]) * 60 : 300; // assume minutes → seconds

  return { times, dt, spectra, Rcs, Egrid };
}


/**
 * Generate and download a sample AMPS output file for testing.
 * Creates a synthetic SEP storm time series.
 */
function downloadSampleOutput() {
  const Nt = 100;
  const Ne = 20;
  const Egrid = RAD.logGrid(1, 1000, Ne);
  const dt = 5; // minutes

  let csv = '# time_min  Rc_GV  ' + Array.from(Egrid).map(e => 'E' + e.toFixed(1) + '_MeV').join('  ') + '\n';

  for (let t = 0; t < Nt; t++) {
    const tMin = t * dt;
    /* Simulate varying Rc and spectrum */
    const Rc = 1.5 + 2.0 * Math.sin(t / Nt * Math.PI);  // GV
    const stormFactor = 1 + 50 * Math.exp(-Math.pow((t - 50) / 15, 2));  // Gaussian peak
    const j0  = 1e4 * stormFactor;
    const gamma = 3.0 + 0.5 * Math.sin(t / Nt * Math.PI * 2);

    let line = tMin.toFixed(1) + '  ' + Rc.toFixed(3);
    for (let e = 0; e < Ne; e++) {
      const jE = j0 * Math.pow(Egrid[e] / 10, -gamma);
      line += '  ' + jE.toExponential(4);
    }
    csv += line + '\n';
  }

  const blob = new Blob([csv], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'AMPS_sample_output.txt';
  a.click();
  URL.revokeObjectURL(url);
}
