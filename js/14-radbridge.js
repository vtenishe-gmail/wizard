/*
=====================================================================
FILE: js/14-radbridge.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Bridge between wizard state (S) / loaded output files and
         the RAD computation engine (13-radcalc.js).

  Populates the results object R, which is the single source of truth
  for all visualization panels.

  Two entry points:
    computePreview()       — Context A: derive from S (spectrum + Rc estimate)
    computeFromTimeSeries() — Context B: from arrays (post-run)

PUBLIC API
  R                        — results object (mutable, updated in place)
  computePreview()         — recompute from current wizard state S
  computeFromTimeSeries(spectra, Rcs, times, dt)
  getOperatorBundle()      — structured JSON bundle per Cookbook §5.6
  exportBundleJSON()       — download bundle as .json
  exportBundleCSV()        — download bundle as .csv

DEPENDS ON: 01-state.js (S), 13-radcalc.js (RAD)
LAST UPDATED: 2026-03-06
=====================================================================
*/

/* ═══════════════════════════════════════════════════════════════════
   RESULTS OBJECT — the visualization‐side source of truth.
   ═══════════════════════════════════════════════════════════════════ */

const R = {
  /* Master grid */
  Egrid:  null,   // Float64Array

  /* Unfiltered spectrum */
  j:      null,   // Float64Array  j(E)

  /* Cutoff */
  Rc:     0,      // GV (scalar for preview; array for time series)
  Ec:     0,      // MeV effective cutoff energy

  /* Transmitted */
  jTrans: null,   // Float64Array  j_trans(E)
  fTrans10:  0,   // transmitted fraction for >10 MeV
  fTrans100: 0,

  /* Environment scalars */
  J10:  0,  J100: 0,  J300: 0,  J500: 0,
  H100_10: 0,
  sScale: { S1: false, S2: false, S3: false, S4: false, S5: false, level: 'None' },

  /* Parametric shielding */
  Tset: [0, 5, 10, 20],
  shielded: {},   // keyed by shielding thickness T [g/cm²]; each entry: { j, dose, ddd, neq }

  /* LET */
  letData: {},    // keyed by shielding thickness T [g/cm²]; each entry: { letGrid, dj_dLET }

  /* Spectral fit */
  fit:  { j0: 0, gamma: 0, Estar: Infinity },
  M1:   0,

  /* Time series (post-run) */
  hasTimeSeries: false,
  ts: null,

  /* Meta */
  computedAt: null,       // ISO timestamp of last computation
  mode: 'preview',        // 'preview' | 'postrun'
  caveats: []
};


/* ═══════════════════════════════════════════════════════════════════
   computePreview — Context A: from current wizard state S
   ═══════════════════════════════════════════════════════════════════ */

function computePreview() {

  /* ── 1. Build energy grid ── */
  const Npts  = S.vizEgridN   || 200;
  const Emin  = S.vizEgridMin || 0.1;
  const Emax  = S.vizEgridMax || 1e4;
  R.Egrid = RAD.logGrid(Emin, Emax, Npts);

  /* ── 2. Evaluate source spectrum ── */
  R.j = RAD.evalSpectrum(S, R.Egrid);

  /* ── 3. Estimate Rc from Dst ── */
  const Dst = S.dst || -20;
  const Lshell = 6.6;  // GEO orbit as default; could be trajectory-dependent
  R.Rc = RAD.estimateRc(Dst, Lshell);
  S.vizRcEstimate = R.Rc;
  R.Ec = RAD.cutoffEnergy(R.Rc);

  /* ── 4. Apply step cutoff ── */
  R.jTrans = RAD.transmit(R.j, R.Egrid, R.Rc);

  /* ── 5. Environment-only scalars ── */
  const fluxes = RAD.integralFluxMulti(R.jTrans, R.Egrid, [10, 100, 300, 500]);
  R.J10  = fluxes[10];
  R.J100 = fluxes[100];
  R.J300 = fluxes[300];
  R.J500 = fluxes[500];
  R.H100_10 = (R.J10 > 0) ? R.J100 / R.J10 : 0;
  R.sScale  = RAD.sScale(R.J10);

  /* ── 6. Transmitted fractions ── */
  R.fTrans10  = RAD.transmittedFraction(R.j, R.Egrid, R.Rc, 10);
  R.fTrans100 = RAD.transmittedFraction(R.j, R.Egrid, R.Rc, 100);

  /* ── 7. Parametric shielding ── */
  R.Tset = S.vizShieldingSet || [0, 5, 10, 20];
  R.shielded = {};
  R.letData  = {};

  for (const T of R.Tset) {
    const jS = RAD.csdaDegraded(R.jTrans, R.Egrid, T);
    const fx = RAD.effectsBundle(jS, R.Egrid);
    R.shielded[T] = {
      j:    jS,
      dose: fx.dose,
      ddd:  fx.ddd,
      neq:  fx.neq
    };
    R.letData[T] = fx.let;
  }

  /* ── 8. Spectral fit ── */
  R.fit = RAD.spectralFit(R.jTrans, R.Egrid);
  R.M1  = RAD.energyMoment(R.jTrans, R.Egrid, 1);

  /* ── 9. Meta ── */
  R.computedAt = new Date().toISOString();
  R.mode = 'preview';
  R.hasTimeSeries = false;
  R.caveats = [
    'Transport tier: CSDA (Tier 0). Dose/DDD are thin-target proxies.',
    'Proton-only. GCR heavy ions not included.',
    'Parametric Al-equivalent shielding; no spacecraft geometry.',
    'Rc estimated from Dst (Smart & Shea approximation). Run AMPS for traced values.'
  ];

  /* Trigger dashboard update if dashboard is visible */
  if (typeof renderDashboard === 'function') renderDashboard();
}


/* ═══════════════════════════════════════════════════════════════════
   computeFromTimeSeries — Context B: post-run output arrays
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Compute the full operator product suite from time-resolved data.
 *
 * @param {object} data
 *   data.times    — array of ISO timestamps (or numeric seconds)
 *   data.dt       — uniform time step in seconds
 *   data.spectra  — array of Float64Array, one j(E) per time step
 *   data.Rcs      — Float64Array of cutoff rigidities per step
 *   data.Egrid    — Float64Array energy grid
 */
function computeFromTimeSeries(data) {
  const Nt = data.spectra.length;
  const Egrid = data.Egrid;
  R.Egrid = Egrid;
  R.Tset  = S.vizShieldingSet || [0, 5, 10, 20];

  /* Allocate time-series arrays */
  R.ts = {
    times:  data.times,
    dt:     data.dt,
    J10:    new Float64Array(Nt),
    J100:   new Float64Array(Nt),
    J300:   new Float64Array(Nt),
    J500:   new Float64Array(Nt),
    H:      new Float64Array(Nt),
    Rc:     data.Rcs,
    Ec:     new Float64Array(Nt),
    dose:   {},
    neq:    {}
  };
  for (const T of R.Tset) {
    R.ts.dose[T] = new Float64Array(Nt);
    R.ts.neq[T]  = new Float64Array(Nt);
  }

  /* Per-timestep computation */
  for (let t = 0; t < Nt; t++) {
    const j  = data.spectra[t];
    const Rc = data.Rcs[t];
    const jt = RAD.transmit(j, Egrid, Rc);

    const fluxes = RAD.integralFluxMulti(jt, Egrid, [10, 100, 300, 500]);
    R.ts.J10[t]  = fluxes[10];
    R.ts.J100[t] = fluxes[100];
    R.ts.J300[t] = fluxes[300];
    R.ts.J500[t] = fluxes[500];
    R.ts.H[t]    = (fluxes[10] > 0) ? fluxes[100] / fluxes[10] : 0;
    R.ts.Ec[t]   = RAD.cutoffEnergy(Rc);

    for (const T of R.Tset) {
      const jS = RAD.csdaDegraded(jt, Egrid, T);
      R.ts.dose[T][t] = RAD.doseProxy(jS, Egrid);
      const dddV = RAD.ddd(jS, Egrid);
      R.ts.neq[T][t]  = RAD.neutronEquiv(dddV);
    }
  }

  /* Exceedance statistics */
  R.ts.exceedance10  = RAD.exceedanceDuration(R.ts.J10, data.dt, RAD.S_SCALE.S1);
  R.ts.exceedance100 = RAD.exceedanceDuration(R.ts.J100, data.dt, 1.0);

  /* Use the last timestep as the "current" snapshot for panels */
  const last = Nt - 1;
  R.j      = data.spectra[last];
  R.Rc     = data.Rcs[last];
  R.Ec     = RAD.cutoffEnergy(R.Rc);
  R.jTrans = RAD.transmit(R.j, Egrid, R.Rc);
  R.J10    = R.ts.J10[last];
  R.J100   = R.ts.J100[last];
  R.J300   = R.ts.J300[last];
  R.J500   = R.ts.J500[last];
  R.H100_10 = R.ts.H[last];
  R.sScale  = RAD.sScale(R.J10);
  R.fTrans10  = RAD.transmittedFraction(R.j, Egrid, R.Rc, 10);
  R.fTrans100 = RAD.transmittedFraction(R.j, Egrid, R.Rc, 100);

  R.shielded = {};
  R.letData  = {};
  for (const T of R.Tset) {
    const jS = RAD.csdaDegraded(R.jTrans, Egrid, T);
    const fx = RAD.effectsBundle(jS, Egrid);
    R.shielded[T] = { j: jS, dose: fx.dose, ddd: fx.ddd, neq: fx.neq };
    R.letData[T]  = fx.let;
  }

  R.fit = RAD.spectralFit(R.jTrans, Egrid);
  R.M1  = RAD.energyMoment(R.jTrans, Egrid, 1);

  R.computedAt = new Date().toISOString();
  R.mode = 'postrun';
  R.hasTimeSeries = true;
  R.caveats = [
    'Transport tier: CSDA (Tier 0). Dose/DDD are thin-target proxies.',
    'Proton-only. GCR heavy ions not included.',
    'Parametric Al-equivalent shielding; no spacecraft geometry.'
  ];

  if (typeof renderDashboard === 'function') renderDashboard();
}


/* ═══════════════════════════════════════════════════════════════════
   getOperatorBundle — structured output per Cookbook §5.6
   ═══════════════════════════════════════════════════════════════════ */

function getOperatorBundle() {
  const bundle = {
    meta: {
      runName:        S.runName || 'unnamed',
      piName:         S.piName  || '',
      computedAt:     R.computedAt,
      transport_tier: 'CSDA (Tier 0)',
      mode:           R.mode
    },
    environment: {
      Rc:       R.Rc,
      Ec_MeV:   R.Ec,
      J_gt10:   R.J10,
      J_gt100:  R.J100,
      J_gt300:  R.J300,
      J_gt500:  R.J500,
      H100_10:  R.H100_10,
      S_scale:  R.sScale,
      fit:      R.fit,
      M1:       R.M1,
      fTrans10: R.fTrans10,
      fTrans100: R.fTrans100
    },
    shielding: {
      T_set_gcm2: R.Tset,
      dose_proxy_Si_Gy_per_s: {},
      neq_cm2: {}
    },
    caveats: R.caveats
  };

  for (const T of R.Tset) {
    if (R.shielded[T]) {
      bundle.shielding.dose_proxy_Si_Gy_per_s[T] = R.shielded[T].dose;
      bundle.shielding.neq_cm2[T] = R.shielded[T].neq;
    }
  }

  if (R.hasTimeSeries && R.ts) {
    bundle.exceedance = {
      J_gt10_pfu: {
        total_dt_s:       R.ts.exceedance10.totalDt,
        n_intervals:      R.ts.exceedance10.nIntervals,
        max_duration_s:   R.ts.exceedance10.maxDuration
      },
      J_gt100_pfu: {
        total_dt_s:       R.ts.exceedance100.totalDt,
        n_intervals:      R.ts.exceedance100.nIntervals,
        max_duration_s:   R.ts.exceedance100.maxDuration
      }
    };
  }

  return bundle;
}


/* ═══════════════════════════════════════════════════════════════════
   EXPORT FUNCTIONS
   ═══════════════════════════════════════════════════════════════════ */

function exportBundleJSON() {
  const bundle = getOperatorBundle();
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `AMPS_operator_bundle_${(S.runName || 'run').replace(/\s+/g,'_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportBundleCSV() {
  const b = getOperatorBundle();
  const lines = [
    'Quantity,Value,Unit',
    `Rc,${b.environment.Rc.toFixed(3)},GV`,
    `Ec,${b.environment.Ec_MeV.toFixed(1)},MeV`,
    `J(>10),${b.environment.J_gt10.toExponential(3)},pfu`,
    `J(>100),${b.environment.J_gt100.toExponential(3)},pfu`,
    `J(>300),${b.environment.J_gt300.toExponential(3)},pfu`,
    `J(>500),${b.environment.J_gt500.toExponential(3)},pfu`,
    `H100/10,${b.environment.H100_10.toExponential(3)},`,
    `S-scale,${b.environment.S_scale.level},`,
    `gamma,${b.environment.fit.gamma.toFixed(2)},`,
    `E*,${b.environment.fit.Estar === Infinity ? 'Inf' : b.environment.fit.Estar.toFixed(1)},MeV`,
    `f_trans(>10),${b.environment.fTrans10.toFixed(4)},`,
    `f_trans(>100),${b.environment.fTrans100.toFixed(4)},`
  ];
  for (const T of b.shielding.T_set_gcm2) {
    lines.push(`Dose_T${T},${(b.shielding.dose_proxy_Si_Gy_per_s[T] || 0).toExponential(3)},Gy/s`);
    lines.push(`neq_T${T},${(b.shielding.neq_cm2[T] || 0).toExponential(3)},cm-2`);
  }

  const csv  = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `AMPS_operator_bundle_${(S.runName || 'run').replace(/\s+/g,'_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
