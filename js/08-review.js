/*
=====================================================================
FILE: js/08-review.js
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
   FILE:    js/08-review.js
   PROJECT: AMPS CCMC Submission Interface  v3
   PURPOSE: Step 11 — Review, AMPS_PARAM.in file builder, run manifest,
            client-side validation, job submission, and sidebar summary.

   AMPS_PARAM.in FILE BUILDER  (buildReview)
     Generates a complete, commented AMPS_PARAM.in file from the current
     state object S.  Output is rendered into the #review-param element as
     colour-coded HTML using .kw-strip span classes, and can be:
       · Copied to clipboard  (copyParam)
       · Downloaded as a .in text file  (downloadParam)

     The param-file structure mirrors the AMPS v2025 input specification:
       #RUN_ID, #CALCULATION_MODE, #CUTOFF_RIGIDITY (conditional),
       #PARTICLE, #FIELD_MODEL + model-specific block,
       #DOMAIN_BOUNDARY, #ELECTRIC_FIELD, #TEMPORAL, #SPECTRUM, #OUTPUT

     CALCULATION_MODE SECTION (added 2026-02-21):
       Emitted unconditionally.  Contains:
         CALC_TARGET        — from S.calcQuantity
         FIELD_EVAL_METHOD  — from S.fieldMethod
         GRID_NX/NY/NZ + extents — only when fieldMethod === 'GRID_3D'

     CUTOFF_RIGIDITY SECTION (added 2026-02-21):
       Emitted only when S.calcQuantity is CUTOFF_RIGIDITY.
       Contains:
         CUTOFF_EMIN, CUTOFF_EMAX, CUTOFF_MAX_PARTICLES, CUTOFF_NENERGY

     DENSITY_3D SECTION (added 2026-02-22):
       Emitted only when S.calcQuantity is DENSITY_3D.  Contains:
         DENS_EMIN, DENS_EMAX, DENS_NENERGY, DENS_ENERGY_SPACING

   RUN MANIFEST  (buildManifest)
     Lists all expected output files so users know what to retrieve after
     the run completes on the CCMC cluster.  Depends on output mode and
     energy bin count.

   VALIDATION  (buildValidation)
     Scans S for potentially dangerous or unusual configurations and
     returns an array of {level, text} warning objects:
       'ok'   — configuration looks standard
       'warn' — unusual but may be intentional (shown in amber)
       'error'— configuration will cause AMPS to fail (shown in red)

   SIDEBAR SUMMARY  (updateSidebar)
     Lightweight function called after every user interaction.
     Writes a one-line summary of each wizard step into the fixed
     right-hand sidebar for at-a-glance status.
     Also updates the progress bar fill (# done steps / 9).

   PUBLIC API
     buildReview()     — render full AMPS_PARAM.in preview into #review-param
     copyParam()       — copy plain-text param file to clipboard
     downloadParam()   — trigger browser download of amps_param.in
     buildManifest()   — return HTML string listing output files
     buildValidation() — return array of validation messages
     finalSubmit()     — submit the run to CCMC (triggers confirm dialog)
     updateSidebar()   — refresh the right-hand sidebar summary
     openHelpModal()   — show the help overlay

   DEPENDS ON: 01-state.js (S, $, set),
               03-bgfield.js (S.fieldModel),
               04-boundary.js (S.boundaryType, shueCalc),
               05-efield.js (S.eFieldCoro, S.eFieldConvModel)
=============================================================================*/

function buildReview(){
  const {r0,alpha}=getShue();
  const isM=S.shueMode==='manual';
  const f=(v,d)=>Number(v).toFixed(d);

  /* ── Pre-compute E-field time-series keyword fragments ───────────────
   *  These are assembled here (outside the main template literal) to
   *  avoid triple-nested template literals which break the JS parser.
   *  Each fragment is an empty string when the model is not active.    */
  const _vsKwFrag = (function() {
    if (S.eFieldConvModel !== 'VOLLAND_STERN' || S.tempMode === 'STEADY_STATE') return '';
    const src = S.vsEfieldSrc || 'omni';
    if (src === 'scalar') return '\nVS_INPUT_MODE          SCALAR  ! single Kp from Step 5';
    const hasFile = typeof _vsDataset !== 'undefined' && _vsDataset.length > 0;
    if (src === 'file' && hasFile) return '\nVS_INPUT_MODE          FILE\nVS_INPUT_FILE          vs_driving.txt  ! Kp time-series for Volland-Stern';
    return '\nVS_INPUT_MODE          OMNIWEB  ! Kp fetched from NOAA GFZ on submission';
  })();

  const _weimerTsKwFrag = (function() {
    if (S.eFieldConvModel !== 'WEIMER' || S.tempMode === 'STEADY_STATE') return '';
    const src = S.weimerEfieldSrc || 'omni';
    if (src === 'scalar') return '\nWEIMER_TS_MODE         AUTO  ! read Bz,By,Vx,Pdyn from TS05 driver stream';
    const hasFile = typeof _weimerTsDataset !== 'undefined' && _weimerTsDataset.length > 0;
    if (src === 'file' && hasFile) return '\nWEIMER_TS_MODE         FILE\nWEIMER_TS_FILE         weimer_driving.txt  ! Weimer IMF+SW time-series';
    return '\nWEIMER_TS_MODE         OMNIWEB  ! IMF+SW fetched from OMNIWeb on submission';
  })();

  const _weimerSsFrag = (S.eFieldConvModel === 'WEIMER' && S.weimerMode === 'file' && S.weimerFile)
    ? '\nWEIMER_FILE            ' + S.weimerFile.name + '  ! steady-state Weimer driving file'
    : '';


  /* ── Output-domain block assembly (Step 9) ───────────────────────────
   *  The UI supports three output domains:
   *    - POINTS: a free-form list of points entered in the UI
   *    - TRAJECTORY: an uploaded/selected spacecraft trajectory file
   *    - SHELLS: one or more spherical shells for global maps
   *
   *  We assemble the domain-specific lines here to keep the template below
   *  readable and to avoid deeply nested template literals.
   */
  const fluxLine = `FLUX_DT                ${f(S.fluxDt,1)}           ! min (trajectory cadence; ignored for POINTS/SHELLS)`;

    /*
    OUTPUT DOMAIN EMISSION
    ----------------------
    The Output Domain step defines WHERE the model is evaluated and what the output
    cadence/representation should be. This affects the generated AMPS_PARAM.in.

    Modes implemented here:
      - POINTS: user-provided list of locations (one point per line).
      - TRAJECTORY: uploaded trajectory file with time-tagged samples.
      - SHELLS: one or more spherical shells defined by altitude(s) and angular resolution.

    Strategy:
      - Keep the UI layer simple: store raw text for POINTS and numeric arrays for SHELLS.
      - Perform light sanitization (trim empty lines / ignore comment lines starting with '#').
      - Emit explicit BEGIN/END blocks so the backend parser can read variable-length lists.
  */
let outDomainExtra = '';
  if (S.outputMode === 'POINTS') {
        // Parse the multiline textbox. We treat each non-empty, non-comment line as a point record.
    // The backend decides how to interpret the columns (e.g., lat lon alt_km).
    const raw = (S.pointsText || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    const n = raw.length;
    // Column labels that correspond to the selected frame
    const colLabels = {
      GEO: 'Lat[deg]  Lon[deg]  Alt[km]',
      GSM: 'X[RE]  Y[RE]  Z[RE]',
      SM:  'X[RE]  Y[RE]  Z[RE]'
    };
    const colComment = colLabels[S.pointsFrame] || colLabels.GEO;
        // Emit each point as a single line starting with the POINT keyword.
    const body = raw.map(l => `POINT                 ${l}`).join('\n');
    outDomainExtra =
      `POINTS_FRAME           ${S.pointsFrame||'GEO'}              ! coordinate frame: GEO (lat/lon/alt) | GSM (X,Y,Z RE) | SM (X,Y,Z RE)\n` +
      `N_POINTS               ${n}                 ! number of points provided below\n` +
      `! columns: ${colComment}\n` +
      `POINTS_BEGIN\n` +
      `${body || '! (no points specified)'}\n` +
      `POINTS_END`;
  } else if (S.outputMode === 'SHELLS') {
    const n = Math.max(1, Math.min(5, parseInt(S.shellCount || 1, 10)));
    const res = parseInt(S.shellResDeg || 1, 10);
    const alts = (Array.isArray(S.shellAltsKm) ? S.shellAltsKm : [])
      .slice(0, n)
      .map(v => f(parseFloat(v) || 0, 1));
    outDomainExtra =
      `SHELL_COUNT            ${n}                 ! number of shells\n` +
      `SHELL_ALTS_KM          ${alts.join(' ')}          ! km; one altitude per shell\n` +
      `SHELL_RES_DEG          ${res}                 ! deg; angular resolution (lat/lon)`;
  }

  /* ── Assemble the AMPS_PARAM.in text ─────────────────────────────────
   *  The array elements are joined with '\n'.  Conditional blocks use
   *  ternary expressions to emit model-specific sub-sections or empty
   *  strings based on the current state. */
  const txt=[
`! ═══════════════════════════════════════════════════════════════
! AMPS_PARAM.in — generated by CCMC Runs-on-Request interface
! ═══════════════════════════════════════════════════════════════

! ── Calculation mode (Step 2) ──────────────────────────────────
! CALC_TARGET: what the run computes (cutoff rigidity or flux).
! FIELD_EVAL_METHOD: how B/E are evaluated (analytic vs grid interpolation).
! GRID_* keywords are only emitted when FIELD_EVAL_METHOD = GRID_3D.
#CALCULATION_MODE
CALC_TARGET            ${S.calcQuantity}
FIELD_EVAL_METHOD      ${S.fieldMethod}`,

/* ── Conditional: 3-D grid dimensions and spatial extent ──
 *  Only emitted when FIELD_EVAL_METHOD = GRID_3D.
 *  The grid is a regular Cartesian mesh in GSM coordinates. */
S.fieldMethod==='GRID_3D'?`GRID_NX                ${S.gridNx}
GRID_NY                ${S.gridNy}
GRID_NZ                ${S.gridNz}
GRID_XMIN              ${f(S.gridXmin,1)}         ! RE GSM
GRID_XMAX              ${f(S.gridXmax,1)}
GRID_YMIN              ${f(S.gridYmin,1)}
GRID_YMAX              ${f(S.gridYmax,1)}
GRID_ZMIN              ${f(S.gridZmin,1)}
GRID_ZMAX              ${f(S.gridZmax,1)}`:'',

/* ── Conditional: cutoff rigidity parameters ──
 *  Emitted when CALC_TARGET is CUTOFF_RIGIDITY.
 *  Omitted for DENSITY_SPECTRUM and DENSITY_3D (no cutoff computation). */
(S.calcQuantity==='CUTOFF_RIGIDITY')?`
! ── Cutoff rigidity scan (Step 2, Section C) ───────────────────
! Energy range and particle budget for backward-tracing cutoff search.
#CUTOFF_RIGIDITY
CUTOFF_EMIN            ${f(S.cutoffEmin,1)}          ! MeV/n
CUTOFF_EMAX            ${f(S.cutoffEmax,1)}       ! MeV/n
CUTOFF_MAX_PARTICLES   ${S.cutoffMaxParticles}              ! per injection point
CUTOFF_NENERGY         ${S.cutoffNenergy}               ! log-spaced energy bins
CUTOFF_MAX_TRAJ_TIME   ${S.cutoffMaxTrajTime}               ! sec — max trajectory integration time
CUTOFF_SAMPLING        ${S.cutoffSampling}           ! VERTICAL or ISOTROPIC`
+ (S.directionalMap && (S.outputMode==='POINTS'||S.outputMode==='TRAJECTORY') ? `
DIRECTIONAL_MAP        T                 ! compute directional Rc sky-map
DIRMAP_LON_RES         ${f(S.dirMapLonRes,0)}                ! deg — longitude resolution
DIRMAP_LAT_RES         ${f(S.dirMapLatRes,0)}                ! deg — latitude resolution` : '')
:'',

/* ── Conditional: density-spectrum sampling parameters ──
 *  Emitted only when CALC_TARGET is DENSITY_SPECTRUM.
 *  Backward-traces across energy grid, folds with boundary spectrum. */
S.calcQuantity==='DENSITY_SPECTRUM'?`
! ── Density & spectrum sampling (Step 2, Section D) ───────────────
! Backward-trace energy grid + boundary spectrum folding.
#DENSITY_SPECTRUM
DS_EMIN                ${f(S.dsEmin,1)}          ! MeV/n
DS_EMAX                ${f(S.dsEmax,1)}       ! MeV/n
DS_NINTERVALS          ${S.dsNintervals}               ! energy intervals
DS_MAX_PARTICLES       ${S.dsMaxParticles}              ! per observation point
DS_MAX_TRAJ_TIME       ${S.dsMaxTrajTime}               ! sec — max trajectory integration time
DS_ENERGY_SPACING      ${S.dsEnergySpacing}           ! LOG or LINEAR`:'',

/* ── Conditional: 3-D ion density sampling parameters ──
 *  Emitted only when CALC_TARGET is DENSITY_3D.
 *  Defines the energy binning for energy-resolved density output. */
S.calcQuantity==='DENSITY_3D'?`
! ── 3-D ion density sampling (Step 2, Section E) ──────────────
! Energy-resolved density bins for forward-modeled particle transport.
#DENSITY_3D
DENS_EMIN              ${f(S.densEmin,1)}          ! MeV/n
DENS_EMAX              ${f(S.densEmax,1)}       ! MeV/n
DENS_NENERGY           ${S.densNenergy}               ! energy bins
DENS_ENERGY_SPACING    ${S.densEnergySpacing}           ! LOG or LINEAR`:'',
	/* NOTE ON NAMING CONSISTENCY -------------------------------------------------
	 * The website supports multiple background magnetic-field models (T96, T15, TS05,
	 * etc.). However, the *driving inputs* are shared physical quantities (Dst, Pdyn,
	 * IMF components, solar-wind Vx, solar-wind density). Older versions incorrectly
	 * prefixed these keys with a particular model ID (e.g., TS05_DST) even when
	 * FIELD_MODEL was not TS05, leading to confusing output like:
	 *   FIELD_MODEL T96 + TS05_* parameters
	 *
	 * To keep the generated AMPS input file stable and model-agnostic, we emit
	 * *generic* parameter names in the generated AMPS_PARAM.in. The backend/solver can
	 * interpret (or ignore) these fields depending on FIELD_MODEL.
	 *
	 * IMPORTANT: This note is a *code comment only*. It must NOT be emitted into the
	 * generated input file.
	 * -------------------------------------------------------------------------- */
	`
#PARTICLE_SPECIES
SPECIES                ${S.species.toUpperCase()}
CHARGE                 ${S.charge}               ! elementary charge
MASS_AMU               ${S.mass}           ! atomic mass units

#BACKGROUND_FIELD
FIELD_MODEL            ${S.fieldModel}
${(()=>{
  const m = S.fieldModel;
  const lines = [];
  /* ── TS05 ─────────────────────────────────────────────────────── */
  if (m === 'TS05') {
    lines.push(
      `DST                    ${f(S.dst,1)}         ! nT ring current index (Dst)`,
      `PDYN                   ${f(S.pdyn,2)}          ! nPa solar-wind dynamic pressure`,
      `IMF_BZ                 ${f(S.bz,2)}         ! nT IMF Bz (GSM)`,
      `SW_VX                  ${f(S.vx,1)}       ! km/s solar-wind Vx`,
      `SW_N                   ${f(S.nsw,2)}         ! cm-3 solar-wind proton density`,
      `IMF_BY                 ${f(S.by,2)}          ! nT IMF By`,
      `IMF_BX                 ${f(S.bx,2)}          ! nT IMF Bx`,
      `EPOCH                  ${S.epoch}  ! UTC snapshot`,
      `! TS05 advanced inputs (optional; for reproducibility / TS05 W-variable runs)`,
      `! TS05_TILT_RAD          ${Number(S.ts05TiltRad||0).toFixed(4)}`,
      `! TS05_IMFFLAG           ${S.ts05ImfFlag==null?'':S.ts05ImfFlag}`,
      `! TS05_ISWFLAG           ${S.ts05SwFlag==null?'':S.ts05SwFlag}`,
      `! TS05_W1                ${S.ts05W1==null?'':Number(S.ts05W1).toFixed(2)}`,
      `! TS05_W2                ${S.ts05W2==null?'':Number(S.ts05W2).toFixed(2)}`,
      `! TS05_W3                ${S.ts05W3==null?'':Number(S.ts05W3).toFixed(2)}`,
      `! TS05_W4                ${S.ts05W4==null?'':Number(S.ts05W4).toFixed(2)}`,
      `! TS05_W5                ${S.ts05W5==null?'':Number(S.ts05W5).toFixed(2)}`,
      `! TS05_W6                ${S.ts05W6==null?'':Number(S.ts05W6).toFixed(2)}`
    );
  }
  /* ── T96 ─────────────────────────────────────────────────────── */
  if (m === 'T96') {
    lines.push(
      `DST                    ${f(S.t96Dst,1)}         ! nT`,
      `PDYN                   ${f(S.t96Pdyn,2)}          ! nPa`,
      `IMF_BZ                 ${f(S.t96Bz,2)}         ! nT GSM`,
      `IMF_BY                 ${f(S.t96By,2)}          ! nT`,
      `TILT                   ${Number(S.t96Tilt||0).toFixed(1)}          ! deg dipole tilt`,
      `EPOCH                  ${S.t96Epoch||S.epoch}  ! UTC snapshot`
    );
  }
  /* ── T01 ─────────────────────────────────────────────────────── */
  if (m === 'T01') {
    lines.push(
      `DST                    ${f(S.t01Dst,1)}         ! nT`,
      `PDYN                   ${f(S.t01Pdyn,2)}          ! nPa`,
      `IMF_BZ                 ${f(S.t01Bz,2)}         ! nT GSM`,
      `IMF_BY                 ${f(S.t01By,2)}          ! nT`,
      `TILT                   ${Number(S.t01Tilt||0).toFixed(1)}          ! deg dipole tilt`,
      `G1                     ${Number(S.t01G1||0).toFixed(1)}          ! IMF-history index`,
      `G2                     ${Number(S.t01G2||0).toFixed(1)}          ! SW/IMF coupling index`,
      `EPOCH                  ${S.t01Epoch||S.epoch}  ! UTC snapshot`
    );
  }
  /* ── TA15 ────────────────────────────────────────────────────── */
  if (m === 'TA15') {
    lines.push(
      `IMF_BX                 ${Number(S.ta15Bx||0).toFixed(2)}      ! nT (GSW; 30-min trail)`,
      `IMF_BY                 ${Number(S.ta15By||0).toFixed(2)}      ! nT (GSW; 30-min trail)`,
      `IMF_BZ                 ${Number(S.ta15Bz||0).toFixed(2)}      ! nT (GSW; 30-min trail)`,
      `SW_VX                  ${Number(S.ta15Vx||0).toFixed(1)}   ! km/s (GSE)`,
      `SW_VY                  ${Number(S.ta15Vy||0).toFixed(1)}      ! km/s (GSE)`,
      `SW_VZ                  ${Number(S.ta15Vz||0).toFixed(1)}      ! km/s (GSE)`,
      `SW_NP                  ${Number(S.ta15Np||0).toFixed(2)}     ! cm^-3 proton density`,
      `SW_T                   ${Math.round(Number(S.ta15Temp||0))}  ! K proton temperature`,
      `SYMH                   ${Number(S.ta15SymH||0).toFixed(1)}   ! nT`,
      `IMF_FLAG               ${S.ta15ImfFlag==null?'':S.ta15ImfFlag}      ! 1 measured | 2 interpolated`,
      `SW_FLAG                ${S.ta15SwFlag==null?'':S.ta15SwFlag}       ! 1 measured | 2 interpolated`,
      `TILT                   ${Number(S.ta15TiltRad||0).toFixed(4)} ! rad (GSW)`,
      `PDYN                   ${Number(S.ta15Pdyn||0).toFixed(2)}     ! nPa`,
      `N_INDEX                ${Number(S.ta15Nidx||0).toFixed(4)}    ! 30-min trailing avg`,
      `B_INDEX                ${Number(S.ta15Bidx||0).toFixed(4)}    ! 30-min trailing avg`,
      `EPOCH                  ${S.ta15Epoch||S.epoch} ! UTC snapshot`
    );
  }
  /* ── TA16RBF ─────────────────────────────────────────────────── */
  if (m === 'TA16RBF') {
    lines.push(
      `IMF_BX                 ${Number(S.ta16Bx||0).toFixed(2)}      ! nT (GSW; 30-min trail)`,
      `IMF_BY                 ${Number(S.ta16By||0).toFixed(2)}      ! nT (GSW; 30-min trail)`,
      `IMF_BZ                 ${Number(S.ta16Bz||0).toFixed(2)}      ! nT (GSW; 30-min trail)`,
      `SW_VX                  ${Number(S.ta16Vx||0).toFixed(1)}   ! km/s (GSE)`,
      `SW_VY                  ${Number(S.ta16Vy||0).toFixed(1)}      ! km/s (GSE)`,
      `SW_VZ                  ${Number(S.ta16Vz||0).toFixed(1)}      ! km/s (GSE)`,
      `SW_NP                  ${Number(S.ta16Np||0).toFixed(2)}     ! cm^-3 proton density`,
      `SW_T                   ${Math.round(Number(S.ta16Temp||0))}  ! K proton temperature`,
      `SYMH                   ${Number(S.ta16SymH||0).toFixed(1)}   ! nT`,
      `IMF_FLAG               ${S.ta16ImfFlag==null?'':S.ta16ImfFlag}      ! 1 measured | 2 interpolated`,
      `SW_FLAG                ${S.ta16SwFlag==null?'':S.ta16SwFlag}       ! 1 measured | 2 interpolated`,
      `TILT                   ${Number(S.ta16TiltRad||0).toFixed(4)} ! rad (GSW)`,
      `PDYN                   ${Number(S.ta16Pdyn||0).toFixed(2)}     ! nPa`,
      `N_INDEX                ${Number(S.ta16Nidx||0).toFixed(4)}    ! 30-min trailing avg`,
      `B_INDEX                ${Number(S.ta16Bidx||0).toFixed(4)}    ! 30-min trailing avg`,
      `SYMHc                  ${Number(S.ta16SymHc||0).toFixed(1)}   ! centered 30-min sliding avg`,
      `EPOCH                  ${S.ta16Epoch||S.epoch} ! UTC snapshot`
    );
  }
  /* ── BATSRUS / GAMERA ────────────────────────────────────────── */
  if (m === 'BATSRUS' || m === 'GAMERA') {
    lines.push(
      `MHD_INTERP             ${S.mhdInterp||'LINEAR'}   ! LINEAR | CUBIC`
    );
  }
  /* ── DIPOLE ──────────────────────────────────────────────────── */
  if (m === 'DIPOLE') {
    lines.push(
      `DIPOLE_MOMENT          ${Number(S.dipoleMoment||1).toFixed(2)}         ! multiples of M_E`,
      `DIPOLE_TILT            ${Number(S.dipoleTilt||0).toFixed(1)}          ! deg from GSM Z-axis`
    );
  }
  return lines.join('\n');
})()}

#DOMAIN_BOUNDARY
BOUNDARY_TYPE          ${S.boundaryType}${S.boundaryType==='SHUE'?'  ! Shue et al. 1998 magnetopause':'  ! rectangular box in GSM'}`,
S.boundaryType==='BOX'?`DOMAIN_X_MAX           ${f(S.boxXmax,1)}         ! RE dayside
DOMAIN_X_MIN           ${f(S.boxXmin,1)}        ! RE nightside
DOMAIN_Y_MAX           ${f(S.boxYmax,1)}         ! RE dusk
DOMAIN_Y_MIN           ${f(S.boxYmin,1)}        ! RE dawn
DOMAIN_Z_MAX           ${f(S.boxZmax,1)}         ! RE north
DOMAIN_Z_MIN           ${f(S.boxZmin,1)}        ! RE south
R_INNER                ${f(S.boxRinner,1)}           ! RE inner loss sphere`:
`SHUE_R0                ${isM?f(r0,2):'AUTO'}            ! RE; AUTO = from TS05 Bz,Pdyn
SHUE_ALPHA             ${isM?f(alpha,3):'AUTO'}         ! flaring; AUTO = from TS05
DOMAIN_X_TAIL          ${f(S.xtail,1)}        ! RE nightside cap
R_INNER                ${f(S.shueRinner,1)}           ! RE inner loss sphere`,
`
#ELECTRIC_FIELD
COROTATION_E           ${S.fieldMethod==='GRIDLESS'?'NO':(S.eFieldCoro?'YES':'NO')}      ! corotation = −(ω×r)×B`,
S.fieldMethod!=='GRIDLESS'?`CONV_E_MODEL           ${S.eFieldConvModel}`:
`CONV_E_MODEL           NONE  ! gridless mode — no convection E`,
S.fieldMethod!=='GRIDLESS'&&S.eFieldConvModel==='VOLLAND_STERN'?`VS_KP                  ${S.vsKpMode==='auto'?'AUTO':f(S.vsKp,1)}         ! ${S.vsKpMode==='auto'?'AUTO = derived from Dst via Burton 1975':'manual entry'}
VS_GAMMA               ${f(S.vsGamma,1)}             ! shielding exponent (Stern 1975)
VS_A                   ${f(S.vsA||0,5)}       ! kV/RE^γ (Maynard & Chen 1975; auto-computed)${_vsKwFrag}`:'',
S.fieldMethod!=='GRIDLESS'&&S.eFieldConvModel==='WEIMER'?`WEIMER_DRIVE           ${S.weimerMode==='auto'?'AUTO':'FILE'}        ! AUTO = from TS05 drivers${_weimerTsKwFrag}${_weimerSsFrag}`:'',
`
#TEMPORAL
TEMPORAL_MODE          ${S.tempMode}`,
S.tempMode!=='STEADY_STATE'?`EVENT_START            ${S.eventStart}   ! UTC
EVENT_END              ${S.eventEnd}   ! UTC
FIELD_UPDATE_DT        ${S.fieldDt}                ! min
INJECT_DT              ${S.injectDt}               ! min
TS_INPUT_MODE          ${S.tsSource==='omni'?'OMNIWEB':S.tsSource==='file'?'FILE':'SCALAR'}${S.tsSource==='file'&&S.tsFile?`
TS_INPUT_FILE          ${S.tsFile.name}  ! uploaded driving-parameters file`:''}`:  
`EPOCH                  ${S.epoch}`,
`
#SPECTRUM
SPECTRUM_TYPE          ${S.specType}`,
/* S3358 fix: replaced 5-way nested ternary with function call */
(function() {
  switch (S.specType) {
    case 'POWER_LAW':       return `SPEC_J0                ${S.specJ0.toExponential(2)}   ! p/cm2/s/sr/(MeV/n)\nSPEC_GAMMA             ${f(S.specGamma,2)}         ! spectral index\nSPEC_E0                ${f(S.specE0,1)}          ! MeV/n pivot`;
    case 'POWER_LAW_CUTOFF': return `SPEC_J0                ${S.specJ0.toExponential(2)}   ! p/cm2/s/sr/(MeV/n)\nSPEC_GAMMA             ${f(S.specGamma,2)}         ! spectral index\nSPEC_E0                ${f(S.specE0,1)}          ! MeV/n pivot\nSPEC_EC                ${f(S.specEc,1)}        ! MeV/n exponential cutoff`;
    case 'LIS_FORCE_FIELD': return `SPEC_LIS_J0            ${S.specLisJ0.toExponential(2)}   ! p/cm2/s/sr/(MeV/n) LIS normalization\nSPEC_LIS_GAMMA         ${f(S.specLisGamma,2)}         ! LIS spectral index\nSPEC_E0                ${f($('lis-e0')?.value||S.specE0,1)}          ! MeV/n pivot\nSPEC_PHI               ${f(S.specPhi,0)}          ! MV solar modulation potential`;
    case 'BAND':            return `SPEC_J0                ${S.specJ0.toExponential(2)}   ! p/cm2/s/sr/(MeV/n)\nSPEC_GAMMA1            ${f(parseFloat($('band-gamma1')?.value)||3.5,2)}         ! low-energy index\nSPEC_GAMMA2            ${f(parseFloat($('band-gamma2')?.value)||1.5,2)}         ! high-energy index\nSPEC_E0                ${f(parseFloat($('band-e0')?.value)||10,1)}          ! MeV/n break energy`;
    case 'TABLE':           return `SPEC_TABLE_FILE        ${S.specTableFile ? S.specTableFile.name : 'sep_spectrum_H+.txt'}  ! user-provided E vs J table`;
    default:                return '';
  }
})(),
`SPEC_EMIN              ${f(S.specEmin,1)}          ! MeV/n
SPEC_EMAX              ${f(S.specEmax,1)}       ! MeV/n

#OUTPUT_DOMAIN
OUTPUT_MODE            ${S.outputMode}
${S.outputMode==='TRAJECTORY'?'TRAJ_FRAME             '+(S.trajFrame||'GEO')+'              ! coordinate frame: GEO (lat/lon/alt) | GSM (X,Y,Z RE) | SM (X,Y,Z RE)':''}
${S.outputMode==='TRAJECTORY'&&S.trajFile?`TRAJ_FILE              ${S.trajFile.name}  ! uploaded trajectory file`:''}
${fluxLine}
${outDomainExtra}

#OUTPUT_OPTIONS
FLUX_TYPE              ${S.fluxType}
OUTPUT_CUTOFF          ${$('output-cutoff')?.checked?'T':'F'}                    ! cutoff rigidity maps
OUTPUT_PITCH           ${$('output-pitch')?.checked?'T':'F'}                    ! pitch angle distributions
OUTPUT_FORMAT          ${$('output-format')?.value||S.outputFormat}
OUTPUT_COORDS          ${$('output-coords')?.value||S.outputCoords}
ENERGY_BINS            ${S.energyBins.join(' ')}   ! MeV/n

#NUMERICAL
N_PARTICLES            10000              ! test particles per injection
MAX_BOUNCE             500                ! max mirror reflections
DT_TRACE               1.0               ! s integration step
PITCH_ISOTROPIC        T                 ! isotropic injection

#END`
].join('\n');

  const el=$('review-param'); if(!el) return;
  el.innerHTML=txt
    .replace(/^(#\w+)/gm,'<span class="r-section">$1</span>')
    /* ReDoS fix (SonarQube S5852): replaced .+ with [^\r\n]+ to explicitly
     * exclude newline characters from the match. With the /m (multiline) flag,
     * .+ can span across line boundaries in some JS engines during backtracking,
     * allowing a pathological input to cause super-linear runtime. Bounding the
     * match to a single line eliminates that backtracking surface. */
    .replace(/^(! [^\r\n]+)/gm,'<span class="r-comment">$1</span>')
    .replace(/(AUTO)/g,'<span class="r-auto">AUTO</span>');

  buildManifest(); buildValidation();
  return txt;
}


/**
 * Return the plain-text AMPS_PARAM content produced by buildReview().
 *
 * buildReview() already returns the raw text that is written into the review
 * panel.  Historically, this code attempted to strip HTML tags with a regex
 * before copying/downloading/bundling the text.  That regex was unnecessary
 * here because buildReview() does not return HTML markup, and static-analysis
 * tools correctly flag generic tag-stripping regexes as potentially vulnerable
 * to catastrophic backtracking on adversarial inputs.
 *
 * To keep this path robust even if buildReview() is changed in the future, we
 * normalize through a detached DOM node instead of regex-based tag stripping.
 * For plain text input this is a no-op; for accidental HTML input it safely
 * extracts the rendered text content without regex backtracking risk.
 *
 * @returns {string}
 */
function _getReviewPlainText() {
  const txt = buildReview() || '';
  if (!txt || txt.indexOf('<') === -1) return txt;

  const div = document.createElement('div');
  div.innerHTML = txt;
  return div.textContent || '';
}

function copyParam(){ navigator.clipboard.writeText(_getReviewPlainText()).then(()=>{ const b=$('copy-param'); if(b){b.textContent='✓ Copied';setTimeout(()=>{b.textContent='📋 Copy';},2000);} }); }
function downloadParam(){
  const txt = _getReviewPlainText();
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));
  a.download='AMPS_PARAM.in'; a.click();
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUNDLE DOWNLOAD
   ═══════════════════════════════════════════════════════════════════════════
   downloadBundle() creates a .tar.gz in the browser containing:
     • AMPS_PARAM.in          — generated param file (always included)
     • trajectory file        — if S.trajFile is set
     • TS05 driving file      — if S.tsFile is set
     • VS driving file        — if vs_driving.txt dataset loaded
     • Weimer-TS driving file — if weimer_driving.txt dataset loaded
     • Weimer driving file    — if S.weimerFile is set (steady-state)
     • spectrum table file    — if S.specTableFile is set

   Implementation uses only browser-native APIs — no external library:
     • Hand-rolled ustar tar builder (_buildTar)
     • CompressionStream('gzip') for in-browser gzip (Chrome 80+,
       Firefox 113+, Safari 16.4+)

   Button state: shows ⏳ Bundling… while reading/compressing, restores
   on completion or error.
*/

/**
 * Read a File object as a Uint8Array asynchronously.
 *
 * @param {File} file
 * @returns {Promise<Uint8Array>}
 */
function _readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error('Failed to read ' + file.name));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Build a ustar-format tar archive from a map of filename → Uint8Array.
 *
 * Each file gets a 512-byte POSIX ustar header followed by the file data
 * padded to the nearest 512-byte boundary.  The archive ends with two
 * 512-byte zero blocks per the tar spec.
 *
 * @param {Object.<string, Uint8Array>} entries  filename → bytes
 * @returns {Uint8Array}  raw tar data (uncompressed)
 */
function _buildTar(entries) {
  /* ── helpers ── */
  const enc  = new TextEncoder();

  /* Write a null-terminated, NUL-padded ASCII string into buf at offset */
  function writeStr(buf, off, str, len) {
    const b = enc.encode(str.slice(0, len - 1));
    buf.set(b, off);
  }

  /* Write an octal number string (padded with leading zeros, space + NUL) */
  function writeOct(buf, off, val, len) {
    const s = val.toString(8).padStart(len - 2, '0') + ' ';
    buf.set(enc.encode(s), off);
  }

  /* Compute unsigned byte checksum of a 512-byte header block */
  function checksum(hdr) {
    /* Per ustar spec: treat checksum field (bytes 148–155) as spaces */
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += (i >= 148 && i < 156) ? 32 : hdr[i];
    }
    return sum;
  }

  /* Round n up to the nearest multiple of 512 */
  const pad512 = n => Math.ceil(n / 512) * 512;

  /* ── calculate total size and allocate ── */
  let totalBytes = 0;
  for (const bytes of Object.values(entries)) {
    totalBytes += 512 + pad512(bytes.length); // header + padded data
  }
  totalBytes += 1024; // two end-of-archive zero blocks

  const tar = new Uint8Array(totalBytes);
  let pos = 0;

  for (const [name, bytes] of Object.entries(entries)) {
    /* ── build 512-byte ustar header ── */
    const hdr = new Uint8Array(512);
    writeStr(hdr,   0, name,        100); // filename
    writeOct(hdr, 100, 0o644,         8); // file mode (rw-r--r--)
    writeOct(hdr, 108, 0,             8); // uid
    writeOct(hdr, 116, 0,             8); // gid
    writeOct(hdr, 124, bytes.length,  12); // file size
    writeOct(hdr, 136, Math.floor(Date.now() / 1000), 12); // mtime
    hdr[156] = 48; // '0' = regular file type flag
    writeStr(hdr, 265, 'amps',        32); // uname
    writeStr(hdr, 297, 'amps',        32); // gname
    /* magic + version */
    hdr.set(enc.encode('ustar'), 257);
    hdr.set(enc.encode('00'),    263);
    /* checksum */
    writeOct(hdr, 148, checksum(hdr), 8);

    tar.set(hdr, pos);
    pos += 512;

    tar.set(bytes, pos);
    pos += pad512(bytes.length);
  }
  /* two zero blocks at end — already zero-filled by Uint8Array constructor */

  return tar;
}

/**
 * Gzip a Uint8Array using the browser-native CompressionStream API.
 *
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function _gzip(data) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'CompressionStream is not supported in this browser. ' +
      'Please use Chrome 80+, Firefox 113+, or Safari 16.4+.'
    );
  }
  const cs     = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  /* Concatenate all chunks into a single Uint8Array */
  const total  = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

/**
 * Build and trigger a browser download of a .tar.gz submission bundle.
 *
 * Collects AMPS_PARAM.in plus all uploaded File objects from S, builds
 * a ustar tar archive, gzips it with CompressionStream, and triggers a
 * browser download of <run_id>_bundle.tar.gz.
 */
async function downloadBundle() {
  const btn       = $('download-bundle-btn');
  const origLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '&#9203; Bundling&hellip;'; }

  try {
    /* ── 1. Collect entries ── */
    const paramTxt = _getReviewPlainText();
    const entries  = { 'AMPS_PARAM.in': new TextEncoder().encode(paramTxt) };

    for (const file of [S.trajFile, S.tsFile, S.weimerFile, S.specTableFile].filter(Boolean)) {
      entries[file.name] = await _readFileBytes(file);
    }

    /* ── In-memory E-field driver datasets ── */
    if (typeof _vsConvertedLines !== 'undefined' && _vsConvertedLines && _vsConvertedLines.length > 2) {
      entries['vs_driving.txt'] = new TextEncoder().encode(_vsConvertedLines.join('\n'));
    }
    if (typeof _weimerTsConvertedLines !== 'undefined' && _weimerTsConvertedLines && _weimerTsConvertedLines.length > 2) {
      entries['weimer_driving.txt'] = new TextEncoder().encode(_weimerTsConvertedLines.join('\n'));
    }

    /* ── 2. Build tar then gzip ── */
    const tarBytes = _buildTar(entries);
    const tgzBytes = await _gzip(tarBytes);

    /* ── 3. Trigger download ── */
    const runId = 'amps_run';
    const a     = document.createElement('a');
    a.href      = URL.createObjectURL(new Blob([tgzBytes], { type: 'application/gzip' }));
    a.download  = `${runId}_bundle.tar.gz`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);

  } catch (err) {
    console.error('downloadBundle:', err);
    alert('Bundle download failed:\n' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
  }
}

function buildManifest(){
  const tb=$('manifest-tbody'); if(!tb) return;
  const files=[
    {name:'AMPS_PARAM.in',      role:'Main configuration',            req:true, auto:true,  ok:true},
    {name:'AMPS_MANIFEST.json', role:'Run metadata (auto-generated)', req:true, auto:true,  ok:true},
    {name:S.trajFile?S.trajFile.name:'trajectory.txt',
                                role:'Spacecraft trajectory (Mode B)',req:S.outputMode==='TRAJECTORY', auto:false, ok:!!(S.trajFile||S.trajLoaded)},
    {name:'points.txt',         role:'Point list (Mode A)',           req:S.outputMode==='POINTS', auto:false, ok:!!(S.pointsText&&S.pointsText.trim())},
    {name:S.tsFile?S.tsFile.name:'ts05_driving.txt',
                                role:'TS05 time-series drivers',      req:S.tempMode==='TIME_SERIES'&&S.tsSource==='file', auto:S.tsSource==='omni', ok:!!(S.tsSource!=='file'||S.tsFile)},
    {name:'vs_driving.txt',     role:'Volland–Stern Kp time-series',  req:S.tempMode==='TIME_SERIES'&&S.eFieldConvModel==='VOLLAND_STERN'&&(S.vsEfieldSrc||'omni')==='file', auto:(S.vsEfieldSrc||'omni')==='omni'||S.vsEfieldSrc==='scalar', ok:!((S.vsEfieldSrc==='file')&&(typeof _vsDataset==='undefined'||_vsDataset.length===0))},
    {name:'weimer_driving.txt', role:'Weimer 2005 time-series drivers', req:S.tempMode==='TIME_SERIES'&&S.eFieldConvModel==='WEIMER'&&(S.weimerEfieldSrc||'omni')==='file', auto:(S.weimerEfieldSrc||'omni')!=='file', ok:!((S.weimerEfieldSrc==='file')&&(typeof _weimerTsDataset==='undefined'||_weimerTsDataset.length===0))},
    {name:S.weimerFile?S.weimerFile.name:'weimer_input.txt',
                                role:'Weimer steady-state input (Step 5)', req:S.eFieldConvModel==='WEIMER'&&S.weimerMode==='file'&&S.tempMode==='STEADY_STATE', auto:S.weimerMode==='auto', ok:!!(S.weimerMode!=='file'||S.weimerFile)},
    {name:S.specTableFile?S.specTableFile.name:'sep_spectrum_H+.txt',
                                role:'Spectrum table (TABLE mode)',   req:S.specType==='TABLE', auto:false, ok:!!(S.specType!=='TABLE'||S.specTableFile)},
  ];
  tb.innerHTML=files.filter(f=>f.req||f.auto).map(f=>`
    <tr>
      <td style="font-family:var(--font-mono);color:var(--text)">${f.name}</td>
      <td style="color:var(--text-dim)">${f.role}</td>
      <td style="color:${f.req?'var(--text)':'var(--text-muted)'}">${f.req?'Required':'Optional'}</td>
      <td style="color:${f.auto?'var(--green)':'var(--text-dim)'}">${f.auto?'Auto-generated':'User upload'}</td>
      <td class="${f.ok?'vt-pass':'vt-fail'}">${f.ok?'✓ READY':'✗ MISSING'}</td>
    </tr>`).join('');
}

function buildValidation(){
  const {r0}=getShue();

  /* ── Validation checks ─────────────────────────────────────────────
   *  Each check is an object {l: label, ok: boolean, warn?: boolean}.
   *    ok=true  → PASS (green)
   *    ok=false, warn=false → FAIL / fatal (red) — blocks submission
   *    ok=false, warn=true  → WARNING (amber)    — allows submission
   *
   *  New checks added for Step 2 (Calculation Mode):
   *    - Calc target must be a recognized keyword.
   *    - Field method must be a recognized keyword.
   *    - Cutoff Emin must be strictly less than Emax (skipped if FLUX).
   *    - Cutoff max particles must be at least 50 (skipped if FLUX).
   *    - Gridless mode must not be paired with an MHD field model
   *      (BATSRUS/GAMERA require grid interpolation).
   * ──────────────────────────────────────────────────────────────────── */
  const chks=[

    /* ── Step 2: Calculation mode ──
     *  These ensure the two top-level choices are valid and mutually
     *  consistent.  The gridless+Tsyganenko check prevents the user
     *  from submitting an impossible configuration (MHD model needs
     *  a grid, but gridless was selected).
     *  The DENSITY_3D checks ensure grid mode is active and that the
     *  density energy range is valid. */
    {l:'Calc target selected',   ok:['CUTOFF_RIGIDITY','DENSITY_SPECTRUM','DENSITY_3D'].includes(S.calcQuantity)},
    {l:'Field method selected',  ok:['GRIDLESS','GRID_3D'].includes(S.fieldMethod)},
    {l:'Cutoff Emin < Emax',     ok:S.calcQuantity!=='CUTOFF_RIGIDITY'||(S.cutoffEmin<S.cutoffEmax)},
    {l:'Cutoff particles ≥ 50',  ok:S.calcQuantity!=='CUTOFF_RIGIDITY'||(S.cutoffMaxParticles>=50)},
    {l:'Cutoff traj time > 0',   ok:S.calcQuantity!=='CUTOFF_RIGIDITY'||(S.cutoffMaxTrajTime>0)},
    {l:'Cutoff sampling valid',  ok:S.calcQuantity!=='CUTOFF_RIGIDITY'||['VERTICAL','ISOTROPIC'].includes(S.cutoffSampling)},
    {l:'Dirmap resolution > 0',  ok:!S.directionalMap||(S.dirMapLonRes>0&&S.dirMapLatRes>0)},
    {l:'DS Emin < Emax',         ok:S.calcQuantity!=='DENSITY_SPECTRUM'||(S.dsEmin<S.dsEmax)},
    {l:'DS intervals ≥ 2',       ok:S.calcQuantity!=='DENSITY_SPECTRUM'||(S.dsNintervals>=2)},
    {l:'DS particles ≥ 50',      ok:S.calcQuantity!=='DENSITY_SPECTRUM'||(S.dsMaxParticles>=50)},
    {l:'DS traj time > 0',       ok:S.calcQuantity!=='DENSITY_SPECTRUM'||(S.dsMaxTrajTime>0)},
    {l:'Density Emin < Emax',    ok:S.calcQuantity!=='DENSITY_3D'||(S.densEmin<S.densEmax)},
    {l:'Density → 3-D Grid required', ok:S.calcQuantity!=='DENSITY_3D'||S.fieldMethod==='GRID_3D'},
    {l:'Gridless → analytical models only', ok:S.fieldMethod!=='GRIDLESS'||!['BATSRUS','GAMERA'].includes(S.fieldModel)},
    {l:'Dipole moment > 0',  ok:S.fieldModel!=='DIPOLE'||(S.dipoleMoment>0)},

    /* ── Step 3–5: Field, boundary ── */
    {l:'Dst in TS05 range',      ok:S.dst>=-600&&S.dst<=50},
    {l:'Pdyn > 0.1 nPa',         ok:S.pdyn>0.1},
    {l:'Domain boundary set',    ok:['BOX','SHUE'].includes(S.boundaryType)},
    {l:'Shue r₀ plausible (5–13 RE)', ok:S.boundaryType!=='SHUE'||( r0>5&&r0<13)},

    /* ── Step 7–10: Temporal, spectrum, output ── */
    {l:'Inject Δt ≥ Field Update', ok:S.tempMode==='STEADY_STATE'||S.injectDt>=S.fieldDt},
    {l:'Energy bins defined',    ok:S.energyBins.length>0},
    {l:'Spectrum type selected', ok:['POWER_LAW','POWER_LAW_CUTOFF','LIS_FORCE_FIELD','BAND','TABLE'].includes(S.specType)},
    {l:'Output mode selected',   ok:['POINTS','TRAJECTORY','SHELLS'].includes(S.outputMode)},
    {l:'Trajectory file loaded', ok:S.outputMode!=='TRAJECTORY'||S.trajLoaded, warn:true},
    {l:'Point list provided',    ok:S.outputMode!=='POINTS'||!!S.pointsText?.trim()},
    {l:'Shell altitudes set',    ok:S.outputMode!=='SHELLS'||(Array.isArray(S.shellAltsKm)&&S.shellAltsKm.length>=1&&S.shellAltsKm.slice(0,Math.max(1,parseInt(S.shellCount||1,10))).every(v=>parseFloat(v)>0))},
  ];
  const pass=chks.filter(c=>c.ok).length;
  const fail=chks.filter(c=>!c.ok&&!c.warn).length;
  const warn=chks.filter(c=>!c.ok&&c.warn).length;
  const rs=$('review-summary');
  if(rs) rs.innerHTML=`<span class="v-ok">✓ ${pass} passed</span> · <span class="v-warn">⚠ ${warn} warning</span> · <span class="v-err">✗ ${fail} fatal</span>`;
  const rc=$('review-checks'); if(rc){ rc.innerHTML='';
    chks.forEach(c=>{ const d=document.createElement('div');
      d.className='review-item '+(c.ok?'ri-ok':c.warn?'ri-warn':'');
      d.innerHTML=`<div class="ri-label">${c.l}</div><div class="ri-val">${c.ok?'✓ PASS':c.warn?'⚠ WARN':'✗ FAIL'}</div>`;
      rc.appendChild(d); }); }
  const sb=$('submit-btn-final'); if(sb) sb.disabled=fail>0;
}

function finalSubmit(){
  const m=$('submit-modal'); if(m) m.style.display='flex';
}

/* ── 6. SIDEBAR ──────────────────────────────────────────────────────
 *  updateSidebar() writes a one-line summary of each wizard step into
 *  the fixed right-hand sidebar.  It is called after every user
 *  interaction that changes state (input change, card click, etc.).
 *
 *  The local `set` function is a sidebar-scoped wrapper around the
 *  global `set()` in 01-state.js, but adds a 'sb-v' class prefix
 *  for sidebar-specific CSS styling (green/orange/red badges).
 *
 *  Progress bar: the bar fill is (done steps / completableSteps()) × 100%.
 *  completableSteps() returns the number of non-review entries in
 *  WIZARD_STEPS (defined in js/02-wizard.js).  The review step is
 *  the terminal state and is not itself "completable".
 * ──────────────────────────────────────────────────────────────────── */
function updateSidebar(){
  const set=(id,v,cls)=>{ const e=$(id); if(e){e.textContent=v;if(cls)e.className='sb-v '+cls;} };

  /* ── Step 2: Calculation mode (added 2026-02-21) ──
   *  Two sidebar rows: 'Calc target' and 'Field method'.
   *  prettyCalcTarget maps the raw state keyword to a human-readable
   *  label for the sidebar badge. */
  const prettyCalcTarget = {
    CUTOFF_RIGIDITY: 'CUTOFF RIGIDITY',
    DENSITY_SPECTRUM: 'SPECTRUM & DENSITY',
    DENSITY_3D: '3-D ION DENSITY'
  };
  set('sb-calc-target', prettyCalcTarget[S.calcQuantity] || S.calcQuantity, 'g');
  set('sb-field-method', S.fieldMethod === 'GRIDLESS' ? 'Gridless (analytic)' : '3-D Grid', S.fieldMethod === 'GRIDLESS' ? 'g' : '');

  /* ── Step 3: Species ── */
  set('sb-species',  S.species==='proton'?'H⁺ Proton':S.species==='helium'?'He²⁺':S.species==='electron'?'e⁻':S.species,'g');

  /* ── Step 4: Background B-field ── */
  // Sidebar must reflect the actual user-selected background B-field model.
  // (Previously this was hard-coded to 'TS05', which made the review summary incorrect.)
  const prettyField = {
    TS05: 'TS05 (Tsyganenko 2005)',
    T04S: 'T04s (Tsyganenko 2004 storm)',
    T96:  'T96 (Tsyganenko 1996)',
    T95M: 'T95m (modified Tsyganenko 1995)',
    T15:  'T15 (legacy label)',
    TA15: 'TA15 (Tsyganenko & Andreeva 2015)',
    TA16RBF: 'TA16RBF (Tsyganenko & Andreeva 2016)',
    BATSRUS: 'BATSRUS (MHD input)',
    GAMERA:  'GAMERA (MHD input)',
    DIPOLE:  'Dipole (pure tilted)'
  };
  set('sb-field-model', prettyField[S.fieldModel] || S.fieldModel || '—', 'g');

  /* ── Step 6: Boundary ── */
  set('sb-boundary', S.boundaryType==='SHUE'?'Shue 1998':'Box (GSM)','g');

  /* ── Step 6: E-field — disabled in gridless mode (added 2026-02-21) ──
   *  When S.fieldMethod is 'GRIDLESS', the E-field is physically excluded
   *  from the simulation.  The sidebar shows "N/A (gridless)" in orange
   *  to indicate that this step was intentionally skipped.
   *  In GRID_3D mode, the sidebar shows the active E-field components
   *  (e.g. "Coro+VS(Kp)" or "Coro+Weimer"). */
  if (S.fieldMethod === 'GRIDLESS') {
    set('sb-efield', 'N/A (gridless)', 'o');
  } else {
    const efParts = [];
    if (S.eFieldCoro) efParts.push('Coro');
    if (S.eFieldConvModel === 'VOLLAND_STERN') efParts.push('VS(Kp)');
    else if (S.eFieldConvModel === 'WEIMER') efParts.push('Weimer');
    set('sb-efield', efParts.length ? efParts.join('+') : 'None', efParts.length ? 'g' : 'o');
  }

  /* ── Steps 7–10: Temporal, spectrum, output ── */
  /* Build a compact temporal + E-field driver summary for the sidebar.
     TIME_SERIES: show row counts for each loaded driver dataset.
     STEADY_STATE: just show the epoch. */
  (function() {
    const tempModeLabels = {
      STEADY_STATE: 'Epoch Snapshot',
      TIME_SERIES:  'Storm Period',
      MHD_COUPLED:  'Coupled MHD',
    };
    let tempLabel = tempModeLabels[S.tempMode] || S.tempMode.replace('_', ' ');
    if (S.tempMode === 'TIME_SERIES') {
      const parts = [];
      /* B-field driver row count */
      const bRows = (typeof _ts05Dataset !== 'undefined' && _ts05Dataset.length) ||
                    (typeof _t96Dataset  !== 'undefined' && _t96Dataset.length)  ||
                    (typeof _t01Dataset  !== 'undefined' && _t01Dataset.length)  ||
                    (typeof _ta15Dataset !== 'undefined' && _ta15Dataset.length) ||
                    (typeof _ta16rbfDataset !== 'undefined' && _ta16rbfDataset.length) || 0;
      if (bRows > 0) parts.push(`B:${bRows}r`);
      /* E-field driver row count */
      if (S.eFieldConvModel === 'VOLLAND_STERN' && typeof _vsDataset !== 'undefined' && _vsDataset.length > 0)
        parts.push(`VS:${_vsDataset.length}r`);
      if (S.eFieldConvModel === 'WEIMER' && typeof _weimerTsDataset !== 'undefined' && _weimerTsDataset.length > 0)
        parts.push(`Wei:${_weimerTsDataset.length}r`);
      if (parts.length) tempLabel += ' · ' + parts.join(' ');
    }
    set('sb-temporal', tempLabel, '');
  })();
  /* Keep the steady-state timestamp input in sync with S.epoch
     (epoch may have been changed from a Step 3 field-model form) */
  if ($('ss-timestamp') && S.epoch) $('ss-timestamp').value = S.epoch;
  const prettySpec = {
    POWER_LAW: 'POWER LAW',
    POWER_LAW_CUTOFF: 'PL + EXP CUTOFF',
    LIS_FORCE_FIELD: 'LIS + FORCE-FIELD',
    BAND: 'BAND FUNCTION',
    TABLE: 'TABLE FILE'
  };
  set('sb-spec-type', prettySpec[S.specType] || S.specType.replace('_',' '),'');
  set('sb-output-mode', S.outputMode.replace('_',' '),'g');

  /* ── Progress bar ──
   *  Denominator is completableSteps() — the number of non-review
   *  steps in WIZARD_STEPS.  The review step is the destination,
   *  not a completable task, so it's excluded from the count.
   *  completableSteps() is defined in js/02-wizard.js. */
  const denom = (typeof completableSteps === 'function') ? completableSteps() : 9;
  const pct=Math.round((S.done.size/denom)*100);
  const pf=$('progress-fill'); if(pf) pf.style.width=pct+'%';
  const pp=$('progress-pct'); if(pp) pp.textContent=pct+'%';
}

/* ── 7. HELP MODAL ───────────────────────────────────────────────── */
function openHelpModal(){ const m=$('help-modal'); if(m) m.style.display='flex'; }
