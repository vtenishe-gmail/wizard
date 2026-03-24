/*
╔═══════════════════════════════════════════════════════════════════════════════╗
║  FILE:  js/12-load.js                                                       ║
║  AMPS CCMC Submission Interface  v3                                         ║
║  LAST UPDATED: 2026-03-01                                                   ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                             ║
║  PURPOSE                                                                    ║
║  ───────                                                                    ║
║  Load and parse a previously generated AMPS_PARAM.in file, restore the      ║
║  wizard state object (S) from it, and sync all UI elements so the user      ║
║  can continue editing without re-entering every parameter.                  ║
║                                                                             ║
║  This module is the INVERSE of buildReview() in js/08-review.js:            ║
║                                                                             ║
║    buildReview():  S  ──►  AMPS_PARAM.in text   (export)                    ║
║    this module:    AMPS_PARAM.in text  ──►  S  ──►  UI sync   (import)      ║
║                                                                             ║
║  ARCHITECTURE                                                               ║
║  ────────────                                                               ║
║  The module is organized into 5 sections:                                   ║
║                                                                             ║
║    §1  PARSER           parseParamFile(text) → keyword map                  ║
║    §2  KEYWORD REGISTRY KEYWORD_MAP[] — declarative keyword→state mapping   ║
║    §3  STATE APPLICATOR applyParsedState(kv) — maps keywords → S props      ║
║    §4  UI SYNC          syncAllUI(kv) — pushes S into DOM elements          ║
║    §5  FILE I/O & UX    modal, drag-drop, paste, toast notifications        ║
║                                                                             ║
║  ┌─────────────────────────────────────────────────────────────────────┐     ║
║  │                  HOW TO ADD A NEW KEYWORD                          │     ║
║  │                                                                    │     ║
║  │  1. Add the S property in js/01-state.js with a default value      │     ║
║  │  2. Add ONE ROW to the KEYWORD_MAP table below (§2)                │     ║
║  │  3. Add the corresponding buildReview() line in js/08-review.js    │     ║
║  │  4. Add a DOM input in index.html + a setVal() line in syncAllUI() │     ║
║  │                                                                    │     ║
║  │  The KEYWORD_MAP row format is:                                    │     ║
║  │    { kw: 'FILE_KEYWORD', prop: 'sPropName', type: 'num' }         │     ║
║  │                                                                    │     ║
║  │  Types: 'num' (float), 'int', 'str', 'bool'                       │     ║
║  │  Optional fields: step (wizard step #), desc (human description)   │     ║
║  │                                                                    │     ║
║  │  That's it.  The applyParsedState() loop handles the rest.         │     ║
║  │  Only add explicit code for SPECIAL CASES (species normalization,  │     ║
║  │  Shue auto/manual detection, array parsing, etc.).                 │     ║
║  └─────────────────────────────────────────────────────────────────────┘     ║
║                                                                             ║
║  AMPS_PARAM.in FILE FORMAT                                                  ║
║  ─────────────────────────────                                              ║
║    #SECTION_NAME              ← section header (for human organization)     ║
║    KEYWORD  value  ! comment  ← active parameter (whitespace-separated)     ║
║    ! KEYWORD value ! comment  ← commented-out advanced/optional parameter   ║
║    ! This is just a comment   ← pure description line (skipped)             ║
║    POINTS_BEGIN               ← start of multi-line block                   ║
║    POINT  x y z               ← block data line                            ║
║    POINTS_END                 ← end of multi-line block                     ║
║    ENERGY_BINS 1 5 10 30 100  ← space-separated array on single line       ║
║                                                                             ║
║  DEPENDENCIES                                                               ║
║  ────────────                                                               ║
║  REQUIRED:  js/01-state.js  (S, $)                                          ║
║  OPTIONAL:  all other js/* (guarded by typeof checks)                       ║
║                                                                             ║
╚═══════════════════════════════════════════════════════════════════════════════╝
*/


/* ╔═══════════════════════════════════════════════════════════════════════════╗
   ║  §1  PARSER — Convert AMPS_PARAM.in text into a flat keyword→value map  ║
   ╚═══════════════════════════════════════════════════════════════════════════╝

   INPUT:   Raw text contents of an AMPS_PARAM.in file (string).
   OUTPUT:  A plain JavaScript object { keyword: stringValue, ... }
            plus special keys:
              __POINTS_BLOCK : string[]  — lines from the POINTS block
              __section      : string    — last #SECTION header encountered

   GRAMMAR (informal):
   ┌──────────────────────────────────────────────────────────────────────┐
   │  line types (checked in priority order):                            │
   │    1. POINTS_BEGIN/END    block delimiters (stateful toggle)        │
   │    2. points data         any line inside the block                 │
   │    3. blank / decorator   /^\s*$/ or /^\s*!\s*[═─]+/               │
   │    4. section header      /^\s*#(\w+)/                             │
   │    5. commented param     /^\s*!\s+([A-Z][A-Z0-9_]+)\s+(.*)/       │
   │    6. pure comment        /^\s*!/                                   │
   │    7. active param        /^\s*([A-Z][A-Z0-9_]+)\s+(.*)/           │
   └──────────────────────────────────────────────────────────────────────┘

   PRIORITY RULE: Active params always overwrite commented params.
*/

/**
 * Parse an AMPS_PARAM.in file into a flat keyword→value map.
 *
 * @param   {string} text  Raw file contents (may use \r\n or \n)
 * @returns {Object}       { KEYWORD: "stringValue", __POINTS_BLOCK: string[], __section: string }
 *
 * @example
 *   const kv = parseParamFile(fileText);
 *   // kv.DST          === "-142"           (string — coercion is in §3)
 *   // kv.ENERGY_BINS  === "1 5 10 30 100"  (string — split in §3)
 *   // kv.__POINTS_BLOCK === ["6.6 0 0"]    (array of point strings)
 */
function parseParamFile(text) {
  const kv = {};
  const lines = text.split(/\r?\n/);
  let   section = '';
  let   inPointsBlock = false;
  const pointsLines = [];

  for (const line of lines) {

    // ── 1. POINTS_BEGIN/END delimiters (stateful toggle) ──
    if (/^\s*POINTS_BEGIN\s*$/i.test(line)) { inPointsBlock = true;  continue; }
    if (/^\s*POINTS_END\s*$/i.test(line))   { inPointsBlock = false; continue; }

    // ── 2. Inside points block → accumulate data lines ──
    //    Strip optional "POINT" prefix: "POINT 6.6 0 0" → "6.6 0 0"
    if (inPointsBlock) {
      const stripped = line.replace(/^\s*POINT\s+/i, '').trim();
      if (stripped && !stripped.startsWith('!')) pointsLines.push(stripped);
      continue;
    }

    // ── 3. Blank and decorator lines → skip ──
    if (/^\s*$/.test(line)) continue;
    if (/^\s*!\s*[═─]+/.test(line)) continue;

    // ── 4. Section headers: #SECTION_NAME ──
    const secMatch = /^\s*#(\w+)/.exec(line);
    if (secMatch) { section = secMatch[1]; continue; }

    // ── 5. Commented-out parameter: "! KEYWORD value ! desc" ──
    //    Recovered for advanced/optional params (e.g., TS05_W1..W6).
    //    ONLY stored if no active (uncommented) version exists yet.
    //
    //    ReDoS fix (SonarQube S5852): the original capture group used .*
    //    which is unbounded. When the overall match fails on a long line
    //    that has no value after the keyword, the JS engine must explore
    //    every position via backtracking, causing O(n²) runtime. Replaced
    //    with [^\r\n]* which terminates at the line boundary and eliminates
    //    that backtracking surface. Lines are already split on \n before
    //    reaching this point, so the change has no effect on valid input.
    const commentedParam = /^\s*!\s+([A-Z][A-Z0-9_]+)\s+([^\r\n]*)/.exec(line);
    if (commentedParam) {
      const key = commentedParam[1].trim();
      let   val = commentedParam[2].trim().replace(/\s*![^\r\n]*/, '').trim();
      if (val && key.length > 2 && !(key in kv)) kv[key] = val;
      continue;
    }

    // ── 6. Pure comment lines → skip ──
    if (/^\s*!/.test(line)) continue;

    // ── 7. Active parameter: "KEYWORD value ! optional comment" ──
    //    Active values ALWAYS overwrite previously seen commented versions.
    //
    //    ReDoS fix (SonarQube S5852): same fix as case 5 above — replaced .*
    //    with [^\r\n]* to bound the match to a single line and prevent
    //    super-linear backtracking on malformed or empty-value lines.
    const paramMatch = /^\s*([A-Z][A-Z0-9_]+)\s+([^\r\n]*)/.exec(line);
    if (paramMatch) {
      const key = paramMatch[1].trim();
      kv[key] = paramMatch[2].trim().replace(/\s*![^\r\n]*/, '').trim();
    }
  }

  if (pointsLines.length > 0) kv.__POINTS_BLOCK = pointsLines;
  kv.__section = section;
  return kv;
}


/* ╔═══════════════════════════════════════════════════════════════════════════╗
   ║  §2  KEYWORD REGISTRY — Declarative mapping: file keyword → S property  ║
   ╚═══════════════════════════════════════════════════════════════════════════╝

   ENTRY FORMAT:
   ┌────────────────────────────────────────────────────────────────────────┐
   │  { kw: 'KEYWORD', prop: 'sProp', type: 'num'|'int'|'str'|'bool',    │
   │    step: N, desc: 'description' }                                     │
   └────────────────────────────────────────────────────────────────────────┘
   TYPE COERCION:
     'num'  → parseFloat()    'int'  → parseInt(,10)
     'str'  → as-is           'bool' → T/YES/TRUE → true

   ┌─────────────────────────────────────────────────────────────────────┐
   │  TO ADD A NEW KEYWORD: add one row here + buildReview() output.    │
   └─────────────────────────────────────────────────────────────────────┘
*/
const KEYWORD_MAP = [

  // ═══════ STEP 2: Calculation Mode ═══════
  { kw: 'CALC_TARGET',          prop: 'calcQuantity',      type: 'str',  step: 2,  desc: 'CUTOFF_RIGIDITY|DENSITY_SPECTRUM|DENSITY_3D' },
  { kw: 'FIELD_EVAL_METHOD',    prop: 'fieldMethod',       type: 'str',  step: 2,  desc: 'GRIDLESS|GRID_3D' },
  { kw: 'GRID_NX',             prop: 'gridNx',            type: 'int',  step: 2,  desc: 'Grid cells X' },
  { kw: 'GRID_NY',             prop: 'gridNy',            type: 'int',  step: 2,  desc: 'Grid cells Y' },
  { kw: 'GRID_NZ',             prop: 'gridNz',            type: 'int',  step: 2,  desc: 'Grid cells Z' },
  { kw: 'GRID_XMIN',           prop: 'gridXmin',          type: 'num',  step: 2,  desc: 'Grid X min [RE]' },
  { kw: 'GRID_XMAX',           prop: 'gridXmax',          type: 'num',  step: 2,  desc: 'Grid X max [RE]' },
  { kw: 'GRID_YMIN',           prop: 'gridYmin',          type: 'num',  step: 2,  desc: 'Grid Y min [RE]' },
  { kw: 'GRID_YMAX',           prop: 'gridYmax',          type: 'num',  step: 2,  desc: 'Grid Y max [RE]' },
  { kw: 'GRID_ZMIN',           prop: 'gridZmin',          type: 'num',  step: 2,  desc: 'Grid Z min [RE]' },
  { kw: 'GRID_ZMAX',           prop: 'gridZmax',          type: 'num',  step: 2,  desc: 'Grid Z max [RE]' },
  { kw: 'CUTOFF_EMIN',         prop: 'cutoffEmin',        type: 'num',  step: 2,  desc: 'Cutoff Emin [MeV/n]' },
  { kw: 'CUTOFF_EMAX',         prop: 'cutoffEmax',        type: 'num',  step: 2,  desc: 'Cutoff Emax [MeV/n]' },
  { kw: 'CUTOFF_MAX_PARTICLES',prop: 'cutoffMaxParticles', type: 'int', step: 2,  desc: 'Max particles' },
  { kw: 'CUTOFF_NENERGY',      prop: 'cutoffNenergy',     type: 'int',  step: 2,  desc: 'Energy bins' },
  { kw: 'CUTOFF_MAX_TRAJ_TIME', prop: 'cutoffMaxTrajTime', type: 'int', step: 2,  desc: 'Max traj time [sec]' },
  { kw: 'CUTOFF_SAMPLING',     prop: 'cutoffSampling',    type: 'str',  step: 2,  desc: 'VERTICAL|ISOTROPIC' },
  { kw: 'DIRECTIONAL_MAP',     prop: 'directionalMap',    type: 'bool', step: 2,  desc: 'Directional Rc map' },
  { kw: 'DIRMAP_LON_RES',      prop: 'dirMapLonRes',      type: 'int',  step: 2,  desc: 'Directional map lon res [deg]' },
  { kw: 'DIRMAP_LAT_RES',      prop: 'dirMapLatRes',      type: 'int',  step: 2,  desc: 'Directional map lat res [deg]' },
  { kw: 'DENS_EMIN',           prop: 'densEmin',          type: 'num',  step: 2,  desc: 'Density Emin [MeV]' },
  { kw: 'DENS_EMAX',           prop: 'densEmax',          type: 'num',  step: 2,  desc: 'Density Emax [MeV]' },
  { kw: 'DENS_NENERGY',        prop: 'densNenergy',       type: 'int',  step: 2,  desc: 'Density energy bins' },
  { kw: 'DENS_ENERGY_SPACING', prop: 'densEnergySpacing', type: 'str',  step: 2,  desc: 'LOG|LINEAR' },
  { kw: 'DS_EMIN',             prop: 'dsEmin',            type: 'num',  step: 2,  desc: 'Density-spectrum Emin [MeV]' },
  { kw: 'DS_EMAX',             prop: 'dsEmax',            type: 'num',  step: 2,  desc: 'Density-spectrum Emax [MeV]' },
  { kw: 'DS_NINTERVALS',       prop: 'dsNintervals',      type: 'int',  step: 2,  desc: 'Energy intervals' },
  { kw: 'DS_MAX_PARTICLES',    prop: 'dsMaxParticles',    type: 'int',  step: 2,  desc: 'Particles per point' },
  { kw: 'DS_MAX_TRAJ_TIME',    prop: 'dsMaxTrajTime',     type: 'int',  step: 2,  desc: 'Max traj time [sec]' },
  { kw: 'DS_ENERGY_SPACING',   prop: 'dsEnergySpacing',   type: 'str',  step: 2,  desc: 'LOG|LINEAR' },

  // ═══════ STEP 3: B-Field  (SPECIES handled in special cases) ═══════
  { kw: 'FIELD_MODEL',          prop: 'fieldModel',        type: 'str',  step: 3,  desc: 'B-field model name' },
  { kw: 'DST',                  prop: 'dst',               type: 'num',  step: 3,  desc: 'Dst [nT]' },
  { kw: 'PDYN',                 prop: 'pdyn',              type: 'num',  step: 3,  desc: 'Pdyn [nPa]' },
  { kw: 'IMF_BZ',               prop: 'bz',               type: 'num',  step: 3,  desc: 'IMF Bz [nT]' },
  { kw: 'SW_VX',                prop: 'vx',               type: 'num',  step: 3,  desc: 'SW Vx [km/s]' },
  { kw: 'SW_N',                 prop: 'nsw',              type: 'num',  step: 3,  desc: 'SW density [cm⁻³]' },
  { kw: 'IMF_BY',               prop: 'by',               type: 'num',  step: 3,  desc: 'IMF By [nT]' },
  { kw: 'IMF_BX',               prop: 'bx',               type: 'num',  step: 3,  desc: 'IMF Bx [nT]' },
  { kw: 'EPOCH',                prop: 'epoch',             type: 'str',  step: 3,  desc: 'Reference epoch' },
  // TS05
  { kw: 'TS05_TILT_RAD',  prop: 'ts05TiltRad', type: 'num', step: 3 },
  { kw: 'TS05_IMFFLAG',   prop: 'ts05ImfFlag', type: 'int', step: 3 },
  { kw: 'TS05_ISWFLAG',   prop: 'ts05SwFlag',  type: 'int', step: 3 },
  { kw: 'TS05_W1', prop: 'ts05W1', type: 'num', step: 3 },
  { kw: 'TS05_W2', prop: 'ts05W2', type: 'num', step: 3 },
  { kw: 'TS05_W3', prop: 'ts05W3', type: 'num', step: 3 },
  { kw: 'TS05_W4', prop: 'ts05W4', type: 'num', step: 3 },
  { kw: 'TS05_W5', prop: 'ts05W5', type: 'num', step: 3 },
  { kw: 'TS05_W6', prop: 'ts05W6', type: 'num', step: 3 },
  // T96
  { kw: 'T96_TILT_DEG',  prop: 't96Tilt',  type: 'num', step: 3 },
  // T01
  { kw: 'T01_TILT_DEG',  prop: 't01Tilt',  type: 'num', step: 3 },
  { kw: 'T01_G1',        prop: 't01G1',    type: 'num', step: 3 },
  { kw: 'T01_G2',        prop: 't01G2',    type: 'num', step: 3 },
  { kw: 'T01_EPOCH',     prop: 't01Epoch', type: 'str', step: 3 },
  // TA15 (Tsyganenko & Andreeva 2015)
  { kw: 'TA15_BX_GSW',   prop: 'ta15Bx',      type: 'num', step: 3 },
  { kw: 'TA15_BY_GSW',   prop: 'ta15By',      type: 'num', step: 3 },
  { kw: 'TA15_BZ_GSW',   prop: 'ta15Bz',      type: 'num', step: 3 },
  { kw: 'TA15_VX_GSE',   prop: 'ta15Vx',      type: 'num', step: 3 },
  { kw: 'TA15_VY_GSE',   prop: 'ta15Vy',      type: 'num', step: 3 },
  { kw: 'TA15_VZ_GSE',   prop: 'ta15Vz',      type: 'num', step: 3 },
  { kw: 'TA15_NP',       prop: 'ta15Np',      type: 'num', step: 3 },
  { kw: 'TA15_T_K',      prop: 'ta15Temp',    type: 'num', step: 3 },
  { kw: 'TA15_SYMH',     prop: 'ta15SymH',    type: 'num', step: 3 },
  { kw: 'TA15_IMF_FLAG', prop: 'ta15ImfFlag', type: 'int', step: 3 },
  { kw: 'TA15_SW_FLAG',  prop: 'ta15SwFlag',  type: 'int', step: 3 },
  { kw: 'TA15_TILT_RAD', prop: 'ta15TiltRad', type: 'num', step: 3 },
  { kw: 'TA15_PDYN',     prop: 'ta15Pdyn',    type: 'num', step: 3 },
  { kw: 'TA15_N_INDEX',  prop: 'ta15Nidx',    type: 'num', step: 3 },
  { kw: 'TA15_B_INDEX',  prop: 'ta15Bidx',    type: 'num', step: 3 },
  { kw: 'TA15_EPOCH',    prop: 'ta15Epoch',   type: 'str', step: 3 },
  // TA16RBF (Tsyganenko & Andreeva 2016 RBF)
  { kw: 'TA16_BX_GSW',   prop: 'ta16Bx',      type: 'num', step: 3 },
  { kw: 'TA16_BY_GSW',   prop: 'ta16By',      type: 'num', step: 3 },
  { kw: 'TA16_BZ_GSW',   prop: 'ta16Bz',      type: 'num', step: 3 },
  { kw: 'TA16_VX_GSE',   prop: 'ta16Vx',      type: 'num', step: 3 },
  { kw: 'TA16_VY_GSE',   prop: 'ta16Vy',      type: 'num', step: 3 },
  { kw: 'TA16_VZ_GSE',   prop: 'ta16Vz',      type: 'num', step: 3 },
  { kw: 'TA16_NP',       prop: 'ta16Np',      type: 'num', step: 3 },
  { kw: 'TA16_T_K',      prop: 'ta16Temp',    type: 'num', step: 3 },
  { kw: 'TA16_SYMH',     prop: 'ta16SymH',    type: 'num', step: 3 },
  { kw: 'TA16_IMF_FLAG', prop: 'ta16ImfFlag', type: 'int', step: 3 },
  { kw: 'TA16_SW_FLAG',  prop: 'ta16SwFlag',  type: 'int', step: 3 },
  { kw: 'TA16_TILT_RAD', prop: 'ta16TiltRad', type: 'num', step: 3 },
  { kw: 'TA16_PDYN',     prop: 'ta16Pdyn',    type: 'num', step: 3 },
  { kw: 'TA16_N_INDEX',  prop: 'ta16Nidx',    type: 'num', step: 3 },
  { kw: 'TA16_B_INDEX',  prop: 'ta16Bidx',    type: 'num', step: 3 },
  { kw: 'TA16_SYMHC',    prop: 'ta16SymHc',   type: 'num', step: 3 },
  { kw: 'TA16_EPOCH',    prop: 'ta16Epoch',   type: 'str', step: 3 },
  // Dipole
  { kw: 'DIPOLE_MOMENT', prop: 'dipoleMoment', type: 'num', step: 3, desc: 'Dipole moment [M_E]' },
  { kw: 'DIPOLE_TILT',   prop: 'dipoleTilt',   type: 'num', step: 3, desc: 'Dipole tilt [deg]' },

  // ═══════ STEP 5: Boundary  (R_INNER,SHUE auto/manual in special cases) ═══════
  { kw: 'BOUNDARY_TYPE',  prop: 'boundaryType', type: 'str',  step: 6 },
  { kw: 'DOMAIN_X_MAX',   prop: 'boxXmax',      type: 'num',  step: 6 },
  { kw: 'DOMAIN_X_MIN',   prop: 'boxXmin',      type: 'num',  step: 6 },
  { kw: 'DOMAIN_Y_MAX',   prop: 'boxYmax',      type: 'num',  step: 6 },
  { kw: 'DOMAIN_Y_MIN',   prop: 'boxYmin',      type: 'num',  step: 6 },
  { kw: 'DOMAIN_Z_MAX',   prop: 'boxZmax',      type: 'num',  step: 6 },
  { kw: 'DOMAIN_Z_MIN',   prop: 'boxZmin',      type: 'num',  step: 6 },

  // ═══════ STEP 6: E-Field  (VS_KP auto/manual in special cases) ═══════
  { kw: 'COROTATION_E',   prop: 'eFieldCoro',      type: 'bool', step: 5 },
  { kw: 'CONV_E_MODEL',   prop: 'eFieldConvModel', type: 'str',  step: 5 },
  { kw: 'VS_GAMMA',       prop: 'vsGamma',         type: 'num',  step: 5 },
  // Time-series E-field driver sources (handled as special cases in B.6b/B.6c below)
  { kw: 'VS_INPUT_MODE',    prop: '__vsInputMode',    type: 'str', step: 7 },
  { kw: 'WEIMER_TS_MODE',   prop: '__weimerTsMode',   type: 'str', step: 7 },

  // ═══════ STEP 7: Temporal  (TS_INPUT_MODE in special cases) ═══════
  { kw: 'TEMPORAL_MODE',    prop: 'tempMode',    type: 'str', step: 7 },
  { kw: 'EVENT_START',      prop: 'eventStart',  type: 'str', step: 7 },
  { kw: 'EVENT_END',        prop: 'eventEnd',    type: 'str', step: 7 },
  { kw: 'FIELD_UPDATE_DT',  prop: 'fieldDt',     type: 'num', step: 7 },
  { kw: 'INJECT_DT',        prop: 'injectDt',    type: 'num', step: 7 },

  // ═══════ STEP 8: Spectrum  (GAMMA1/2,TABLE in special cases) ═══════
  { kw: 'SPECTRUM_TYPE',    prop: 'specType',      type: 'str', step: 8 },
  { kw: 'SPEC_J0',          prop: 'specJ0',        type: 'num', step: 8 },
  { kw: 'SPEC_GAMMA',       prop: 'specGamma',     type: 'num', step: 8 },
  { kw: 'SPEC_E0',          prop: 'specE0',        type: 'num', step: 8 },
  { kw: 'SPEC_EMIN',        prop: 'specEmin',      type: 'num', step: 8 },
  { kw: 'SPEC_EMAX',        prop: 'specEmax',      type: 'num', step: 8 },
  { kw: 'SPEC_EC',          prop: 'specEc',        type: 'num', step: 8 },
  { kw: 'SPEC_LIS_J0',      prop: 'specLisJ0',     type: 'num', step: 8 },
  { kw: 'SPEC_LIS_GAMMA',   prop: 'specLisGamma',  type: 'num', step: 8 },
  { kw: 'SPEC_PHI',         prop: 'specPhi',       type: 'num', step: 8 },

  // ═══════ STEP 9: Output Domain  (POINTS,SHELLS in special cases) ═══════
  { kw: 'OUTPUT_MODE',      prop: 'outputMode',    type: 'str', step: 9 },
  { kw: 'FLUX_DT',          prop: 'fluxDt',        type: 'num', step: 9 },
  { kw: 'POINTS_FRAME',     prop: 'pointsFrame',   type: 'str', step: 9 },
  { kw: 'TRAJ_FRAME',       prop: 'trajFrame',     type: 'str', step: 9 },

  // ═══════ STEP 9 (continued): Output Options ═══════
  { kw: 'FLUX_TYPE',        prop: 'fluxType',      type: 'str',  step: 9 },
  { kw: 'OUTPUT_CUTOFF',    prop: 'outputCutoff',  type: 'bool', step: 9 },
  { kw: 'OUTPUT_PITCH',     prop: 'outputPitch',   type: 'bool', step: 9 },
  { kw: 'OUTPUT_FORMAT',    prop: 'outputFormat',   type: 'str',  step: 9 },
  { kw: 'OUTPUT_COORDS',    prop: 'outputCoords',   type: 'str',  step: 9 },
];


/* ╔═══════════════════════════════════════════════════════════════════════════╗
   ║  §3  STATE APPLICATOR — Apply parsed keywords to global state S         ║
   ╚═══════════════════════════════════════════════════════════════════════════╝
   PHASE A: Registry loop (iterates KEYWORD_MAP — handles ~80% of keywords)
   PHASE B: Special cases (species normalization, arrays, auto/manual, etc.)
*/

/**
 * Apply parsed keywords to the global state object S.
 * @param   {Object} kv  Keyword map from parseParamFile()
 * @returns {Object}     The kv object (may have __bandGamma1/2 added)
 */
function applyParsedState(kv) {

  // ── Type coercion helpers ──
  const num  = (k, fb) => { if (!(k in kv)) { return fb; } const v = parseFloat(kv[k]); return isFinite(v) ? v : fb; };
  const int  = (k, fb) => { if (!(k in kv)) { return fb; } const v = parseInt(kv[k], 10); return isFinite(v) ? v : fb; };
  const str  = (k, fb) => (k in kv) ? kv[k] : fb;
  const bool = (k, fb) => { if (!(k in kv)) { return fb; } const v = kv[k].toUpperCase(); return v === 'T' || v === 'YES' || v === 'TRUE'; };
  const coerce = { num, int, str, bool };

  // ── PHASE A: Registry loop ──
  for (const entry of KEYWORD_MAP) {
    const fn = coerce[entry.type];
    if (fn && (entry.kw in kv)) S[entry.prop] = fn(entry.kw, S[entry.prop]);
  }

  // ── PHASE B: Special cases ──

  // B.1: Species normalization (proton/H+/H → 'proton', etc.)
  const rawSp = str('SPECIES', '').toLowerCase();
  if      (rawSp === 'proton'   || rawSp === 'h+'  || rawSp === 'h')  { S.species = 'proton';   S.charge = 1;  S.mass = 1.0073; }
  else if (rawSp === 'helium'   || rawSp === 'he2+' || rawSp === 'he') { S.species = 'helium';   S.charge = 2;  S.mass = 4.0026; }
  else if (rawSp === 'electron' || rawSp === 'e-'  || rawSp === 'e')  { S.species = 'electron'; S.charge = -1; S.mass = 0.000549; }
  else if (rawSp) { S.species = 'custom'; }
  if ('CHARGE'   in kv) S.charge = int('CHARGE',   S.charge);
  if ('MASS_AMU' in kv) S.mass   = num('MASS_AMU', S.mass);

  // B.2: Sync generic → model-specific drivers (T96, T01)
  S.t96Dst = S.dst;  S.t96Pdyn = S.pdyn;  S.t96By = S.by;  S.t96Bz = S.bz;
  S.t01Dst = S.dst;  S.t01Pdyn = S.pdyn;  S.t01By = S.by;  S.t01Bz = S.bz;

  // B.3: R_INNER → boxRinner or shueRinner (depends on boundaryType)
  if (S.boundaryType === 'BOX') { S.boxRinner = num('R_INNER', S.boxRinner); }
  else { S.shueRinner = num('R_INNER', S.shueRinner); S.xtail = num('DOMAIN_X_TAIL', S.xtail); }

  // B.4: Shue AUTO vs MANUAL detection
  if (S.boundaryType !== 'BOX') {
    const r0Raw = str('SHUE_R0', 'AUTO');
    if (r0Raw.toUpperCase() === 'AUTO') { S.shueMode = 'auto'; S.shueR0 = null; S.shueAlpha = null; }
    else { S.shueMode = 'manual'; S.shueR0 = parseFloat(r0Raw) || null; S.shueAlpha = parseFloat(str('SHUE_ALPHA', '')) || null; }
  }

  // B.5: VS_KP AUTO vs MANUAL
  const vsKpRaw = str('VS_KP', '');
  if (vsKpRaw.toUpperCase() === 'AUTO') S.vsKpMode = 'auto';
  else if (vsKpRaw) { S.vsKpMode = 'manual'; S.vsKp = parseFloat(vsKpRaw) || S.vsKp; }

  // B.6: TS_INPUT_MODE enum mapping (OMNIWEB → 'omni', etc.)
  const tsIn = str('TS_INPUT_MODE', '');
  if      (tsIn === 'OMNIWEB') S.tsSource = 'omni';
  else if (tsIn === 'FILE')    S.tsSource = 'file';
  else if (tsIn === 'SCALAR')  S.tsSource = 'scalar';

  // B.6b: VS_INPUT_MODE — Volland–Stern time-series source
  const vsIn = str('VS_INPUT_MODE', '');
  if      (vsIn === 'OMNIWEB') S.vsEfieldSrc = 'omni';
  else if (vsIn === 'FILE')    S.vsEfieldSrc = 'file';
  else if (vsIn === 'SCALAR')  S.vsEfieldSrc = 'scalar';

  // B.6c: WEIMER_TS_MODE — Weimer time-series source
  const weiIn = str('WEIMER_TS_MODE', '');
  if      (weiIn === 'AUTO')    { S.weimerEfieldSrc = 'scalar'; S.weimerMode = 'auto'; }
  else if (weiIn === 'FILE')    S.weimerEfieldSrc = 'file';
  else if (weiIn === 'OMNIWEB') S.weimerEfieldSrc = 'omni';
  // WEIMER_DRIVE (legacy steady-state key)
  const wDrive = str('WEIMER_DRIVE', '');
  if (wDrive === 'AUTO') S.weimerMode = 'auto';
  else if (wDrive === 'FILE') S.weimerMode = 'file';

  // B.7: Band function gamma1/gamma2 (DOM-only, not stored in S)
  if ('SPEC_GAMMA1' in kv) kv.__bandGamma1 = num('SPEC_GAMMA1', 3.5);
  if ('SPEC_GAMMA2' in kv) kv.__bandGamma2 = num('SPEC_GAMMA2', 1.5);

  // B.8: POINTS block → multiline string + mode override
  if (kv.__POINTS_BLOCK && kv.__POINTS_BLOCK.length > 0) {
    S.pointsText = kv.__POINTS_BLOCK.join('\n');
    S.outputMode = 'POINTS';
  }

  // B.9: SHELLS → array parsing + mode override
  if ('SHELL_COUNT' in kv) {
    S.shellCount  = int('SHELL_COUNT', S.shellCount);
    S.shellResDeg = int('SHELL_RES_DEG', S.shellResDeg);
    const alts = str('SHELL_ALTS_KM', '');
    if (alts) S.shellAltsKm = alts.trim().split(/\s+/).map(Number).filter(isFinite);
    S.outputMode = 'SHELLS';
  }

  // B.10: ENERGY_BINS → space-separated number array
  const binsStr = str('ENERGY_BINS', '');
  if (binsStr) {
    const bins = binsStr.trim().split(/\s+/).map(Number).filter(v => isFinite(v) && v > 0);
    if (bins.length > 0) S.energyBins = bins;
  }

  return kv;
}


/* ╔═══════════════════════════════════════════════════════════════════════════╗
   ║  §4  UI SYNC — Push restored S into all DOM elements                    ║
   ╚═══════════════════════════════════════════════════════════════════════════╝
   Mirrors init() boot sequence.  Every external fn is typeof-guarded.
   @param {Object} [kv]  Parsed kv map (for Band gamma1/2 DOM-only values)
*/
function syncAllUI(kv) {
  kv = kv || {};
  const setVal = (id, val) => { const el = $(id); if (el) el.value = val; };

  // ── Step 2: Calc Mode ──
  const calcCards = { CUTOFF_RIGIDITY:'calc-cutoff-card', DENSITY_SPECTRUM:'calc-densspec-card', DENSITY_3D:'calc-density-card' };
  if (calcCards[S.calcQuantity]) setCalcQuantity(S.calcQuantity, $(calcCards[S.calcQuantity]));
  if (S.fieldMethod === 'GRID_3D') setFieldMethod('GRID_3D', $('fm-grid3d-card'));
  else setFieldMethod('GRIDLESS', $('fm-gridless-card'));
  setVal('grid-nx', S.gridNx); setVal('grid-ny', S.gridNy); setVal('grid-nz', S.gridNz);
  setVal('grid-xmin', S.gridXmin); setVal('grid-xmax', S.gridXmax);
  setVal('grid-ymin', S.gridYmin); setVal('grid-ymax', S.gridYmax);
  setVal('grid-zmin', S.gridZmin); setVal('grid-zmax', S.gridZmax);
  if (typeof gridParamChange === 'function') gridParamChange();
  setVal('cutoff-emin', S.cutoffEmin); setVal('cutoff-emax', S.cutoffEmax);
  setVal('cutoff-max-particles', S.cutoffMaxParticles); setVal('cutoff-nenergy', S.cutoffNenergy);
  setVal('cutoff-max-traj-time', S.cutoffMaxTrajTime);
  if (typeof setCutoffSampling === 'function') setCutoffSampling(S.cutoffSampling || 'VERTICAL');
  const dirmapCb = $('cutoff-dirmap'); if (dirmapCb) dirmapCb.checked = !!S.directionalMap;
  setVal('dirmap-lon-res', S.dirMapLonRes); setVal('dirmap-lat-res', S.dirMapLatRes);
  if (typeof setDirectionalMap === 'function') setDirectionalMap(!!S.directionalMap);
  if (typeof updateDirMapVisibility === 'function') updateDirMapVisibility();
  if (typeof cutoffParamChange === 'function') cutoffParamChange();
  setVal('dens-emin', S.densEmin); setVal('dens-emax', S.densEmax); setVal('dens-nenergy', S.densNenergy);
  const dss = $('dens-energy-spacing'); if (dss) dss.value = S.densEnergySpacing;
  if (typeof densityParamChange === 'function') densityParamChange();
  setVal('ds-emin', S.dsEmin); setVal('ds-emax', S.dsEmax); setVal('ds-nintervals', S.dsNintervals);
  setVal('ds-max-particles', S.dsMaxParticles);
  setVal('ds-max-traj-time', S.dsMaxTrajTime);
  if (typeof setDsSpacing === 'function') setDsSpacing(S.dsEnergySpacing || 'LOG');
  if (typeof dsParamChange === 'function') dsParamChange();

  // ── Step 3: Species + B-Field ──
  if (typeof selectSpecies === 'function') selectSpecies(S.species, $('sp-' + S.species));
  setVal('charge-input', S.charge); setVal('mass-input', S.mass);
  if (typeof selectFieldModel === 'function') selectFieldModel(S.fieldModel);
  setVal('ts05-dst', S.dst); setVal('ts05-pdyn', S.pdyn); setVal('ts05-bz', S.bz);
  setVal('ts05-epoch', S.epoch); setVal('ts05-vx', S.vx); setVal('ts05-nsw', S.nsw);
  setVal('ts05-by', S.by); setVal('ts05-bx', S.bx);
  if (typeof ts05Change === 'function') ts05Change();
  setVal('t96-dst', S.t96Dst); setVal('t96-pdyn', S.t96Pdyn); setVal('t96-bz', S.t96Bz);
  setVal('t96-epoch', S.t96Epoch || S.epoch); setVal('t96-by', S.t96By); setVal('t96-tilt', S.t96Tilt);
  if (typeof t96Change === 'function') t96Change();
  setVal('t01-dst', S.t01Dst); setVal('t01-pdyn', S.t01Pdyn); setVal('t01-bz', S.t01Bz);
  setVal('t01-by', S.t01By); setVal('t01-tilt', S.t01Tilt);
  setVal('t01-g1', S.t01G1); setVal('t01-g2', S.t01G2);
  if (typeof t01Change === 'function') t01Change();
  setVal('ta15-bx-gsw', S.ta15Bx); setVal('ta15-by-gsw', S.ta15By); setVal('ta15-bz-gsw', S.ta15Bz);
  setVal('ta15-vx-gse', S.ta15Vx); setVal('ta15-vy-gse', S.ta15Vy); setVal('ta15-vz-gse', S.ta15Vz);
  setVal('ta15-np', S.ta15Np); setVal('ta15-temp', S.ta15Temp); setVal('ta15-symh', S.ta15SymH);
  setVal('ta15-pdyn', S.ta15Pdyn); setVal('ta15-nidx', S.ta15Nidx); setVal('ta15-bidx', S.ta15Bidx);
  if (typeof ta15Change === 'function') ta15Change();
  setVal('dipole-moment', S.dipoleMoment); setVal('dipole-tilt', S.dipoleTilt);
  if (typeof dipoleChange === 'function') dipoleChange();

  // ── Step 5: Boundary ──
  // IMPORTANT: populate inputs BEFORE bndSet() because bndSet → bndBoxUpdate
  // reads values from the DOM.  If we call bndSet first, it overwrites S with
  // stale DOM defaults.
  if (S.boundaryType === 'BOX') {
    setVal('box-xmax', S.boxXmax); setVal('box-xmin', S.boxXmin);
    setVal('box-ymax', S.boxYmax); setVal('box-ymin', S.boxYmin);
    setVal('box-zmax', S.boxZmax); setVal('box-zmin', S.boxZmin);
    setVal('box-rinner', S.boxRinner);
  } else {
    if (S.shueMode === 'manual') { setVal('shue-r0-in', S.shueR0); setVal('shue-alpha-in', S.shueAlpha); }
    setVal('shue-rinner', S.shueRinner); setVal('shue-xtail', S.xtail);
  }
  if (typeof bndSet === 'function') bndSet(S.boundaryType);
  if (S.boundaryType === 'BOX') {
    if (typeof bndBoxUpdate === 'function') bndBoxUpdate();
  } else {
    if (typeof shueMode === 'function') shueMode(S.shueMode);
    if (typeof bndShueUpdate === 'function') bndShueUpdate();
  }

  // ── Step 6: E-Field ──
  if (typeof setCorotation === 'function') setCorotation(S.eFieldCoro);
  if (typeof setConvModel === 'function') setConvModel(S.eFieldConvModel);
  if (typeof setVsKpMode === 'function') setVsKpMode(S.vsKpMode);
  setVal('vs-kp-input', S.vsKp); setVal('vs-gamma', S.vsGamma);
  if (typeof vsParamChange === 'function') vsParamChange();

  // ── Step 7: E-field driver tab + source toggles (restored from loaded state) ──
  if (typeof updateEfieldDriverTab === 'function') updateEfieldDriverTab(S.eFieldConvModel);
  if (typeof setEfieldDrvSource === 'function') {
    setEfieldDrvSource('vs',     S.vsEfieldSrc     || 'omni');
    setEfieldDrvSource('weimer', S.weimerEfieldSrc || 'omni');
  }

  // ── Step 7: Temporal ──
  if (typeof setTempMode === 'function') setTempMode(S.tempMode);
  if (typeof _adaptDriversToMode === 'function') _adaptDriversToMode(S.tempMode);
  setVal('event-start', S.eventStart); setVal('event-end', S.eventEnd);
  setVal('field-update-dt', S.fieldDt); setVal('inject-dt', S.injectDt);
  if (typeof checkDtPair === 'function') checkDtPair();

  // ── Step 8: Spectrum ──
  const specCards = { POWER_LAW:'sc-pl', POWER_LAW_CUTOFF:'sc-plc', LIS_FORCE_FIELD:'sc-lis', BAND:'sc-band', TABLE:'sc-table' };
  if (specCards[S.specType] && typeof setSpec === 'function') setSpec(S.specType, $(specCards[S.specType]));
  setVal('spec-j0', S.specJ0); setVal('spec-gamma', S.specGamma); setVal('spec-e0', S.specE0);
  setVal('plc-j0', S.specJ0); setVal('plc-gamma', S.specGamma); setVal('plc-e0', S.specE0); setVal('spec-ec', S.specEc);
  setVal('lis-j0', S.specLisJ0); setVal('lis-gamma', S.specLisGamma); setVal('lis-e0', S.specE0); setVal('spec-phi', S.specPhi);
  if (kv.__bandGamma1 != null) setVal('band-gamma1', kv.__bandGamma1);
  if (kv.__bandGamma2 != null) setVal('band-gamma2', kv.__bandGamma2);
  setVal('band-j0', S.specJ0); setVal('band-e0', S.specE0);
  setVal('spec-emin', S.specEmin); setVal('spec-emax', S.specEmax);
  if (typeof drawSpec === 'function') drawSpec();

  // ── Step 9: Output Domain ──
  const modeCards = { POINTS:'mc-points', TRAJECTORY:'mc-traj', SHELLS:'mc-shells' };
  if (modeCards[S.outputMode] && typeof setMode === 'function') setMode(S.outputMode, $(modeCards[S.outputMode]));
  setVal('flux-dt', S.fluxDt); setVal('points-text', S.pointsText || '');
  // Restore POINTS frame selector UI
  if (S.pointsFrame && typeof setPointsFrame === 'function') {
    const pfCards = { GEO:'pf-geo', GSM:'pf-gsm', SM:'pf-sm' };
    setPointsFrame(S.pointsFrame, $(pfCards[S.pointsFrame] || 'pf-geo'));
  }
  // Restore TRAJECTORY frame selector UI
  if (S.trajFrame && typeof setTrajFrame === 'function') {
    const tfCards = { GEO:'tf-geo', GSM:'tf-gsm', SM:'tf-sm' };
    setTrajFrame(S.trajFrame, $(tfCards[S.trajFrame] || 'tf-geo'));
  }
  setVal('shell-count', S.shellCount); setVal('shell-res-deg', S.shellResDeg);
  if (Array.isArray(S.shellAltsKm)) for (let i = 0; i < 5; i++) setVal('shell-alt-' + (i+1), S.shellAltsKm[i] != null ? S.shellAltsKm[i] : '');
  if (typeof updateShells === 'function') updateShells();

  // ── Global refresh ──
  if (typeof dstToKp === 'function') { S.vsKp = S.vsKpMode === 'auto' ? dstToKp(S.dst) : S.vsKp; S.vsA = vsIntensityA(S.vsKp); const d = $('vs-kp-auto-display'); if (d) d.textContent = S.vsKp.toFixed(1); }
  if (typeof drawSvgGrid === 'function') { drawSvgGrid('shue-grid'); drawSvgGrid('box-grid'); }
  if (typeof bndShueUpdate === 'function') bndShueUpdate();
  if (typeof drawEfieldSchematic === 'function') drawEfieldSchematic();
  if (typeof applyFieldMethodConstraints === 'function') applyFieldMethodConstraints();
  if (typeof updateSidebar === 'function') updateSidebar();
  for (let i = 1; i <= 9; i++) S.done.add(i);
}


/* ╔═══════════════════════════════════════════════════════════════════════════╗
   ║  §5  FILE I/O & UX — Modal, drag-drop, paste, toast                    ║
   ╚═══════════════════════════════════════════════════════════════════════════╝
   Pipeline: File/paste → handleTextLoad → parseParamFile → applyParsedState
             → syncAllUI → hideLoadModal → showLoadToast → goStep(1)
*/

/** Show the load-file modal; reset error/paste state. */
function showLoadModal() {
  const m = $('load-modal'); if (m) m.style.display = 'flex';
  const err = $('load-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
  const ta = $('load-paste-area'); if (ta) { ta.style.display = 'none'; ta.value = ''; }
  const ab = $('load-paste-apply'); if (ab) ab.style.display = 'none';
}

/** Hide the load-file modal. */
function hideLoadModal() { const m = $('load-modal'); if (m) m.style.display = 'none'; }

/** Read a File object as text, then hand off to handleTextLoad. */
function handleFileLoad(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => handleTextLoad(e.target.result, file.name);
  reader.readAsText(file);
}

/**
 * Master load handler: validate → parse → apply → sync → navigate.
 * @param {string} text       Raw file contents
 * @param {string} [filename] For toast display
 */
function handleTextLoad(text, filename) {
  if (!text?.trim()) return;
  const loadErr = $('load-error');
  if (loadErr) { loadErr.style.display = 'none'; loadErr.textContent = ''; }

  // Validation: must contain at least one recognized #SECTION header
  if (!/#(RUN_INFO|BACKGROUND_FIELD|PARTICLE|CALCULATION_MODE|END)/i.test(text)) {
    if (loadErr) { loadErr.textContent = 'Not a valid AMPS_PARAM.in file (no #SECTION headers found).'; loadErr.style.display = 'block'; }
    return;
  }

  const kv = parseParamFile(text);
  applyParsedState(kv);
  syncAllUI(kv);
  hideLoadModal();
  showLoadToast(filename || 'AMPS_PARAM.in');
  goStep(1);
}

/** Animated success toast. Auto-removes after 6 seconds. */
function showLoadToast(name) {
  const existing = document.getElementById('load-toast'); if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'load-toast'; toast.className = 'load-toast';
  toast.innerHTML = '<span style="font-size:16px;">✅</span> <b>' + name + '</b> loaded — all wizard steps updated.  <span style="color:var(--text-dim);font-size:11px;">Review each step, then proceed to Submit.</span>';
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 400); }, 6000);
}

/** Initialize drag-drop, file-picker, and paste handlers for the load modal. */
function initLoadUI() {
  const dz = $('load-dropzone'); if (!dz) return;
  dz.addEventListener('dragover',  (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over'); });
  dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-over'); if (e.dataTransfer.files.length > 0) { handleFileLoad(e.dataTransfer.files[0]); } });
  dz.addEventListener('click', () => { const inp = $('load-file-input'); if (inp) { inp.click(); } });
  const fi = $('load-file-input');
  if (fi) fi.addEventListener('change', function() { if (this.files.length > 0) { handleFileLoad(this.files[0]); } this.value = ''; });
  const pb = $('load-paste-btn');
  if (pb) pb.addEventListener('click', () => { const ta = $('load-paste-area'); const ab = $('load-paste-apply'); if (ta) { const show = ta.style.display === 'none'; ta.style.display = show ? 'block' : 'none'; if (ab) { ab.style.display = show ? 'block' : 'none'; } if (show) { ta.focus(); } } });
  const ap = $('load-paste-apply');
  if (ap) ap.addEventListener('click', () => { const ta = $('load-paste-area'); if (ta?.value.trim()) { handleTextLoad(ta.value.trim(), 'pasted_input'); ta.value = ''; } });
}

/* Bootstrap */
document.addEventListener('DOMContentLoaded', function () {
  initLoadUI();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideLoadModal(); });
  const modal = $('load-modal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) hideLoadModal(); });
});
