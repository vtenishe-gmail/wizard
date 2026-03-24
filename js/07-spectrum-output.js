/* =============================================================================
   FILE:    js/07-spectrum-output.js
   PROJECT: AMPS CCMC Submission Interface  v3
   PURPOSE: Steps 7 + 8 + 9 — Particle source spectrum, output domain,
            and output options configuration.

   ╔═══════════════════════════════════════════════════════════════════════╗
   ║                        ARCHITECTURE OVERVIEW                        ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║                                                                     ║
   ║  This module handles three consecutive wizard steps:               ║
   ║                                                                     ║
   ║  §1 STEP 7: SOURCE SPECTRUM — defines the particle energy spectrum ║
   ║     injected at the boundary. Five models supported:               ║
   ║                                                                     ║
   ║     POWER_LAW          J = J₀·(E/E₀)^(−γ)                        ║
   ║     POWER_LAW_CUTOFF   J = J₀·(E/E₀)^(−γ)·exp(−E/Ec)            ║
   ║     LIS_FORCE_FIELD    GCR local interstellar + solar modulation  ║
   ║     BAND               Band function (2-segment power law)        ║
   ║     TABLE               User-uploaded tabular spectrum             ║
   ║                                                                     ║
   ║  §2 STEP 8: OUTPUT DOMAIN — defines WHERE the model is evaluated  ║
   ║                                                                     ║
   ║     POINTS       User-defined list of (x, y, z) positions         ║
   ║     TRAJECTORY   Time-tagged spacecraft trajectory file            ║
   ║     SHELLS       Concentric altitude shells (global maps)         ║
   ║                                                                     ║
   ║  §3 STEP 9: OUTPUT OPTIONS — what output quantities and format    ║
   ║                                                                     ║
   ║     Flux type (differential/integral), cutoff, pitch angle,       ║
   ║     file format (NetCDF4/HDF5/ASCII), coordinate system,          ║
   ║     and energy bin configuration with interactive presets.          ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  STATE PROPERTIES  (from S in 01-state.js)                        ║
   ║                                                                     ║
   ║  STEP 7 — Spectrum:                                                ║
   ║  S.specType     string  'POWER_LAW'|'POWER_LAW_CUTOFF'|'LIS…'|…  ║
   ║  S.specJ0       float   reference flux [cm⁻²sr⁻¹s⁻¹MeV⁻¹]       ║
   ║  S.specGamma    float   power-law spectral index                   ║
   ║  S.specE0       float   reference energy [MeV]                     ║
   ║  S.specEmin/max float   energy range [MeV]                         ║
   ║  S.specEc       float   exponential cutoff energy [MeV]           ║
   ║  S.specPhi      float   solar modulation potential [MV]            ║
   ║  S.specLisJ0    float   LIS reference flux                        ║
   ║  S.specLisGamma float   LIS spectral index                        ║
   ║                                                                     ║
   ║  STEP 8 — Output domain:                                          ║
   ║  S.outputMode   string  'POINTS' | 'TRAJECTORY' | 'SHELLS'       ║
   ║  S.fluxDt       float   output cadence [min]                       ║
   ║  S.trajLoaded   bool    trajectory file loaded?                    ║
   ║  S.pointsText   string  raw multiline text of user-defined points ║
   ║  S.shellCount   int     number of altitude shells (1–5)           ║
   ║  S.shellResDeg  int     angular resolution [degrees]               ║
   ║  S.shellAltsKm  array   shell altitudes [km]                       ║
   ║                                                                     ║
   ║  STEP 9 — Output options:                                         ║
   ║  S.fluxType     string  'DIFFERENTIAL' | 'INTEGRAL'               ║
   ║  S.outputCutoff bool    include cutoff rigidity?                   ║
   ║  S.outputPitch  bool    include pitch-angle distribution?          ║
   ║  S.outputFormat string  'NETCDF4' | 'HDF5' | 'ASCII'             ║
   ║  S.outputCoords string  'GEO' | 'GSM' | 'SM'                     ║
   ║  S.energyBins   array   energy bin edges [MeV]                     ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  FUNCTION INDEX                                                    ║
   ║                                                                     ║
   ║  §1 SPECTRUM                                                       ║
   ║     setSpec(type, card)  — select spectrum model                   ║
   ║     drawSpec()           — render canvas preview plot              ║
   ║                                                                     ║
   ║  §2 OUTPUT DOMAIN                                                  ║
   ║     setMode(m, card)     — select output mode                      ║
   ║     updatePoints()       — sync POINTS textarea → S               ║
   ║     updateShells()       — sync SHELLS inputs → S                 ║
   ║     loadTrajExample()    — simulate loading example trajectory     ║
   ║                                                                     ║
   ║  §3 OUTPUT OPTIONS                                                 ║
   ║     setFluxType(t, btn)  — toggle differential/integral           ║
   ║     applyBinPreset(k)    — apply named energy bin preset          ║
   ║     addBin()             — add custom energy bin                   ║
   ║     removeBin(i)         — remove bin at index                    ║
   ║     renderBins()         — redraw energy bin visualisation        ║
   ║                                                                     ║
   ╚═══════════════════════════════════════════════════════════════════════╝

   DEPENDS ON: 01-state.js (S, $), updateSidebar() from 02-wizard.js
   LAST UPDATED: 2026-03-01
============================================================================= */


/* ═══════════════════════════════════════════════════════════════════════════
   §1  STEP 7: PARTICLE SOURCE SPECTRUM
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Select a spectrum model and show its parameter form.
 *
 * Highlights the clicked card, hides all model-specific forms, then
 * shows the matching one.  Triggers drawSpec() to update the preview plot.
 *
 * @param {string}      type — 'POWER_LAW' | 'POWER_LAW_CUTOFF' | 'LIS_FORCE_FIELD' | 'BAND' | 'TABLE'
 * @param {HTMLElement} [card] — the clicked card element (for highlight)
 */
function setSpec(type, card) {
  S.specType = type;

  /* Card highlights */
  document.querySelectorAll('.spec-card').forEach(c => c.classList.remove('sel'));
  if (card) card.classList.add('sel');

  /* Show/hide model-specific parameter forms.
     Form IDs follow the pattern: pl-form, plc-form, lis-form, band-form, table-form */
  const formMap = {
    'pl-form':    'POWER_LAW',
    'plc-form':   'POWER_LAW_CUTOFF',
    'lis-form':   'LIS_FORCE_FIELD',
    'band-form':  'BAND',
    'table-form': 'TABLE',
  };
  Object.entries(formMap).forEach(([id, model]) => {
    const el = $(id);
    if (el) el.style.display = model === type ? 'block' : 'none';
  });

  drawSpec();
}

/**
 * Render the "Spectrum Preview" canvas plot.
 *
 * Draws a log-log plot of J(E) for the currently selected spectrum model.
 * The preview is QUALITATIVE — it shows shape and relative scaling to help
 * users verify their parameter choices, but is not used for physics.
 *
 * Plot axes:
 *   X: log₁₀(Energy) from S.specEmin to S.specEmax [MeV]
 *   Y: log₁₀(Flux)   from 10⁻² to 10⁸ [cm⁻²sr⁻¹s⁻¹MeV⁻¹]
 *
 * Steps:
 *   1. Read all spectrum parameters from DOM → S
 *   2. Clear and size the canvas
 *   3. Draw grid lines + axis labels
 *   4. Compute J(E) at 300 energy points
 *   5. Plot the spectrum curve
 *
 * Spectrum formulas implemented:
 *   POWER_LAW:        J = J₀ · (E/E₀)^(−γ)
 *   POWER_LAW_CUTOFF: J = J₀ · (E/E₀)^(−γ) · exp(−E/Ec)
 *   LIS_FORCE_FIELD:  J_obs = J_LIS(E+φ) · (E²+2EM) / ((E+φ)²+2(E+φ)M)
 *                     where M = 938.272 MeV (proton rest mass)
 *   BAND:             Two-segment power law with break at Eb = (γ₁−γ₂)·E₀
 *
 * Called after any spectrum parameter change.
 */
function drawSpec() {
  /* ── 1. Read parameters from DOM → S ────────────────────────────────── */
  S.specJ0       = parseFloat($('spec-j0')?.value)   || S.specJ0;
  S.specGamma    = parseFloat($('spec-gamma')?.value) || S.specGamma;
  S.specE0       = parseFloat($('spec-e0')?.value)    || S.specE0;
  S.specEmin     = parseFloat($('spec-emin')?.value)  || S.specEmin;
  S.specEmax     = parseFloat($('spec-emax')?.value)  || S.specEmax;
  S.specEc       = parseFloat($('spec-ec')?.value)    || S.specEc;
  S.specPhi      = parseFloat($('spec-phi')?.value)   || S.specPhi;
  S.specLisJ0    = parseFloat($('lis-j0')?.value)     || S.specLisJ0;
  S.specLisGamma = parseFloat($('lis-gamma')?.value)  || S.specLisGamma;

  /* ── 2. Setup canvas ────────────────────────────────────────────────── */
  const canvas = $('spec-canvas');
  if (!canvas) return;
  const W = canvas.parentElement.clientWidth || 400;
  const H = 160;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#060e1c';
  ctx.fillRect(0, 0, W, H);

  /* ── 3. Axis ranges and grid ────────────────────────────────────────── */
  const emin  = Math.max(0.1, S.specEmin);
  const emax  = Math.min(1e5, S.specEmax);
  const lemin = Math.log10(emin);           // log₁₀ energy range
  const lemax = Math.log10(emax);
  const ljmin = -2, ljmax = 8;              // log₁₀ flux range
  const pad   = 28;                         // left padding for Y-axis labels

  /* Vertical grid lines (energy decades) */
  ctx.strokeStyle = '#0d2040';
  ctx.lineWidth = 0.5;
  for (let le = Math.ceil(lemin); le <= Math.floor(lemax); le++) {
    const x = ((le - lemin) / (lemax - lemin)) * (W - pad - 10) + pad;
    ctx.beginPath(); ctx.moveTo(x, 5); ctx.lineTo(x, H - 18); ctx.stroke();
    ctx.fillStyle = '#2a4060';
    ctx.font = '8px IBM Plex Mono';
    ctx.fillText('10^' + le, x - 8, H - 4);
  }

  /* Horizontal grid lines (flux decades) */
  for (let lj = ljmin; lj <= ljmax; lj += 2) {
    const y = H - 18 - ((lj - ljmin) / (ljmax - ljmin)) * (H - 22);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 8, y); ctx.stroke();
    ctx.fillStyle = '#2a4060';
    ctx.font = '7px IBM Plex Mono';
    ctx.fillText('10^' + lj, 1, y + 3);
  }

  /* ── 4–5. Compute J(E) and draw curve ───────────────────────────────── */
  ctx.strokeStyle = '#38c0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;

  for (let i = 0; i <= 300; i++) {
    const le = lemin + (i / 300) * (lemax - lemin);
    const E  = Math.pow(10, le);
    let J;

    /* ── Evaluate flux at energy E ────────────────────────────────────── */
    if (S.specType === 'POWER_LAW') {
      /* Simple power law: J = J₀ · (E/E₀)^(−γ) */
      J = S.specJ0 * Math.pow(E / (S.specE0 || 10), -(S.specGamma || 3.5));

    } else if (S.specType === 'POWER_LAW_CUTOFF') {
      /* Power law + exponential cutoff: J = J₀ · (E/E₀)^(−γ) · exp(−E/Ec) */
      const j0    = parseFloat($('plc-j0')?.value)    || S.specJ0;
      const gamma = parseFloat($('plc-gamma')?.value)  || S.specGamma;
      const e0    = parseFloat($('plc-e0')?.value)     || S.specE0;
      const ec    = S.specEc || 500;
      J = j0 * Math.pow(E / e0, -gamma) * Math.exp(-E / ec);

    } else if (S.specType === 'LIS_FORCE_FIELD') {
      /* GCR Local Interstellar Spectrum + Force-Field modulation:
         J_obs(E) = J_LIS(E+φ) · (E² + 2EM) / ((E+φ)² + 2(E+φ)M)
         where M = 938.272 MeV (proton rest mass), φ = solar modulation potential */
      const jLis     = S.specLisJ0    || 10000;
      const gammaLis = S.specLisGamma || 2.7;
      const e0       = parseFloat($('lis-e0')?.value) || S.specE0;
      const phi      = S.specPhi || 550;
      const M        = 938.272;                   // proton rest mass [MeV]
      const Ephi     = E + phi;                   // shifted energy
      const Esq      = E * E;
      const Ephisq   = Ephi * Ephi;
      const Jlis_at_Ephi = jLis * Math.pow(Ephi / e0, -gammaLis);
      J = Jlis_at_Ephi * (Esq + 2 * E * M) / (Ephisq + 2 * Ephi * M);

    } else if (S.specType === 'BAND') {
      /* Band function (two-segment power law with smooth join):
         Below break energy Eb = (γ₁−γ₂)·E₀: steep power law (index γ₁)
         Above Eb: shallower power law (index γ₂) with amplitude matching */
      const g1 = parseFloat($('band-gamma1')?.value) || 3.5;
      const g2 = parseFloat($('band-gamma2')?.value) || 1.5;
      const e0 = parseFloat($('band-e0')?.value)     || 10;
      const Eb = (g1 - g2) * e0;   // break energy

      if (E < Eb) {
        J = S.specJ0 * Math.pow(E / e0, -g1) * Math.exp(-E / e0);
      } else {
        /* Amplitude-matching factor for continuity at Eb */
        J = S.specJ0 * Math.pow(g1 - g2, g1 - g2) * Math.exp(g2 - g1) * Math.pow(E / e0, -g2);
      }

    } else {
      break;  // TABLE or unknown — no preview
    }

    /* Map (logE, logJ) to canvas coordinates */
    const lJ = Math.log10(Math.max(1e-4, J));
    const x  = ((le - lemin) / (lemax - lemin)) * (W - pad - 10) + pad;
    const y  = H - 18 - ((lJ - ljmin) / (ljmax - ljmin)) * (H - 22);

    if (!started) { ctx.moveTo(x, Math.max(5, Math.min(H - 18, y))); started = true; }
    else            ctx.lineTo(x, Math.max(5, Math.min(H - 18, y)));
  }

  ctx.stroke();

  /* ── Trigger dashboard recompute (if auto-update enabled) ── */
  if (S.vizAutoUpdate && typeof computePreview === 'function') {
    clearTimeout(window._vizDebounce);
    window._vizDebounce = setTimeout(computePreview, 250);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   §2  STEP 8: OUTPUT DOMAIN — WHERE the model is evaluated
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Select the output domain mode (POINTS / TRAJECTORY / SHELLS).
 *
 * Highlights the selected card and shows the matching configuration panel.
 * Panel IDs: panel-mode-a (POINTS), panel-mode-b (TRAJECTORY), panel-mode-c (SHELLS).
 *
 * @param {string}      m    — 'POINTS' | 'TRAJECTORY' | 'SHELLS'
 * @param {HTMLElement} [card] — the clicked card element
 */
function setMode(m, card) {
  S.outputMode = m;

  /* Card highlights */
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('sel'));
  if (card) card.classList.add('sel');

  /* Show/hide mode panels */
  const panelMap = {
    'panel-mode-a': 'POINTS',
    'panel-mode-b': 'TRAJECTORY',
    'panel-mode-c': 'SHELLS',
  };
  Object.entries(panelMap).forEach(([id, mode]) => {
    const el = $(id);
    if (el) el.style.display = mode === m ? 'block' : 'none';
  });

  updateSidebar();

  /* Update directional map availability (depends on output mode) */
  if (typeof updateDirMapVisibility === 'function') updateDirMapVisibility();
}

/**
 * Sync the POINTS-mode freeform text area to S.pointsText.
 *
 * The UI accepts one point per line (x, y, z coordinates).  We store the
 * raw text so that:
 *   (a) The Review step can embed it directly into AMPS_PARAM.in
 *   (b) The backend can optionally write it to a sidecar file (points.txt)
 *   (c) We avoid a CSV parser — validation happens server-side
 *
 * Called from oninput on #points-text textarea.
 */
function updatePoints() {
  const ta = $('points-text');
  if (!ta) return;

  S.pointsText = ta.value || '';

  /* Trigger sidebar/review refresh if those hooks exist */
  if (typeof liveUpdate   === 'function') liveUpdate();
  if (typeof updateSidebar === 'function') updateSidebar();
}


/**
 * Select the coordinate frame of reference for POINTS mode.
 *
 * Highlights the selected frame card, updates S.pointsFrame, adjusts the
 * placeholder hint text and the textarea placeholder to match the selected
 * frame, and refreshes the sidebar/review.
 *
 * Emitted as POINTS_FRAME in AMPS_PARAM.in (see 08-review.js).
 *
 * Frame definitions:
 *   GEO — Geographic (Earth-fixed): Lat [°], Lon [°], Alt [km]
 *   GSM — Geocentric Solar Magnetospheric: X, Y, Z [RE]
 *   SM  — Solar Magnetic: X, Y, Z [RE]
 *
 * @param {string}      frame — 'GEO' | 'GSM' | 'SM'
 * @param {HTMLElement} [card] — the clicked card element
 */
function setPointsFrame(frame, card) {
  S.pointsFrame = frame;

  /* Highlight the selected card */
  ['pf-geo', 'pf-gsm', 'pf-sm'].forEach(id => {
    const el = $(id);
    if (el) {
      el.style.borderColor = 'var(--border)';
      el.style.background  = 'transparent';
    }
  });
  if (card) {
    card.style.borderColor = 'var(--yellow)';
    card.style.background  = 'rgba(255,208,75,.05)';
  }

  /* Update the hint box and textarea placeholder to match frame */
  const hintEl = $('points-frame-hint');
  const ta     = $('points-text');

  const hints = {
    GEO: '<b>GEO format:</b> Enter one point per line as <code>Lat[°] &nbsp; Lon[°] &nbsp; Alt[km]</code> — e.g. <code>51.5 &nbsp; -0.12 &nbsp; 450.0</code>',
    GSM: '<b>GSM format:</b> Enter one point per line as <code>X &nbsp; Y &nbsp; Z [R<sub>E</sub>]</code> — e.g. <code>6.6 &nbsp; 0.0 &nbsp; 0.5</code>',
    SM:  '<b>SM format:</b> Enter one point per line as <code>X &nbsp; Y &nbsp; Z [R<sub>E</sub>]</code> — e.g. <code>6.6 &nbsp; 0.0 &nbsp; 0.5</code>'
  };

  const placeholders = {
    GEO: '51.5  -0.12  450.0\n28.5  -81.4  400.0\n\u2026',
    GSM: '6.6  0.0  0.5\n-6.0  3.0  -1.2\n\u2026',
    SM:  '6.6  0.0  0.5\n-6.0  3.0  -1.2\n\u2026'
  };

  if (hintEl) hintEl.innerHTML = hints[frame] || hints.GEO;
  if (ta)     ta.placeholder   = placeholders[frame] || placeholders.GEO;

  /* Refresh downstream */
  if (typeof updateSidebar === 'function') updateSidebar();
}


/**
 * Select the coordinate frame of reference for TRAJECTORY mode.
 *
 * Highlights the selected frame card, updates S.trajFrame, adjusts the
 * hint text, the dropzone subtitle, the preview table headers, and the
 * format diagram (sample row, legend, column labels) to match the frame.
 *
 * Emitted as TRAJ_FRAME in AMPS_PARAM.in (see 08-review.js).
 *
 * Frame definitions:
 *   GEO — Geographic (Earth-fixed): Lat [°], Lon [°], Alt [km]
 *   GSM — Geocentric Solar Magnetospheric: X, Y, Z [RE]
 *   SM  — Solar Magnetic: X, Y, Z [RE]
 *
 * @param {string}      frame — 'GEO' | 'GSM' | 'SM'
 * @param {HTMLElement} [card] — the clicked card element
 */
function setTrajFrame(frame, card) {
  S.trajFrame = frame;

  /* ── Highlight the selected card ──────────────────────────────────── */
  ['tf-geo', 'tf-gsm', 'tf-sm'].forEach(id => {
    const el = $(id);
    if (el) {
      el.style.borderColor = 'var(--border)';
      el.style.background  = 'transparent';
    }
  });
  if (card) {
    card.style.borderColor = 'var(--yellow)';
    card.style.background  = 'rgba(255,208,75,.05)';
  }

  /* ── Frame-dependent content ──────────────────────────────────────── */
  const isGeo = frame === 'GEO';

  /* Hint box */
  const hints = {
    GEO: '<b>GEO trajectories:</b> File must contain time-stamped rows with position columns <code>Lat[°] &nbsp; Lon[°] &nbsp; Alt[km]</code>. See the format diagram below for the exact column layout.',
    GSM: '<b>GSM trajectories:</b> File must contain time-stamped rows with position columns <code>X &nbsp; Y &nbsp; Z [R<sub>E</sub>]</code> in Geocentric Solar Magnetospheric coordinates.',
    SM:  '<b>SM trajectories:</b> File must contain time-stamped rows with position columns <code>X &nbsp; Y &nbsp; Z [R<sub>E</sub>]</code> in Solar Magnetic coordinates.'
  };
  const hintEl = $('traj-frame-hint');
  if (hintEl) hintEl.innerHTML = hints[frame] || hints.GEO;

  /* Dropzone subtitle */
  const dzSub = $('traj-dz-sub');
  if (dzSub) {
    const colHint = isGeo ? 'Lat/Lon/Alt' : 'X/Y/Z [RE]';
    dzSub.textContent = 'Timestamps: Gregorian (9 cols) or MJD (4 cols) \u00b7 Position: ' + colHint + ' \u00b7 .txt / .csv / .dat';
  }

  /* ── Preview table column headers ─────────────────────────────────── */
  const thC1 = $('traj-th-c1'), thC2 = $('traj-th-c2'), thC3 = $('traj-th-c3');
  if (isGeo) {
    if (thC1) thC1.textContent = 'Lat [\u00b0]';
    if (thC2) thC2.textContent = 'Lon [\u00b0]';
    if (thC3) thC3.textContent = 'Alt [km]';
  } else {
    if (thC1) thC1.innerHTML = 'X [R<sub>E</sub>]';
    if (thC2) thC2.innerHTML = 'Y [R<sub>E</sub>]';
    if (thC3) thC3.innerHTML = 'Z [R<sub>E</sub>]';
  }

  /* ── Format diagram ───────────────────────────────────────────────── */
  /* Title */
  const fmtTitle = $('traj-fmt-title-text');
  if (fmtTitle) fmtTitle.textContent = isGeo
    ? 'NAIRAS Trajectory Format \u2014 Gregorian (GEO)'
    : 'Trajectory Format \u2014 Gregorian (' + frame + ')';

  /* Subtitle (column count) */
  const fmtSub = $('traj-fmt-sub');
  if (fmtSub) fmtSub.textContent = '9 cols whitespace-delimited \u00b7 UTC \u00b7 comment: #';

  /* Sample row */
  const fmtSample = $('traj-fmt-sample');
  if (fmtSample) {
    if (isGeo) {
      fmtSample.innerHTML =
        '<span class="f-comment"># YYYY MM DD HH mm ss.s   Lat[deg]  Lon[deg]  Alt[km]</span><br>' +
        '<span class="f-year">2017</span> <span class="f-mon">09</span> <span class="f-day">10</span> ' +
        '<span class="f-hr">16</span> <span class="f-min">00</span> <span class="f-sec">00.0</span>  ' +
        '<span class="f-lat">-12.75</span>  <span class="f-lon">140.33</span>  <span class="f-alt">21045.8</span>';
    } else {
      fmtSample.innerHTML =
        '<span class="f-comment"># YYYY MM DD HH mm ss.s   X[RE]     Y[RE]     Z[RE]</span><br>' +
        '<span class="f-year">2017</span> <span class="f-mon">09</span> <span class="f-day">10</span> ' +
        '<span class="f-hr">16</span> <span class="f-min">00</span> <span class="f-sec">00.0</span>  ' +
        '<span class="f-lat">-3.214</span>  <span class="f-lon">5.017</span>  <span class="f-alt">1.832</span>';
    }
  }

  /* Legend — position columns (last 3 items) */
  const legC1Name = $('traj-leg-c1-name'), legC1Desc = $('traj-leg-c1-desc');
  const legC2Name = $('traj-leg-c2-name'), legC2Desc = $('traj-leg-c2-desc');
  const legC3Name = $('traj-leg-c3-name'), legC3Desc = $('traj-leg-c3-desc');
  if (isGeo) {
    if (legC1Name) { legC1Name.textContent = 'Lat [\u00b0]'; }
    if (legC1Desc) { legC1Desc.textContent = 'Geocentric \u221290 to +90'; }
    if (legC2Name) { legC2Name.textContent = 'Lon [\u00b0]'; }
    if (legC2Desc) { legC2Desc.textContent = 'East longitude \u2212180 to +180'; }
    if (legC3Name) { legC3Name.textContent = 'Alt [km]'; }
    if (legC3Desc) { legC3Desc.textContent = 'Altitude above WGS-84'; }
  } else {
    const lbl = frame === 'GSM' ? 'GSM' : 'SM';
    if (legC1Name) { legC1Name.innerHTML = 'X [R<sub>E</sub>]'; }
    if (legC1Desc) { legC1Desc.textContent = lbl + ' X \u2014 Earth\u2192Sun (GSM) / dipole plane (SM)'; }
    if (legC2Name) { legC2Name.innerHTML = 'Y [R<sub>E</sub>]'; }
    if (legC2Desc) { legC2Desc.textContent = lbl + ' Y \u2014 \u2248 duskward'; }
    if (legC3Name) { legC3Name.innerHTML = 'Z [R<sub>E</sub>]'; }
    if (legC3Desc) { legC3Desc.textContent = frame === 'GSM' ? 'GSM Z \u2014 dipole projection \u22a5 X' : 'SM Z \u2014 aligned with dipole axis'; }
  }

  /* Refresh downstream */
  if (typeof updateSidebar === 'function') updateSidebar();
}


/**
 * Sync SHELLS-mode configuration inputs to S.
 *
 * Reads shell count, angular resolution, and per-shell altitudes.
 * Shows/hides altitude input fields based on the active shell count
 * (max 5 shells supported).
 *
 * State written:
 *   S.shellCount  — number of shells (1–5)
 *   S.shellResDeg — angular resolution in degrees
 *   S.shellAltsKm — array of altitudes [km], length = shellCount
 *
 * Called from oninput/onchange on shell config inputs.
 */
function updateShells() {
  const sel = $('shell-count');
  const res = $('shell-res-deg');
  const n   = Math.max(1, Math.min(5, parseInt(sel?.value || '1', 10)));
  const d   = Math.max(1, parseInt(res?.value || '1', 10));

  S.shellCount  = n;
  S.shellResDeg = d;
  S.shellAltsKm = [];

  /* Show/hide altitude inputs; read values for active shells */
  for (let i = 1; i <= 5; i++) {
    const wrap = $(`shell-alt-wrap-${i}`);
    if (wrap) wrap.style.display = (i <= n) ? 'block' : 'none';

    const inp = $(`shell-alt-${i}`);
    if (i <= n) {
      const v = parseFloat(inp?.value || '0');
      S.shellAltsKm.push(isFinite(v) ? v : 0);
    }
  }

  if (typeof liveUpdate   === 'function') liveUpdate();
  if (typeof updateSidebar === 'function') updateSidebar();
}

/**
 * Load the bundled example Van Allen Probe A trajectory.
 *
 * Fetches trajectory_sample.txt from the js/ directory, wraps it in a
 * File object, and delegates to the shared _applyTrajFile() handler so
 * the dropzone UI and S state are updated identically to a real upload.
 */
function loadTrajExample() {
  fetch('js/trajectory_sample.txt')
    .then(r => r.blob())
    .then(blob => {
      const file = new File([blob], 'VanAllenProbeA_sep2017.txt', { type: 'text/plain' });
      _applyTrajFile(file);
    })
    .catch(() => {
      /* Fallback: mark as loaded with a synthetic placeholder so the
         wizard can still proceed even if the fetch fails (e.g. file://). */
      S.trajLoaded = true;
      const dz = $('traj-dropzone');
      if (dz) {
        dz.classList.add('loaded');
        dz.innerHTML =
          '<div class="dz-icon">✅</div>' +
          '<div class="dz-primary" style="color:var(--green)">VanAllenProbeA_sep2017.txt</div>' +
          '<div class="dz-sub">14,412 rows · Gregorian format · 2017-09-07 → 2017-09-10 UTC</div>';
      }
      if ($('traj-preview-panel')) $('traj-preview-panel').style.display = 'block';
    });
}

/**
 * Apply a trajectory File object: update S, dropzone UI, and preview panel.
 *
 * @param {File} file
 */
function _applyTrajFile(file) {
  S.trajFile   = file;
  S.trajLoaded = true;

  const kb  = (file.size / 1024).toFixed(1);
  const dz  = $('traj-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${kb} KB · drag a new file to replace</div>`;
  }
  if ($('traj-preview-panel')) $('traj-preview-panel').style.display = 'block';
  updateSidebar();
}

/**
 * Wire the trajectory dropzone (#traj-dropzone) and its hidden file input
 * (#traj-file-input) for real file uploads.
 *
 * Called once from js/09-init.js during application boot.
 */
function initTrajDropzone() {
  const dz = $('traj-dropzone');
  if (!dz) return;

  /* Click → open file picker */
  dz.addEventListener('click', () => {
    let fi = $('traj-file-input');
    if (!fi) {
      fi = document.createElement('input');
      fi.type   = 'file';
      fi.id     = 'traj-file-input';
      fi.accept = '.txt,.csv,.dat';
      fi.style.display = 'none';
      document.body.appendChild(fi);
      fi.addEventListener('change', function () {
        if (this.files.length > 0) _applyTrajFile(this.files[0]);
        this.value = '';
      });
    }
    fi.click();
  });

  /* Drag-and-drop */
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) _applyTrajFile(e.dataTransfer.files[0]);
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   §3  STEP 9: OUTPUT OPTIONS — flux type, format, energy bins
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Set the flux output type (differential or integral).
 *
 * @param {string}      t   — 'DIFFERENTIAL' | 'INTEGRAL'
 * @param {HTMLElement} [btn] — the clicked button element
 */
function setFluxType(t, btn) {
  S.fluxType = t;
  document.querySelectorAll('.flux-type-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
}


/* ── Energy bin presets ───────────────────────────────────────────────────
   Named presets provide common energy bin configurations.  Each is an array
   of bin edge energies in MeV.

   'default' — Standard 7-bin SEP configuration
   'fine'    — High-resolution 16-bin for detailed spectral analysis
   'goes'    — Matches GOES/SEISS differential channels
   'broad'   — Coarse 4-bin for quick overview runs
   ─────────────────────────────────────────────────────────────────────────── */
const PRESETS = {
  default: [1, 5, 10, 30, 100, 300, 1000],
  fine:    [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 200, 300, 500, 1000],
  goes:    [5, 10, 30, 50, 60, 100, 300, 500],
  broad:   [1, 10, 100, 1000],
};

/**
 * Apply a named energy bin preset.
 *
 * Replaces S.energyBins with a copy of the preset array (not a reference,
 * so later edits don't mutate PRESETS).  Then re-renders the bin display.
 *
 * @param {string} k — preset name: 'default' | 'fine' | 'goes' | 'broad'
 */
function applyBinPreset(k) {
  if (PRESETS[k]) {
    S.energyBins = [...PRESETS[k]];
    renderBins();
  }
}

/**
 * Add a custom energy bin from the #new-bin-val input.
 *
 * Validates: must be positive and not a duplicate.
 * After adding, re-renders and clears the input.
 */
function addBin() {
  const inp = $('new-bin-val');
  if (!inp) return;
  const v = parseFloat(inp.value);
  if (v > 0 && !S.energyBins.includes(v)) {
    S.energyBins.push(v);
    renderBins();
    inp.value = '';
  }
}

/**
 * Remove an energy bin by array index.
 *
 * @param {number} i — index in S.energyBins to remove
 */
function removeBin(i) {
  S.energyBins.splice(i, 1);
  renderBins();
}

/**
 * Render the energy bin list with relative flux bars.
 *
 * Sorts bins by energy, then for each bin:
 *   1. Computes J(E) using the current power-law spectrum
 *   2. Draws a proportional flux bar (log-scaled relative to max)
 *   3. Shows the energy label, flux value, and a delete (✕) button
 *
 * Also updates the estimated output size display.
 *
 * The flux bar widths are QUALITATIVE — they show relative flux across
 * bins to help users assess whether their bin edges make sense.
 * The actual flux computation uses the simple power-law formula even if
 * a different spectrum model is selected, as a rough proxy.
 */
function renderBins() {
  /* Sort bins in ascending energy order */
  S.energyBins.sort((a, b) => a - b);

  const c = $('ebin-list');
  if (!c) return;
  c.innerHTML = '';

  /* Flux estimator: simple power law from current S parameters */
  const jAtE = E => S.specJ0 * Math.pow(E / (S.specE0 || 10), -(S.specGamma || 3.5));
  const maxJ = Math.max(...S.energyBins.map(jAtE));

  S.energyBins.forEach((e, i) => {
    /* Log-scaled bar width relative to maximum flux (clamped 5–100%) */
    const pct = Math.max(5, Math.min(100,
      (Math.log10(jAtE(e)) - Math.log10(1e-3)) / (Math.log10(maxJ + 1) - Math.log10(1e-3)) * 100
    ));

    const row = document.createElement('div');
    row.className = 'ebin-row';
    row.innerHTML =
      `<span class="ebin-range" style="color:#38c0ff">${e} MeV/n</span>` +
      `<div class="ebin-bar-wrap"><div class="ebin-bar" style="width:${pct.toFixed(0)}%"></div></div>` +
      `<span style="font-size:10px;color:var(--text-dim)">${jAtE(e).toExponential(1)} p/cm²/s/sr/(MeV/n)</span>` +
      `<span class="ebin-del" onclick="removeBin(${i})" title="Remove">✕</span>`;
    c.appendChild(row);
  });

  /* Estimated output size (rough: ~0.8 GB per energy bin) */
  const ts = $('total-output-size');
  if (ts) ts.textContent = `~${(S.energyBins.length * 0.8).toFixed(1)} GB output`;
}


/* ═══════════════════════════════════════════════════════════════════════════
   §5  SPECTRUM TABLE FILE UPLOAD
   ═══════════════════════════════════════════════════════════════════════════
   Wire the file input inside #table-form so the user can upload a tabular
   spectrum file.  The File object is stored in S.specTableFile and its name
   is shown inline.  Called once from js/09-init.js during application boot.
*/

/**
 * Apply a spectrum-table File object: update S and the inline status label.
 *
 * @param {File} file
 */
function _applySpecTableFile(file) {
  S.specTableFile = file;
  const lbl = $('spec-table-file-label');
  if (lbl) {
    lbl.textContent = `✅ ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`;
    lbl.style.color = 'var(--green)';
  }
  updateSidebar();
}

/**
 * Wire the spectrum table file-picker inside #table-form.
 *
 * Expects a <button id="spec-table-upload-btn"> and a <span id="spec-table-file-label">
 * inside the #table-form panel in index.html.
 * Falls back gracefully if those elements don't exist yet.
 *
 * Called once from js/09-init.js during application boot.
 */
function initSpecTableUpload() {
  const btn = $('spec-table-upload-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    let fi = $('spec-table-file-input');
    if (!fi) {
      fi = document.createElement('input');
      fi.type   = 'file';
      fi.id     = 'spec-table-file-input';
      fi.accept = '.txt,.csv,.dat';
      fi.style.display = 'none';
      document.body.appendChild(fi);
      fi.addEventListener('change', function () {
        if (this.files.length > 0) _applySpecTableFile(this.files[0]);
        this.value = '';
      });
    }
    fi.click();
  });
}
