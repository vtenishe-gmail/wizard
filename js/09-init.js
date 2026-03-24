/*
=====================================================================
FILE: js/09-init.js
INTENT:
  JavaScript logic for the AMPS web wizard (static site). This module
  implements a focused part of the UI: state updates, model selection,
  preview rendering, or navigation.

METHODS / DESIGN:
  - Reads/writes the shared state object `S` (defined in js/01-state.js).
  - Uses direct DOM manipulation (no framework) for portability.
  - Functions are intentionally small and side-effectful: they update `S`
    and then update the DOM so the UI always reflects the current state.

IMPLEMENTATION NOTES:
  - Prefer pure helpers for formatting and mapping, but keep UI updates
    local so it’s clear which elements are affected.
  - Avoid introducing new global names unless necessary; when you do,
    document them here and in-line.
  - Keep behavior consistent between modular (index.html + js/*.js) and
    standalone (AMPS_Interface.html) entrypoints.

LAST UPDATED: 2026-02-21
=====================================================================
*/
/* =============================================================================
   FILE:    js/09-init.js
   PROJECT: AMPS CCMC Submission Interface  v3
   PURPOSE: Application bootstrap — wires everything together after the DOM
            is fully parsed.

   BOOT SEQUENCE
     1. drawSvgGrid('shue-grid')  — paint background grid in the Shue SVG
     2. drawSvgGrid('box-grid')   — paint background grid in the BOX SVG
     3. bndShueUpdate()           — compute initial Shue r₀/α and draw curve
     4. Compute initial Kp from default Dst via dstToKp()
     5. Compute initial VS intensity A from Kp via vsIntensityA()
     6. Update auto-Kp display label in the VS panel
     7. renderBins()              — build initial energy bin list DOM
     8. drawSpec()                — draw initial spectrum canvas
     9. drawEfieldSchematic()     — draw initial efield SVG schematic
    10. updateSidebar()           — populate sidebar summary
   10a. applyFieldMethodConstraints() — enforce initial GRIDLESS constraints
        (disables MHD model cards, grays out E-field step indicator,
         shows gridless overlay in E-field panel).  Must run after
         updateSidebar() so that sidebar reflects the constrained state,
         and before goStep(1) so that the wizard strip is correct.
    11. goStep(1)                 — navigate to Step 1 (Run Info)

   NOTE: The DOMContentLoaded event is used (not window.onload) so that
         init runs as soon as the HTML tree is ready, without waiting for
         images or other resources.

   DEPENDS ON: all other modules (must be loaded last)
               Specifically added: 02a-calcmode.js (applyFieldMethodConstraints)
=============================================================================*/

/**
 * Application entry point.
 * Called once when the DOM is ready.
 */
function init() {
  /* ── 1–2. Background grids for SVG diagrams ── */
  drawSvgGrid('shue-grid');
  drawSvgGrid('box-grid');

  /* ── 3. Initial Shue magnetopause diagram ── */
  bndShueUpdate();

  /* ── 3a. Ensure Step-3 field model UI is consistent with S ── */
  if(typeof selectFieldModel==='function') selectFieldModel(S.fieldModel||'TS05');
  // Sync the visible model form + keyword preview with the active model.
  if(S.fieldModel==='TS05'){ if(typeof ts05Change==='function') ts05Change(); }
  else if(S.fieldModel==='T96'){ if(typeof t96Change==='function') t96Change(); }
  else if(S.fieldModel==='T01'){ if(typeof t01Change==='function') t01Change(); }
  else if(S.fieldModel==='TA16RBF'){ if(typeof ta16Change==='function') ta16Change(); }
  else if(S.fieldModel==='TA15'){ if(typeof ta15Change==='function') ta15Change(); }
  else if(typeof ts05Change==='function') ts05Change();

  /* ── 4–6. Volland–Stern initial Kp and intensity ── */
  S.vsKp = dstToKp(S.dst);          // derive Kp from default Dst = -142 nT
  S.vsA  = vsIntensityA(S.vsKp);
  const kpDisplay = $('vs-kp-auto-display');
  if (kpDisplay) kpDisplay.textContent = S.vsKp.toFixed(1);

  /* ── 7. Energy bin list ── */
  renderBins();

  /* ── 8. Spectrum canvas ── */
  drawSpec();

  /* ── 8a. Output-domain defaults (POINTS / SHELLS) ──
   * We mirror any default values from S into the UI, then run updateShells()
   * to enforce visibility of Shell altitude fields.
   */
  const pt=$('points-text');
  if(pt && typeof S.pointsText==='string') pt.value=S.pointsText;

  // Initialize shell controls if present.
  const sc=$('shell-count');
  if(sc) sc.value=String(S.shellCount||1);
  const sr=$('shell-res-deg');
  if(sr) sr.value=String(S.shellResDeg||1);
  for(let i=1;i<=5;i++){
    const inp=$(`shell-alt-${i}`);
    if(inp && Array.isArray(S.shellAltsKm) && S.shellAltsKm[i-1]!=null) inp.value=String(S.shellAltsKm[i-1]);
  }
  if(typeof updateShells==='function') updateShells();

  /* ── 9. Electric field schematic ── */
  drawEfieldSchematic();

  /* ── 10. Sidebar summary ── */
  updateSidebar();

  /* ── 10a. Build the wizard step bar from WIZARD_STEPS config ──
   *  Must run BEFORE applyFieldMethodConstraints() and goStep(1)
   *  so the step elements exist when those functions try to
   *  add/remove CSS classes on them.
   *  Defined in: js/02-wizard.js */
  buildWizardStrip();

  /* ── 10b. Apply calculation mode constraints (added 2026-02-21) ──
   *  The default field method is GRIDLESS (analytic Tsyganenko).
   *  applyFieldMethodConstraints() propagates the consequences:
   *    - MHD model cards (BATSRUS, GAMERA) in Step 4 are disabled.
   *    - E-field step indicator in the wizard strip is grayed out.
   *    - E-field overlay is shown inside the Step 6 panel.
   *    - S.eFieldCoro and S.eFieldConvModel are forced off.
   *  Must run after buildWizardStrip() (so the strip elements exist)
   *  and before goStep(1) (so the wizard strip renders correctly).
   *  Defined in: js/02a-calcmode.js */
  applyFieldMethodConstraints();

  /* ── 10c. Initialize directional map visibility (added 2026-03-03) ──
   *  Show/hide the directional cutoff map option based on output mode.
   *  Defined in: js/02a-calcmode.js */
  if (typeof updateDirMapVisibility === 'function') updateDirMapVisibility();

  /* ── 11. Navigate to step 1 ── */
  goStep(1);

  /* ── 12. Initialize Results / Dashboard (visualization layer) ──
   *  Wire up the output file drop zone and prepare the dashboard.
   *  These are no-ops if the dashboard modules aren't loaded. */
  if (typeof initOutputDropzone === 'function') initOutputDropzone();
  if (typeof initLonLatViewer   === 'function') initLonLatViewer();
  if (typeof initTrajectoryViewer === 'function') initTrajectoryViewer();
  if (typeof initSpectrumViewer   === 'function') initSpectrumViewer();

  /* ── 13. Wire wizard file-upload handlers ──
   *  Each function is defined in its owning module and falls back
   *  gracefully if its DOM elements don't exist yet. */
  if (typeof initTrajDropzone     === 'function') initTrajDropzone();
  if (typeof initTsFileUpload     === 'function') initTsFileUpload();
  if (typeof initT96FileUpload    === 'function') initT96FileUpload();
  if (typeof initT01FileUpload    === 'function') initT01FileUpload();
  if (typeof initTA15FileUpload   === 'function') initTA15FileUpload();
  if (typeof initTA16RbfFileUpload === 'function') initTA16RbfFileUpload();
  if (typeof initWeimerFileUpload === 'function') initWeimerFileUpload();
  if (typeof initSpecTableUpload  === 'function') initSpecTableUpload();

  /* ── 14. Initialize E-field driver file-upload handlers ──
   *  Defined in js/06-temporal.js; wire the VS and Weimer dropzones. */
  if (typeof initVsFileUpload       === 'function') initVsFileUpload();
  if (typeof initWeimerTsFileUpload === 'function') initWeimerTsFileUpload();

  /* ── 15. Sync E-field driver tab to the current convection model ── */
  if (typeof updateEfieldDriverTab === 'function') updateEfieldDriverTab(S.eFieldConvModel || 'VOLLAND_STERN');

  /* ── 16. Adapt driver folds to the initial temporal mode ── */
  if (typeof _adaptDriversToMode === 'function') _adaptDriversToMode(S.tempMode || 'TIME_SERIES');
}

document.addEventListener('DOMContentLoaded', init);
