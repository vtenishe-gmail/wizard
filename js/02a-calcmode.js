/*
=====================================================================
FILE: js/02a-calcmode.js
INTENT:
  Step 2 — Calculation Mode.  This module governs two top-level
  architectural choices that shape every subsequent wizard step:

    (A) WHAT to compute: Cutoff Rigidity, Particle Flux, or Both.
    (B) HOW to evaluate background fields at each particle position:
        analytic (gridless) or tri-linear interpolation on a 3-D grid.

  These two selections cascade forward through the wizard:
    • If calcQuantity excludes cutoff, the cutoff-parameter panel is
      hidden and #CUTOFF_RIGIDITY is omitted from AMPS_PARAM.in.
    • If fieldMethod is GRIDLESS, the E-Field step (Step 6) is skipped
      automatically during wizard navigation, MHD field models are
      disabled, and S.eFieldCoro / S.eFieldConvModel are forced off.
    • If fieldMethod is GRID_3D, the user configures grid dimensions
      and spatial extent; all field models (including BATSRUS/GAMERA)
      and electric-field options are available.

METHODS / DESIGN:
  - Reads/writes the shared state object `S` (defined in js/01-state.js).
  - Uses direct DOM manipulation (no framework) for portability.
  - Functions are intentionally small and side-effectful: they update `S`
    and then update the DOM so the UI always reflects the current state.
  - Constraint propagation uses applyFieldMethodConstraints(), which is
    called from setFieldMethod() and also from init() to enforce the
    default GRIDLESS constraints at page load.

IMPLEMENTATION NOTES:
  - Prefer pure helpers for formatting and mapping, but keep UI updates
    local so it's clear which elements are affected.
  - Avoid introducing new global names unless necessary; when you do,
    document them here and in-line.
  - Keep behavior consistent between modular (index.html + js/*.js) and
    standalone (AMPS_Interface.html) entrypoints.
  - When adding or modifying constraints, update the parallel
    validation checks in js/08-review.js → buildValidation().

LAST UPDATED: 2026-02-21
=====================================================================
*/
/* =============================================================================
   FILE:    js/02a-calcmode.js
   PROJECT: AMPS CCMC Submission Interface  v3
   PURPOSE: Step 2 — Calculation Mode selection and constraint propagation.

   ─── BACKGROUND ──────────────────────────────────────────────────────

   AMPS supports two fundamentally different calculation workflows:

   1. CUTOFF RIGIDITY
      For each observation point (trajectory or grid node), AMPS injects
      test particles backward across a range of kinetic energies
      [CUTOFF_EMIN, CUTOFF_EMAX], distributed into CUTOFF_NENERGY
      log-spaced energy bins.  At each bin, up to
      CUTOFF_MAX_PARTICLES / CUTOFF_NENERGY particles are launched
      isotropically.  A particle is classified as "allowed" if the
      backward trace reaches the outer domain boundary (magnetopause),
      or "forbidden" if it is trapped, absorbed at the inner boundary,
      or exceeds the maximum bounce count.  The effective cutoff rigidity
      Rc is the rigidity at the allowed/forbidden transition.

      Key state properties:
        S.cutoffEmin, S.cutoffEmax   — energy scan window [MeV/n]
        S.cutoffMaxParticles         — total test particles per point
        S.cutoffNenergy              — number of log-spaced energy bins

   2. DENSITY_SPECTRUM  (Particle Energy Spectrum & Density)
      At each observation point, AMPS backward-traces test particles
      across a user-defined energy grid [DS_EMIN, DS_EMAX], divided
      into DS_NINTERVALS intervals (log or linear).  The resulting
      transmission function (which rigidities reach the boundary)
      is folded with the boundary source spectrum (Step 8) to compute
      energy-resolved particle density and spectral intensity at that
      location.  This mode uses backward integration — similar in
      mechanism to cutoff rigidity — but produces a full spectrum
      rather than a single cutoff value.

   ─── FIELD EVALUATION METHODS ─────────────────────────────────────────

   The second architectural choice is how the background magnetic (and
   optionally electric) field is evaluated at each particle position
   during the Lorentz-force integration:

   A. GRIDLESS  (analytic evaluation)
      The selected Tsyganenko empirical model (TS05, T96, T01,
      TA16RBF, or TA15) is called analytically for every particle position
      via the GEOPACK library.  This is the standard approach for
      geomagnetic cutoff rigidity:
        – Extremely accurate: no interpolation error.
        – Moderate speed: the Tsyganenko model call itself is the
          bottleneck (especially RBF models with large coefficient sets).
        – No electric field: the corotation and convection E are
          excluded because they would require spatial derivatives
          (∇Φ) that are expensive to compute analytically at every step.
        – MHD fields (BATSRUS, GAMERA) are NOT available because
          they exist only on a pre-computed grid — there is no analytic
          formula to evaluate them at arbitrary positions.
      AMPS_PARAM.in keyword: FIELD_EVAL_METHOD = GRIDLESS

   B. GRID_3D  (3-D Cartesian interpolation grid)
      Before tracing begins, AMPS pre-computes B and E on a regular
      Cartesian grid in GSM coordinates (Nx × Ny × Nz cells).  During
      tracing, each particle's field value is obtained by tri-linear
      interpolation from the eight surrounding grid nodes.
        – Supports ALL field models including MHD (BATSRUS, GAMERA).
        – Allows electric field (corotation + convection) because Φ
          is also pre-computed on the grid and E = −∇Φ is available
          by finite-difference interpolation.
        – Faster per-step evaluation (interpolation vs. model call),
          but requires a large one-time pre-computation and memory
          allocation: memory ≈ 6 components × 8 bytes × Nx × Ny × Nz.
        – Introduces spatial interpolation error proportional to the
          grid cell size; users can trade accuracy for memory by
          adjusting Nx/Ny/Nz.
      AMPS_PARAM.in keywords:
        FIELD_EVAL_METHOD = GRID_3D
        GRID_NX / NY / NZ = <int>
        GRID_XMIN / XMAX / YMIN / YMAX / ZMIN / ZMAX = <float> [RE]

   ─── PUBLIC API ──────────────────────────────────────────────────────

     setCalcQuantity(target, card)
       Set the calculation target to one of: 'CUTOFF_RIGIDITY',
       'DENSITY_SPECTRUM', or 'DENSITY_3D'.  Updates the card selection
       visuals, shows/hides the parameter panels, and refreshes the sidebar.

     setFieldMethod(method, card)
       Set the field evaluation method to 'GRIDLESS' or 'GRID_3D'.
       Updates card selection, shows/hides grid configuration and
       gridless info banner, then calls applyFieldMethodConstraints()
       to propagate cascading restrictions to downstream steps.

     gridParamChange()
       Reads grid dimension and extent inputs from the DOM, syncs them
       to state S, recomputes memory estimate, and updates keyword
       previews.  Called from onchange handlers on grid input fields.

     cutoffParamChange()
       Reads cutoff energy range, max particles, and bin count from
       the DOM, syncs them to state S, and updates keyword previews
       and the visual energy-range bar.  Called from onchange handlers
       on cutoff input fields.

     applyFieldMethodConstraints()
       Enforces the physical constraints imposed by the field method
       choice on all downstream wizard steps:
         – GRIDLESS: disables MHD model cards (BATSRUS, GAMERA) in
           Step 4; forces E-field off in Step 5; grays out the E-Field
           step indicator in the wizard strip; shows gridless overlay
           in the E-field panel.
         – GRID_3D: re-enables all models and E-field step; removes
           visual restrictions.
       If the currently selected B-field model is MHD and the user
       switches to gridless, this function falls back to TS05 via
       selectFieldModel('TS05').

   ─── INTERNAL HELPERS ────────────────────────────────────────────────

     (none — all helpers are defined locally within their public function)

   ─── DOM ELEMENT IDS USED ────────────────────────────────────────────

     Read by this module:
       calc-target-cards         — container for calculation target cards
       calc-cutoff-card          — CUTOFF_RIGIDITY card
       calc-densspec-card         — DENSITY_SPECTRUM card
       field-method-cards        — container for field method cards
       fm-gridless-card          — GRIDLESS card
       fm-grid3d-card            — GRID_3D card
       grid-nx, grid-ny, grid-nz — grid cell count inputs
       grid-xmin..grid-zmax      — grid spatial extent inputs
       cutoff-emin, cutoff-emax  — energy range inputs
       cutoff-max-particles      — max particles per point input
       cutoff-nenergy            — number of energy bins input

     Written by this module:
       kw-calc-target            — keyword preview: CALC_TARGET value
       kw-field-method           — keyword preview: FIELD_EVAL_METHOD value
       kw-grid-nx, kw-grid-ny, kw-grid-nz — keyword preview: grid dims
       grid-mem-est              — estimated memory usage display
       grid-points-est           — total grid points display
       kw-cutoff-emin, kw-cutoff-emax — keyword preview: energy range
       kw-cutoff-maxp            — keyword preview: max particles
       kw-cutoff-nen             — keyword preview: energy bins
       cutoff-range-label        — human-readable energy range label
       cutoff-bins-label         — human-readable bins count label
       cutoff-particles-label    — human-readable particles/point label
       cutoff-emin-bar, cutoff-emax-bar — energy bar endpoint labels
       gridless-info             — info banner shown in GRIDLESS mode
       grid3d-config             — grid config panel shown in GRID_3D mode
       cutoff-params-section     — Section C, hidden when target ≠ CUTOFF_RIGIDITY
       efield-gridless-overlay   — overlay shown in E-field panel (Step 6)
       fm-batsrus, fm-gamera     — MHD model cards disabled in GRIDLESS

   ─── DEPENDS ON ──────────────────────────────────────────────────────

     js/01-state.js  — S (global state), $ (getElementById shorthand)
     js/02-wizard.js — updateSidebar() (refreshes sidebar after changes)
     js/03-bgfield.js — selectFieldModel() (used to fall back from MHD
                        to TS05 when switching to GRIDLESS)

   ─── CHANGELOG ────────────────────────────────────────────────────────

     2026-02-21  Initial implementation (new Step 2).
       • Calc target selector (CUTOFF_RIGIDITY / DENSITY_SPECTRUM / DENSITY_3D).
       • Two-card field method selector (GRIDLESS / GRID_3D).
       • Cutoff rigidity parameter panel (Emin, Emax, MaxParticles,
         Nenergy) with live keyword preview and visual energy bar.
       • 3-D grid configuration (Nx, Ny, Nz, spatial extent) with
         real-time memory estimation.
       • Constraint propagation: GRIDLESS disables MHD models and
         E-field step; GRID_3D enables all.

=============================================================================*/


/* ═══════════════════════════════════════════════════════════════════
   SECTION A — CALCULATION TARGET
   ═══════════════════════════════════════════════════════════════════ */

/**
 * setCalcQuantity — select what the AMPS run will calculate.
 *
 * This is the primary dispatch for the #CALCULATION_MODE section of
 * AMPS_PARAM.in.  The choice determines:
 *   • Whether the #CUTOFF_RIGIDITY block is emitted in the param file.
 *   • Whether Section C (cutoff parameters) is visible in the wizard.
 *   • Whether Section D (density-spectrum parameters) is visible.
 *   • Whether Section E (3-D density parameters) is visible.
 *   • Whether the Spectrum step (Step 8) is mandatory — DENSITY_SPECTRUM
 *     and DENSITY_3D require a source spectrum; CUTOFF_RIGIDITY does not.
 *   • Whether the 3-D grid is required — DENSITY_3D forces GRID_3D
 *     because density is sampled on the simulation grid.
 *
 * @param {'CUTOFF_RIGIDITY'|'DENSITY_SPECTRUM'|'DENSITY_3D'} target
 * @param {HTMLElement} card — the clicked opt-card element (for styling)
 */
function setCalcQuantity(target, card) {
  /* ── 1. Update global state ── */
  S.calcQuantity = target;

  /* ── 2. Visual feedback: highlight the selected card ── */
  document.querySelectorAll('#calc-target-cards .opt-card').forEach(c => c.classList.remove('sel'));
  if (card) card.classList.add('sel');

  /* ── 3. Update the keyword preview strip ── */
  const kw = $('kw-calc-target');
  if (kw) kw.textContent = target;

  /* ── 4. Show/hide Section C: Cutoff Rigidity Parameters ──
   *  Shown for CUTOFF_RIGIDITY only. */
  const cutSec = $('cutoff-params-section');
  if (cutSec) {
    cutSec.style.display = (target === 'CUTOFF_RIGIDITY') ? '' : 'none';
  }

  /* ── 5. Show/hide Section D: Density-Spectrum Parameters ──
   *  Shown only for DENSITY_SPECTRUM. */
  const dsSec = $('densspec-params-section');
  if (dsSec) {
    dsSec.style.display = (target === 'DENSITY_SPECTRUM') ? '' : 'none';
  }

  /* ── 6. Show/hide Section E: 3-D Ion Density Parameters ──
   *  Shown only for DENSITY_3D. */
  const densSec = $('density-params-section');
  if (densSec) {
    densSec.style.display = (target === 'DENSITY_3D') ? '' : 'none';
  }

  /* ── 7. Force GRID_3D when DENSITY_3D is selected ──
   *  3-D density sampling requires a simulation grid. */
  if (target === 'DENSITY_3D' && S.fieldMethod === 'GRIDLESS') {
    const g3Card = $('fm-grid3d-card');
    setFieldMethod('GRID_3D', g3Card);
    const warn = $('density-grid-warn');
    if (warn) warn.style.display = '';
  } else {
    const warn = $('density-grid-warn');
    if (warn) warn.style.display = 'none';
  }

  /* ── 8. Refresh sidebar summary ── */
  updateSidebar();

  /* ── 9. Update directional map visibility (depends on calc target) ── */
  if (typeof updateDirMapVisibility === 'function') updateDirMapVisibility();
}


/* ═══════════════════════════════════════════════════════════════════
   SECTION B — FIELD EVALUATION METHOD
   ═══════════════════════════════════════════════════════════════════ */

/**
 * setFieldMethod — select how background fields are evaluated.
 *
 * This choice has far-reaching consequences for the rest of the wizard:
 *   GRIDLESS → no E-field, no MHD models, E-field step skipped.
 *   GRID_3D  → all models available, E-field enabled, grid config shown.
 *
 * The constraint propagation is handled by applyFieldMethodConstraints(),
 * called at the end of this function.
 *
 * @param {'GRIDLESS'|'GRID_3D'} method — field evaluation method
 * @param {HTMLElement} card — the clicked bnd-card element (for styling)
 */
function setFieldMethod(method, card) {
  /* ── 1. Update global state ── */
  S.fieldMethod = method;

  /* ── 2. Visual feedback: highlight the selected card ──
   *  The field-method cards use the .bnd-card class (shared with
   *  the Boundary step cards) for consistent selection styling. */
  document.querySelectorAll('#field-method-cards .bnd-card').forEach(c => c.classList.remove('sel'));
  if (card) card.classList.add('sel');

  /* ── 3. Update the keyword preview strip ── */
  const kw = $('kw-field-method');
  if (kw) kw.textContent = method;

  /* ── 4. Toggle sub-panels ──
   *  GRIDLESS: show the info banner explaining restrictions.
   *  GRID_3D:  show the grid configuration form (Nx, Ny, Nz, extents). */
  const glInfo   = $('gridless-info');
  const g3Config = $('grid3d-config');
  if (glInfo)   glInfo.style.display   = method === 'GRIDLESS' ? '' : 'none';
  if (g3Config) g3Config.style.display = method === 'GRID_3D'  ? '' : 'none';

  /* ── 5. Propagate constraints to downstream wizard steps ── */
  applyFieldMethodConstraints();

  /* ── 6. Refresh sidebar summary ── */
  updateSidebar();
}


/* ═══════════════════════════════════════════════════════════════════
   CONSTRAINT PROPAGATION
   ═══════════════════════════════════════════════════════════════════ */

/**
 * applyFieldMethodConstraints — enforce cascading restrictions.
 *
 * Called from:
 *   - setFieldMethod() whenever the user changes the field method.
 *   - init() (js/09-init.js) to enforce the default constraints at
 *     page load (default: GRIDLESS → MHD disabled, E-field off).
 *
 * Three areas are constrained:
 *
 *   1. B-FIELD MODEL CARDS (Step 4):
 *      MHD models (BATSRUS, GAMERA) require field data on a grid —
 *      there is no analytic formula.  In gridless mode these cards
 *      are dimmed (opacity 0.35), pointer-events disabled, and given
 *      a tooltip explaining the restriction.  If the user previously
 *      selected an MHD model and then switches to gridless, the
 *      selection falls back to TS05 automatically.
 *
 *   2. E-FIELD STEP (Step 5):
 *      In gridless mode, electric field is excluded because computing
 *      E = −∇Φ analytically at every particle step is prohibitively
 *      expensive and not standard practice for cutoff calculations.
 *      The E-field state variables are forced off:
 *        S.eFieldCoro = false
 *        S.eFieldConvModel = 'NONE'
 *      The wizard step indicator in the strip is grayed out with
 *      the .step-disabled CSS class, and the goStep() function in
 *      js/02-wizard.js skips step 5 during forward/backward nav.
 *      An overlay banner is shown inside the E-field panel itself
 *      (in case the user navigates there directly via click).
 *
 *   3. GRID_3D RESTORATION:
 *      When the user switches back from gridless to GRID_3D, all
 *      restrictions are lifted: MHD cards re-enabled, E-field step
 *      restored, overlay hidden.  The E-field state is NOT
 *      automatically restored (the user must re-enable corotation
 *      and/or convection manually in Step 6).
 */
function applyFieldMethodConstraints() {
  const isGridless = S.fieldMethod === 'GRIDLESS';

  /* ── 1. Constrain B-field model cards in Step 4 ──────────────────
   *  The MHD model cards have ids 'fm-batsrus' and 'fm-gamera' in
   *  the Step 4 HTML (set by selectFieldModel() in js/03-bgfield.js).
   *  We dim them and block pointer events when gridless is active. */
  ['batsrus', 'gamera'].forEach(id => {
    const card = $(`fm-${id}`);
    if (!card) return;   // card may not exist if DOM hasn't loaded yet
    if (isGridless) {
      card.classList.add('disabled');
      card.style.opacity = '0.35';
      card.style.pointerEvents = 'none';
      card.title = 'MHD models require 3-D grid mode (select in Step 2)';
    } else {
      card.classList.remove('disabled');
      card.style.opacity = '';
      card.style.pointerEvents = '';
      card.title = '';
    }
  });

  /* ── 1b. Fall back from MHD if switching to gridless ─────────────
   *  If the user previously chose BATSRUS or GAMERA and then switches
   *  to gridless, the selection is invalid.  We fall back to TS05,
   *  which is the most commonly used Tsyganenko model.
   *  selectFieldModel() is defined in js/03-bgfield.js and handles
   *  card selection, state update, and driver-form visibility. */
  if (isGridless && (S.fieldModel === 'BATSRUS' || S.fieldModel === 'GAMERA')) {
    if (typeof selectFieldModel === 'function') {
      selectFieldModel('TS05');
    }
  }

  /* ── 2. Constrain E-field state (Step 6) ─────────────────────────
   *  In gridless mode, electric field is physically excluded.
   *  We set the two E-field state properties directly so that:
   *    - The sidebar shows "N/A (gridless)" for E-field.
   *    - The param-file builder omits E-field keywords.
   *    - The E-field panel itself shows the gridless overlay.
   *  Note: we do NOT restore these when switching to GRID_3D —
   *  the user must explicitly re-enable E-field in Step 5. */
  if (isGridless) {
    S.eFieldCoro = false;
    S.eFieldConvModel = 'NONE';
  }

  /* ── 2c. Sync Step 7 E-field driver section ───────────────────────
   *  Mirrors Step 5 availability: the E-field drivers fold is visible
   *  whenever fieldMethod === 'GRID_3D', hidden when GRIDLESS.
   *  When switching back to GRID_3D after gridless forced eFieldConvModel
   *  to 'NONE', restore the last user selection (stored in S._prevConvModel)
   *  or default to VOLLAND_STERN so the fold appears immediately. */
  if (!isGridless && S.eFieldConvModel === 'NONE') {
    /* Restore previous model so the fold becomes visible again.
       The user can still change it in Step 5. */
    S.eFieldConvModel = S._prevConvModel || 'VOLLAND_STERN';
    /* Sync the Step 6 card selection to the restored model */
    if (typeof setConvModel === 'function') setConvModel(S.eFieldConvModel);
  }
  if (isGridless) {
    /* Save before forcing to NONE so we can restore on GRID_3D switch */
    if (S.eFieldConvModel !== 'NONE') S._prevConvModel = S.eFieldConvModel;
  }
  if (typeof updateEfieldDriverTab === 'function') {
    updateEfieldDriverTab(isGridless ? 'NONE' : (S.eFieldConvModel || 'VOLLAND_STERN'));
  }

  /* ── 2b. Show/hide gridless overlay inside E-field panel ─────────
   *  The overlay (id='efield-gridless-overlay') is an info-orange
   *  banner at the top of the E-field sect-body.  When gridless is
   *  active it is visible; otherwise hidden.  This handles the case
   *  where a user clicks directly on the Step 5 indicator. */
  const efOverlay = $('efield-gridless-overlay');
  if (efOverlay) efOverlay.style.display = isGridless ? '' : 'none';

  /* ── 3. Update the E-field wizard step indicator ─────────────────
   *  Find the E-Field step dynamically from WIZARD_STEPS rather than
   *  hardcoding an index.  This keeps working if steps are added,
   *  removed, or reordered in the WIZARD_STEPS config array.
   *
   *  In gridless mode we add .step-disabled CSS class and a title
   *  tooltip.  The actual step-skip during navigation is handled
   *  by shouldSkipStep() in js/02-wizard.js.
   *
   *  We do NOT add the E-field step to S.done.  The .step-disabled
   *  CSS class provides its own distinct "N/A" visual (dim text +
   *  strikethrough + dashed gray underline) that is separate from
   *  both the "done" (green) and "unvisited" (default gray) states.
   *
   *  When switching back to GRID_3D, we remove .step-disabled so
   *  the step reverts to its normal unvisited state. */
  const wzSteps = document.querySelectorAll('#wizard-strip .wz-step');
  /* Find the index of the E-Field step (panel-6) in WIZARD_STEPS.
   * If WIZARD_STEPS exists (defined in 02-wizard.js), use it;
   * otherwise fall back to index 5 for backwards compatibility. */
  let efIdx = 3;   // fallback: 0-based index for E-Field (step 4 after Run Info removed)
  if (typeof WIZARD_STEPS !== 'undefined') {
    const found = WIZARD_STEPS.findIndex(s => s.panel === 'panel-6');
    if (found >= 0) efIdx = found;
  }
  if (wzSteps.length > efIdx) {
    const efStep = wzSteps[efIdx];
    if (isGridless) {
      efStep.classList.add('step-disabled');
      efStep.title = 'Electric field is excluded in gridless mode';
    } else {
      efStep.classList.remove('step-disabled');
      efStep.title = '';
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════
   3-D GRID CONFIGURATION
   ═══════════════════════════════════════════════════════════════════ */

/**
 * gridParamChange — synchronize 3-D grid inputs to state S.
 *
 * Called from the onchange handlers on the grid-nx, grid-ny, grid-nz,
 * grid-xmin, grid-xmax, grid-ymin, grid-ymax, grid-zmin, grid-zmax
 * input fields in the panel-2 HTML.
 *
 * After reading all inputs into S, the function:
 *   1. Updates the keyword preview spans (kw-grid-nx, etc.).
 *   2. Recomputes the estimated memory footprint:
 *        memory ≈ 6 field components × 8 bytes/float64 × Nx × Ny × Nz
 *      (6 components = Bx, By, Bz, Ex, Ey, Ez — full EM field).
 *   3. Displays the total grid point count with locale formatting.
 *   4. Refreshes the sidebar summary.
 */
function gridParamChange() {
  /* ── Read grid dimension inputs ──
   *  parseInt/parseFloat with fallback to existing S value if
   *  the input is empty or non-numeric (defensive against NaN). */
  S.gridNx   = Number.parseInt($('grid-nx')?.value)   || S.gridNx;
  S.gridNy   = Number.parseInt($('grid-ny')?.value)   || S.gridNy;
  S.gridNz   = Number.parseInt($('grid-nz')?.value)   || S.gridNz;

  /* ── Read grid spatial extent inputs ──
   *  Nullish coalescing (??) is used instead of || because a
   *  legitimate value of 0.0 would be falsy with ||. */
  S.gridXmin = Number.parseFloat($('grid-xmin')?.value) ?? S.gridXmin;
  S.gridXmax = Number.parseFloat($('grid-xmax')?.value) ?? S.gridXmax;
  S.gridYmin = Number.parseFloat($('grid-ymin')?.value) ?? S.gridYmin;
  S.gridYmax = Number.parseFloat($('grid-ymax')?.value) ?? S.gridYmax;
  S.gridZmin = Number.parseFloat($('grid-zmin')?.value) ?? S.gridZmin;
  S.gridZmax = Number.parseFloat($('grid-zmax')?.value) ?? S.gridZmax;

  /* ── Update keyword preview elements ── */
  const setKw = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setKw('kw-grid-nx', S.gridNx);
  setKw('kw-grid-ny', S.gridNy);
  setKw('kw-grid-nz', S.gridNz);

  /* ── Estimate memory footprint ──
   *  6 field components (Bx, By, Bz, Ex, Ey, Ez) stored as 64-bit
   *  floats (8 bytes each) at every grid node.
   *  Example: 100 × 100 × 60 = 600,000 nodes × 48 bytes = ~28.8 MB
   *  (with padding and overhead, actual usage is typically ~8× this,
   *   so the displayed estimate uses a 6×8 = 48 bytes/node factor
   *   divided by 1e6 to get MB). */
  const npts = S.gridNx * S.gridNy * S.gridNz;
  const memMB = Math.round(npts * 6 * 8 / 1e6);
  setKw('grid-mem-est', `~${memMB} MB`);
  setKw('grid-points-est', npts.toLocaleString());

  /* ── Refresh sidebar ── */
  updateSidebar();
}


/* ═══════════════════════════════════════════════════════════════════
   CUTOFF RIGIDITY PARAMETERS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * cutoffParamChange — synchronize cutoff rigidity inputs to state S.
 *
 * Called from the onchange handlers on the cutoff-emin, cutoff-emax,
 * cutoff-max-particles, and cutoff-nenergy input fields in the
 * panel-2 HTML (Section C).
 *
 * The cutoff scan works as follows in the AMPS solver:
 *   1. The energy range [Emin, Emax] is divided into Nenergy bins,
 *      log-spaced (i.e. equal spacing in log10(E)).
 *   2. At each observation point and each energy bin, a batch of
 *      test particles (MaxParticles / Nenergy, rounded) is injected
 *      isotropically in pitch angle.
 *   3. Each particle is traced backward in time through the
 *      geomagnetic field.
 *   4. If the trace reaches the outer boundary → allowed.
 *      If it is absorbed at the inner boundary, exceeds MAX_BOUNCE,
 *      or re-enters the forbidden region → forbidden.
 *   5. The effective cutoff rigidity Rc is determined as the
 *      lowest rigidity (highest energy) at which all particles
 *      in the bin are allowed.  The penumbra is the zone where
 *      some particles are allowed and some forbidden.
 *
 * After syncing to S, this function:
 *   1. Updates keyword preview spans in the param-file strip.
 *   2. Updates the human-readable labels above the visual energy bar.
 *   3. Updates the energy bar endpoint labels.
 *   4. Refreshes the sidebar summary.
 */
function cutoffParamChange() {
  /* ── Read cutoff parameter inputs ──
   *  || fallback is safe here because 0 is never a valid value
   *  for any of these parameters (Emin > 0, Emax > 0, etc.). */
  S.cutoffEmin         = Number.parseFloat($('cutoff-emin')?.value)          || S.cutoffEmin;
  S.cutoffEmax         = Number.parseFloat($('cutoff-emax')?.value)          || S.cutoffEmax;
  S.cutoffMaxParticles = Number.parseInt($('cutoff-max-particles')?.value)   || S.cutoffMaxParticles;
  S.cutoffNenergy      = Number.parseInt($('cutoff-nenergy')?.value)         || S.cutoffNenergy;
  S.cutoffMaxTrajTime  = Number.parseInt($('cutoff-max-traj-time')?.value)   || S.cutoffMaxTrajTime;

  /* ── Sync directional map resolution inputs ── */
  S.dirMapLonRes       = Number.parseInt($('dirmap-lon-res')?.value)         || S.dirMapLonRes;
  S.dirMapLatRes       = Number.parseInt($('dirmap-lat-res')?.value)         || S.dirMapLatRes;

  /* ── Update keyword preview elements ── */
  const setKw = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setKw('kw-cutoff-emin', S.cutoffEmin.toFixed(1));
  setKw('kw-cutoff-emax', S.cutoffEmax.toFixed(1));
  setKw('kw-cutoff-maxp', S.cutoffMaxParticles);
  setKw('kw-cutoff-nen',  S.cutoffNenergy);
  setKw('kw-cutoff-trajt', S.cutoffMaxTrajTime);
  setKw('kw-cutoff-samp', S.cutoffSampling);

  /* ── Update directional map keyword previews ── */
  const showDirKw = S.directionalMap && (S.outputMode === 'POINTS' || S.outputMode === 'TRAJECTORY');
  const kwDirRow    = $('kw-dirmap-row');
  const kwDirLonRow = $('kw-dirmap-lon-row');
  const kwDirLatRow = $('kw-dirmap-lat-row');
  if (kwDirRow)    kwDirRow.style.display    = showDirKw ? '' : 'none';
  if (kwDirLonRow) kwDirLonRow.style.display = showDirKw ? '' : 'none';
  if (kwDirLatRow) kwDirLatRow.style.display = showDirKw ? '' : 'none';
  if (showDirKw) {
    setKw('kw-dirmap',     'T');
    setKw('kw-dirmap-lon', S.dirMapLonRes);
    setKw('kw-dirmap-lat', S.dirMapLatRes);
  }

  /* ── Update directional map sky-map size label ── */
  const nLon = Math.floor(360 / S.dirMapLonRes);
  const nLat = Math.floor(90  / S.dirMapLatRes);
  setKw('dirmap-size-label', `${nLon} × ${nLat} = ${nLon * nLat} directions`);

  /* ── Update visual labels ── */
  setKw('cutoff-range-label',     `${S.cutoffEmin.toFixed(1)} – ${S.cutoffEmax.toFixed(1)} MeV/n`);
  setKw('cutoff-bins-label',      `${S.cutoffNenergy} bins (log-spaced)`);
  setKw('cutoff-particles-label', `${S.cutoffMaxParticles} particles/point`);
  setKw('cutoff-traj-time-label', `${S.cutoffMaxTrajTime} s max tracking`);

  /* ── Update energy bar endpoint labels ── */
  setKw('cutoff-emin-bar',        `${S.cutoffEmin.toFixed(1)} MeV/n`);
  setKw('cutoff-emax-bar',        `${S.cutoffEmax.toFixed(0)} MeV/n`);

  /* ── Refresh sidebar ── */
  updateSidebar();
}


/* ═══════════════════════════════════════════════════════════════════
   CUTOFF SAMPLING MODE  (VERTICAL / ISOTROPIC)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * setCutoffSampling — toggle between vertical and isotropic cutoff sampling.
 *
 * VERTICAL:  inject test particles along the local radial (vertical)
 *            direction only — yields the standard "vertical cutoff rigidity".
 * ISOTROPIC: inject test particles isotropically over the upper hemisphere
 *            — yields the "effective" (omnidirectional) cutoff rigidity.
 *
 * @param {'VERTICAL'|'ISOTROPIC'} mode — cutoff sampling mode
 */
function setCutoffSampling(mode) {
  S.cutoffSampling = mode;

  /* ── Toggle button visual state ── */
  const vertBtn = $('cutoff-samp-vert');
  const isoBtn  = $('cutoff-samp-iso');
  if (vertBtn) vertBtn.classList.toggle('on', mode === 'VERTICAL');
  if (isoBtn)  isoBtn.classList.toggle('on',  mode === 'ISOTROPIC');

  /* ── Refresh keyword preview and sidebar ── */
  cutoffParamChange();
}


/* ═══════════════════════════════════════════════════════════════════
   DIRECTIONAL CUTOFF RIGIDITY MAP
   ═══════════════════════════════════════════════════════════════════ */

/**
 * setDirectionalMap — toggle the directional cutoff rigidity map option.
 *
 * When enabled, AMPS scans a longitude × latitude grid of arrival
 * directions at each observation point to produce a full sky-map
 * of directional cutoff rigidity.  Only available for POINTS and
 * TRAJECTORY output modes.
 *
 * @param {boolean} on — whether to enable the directional map
 */
function setDirectionalMap(on) {
  S.directionalMap = !!on;

  /* ── Show/hide resolution inputs ── */
  const resDiv = $('dirmap-resolution');
  if (resDiv) resDiv.style.display = on ? '' : 'none';

  /* ── Refresh keyword preview and sidebar ── */
  cutoffParamChange();
}


/**
 * updateDirMapVisibility — show or hide the directional map section
 * based on the current output mode.
 *
 * The directional map option is only meaningful when the output mode
 * is POINTS or TRAJECTORY (each point gets its own directional sky-map).
 * For SHELLS mode, the concept does not apply (shells are already
 * spatially resolved; directional maps would be redundant).
 *
 * Called from:
 *   - setOutputMode() in js/07-spectrum-output.js
 *   - init() boot sequence
 *   - cutoffParamChange() indirectly via updateSidebar
 */
function updateDirMapVisibility() {
  const section   = $('dirmap-section');
  const eligible  = S.calcQuantity === 'CUTOFF_RIGIDITY' &&
                    (S.outputMode === 'POINTS' || S.outputMode === 'TRAJECTORY');
  if (section) section.style.display = eligible ? '' : 'none';

  /* If output mode changed to SHELLS while dirmap was on, disable it */
  if (!eligible && S.directionalMap) {
    S.directionalMap = false;
    const cb = $('cutoff-dirmap');
    if (cb) cb.checked = false;
    const resDiv = $('dirmap-resolution');
    if (resDiv) resDiv.style.display = 'none';
  }

  cutoffParamChange();
}


/* ═══════════════════════════════════════════════════════════════════
   3-D ION DENSITY SAMPLING PARAMETERS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * densityParamChange — synchronize 3-D density sampling inputs to state S.
 *
 * Called from the onchange handlers on the dens-emin, dens-emax, and
 * dens-nenergy input fields in the panel-2 HTML (Section D).
 *
 * In DENSITY_3D mode, AMPS forward-models particle transport:
 *   1. Particles are injected from the outer boundary with the source
 *      spectrum (Step 8) and traced forward through the EM field.
 *   2. As particles traverse the simulation grid, their contribution
 *      to the local ion density is accumulated in energy-resolved bins.
 *   3. The energy range [densEmin, densEmax] is divided into
 *      densNenergy bins (log or linear spacing, set by setDensSpacing).
 *   4. Each bin k produces a separate 3-D output field:
 *        n_i(E_k, x, y, z)  [cm^-3]
 *      representing the spatial distribution of ions in that energy band.
 *
 * After syncing to S, this function:
 *   1. Updates keyword preview spans in the AMPS_PARAM.in strip.
 *   2. Updates the visual energy-bins bar labels.
 *   3. Refreshes the sidebar summary.
 */
function densityParamChange() {
  /* ── Read density parameter inputs ──
   *  || fallback is safe because 0 is never valid for these params. */
  S.densEmin     = Number.parseFloat($('dens-emin')?.value)    || S.densEmin;
  S.densEmax     = Number.parseFloat($('dens-emax')?.value)    || S.densEmax;
  S.densNenergy  = Number.parseInt($('dens-nenergy')?.value)   || S.densNenergy;

  /* ── Update keyword preview elements ── */
  const setKw = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setKw('kw-dens-emin', S.densEmin.toFixed(1));
  setKw('kw-dens-emax', S.densEmax.toFixed(1));
  setKw('kw-dens-nen',  S.densNenergy);

  /* ── Update visual labels ──
   *  Displayed above the gradient energy-bins bar in Section D. */
  const spacingLabel = S.densEnergySpacing === 'LOG' ? 'log-spaced' : 'linear';
  setKw('dens-range-label',   `${S.densEmin.toFixed(1)} – ${S.densEmax.toFixed(1)} MeV/n`);
  setKw('dens-bins-label',    `${S.densNenergy} bins`);
  setKw('dens-spacing-label', spacingLabel);

  /* ── Update energy bar endpoint labels ── */
  setKw('dens-emin-bar',      `${S.densEmin.toFixed(1)} MeV/n`);
  setKw('dens-emax-bar',      `${S.densEmax.toFixed(0)} MeV/n`);
  setKw('dens-spacing-bar',   `← ${spacingLabel} bins →`);

  /* ── Refresh sidebar ── */
  updateSidebar();
}


/**
 * setDensSpacing — toggle energy bin spacing between LOG and LINEAR.
 *
 * Called from the toggle button pair in Section D.  Updates S, the
 * toggle button visual state, keyword preview, and visual bar labels.
 *
 * @param {'LOG'|'LINEAR'} mode — energy bin spacing
 */
function setDensSpacing(mode) {
  S.densEnergySpacing = mode;

  /* ── Toggle button visual state ── */
  const logBtn = $('dens-log-btn');
  const linBtn = $('dens-lin-btn');
  if (logBtn) logBtn.classList.toggle('on', mode === 'LOG');
  if (linBtn) linBtn.classList.toggle('on', mode === 'LINEAR');

  /* ── Update keyword preview ── */
  const kwEl = $('kw-dens-spacing');
  if (kwEl) kwEl.textContent = mode;

  /* ── Refresh visual bar and sidebar via densityParamChange ── */
  densityParamChange();
}


/* ═══════════════════════════════════════════════════════════════════
   DENSITY-SPECTRUM SAMPLING PARAMETERS  (DENSITY_SPECTRUM mode)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * dsParamChange — synchronize density-spectrum sampling inputs to state S.
 *
 * Called from the onchange handlers on the ds-emin, ds-emax, and
 * ds-nintervals input fields in the panel-2 HTML (Section D).
 *
 * In DENSITY_SPECTRUM mode, AMPS backward-traces from each
 * observation point:
 *   1. The energy range [dsEmin, dsEmax] is divided into
 *      dsNintervals intervals (log or linear spacing).
 *   2. At each interval boundary, test particles are launched
 *      isotropically backward through the geomagnetic field.
 *   3. The resulting transmission function is folded with the
 *      user-provided boundary spectrum (Step 8).
 *   4. Output at each point: energy-resolved particle density
 *      and spectral intensity.
 */
function dsParamChange() {
  S.dsEmin          = Number.parseFloat($('ds-emin')?.value)          || S.dsEmin;
  S.dsEmax          = Number.parseFloat($('ds-emax')?.value)          || S.dsEmax;
  S.dsNintervals    = Number.parseInt($('ds-nintervals')?.value)      || S.dsNintervals;
  S.dsMaxParticles  = Number.parseInt($('ds-max-particles')?.value)   || S.dsMaxParticles;
  S.dsMaxTrajTime   = Number.parseInt($('ds-max-traj-time')?.value)   || S.dsMaxTrajTime;

  /* ── Update keyword preview elements ── */
  const setKw = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setKw('kw-ds-emin', S.dsEmin.toFixed(1));
  setKw('kw-ds-emax', S.dsEmax.toFixed(1));
  setKw('kw-ds-nint', S.dsNintervals);
  setKw('kw-ds-maxp', S.dsMaxParticles);
  setKw('kw-ds-trajt', S.dsMaxTrajTime);

  /* ── Update visual labels ── */
  const spacingLabel = S.dsEnergySpacing === 'LOG' ? 'log-spaced' : 'linear';
  setKw('ds-range-label',     `${S.dsEmin.toFixed(1)} – ${S.dsEmax.toFixed(1)} MeV/n`);
  setKw('ds-intervals-label', `${S.dsNintervals} intervals`);
  setKw('ds-spacing-label',   spacingLabel);
  setKw('ds-particles-label', `${S.dsMaxParticles} particles/point`);
  setKw('ds-traj-time-label', `${S.dsMaxTrajTime} s max tracking`);

  /* ── Update energy bar endpoint labels ── */
  setKw('ds-emin-bar',        `${S.dsEmin.toFixed(1)} MeV/n`);
  setKw('ds-emax-bar',        `${S.dsEmax.toFixed(0)} MeV/n`);
  setKw('ds-spacing-bar',     `← ${spacingLabel} intervals →`);

  updateSidebar();
}


/**
 * setDsSpacing — toggle energy interval spacing between LOG and LINEAR.
 *
 * @param {'LOG'|'LINEAR'} mode
 */
function setDsSpacing(mode) {
  S.dsEnergySpacing = mode;

  const logBtn = $('ds-log-btn');
  const linBtn = $('ds-lin-btn');
  if (logBtn) logBtn.classList.toggle('on', mode === 'LOG');
  if (linBtn) linBtn.classList.toggle('on', mode === 'LINEAR');

  const kwEl = $('kw-ds-spacing');
  if (kwEl) kwEl.textContent = mode;

  dsParamChange();
}
