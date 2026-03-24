/*
=====================================================================
FILE: js/13-radcalc.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Pure-function radiation computation library.

  Implements every equation from the "Space Radiation Cookbook" (v2,
  2026-03-05) as stateless functions operating on typed arrays.
  No DOM access — testable and reusable outside the wizard.

SECTIONS
  §1  Constants & embedded NIST PSTAR tables
  §2  Helpers (logGrid, trapz, interpLog, etc.)
  §3  Rigidity–energy conversions (Cookbook Eq. 1)
  §4  Spectrum evaluation
  §5  Environment-only products (Cookbook §2: Eqs. 2–5)
  §6  Parametric shielding / CSDA transport (Cookbook §3: Eq. 6)
  §7  Effects proxies (Cookbook §4: Eqs. 7–11)
  §8  Operator quantities (Cookbook §5: Eqs. 12–15)

DEPENDS ON: nothing (standalone)
LAST UPDATED: 2026-03-06
=====================================================================
*/

/* ═══════════════════════════════════════════════════════════════════
   §1  CONSTANTS & EMBEDDED NIST PSTAR TABLES
   ═══════════════════════════════════════════════════════════════════
   Proton stopping powers and CSDA ranges in aluminum and silicon,
   sourced from NIST PSTAR (public domain).  Log-spaced from 1 MeV
   to 10 000 MeV.  All interpolation is log–log via interpLog().
   ═══════════════════════════════════════════════════════════════════ */

const RAD = {};  // namespace for the radiation calc library

RAD.PROTON_REST_MASS_MEV = 938.272;
RAD.NIEL_1MEV_NEUTRON    = 2.02e-3;   // MeV / (g cm²)
RAD.C_DOSE               = 1.602e-10; // Gy s⁻¹ per (MeV/g)

/* Energy grid for PSTAR tables — 30 points, log-spaced, 1–10000 MeV */
RAD.PSTAR_E = new Float64Array([
  1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 7.0, 10.0, 15.0, 20.0,
  30.0, 40.0, 50.0, 70.0, 100.0, 150.0, 200.0, 300.0, 400.0, 500.0,
  700.0, 1000.0, 1500.0, 2000.0, 3000.0, 4000.0, 5000.0, 7000.0, 10000.0
]);

/* Aluminum: total stopping power [MeV cm²/g] — NIST PSTAR protons in Al */
RAD.AL_SP = new Float64Array([
  15.82, 12.15, 9.915, 7.442, 6.064, 5.165, 4.025, 3.084, 2.262, 1.836,
  1.370, 1.117, 0.9575, 0.7524, 0.5865, 0.4451, 0.3700, 0.2860, 0.2437,
  0.2174, 0.1869, 0.1634, 0.1456, 0.1370, 0.1290, 0.1257, 0.1243, 0.1232, 0.1228
]);

/* Aluminum: CSDA range [g/cm²] — NIST PSTAR protons in Al */
RAD.AL_RNG = new Float64Array([
  0.02313, 0.04555, 0.07462, 0.1488, 0.2450, 0.3618, 0.6488, 1.169, 2.283, 3.662,
  7.094, 11.24, 15.98, 26.87, 47.44, 87.91, 133.5, 233.4, 338.0, 444.6,
  660.1, 1006.0, 1579.0, 2141.0, 3233.0, 4287.0, 5313.0, 7302.0, 10200.0
]);

/* Silicon: total stopping power [MeV cm²/g] — NIST PSTAR protons in Si */
RAD.SI_SP = new Float64Array([
  15.43, 11.87, 9.697, 7.291, 5.944, 5.067, 3.955, 3.037, 2.233, 1.815,
  1.356, 1.106, 0.9492, 0.7466, 0.5826, 0.4429, 0.3685, 0.2854, 0.2434,
  0.2172, 0.1870, 0.1638, 0.1464, 0.1380, 0.1303, 0.1273, 0.1261, 0.1253, 0.1250
]);

/* Silicon: proton NIEL [MeV cm²/g] — from published compilations
   (Messenger et al., IEEE TNS 1999; Jun et al. 2003) */
RAD.SI_NIEL_E = new Float64Array([
  1.0, 2.0, 3.0, 5.0, 7.0, 10.0, 15.0, 20.0, 30.0, 50.0,
  70.0, 100.0, 150.0, 200.0, 300.0, 500.0, 700.0, 1000.0, 2000.0, 5000.0, 10000.0
]);
RAD.SI_NIEL = new Float64Array([
  5.80e-3, 4.60e-3, 3.80e-3, 3.00e-3, 2.60e-3, 2.20e-3, 1.80e-3, 1.55e-3,
  1.25e-3, 9.40e-4, 7.80e-4, 6.30e-4, 5.00e-4, 4.20e-4, 3.30e-4, 2.40e-4,
  2.00e-4, 1.70e-4, 1.20e-4, 8.50e-5, 7.00e-5
]);

/* NOAA SWPC S-scale thresholds: J(>10 MeV) in pfu */
RAD.S_SCALE = {
  S1: 10,
  S2: 100,
  S3: 1000,
  S4: 10000,
  S5: 100000
};


/* ═══════════════════════════════════════════════════════════════════
   §2  HELPERS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Generate a log-spaced Float64Array from 10^(log10(lo)) to 10^(log10(hi)).
 * @param {number} lo  - lower bound (linear)
 * @param {number} hi  - upper bound (linear)
 * @param {number} N   - number of points
 * @returns {Float64Array}
 */
RAD.logGrid = function(lo, hi, N) {
  const arr = new Float64Array(N);
  const lmin = Math.log10(lo);
  const lmax = Math.log10(hi);
  for (let i = 0; i < N; i++) {
    arr[i] = Math.pow(10, lmin + (lmax - lmin) * i / (N - 1));
  }
  return arr;
};

/**
 * Trapezoidal integration of y(x).
 * @param {Float64Array} y
 * @param {Float64Array} x
 * @returns {number}
 */
RAD.trapz = function(y, x) {
  let s = 0;
  for (let i = 1; i < x.length; i++) {
    s += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
  }
  return s;
};

/**
 * Log–log interpolation: given tabulated (xT, yT), return y at xQ.
 * Clamps to table endpoints for out-of-range queries.
 * @param {Float64Array} xT  - x table (ascending)
 * @param {Float64Array} yT  - y table
 * @param {number}       xQ  - query x
 * @returns {number}
 */
RAD.interpLog = function(xT, yT, xQ) {
  const n = xT.length;
  if (xQ <= xT[0])     return yT[0];
  if (xQ >= xT[n - 1]) return yT[n - 1];
  /* Binary search for bracketing interval */
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xT[mid] <= xQ) lo = mid; else hi = mid;
  }
  const lx  = Math.log(xQ);
  const lx0 = Math.log(xT[lo]);
  const lx1 = Math.log(xT[hi]);
  /* Guard against zero / negative y values */
  if (yT[lo] <= 0 || yT[hi] <= 0) {
    const t = (xQ - xT[lo]) / (xT[hi] - xT[lo]);
    return yT[lo] + t * (yT[hi] - yT[lo]);
  }
  const ly0 = Math.log(yT[lo]);
  const ly1 = Math.log(yT[hi]);
  const t   = (lx - lx0) / (lx1 - lx0);
  return Math.exp(ly0 + t * (ly1 - ly0));
};

/**
 * Interpolate entire array: for each element of xArr, interpolate from (xT,yT).
 * @param {Float64Array} xT
 * @param {Float64Array} yT
 * @param {Float64Array} xArr
 * @returns {Float64Array}
 */
RAD.interpLogArray = function(xT, yT, xArr) {
  const out = new Float64Array(xArr.length);
  for (let i = 0; i < xArr.length; i++) {
    out[i] = RAD.interpLog(xT, yT, xArr[i]);
  }
  return out;
};

/**
 * Clamp value between lo and hi.
 */
RAD.clamp = function(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };


/* ═══════════════════════════════════════════════════════════════════
   §3  RIGIDITY – ENERGY CONVERSIONS  (Cookbook Eq. 1)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Kinetic energy [MeV] → rigidity [GV] for protons (Z=1).
 *   R = sqrt(Ek*(Ek + 2*mp*c²)) / 1000
 * @param {number} Ek - kinetic energy in MeV
 * @returns {number} rigidity in GV
 */
RAD.rigidity = function(Ek) {
  const m = RAD.PROTON_REST_MASS_MEV;
  return Math.sqrt(Ek * (Ek + 2 * m)) / 1000.0;
};

/**
 * Rigidity [GV] → kinetic energy [MeV] for protons (inverse of Eq. 1).
 *   Ek = sqrt((R*1000)² + mp²) - mp
 * @param {number} R - rigidity in GV
 * @returns {number} kinetic energy in MeV
 */
RAD.energyFromRigidity = function(R) {
  const m = RAD.PROTON_REST_MASS_MEV;
  const p = R * 1000.0;  // MeV/c
  return Math.sqrt(p * p + m * m) - m;
};

/**
 * Cutoff rigidity → effective cutoff energy.
 * @param {number} Rc - cutoff rigidity in GV
 * @returns {number} Ec in MeV
 */
RAD.cutoffEnergy = function(Rc) {
  return RAD.energyFromRigidity(Rc);
};

/**
 * Compute rigidity for an entire energy array.
 * @param {Float64Array} Egrid
 * @returns {Float64Array} rigidities in GV
 */
RAD.rigidityArray = function(Egrid) {
  const R = new Float64Array(Egrid.length);
  for (let i = 0; i < Egrid.length; i++) R[i] = RAD.rigidity(Egrid[i]);
  return R;
};


/* ═══════════════════════════════════════════════════════════════════
   §4  SPECTRUM EVALUATION
   ═══════════════════════════════════════════════════════════════════
   Evaluate j(E) on a grid using the same formulas as the wizard's
   drawSpec() but returning numeric arrays instead of drawing pixels.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Evaluate the source spectrum on an energy grid.
 *
 * @param {object} params - spectrum parameters (from S or equivalent)
 *   params.specType:   'POWER_LAW'|'POWER_LAW_CUTOFF'|'LIS_FORCE_FIELD'|'BAND'
 *   params.specJ0:     reference flux
 *   params.specGamma:  spectral index
 *   params.specE0:     reference energy [MeV]
 *   params.specEc:     cutoff energy [MeV] (for POWER_LAW_CUTOFF)
 *   params.specPhi:    modulation potential [MV] (for LIS)
 *   params.specLisJ0:  LIS reference flux
 *   params.specLisGamma: LIS spectral index
 * @param {Float64Array} Egrid - energy grid [MeV]
 * @returns {Float64Array} j(E) differential intensity [cm⁻²s⁻¹sr⁻¹MeV⁻¹]
 */
RAD.evalSpectrum = function(params, Egrid) {
  const N = Egrid.length;
  const j = new Float64Array(N);
  const J0    = params.specJ0    || 10000;
  const gamma = params.specGamma || 3.5;
  const E0    = params.specE0    || 10;
  const M     = RAD.PROTON_REST_MASS_MEV;

  for (let i = 0; i < N; i++) {
    const E = Egrid[i];
    switch (params.specType) {

      case 'POWER_LAW_CUTOFF': {
        const Ec = params.specEc || 500;
        j[i] = J0 * Math.pow(E / E0, -gamma) * Math.exp(-E / Ec);
        break;
      }

      case 'LIS_FORCE_FIELD': {
        const phiMeV = (params.specPhi || 550);
        const lisJ0 = params.specLisJ0 || 10000;
        const lisG  = params.specLisGamma || 2.7;
        const Elis  = E + phiMeV;
        const jLIS  = lisJ0 * Math.pow(Elis / E0, -lisG);
        const num   = E * E + 2 * E * M;
        const den   = Elis * Elis + 2 * Elis * M;
        j[i] = jLIS * (num / den);
        break;
      }

      case 'BAND': {
        const g1 = gamma;
        const g2 = params.specGamma2 || (gamma + 1.5);
        const Eb = (g1 - g2) * E0;
        if (Eb > 0 && E < Eb) {
          j[i] = J0 * Math.pow(E / E0, -g1);
        } else if (Eb > 0) {
          const Jb = J0 * Math.pow(Eb / E0, -g1);
          j[i] = Jb * Math.pow(E / Eb, -g2);
        } else {
          j[i] = J0 * Math.pow(E / E0, -gamma);
        }
        break;
      }

      default:  /* POWER_LAW */
        j[i] = J0 * Math.pow(E / E0, -gamma);
        break;
    }
    if (!isFinite(j[i]) || j[i] < 0) j[i] = 0;
  }
  return j;
};


/* ═══════════════════════════════════════════════════════════════════
   §5  ENVIRONMENT-ONLY PRODUCTS  (Cookbook §2)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Step-cutoff geomagnetic transmission (Eq. 5).
 * j_trans(E) = j(E) * 1[R(E) >= Rc]
 *
 * @param {Float64Array} j     - differential spectrum
 * @param {Float64Array} Egrid - energy grid [MeV]
 * @param {number}       Rc    - cutoff rigidity [GV]
 * @returns {Float64Array} transmitted spectrum
 */
RAD.transmit = function(j, Egrid, Rc) {
  const jt = new Float64Array(j.length);
  for (let i = 0; i < j.length; i++) {
    jt[i] = (RAD.rigidity(Egrid[i]) >= Rc) ? j[i] : 0;
  }
  return jt;
};

/**
 * Integral flux above threshold E0 (Eq. 2).
 * J(> E0) = ∫_{E0}^{∞} j(E) dE
 *
 * @param {Float64Array} j     - differential spectrum
 * @param {Float64Array} Egrid - energy grid [MeV]
 * @param {number}       E0    - threshold energy [MeV]
 * @returns {number} integral flux [cm⁻²s⁻¹sr⁻¹]
 */
RAD.integralFlux = function(j, Egrid, E0) {
  /* Find first index where E >= E0 */
  let i0 = 0;
  while (i0 < Egrid.length && Egrid[i0] < E0) i0++;
  if (i0 >= Egrid.length) return 0;

  const subE = Egrid.subarray(i0);
  const subJ = j.subarray(i0);
  return RAD.trapz(subJ, subE);
};

/**
 * Fluence over time window (Eq. 3).
 * Φ(> E0) = ∫ J(> E0, t) dt
 *
 * @param {Float64Array} Jarray - integral flux time series
 * @param {Float64Array} dtArray - time step durations [seconds]
 * @returns {number} fluence [cm⁻²sr⁻¹]
 */
RAD.fluence = function(Jarray, dtArray) {
  let s = 0;
  for (let i = 0; i < Jarray.length; i++) {
    s += Jarray[i] * dtArray[i];
  }
  return s;
};

/**
 * Hardness index H_{100/10} (Eq. 4).
 * @param {Float64Array} j     - differential spectrum
 * @param {Float64Array} Egrid - energy grid [MeV]
 * @returns {number}
 */
RAD.hardness = function(j, Egrid) {
  const j100 = RAD.integralFlux(j, Egrid, 100);
  const j10  = RAD.integralFlux(j, Egrid, 10);
  return (j10 > 0) ? j100 / j10 : 0;
};

/**
 * Batch integral fluxes for multiple thresholds.
 * @param {Float64Array} j
 * @param {Float64Array} Egrid
 * @param {number[]}     thresholds - e.g. [10, 100, 300, 500]
 * @returns {object} { 10: value, 100: value, ... }
 */
RAD.integralFluxMulti = function(j, Egrid, thresholds) {
  const result = {};
  for (const E0 of thresholds) {
    result[E0] = RAD.integralFlux(j, Egrid, E0);
  }
  return result;
};

/**
 * Transmitted fraction (Eq. 13).
 * f_trans(> E0) = J_trans(> E0) / J(> E0)
 */
RAD.transmittedFraction = function(j, Egrid, Rc, E0) {
  const jt = RAD.transmit(j, Egrid, Rc);
  const Jfull  = RAD.integralFlux(j, Egrid, E0);
  const Jtrans = RAD.integralFlux(jt, Egrid, E0);
  return (Jfull > 0) ? Jtrans / Jfull : 0;
};

/**
 * NOAA S-scale evaluation.
 * @param {number} J10 - integral flux J(>10 MeV) in pfu
 * @returns {object} { S1: bool, S2: bool, S3: bool, S4: bool, S5: bool, level: string }
 */
RAD.sScale = function(J10) {
  const r = {
    S1: J10 >= RAD.S_SCALE.S1,
    S2: J10 >= RAD.S_SCALE.S2,
    S3: J10 >= RAD.S_SCALE.S3,
    S4: J10 >= RAD.S_SCALE.S4,
    S5: J10 >= RAD.S_SCALE.S5,
    level: 'None'
  };
  if (r.S5) r.level = 'S5';
  else if (r.S4) r.level = 'S4';
  else if (r.S3) r.level = 'S3';
  else if (r.S2) r.level = 'S2';
  else if (r.S1) r.level = 'S1';
  return r;
};


/* ═══════════════════════════════════════════════════════════════════
   §6  PARAMETRIC SHIELDING — CSDA TRANSPORT  (Cookbook §3, Eq. 6)
   ═══════════════════════════════════════════════════════════════════
   CSDA degraded-spectrum transform for protons in aluminum:
     φ'(E; T) = φ(Ẽ) · (dE/dx)|_{Ẽ} / (dE/dx)|_E
   where Ẽ = E(ρ(E) + T), and ρ(E) is CSDA range.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * CSDA degraded spectrum behind Al-equivalent shielding of thickness T.
 *
 * @param {Float64Array} j     - incident differential spectrum
 * @param {Float64Array} Egrid - energy grid [MeV]
 * @param {number}       T     - areal density [g/cm²]
 * @returns {Float64Array} degraded spectrum on the same Egrid
 */
RAD.csdaDegraded = function(j, Egrid, T) {
  const N = Egrid.length;
  const jDeg = new Float64Array(N);

  if (T <= 0) {
    /* No shielding — identity transform */
    jDeg.set(j);
    return jDeg;
  }

  for (let i = 0; i < N; i++) {
    const E = Egrid[i];

    /* Range of the emerging particle at energy E */
    const rangeE = RAD.interpLog(RAD.PSTAR_E, RAD.AL_RNG, E);

    /* Range of the incident particle: ρ(E) + T */
    const rangeInc = rangeE + T;

    /* Incident energy Ẽ = E(rangeInc) — invert range table */
    const Etilde = RAD.interpLog(RAD.AL_RNG, RAD.PSTAR_E, rangeInc);

    /* If Ẽ exceeds table range, the particle can't reach this energy */
    if (Etilde >= RAD.PSTAR_E[RAD.PSTAR_E.length - 1] * 0.99) {
      jDeg[i] = 0;
      continue;
    }

    /* Stopping powers */
    const dedxE     = RAD.interpLog(RAD.PSTAR_E, RAD.AL_SP, E);
    const dedxEtilde = RAD.interpLog(RAD.PSTAR_E, RAD.AL_SP, Etilde);

    /* Incident flux at Ẽ (interpolate from the incident spectrum) */
    const jInc = RAD.interpLog(Egrid, j, Etilde);

    /* Degraded spectrum */
    if (dedxE > 0 && dedxEtilde > 0 && jInc > 0) {
      jDeg[i] = jInc * (dedxEtilde / dedxE);
    } else {
      jDeg[i] = 0;
    }
  }
  return jDeg;
};

/**
 * Batch: compute shielded spectra for a set of thicknesses.
 * @param {Float64Array} j
 * @param {Float64Array} Egrid
 * @param {number[]}     Tset - e.g. [0, 5, 10, 20]
 * @returns {object} { 0: Float64Array, 5: Float64Array, ... }
 */
RAD.shieldedSpectrumSet = function(j, Egrid, Tset) {
  const result = {};
  for (const T of Tset) {
    result[T] = RAD.csdaDegraded(j, Egrid, T);
  }
  return result;
};


/* ═══════════════════════════════════════════════════════════════════
   §7  EFFECTS PROXIES  (Cookbook §4)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Dose proxy in silicon — thin-target ionizing dose rate (Eq. 7).
 * Ḋ_Si = C · ∫ φ'(E) · S_Si(E) dE
 * where C = 1.602e-10 Gy s⁻¹ per MeV/g and S_Si is mass stopping power.
 *
 * Input j is differential intensity [cm⁻²s⁻¹sr⁻¹MeV⁻¹].
 * We use omnidirectional flux φ ≈ 4π j for isotropic distribution.
 *
 * @param {Float64Array} jShielded - shielded spectrum
 * @param {Float64Array} Egrid     - energy grid [MeV]
 * @returns {number} dose rate [Gy/s]
 */
RAD.doseProxy = function(jShielded, Egrid) {
  const N = Egrid.length;
  const integrand = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const Ssi = RAD.interpLog(RAD.PSTAR_E, RAD.SI_SP, Egrid[i]);
    integrand[i] = jShielded[i] * 4 * Math.PI * Ssi;   // φ = 4π j
  }
  return RAD.C_DOSE * RAD.trapz(integrand, Egrid);
};

/**
 * TID proxy — integrate dose rate over time.
 * @param {Float64Array} doseRates - dose rate at each time step [Gy/s]
 * @param {Float64Array} dtArray   - time step durations [s]
 * @returns {number} total ionizing dose [Gy]
 */
RAD.tidProxy = function(doseRates, dtArray) {
  let tid = 0;
  for (let i = 0; i < doseRates.length; i++) tid += doseRates[i] * dtArray[i];
  return tid;
};

/**
 * LET spectrum (Eq. 8).
 * dφ/dLET = dφ/dE · |dE/dLET|
 * LET(E) ≈ S_Si(E) for protons.
 *
 * @param {Float64Array} jShielded - shielded spectrum (differential intensity)
 * @param {Float64Array} Egrid     - energy grid [MeV]
 * @returns {object} { letGrid: Float64Array, dj_dLET: Float64Array }
 */
RAD.letSpectrum = function(jShielded, Egrid) {
  const N = Egrid.length;
  const letVals = new Float64Array(N);
  const dj = new Float64Array(N);

  /* Compute LET = S_Si(E) for each energy */
  for (let i = 0; i < N; i++) {
    letVals[i] = RAD.interpLog(RAD.PSTAR_E, RAD.SI_SP, Egrid[i]);
  }

  /* Jacobian: |dE/dLET| ≈ 1/|dLET/dE| computed numerically */
  for (let i = 1; i < N - 1; i++) {
    const dLET = letVals[i + 1] - letVals[i - 1];
    const dE   = Egrid[i + 1] - Egrid[i - 1];
    if (Math.abs(dLET) > 0) {
      dj[i] = jShielded[i] * 4 * Math.PI * Math.abs(dE / dLET);
    }
  }
  /* Endpoints: forward/backward difference */
  if (N > 1) {
    const dLET0 = letVals[1] - letVals[0];
    const dE0   = Egrid[1] - Egrid[0];
    if (Math.abs(dLET0) > 0) dj[0] = jShielded[0] * 4 * Math.PI * Math.abs(dE0 / dLET0);
    const dLETn = letVals[N - 1] - letVals[N - 2];
    const dEn   = Egrid[N - 1] - Egrid[N - 2];
    if (Math.abs(dLETn) > 0) dj[N - 1] = jShielded[N - 1] * 4 * Math.PI * Math.abs(dEn / dLETn);
  }

  return { letGrid: letVals, dj_dLET: dj };
};

/**
 * Displacement damage dose DDD (Eq. 9).
 * DDD = ∫ φ'(E) · S_p^Si(E) dE   [MeV/g]
 *
 * @param {Float64Array} jShielded
 * @param {Float64Array} Egrid
 * @returns {number} DDD [MeV/g]
 */
RAD.ddd = function(jShielded, Egrid) {
  const N = Egrid.length;
  const integrand = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const niel = RAD.interpLog(RAD.SI_NIEL_E, RAD.SI_NIEL, Egrid[i]);
    integrand[i] = jShielded[i] * 4 * Math.PI * niel;
  }
  return RAD.trapz(integrand, Egrid);
};

/**
 * 1-MeV neutron equivalent fluence (Eq. 10).
 * n_eq = DDD / S_n^Si(1 MeV)
 *
 * @param {number} dddVal - displacement damage dose [MeV/g]
 * @returns {number} n_eq [cm⁻²]
 */
RAD.neutronEquiv = function(dddVal) {
  return dddVal / RAD.NIEL_1MEV_NEUTRON;
};

/**
 * Compute all effects proxies for a given shielded spectrum.
 * @param {Float64Array} jShielded
 * @param {Float64Array} Egrid
 * @returns {object} { dose, ddd, neq, let: {letGrid, dj_dLET} }
 */
RAD.effectsBundle = function(jShielded, Egrid) {
  const dose  = RAD.doseProxy(jShielded, Egrid);
  const dddV  = RAD.ddd(jShielded, Egrid);
  const neq   = RAD.neutronEquiv(dddV);
  const letS  = RAD.letSpectrum(jShielded, Egrid);
  return { dose: dose, ddd: dddV, neq: neq, let: letS };
};


/* ═══════════════════════════════════════════════════════════════════
   §8  OPERATOR QUANTITIES  (Cookbook §5)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Exceedance duration (Eq. 12).
 * ∆t{ J(>E0) > Jthr }
 *
 * @param {Float64Array} Jts  - time series of integral flux
 * @param {number}       dt   - time step [seconds] (uniform)
 * @param {number}       Jthr - threshold value
 * @returns {object} { totalDt, nIntervals, intervals: [{start, end, duration}], maxDuration, medianDuration }
 */
RAD.exceedanceDuration = function(Jts, dt, Jthr) {
  const intervals = [];
  let inExceedance = false;
  let start = 0;
  let totalDt = 0;

  for (let i = 0; i < Jts.length; i++) {
    const above = Jts[i] >= Jthr;
    if (above && !inExceedance) {
      start = i;
      inExceedance = true;
    } else if (!above && inExceedance) {
      const dur = (i - start) * dt;
      intervals.push({ startIdx: start, endIdx: i - 1, duration: dur });
      totalDt += dur;
      inExceedance = false;
    }
  }
  /* Close open interval */
  if (inExceedance) {
    const dur = (Jts.length - start) * dt;
    intervals.push({ startIdx: start, endIdx: Jts.length - 1, duration: dur });
    totalDt += dur;
  }

  const durations = intervals.map(iv => iv.duration).sort((a, b) => a - b);
  return {
    totalDt: totalDt,
    nIntervals: intervals.length,
    intervals: intervals,
    maxDuration: durations.length ? durations[durations.length - 1] : 0,
    medianDuration: durations.length ? durations[Math.floor(durations.length / 2)] : 0
  };
};

/**
 * Spectral fit: power-law with exponential rollover (Eq. 14).
 * j(E) ≈ j0 · E^(-γ) · exp(-E/E*)
 *
 * Fits in log-space over the provided energy band.
 * Uses simple linear regression on ln(j) = ln(j0) - γ·ln(E) - E/E*.
 *
 * @param {Float64Array} j     - differential spectrum
 * @param {Float64Array} Egrid - energy grid
 * @returns {object} { j0, gamma, Estar }
 */
RAD.spectralFit = function(j, Egrid) {
  /* Filter to non-zero data points */
  const pts = [];
  for (let i = 0; i < j.length; i++) {
    if (j[i] > 0 && Egrid[i] > 0) {
      pts.push({ E: Egrid[i], lnj: Math.log(j[i]), lnE: Math.log(Egrid[i]) });
    }
  }
  if (pts.length < 3) return { j0: 0, gamma: 0, Estar: Infinity };

  /* Least-squares: lnj = a - γ·lnE - (1/E*)·E
     Design matrix: [1, lnE, E] → [a, -γ, -1/E*] */
  const N = pts.length;
  let S1 = 0, SlnE = 0, SE = 0, SlnElnE = 0, SEE = 0, SElnE = 0;
  let Sy = 0, SylnE = 0, SyE = 0;
  for (const p of pts) {
    S1 += 1; SlnE += p.lnE; SE += p.E;
    SlnElnE += p.lnE * p.lnE; SEE += p.E * p.E; SElnE += p.E * p.lnE;
    Sy += p.lnj; SylnE += p.lnj * p.lnE; SyE += p.lnj * p.E;
  }

  /* Solve 3×3 normal equations using Cramer's rule */
  const A = [
    [S1, SlnE, SE],
    [SlnE, SlnElnE, SElnE],
    [SE, SElnE, SEE]
  ];
  const b = [Sy, SylnE, SyE];

  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const D = det3(A);
  if (Math.abs(D) < 1e-30) {
    /* Fallback: simple power-law fit (no rollover) */
    const sumX = SlnE, sumY = Sy, sumXX = SlnElnE, sumXY = SylnE;
    const slope = (N * sumXY - sumX * sumY) / (N * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / N;
    return { j0: Math.exp(intercept), gamma: -slope, Estar: Infinity };
  }

  const replace = (col, v) => A.map((row, i) => row.map((val, ci) => ci === col ? v[i] : val));
  const a0 = det3(replace(0, b)) / D;  // ln(j0)
  const a1 = det3(replace(1, b)) / D;  // -γ
  const a2 = det3(replace(2, b)) / D;  // -1/E*

  const gamma = -a1;
  const Estar = (a2 < 0) ? -1.0 / a2 : Infinity;
  const j0 = Math.exp(a0);

  return {
    j0: isFinite(j0) ? j0 : 0,
    gamma: isFinite(gamma) ? gamma : 0,
    Estar: isFinite(Estar) && Estar > 0 ? Estar : Infinity
  };
};

/**
 * Energy moment (Eq. 15).
 * M_n = ∫ E^n · j(E) dE
 *
 * @param {Float64Array} j
 * @param {Float64Array} Egrid
 * @param {number}       n - moment order (e.g., 1)
 * @returns {number}
 */
RAD.energyMoment = function(j, Egrid, n) {
  const N = Egrid.length;
  const integrand = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    integrand[i] = Math.pow(Egrid[i], n) * j[i];
  }
  return RAD.trapz(integrand, Egrid);
};

/**
 * Empirical Rc estimate from Dst using the Smart & Shea relation.
 * Rc ≈ 14.5 * (1 + Dst/600)  at equator for L≈1.
 * For a given L-shell: Rc ≈ 14.5 / L^2 * (1 + Dst/600).
 * This is a rough screening estimate.
 *
 * @param {number} Dst  - Dst index [nT] (negative for storms)
 * @param {number} L    - L-shell [Earth radii] (default 1, equator)
 * @returns {number} Rc estimate [GV]
 */
RAD.estimateRc = function(Dst, L) {
  L = L || 1.0;
  const rc = (14.5 / (L * L)) * (1 + Dst / 600);
  return Math.max(0, rc);
};
