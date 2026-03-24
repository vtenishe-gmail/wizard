/*
=====================================================================
FILE: js/01-state.js
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


OUTPUT DOMAIN ADDITIONS:
  - Added S.pointsText for POINTS mode: stores the raw multiline user text.
    We intentionally store the raw text (not a parsed array) so the UI can round-trip
    exactly what the user typed and so we can preserve comments/whitespace in future.
  - Added S.shellCount, S.shellResDeg, S.shellAltsKm for SHELLS mode.
    These are emitted into AMPS_PARAM.in by js/08-review.js.
LAST UPDATED: 2026-02-21
=====================================================================
*/
/* =============================================================================
   FILE:    js/01-state.js
   PROJECT: AMPS CCMC Submission Interface  v3
   PURPOSE: Global application state object and shared constants.

   The single object `S` is the source of truth for every wizard step.
   No wizard step ever stores its own private mutable state — it always
   reads from and writes to S so that the sidebar summary, keyword-preview
   strips, and param-file builder always see a consistent snapshot.

   SECTIONS
     S  — mutable run configuration (one property per AMPS_PARAM.in keyword)
     $  — getElementById shorthand
     set — helper to write a text element and optionally change its colour class
     CX, CY, SC — SVG canvas coordinate constants used by boundary diagrams

   PROPERTY GROUPS IN S
     Wizard meta       step, done
     Run metadata      runName (default, not user-editable)
     Calculation mode  calcQuantity, fieldMethod
                       cutoffEmin/cutoffEmax/cutoffMaxParticles/cutoffNenergy
                       gridNx/gridNy/gridNz/gridXmin..gridZmax
                       densEmin/densEmax/densNenergy/densEnergySpacing
                       dsEmin/dsEmax/dsNintervals/dsEnergySpacing
     Particle          species, charge, mass
     Background field  fieldModel, dst, pdyn, bz, vx, nsw, by, bx, epoch
                       t96Dst/t96Pdyn/t96By/t96Bz/t96Tilt
                       t01Dst/t01Pdyn/t01By/t01Bz/t01Tilt
                       ts07dSource/ts07dEpoch
                       TA15 official inputs follow t15_Data_format.txt:
                       ta15Bx/ta15By/ta15Bz, ta15Vx/ta15Vy/ta15Vz, ta15Np, ta15Temp,
                       ta15SymH, ta15ImfFlag, ta15SwFlag, ta15TiltRad, ta15Pdyn,
                       ta15Nidx, ta15Bidx, ta15Epoch
     Domain boundary   boundaryType, shueMode
                       boxXmax/Xmin/Ymax/Ymin/Zmax/Zmin/Rinner
                       shueR0, shueAlpha, xtail, shueRinner
     Electric field    eFieldCoro, eFieldConvModel
                       vsKpMode, vsKp, vsGamma, vsA
                       weimerMode
     Temporal          tempMode, eventStart, eventEnd, fieldDt, injectDt, tsSource
     Spectrum          specType, specJ0, specGamma, specE0, specEmin, specEmax
     Output domain     outputMode, fluxDt, trajLoaded
     Output options    fluxType, outputCutoff, outputPitch, outputFormat,
                       outputCoords, energyBins

   DEFAULT VALUES reflect the September 2017 SEP storm case
   (Van Allen Probe A trajectory run).

   DEPENDS ON: nothing (must be the first script loaded)
=============================================================================*/

/*
  CHANGELOG (Feb 2026) — Background magnetic-field model normalization

  Why this change:
    The web UI previously used inconsistent/ambiguous labels for empirical
    geomagnetic-field choices. This made it hard to map UI selections to the
    standard Tsyganenko-family naming used by CCMC, GEOPACK and common wrappers.

  What was updated:
    - Normalized the Step 3 model list to: TS05, T96, T01, TA15, TA16RBF
      plus file-driven MHD backgrounds: BATSRUS, GAMERA.
    - Added dedicated state keys for model-specific drivers:
        * t96Dst/t96Pdyn/t96By/t96Bz/t96Tilt
        * t01Dst/t01Pdyn/t01By/t01Bz/t01Tilt
        * ts07dSource/ts07dEpoch (coefficients are time-dependent)
        * TA15 (Tsyganenko & Andreeva 2015) uses OMNI-style inputs (see doc/ta15_data_format.txt):
          Bx/By/Bz (GSW, 30-min trailing avg), Vx/Vy/Vz (GSE), Np, T, Sym-H, IMF flag, SW flag,
          tilt (radians, GSW), Pdyn, and coupling indices N-index and B-index (30-min trailing avg).
    - Chose defaults consistent with a well-known storm case (Sep 2017) for
      TS05, and quiet-ish baseline defaults for T96/T01/TA15 fields.

  Where else this is implemented:
    - index.html: model cards + forms shown to user
    - js/03-bgfield.js: model selection, validation, and AMPS keyword preview
*/

const S = {
  /* ── Wizard meta ───────────────────────────────────────────────────── */
  step: 1,
  done: new Set(),     // set of completed step numbers (used by wizard nav)

  /* Run metadata kept minimal — RUN_ID uses a default */
  runName: 'AMPS_run',
  institution: '',

  /* ── Step 2 · Calculation mode ────────────────────────────────────────
   *
   *  These properties control the two top-level architectural choices
   *  made in Step 2 (Calc Mode).  They cascade forward through the
   *  entire wizard: fieldMethod determines whether MHD models and
   *  E-field are available; calcQuantity determines whether the cutoff
   *  section appears in AMPS_PARAM.in.
   *
   *  See js/02a-calcmode.js for the full constraint-propagation logic.
   *
   *  AMPS_PARAM.in keywords affected:
   *    #CALCULATION_MODE
   *    CALC_TARGET            = CUTOFF_RIGIDITY | DENSITY_SPECTRUM | DENSITY_3D
   *    FIELD_EVAL_METHOD      = GRIDLESS | GRID_3D
   *    (plus GRID_NX/NY/NZ/XMIN..ZMAX when GRID_3D)
   *    #CUTOFF_RIGIDITY       (emitted only when target ≠ FLUX)
   *    CUTOFF_EMIN / EMAX     = <float> MeV/n
   *    CUTOFF_MAX_PARTICLES   = <int>
   *    CUTOFF_NENERGY         = <int>
   * ───────────────────────────────────────────────────────────────────── */

  /*  What to calculate: cutoff rigidity, spectrum & density, or 3-D density.
   *  CUTOFF_RIGIDITY:    backward-trace to find geomagnetic cutoff.
   *  DENSITY_SPECTRUM:   backward-trace across energy grid, fold with boundary
   *                      spectrum to get local density & spectral intensity.
   *  DENSITY_3D:         forward-inject from boundary; sample energy-resolved
   *                      ion density on the 3-D simulation grid. */
  calcQuantity: 'CUTOFF_RIGIDITY',  // 'CUTOFF_RIGIDITY' | 'DENSITY_SPECTRUM' | 'DENSITY_3D'

  /*  How the background B (and optionally E) field is evaluated at
   *  each particle position during Lorentz-force integration.
   *  GRIDLESS: analytic Tsyganenko call per step (no E-field, no MHD).
   *  GRID_3D:  tri-linear interpolation from pre-computed 3-D grid
   *            (supports MHD + E-field; requires grid config below). */
  fieldMethod:  'GRIDLESS',         // 'GRIDLESS' | 'GRID_3D'

  /*  Cutoff rigidity scan parameters (used when calcQuantity === 'CUTOFF_RIGIDITY').
   *  At each observation point, AMPS injects test particles across
   *  [cutoffEmin, cutoffEmax] in cutoffNenergy log-spaced energy bins.
   *  cutoffMaxParticles is the total injected per point (divided among bins). */
  cutoffEmin:        1.0,           // [MeV/n] lower bound of energy scan
  cutoffEmax:     1000.0,           // [MeV/n] upper bound of energy scan
  cutoffMaxParticles: 500,          // total test particles per injection point
  cutoffNenergy:      50,           // log-spaced energy bins in [Emin, Emax]
  cutoffMaxTrajTime: 600,           // [sec] max trajectory integration time per particle

  /*  Cutoff sampling mode:
   *  VERTICAL:   inject test particles along the local vertical (radial)
   *              direction only — yields the standard "vertical cutoff rigidity".
   *  ISOTROPIC:  inject test particles isotropically over the upper hemisphere
   *              — yields the "effective" (omnidirectional) cutoff rigidity.
   *  AMPS_PARAM.in keyword: CUTOFF_SAMPLING = VERTICAL | ISOTROPIC */
  cutoffSampling: 'VERTICAL',       // 'VERTICAL' | 'ISOTROPIC'

  /*  Directional cutoff rigidity map:
   *  When enabled (and output mode is POINTS or TRAJECTORY), AMPS computes
   *  a full sky-map of directional cutoff rigidity at each observation point,
   *  scanning a longitude × latitude grid over the upper hemisphere.
   *  The map resolution is set by dirMapLonRes and dirMapLatRes (degrees).
   *  AMPS_PARAM.in keywords:
   *    DIRECTIONAL_MAP        = T | F
   *    DIRMAP_LON_RES         = <float>  degrees
   *    DIRMAP_LAT_RES         = <float>  degrees */
  directionalMap:  false,            // compute directional cutoff map?
  dirMapLonRes:    10,               // [deg] longitude resolution for directional map
  dirMapLatRes:    10,               // [deg] latitude resolution for directional map

  /*  3-D interpolation grid parameters (used when fieldMethod === 'GRID_3D').
   *  The grid is a regular Cartesian mesh in GSM coordinates.
   *  Memory ≈ 6 components × 8 bytes × Nx × Ny × Nz.
   *  Defaults span the standard magnetospheric simulation domain. */
  gridNx:  100,                     // grid cells along X (GSM, sunward/tailward)
  gridNy:  100,                     // grid cells along Y (GSM, dawn/dusk)
  gridNz:   60,                     // grid cells along Z (GSM, north/south)
  gridXmin: -60, gridXmax:  15,     // [RE] X extent (tailward to sunward)
  gridYmin: -25, gridYmax:  25,     // [RE] Y extent (dawn to dusk)
  gridZmin: -20, gridZmax:  20,     // [RE] Z extent (south to north)

  /*  Density-spectrum sampling parameters (used when calcQuantity === 'DENSITY_SPECTRUM').
   *  At each observation point, AMPS backward-traces test particles across
   *  an energy grid.  The transmission function is then folded with the
   *  boundary source spectrum (Step 8) to obtain energy-resolved particle
   *  density and spectral intensity at that location.
   *  AMPS_PARAM.in keywords:
   *    #DENSITY_SPECTRUM
   *    DS_EMIN / DS_EMAX     = <float> MeV/n
   *    DS_NINTERVALS         = <int>
   *    DS_MAX_PARTICLES      = <int>
   *    DS_ENERGY_SPACING     = LOG | LINEAR */
  dsEmin:        1.0,               // [MeV/n] lower bound for energy sampling
  dsEmax:     1000.0,               // [MeV/n] upper bound for energy sampling
  dsNintervals:  50,                // number of energy intervals
  dsMaxParticles: 500,              // total test particles per observation point
  dsMaxTrajTime: 600,               // [sec] max trajectory integration time per particle
  dsEnergySpacing: 'LOG',           // 'LOG' | 'LINEAR'

  /*  3-D density sampling parameters (used when calcQuantity === 'DENSITY_3D').
   *  Forward-models particle transport in 3-D geospace, sampling the
   *  resulting ion density in energy-resolved bins on the simulation
   *  grid.  Each energy bin produces a separate density output field.
   *  The energy range is divided into densNenergy bins, spaced either
   *  linearly or logarithmically.
   *  AMPS_PARAM.in keywords:
   *    #DENSITY_3D
   *    DENS_EMIN / DENS_EMAX     = <float> MeV/n
   *    DENS_NENERGY              = <int>
   *    DENS_ENERGY_SPACING       = LOG | LINEAR */
  densEmin:        0.1,             // [MeV/n] lower bound for density sampling
  densEmax:     1000.0,             // [MeV/n] upper bound for density sampling
  densNenergy:     30,              // number of energy bins
  densEnergySpacing: 'LOG',         // 'LOG' | 'LINEAR'

  /* ── Step 3 · Particle species ─────────────────────────────────────── */
  species: 'proton',
  charge:  1,          // elementary charges (Z)
  mass:    1.0073,     // atomic mass units (u)

  /* ── Step 3 · Background magnetic field model ──────────────────────── */
  fieldModel: 'TS05',
  // TS05 storm-time driver set (UI-compatible):
  dst:   -142.0,       // [nT]  Dst index (ring current proxy)
  pdyn:    3.5,        // [nPa] solar wind dynamic pressure
  bz:    -18.5,        // [nT]  IMF Bz (GSM)
  vx:   -650.0,        // [km/s] solar wind velocity (negative = sunward)
  nsw:    12.0,        // [cm⁻³] solar wind proton number density
  by:      3.2,        // [nT]  IMF By (GSM)
  bx:      0.0,        // [nT]  IMF Bx (GSM)
  epoch: '2017-09-10T16:00',  // ISO-8601 epoch for STEADY_STATE runs
  ts05DriverMode: 'manual',   // 'manual' | 'omni_record' (paste OMNI+W1..W6 line)
  ts05TiltRad:   0.0,        // [rad] dipole tilt (from OMNI record)
  ts05ImfFlag:   1,          // -1 none, 1 original, 2 interpolated (from OMNI record)
  ts05SwFlag:    1,
  ts05W1:        null,
  ts05W2:        null,
  ts05W3:        null,
  ts05W4:        null,
  ts05W5:        null,
  ts05W6:        null,
  // T96 driver set:
  t96Dst:  -20.0,
  t96Pdyn:   2.0,
  t96By:     0.0,
  t96Bz:     2.0,
  t96Tilt:   0.0,
  t96Epoch:  '2017-09-10T16:00',
  // T01 driver set:
  t01Dst:  -20.0,
  t01Pdyn:   2.0,
  t01By:     0.0,
  t01Bz:     2.0,
  t01Tilt:   0.0,
  t01G1:     0.0,
  t01G2:     0.0,
  t01Epoch:  '2017-09-10T16:00',
  // TA16RBF drivers (Tsyganenko & Andreeva 2016, RBF model):
  // Official OMNI-style set + SymHc (see Data_format_ta16_rbf.txt).
  ta16Bx:     0.0,
  ta16By:     0.0,
  ta16Bz:     2.0,
  ta16Vx:  -450.0,
  ta16Vy:     0.0,
  ta16Vz:     0.0,
  ta16Np:     5.0,
  ta16Temp: 200000.0,   // K
  ta16SymH: -20.0,      // nT
  ta16ImfFlag: 1,
  ta16SwFlag:  1,
  ta16TiltRad: 0.0,     // radians (GSW)
  ta16Pdyn:    2.0,     // nPa
  ta16Nidx:    0.25,
  ta16Bidx:    0.25,
  ta16SymHc:  -20.0,    // nT (30-min centered sliding avg)
  ta16Epoch:  '2017-09-10T16:00',
  // TA15 ("T15") drivers: solar wind + coupling indices + GOES total-B (site UI):
  // TA15 defaults roughly correspond to a quiet/moderate OMNI snapshot.
  ta15Bx:     0.0,
  ta15By:     0.0,
  ta15Bz:     2.0,
  ta15Vx:  -450.0,
  ta15Vy:     0.0,
  ta15Vz:     0.0,
  ta15Np:     5.0,
  ta15Temp: 200000.0,   // K
  ta15SymH: -20.0,      // nT
  ta15ImfFlag: 1,
  ta15SwFlag:  1,
  ta15TiltRad: 0.0,     // radians (official)
  ta15Pdyn:    2.0,     // nPa
  ta15Nidx:    0.25,
  ta15Bidx:    0.25,
  ta15Epoch:  '2017-09-10T16:00',
  // Dipole driver set:
  dipoleMoment: 1.0,            // [M_E] multiples of Earth's dipole moment
  dipoleTilt:   0.0,            // [deg] tilt of magnetic axis from GSM Z-axis

  /* ── Step 4 · Domain boundary ──────────────────────────────────────── */
  boundaryType: 'SHUE',     // 'BOX' or 'SHUE'
  shueMode:     'auto',     // 'auto' (from TS05 Dst/Pdyn/Bz) or 'manual'
  // BOX face positions [RE, GSM]:
  boxXmax:  15,  boxXmin: -60,
  boxYmax:  25,  boxYmin: -25,
  boxZmax:  20,  boxZmin: -20,
  boxRinner: 2.0,           // [RE] inner loss sphere radius
  // Shue manual overrides (null = use auto-computed values):
  shueR0:     null,         // [RE] subsolar standoff
  shueAlpha:  null,         // [] flaring exponent
  xtail:      -60,          // [RE] nightside tail-cap flat cut
  shueRinner:  2.0,         // [RE] inner boundary (same as boxRinner for Shue)

  /* ── Step 5 · Electric field ────────────────────────────────────────── */
  eFieldCoro:      true,             // include corotation E? (default: YES)
  eFieldConvModel: 'VOLLAND_STERN',  // 'VOLLAND_STERN' | 'WEIMER' | 'NONE'
  // Volland-Stern parameters:
  vsKpMode: 'auto',    // 'auto' = derive Kp from Dst; 'manual' = user input
  vsKp:      5.0,      // Kp index (updated from Dst on init)
  vsGamma:   2.0,      // shielding exponent (typical 2.0; range 1.5–3.0)
  vsA:       null,     // intensity coefficient (computed by vsIntensityA)
  // Weimer 2005 configuration:
  weimerMode: 'auto',  // 'auto' = read from TS05 drivers; 'file' = upload

  /* ── Step 7 E-field time-series driver sources (new) ─────────────────
     Control which data source feeds the E-field models in TIME_SERIES runs.
     Mirrors tsSource above but scoped to each convection model.            */
  vsEfieldSrc:     'omni',   // 'omni' | 'file' | 'scalar'  (VS Kp time series)
  weimerEfieldSrc: 'omni',   // 'omni' | 'file' | 'scalar'  (Weimer IMF+SW series)

  /* ── Step 6 · Temporal variability ─────────────────────────────────── */
  tempMode:    'TIME_SERIES',         // 'STEADY_STATE' | 'TIME_SERIES' | 'MHD_COUPLED'
  eventStart:  '2017-09-07T00:00',
  eventEnd:    '2017-09-10T20:00',
  fieldDt:     5,     // [min] field-update cadence (FIELD_UPDATE_DT)
  injectDt:    30,    // [min] particle injection cadence (INJECT_DT)
  tsSource:    'omni', // 'omni' | 'file' | 'scalar'

  /* ── Step 7 · Particle source spectrum ──────────────────────────────── */
  specType:   'POWER_LAW',   // 'POWER_LAW' | 'POWER_LAW_CUTOFF' | 'LIS_FORCE_FIELD' | 'BAND' | 'TABLE'
  specJ0:     10000,         // [cm⁻² sr⁻¹ s⁻¹ MeV⁻¹] reference flux
  specGamma:  3.5,           // power-law spectral index
  specE0:     10,            // [MeV] reference energy
  specEmin:   1,             // [MeV] minimum energy
  specEmax:   1000,          // [MeV] maximum energy
  // Power law + exponential cutoff parameters:
  specEc:     500,           // [MeV] exponential cutoff energy
  // LIS + Force-Field modulation parameters:
  specPhi:    550,           // [MV] solar modulation potential (φ)
  specLisJ0:  10000,         // [cm⁻² sr⁻¹ s⁻¹ MeV⁻¹] LIS reference flux
  specLisGamma: 2.7,         // LIS power-law index (typically 2.6-2.8 for GCR protons)

  /* ── Step 8 · Output domain ───────────────────────────────────────────
     This step defines WHERE the model is evaluated (points, a trajectory, or shells).
     These settings are written into AMPS_PARAM.in by js/08-review.js.
   ─────────────────────────────────────────────────────────────────────── */
  outputMode: 'TRAJECTORY',     // 'POINTS' | 'TRAJECTORY' | 'SHELLS'
  fluxDt:      1.0,             // [min] output cadence for TRAJECTORY mode (FLUX_DT)
  trajLoaded:  false,           // has a trajectory file been loaded? (TRAJECTORY mode)
  trajFile:    null,            // File object for the uploaded trajectory (or null)
  trajFrame:   'GEO',           // coordinate frame for TRAJECTORY mode: 'GEO' | 'GSM' | 'SM'

  // POINTS mode:
  pointsText:  '',              // raw multiline text of points (one point per line)
                              // NOTE: We keep this as raw text so the site can:
                              //   (1) preserve user formatting (spaces vs commas),
                              //   (2) keep the UI simple (no CSV parser in-browser), and
                              //   (3) pass-through to AMPS_PARAM.in in a transparent way.
  pointsFrame: 'GEO',          // coordinate frame for POINTS mode: 'GEO' | 'GSM' | 'SM'

  // SHELLS mode:
  shellCount:  1,               // number of shells (1..5)
  shellResDeg: 1,               // angular grid resolution in degrees (1,2,5,...)
  shellAltsKm: [450],           // list of shell altitudes (km), length = shellCount

  /* ── Step 9 · Output options ─────────────────────────────────────────── */
  fluxType:      'DIFFERENTIAL', // 'DIFFERENTIAL' | 'INTEGRAL'
  outputCutoff:  true,           // write cutoff rigidity field?
  outputPitch:   false,          // write pitch-angle distribution?
  outputFormat:  'NETCDF4',      // 'NETCDF4' | 'HDF5' | 'ASCII'
  outputCoords:  'GEO',          // 'GEO' | 'GSM' | 'SM'
  energyBins:    [1, 5, 10, 30, 100, 300, 1000],  // [MeV]

  /* ── Uploaded File objects ────────────────────────────────────────────
     Each property holds a browser File object (or null) for a user-
     uploaded input file.  These are stored here so that:
       (1) buildReview() can emit the real filename into AMPS_PARAM.in,
       (2) downloadBundle() can bundle them into the submission tar.gz.
     They are never serialised to AMPS_PARAM.in directly — only the
     .name string is used.  Reset to null on page reload.
   ──────────────────────────────────────────────────────────────────── */
  tsFile:        null,   // File: TS05 / time-series driving parameters (Step 6, tsSource='file')
  weimerFile:    null,   // File: Weimer time-dependent E-field driving (Step 5, weimerMode='file')
  specTableFile: null,   // File: user spectrum table (Step 7, specType='TABLE')

  /* ── Visualization / Dashboard settings ──────────────────────────────
     These properties control the Results dashboard (js/13-radcalc.js
     through js/17-output-reader.js).  They do not affect AMPS_PARAM.in.
   ──────────────────────────────────────────────────────────────────── */
  vizShieldingSet: [0, 5, 10, 20],   // g/cm² Al-equivalent thicknesses
  vizEgridN:       200,               // master energy grid points
  vizEgridMin:     0.1,               // MeV
  vizEgridMax:     1e4,               // MeV
  vizAutoUpdate:   true,              // auto-recompute on spectrum change?
  vizRcEstimate:   null,              // pre-run Rc estimate [GV] (filled by radbridge)
  vizOutputLoaded: false,             // has an output file been loaded?
};

/* ── Convenience aliases ─────────────────────────────────────────────── */
/** getElementById shorthand used everywhere */
const $ = id => document.getElementById(id);

/**
 * Write text into an element; optionally set a status colour class.
 * @param {string} id   - element ID
 * @param {string} text - text content to set
 * @param {string} [cls] - 'g'=green, 'o'=orange, 'r'=red, ''=no change
 */
function set(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  if (cls === 'g') { el.className = 'sb-ok';   }
  else if (cls === 'o') { el.className = 'sb-warn'; }
  else if (cls === 'r') { el.className = 'sb-err';  }
}

/* ── SVG canvas constants (shared by boundary diagram renderers) ─────── */
const CX = 200;  // SVG pixel X of GSM origin (Earth centre)
const CY = 160;  // SVG pixel Y of GSM origin
const SC = 5;    // pixels per Earth radius

/**
 * Convert GSM X [RE] to SVG pixel X.
 * Positive X_GSM → right (sunward), negative X_GSM → left (tailward).
 */
const gx = re => CX + re * SC;

/**
 * Convert GSM Z [RE] to SVG pixel Y.
 * Note: SVG Y-axis is inverted vs GSM Z — +Z_GSM maps to smaller SVG Y (upward).
 */
const gz = re => CY - re * SC;

/**
 * Clamp a value between lo and hi (inclusive).
 * Used when mapping large GSM coordinates to finite SVG viewport.
 */
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
