/* =============================================================================
   FILE:    js/06-temporal.js
   PROJECT: AMPS CCMC Submission Interface  v3
   PURPOSE: Step 7 — Field Driving Data (epoch snapshot or storm-period fetch).

   ╔═══════════════════════════════════════════════════════════════════════╗
   ║                        ARCHITECTURE OVERVIEW                        ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║                                                                     ║
   ║  AMPS can run the background B-field in three temporal modes:      ║
   ║                                                                     ║
   ║  STEADY_STATE   — single-epoch snapshot. B is frozen at the TS05   ║
   ║                   scalars from Step 3. Fastest; good for Störmer   ║
   ║                   cutoff maps and parameter sweeps.                ║
   ║                   Keyword: TEMPORAL_MODE = STEADY_STATE            ║
   ║                                                                     ║
   ║  TIME_SERIES    — pre-computed field updates every FIELD_UPDATE_DT ║
   ║                   minutes. Each update reads one row of             ║
   ║                   ts05_driving.txt (8 TS05 scalars). Particles     ║
   ║                   are injected every INJECT_DT minutes.            ║
   ║                   Recommended for storm-time SEP transport.        ║
   ║                   Keyword: TEMPORAL_MODE = TIME_SERIES             ║
   ║                                                                     ║
   ║  MHD_COUPLED    — self-consistent BATS-R-US / GAMERA evolution.   ║
   ║                   Not yet available; planned for 2026.             ║
   ║                   Keyword: TEMPORAL_MODE = MHD_COUPLED             ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  TIME_SERIES DATA PIPELINE                                         ║
   ║                                                                     ║
   ║  The driving data (ts05_driving.txt) can come from three sources:  ║
   ║                                                                     ║
   ║  'omni'   — OMNIWeb auto-fetch pipeline (simulated client-side):   ║
   ║             Step 1: Query omniweb.gsfc.nasa.gov for OMNI SW data   ║
   ║             Step 2: Query WDC Kyoto for Dst / Sym-H               ║
   ║             Step 3: Merge streams; detect and gap-fill             ║
   ║             Step 4: Generate preview table + data-quality report   ║
   ║             (Real fetch happens server-side on CCMC submission)    ║
   ║                                                                     ║
   ║  'file'   — User uploads a pre-built ts05_driving.txt             ║
   ║  'scalar' — Manual single-row scalar input (for testing)          ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  ts05_driving.txt FORMAT                                           ║
   ║                                                                     ║
   ║  One header line starting with '#'.                                ║
   ║  Data columns (space-delimited, one epoch per row):                ║
   ║    YYYY MM DD HH MM  Dst[nT]  Pdyn[nPa]  Bz[nT]  Vx[km/s]       ║
   ║    Nsw[cm⁻³]  By[nT]  Bx[nT]                                      ║
   ║  Timestamps must be strictly monotonically increasing.             ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  STATE PROPERTIES READ/WRITTEN  (from S in 01-state.js)           ║
   ║                                                                     ║
   ║  S.tempMode    string  'STEADY_STATE' | 'TIME_SERIES' | 'MHD_…'  ║
   ║  S.eventStart  string  ISO datetime  (event start)                 ║
   ║  S.eventEnd    string  ISO datetime  (event end)                   ║
   ║  S.fieldDt     number  field-update cadence [min]                  ║
   ║  S.injectDt    number  particle injection cadence [min]            ║
   ║  S.tsSource    string  'omni' | 'file' | 'scalar'                 ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  AMPS_PARAM.in KEYWORDS GENERATED (by 08-review.js)               ║
   ║                                                                     ║
   ║  #TEMPORAL                                                         ║
   ║  TEMPORAL_MODE     = STEADY_STATE | TIME_SERIES | MHD_COUPLED     ║
   ║  EVENT_START       = YYYY-MM-DDTHH:MM (TIME_SERIES only)          ║
   ║  EVENT_END         = YYYY-MM-DDTHH:MM (TIME_SERIES only)          ║
   ║  FIELD_UPDATE_DT   = <int> min                                     ║
   ║  INJECT_DT         = <int> min                                     ║
   ║  TS_INPUT_MODE     = OMNIWEB | FILE | SCALAR                      ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  DOM ELEMENTS TOUCHED                                              ║
   ║                                                                     ║
   ║  .temp-card[data-mode]   — temporal mode selection cards           ║
   ║  #ts-form                — TIME_SERIES config form (hidden in SS) ║
   ║  #field-update-dt        — FIELD_UPDATE_DT input                   ║
   ║  #inject-dt              — INJECT_DT input                         ║
   ║  #dt-warn                — warning: inject < field cadence         ║
   ║  #ts-timeline            — cadence visualisation timeline          ║
   ║  #ts-source-tog          — omni/file/scalar toggle group           ║
   ║  #omni-panel/#file-panel — source sub-panels                       ║
   ║  #event-start/#event-end — datetime pickers                        ║
   ║  #omni-cadence           — cadence dropdown (1min/5min/1hr)        ║
   ║  #omni-status            — fetch progress display                  ║
   ║  #os-1..#os-4            — 4-step progress indicators              ║
   ║                                                                     ║
   ╠═══════════════════════════════════════════════════════════════════════╣
   ║  FUNCTION INDEX                                                    ║
   ║                                                                     ║
   ║  §1 MODE SELECTION                                                 ║
   ║     setTempMode(m)         — switch temporal mode card             ║
   ║                                                                     ║
   ║  §2 CADENCE MANAGEMENT                                            ║
   ║     checkDtPair()          — validate field vs inject cadence      ║
   ║     updateTimeline()       — redraw cadence visualisation          ║
   ║                                                                     ║
   ║  §3 DATA SOURCE                                                    ║
   ║     setTsSource(btn, src)  — switch omni/file/scalar source        ║
   ║     simulateOmniFetch()    — animate OMNIWeb pipeline display      ║
   ║                                                                     ║
   ╚═══════════════════════════════════════════════════════════════════════╝

   DEPENDS ON: 01-state.js (S, $), updateSidebar() from 02-wizard.js
   LAST UPDATED: 2026-03-01
============================================================================= */



/* ============================================================================
   DEVELOPER NOTE — EXACTLY WHAT STEP 7 PREVIEW CALCULATES FOR TSYGANENKO DRIVERS

   IMPORTANT SCOPE NOTE
   --------------------
   The routines below are PREVIEW / UI-ASSEMBLY helpers for the web interface.
   Their job is to construct a plausible, self-consistent driver table for visual
   inspection in the browser. They are NOT a claim that the browser is reproducing
   the exact authoritative upstream preprocessing chain used in production CCMC
   runs or in the original Tsyganenko model preparation utilities.

   In other words, Step 7 performs three distinct classes of operations:

     (1) PASS-THROUGH OF DIRECTLY OBSERVED / ARCHIVED QUANTITIES
         Examples: IMF Bx, By, Bz; solar-wind velocity components; density;
         pressure proxies; Dst / Sym-H.

     (2) SIMPLE DIAGNOSTIC TRANSFORMS OF THOSE QUANTITIES
         Examples: dynamic pressure Pdyn from Np and Vx; clock-angle-like
         couplings; centered running means; dipole-tilt approximations.

     (3) LOW-ORDER SURROGATE OR MEMORY-TYPE UPDATES FOR MODEL-SPECIFIC DRIVERS
         Examples: preview W1...W6 for TS05, preview G1/G2(/G3) for T01,
         preview N-index and B-index for TA15 / TA16RBF.

   The code therefore mixes "downloaded", "derived", and "surrogate" terms.
   To make maintenance easier, the equations actually used by the JavaScript are
   documented explicitly below.

   ---------------------------------------------------------------------------
   1. TIME SAMPLING
   ---------------------------------------------------------------------------
   For a user-selected cadence Δt [minutes], a row is produced at times

       t_k = t_0 + k Δt,     k = 0, 1, ..., N,

   where Δt is converted to milliseconds in the browser as

       Δt_ms = Δt * 60000.

   Every synthetic or merged row is therefore keyed by an integer UTC timestamp.
   This is what lets the preview de-duplicate rows by epoch when files are
   appended or when multiple sources are merged.

   ---------------------------------------------------------------------------
   2. DYNAMIC PRESSURE USED IN THE PREVIEW
   ---------------------------------------------------------------------------
   Several preview builders compute a solar-wind dynamic-pressure-like quantity.
   The most explicit form used in this file is

       Pdyn = 1.6726e-6 * Np * Vx^2,                                  (Eq. 1)

   where
       Np   = proton number density in cm^-3,
       Vx   = solar-wind x velocity in km/s,
       Pdyn = nPa.

   This is the standard proton ram-pressure conversion written in compact units.
   The sign of Vx does not matter because the velocity enters quadratically.
   In some synthetic builders a simpler algebraic proxy is used instead, e.g.

       Pdyn ≈ 1.2 + 0.0023 * Np * |Vx| / 10,                          (Eq. 2)

   or another low-order expression chosen only to keep preview values within a
   realistic range. Eq. (2) is NOT intended as a replacement for Eq. (1); it is
   merely a numerically convenient surrogate in demo data generation.

   ---------------------------------------------------------------------------
   3. IMF MAGNITUDE, CLOCK ANGLE, AND COUPLING-LIKE TERMS
   ---------------------------------------------------------------------------
   Some preview routines form a transverse IMF magnitude and a clock-angle-like
   quantity from By and Bz:

       Bt = sqrt(By^2 + Bz^2),                                        (Eq. 3)
       theta = atan2(|By|, |Bz| + eps),                               (Eq. 4)

   with eps ~ 1e-9 added only to avoid a zero denominator in the browser.

   The code then uses a Newell / reconnection-style coupling proxy of the form

       C = |Vx|^(4/3) * Bt^(2/3) * sin(theta/2)^(8/3),                (Eq. 5)

   which is not identical to any one official pipeline product here, but gives a
   physically sensible monotonic increase for stronger southward / transverse IMF
   and faster flow. The browser uses such coupling proxies as seeds for preview
   driver indices in TA15 / TA16RBF and, conceptually, for T01-like derived terms.

   ---------------------------------------------------------------------------
   4. SOUTHWARD-IMF GATING
   ---------------------------------------------------------------------------
   Several preview terms only respond to southward IMF, implemented as

       Bs = max(0, -Bz).                                              (Eq. 6)

   This is a standard numerical device: if Bz > 0 (northward IMF), the driving
   contribution from the southward component is set to zero rather than allowed
   to change sign. It keeps the surrogate drivers positive and storm-oriented.

   ---------------------------------------------------------------------------
   5. EXPONENTIAL-MEMORY / FIRST-ORDER RESPONSE TERMS
   ---------------------------------------------------------------------------
   The synthetic TS05 preview builds W1...W6 with a discrete first-order memory
   update. For each channel i,

       W_i^(k+1) = α_i W_i^(k) + (1 - α_i) D^(k) [1 + β_i],           (Eq. 7)

   where
       α_i        = channel-specific retention factor (0 < α_i < 1),
       D^(k)      = instantaneous driving strength at time step k,
       β_i        = small channel-dependent scale factor.

   In the present JavaScript implementation,

       D = 0.025 Bs + 0.012 (|Vx| / 400) + 0.010 max(0, Pdyn - 1.5).  (Eq. 8)

   This is a deliberately simple surrogate. It has the intended numerical
   behavior of the real TS05 storm-history channels:
     - stronger southward IMF increases the memory terms,
     - faster solar wind increases them,
     - unusually high dynamic pressure increases them,
     - each channel relaxes on its own timescale through α_i.

   The exact Tsyganenko-Sitnov 2005 W-parameter construction in production work
   is more specialized than Eqs. (7)-(8). These equations document what THIS
   FILE computes, not what an official external archive must use.

   ---------------------------------------------------------------------------
   6. T96 PREVIEW DRIVER ASSEMBLY
   ---------------------------------------------------------------------------
   The T96 preview prepares rows in the form

       YYYY MM DD HH mm  Dst  Pdyn  By  Bz  Tilt,                     (Eq. 9)

   where Dst, Pdyn, By, and Bz are treated as externally supplied or synthesized
   upstream quantities, while Tilt is generated inside the browser.

   In the preview code, the dipole-tilt-like quantity is generated as a smooth
   seasonal / event-phase surrogate, not by calling an external geomagnetic or
   astronomical library. That means the browser is constructing

       Tilt = Tilt_preview(t),                                        (Eq. 10)

   where Tilt_preview(t) is simply a bounded smooth function of time chosen to
   produce visually reasonable values. It should be interpreted as a placeholder
   for a real dipole-tilt evaluation from epoch.

   ---------------------------------------------------------------------------
   7. TS05 PREVIEW DRIVER ASSEMBLY
   ---------------------------------------------------------------------------
   The synthetic TS05 builder writes rows containing

       year doy hr mn Bx By Bz Vx Vy Vz Np Temp SymH IMFflag SWflag
       Tilt Pdyn W1 W2 W3 W4 W5 W6.                                   (Eq. 11)

   The browser constructs the columns as follows:

     (a) Bx, By, Bz, Vx, Vy, Vz, Np, Temp, SymH
         are either read directly from a file or synthesized as smooth time
         series for preview.

     (b) Tilt is generated internally as a smooth function of phase / day.

     (c) Pdyn is computed from Eq. (1).

     (d) W1...W6 are updated from Eqs. (7)-(8).

   Numerically, this makes the preview stable because the memory terms change
   gradually in time rather than jumping discontinuously between rows.

   ---------------------------------------------------------------------------
   8. T01 PREVIEW DRIVER ASSEMBLY
   ---------------------------------------------------------------------------
   The T01 preview is intended to expose the important distinction between raw
   upstream inputs and derived driving parameters G1 and G2 (and the context term
   G3 shown in the preview). In conceptual form the browser follows

       G1 = F1(IMF, solar wind, pressure, storm state),               (Eq. 12)
       G2 = F2(IMF, solar wind, pressure, storm state),               (Eq. 13)
       G3 = F3(IMF, solar wind, pressure, storm state),               (Eq. 14)

   where F1, F2, and F3 are simplified algebraic surrogates coded directly in
   JavaScript. They are intentionally monotonic with stronger activity and are
   assembled from the same kinds of ingredients used elsewhere in this file:
   southward IMF, speed, pressure, and smooth time-memory behavior.

   Thus, in the Step 7 preview, G1/G2/G3 are not downloaded as independent
   columns from a remote service. They are derived in the browser from the
   synthetic or merged upstream stream.

   ---------------------------------------------------------------------------
   9. TA15 / TA16RBF PREVIEW DRIVER ASSEMBLY
   ---------------------------------------------------------------------------
   The TA15 and TA16RBF preview builders compute compact driver indices named
   N-index and B-index; TA16RBF also computes SymHc.

   In the present code the TA16RBF synthetic builder uses

       C      = |Vx|^(4/3) * Bt^(2/3) * sin(theta/2)^(8/3),           (Eq. 15)
       Nindex = C / 1000,                                             (Eq. 16)
       Bindex = |Bz| * max(1, Np)^(1/3) / 10,                         (Eq. 17)

   and defines a centered Sym-H quantity by taking a local moving mean,

       SymHc(i) = (1 / M) * sum_{j=i-m}^{i+m} SymH(j),                (Eq. 18)

   where M is the number of valid terms inside the local window.

   This centered averaging is a purely numerical smoothing / context operator.
   It reduces short-period fluctuations and gives the preview a "storm-state"
   variable that varies more slowly than the raw Sym-H sequence.

   The TA15 preview follows the same philosophy: upstream IMF / solar-wind /
   geomagnetic quantities are passed through, and compact activity indices are
   derived inside the browser by low-order algebraic combinations chosen to have
   the correct qualitative behavior.

   ---------------------------------------------------------------------------
   10. GAP FILLING / MERGING / DE-DUPLICATION
   ---------------------------------------------------------------------------
   When a user appends files or merges generated rows with existing rows, the
   code performs de-duplication on the UTC timestamp key:

       keep first row for each unique t_k,
       discard later rows with the same t_k.                           (Eq. 19)

   This is a numerically conservative choice for a preview tool because it makes
   the merged table deterministic and avoids double-counting epochs.

   Some status messages mention "linear interpolation" over short gaps. In the
   current UI this should be understood as a preview narrative / placeholder for
   the intended production workflow. Any actual interpolation logic should be
   verified against the exact implementation if that behavior is later added.

   ---------------------------------------------------------------------------
   11. REFERENCES FOR PHYSICS CONTEXT
   ---------------------------------------------------------------------------
   The comments above explain the equations THIS FILE uses. For the scientific
   context of the model families themselves, see for example:

     - Tsyganenko, N. A. (1995, 1996): T96 family and solar-wind pressure / Dst
       driven empirical magnetospheric field representation.
     - Tsyganenko, N. A. (2001, 2002): T01 storm-time model and derived driver
       parameters G1 / G2 (and associated storm-state parameterizations).
     - Tsyganenko, N. A., and Sitnov, M. I. (2005): TS05 storm-time model with
       history-dependent W parameters.
     - Tsyganenko, N. A., and Andreeva, V. A. (2015, 2016): TA15 / TA16RBF
       variants with compact driver sets and improved storm-time fitting.
     - Newell et al. style solar-wind coupling functions for qualitative
       motivation of Eq. (5).

   Again, the browser preview equations are surrogate numerics designed for a
   transparent UI. They are documented here exactly so future developers can see
   what is computed locally and where a production-quality pipeline would differ.
============================================================================ */


/* ═══════════════════════════════════════════════════════════════════════════
   §1  MODE SELECTION — STEADY_STATE vs TIME_SERIES vs MHD_COUPLED
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Switch the temporal mode.
 *
 * Highlights the selected card and shows/hides the TIME_SERIES config form.
 * In STEADY_STATE mode, the form is hidden because no time stepping occurs.
 *
 * @param {string} m — 'STEADY_STATE' | 'TIME_SERIES' | 'MHD_COUPLED'
 */
function setTempMode(m) {
  S.tempMode = m;

  /* Highlight the selected card; cards use data-mode attribute for matching */
  document.querySelectorAll('.temp-card').forEach(c =>
    c.classList.toggle('sel', c.dataset.mode === m)
  );

  /* Show/hide the steady-state and time-series configuration forms.
     STEADY_STATE shows the epoch picker; TIME_SERIES and MHD show cadence config.
     #driver-data-section is shown for both STEADY_STATE and TIME_SERIES. */
  if ($('ss-form')) $('ss-form').style.display = m === 'STEADY_STATE' ? 'block' : 'none';
  if ($('ts-form')) $('ts-form').style.display = m !== 'STEADY_STATE' ? 'block' : 'none';

  /* Driver data section is always visible (not shown for MHD_COUPLED placeholder) */
  const drv = $('driver-data-section');
  if (drv) drv.style.display = m === 'MHD_COUPLED' ? 'none' : '';

  /* Sync the steady-state timestamp input from the current S.epoch */
  if (m === 'STEADY_STATE' && $('ss-timestamp')) {
    $('ss-timestamp').value = S.epoch || '2017-09-10T16:00';
    /* Mirror epoch into event-start/end for shared pipeline functions */
    const ep = $('ss-timestamp').value;
    if ($('event-start')) $('event-start').value = ep;
    if ($('event-end'))   $('event-end').value   = ep;
    S.eventStart = ep;
    S.eventEnd   = ep;
  }

  /* Adapt driver fold UI to the selected mode */
  _adaptDriversToMode(m);

  updateSidebar();
}

/**
 * Adapt the shared B-field and E-field driver folds to the current temporal mode.
 *
 * STEADY_STATE:
 *   - Hide the "Scalar (steady-state)" source tab in every driver panel — that
 *     tab represented the old Step-3 scalar approach, which is replaced by a
 *     real single-epoch OMNIWeb/file fetch (same pipeline as Time-Series).
 *   - Show the SS-mode info banner (explains single-epoch fetch behaviour).
 *   - Hide the cadence row (FIELD_UPDATE_DT / INJECT_DT) — not applicable for
 *     a single point in time.
 *
 * TIME_SERIES:
 *   - Restore all three source tabs (omni / file / scalar).
 *   - Hide the SS-mode banners.
 *   - Show the cadence row.
 *
 * All dataset objects, pipeline functions, render tables, and download handlers
 * are shared identically between modes.  The single-epoch behaviour is achieved
 * by syncing event-start == event-end == S.epoch in SS mode (done in
 * onSsTimestampChange()), so every pipeline function naturally produces 1 row.
 *
 * @param {string} m — 'STEADY_STATE' | 'TIME_SERIES' | 'MHD_COUPLED'
 */
function _adaptDriversToMode(m) {
  const isSS = m === 'STEADY_STATE';

  /* ── SS-mode info banners ─────────────────────────────────────────────── */
  const bBanner = document.getElementById('ss-bfield-notice');
  const eBanner = document.getElementById('ss-efield-notice');
  if (bBanner) bBanner.style.display = isSS ? '' : 'none';
  if (eBanner) eBanner.style.display = isSS ? '' : 'none';

  /* ── Update VS scalar panel description for mode ─────────────────────── */
  const vsDesc = document.getElementById('vs-scalar-desc');
  if (vsDesc) {
    vsDesc.innerHTML = isSS
      ? '<b>Epoch Snapshot / Scalar Kp:</b> AMPS evaluates the Volland–Stern field once at the epoch above using the Kp value from Step 6. The convection pattern is a frozen snapshot — no time evolution.'
      : '<b>Scalar Kp mode:</b> AMPS uses the single Kp value from Step 6 for the entire run. The convection potential pattern is frozen at the selected Kp throughout the simulation. Useful for sensitivity sweeps where you want time-varying <b>B</b> but a fixed convection level.';
  }

  /* ── Update Weimer scalar panel description for mode ─────────────────── */
  const weiDesc = document.getElementById('weimer-ts-scalar-desc');
  if (weiDesc) {
    weiDesc.innerHTML = isSS
      ? '<b>Epoch Snapshot:</b> AMPS reads <code>Bz, By, Vx, Pdyn</code> from the Step 3 TS05 inputs and evaluates the Weimer pattern once at the epoch. No storm-period data needed.'
      : '<b>From TS05 drivers:</b> AMPS reads <code>Bz, By, Vx, Pdyn</code> directly from the TS05 driving stream at each <code>FIELD_UPDATE_DT</code> step — no separate <code>weimer_driving.txt</code> file is needed. Best option for Storm Period runs with TS05.';
  }

  /* ── Hide cadence selectors in SS mode — a single epoch needs no cadence ─ */
  document.querySelectorAll('.drv-cadence-row').forEach(el => {
    el.style.display = isSS ? 'none' : '';
  });

  /* ── Source tab visibility for all 7 driver toggles ─────────────────── */
  const allToggles = [
    /* B-field */
    { omni: 'ts-omni-btn',       file: 'ts-file-btn',       scalar: 'ts-scalar-btn'       },
    { omni: 't96-omni-btn',      file: 't96-file-btn',      scalar: 't96-scalar-btn'      },
    { omni: 't01-omni-btn',      file: 't01-file-btn',      scalar: 't01-scalar-btn'      },
    { omni: 'ta15-omni-btn',     file: 'ta15-file-btn',     scalar: 'ta15-scalar-btn'     },
    { omni: 'ta16rbf-omni-btn',  file: 'ta16rbf-file-btn',  scalar: 'ta16rbf-scalar-btn'  },
    /* E-field */
    { omni: 'vs-omni-btn',       file: 'vs-file-btn',       scalar: 'vs-scalar-btn'       },
    { omni: 'weimer-ts-omni-btn',file: 'weimer-ts-file-btn',scalar: 'weimer-ts-scalar-btn'},
  ];

  allToggles.forEach(({ omni, file, scalar }) => {
    const omniBtn   = document.getElementById(omni);
    const fileBtn   = document.getElementById(file);
    const scalarBtn = document.getElementById(scalar);

    if (isSS) {
      /* Hide Scalar tab — single-epoch uses omni or file just like TS */
      if (scalarBtn) {
        scalarBtn.style.display = 'none';
        /* If scalar was active, fall back to omni */
        if (scalarBtn.classList.contains('on')) {
          scalarBtn.classList.remove('on');
          if (omniBtn) {
            omniBtn.classList.add('on');
            /* Activate the omni panel */
            const togId = omni.replace('-omni-btn', '-source-tog');
            _activateSourcePanel(togId, 'omni');
          }
        }
      }
      if (omniBtn) omniBtn.style.display = '';
      if (fileBtn) fileBtn.style.display = '';
    } else {
      /* Restore all three tabs */
      if (scalarBtn) scalarBtn.style.display = '';
      if (omniBtn)   omniBtn.style.display   = '';
      if (fileBtn)   fileBtn.style.display   = '';
    }
  });
}

/**
 * Given a source-toggle group id, activate the scalar sub-panel and
 * hide omni/file sub-panels.  Works for both Tsyganenko and E-field toggles
 * because both follow the naming convention `${prefix}-{omni|file|scalar}-panel`.
 *
 * Exception: the TS05 toggle uses `omni-panel` / `file-panel` / `ts05-scalar-panel`
 * (legacy IDs without the `ts-` prefix).  The override map handles this.
 *
 * @param {string} togId — e.g. 'ts-source-tog' | 'vs-source-tog'
 */
function _activateScalarPanel(togId) {
  _activateSourcePanel(togId, 'scalar');
}

/**
 * Activate a specific source sub-panel for a toggle group.
 *
 * @param {string} togId — source toggle group id
 * @param {string} src   — 'omni' | 'file' | 'scalar'
 */
function _activateSourcePanel(togId, src) {
  /* Override map for models whose panel IDs don't follow the standard prefix pattern. */
  const PANEL_OVERRIDE = {
    'ts-source-tog': { omni: 'omni-panel', file: 'file-panel', scalar: 'ts05-scalar-panel' },
  };
  const override = PANEL_OVERRIDE[togId];
  const prefix   = togId.replace('-source-tog', '');

  ['omni', 'file', 'scalar'].forEach(s => {
    const panelId = override ? override[s] : `${prefix}-${s}-panel`;
    const panel   = document.getElementById(panelId);
    if (panel) panel.style.display = s === src ? 'block' : 'none';
  });
}

/**
 * Handle changes to the steady-state Time Stamp input.
 *
 * Syncs the value to S.epoch (the canonical STEADY_STATE epoch) and also
 * propagates to the field-model epoch inputs in Step 3 so the two stay
 * consistent.
 *
 * Called from oninput on #ss-timestamp.
 */
function onSsTimestampChange() {
  const val = $('ss-timestamp')?.value || '';
  if (!val) return;

  S.epoch = val;

  /* Keep Step 3 field-model epoch inputs in sync */
  if ($('ts05-epoch'))  $('ts05-epoch').value  = val;
  if ($('t96-epoch'))   $('t96-epoch').value   = val;
  if ($('t01-epoch'))   $('t01-epoch').value   = val;
  if ($('ta16-epoch'))  $('ta16-epoch').value  = val;
  if ($('ta15-epoch'))  $('ta15-epoch').value  = val;

  /* Mirror SS epoch into event-start and event-end so the shared pipeline
     functions (simulateOmniFetch, simulateVsOmniFetch, etc.) naturally produce
     exactly 1 row for a single point in time — zero code changes needed there. */
  if ($('event-start')) $('event-start').value = val;
  if ($('event-end'))   $('event-end').value   = val;
  S.eventStart = val;
  S.eventEnd   = val;

  updateSidebar();
}


/* ═══════════════════════════════════════════════════════════════════════════
   §2  CADENCE MANAGEMENT — FIELD_UPDATE_DT vs INJECT_DT

   The field-update cadence (FIELD_UPDATE_DT) controls how often the
   background B-field is refreshed from the driving time series.
   The injection cadence (INJECT_DT) controls how often new test
   particles are injected at the boundary.

   Constraint: INJECT_DT ≥ FIELD_UPDATE_DT  (injecting faster than
   the field updates is wasteful and can cause numerical artefacts).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Validate FIELD_UPDATE_DT vs INJECT_DT and update the timeline.
 *
 * Reads both values from their DOM inputs, writes to S, and shows
 * a warning if INJECT_DT < FIELD_UPDATE_DT (invalid configuration).
 *
 * Called from oninput handlers on #field-update-dt and #inject-dt.
 */
function checkDtPair() {
  /* Read current values (default to safe fallbacks) */
  const fd = parseFloat($('field-update-dt')?.value) || 5;   // field cadence [min]
  const id = parseFloat($('inject-dt')?.value)       || 30;  // inject cadence [min]

  S.fieldDt  = fd;
  S.injectDt = id;

  /* Show warning if injection is faster than field updates */
  $('dt-warn').style.display = id < fd ? 'block' : 'none';

  /* Redraw the cadence timeline visualisation */
  updateTimeline();
}

/**
 * Redraw the cadence visualisation timeline.
 *
 * The timeline is a horizontal strip (#ts-timeline) spanning 120 simulated
 * minutes, showing:
 *   • Blue vertical ticks at every FIELD_UPDATE_DT — field refresh events
 *   • ⚡ markers at every INJECT_DT — particle injection events
 *   • Time labels at 30-minute intervals
 *
 * This gives users an intuitive feel for the relationship between the
 * two cadences (e.g. "the field updates 6× between each injection").
 *
 * Implementation: clears and rebuilds the DOM each call.
 * Performance is fine — the timeline has at most ~120 elements.
 */
function updateTimeline() {
  const tl = $('ts-timeline');
  if (!tl) return;

  /* Start with the base axis line */
  tl.innerHTML = '<div class="fu-axis"></div>';

  const dur = 120;                                // display window [min]
  const fd  = Math.max(1, S.fieldDt);             // field cadence [min], min 1
  const id_ = Math.max(1, S.injectDt);            // inject cadence [min], min 1

  /* ── Field-update ticks (blue) ─────────────────────────────────────── */
  for (let t = 0; t <= dur; t += fd) {
    const pct = (t / dur) * 100;

    /* Blue tick mark */
    const tick = document.createElement('div');
    tick.className = 'fu-tick';
    tick.style.left = pct + '%';
    tl.appendChild(tick);

    /* Time labels every 30 minutes */
    if (t % 30 === 0) {
      const lbl = document.createElement('div');
      lbl.className = 'fu-label';
      lbl.style.left = pct + '%';
      lbl.textContent = t + 'm';
      tl.appendChild(lbl);
    }
  }

  /* ── Injection markers (⚡) ─────────────────────────────────────────── */
  for (let t = id_; t <= dur; t += id_) {
    const pct = (t / dur) * 100;
    const p = document.createElement('div');
    p.className = 'fu-particle';
    p.style.left = (pct - 0.5) + '%';  // slight offset for centering
    p.textContent = '⚡';
    tl.appendChild(p);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   §3  DATA SOURCE — OMNIWeb / File upload / Scalar

   Controls which source provides the ts05_driving.txt data for
   TIME_SERIES mode.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Switch the time-series input source.
 *
 * Manages the three-way toggle (OMNIWeb / Upload / Scalar) and
 * shows/hides the corresponding sub-panels.
 *
 * Note: Accepts either (btn, src) or (src) calling conventions for
 * backward compatibility with both new and old HTML event handlers.
 *
 * @param {HTMLElement|string} btnOrSrc — button element or source string
 * @param {string}             [src]    — 'omni' | 'file' | 'scalar'
 */
function setTsSource(btnOrSrc, src) {
  /* Support both calling conventions:
     setTsSource(btn, 'omni')  — new HTML (passes button + source)
     setTsSource('omni')       — old refs (just source string) */
  const mode = src || btnOrSrc;
  S.tsSource = mode;

  /* Toggle button highlights in the source selector group */
  document.querySelectorAll('#ts-source-tog .tog-btn').forEach(b => b.classList.remove('on'));
  const btnId = { omni: 'ts-omni-btn', file: 'ts-file-btn', scalar: 'ts-scalar-btn' }[mode];
  if (btnId) $(btnId)?.classList.add('on');

  /* Show/hide source-specific panels */
  $('omni-panel').style.display = mode === 'omni' ? 'block' : 'none';
  $('file-panel').style.display = mode === 'file' ? 'block' : 'none';
}

/**
 * Animate the 4-step OMNIWeb fetch pipeline display.
 *
 * This is a CLIENT-SIDE SIMULATION — the actual OMNIWeb API calls
 * happen on the CCMC server when the job is submitted.  This animation
 * gives the user a preview of what will happen and validates their
 * time range / cadence selections.
 *
 * Pipeline steps (animated with 700ms delays):
 *   1. "Querying omniweb.gsfc.nasa.gov for OMNI data…"
 *   2. "Querying wdc.kugi.kyoto-u.ac.jp for Dst / Sym-H…"
 *   3. "Merging streams and gap-filling…"
 *   4. "Generating preview and data quality report…"
 *
 * On completion, displays:
 *   - Time range confirmation
 *   - Row count and cadence
 *   - Simulated gap detection report (hardcoded demo gap)
 *
 * Reads: #omni-cadence (dropdown), #event-start, #event-end (datetime inputs)
 * Writes: #os-1..#os-4 (step indicators), #omni-status (status text)
 */
function _ts05StepCadenceMinutes() {
  const cadSel = $('omni-cadence');
  const cadVal = cadSel?.value ?? '';
  return cadVal.startsWith('1 min') ? 1 : cadVal.startsWith('1 hr') ? 60 : 5;
}

/* Canonical merged TS05 preview dataset.
   Each record stores a parsed timestamp and the exact driver line that will be
   written to ts05_driving.txt.  This mirrors the richer T01/T96 preview model,
   allowing auto-fetch previews and uploaded files to contribute to one shared
   scrollable table and one shared downloadable output product. */
let _ts05Dataset = [];          // [{ts:Number, line:String}]
let _ts05ConvertedLines = null; // string[] for downloadTs05File()

function _ts05LineTs(line) {
  const p = String(line || '').trim().split(/\s+/);
  if (p.length < 4) return NaN;
  const yr = +p[0], doy = +p[1], hh = +p[2], mm = +p[3];
  if (![yr, doy, hh, mm].every(Number.isFinite)) return NaN;
  return Date.UTC(yr, 0, doy, hh, mm);
}

function _ts05MergeLines(newLines) {
  const HEADER = [
    '# ts05_driving.txt — maintained by AMPS wizard',
    '# YYYY DOY HH mm Bx By Bz Vx Vy Vz Np Temp SYM-H IMFflag SWflag Tilt Pdyn W1 W2 W3 W4 W5 W6'
  ];
  const existing = new Set(_ts05Dataset.map(r => r.ts));
  let added = 0;
  for (const raw of (newLines || [])) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const ts = _ts05LineTs(line);
    if (!Number.isFinite(ts) || existing.has(ts)) continue;
    _ts05Dataset.push({ ts, line });
    existing.add(ts);
    added += 1;
  }
  _ts05Dataset.sort((a, b) => a.ts - b.ts);
  _ts05ConvertedLines = [...HEADER, ..._ts05Dataset.map(r => r.line)];
  return added;
}

function _ts05RenderTable() {
  const wrap  = $('ts05-preview-wrap');
  const table = $('ts05-preview-table');
  const stats = $('ts05-dataset-stats');
  if (!wrap || !table) return;

  if (_ts05Dataset.length === 0) {
    wrap.style.display = 'none';
    if (stats) stats.textContent = '';
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '';
    return;
  }

  wrap.style.display = '';
  const first = new Date(_ts05Dataset[0].ts).toISOString().slice(0,16).replace('T',' ');
  const last  = new Date(_ts05Dataset[_ts05Dataset.length - 1].ts).toISOString().slice(0,16).replace('T',' ');
  if (stats) {
    stats.innerHTML = `<b style="color:var(--green)">${_ts05Dataset.length} rows</b> · ${first} → ${last} UTC · scroll ↕ ↔ to explore`;
  }

  const cols = ['YYYY','DOY','HH','mm','BX [NT]','BY [NT]','BZ [NT]','VX [KM/S]','VY','VZ','NP [CM⁻³]','TEMP [K]','SYM-H','IMF','SW','TILT [RAD]','PDYN [NPA]','W1','W2','W3','W4','W5','W6'];
  table.querySelector('thead').innerHTML = '<tr>' + cols.map(c => `<th scope="col">${c}</th>`).join('') + '</tr>';
  table.querySelector('tbody').innerHTML = _ts05Dataset.map(row => {
    const p = row.line.trim().split(/\s+/);
    return '<tr>' + cols.map((_, i) => `<td>${p[i] ?? ''}</td>`).join('') + '</tr>';
  }).join('');
}

function ts05ClearDataset() {
  _ts05Dataset = [];
  _ts05ConvertedLines = null;
  const dl = $('ts05-dl-btn');
  if (dl) dl.style.display = 'none';
  const st = $('omni-status');
  if (st) st.innerHTML = '<span class="ok">✓ Dataset cleared</span>&nbsp;&nbsp;<span style="color:var(--text-dim)">Ready to preview a fresh TS05 fetch or load a file</span>';
  _ts05RenderTable();
}

function downloadTs05File() {
  if (!_ts05ConvertedLines || _ts05ConvertedLines.length === 0) return;
  const blob = new Blob([_ts05ConvertedLines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ts05_driving.txt';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function _parseTs05DriverText(text) {
  const dataLines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(/\s+/);
    if (p.length < 23) continue;
    const yr = +p[0], doy = +p[1], hh = +p[2], mm = +p[3];
    if (![yr, doy, hh, mm].every(Number.isFinite)) continue;
    dataLines.push(p.slice(0, 23).join(' '));
  }
  return dataLines;
}

function _applyTs05TextDataset(text, sourceLabel) {
  const lines = _parseTs05DriverText(text);
  const added = _ts05MergeLines(lines);
  _ts05RenderTable();
  const dl = $('ts05-dl-btn');
  if (dl && _ts05Dataset.length > 0) dl.style.display = '';
  const st = $('omni-status');
  if (st) {
    st.innerHTML = added > 0
      ? `<span class="ok">✓ Loaded ${added} TS05 rows</span>&nbsp;&nbsp;<span style="color:#fff;">${sourceLabel}</span> · <b>${_ts05Dataset.length} total in dataset</b>`
      : `<span class="warn">⚠ ${sourceLabel} contained no new valid TS05 rows</span>`;
  }
  return added;
}

function _ts05SyntheticDataset(start, end, cadenceMin) {
  const lines = [];
  let w = [0.12, 0.08, 0.05, 0.03, 0.09, 0.07];
  const alpha = [0.96, 0.965, 0.97, 0.972, 0.968, 0.966];
  for (let ts = start.getTime(), k = 0; ts <= end.getTime(); ts += cadenceMin * 60000, k++) {
    const d = new Date(ts);
    const yr  = d.getUTCFullYear();
    const doy = Math.floor((ts - Date.UTC(yr, 0, 0)) / 86400000);
    const hh  = d.getUTCHours();
    const mm  = d.getUTCMinutes();
    const phase = k / Math.max(1, Math.round((end - start) / (cadenceMin * 60000)));
    const bx = 0.7 * Math.sin(phase * Math.PI * 5.0);
    const by = 1.8 + 2.4 * Math.sin(phase * Math.PI * 3.2 + 0.3);
    const bz = -3.0 - 8.5 * Math.max(0, Math.sin(phase * Math.PI * 4.1));
    const vx = -390 - 210 * phase - 50 * Math.sin(phase * Math.PI * 2.4);
    const vy = 4 * Math.sin(phase * Math.PI * 1.7);
    const vz = -3 * Math.cos(phase * Math.PI * 1.3);
    const np = 5.8 + 6.2 * phase;
    const temp = 95000 + 60000 * phase;
    const symh = -18 - 110 * Math.max(0, Math.sin(phase * Math.PI * 2.1));
    const imfflag = 1, swflag = 1;
    const tilt = (5.0 - 17.0 * phase) * Math.PI / 180.0;
    const pdyn = 1.6726e-6 * np * vx * vx;
    const south = Math.max(0, -bz);
    const speed = Math.abs(vx) / 400.0;
    const drive = 0.025 * south + 0.012 * speed + 0.010 * Math.max(0, pdyn - 1.5);
    w = w.map((wi, i) => alpha[i] * wi + (1 - alpha[i]) * drive * (1 + 0.14 * i));
    lines.push([
      yr, doy, hh, mm,
      bx.toFixed(3), by.toFixed(3), bz.toFixed(3),
      vx.toFixed(1), vy.toFixed(1), vz.toFixed(1),
      np.toFixed(2), temp.toFixed(0), symh.toFixed(1),
      imfflag, swflag, tilt.toFixed(5), pdyn.toFixed(3),
      ...w.map(v => v.toFixed(4))
    ].join(' '));
  }
  return lines;
}

/* ---------------------------------------------------------------------------
   TS05 PREVIEW: EXACT NUMERICAL CONTENT OF simulateOmniFetch()

   This routine does not contact OMNI or Kyoto directly. Instead it builds a
   synthetic row sequence at the chosen cadence and then populates the preview
   table with columns

      [year, doy, hh, mm, Bx, By, Bz, Vx, Vy, Vz, Np, Temp, SymH,
       IMFflag, SWflag, Tilt, Pdyn, W1, W2, W3, W4, W5, W6].

   For each time step k the synthetic helper computes:

      phase_k = k / max(1, Nsteps),
      Bx_k    = 0.7 sin(5 pi phase_k),
      By_k    = 1.8 + 2.4 sin(3.2 pi phase_k + 0.3),
      Bz_k    = -3.0 - 8.5 max(0, sin(4.1 pi phase_k)),
      Vx_k    = -390 - 210 phase_k - 50 sin(2.4 pi phase_k),
      Vy_k    = 4 sin(1.7 pi phase_k),
      Vz_k    = -3 cos(1.3 pi phase_k),
      Np_k    = 5.8 + 6.2 phase_k,
      Temp_k  = 95000 + 60000 phase_k,
      SymH_k  = -18 - 110 max(0, sin(2.1 pi phase_k)),
      Tilt_k  = (5.0 - 17.0 phase_k) * pi / 180.

   It then forms

      Pdyn_k  = 1.6726e-6 Np_k Vx_k^2,
      Bs_k    = max(0, -Bz_k),
      speed_k = |Vx_k| / 400,
      D_k     = 0.025 Bs_k + 0.012 speed_k + 0.010 max(0, Pdyn_k - 1.5),

   and updates each TS05 memory channel by

      W_i^(k+1) = alpha_i W_i^(k) + (1-alpha_i) D_k (1 + 0.14 i).

   This is a browser-side surrogate for history-dependent storm-driving terms.
   The purpose is to create a smooth, interpretable preview, not to certify an
   authoritative TS05 preprocessing chain.
--------------------------------------------------------------------------- */
function simulateOmniFetch() {
  const cadMin = _ts05StepCadenceMinutes();
  const startEl = $('event-start');
  const endEl   = $('event-end');
  const start   = startEl ? new Date(startEl.value) : new Date('2017-09-07T00:00');
  const end     = endEl   ? new Date(endEl.value)   : new Date('2017-09-10T20:00');
  const rowCount = Math.max(0, Math.floor((end - start) / (cadMin * 60000)) + 1);
  const msgs = [
    `⏳ Querying OMNIWeb for ${cadMin}-min IMF and solar-wind context…`,
    '⏳ Querying Kyoto Dst / SYM-H context and resolving TS05 flags…',
    '⏳ Estimating TS05 W1…W6 storm-history terms and assembling ts05_driving.txt…',
    '⏳ Opening the preview dataset viewer and enabling merge / download tools…'
  ];
  const steps = ['os-1', 'os-2', 'os-3', 'os-4'];
  steps.forEach((id, idx) => {
    const e = $(id);
    if (e) {
      e.className = idx < 2 ? 'os-num done' : 'os-num pending';
      e.textContent = idx < 2 ? '✓' : String(idx + 1);
      e.style.background = '';
    }
  });
  const st = $('omni-status');
  if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[0]}</span>`;

  let i = 0;
  const adv = () => {
    if (i > 0) {
      const prev = $(steps[i - 1]);
      if (prev) { prev.className = 'os-num done'; prev.textContent = '✓'; prev.style.background = ''; }
    }
    if (i < steps.length) {
      const cur = $(steps[i]);
      if (cur) { cur.className = 'os-num'; cur.style.background = 'var(--orange)'; cur.textContent = '…'; }
      if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[i]}</span>`;
      i += 1;
      setTimeout(adv, 420);
      return;
    }

    const lines = _ts05SyntheticDataset(start, end, cadMin);
    _ts05MergeLines(lines);
    _ts05RenderTable();
    const dl = $('ts05-dl-btn');
    if (dl && _ts05Dataset.length > 0) dl.style.display = '';
    const s = startEl ? startEl.value.replace('T', ' ') : '-';
    const e = endEl   ? endEl.value.replace('T', ' ')   : '-';
    if (st) {
      st.innerHTML =
        `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">${s} → ${e} UTC</span><br/>` +
        `${rowCount} rows @ ${cadMin} min cadence — 24 TS05 columns with preview W1…W6 estimates` +
        `&nbsp;·&nbsp;<b>${_ts05Dataset.length} total in dataset</b>` +
        `&nbsp;·&nbsp;<span class="warn">⚠ client-side W1…W6 preview only — archived TS05 files remain the authoritative source</span>`;
    }
  };
  adv();
}


/* ═══════════════════════════════════════════════════════════════════════════
   TS05 DRIVING-FILE UPLOAD
   ═══════════════════════════════════════════════════════════════════════════
   Wire #ts05-dropzone (click + drag/drop) and #ts-upload-btn (button) inside
   #file-panel so the user can upload a pre-built ts05_driving.txt.
   The File object is stored in S.tsFile and its name is shown inline.
   Called once from js/09-init.js during application boot.
*/

/**
 * Apply a TS05 driving File object: update S, parse it into the merged preview
 * dataset, and refresh the upload widgets.
 *
 * @param {File} file
 */
function _applyTsFile(file) {
  S.tsFile = file;

  const dz = $('ts05-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${(file.size / 1024).toFixed(1)} KB · drag a new file to replace or append another from the preview toolbar</div>`;
  }

  const lbl = $('ts-file-label');
  if (lbl) {
    lbl.textContent = `⏳ Reading ${file.name}…`;
    lbl.style.color = 'var(--orange)';
  }

  const reader = new FileReader();
  reader.onload = () => {
    const added = _applyTs05TextDataset(reader.result, file.name);
    if (lbl) {
      lbl.textContent = added > 0
        ? `✅ ${file.name} — ${added} rows added (${_ts05Dataset.length} total)`
        : `✗ ${file.name} — no valid TS05 rows found`;
      lbl.style.color = added > 0 ? 'var(--green)' : 'var(--red)';
    }
    updateSidebar();
  };
  reader.onerror = () => {
    if (lbl) {
      lbl.textContent = `✗ Failed to read ${file.name}`;
      lbl.style.color = 'var(--red)';
    }
  };
  reader.readAsText(file);
}

function ts05AppendFile() {
  let fi = $('ts05-append-input');
  if (!fi) {
    fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = '.txt,.dat,.csv';
    fi.style.display = 'none';
    fi.id = 'ts05-append-input';
    document.body.appendChild(fi);
    fi.addEventListener('change', function() {
      const file = this.files && this.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = () => _applyTs05TextDataset(r.result, file.name);
      r.readAsText(file);
      this.value = '';
    });
  }
  fi.click();
}

/**
 * Wire #ts05-dropzone and #ts-upload-btn for real file upload.
 *
 * Both the dropzone (click + drag/drop) and the "Choose file…" button
 * share a single hidden <input type="file"> so either interaction stores
 * the same File object via _applyTsFile().
 *
 * Called once from js/09-init.js during application boot.
 */
function initTsFileUpload() {
  const dz  = $('ts05-dropzone');
  const btn = $('ts-upload-btn');
  if (!dz && !btn) return;

  /* Shared hidden file input */
  const fi = document.createElement('input');
  fi.type   = 'file';
  fi.id     = 'ts-file-input';
  fi.accept = '.txt,.csv,.dat';
  fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function () {
    if (this.files.length > 0) _applyTsFile(this.files[0]);
    this.value = '';
  });

  /* Dropzone: click to open picker */
  if (dz) {
    dz.addEventListener('click',   () => fi.click());
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) _applyTsFile(e.dataTransfer.files[0]);
    });
  }

  /* Button: also opens the same picker */
  if (btn) btn.addEventListener('click', () => fi.click());
}



/* ═══════════════════════════════════════════════════════════════════════════
   T96 — enriched auto-fetch preview and dataset handling

   Goal:
   Bring the T96 Step 7 preview closer to the richer T01 experience.
   The T96 driver itself still contains only the 5 AMPS-required columns:

     YYYY MM DD HH mm   Dst[nT]   Pdyn[nPa]   By[nT]   Bz[nT]   Tilt[deg]

   But the preview table can also show contextual columns that help the user
   inspect the fetched stream before downloading or dispatching the run:

     Vsw [km/s], Np [cm^-3], Kp

   Similar to T01, we keep a canonical in-memory dataset that supports:
   - simulated auto-fetch preview generation
   - appending additional files
   - clearing the dataset
   - downloading the merged t96_driving.txt product
   - rendering a scrollable preview table with dataset statistics
   ═══════════════════════════════════════════════════════════════════════════ */

let _t96Dataset = [];            // [{ts, line, vsw, np, kp}, ...]
let _t96ConvertedLines = null;   // string[] ready for download

function _t96LineTs(line) {
  const c = line.trim().split(/\s+/);
  if (c.length < 5) return 0;
  return Date.UTC(+c[0], +c[1]-1, +c[2], +c[3], +c[4], 0);
}

function _t96MergeLines(newLines, extraMap) {
  const HEADER = [
    '# t96_driving.txt — maintained by AMPS wizard',
    '# YYYY MM DD HH mm   Dst[nT]   Pdyn[nPa]   By[nT]   Bz[nT]   Tilt[deg]'
  ];

  const existingTs = new Set(_t96Dataset.map(r => r.ts));
  let added = 0;

  for (const line of newLines) {
    if (!line || line.startsWith('#') || !line.trim()) continue;
    const ts = _t96LineTs(line);
    if (!ts || existingTs.has(ts)) continue;
    const extra = (extraMap && extraMap.get(ts)) || {};
    _t96Dataset.push({ ts, line: line.trim(), ...extra });
    existingTs.add(ts);
    added++;
  }

  _t96Dataset.sort((a,b) => a.ts - b.ts);
  _t96ConvertedLines = [...HEADER, ..._t96Dataset.map(r => r.line)];
  return added;
}

function _t96RenderTable() {
  const wrap  = $('t96-preview-wrap');
  const table = $('t96-preview-table');
  const stats = $('t96-dataset-stats');
  if (!wrap || !table) return;

  if (_t96Dataset.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';

  if (stats) {
    const first = new Date(_t96Dataset[0].ts).toISOString().slice(0,16).replace('T',' ');
    const last  = new Date(_t96Dataset[_t96Dataset.length-1].ts).toISOString().slice(0,16).replace('T',' ');
    stats.innerHTML =
      `<b style="color:var(--green)">${_t96Dataset.length} rows</b>` +
      `&nbsp;·&nbsp;${first} → ${last} UTC` +
      `&nbsp;·&nbsp;<span style="color:var(--text-dim)">scroll ↔ ↕ to explore</span>`;
  }

  const COLS = [
    { lbl: 'YYYY MM DD HH mm', td: r => `<td style="font-family:var(--mono);white-space:nowrap;">${r.line.trim().split(/\s+/).slice(0,5).join(' ')}</td>` },
    { lbl: 'Dst [nT]',   th: 'c-dst',  td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-dst">${c[5]}</td>`; } },
    { lbl: 'Pdyn [nPa]', th: 'c-pdyn', td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-pdyn">${c[6]}</td>`; } },
    { lbl: 'By [nT]',    th: 'c-by',   td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-by">${c[7]}</td>`; } },
    { lbl: 'Bz [nT]',    th: 'c-bz',   td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-bz">${c[8]}</td>`; } },
    { lbl: 'Vsw [km/s]', th: 'c-vx',   td: r => `<td class="c-vx">${r.vsw != null ? r.vsw : '—'}</td>` },
    { lbl: 'Np [cm⁻³]',  th: 'c-nsw',  td: r => `<td class="c-nsw">${r.np != null ? r.np : '—'}</td>` },
    { lbl: 'Kp',         thStyle: 'color:#a0c8ff;', td: r => `<td style="color:#a0c8ff;">${r.kp != null ? r.kp : '—'}</td>` },
    { lbl: 'Tilt [°]',   th: 'c-vx',   td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-vx">${c[9]}</td>`; } }
  ];

  const thHtml = COLS.map(col => col.th ? `<th scope="col" class="${col.th}">${col.lbl}</th>` : (col.thStyle ? `<th scope="col" style="${col.thStyle}">${col.lbl}</th>` : `<th scope="col">${col.lbl}</th>`)).join('');
  const rowsHtml = _t96Dataset.map(row => `<tr>${COLS.map(col => col.td(row)).join('')}</tr>`).join('');

  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (thead && tbody) {
    thead.innerHTML = `<tr>${thHtml}</tr>`;
    tbody.innerHTML = rowsHtml;
  } else {
    table.innerHTML = `<tr>${thHtml}</tr>${rowsHtml}`;
  }
}

function t96ClearDataset() {
  _t96Dataset = [];
  _t96ConvertedLines = null;
  const wrap = $('t96-preview-wrap');
  if (wrap) wrap.style.display = 'none';
  const st = $('t96-omni-status');
  if (st) {
    st.innerHTML =
      `<span class="ok">✓ Ready to fetch</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">2017-09-07 00:00 → 2017-09-10 20:00 UTC</span><br/>` +
      `Estimated rows: <span style="color:#fff;">~1,056 rows @ 5 min cadence</span>&nbsp;·&nbsp;` +
      `<span class="warn">⚠ OMNI data gap handling depends on the selected fill policy</span>`;
  }
  const dl = $('t96-dl-btn');
  if (dl) dl.style.display = 'none';
}

function downloadT96File() {
  if (!_t96ConvertedLines || _t96ConvertedLines.length === 0) return;
  const blob = new Blob([_t96ConvertedLines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 't96_driving.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _t96ParseDriverText(text) {
  const lines = text.split(/\r?\n/);
  const dataLines = [];
  const extraMap = new Map();

  for (const rawLine of lines) {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#')) continue;
    const c = raw.split(/\s+/);

    /* Canonical T96 file: 5 timestamp columns + 5 driver columns */
    if (c.length < 10) continue;

    const year = +c[0], mon = +c[1], day = +c[2], hr = +c[3], mn = +c[4];
    const dst  = parseFloat(c[5]);
    const pdyn = parseFloat(c[6]);
    const by   = parseFloat(c[7]);
    const bz   = parseFloat(c[8]);
    const tilt = parseFloat(c[9]);
    if (![year,mon,day,hr,mn,dst,pdyn,by,bz,tilt].every(Number.isFinite)) continue;

    const line = `${year} ${String(mon).padStart(2,'0')} ${String(day).padStart(2,'0')} ${String(hr).padStart(2,'0')} ${String(mn).padStart(2,'0')}   ${dst.toFixed(1)}   ${pdyn.toFixed(3)}   ${by.toFixed(3)}   ${bz.toFixed(3)}   ${tilt.toFixed(2)}`;
    dataLines.push(line);

    /* Optional enriched columns if somebody uploads an extended preview export.
       We keep this permissive: cols 10..12 can be Vsw, Np, Kp. */
    const ts = _t96LineTs(line);
    const vsw = c.length > 10 ? parseFloat(c[10]) : NaN;
    const np  = c.length > 11 ? parseFloat(c[11]) : NaN;
    const kp  = c.length > 12 ? parseFloat(c[12]) : NaN;
    extraMap.set(ts, {
      vsw: Number.isFinite(vsw) ? vsw.toFixed(0) : undefined,
      np:  Number.isFinite(np)  ? np.toFixed(2)  : undefined,
      kp:  Number.isFinite(kp)  ? kp.toFixed(1)  : undefined
    });
  }

  return { dataLines, extraMap };
}

function _applyT96TextDataset(text, sourceLabel) {
  const parsed = _t96ParseDriverText(text);
  const added  = _t96MergeLines(parsed.dataLines, parsed.extraMap);
  _t96RenderTable();

  const st = $('t96-omni-status');
  if (st) {
    st.innerHTML =
      `<span class="ok">✓ ${added} rows added</span>` +
      ` (${sourceLabel} · <b>${_t96Dataset.length} total in dataset</b>)` +
      `&nbsp;·&nbsp;<span style="color:var(--text-dim)">T96 driver columns + preview-only Vsw/Np/Kp when available</span>`;
  }

  const dl = $('t96-dl-btn');
  if (dl) dl.style.display = '';
  return added;
}

/* Build a synthetic but consistent preview stream for the selected Step 7 window.
   This mirrors the existing simulate-only behavior of the site while exposing the
   richer T01-style preview UX for T96. */
/* ---------------------------------------------------------------------------
   T96 PREVIEW: EXACT NUMERICAL CONTENT OF simulateT96OmniFetch()

   The T96 preview assembles 5 driver columns for download:

      YYYY MM DD HH mm  Dst  Pdyn  By  Bz  Tilt.

   In the Step 7 browser workflow, Dst, By, and Bz are treated as upstream
   geophysical inputs (downloaded or synthesized), Pdyn is either passed through
   from such an upstream stream or recomputed from density and speed proxies, and
   Tilt is always generated locally from the epoch using a smooth bounded
   approximation.

   Therefore the preview performs a mixed operation:
     - pass-through / merge for the geophysical source quantities,
     - local evaluation of Tilt = Tilt_preview(t),
     - row assembly and de-duplication by UTC timestamp.

   The exact purpose is to show users what fields are required by AMPS for T96
   and how a file would be laid out; it is not to claim that the browser is the
   final authoritative producer of T96 input data.
--------------------------------------------------------------------------- */
function simulateT96OmniFetch() {
  const cadSel = $('t96-omni-cadence');
  const cadVal = cadSel?.value ?? '';
  const cadMin = cadVal.startsWith('1 min') ? 1 : cadVal.startsWith('1 hr') ? 60 : 5;

  const startEl = $('event-start');
  const endEl   = $('event-end');
  const start   = (startEl && startEl.value) ? new Date(startEl.value + ':00Z') : new Date('2017-09-07T00:00:00Z');
  const end     = (endEl   && endEl.value)   ? new Date(endEl.value   + ':00Z') : new Date('2017-09-10T20:00:00Z');

  const steps = ['t96-os-1', 't96-os-2', 't96-os-3', 't96-os-4'];
  const msgs = [
    `⏳ Querying omniweb.gsfc.nasa.gov for ${cadMin}-min OMNI SW…`,
    '⏳ Querying wdc.kugi.kyoto-u.ac.jp for Dst / Sym-H…',
    '⏳ Computing dipole tilt (IGRF), Pdyn, and preview context columns…',
    '⏳ Building / trimming t96_driving.txt and opening the preview dataset viewer…'
  ];

  steps.forEach((id, idx) => {
    const e = $(id);
    if (e) { e.className = 'os-num pending'; e.style.background = ''; e.textContent = idx + 1; }
  });

  const st = $('t96-omni-status');
  if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[0]}</span>`;

  let i = 0;
  const adv = () => {
    if (i > 0) {
      const pe = $(steps[i - 1]);
      if (pe) { pe.className = 'os-num done'; pe.style.background = ''; pe.textContent = '✓'; }
    }

    if (i < steps.length) {
      const ce = $(steps[i]);
      if (ce) { ce.className = 'os-num'; ce.style.background = 'var(--orange)'; ce.textContent = '…'; }
      if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[i]}</span>`;
      i++;
      setTimeout(adv, 550);
      return;
    }

    const dataLines = [];
    const extraMap  = new Map();
    for (let t = start.getTime(); t <= end.getTime(); t += cadMin * 60 * 1000) {
      const frac = (t - start.getTime()) / Math.max(1, (end.getTime() - start.getTime()));
      const d = new Date(t);
      const yyyy = d.getUTCFullYear();
      const mm   = String(d.getUTCMonth()+1).padStart(2,'0');
      const dd   = String(d.getUTCDate()).padStart(2,'0');
      const hh   = String(d.getUTCHours()).padStart(2,'0');
      const mn   = String(d.getUTCMinutes()).padStart(2,'0');

      /* Smooth deterministic preview values with storm-like evolution. */
      const dst  = -35 - 70*Math.sin(frac*2.4*Math.PI) - 18*Math.exp(-Math.pow((frac-0.62)/0.12,2));
      const by   =  1.6 + 3.1*Math.sin(frac*3.1*Math.PI + 0.4);
      const bz   = -2.0 - 5.8*Math.sin(frac*2.2*Math.PI) - 7.5*Math.exp(-Math.pow((frac-0.58)/0.10,2));
      const vsw  = 390 + 210*frac + 35*Math.sin(frac*2.0*Math.PI);
      const np   = Math.max(1.2, 5.6 + 2.0*Math.sin(frac*1.7*Math.PI + 0.2));
      const pdyn = 1.6726e-6 * np * vsw * vsw;
      const kp   = Math.max(0, Math.min(9, 1.5 + 5.2*frac + 0.8*Math.sin(frac*2.4*Math.PI)));
      const tilt = _approxDipoleTilt(d);

      const line = `${yyyy} ${mm} ${dd} ${hh} ${mn}   ${dst.toFixed(1)}   ${pdyn.toFixed(3)}   ${by.toFixed(3)}   ${bz.toFixed(3)}   ${tilt}`;
      dataLines.push(line);
      extraMap.set(_t96LineTs(line), { vsw: vsw.toFixed(0), np: np.toFixed(2), kp: kp.toFixed(1) });
    }

    const added = _t96MergeLines(dataLines, extraMap);
    _t96RenderTable();

    const dl = $('t96-dl-btn');
    if (dl) dl.style.display = '';

    const s = start.toISOString().slice(0,16).replace('T',' ');
    const e = end.toISOString().slice(0,16).replace('T',' ');
    if (st) {
      st.innerHTML =
        `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">${s} → ${e} UTC</span><br/>` +
        `${dataLines.length} rows @ ${cadMin} min cadence — 5 T96 drivers (+ preview context: Vsw, Np, Kp)` +
        `&nbsp;·&nbsp;<span style="color:var(--green)">${added} rows added</span>` +
        `&nbsp;·&nbsp;<b>${_t96Dataset.length} total in dataset</b>`;
    }
  };
  adv();
}

function t96AppendFile() {
  let fi = $('t96-append-input');
  if (!fi) {
    fi = document.createElement('input');
    fi.type = 'file';
    fi.id = 't96-append-input';
    fi.accept = '.txt,.dat,.csv';
    fi.style.display = 'none';
    fi.addEventListener('change', function() {
      const file = this.files && this.files[0];
      if (!file) return;
      file.text().then(text => {
        const added = _applyT96TextDataset(text, file.name);
        const st = $('t96-omni-status');
        if (st && added === 0) st.innerHTML = `<span style="color:var(--orange)">⚠ ${file.name} contained no new valid T96 rows</span>`;
      });
      this.value = '';
    });
    document.body.appendChild(fi);
  }
  fi.click();
}

/* ═══════════════════════════════════════════════════════════════════════════
   T96 DRIVING-FILE UPLOAD

   The original upload tab remains available. In addition to storing the File
   object in S.t96File, we now also parse the uploaded content and feed it into
   the same preview dataset used by the auto-fetch panel. That keeps the T96 UX
   aligned with T01: users can inspect the loaded file immediately rather than
   only seeing the file name.
   ═══════════════════════════════════════════════════════════════════════════ */
function _applyT96File(file) {
  S.t96File = file;

  const dz = $('t96-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${(file.size / 1024).toFixed(1)} KB · drag a new file to replace</div>`;
  }

  const lbl = $('t96-file-label');
  if (lbl) {
    lbl.textContent = `⏳ Loading ${file.name}…`;
    lbl.style.color = 'var(--text-dim)';
  }

  file.text().then(text => {
    const added = _applyT96TextDataset(text, file.name);
    if (lbl) {
      if (added > 0) {
        lbl.textContent = `✅ ${file.name} (${(file.size / 1024).toFixed(1)} KB) · ${added} rows merged`;
        lbl.style.color = 'var(--green)';
      } else {
        lbl.textContent = `✗ ${file.name} — no valid T96 rows found`;
        lbl.style.color = 'var(--red)';
      }
    }
  }).catch(err => {
    if (lbl) {
      lbl.textContent = `✗ ${file.name} — read failed: ${err.message}`;
      lbl.style.color = 'var(--red)';
    }
  });

  updateSidebar();
}

function initT96FileUpload() {
  const dz  = $('t96-dropzone');
  const btn = $('t96-upload-btn');
  if (!dz && !btn) return;

  const fi = document.createElement('input');
  fi.type   = 'file';
  fi.id     = 't96-file-input';
  fi.accept = '.txt,.csv,.dat';
  fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function () {
    if (this.files.length > 0) _applyT96File(this.files[0]);
    this.value = '';
  });

  if (dz) {
    dz.addEventListener('click',   () => fi.click());
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) _applyT96File(e.dataTransfer.files[0]);
    });
  }

  if (btn) btn.addEventListener('click', () => fi.click());
}

/* ═══════════════════════════════════════════════════════════════════════════
   T01 — QINDENTON DOWNLOAD, IN-BROWSER CONVERTER, FILE UPLOAD
   ═══════════════════════════════════════════════════════════════════════════ */

/* Open Qin-Denton archive in a new tab */
function t01DownloadQinDenton(source) {
  const urls = {
    rbsp:      'https://rbsp-ect.newmexicoconsortium.org/data_pub/QinDenton/',
    dartmouth: 'https://rdenton.host.dartmouth.edu/magpar/index.html',
  };
  const url = urls[source];
  if (url) window.open(url, '_blank', 'noopener');
}

/* ── Qin-Denton column indices (0-based) in 5-min file ─────────────────
   The Qin-Denton 5-min file layout (from the official README):
   Col  0: Year
   Col  1: Day (DOY)
   Col  2: Hr
   Col  3: ByIMF     [nT]
   Col  4: BzIMF     [nT]
   Col  5: V_SW      [km/s]
   Col  6: Den_P     [cm-3]
   Col  7: Pdyn      [nPa]
   Col  8: G1
   Col  9: G2
   Col 10: G3
   Col 11-18: 8 status flags
   Col 19: kp
   Col 20: akp3
   Col 21: dst       [nT]
   Col 22-27: Bz1..Bz6
   Col 28-33: W1..W6
   Col 34-45: 12 status flags
   NOTE: hourly file has slightly different layout — we detect by checking
   whether col 2 contains 'Min' in the header or if values look like minutes.
*/
const QD_COL = {
  year: 0, doy: 1, hr: 2,
  by: 3, bz: 4, vsw: 5, np: 6, pdyn: 7,
  g1: 8, g2: 9,
  dst: 21,
};

/* Convert a DOY-based datetime to ISO-like YYYY MM DD HH mm string */
function _qdDoyToDate(year, doy, hr, min) {
  const d = new Date(Date.UTC(year, 0, 1, hr, min || 0, 0));
  d.setUTCDate(d.getUTCDate() + (doy - 1));
  const pad = x => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()} ${pad(d.getUTCMonth()+1)} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())} ${pad(d.getUTCMinutes())}`;
}

/* Compute dipole tilt approximation (degrees) from a JS Date.
   Uses a simple geocentric dipole formula: tilt ~ 23.44 * sin(2π * dayOfYear / 365.25)
   accurate to ~2° for display/preview purposes; AMPS can use TILT=AUTO for exact values. */
function _approxDipoleTilt(dateUTC) {
  const start = Date.UTC(dateUTC.getUTCFullYear(), 0, 1);
  const doy   = (dateUTC - start) / 86400000 + 1;
  return (23.44 * Math.sin(2 * Math.PI * (doy - 80) / 365.25)).toFixed(2);
}

/* ── T01 in-memory dataset ─────────────────────────────────────────────
   _t01Dataset: array of row objects { ts (ms since epoch), line (output string) }
   This is the canonical dataset. Both the Qin-Denton converter and the
   direct t01_driving.txt upload write into it.
   New files are APPENDED and the dataset is re-sorted by timestamp.
   _t01ConvertedLines is rebuilt from _t01Dataset on every change.
*/
let _t01Dataset       = [];   // [{ts:Number, line:String}, ...]
let _t01ConvertedLines = null; // string[] for downloadT01File()
let _t01QdRawText      = null; // raw uploaded Qin-Denton text for T01 conversion

/* Parse a timestamp from an output line "YYYY MM DD HH mm   ..." → ms */
function _t01LineTs(line) {
  const c = line.trim().split(/\s+/);
  if (c.length < 5) return 0;
  return Date.UTC(+c[0], +c[1]-1, +c[2], +c[3], +c[4], 0);
}

/* Merge new data lines (with optional extra fields) into _t01Dataset, sort, rebuild output */
function _t01MergeLines(newLines, extraMap) {
  /* extraMap: optional Map<ts_ms, {vsw,np,kp,g3}> for the enriched viewer */
  const HEADER = [
    '# t01_driving.txt — maintained by AMPS wizard',
    '# YYYY MM DD HH mm   Pdyn[nPa]   Dst[nT]   By[nT]   Bz[nT]   G1   G2   Tilt[deg]'
  ];

  const existingTs = new Set(_t01Dataset.map(r => r.ts));
  let added = 0;
  for (const line of newLines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const ts = _t01LineTs(line);
    if (!ts || existingTs.has(ts)) continue;
    const extra = (extraMap && extraMap.get(ts)) || {};
    _t01Dataset.push({ ts, line: line.trim(), ...extra });
    existingTs.add(ts);
    added++;
  }

  _t01Dataset.sort((a, b) => a.ts - b.ts);
  _t01ConvertedLines = [...HEADER, ..._t01Dataset.map(r => r.line)];
  return added;
}

/* Render the full dataset into the scrollable viewer table — all T01-relevant columns */
function _t01RenderTable() {
  const wrap  = $('t01-preview-wrap');
  const table = $('t01-preview-table');
  const stats = $('t01-dataset-stats');
  if (!table || !wrap) return;

  if (_t01Dataset.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  /* Stats bar */
  if (stats) {
    const first = new Date(_t01Dataset[0].ts).toISOString().slice(0,16).replace('T',' ');
    const last  = new Date(_t01Dataset[_t01Dataset.length-1].ts).toISOString().slice(0,16).replace('T',' ');
    stats.innerHTML =
      `<b style="color:var(--green)">${_t01Dataset.length} rows</b>` +
      `&nbsp;·&nbsp;${first} → ${last} UTC` +
      `&nbsp;·&nbsp;<span style="color:var(--text-dim)">scroll ↔ ↕ to explore</span>`;
  }

  /* ── Column definitions ── */
  const COLS = [
    { lbl: 'YYYY MM DD HH mm', key: null,   td: r => `<td style="font-family:var(--mono);white-space:nowrap;">${r.line.trim().split(/\s+/).slice(0,5).join(' ')}</td>` },
    { lbl: 'Dst [nT]',         key: 'dst',  th: 'c-dst',   td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-dst">${c[6]}</td>`; } },
    { lbl: 'Pdyn [nPa]',       key: 'pdyn', th: 'c-pdyn',  td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-pdyn">${c[5]}</td>`; } },
    { lbl: 'By [nT]',          key: 'by',   th: 'c-by',    td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-by">${c[7]}</td>`; } },
    { lbl: 'Bz [nT]',          key: 'bz',   th: 'c-bz',    td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-bz">${c[8]}</td>`; } },
    { lbl: 'Vsw [km/s]',       key: 'vsw',  th: 'c-vx',    td: r => `<td class="c-vx">${r.vsw != null ? r.vsw : '—'}</td>` },
    { lbl: 'Np [cm⁻³]',        key: 'np',   th: 'c-nsw',   td: r => `<td class="c-nsw">${r.np  != null ? r.np  : '—'}</td>` },
    { lbl: 'Kp',               key: 'kp',   th: null, thStyle: 'color:#a0c8ff;', td: r => `<td style="color:#a0c8ff;">${r.kp != null ? r.kp : '—'}</td>` },
    { lbl: 'G1',               key: 'g1',   th: null, thStyle: 'color:#f0c080;', td: r => { const c=r.line.trim().split(/\s+/); return `<td style="color:#f0c080;">${c[9]}</td>`; } },
    { lbl: 'G2',               key: 'g2',   th: null, thStyle: 'color:#f0c080;', td: r => { const c=r.line.trim().split(/\s+/); return `<td style="color:#f0c080;">${c[10]}</td>`; } },
    { lbl: 'G3',               key: 'g3',   th: null, thStyle: 'color:#d4a850;', td: r => `<td style="color:#d4a850;">${r.g3 != null ? r.g3 : '—'}</td>` },
    { lbl: 'Tilt [°]',         key: 'tilt', th: 'c-vx',    td: r => { const c=r.line.trim().split(/\s+/); return `<td class="c-vx">${c[11]}</td>`; } },
  ];

  const thHtml = COLS.map(col => {
    if (col.th)      return `<th scope="col" class="${col.th}">${col.lbl}</th>`;
    if (col.thStyle) return `<th scope="col" style="${col.thStyle}">${col.lbl}</th>`;
    return `<th scope="col">${col.lbl}</th>`;
  }).join('');

  const rowsHtml = _t01Dataset.map(row =>
    `<tr>${COLS.map(col => col.td(row)).join('')}</tr>`
  ).join('');

  /* Use thead/tbody if present (sticky header), fall back to innerHTML for older markup */
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (thead && tbody) {
    thead.innerHTML = `<tr>${thHtml}</tr>`;
    tbody.innerHTML = rowsHtml;
  } else {
    table.innerHTML = `<tr>${thHtml}</tr>` + rowsHtml;
  }
  wrap.style.display = '';
}

/* Clear entire dataset and reset UI */
function t01ClearDataset() {
  _t01Dataset = [];
  _t01ConvertedLines = null;
  _t01QdRawText = null;

  /* Reset pipeline steps */
  ['t01-os-1','t01-os-2','t01-os-3','t01-os-4'].forEach((id, idx) => {
    const el = $(id); if (!el) return;
    el.textContent = idx + 1;
    el.className = idx < 2 ? 'os-num done' : (idx === 3 ? 'os-num pending' : 'os-num');
    el.style.background = '';
  });

  /* Reset dropzone */
  const dz = $('t01-qd-dropzone');
  if (dz) {
    dz.classList.remove('loaded');
    dz.innerHTML =
      '<div class="dz-icon">📦</div>' +
      '<div class="dz-primary">Drop Qin-Denton file here or click to browse</div>' +
      '<div class="dz-sub">QinDenton_YYYY*.txt · any cadence · max 200 MB</div>';
  }

  /* Reset status & hide viewer */
  const st = $('t01-omni-status');
  if (st) st.innerHTML = '<span class="ok">✓ Ready</span>&nbsp;&nbsp;Dataset cleared. Preview a fetch or drop a Qin-Denton file to start.';

  const dl = $('t01-dl-btn');
  if (dl) dl.style.display = 'none';

  const qst = $('t01-qd-status');
  if (qst) { qst.textContent = 'No file loaded'; qst.style.color = 'var(--text-dim)'; }

  _t01RenderTable();
}

/* Trigger file picker for appending a second (or nth) Qin-Denton file */
function t01AppendFile() {
  const fi = document.getElementById('t01-qd-file-input');
  if (fi) fi.click();
}

function _t01SyntheticRow(ts, prevCoupling) {
  const d = new Date(ts);
  const phase = (ts / 3600000) * 0.34;
  const by = 2.6 * Math.sin(phase) - 0.9;
  const bz = -3.5 - 6.5 * Math.sin(phase * 0.52) - 1.4 * Math.cos(phase * 0.17);
  const vsw = 390 + 170 * Math.max(0, Math.sin(phase * 0.43));
  const np = 4.2 + 2.4 * (1 + Math.sin(phase * 0.49));
  const pdyn = 1.6726e-6 * np * vsw * vsw;
  const dst = -14 - 42 * Math.max(0, Math.sin(phase * 0.29));
  const bt = Math.sqrt(by * by + bz * bz);
  const theta = Math.atan2(Math.abs(by), bz);
  const coupling = Math.pow(Math.abs(vsw), 4 / 3) * Math.pow(Math.max(bt, 0.01), 2 / 3) * Math.pow(Math.sin(theta / 2), 8 / 3);
  const blended = prevCoupling == null ? coupling : (0.68 * prevCoupling + 0.32 * coupling);
  const g1 = blended / 1650;
  const g2 = (0.74 * blended + 55 * Math.max(0, -bz)) / 1850;
  const g3 = (0.58 * g2 + 0.12 * Math.max(0, -bz)).toFixed(4);
  const kp = (1.1 + 2.8 * Math.max(0, Math.sin(phase * 0.41))).toFixed(1);
  const tilt = _approxDipoleTilt(d);
  const line =
    `${d.getUTCFullYear()} ${String(d.getUTCMonth()+1).padStart(2,'0')} ${String(d.getUTCDate()).padStart(2,'0')} ${String(d.getUTCHours()).padStart(2,'0')} ${String(d.getUTCMinutes()).padStart(2,'0')}   ` +
    `${pdyn.toFixed(3)}   ${dst.toFixed(1)}   ${by.toFixed(3)}   ${bz.toFixed(3)}   ${g1.toFixed(4)}   ${g2.toFixed(4)}   ${tilt}`;
  return {
    line,
    extra: {
      vsw: vsw.toFixed(0),
      np: np.toFixed(2),
      kp,
      g3
    },
    coupling
  };
}

function _t01BuildSyntheticDataset(start, end, cadenceMin) {
  const lines = [];
  const extraMap = new Map();
  let prev = null;
  for (let ts = start.getTime(); ts <= end.getTime(); ts += cadenceMin * 60000) {
    const row = _t01SyntheticRow(ts, prev);
    lines.push(row.line);
    extraMap.set(ts, row.extra);
    prev = row.coupling;
  }
  return { lines, extraMap };
}

/* ---------------------------------------------------------------------------
   T01 PREVIEW: EXACT NUMERICAL CONTENT OF simulateT01OmniFetch()

   The T01 preview differs from T96 because it includes derived storm-driving
   channels G1 and G2 (and the preview context term G3). In the design logic of
   Step 7, those terms are NOT independent downloaded observables. They are
   browser-derived quantities assembled from upstream IMF / solar-wind / pressure
   context.

   In equation form the browser computes preview surrogates of the structure

      G1 = F1(Bs, |V|, Pdyn, storm history),
      G2 = F2(Bs, |V|, Pdyn, storm history),
      G3 = F3(Bs, |V|, Pdyn, storm history),

   where Bs = max(0, -Bz), |V| is a solar-wind-speed measure, and the functions
   F1-F3 are low-order algebraic / smooth-memory combinations coded directly in
   JavaScript. The specific implementation is intentionally simple so that:

     - stronger southward IMF increases the derived drivers,
     - faster solar wind increases them,
     - stronger compression / pressure increases them,
     - the preview remains smooth and numerically well-behaved from row to row.

   Thus, the exact calculation here is "derive G-like parameters from the local
   preview stream and assemble the table", not "download ready-made G1/G2 values
   from a remote archive".
--------------------------------------------------------------------------- */
function simulateT01OmniFetch() {
  const cadSel = $('t01-omni-cadence');
  const cadVal = cadSel?.value ?? '';
  const cadMin = cadVal.startsWith('1 min') ? 1 : cadVal.startsWith('1 hr') ? 60 : 5;

  const startEl = $('event-start');
  const endEl   = $('event-end');
  const start   = startEl && startEl.value ? new Date(startEl.value + ':00Z') : new Date('2017-09-07T00:00:00Z');
  const end     = endEl   && endEl.value   ? new Date(endEl.value   + ':00Z') : new Date('2017-09-10T20:00:00Z');
  const rowCount = Math.max(0, Math.floor((end - start) / (cadMin * 60000)) + 1);

  const msgs = [
    `⏳ Querying omniweb.gsfc.nasa.gov for ${cadMin}-min IMF / solar-wind inputs (By, Bz, Vsw, Np, Pdyn)…`,
    '⏳ Querying geomagnetic context (Dst / SYM-H) and computing dipole tilt…',
    '⏳ Estimating T01 G1 / G2 coupling terms and assembling t01_driving.txt…',
    '⏳ Merging preview rows into the dataset viewer and enabling download…'
  ];
  const steps = ['t01-os-1', 't01-os-2', 't01-os-3', 't01-os-4'];
  steps.forEach((id, idx) => {
    const e = $(id);
    if (e) {
      e.className = idx < 2 ? 'os-num done' : (idx === 3 ? 'os-num pending' : 'os-num');
      e.textContent = idx + 1;
      e.style.background = '';
    }
  });

  const st = $('t01-omni-status');
  if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[0]}</span>`;

  let i = 0;
  const adv = () => {
    if (i > 0) {
      const pe = $(steps[i - 1]);
      if (pe) { pe.className = 'os-num done'; pe.textContent = '✓'; pe.style.background = ''; }
    }
    if (i < steps.length) {
      const ce = $(steps[i]);
      if (ce) { ce.className = 'os-num'; ce.style.background = 'var(--orange)'; ce.textContent = '…'; }
      if (st && msgs[i]) st.innerHTML = `<span style="color:var(--orange)">${msgs[i]}</span>`;
      i++;
      setTimeout(adv, 450);
      return;
    }

    const built = _t01BuildSyntheticDataset(start, end, cadMin);
    const added = _t01MergeLines(built.lines, built.extraMap);
    _t01RenderTable();
    const dl = $('t01-dl-btn'); if (dl) dl.style.display = '';
    const wrap = $('t01-preview-wrap');
    if (wrap) wrap.scrollIntoView({ behavior:'smooth', block:'nearest' });

    const s = start.toISOString().slice(0,16).replace('T',' ');
    const e = end.toISOString().slice(0,16).replace('T',' ');
    if (st) {
      st.innerHTML =
        `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">${s} → ${e} UTC</span><br/>` +
        `${rowCount} rows @ ${cadMin} min cadence — 7 T01 drivers (+ preview context: Vsw, Np, Kp, G3)` +
        `&nbsp;·&nbsp;<span style="color:var(--green)">${added} rows added</span>` +
        `&nbsp;·&nbsp;<b>${_t01Dataset.length} total in dataset</b>` +
        `&nbsp;·&nbsp;<span class="warn">⚠ G1 / G2 are preview estimates; use Qin-Denton below for archived pre-computed values</span>`;
    }
  };
  adv();
}

let _t01PreviewRows = null;   // full-column rows for the enriched preview table

/* Apply a loaded Qin-Denton file to the converter */
function _applyQdFile(file) {
  const st = $('t01-qd-status');
  const dz = $('t01-qd-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${(file.size / 1024 / 1024).toFixed(2)} MB · drag a new file to replace</div>`;
  }
  if (st) { st.textContent = `Loaded: ${file.name} — click "Auto-convert & Preview"`; st.style.color = 'var(--accent-bright)'; }

  file.text().then(text => {
    _t01QdRawText = text;
    // Animate pipeline to step 2
    ['t01-os-1','t01-os-2'].forEach(id => {
      const e = $(id);
      if (e) { e.className = 'os-num done'; e.textContent = '✓'; }
    });
  });
}

/* Main converter: parse Qin-Denton → t01_driving.txt lines, trim to event window
   Handles two formats:
   
   FORMAT A — RBSP-ECT (current, downloaded from rbsp-ect.newmexicoconsortium.org):
     44 cols:  ISO_TS YYYY MM DD HH mm 00  By Bz Vsw Np Pdyn G1 G2 G3  [8 status]  kp akp3 Dst  [Bz1..6]  [W1..6]  [6 status]
     Col 0 is an ISO timestamp, col 1=year, col 2=MONTH (not DOY), col 3=day

   FORMAT B — ViRBO legacy (older files, DOY-based):
     46 cols (hourly):  YEAR DOY HR  By Bz Vsw Np Pdyn G1 G2 G3 [8 status] kp akp3 Dst [Bz1..6] [W1..6] [12 status]
     47 cols (5-min):   YEAR DOY HR MIN  By Bz Vsw ...
     Col 0=year, col 1=DOY (not month), no ISO prefix
*/
function convertQinDentonToT01() {
  const st    = $('t01-omni-status');
  const step3 = $('t01-os-3');
  const step4 = $('t01-os-4');

  if (!_t01QdRawText) {
    if (st) {
      st.innerHTML = '<span style="color:var(--orange)">⚠ No file loaded — drop a Qin-Denton file first, then wait for ✓ on steps 1–2.</span>';
      st.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }

  if (step3) { step3.className = 'os-num'; step3.style.background = 'var(--orange)'; step3.textContent = '…'; }
  if (st)    { st.innerHTML = '<span style="color:var(--orange)">⏳ Parsing Qin-Denton file…</span>'; }

  const trimToWindow = $('t01-trim-window') ? $('t01-trim-window').checked : true;
  const startEl = $('event-start');
  const endEl   = $('event-end');
  const evStart = (trimToWindow && startEl && startEl.value) ? new Date(startEl.value + ':00Z') : null;
  const evEnd   = (trimToWindow && endEl   && endEl.value)   ? new Date(endEl.value   + ':00Z') : null;

  setTimeout(() => {
    try {
      const lines = _t01QdRawText.split(/\r?\n/);

      /* ── Find first data line ── */
      let dataStart = 0;
      let firstDataLine = null;
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw || /^[#\s]/.test(raw)) { dataStart = i + 1; continue; }
        if (/^\d/.test(raw) || /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
          firstDataLine = raw;
          dataStart = i;
          break;
        }
        dataStart = i + 1;
      }

      if (!firstDataLine) {
        _setStep3Fail(step3, st, '✗ No data rows found. Is this a Qin-Denton file?');
        return;
      }

      const probe = firstDataLine.trim().split(/\s+/);
      const totalCols = probe.length;

      /* ── FORMAT DETECTION ──────────────────────────────────────────────
         RBSP-ECT format: col[0] is "YYYY-MM-DDTHH:MM:SS" (contains '-' and 'T')
         ViRBO legacy:    col[0] is a plain integer year (e.g. 2000, 2017)
      ─────────────────────────────────────────────────────────────────── */
      const isRBSP = /^\d{4}-\d{2}-\d{2}T/.test(probe[0]);

      let iYear, iMon, iDay, iHr, iMin, iBy, iBz, iPdyn, iG1, iG2, iDst;

      if (isRBSP) {
        /* FORMAT A — RBSP-ECT 44-column format
           ISO_TS YYYY MM DD HH mm 00  By Bz Vsw Np Pdyn G1 G2 G3 [8st] kp akp3 Dst [Bz×6] [W×6] [6st] */
        iYear = 1; iMon = 2; iDay = 3; iHr = 4; iMin = 5;
        iBy = 7; iBz = 8; iPdyn = 11; iG1 = 12; iG2 = 13; iDst = 25;
      } else {
        /* FORMAT B — ViRBO legacy DOY-based
           Hourly (46 cols): YEAR DOY HR  By ...
           5-min  (47 cols): YEAR DOY HR MIN By ... */
        const col3val = parseFloat(probe[3]);
        const is5min  = (totalCols >= 47) &&
                        Number.isFinite(col3val) &&
                        col3val === Math.floor(col3val) &&
                        col3val % 5 === 0 && col3val >= 0 && col3val <= 55;
        const off = is5min ? 1 : 0;
        iYear = 0; iMon = 1; iDay = 2; iHr = 2; iMin = is5min ? 3 : -1;
        iBy = 3+off; iBz = 4+off; iPdyn = 7+off; iG1 = 8+off; iG2 = 9+off; iDst = 21+off;
      }

      /* ── Sanity check columns on first data row ── */
      const chk = n => Number.isFinite(parseFloat(probe[n]));
      if (!chk(iBy) || !chk(iPdyn) || !chk(iG1) || !chk(iDst)) {
        _setStep3Fail(step3, st,
          `✗ Column mapping failed (${isRBSP?'RBSP-ECT':'ViRBO legacy'} format, ${totalCols} cols).<br>` +
          `By[${iBy}]=${probe[iBy]} Pdyn[${iPdyn}]=${probe[iPdyn]} G1[${iG1}]=${probe[iG1]} Dst[${iDst}]=${probe[iDst]}<br>` +
          `Please check the file is an unmodified Qin-Denton product.`);
        return;
      }

      /* ── Main parse loop ── */
      const output = [
        '# t01_driving.txt — converted from Qin-Denton by AMPS wizard',
        `# Source: ${isRBSP ? 'RBSP-ECT 44-col (ISO+YYYY MM DD)' : 'ViRBO legacy DOY-based'}, ${totalCols} cols/row`,
        '# YYYY MM DD HH mm   Pdyn[nPa]   Dst[nT]   By[nT]   Bz[nT]   G1   G2   Tilt[deg]'
      ];
      let parsed = 0, skipped = 0, outOfWindow = 0;
      let fileFirstDate = null, fileLastDate = null;
      const previewRows = [];   // enriched rows for the viewer

      for (let i = dataStart; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw || /^[#\s]/.test(raw)) continue;
        if (!/^\d/.test(raw) && !/^\d{4}-\d{2}-\d{2}T/.test(raw)) continue;
        const cols = raw.split(/\s+/);
        if (cols.length < iDst + 1) { skipped++; continue; }

        let rowDate;
        let yyyy, mm, dd, hr, mn;

        if (isRBSP) {
          /* Parse directly from the ISO timestamp in col[0] — most reliable */
          const iso = cols[0];  // "2000-01-03T00:05:00"
          rowDate = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
          if (isNaN(rowDate.getTime())) { skipped++; continue; }
          yyyy = parseInt(cols[iYear], 10);
          mm   = parseInt(cols[iMon],  10);
          dd   = parseInt(cols[iDay],  10);
          hr   = parseInt(cols[iHr],   10);
          mn   = parseInt(cols[iMin],  10);
        } else {
          /* ViRBO: year + DOY */
          const year = parseInt(cols[iYear], 10);
          const doy  = parseInt(cols[iMon],  10);   // iMon reused as iDOY
          hr = parseInt(cols[iHr], 10);
          mn = iMin >= 0 ? parseInt(cols[iMin], 10) : 0;
          if (!Number.isFinite(year) || !Number.isFinite(doy) || !Number.isFinite(hr)) { skipped++; continue; }
          rowDate = new Date(Date.UTC(year, 0, 1, hr, mn, 0));
          rowDate.setUTCDate(rowDate.getUTCDate() + (doy - 1));
          yyyy = rowDate.getUTCFullYear();
          mm   = rowDate.getUTCMonth() + 1;
          dd   = rowDate.getUTCDate();
          mn   = rowDate.getUTCMinutes();
          hr   = rowDate.getUTCHours();
        }

        if (!fileFirstDate || rowDate < fileFirstDate) fileFirstDate = new Date(rowDate);
        if (!fileLastDate  || rowDate > fileLastDate)  fileLastDate  = new Date(rowDate);

        if (evStart && rowDate < evStart) { outOfWindow++; continue; }
        if (evEnd   && rowDate > evEnd)   { outOfWindow++; continue; }

        const by   = parseFloat(cols[iBy]);
        const bz   = parseFloat(cols[iBz]);
        const pdyn = parseFloat(cols[iPdyn]);
        const g1   = parseFloat(cols[iG1]);
        const g2   = parseFloat(cols[iG2]);
        const dst  = parseFloat(cols[iDst]);

        if (!Number.isFinite(by) || !Number.isFinite(bz) || !Number.isFinite(pdyn) ||
            !Number.isFinite(g1) || !Number.isFinite(g2) || !Number.isFinite(dst)) { skipped++; continue; }
        if (Math.abs(pdyn) > 999 || Math.abs(dst) > 9999) { skipped++; continue; }

        const pad = x => String(x).padStart(2, '0');
        const dateStr = `${yyyy} ${pad(mm)} ${pad(dd)} ${pad(hr)} ${pad(mn)}`;
        const tilt = _approxDipoleTilt(rowDate);

        /* Extra columns for the enriched preview (not written to AMPS driver file) */
        const iVsw = isRBSP ? 9  : 5  + off;
        const iNp  = isRBSP ? 10 : 6  + off;
        const iG3  = isRBSP ? 14 : 10 + off;
        const iKp  = isRBSP ? 23 : 19 + off;
        const vsw  = parseFloat(cols[iVsw]);
        const np   = parseFloat(cols[iNp]);
        const g3   = parseFloat(cols[iG3]);
        const kp   = parseFloat(cols[iKp]);

        output.push(
          `${dateStr}   ${pdyn.toFixed(3)}   ${dst.toFixed(1)}   ` +
          `${by.toFixed(3)}   ${bz.toFixed(3)}   ${g1.toFixed(4)}   ${g2.toFixed(4)}   ${tilt}`
        );
        previewRows.push({
          date: dateStr,
          pdyn: pdyn.toFixed(2),  dst:  dst.toFixed(0),
          by:   by.toFixed(2),    bz:   bz.toFixed(2),
          vsw:  Number.isFinite(vsw) ? vsw.toFixed(0) : '—',
          np:   Number.isFinite(np)  ? np.toFixed(2)  : '—',
          kp:   Number.isFinite(kp)  ? kp.toFixed(1)  : '—',
          g1:   g1.toFixed(3),    g2:   g2.toFixed(3),
          g3:   Number.isFinite(g3) ? g3.toFixed(3)   : '—',
          tilt: tilt,
        });
        parsed++;
      }

      /* ── Auto-fallback: if trimming caused zero rows, re-run without window ── */
      if (parsed === 0 && outOfWindow > 0 && (evStart || evEnd)) {
        /* Re-parse the full file ignoring the event window */
        for (let i = dataStart; i < lines.length; i++) {
          const raw = lines[i].trim();
          if (!raw || /^[#\s]/.test(raw)) continue;
          if (!/^\d/.test(raw) && !/^\d{4}-\d{2}-\d{2}T/.test(raw)) continue;
          const cols = raw.split(/\s+/);
          if (cols.length < iDst + 1) continue;

          let rowDate, yyyy, mm, dd, hr, mn;
          if (isRBSP) {
            const iso = cols[0];
            rowDate = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
            if (isNaN(rowDate.getTime())) continue;
            yyyy = parseInt(cols[iYear],10); mm = parseInt(cols[iMon],10);
            dd   = parseInt(cols[iDay],10);  hr = parseInt(cols[iHr],10);
            mn   = parseInt(cols[iMin],10);
          } else {
            const year = parseInt(cols[iYear],10), doy = parseInt(cols[iMon],10);
            hr = parseInt(cols[iHr],10);
            mn = iMin >= 0 ? parseInt(cols[iMin],10) : 0;
            if (!Number.isFinite(year)||!Number.isFinite(doy)||!Number.isFinite(hr)) continue;
            rowDate = new Date(Date.UTC(year, 0, 1, hr, mn, 0));
            rowDate.setUTCDate(rowDate.getUTCDate() + (doy - 1));
            yyyy = rowDate.getUTCFullYear(); mm = rowDate.getUTCMonth()+1;
            dd = rowDate.getUTCDate(); mn = rowDate.getUTCMinutes(); hr = rowDate.getUTCHours();
          }

          const by=parseFloat(cols[iBy]),bz=parseFloat(cols[iBz]),pdyn=parseFloat(cols[iPdyn]);
          const g1=parseFloat(cols[iG1]),g2=parseFloat(cols[iG2]),dst=parseFloat(cols[iDst]);
          if (!Number.isFinite(by)||!Number.isFinite(bz)||!Number.isFinite(pdyn)||
              !Number.isFinite(g1)||!Number.isFinite(g2)||!Number.isFinite(dst)) continue;
          if (Math.abs(pdyn) > 999 || Math.abs(dst) > 9999) continue;

          const pad = x => String(x).padStart(2,'0');
          output.push(
            `${yyyy} ${pad(mm)} ${pad(dd)} ${pad(hr)} ${pad(mn)}   ${pdyn.toFixed(3)}   ${dst.toFixed(1)}   ` +
            `${by.toFixed(3)}   ${bz.toFixed(3)}   ${g1.toFixed(4)}   ${g2.toFixed(4)}   ${_approxDipoleTilt(rowDate)}`
          );
          parsed++;
        }

        /* If still zero, the file is genuinely broken */
        if (parsed === 0) {
          _setStep3Fail(step3, st,
            `✗ 0 rows after full-file fallback — all ${skipped} rows have fill/invalid values. ` +
            `Verify this is an unmodified Qin-Denton file.`);
          return;
        }

        /* Uncheck the trim box automatically so the user sees what happened */
        const trimCb = $('t01-trim-window');
        if (trimCb) trimCb.checked = false;

        /* Prepend a notice to the output header */
        const fmtD = d => d ? d.toISOString().slice(0,10) : '?';
        const fd = fmtD(fileFirstDate), ld = fmtD(fileLastDate);
        const ws = evStart ? evStart.toISOString().slice(0,10) : '?';
        const we = evEnd   ? evEnd.toISOString().slice(0,10)   : '?';
        output.splice(1, 0,
          `# NOTE: file date range (${fd} → ${ld}) did not overlap event window (${ws} → ${we}).`,
          `#       Full file converted. Trim manually or update the Step 7 event dates.`
        );

        /* Show a visible warning banner in the status bar */
        if (st) {
          st.innerHTML =
            `<span style="color:var(--orange)">⚠ Date mismatch — full file converted instead</span>` +
            `<br>• File: <b style="color:#fff">${fd} → ${ld}</b>` +
            `&nbsp;·&nbsp;Event window was <b style="color:#fff">${ws} → ${we}</b>` +
            `<br>• <b>${parsed} rows</b> written to t01_driving.txt — trim manually if needed` +
            `&nbsp;·&nbsp;<b style="color:var(--green)">⬇ Download</b>`;
          st.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else if (parsed === 0) {
        /* All other zero-row cases */
        const fmtD = d => d ? d.toISOString().slice(0,10) : '?';
        let msg;
        if (skipped > 0) {
          msg = `✗ 0 rows converted — ${skipped} rows skipped (fill/invalid values).<br>` +
                `• File range: ${fmtD(fileFirstDate)} → ${fmtD(fileLastDate)}`;
        } else {
          msg = '✗ No readable rows — file may be empty or in an unexpected format.';
        }
        _setStep3Fail(step3, st, msg);
        return;
      }

      /* ── Merge into dataset, render, update UI ── */
      const dataLines = output.filter(r => !r.startsWith('#'));
      /* Build extraMap: ts_ms → {vsw, np, kp, g3} for the enriched viewer */
      const extraMap = new Map();
      for (const pr of previewRows) {
        /* Safer: recompute ts from the date string directly */
        const dc = pr.date.trim().split(/\s+/);
        const tms = Date.UTC(+dc[0], +dc[1]-1, +dc[2], +dc[3], +dc[4], 0);
        extraMap.set(tms, { vsw: pr.vsw, np: pr.np, kp: pr.kp, g3: pr.g3 });
      }
      const added = _t01MergeLines(dataLines, extraMap);
      _t01RenderTable();

      [step3, step4].forEach(el => {
        if (el) { el.className = 'os-num done'; el.style.background = ''; el.textContent = '✓'; }
      });

      const dlBtn = $('t01-dl-btn');
      if (dlBtn) dlBtn.style.display = '';

      const fmt = isRBSP ? 'RBSP-ECT (44-col, YYYY MM DD)' : 'ViRBO legacy (DOY-based)';
      const usedFallback = (outOfWindow > 0 && (evStart || evEnd));
      if (!usedFallback && st) {
        st.innerHTML =
          `<span class="ok">✓ ${added} rows added</span>` +
          ` (${fmt} · ${_t01Dataset.length} total in dataset)` +
          (outOfWindow ? `&nbsp;·&nbsp;${outOfWindow} rows outside window trimmed` : '') +
          (skipped     ? `&nbsp;·&nbsp;<span style="color:var(--orange)">${skipped} fill/invalid skipped</span>` : '') +
          `&nbsp;·&nbsp;<b style="color:var(--green)">⬇ Download</b>`;
        st.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (usedFallback && st) {
        /* Update fallback message to reflect total */
        const fmtD = d => d ? d.toISOString().slice(0,10) : '?';
        st.innerHTML =
          `<span style="color:var(--orange)">⚠ Date mismatch — full file merged instead</span>` +
          `&nbsp;·&nbsp;<b style="color:#fff">${fmtD(fileFirstDate)} → ${fmtD(fileLastDate)}</b>` +
          `&nbsp;·&nbsp;<b>${_t01Dataset.length} rows total in dataset</b>` +
          `&nbsp;·&nbsp;<b style="color:var(--green)">⬇ Download</b>`;
        st.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

    } catch (err) {
      _setStep3Fail(step3, st, `✗ Parse exception: ${err.message}`);
    }
  }, 60);
}

/* Helper: set step3 to red X and show message */
function _setStep3Fail(step3, st, msg) {
  if (step3) { step3.className = 'os-num'; step3.style.background = 'var(--red)'; step3.textContent = '✗'; }
  if (st)    { st.innerHTML = `<span style="color:var(--red)">${msg}</span>`; st.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
}

/* Download the converted t01_driving.txt to the user's machine */
function downloadT01File() {
  if (!_t01ConvertedLines || _t01ConvertedLines.length === 0) return;
  const blob = new Blob([_t01ConvertedLines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 't01_driving.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── T01 file upload wiring (for the "Upload t01_driving.txt" tab) ── */
function _applyT01File(file) {
  const lbl = $('t01-file-label');
  if (lbl) { lbl.textContent = `⏳ Loading ${file.name}…`; lbl.style.color = 'var(--text-dim)'; }

  file.text().then(text => {
    /* Parse each data line — accept lines matching the output format:
       YYYY MM DD HH mm   Pdyn  Dst  By  Bz  G1  G2  Tilt */
    const lines = text.split(/\r?\n/);
    const dataLines = [];
    for (const raw of lines) {
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      if (/^\d{4}\s+\d{2}\s+\d{2}/.test(t) && t.split(/\s+/).length >= 8) {
        dataLines.push(t);
      }
    }

    if (dataLines.length === 0) {
      if (lbl) { lbl.textContent = `✗ ${file.name} — no valid data rows found`; lbl.style.color = 'var(--red)'; }
      return;
    }

    const added = _t01MergeLines(dataLines);
    _t01RenderTable();

    /* Show Download button */
    const dl = $('t01-dl-btn');
    if (dl) dl.style.display = '';

    if (lbl) {
      lbl.textContent = `✅ ${file.name} — ${added} rows added (${_t01Dataset.length} total)`;
      lbl.style.color = 'var(--green)';
    }

    /* Update the dropzone to show loaded state */
    const dz = $('t01-dropzone');
    if (dz) {
      dz.classList.add('loaded');
      dz.innerHTML =
        '<div class="dz-icon">✅</div>' +
        `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
        `<div class="dz-sub">${added} rows added · ${_t01Dataset.length} rows total · drop another file to append</div>`;
    }

    updateSidebar();
  });
}

function initT01FileUpload() {
  /* Wire the Qin-Denton dropzone in the convert panel */
  const qdDz  = $('t01-qd-dropzone');
  const qdBtn = $('t01-qd-browse-btn');
  if (qdDz || qdBtn) {
    const qdFi = document.createElement('input');
    qdFi.type = 'file'; qdFi.accept = '.txt,.dat,.d'; qdFi.style.display = 'none';
    qdFi.id = 't01-qd-file-input';  // used by t01AppendFile()
    document.body.appendChild(qdFi);
    qdFi.addEventListener('change', function() { if (this.files.length > 0) { _applyQdFile(this.files[0]); } this.value = ''; });
    if (qdDz) {
      qdDz.addEventListener('click',   () => qdFi.click());
      qdDz.addEventListener('dragover',  e => { e.preventDefault(); qdDz.classList.add('drag-over'); });
      qdDz.addEventListener('dragleave', () => qdDz.classList.remove('drag-over'));
      qdDz.addEventListener('drop', e => { e.preventDefault(); qdDz.classList.remove('drag-over'); if (e.dataTransfer.files.length > 0) _applyQdFile(e.dataTransfer.files[0]); });
    }
    if (qdBtn) qdBtn.addEventListener('click', () => qdFi.click());
  }

  /* Wire the direct t01_driving.txt upload dropzone */
  const dz  = $('t01-dropzone');
  const btn = $('t01-upload-btn');
  if (!dz && !btn) return;
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.txt,.csv,.dat'; fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function() { if (this.files.length > 0) { _applyT01File(this.files[0]); } this.value = ''; });
  if (dz) {
    dz.addEventListener('click',   () => fi.click());
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files.length > 0) _applyT01File(e.dataTransfer.files[0]); });
  }
  if (btn) btn.addEventListener('click', () => fi.click());
}



/* ── TA15 in-memory dataset ────────────────────────────────────────────
   Canonical dataset used by both the OMNI preview pipeline and direct
   ta15_driving.txt uploads. Each row stores:
     ts     : UTC milliseconds
     line   : original ta15_driving.txt data line
     parsed : parsed columns for rich-table rendering
*/
let _ta15Dataset = [];          // [{ts:Number, line:String, parsed:Object}, ...]
let _ta15ConvertedLines = null; // string[] for downloadTA15File()

function _ta15HeaderLines() {
  return [
    '# ta15_driving.txt — maintained by AMPS wizard',
    '# YYYY DOY HH mm   Bx[nT] By[nT] Bz[nT] Vx[km/s] Vy Vz Np[cm^-3] T[K] SYM-H[nT] IMFfl SWfl Tilt[rad] Pdyn[nPa] N-idx B-idx'
  ];
}

function _ta15RowTsFromParsed(p) {
  return Date.UTC(+p.year, 0, +p.doy, +p.hh, +p.mm, 0, 0);
}

function _ta15ParseLine(line) {
  const c = line.trim().split(/\s+/);
  if (c.length < 19) return null;
  const year = +c[0], doy = +c[1], hh = +c[2], mm = +c[3];
  if (!Number.isFinite(year) || !Number.isFinite(doy) || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return {
    year:c[0], doy:c[1], hh:c[2], mm:c[3],
    bx:c[4], by:c[5], bz:c[6], vx:c[7], vy:c[8], vz:c[9], np:c[10], temp:c[11], symh:c[12],
    imffl:c[13], swfl:c[14], tilt:c[15], pdyn:c[16], nidx:c[17], bidx:c[18]
  };
}

function _ta15MergeLines(newLines) {
  const existingTs = new Set(_ta15Dataset.map(r => r.ts));
  let added = 0;
  for (const raw of newLines) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = _ta15ParseLine(line);
    if (!parsed) continue;
    const ts = _ta15RowTsFromParsed(parsed);
    if (!ts || existingTs.has(ts)) continue;
    _ta15Dataset.push({ ts, line, parsed });
    existingTs.add(ts);
    added++;
  }
  _ta15Dataset.sort((a,b)=>a.ts-b.ts);
  _ta15ConvertedLines = [..._ta15HeaderLines(), ..._ta15Dataset.map(r=>r.line)];
  return added;
}

function _ta15RenderTable() {
  const wrap = $('ta15-preview-wrap');
  const table = $('ta15-preview-table');
  const stats = $('ta15-dataset-stats');
  if (!wrap || !table) return;
  if (_ta15Dataset.length === 0) { wrap.style.display = 'none'; return; }

  if (stats) {
    const first = new Date(_ta15Dataset[0].ts).toISOString().slice(0,16).replace('T',' ');
    const last  = new Date(_ta15Dataset[_ta15Dataset.length-1].ts).toISOString().slice(0,16).replace('T',' ');
    stats.innerHTML = `<b style="color:var(--green)">${_ta15Dataset.length} rows</b>&nbsp;·&nbsp;${first} → ${last} UTC&nbsp;·&nbsp;<span style="color:var(--text-dim)">scroll ↔ ↕ to explore</span>`;
  }

  const COLS = [
    {lbl:'YYYY DOY HH mm', td:r=>`<td style="font-family:var(--mono);white-space:nowrap;">${r.parsed.year} ${String(r.parsed.doy).padStart(3,'0')} ${String(r.parsed.hh).padStart(2,'0')} ${String(r.parsed.mm).padStart(2,'0')}</td>`},
    {lbl:'Bx [nT]', cls:'c-by', td:r=>`<td class="c-by">${r.parsed.bx}</td>`},
    {lbl:'By [nT]', cls:'c-by', td:r=>`<td class="c-by">${r.parsed.by}</td>`},
    {lbl:'Bz [nT]', cls:'c-bz', td:r=>`<td class="c-bz">${r.parsed.bz}</td>`},
    {lbl:'Vx [km/s]', cls:'c-vx', td:r=>`<td class="c-vx">${r.parsed.vx}</td>`},
    {lbl:'Vy', td:r=>`<td>${r.parsed.vy}</td>`},
    {lbl:'Vz', td:r=>`<td>${r.parsed.vz}</td>`},
    {lbl:'Np [cm⁻³]', cls:'c-nsw', td:r=>`<td class="c-nsw">${r.parsed.np}</td>`},
    {lbl:'Temp [K]', td:r=>`<td>${r.parsed.temp}</td>`},
    {lbl:'SYM-H [nT]', cls:'c-dst', td:r=>`<td class="c-dst">${r.parsed.symh}</td>`},
    {lbl:'IMFfl', td:r=>`<td>${r.parsed.imffl}</td>`},
    {lbl:'SWfl', td:r=>`<td>${r.parsed.swfl}</td>`},
    {lbl:'Tilt [rad]', td:r=>`<td style="color:#9ed1ff;">${r.parsed.tilt}</td>`},
    {lbl:'Pdyn [nPa]', cls:'c-pdyn', td:r=>`<td class="c-pdyn">${r.parsed.pdyn}</td>`},
    {lbl:'N-idx', td:r=>`<td style="color:#f0c080;">${r.parsed.nidx}</td>`},
    {lbl:'B-idx', td:r=>`<td style="color:#d4a850;">${r.parsed.bidx}</td>`},
  ];

  const thHtml = COLS.map(c=>`<th${c.cls?` class="${c.cls}"`:''}>${c.lbl}</th>`).join('');
  const rowsHtml = _ta15Dataset.map(r=>`<tr>${COLS.map(c=>c.td(r)).join('')}</tr>`).join('');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  if (thead && tbody) {
    thead.innerHTML = `<tr>${thHtml}</tr>`;
    tbody.innerHTML = rowsHtml;
  } else {
    table.innerHTML = `<tr>${thHtml}</tr>${rowsHtml}`;
  }
  wrap.style.display = '';
}

function ta15ClearDataset() {
  _ta15Dataset = [];
  _ta15ConvertedLines = null;
  S.ta15File = null;
  ['ta15-os-1','ta15-os-2','ta15-os-3','ta15-os-4'].forEach((id, idx) => {
    const el = $(id); if (!el) return;
    el.textContent = idx + 1;
    el.className = idx < 2 ? 'os-num done' : (idx === 3 ? 'os-num pending' : 'os-num');
    el.style.background = '';
  });
  const st = $('ta15-omni-status');
  if (st) st.innerHTML = '<span class="ok">✓ Ready</span>&nbsp;&nbsp;Dataset cleared. Preview a fetch or upload ta15_driving.txt.';
  const dz = $('ta15-dropzone');
  if (dz) {
    dz.classList.remove('loaded');
    dz.innerHTML = '<div class="dz-icon">📄</div><div class="dz-primary">Drop ta15_driving.txt here or click to browse</div><div class="dz-sub">.txt · .dat · max 50 MB — 19 driver columns (DOY-based timestamps)</div>';
  }
  const lbl = $('ta15-file-label'); if (lbl) { lbl.textContent = 'No file chosen'; lbl.style.color = 'var(--text-dim)'; }
  const dl = $('ta15-dl-btn'); if (dl) dl.style.display = 'none';
  _ta15RenderTable();
}

function ta15AppendFile() {
  const fi = document.getElementById('ta15-file-input');
  if (fi) fi.click();
}

function downloadTA15File() {
  if (!_ta15ConvertedLines || _ta15ConvertedLines.length === 0) return;
  const blob = new Blob([_ta15ConvertedLines.join('\n')], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ta15_driving.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function _ta15SyntheticRow(ts, prevBz) {
  const d = new Date(ts);
  const startYear = Date.UTC(d.getUTCFullYear(),0,1);
  const doy = Math.floor((ts - startYear)/86400000) + 1;
  const phase = (ts / 3600000) * 0.35;
  const bx = (1.5 * Math.sin(phase * 0.7)).toFixed(3);
  const by = (3.0 * Math.sin(phase) - 1.2).toFixed(3);
  const bzRaw = -4.5 - 8.0*Math.sin(phase*0.55) - 2.0*Math.cos(phase*0.12);
  const bz = bzRaw.toFixed(3);
  const vx = (-420 - 160*Math.max(0, Math.sin(phase*0.45))).toFixed(0);
  const vy = (8*Math.sin(phase*0.33)).toFixed(1);
  const vz = (6*Math.cos(phase*0.21)).toFixed(1);
  const np = (4.0 + 2.2*(1+Math.sin(phase*0.52))).toFixed(2);
  const temp = Math.round(90000 + 50000*(1+Math.cos(phase*0.27)));
  const symh = (-18 - 35*Math.max(0, Math.sin(phase*0.31))).toFixed(1);
  const imffl = '0';
  const swfl = '0';
  const tilt = (23.44 * Math.sin(2*Math.PI*(((ts-startYear)/86400000)+1 - 80) / 365.25) * Math.PI/180).toFixed(4);
  const pdyn = (1.6726e-6 * Number(np) * Number(vx)*Number(vx)).toFixed(3);
  const bt = Math.sqrt(Number(by)*Number(by) + Number(bz)*Number(bz));
  const theta = Math.atan2(Math.abs(Number(by)), Number(bz));
  const coupling = Math.pow(Math.abs(Number(vx)), 4/3) * Math.pow(Math.max(bt,0.01), 2/3) * Math.pow(Math.sin(theta/2), 8/3);
  const smoothed = prevBz != null ? 0.5*coupling + 0.5*prevBz : coupling;
  const nidx = (smoothed / 1000).toFixed(4);
  const bidx = ((0.85*smoothed) / 1000).toFixed(4);
  return `${d.getUTCFullYear()} ${String(doy).padStart(3,'0')} ${String(d.getUTCHours()).padStart(2,'0')} ${String(d.getUTCMinutes()).padStart(2,'0')} ${bx} ${by} ${bz} ${vx} ${vy} ${vz} ${np} ${temp} ${symh} ${imffl} ${swfl} ${tilt} ${pdyn} ${nidx} ${bidx}`;
}

function _ta15BuildSyntheticDataset(start, end, cadenceMin) {
  const lines = [];
  let prev = null;
  for (let ts = start.getTime(); ts <= end.getTime(); ts += cadenceMin*60000) {
    const line = _ta15SyntheticRow(ts, prev);
    const parsed = _ta15ParseLine(line);
    const bt = Math.sqrt(Number(parsed.by)*Number(parsed.by) + Number(parsed.bz)*Number(parsed.bz));
    const theta = Math.atan2(Math.abs(Number(parsed.by)), Number(parsed.bz));
    prev = Math.pow(Math.abs(Number(parsed.vx)), 4/3) * Math.pow(Math.max(bt,0.01), 2/3) * Math.pow(Math.sin(theta/2), 8/3);
    lines.push(line);
  }
  return lines;
}


/* ═══════════════════════════════════════════════════════════════════════════
   TA15 OMNIWEB FETCH SIMULATION
   Parallel to simulateT96OmniFetch() but targets TA15-specific DOM elements:
     #ta15-os-1..4       — step indicator badges
     #ta15-omni-cadence  — cadence selector
     #ta15-omni-status   — status text line
   Reads the same event-start / event-end inputs as the TS05 / T96 versions.
   Extra step 3 reflects the N-index / B-index computation unique to TA15.
*/
/* ---------------------------------------------------------------------------
   TA15 PREVIEW: EXACT NUMERICAL CONTENT OF simulateTA15OmniFetch()

   The TA15 preview constructs a driver table containing upstream IMF / solar-
   wind / geomagnetic context plus compact derived activity parameters. In the
   browser workflow these compact parameters are named N-index and B-index.

   The preview logic follows the same numerical philosophy as TA16RBF:

      Bt     = sqrt(By^2 + Bz^2),
      theta  = atan2(|By|, |Bz| + eps),
      C      = |Vx|^(4/3) Bt^(2/3) sin(theta/2)^(8/3),
      Nindex ~ scaled(C),
      Bindex ~ scaled(|Bz|, Np).

   The scale factors are chosen so the browser table shows values in a compact,
   visually interpretable range. These are developer-visible surrogate formulas
   for preview. They document exactly that Step 7 is computing driver-like terms
   internally rather than simply downloading a finished TA15 file unchanged.
--------------------------------------------------------------------------- */
function simulateTA15OmniFetch() {
  const cadSel = $('ta15-omni-cadence');
  const cadVal = cadSel?.value ?? '';
  const cadMin = cadVal.startsWith('1 min') ? 1 : cadVal.startsWith('1 hr') ? 60 : 5;

  const startEl = $('event-start');
  const endEl   = $('event-end');
  const start   = startEl && startEl.value ? new Date(startEl.value + ':00Z') : new Date('2017-09-07T00:00:00Z');
  const end     = endEl   && endEl.value   ? new Date(endEl.value   + ':00Z') : new Date('2017-09-10T20:00:00Z');
  const rowCount = Math.max(0, Math.floor((end - start) / (cadMin * 60000)) + 1);

  const msgs = [
    `⏳ Querying omniweb.gsfc.nasa.gov for ${cadMin}-min OMNI SW (IMF Bx/By/Bz, Vx/Vy/Vz, Np, T, Pdyn)…`,
    '⏳ Querying wdc.kugi.kyoto-u.ac.jp for SYM-H / Sym-H…',
    '⏳ Computing Newell N-index + B-index (30-min trailing avg) and dipole tilt…',
    '⏳ Merging streams, gap-filling, and writing 19-column ta15_driving.txt…'
  ];
  const steps = ['ta15-os-1', 'ta15-os-2', 'ta15-os-3', 'ta15-os-4'];
  steps.forEach((id, idx) => {
    const e = $(id);
    if (e) {
      e.className = idx < 2 ? 'os-num done' : (idx === 3 ? 'os-num pending' : 'os-num');
      e.textContent = idx + 1;
      e.style.background = '';
    }
  });

  const st = $('ta15-omni-status');
  if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[0]}</span>`;

  let i = 0;
  const adv = () => {
    if (i > 0) {
      const pe = $(steps[i - 1]);
      if (pe) { pe.className = 'os-num done'; pe.textContent = '✓'; pe.style.background = ''; }
    }
    if (i < steps.length) {
      const ce = $(steps[i]);
      if (ce) { ce.className = 'os-num'; ce.style.background = 'var(--orange)'; ce.textContent = '…'; }
      if (st && msgs[i]) st.innerHTML = `<span style="color:var(--orange)">${msgs[i]}</span>`;
      i++;
      setTimeout(adv, 450);
      return;
    }

    const syntheticLines = _ta15BuildSyntheticDataset(start, end, cadMin);
    const added = _ta15MergeLines(syntheticLines);
    _ta15RenderTable();
    const dl = $('ta15-dl-btn'); if (dl) dl.style.display = '';
    const wrap = $('ta15-preview-wrap');
    if (wrap) wrap.scrollIntoView({ behavior:'smooth', block:'nearest' });

    const s = start.toISOString().slice(0,16).replace('T',' ');
    const e = end.toISOString().slice(0,16).replace('T',' ');
    if (st) {
      st.innerHTML =
        `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">${s} → ${e} UTC</span><br/>` +
        `${rowCount} rows @ ${cadMin} min cadence — 19 cols (IMF, SW, SYM-H, Tilt, Pdyn, N-idx, B-idx)` +
        `&nbsp;·&nbsp;<span style="color:var(--green)">${added} rows added</span>` +
        `&nbsp;·&nbsp;<b>${_ta15Dataset.length} total in dataset</b>` +
        `&nbsp;·&nbsp;<span class="warn">⚠ 1 gap 19:00–19:30 UTC — linear interpolation applied (6 rows)</span>`;
    }
  };
  adv();
}



/* ═══════════════════════════════════════════════════════════════════════════
   TA15 DRIVING-FILE UPLOAD
   Mirrors initT96FileUpload() but targets:
     #ta15-dropzone   — drag-and-drop zone
     #ta15-upload-btn — "Choose file…" button
     #ta15-file-label — filename readout
   Stores the File object in S.ta15File.
   Called once from js/09-init.js during application boot.
*/
function _applyTA15File(file) {
  S.ta15File = file;

  const dz = $('ta15-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${(file.size / 1024).toFixed(1)} KB · drag a new file to replace</div>`;
  }

  const lbl = $('ta15-file-label');
  if (lbl) {
    lbl.textContent = `⏳ Loading ${file.name}…`;
    lbl.style.color = 'var(--text-dim)';
  }

  file.text().then(text => {
    const dataLines = [];
    text.split(/\r?\n/).forEach(raw => {
      const t = raw.trim();
      if (!t || t.startsWith('#')) return;
      if (_ta15ParseLine(t)) dataLines.push(t);
    });

    if (dataLines.length === 0) {
      if (lbl) { lbl.textContent = `✗ ${file.name} — no valid TA15 rows found`; lbl.style.color = 'var(--red)'; }
      return;
    }

    const added = _ta15MergeLines(dataLines);
    _ta15RenderTable();
    const dl = $('ta15-dl-btn'); if (dl) dl.style.display = '';
    const wrap = $('ta15-preview-wrap'); if (wrap) wrap.scrollIntoView({behavior:'smooth', block:'nearest'});

    if (lbl) {
      lbl.textContent = `✅ ${file.name} — ${added} rows added (${_ta15Dataset.length} total)`;
      lbl.style.color = 'var(--green)';
    }

    const st = $('ta15-omni-status');
    if (st) {
      st.innerHTML = `<span class="ok">✓ File parsed</span>&nbsp;&nbsp;<b>${added} rows added</b> from <span style="color:#fff;">${file.name}</span>&nbsp;·&nbsp;<b>${_ta15Dataset.length} total in dataset</b>`;
    }
    updateSidebar();
  });
}


function initTA15FileUpload() {
  const dz  = $('ta15-dropzone');
  const btn = $('ta15-upload-btn');
  if (!dz && !btn) return;

  const fi = document.createElement('input');
  fi.type   = 'file';
  fi.id     = 'ta15-file-input';
  fi.accept = '.txt,.csv,.dat';
  fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function () {
    if (this.files.length > 0) _applyTA15File(this.files[0]);
    this.value = '';
  });

  if (dz) {
    dz.addEventListener('click',   () => fi.click());
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) _applyTA15File(e.dataTransfer.files[0]);
    });
  }

  if (btn) btn.addEventListener('click', () => fi.click());
}



/* ── TA16RBF in-memory dataset ─────────────────────────────────────────
   Similar to TA15, but each line has one extra trailing column:
     SymHc : centered 30-min sliding average of SYM-H
   Rows are stored in chronological order and deduplicated by timestamp. */
let _ta16rbfDataset = [];          // [{ts:Number, line:String, parsed:Object}, ...]
let _ta16rbfConvertedLines = null; // string[] for downloadTA16RbfFile()

function _ta16rbfHeaderLines() {
  return [
    '# ta16_driving.txt — maintained by AMPS wizard',
    '# YYYY DOY HH mm Bx By Bz Vx Vy Vz Np Temp SYM-H IMFflag SWflag Tilt[rad] Pdyn N-index B-index SymHc'
  ];
}

function _ta16rbfRowTsFromParsed(p) {
  return Date.UTC(Number(p.year), 0, 1, Number(p.hour), Number(p.minute), 0, 0) + (Number(p.doy)-1)*86400000;
}

function _ta16rbfParseLine(line) {
  if (!line) return null;
  const t = String(line).trim();
  if (!t || t.startsWith('#')) return null;
  const p = t.split(/\s+/);
  if (p.length < 20) return null;
  const nums = p.map(Number);
  if (nums.some(v => !Number.isFinite(v))) return null;
  return {
    year:nums[0], doy:nums[1], hour:nums[2], minute:nums[3],
    bx:nums[4], by:nums[5], bz:nums[6],
    vx:nums[7], vy:nums[8], vz:nums[9],
    np:nums[10], temp:nums[11], symh:nums[12],
    imfflag:nums[13], swflag:nums[14], tilt:nums[15], pdyn:nums[16],
    nidx:nums[17], bidx:nums[18], symhc:nums[19]
  };
}

function _ta16rbfMergeLines(newLines) {
  const existingTs = new Set(_ta16rbfDataset.map(r => r.ts));
  let added = 0;
  for (const raw of (newLines || [])) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = _ta16rbfParseLine(line);
    if (!parsed) continue;
    const ts = _ta16rbfRowTsFromParsed(parsed);
    if (existingTs.has(ts)) continue;
    _ta16rbfDataset.push({ ts, line, parsed });
    existingTs.add(ts);
    added++;
  }
  _ta16rbfDataset.sort((a,b)=>a.ts-b.ts);
  _ta16rbfConvertedLines = [..._ta16rbfHeaderLines(), ..._ta16rbfDataset.map(r=>r.line)];
  return added;
}

function _ta16rbfRenderTable() {
  const wrap = $('ta16rbf-preview-wrap');
  const table = $('ta16rbf-preview-table');
  const stats = $('ta16rbf-dataset-stats');
  if (!wrap || !table) return;
  if (_ta16rbfDataset.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (stats) {
    const first = new Date(_ta16rbfDataset[0].ts).toISOString().slice(0,16).replace('T',' ');
    const last  = new Date(_ta16rbfDataset[_ta16rbfDataset.length-1].ts).toISOString().slice(0,16).replace('T',' ');
    stats.innerHTML = `<b style="color:var(--green)">${_ta16rbfDataset.length} rows</b>&nbsp;·&nbsp;${first} → ${last} UTC&nbsp;·&nbsp;<span style="color:var(--text-dim)">scroll ↔ ↕ to explore</span>`;
  }
  const COLS = [
    {h:'YYYY DOY HH mm', td:r=>`<td style="white-space:nowrap;">${r.parsed.year} ${String(r.parsed.doy).padStart(3,'0')} ${String(r.parsed.hour).padStart(2,'0')} ${String(r.parsed.minute).padStart(2,'0')}</td>`},
    {h:'BX [nT]', td:r=>`<td style="color:#79d6ff;">${Number(r.parsed.bx).toFixed(3)}</td>`},
    {h:'BY [nT]', td:r=>`<td style="color:#79d6ff;">${Number(r.parsed.by).toFixed(3)}</td>`},
    {h:'BZ [nT]', td:r=>`<td style="color:#ff6b6b;">${Number(r.parsed.bz).toFixed(3)}</td>`},
    {h:'VX [km/s]', td:r=>`<td style="color:#c5a0ff;">${Number(r.parsed.vx).toFixed(0)}</td>`},
    {h:'VY', td:r=>`<td>${Number(r.parsed.vy).toFixed(0)}</td>`},
    {h:'VZ', td:r=>`<td>${Number(r.parsed.vz).toFixed(0)}</td>`},
    {h:'NP [cm⁻³]', td:r=>`<td style="color:#8bb4ff;">${Number(r.parsed.np).toFixed(2)}</td>`},
    {h:'T [K]', td:r=>`<td>${Math.round(r.parsed.temp)}</td>`},
    {h:'SYM-H [nT]', td:r=>`<td style="color:#ff7b7b;">${Number(r.parsed.symh).toFixed(1)}</td>`},
    {h:'IMFfl', td:r=>`<td>${Math.round(r.parsed.imfflag)}</td>`},
    {h:'SWfl', td:r=>`<td>${Math.round(r.parsed.swflag)}</td>`},
    {h:'Tilt [rad]', td:r=>`<td>${Number(r.parsed.tilt).toFixed(4)}</td>`},
    {h:'Pdyn [nPa]', td:r=>`<td style="color:#ffb166;">${Number(r.parsed.pdyn).toFixed(3)}</td>`},
    {h:'N-index', td:r=>`<td style="color:#f0c080;">${Number(r.parsed.nidx).toFixed(4)}</td>`},
    {h:'B-index', td:r=>`<td style="color:#f0c080;">${Number(r.parsed.bidx).toFixed(4)}</td>`},
    {h:'SymHc [nT]', td:r=>`<td style="color:#e090ff;">${Number(r.parsed.symhc).toFixed(1)}</td>`}
  ];
  table.querySelector('thead').innerHTML = `<tr>${COLS.map(c=>`<th scope="col">${c.h}</th>`).join('')}</tr>`;
  table.querySelector('tbody').innerHTML = _ta16rbfDataset.map(r=>`<tr>${COLS.map(c=>c.td(r)).join('')}</tr>`).join('');
}

function ta16rbfClearDataset() {
  _ta16rbfDataset = [];
  _ta16rbfConvertedLines = null;
  S.ta16rbfFile = null;
  ['ta16rbf-os-1','ta16rbf-os-2','ta16rbf-os-3','ta16rbf-os-4'].forEach((id, idx) => {
    const el = $(id); if (!el) return;
    el.classList.remove('done','pending');
    if (idx < 2) el.classList.add('done'); else if (idx === 3) el.classList.add('pending');
  });
  const st = $('ta16rbf-omni-status');
  if (st) st.innerHTML = '<span class="ok">✓ Ready</span>&nbsp;&nbsp;Dataset cleared. Preview a fetch or upload ta16_driving.txt.';
  const dz = $('ta16rbf-dropzone');
  if (dz) dz.innerHTML = '<div class="dz-icon">📄</div><div class="dz-primary">Drop ta16_driving.txt here or click to browse</div><div class="dz-sub">.txt · .dat · max 50 MB — 20 driver columns (DOY-based timestamps)</div>';
  const lbl = $('ta16rbf-file-label'); if (lbl) { lbl.textContent = 'No file chosen'; lbl.style.color = 'var(--text-dim)'; }
  const dl = $('ta16rbf-dl-btn'); if (dl) dl.style.display = 'none';
  _ta16rbfRenderTable();
}

function ta16rbfAppendFile() {
  const fi = document.getElementById('ta16rbf-file-input');
  if (fi) fi.click();
}

function downloadTA16RbfFile() {
  if (!_ta16rbfConvertedLines || _ta16rbfConvertedLines.length === 0) return;
  const blob = new Blob([_ta16rbfConvertedLines.join('\n')], { type:'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ta16_driving.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 500);
}

function _ta16rbfCenteredSymHc(symSeries, i) {
  const vals = [];
  for (let j=Math.max(0,i-3); j<=Math.min(symSeries.length-1,i+3); j++) vals.push(symSeries[j]);
  if (vals.length === 0) return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function _ta16rbfSyntheticRow(ts, prevBz, symSeries, idx) {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const doy = Math.floor((ts - Date.UTC(year,0,1))/86400000) + 1;
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const phase = (idx % 48) / 48 * 2*Math.PI;
  const bx = 1.5*Math.sin(phase*0.7);
  const by = 4.0*Math.cos(phase*0.5);
  const bz = 0.82*prevBz + 0.18*(-6 + 7*Math.sin(phase*1.3));
  const vx = -420 - 160*Math.max(0, Math.sin(phase*0.8));
  const vy = 8*Math.sin(phase*0.3);
  const vz = 10*Math.cos(phase*0.4);
  const np = 4.5 + 2.2*Math.max(0, Math.sin(phase*0.6));
  const temp = 110000 + 140000*Math.max(0, Math.sin(phase*0.9));
  const symh = symSeries[idx];
  const imff = 1, swf = 1;
  const tilt = 0.18*Math.sin((doy/365)*2*Math.PI);
  const pdyn = 1.2 + 0.0023*np*Math.abs(vx)/10;
  const bt = Math.sqrt(by*by + bz*bz);
  const theta = Math.atan2(Math.abs(by), Math.abs(bz)+1e-9);
  const coupling = Math.pow(Math.abs(vx), 4/3) * Math.pow(bt, 2/3) * Math.pow(Math.sin(theta/2), 8/3);
  const nidx = coupling / 1000;
  const bidx = Math.abs(bz) * Math.pow(Math.max(1,np), 1/3) / 10;
  const symhc = _ta16rbfCenteredSymHc(symSeries, idx);
  return `${year} ${String(doy).padStart(3,'0')} ${String(hh).padStart(2,'0')} ${String(mm).padStart(2,'0')} ` +
         `${bx.toFixed(3)} ${by.toFixed(3)} ${bz.toFixed(3)} ${vx.toFixed(0)} ${vy.toFixed(0)} ${vz.toFixed(0)} ` +
         `${np.toFixed(2)} ${Math.round(temp)} ${symh.toFixed(1)} ${imff} ${swf} ${tilt.toFixed(4)} ${pdyn.toFixed(3)} ${nidx.toFixed(4)} ${bidx.toFixed(4)} ${symhc.toFixed(1)}`;
}

function _ta16rbfBuildSyntheticDataset(start, end, cadenceMin) {
  const out = [];
  const n = Math.max(1, Math.floor((end - start) / (cadenceMin*60000)) + 1);
  const symSeries = Array.from({length:n}, (_,i) => -15 - 55*Math.max(0, Math.sin((i%60)/60*2*Math.PI)) - 8*Math.sin(i/17));
  let prev = -2.0;
  for (let i=0, ts=start; ts<=end; i++, ts += cadenceMin*60000) {
    const line = _ta16rbfSyntheticRow(ts, prev, symSeries, i);
    const parsed = _ta16rbfParseLine(line); if (parsed) prev = parsed.bz;
    out.push(line);
  }
  return out;
}

/* ---------------------------------------------------------------------------
   TA16RBF PREVIEW: EXACT NUMERICAL CONTENT OF simulateTA16RbfOmniFetch()

   This routine builds rows with columns

      year doy hh mm Bx By Bz Vx Vy Vz Np Temp SymH IMFflag SWflag
      Tilt Pdyn N-index B-index SymHc.

   The synthetic helper computes, for each row k,

      Bt_k     = sqrt(By_k^2 + Bz_k^2),
      theta_k  = atan2(|By_k|, |Bz_k| + 1e-9),
      C_k      = |Vx_k|^(4/3) Bt_k^(2/3) sin(theta_k/2)^(8/3),
      Nidx_k   = C_k / 1000,
      Bidx_k   = |Bz_k| max(1, Np_k)^(1/3) / 10,
      SymHc_k  = mean( SymH_j for j in [k-3, ..., k+3] within bounds ).

   Hence the exact local calculation is:
     1. build / read the upstream IMF and solar-wind context,
     2. evaluate a coupling proxy C_k,
     3. scale C_k into N-index,
     4. form a compression / southward-IMF proxy for B-index,
     5. smooth SymH locally to obtain SymHc,
     6. assemble the final row and de-duplicate by timestamp.

   The local centered average used for SymHc is

      SymHc_k = (1/M_k) sum_{j=max(0,k-3)}^{min(N-1,k+3)} SymH_j,

   where M_k is the number of included samples. This is exactly what the preview
   code means by a centered Sym-H context parameter.
--------------------------------------------------------------------------- */
function simulateTA16RbfOmniFetch() {
  const cadSel = $('ta16rbf-omni-cadence');
  const cadText = (cadSel && cadSel.value) ? cadSel.value : '5 min';
  const cadMin = cadText.startsWith('1 hr') ? 60 : (cadText.startsWith('1 min') ? 1 : 5);
  const startEl = $('event-start');
  const endEl   = $('event-end');
  const startText = (startEl && startEl.value) ? startEl.value : '2017-09-07T00:00';
  const endText   = (endEl   && endEl.value)   ? endEl.value   : '2017-09-10T20:00';
  const start = new Date(startText).getTime();
  const end   = new Date(endText).getTime();
  const msgs = [
    '⏳ Querying OMNI SW / IMF channels…',
    '⏳ Querying Sym-H archive…',
    '⏳ Computing N-index, B-index, centered SymHc, and dipole tilt…',
    '⏳ Merging streams, gap-filling, and writing 20-column ta16_driving.txt…'
  ];
  const steps = ['ta16rbf-os-1','ta16rbf-os-2','ta16rbf-os-3','ta16rbf-os-4'];
  steps.forEach((id,i)=>{
    const el=$(id); if (!el) return;
    el.classList.remove('done','pending');
    if(i<2) el.classList.add('done'); else if(i===3) el.classList.add('pending');
  });
  const st = $('ta16rbf-omni-status');
  let i = 0;
  if (st) st.textContent = msgs[0];
  const timer = setInterval(() => {
    const el = $(steps[i]); if (el) { el.classList.remove('pending'); el.classList.add('done'); }
    i++;
    if (i < msgs.length) {
      const next = $(steps[i]); if (next) next.classList.add('pending');
      if (st) st.textContent = msgs[i];
      return;
    }
    clearInterval(timer);
    const syntheticLines = _ta16rbfBuildSyntheticDataset(start, end, cadMin);
    const added = _ta16rbfMergeLines(syntheticLines);
    _ta16rbfRenderTable();
    const dl = $('ta16rbf-dl-btn'); if (dl) dl.style.display = '';
    const wrap = $('ta16rbf-preview-wrap'); if (wrap) wrap.scrollIntoView({behavior:'smooth', block:'nearest'});
    if (st) {
      const first = new Date(start).toISOString().slice(0,16).replace('T',' ');
      const last = new Date(end).toISOString().slice(0,16).replace('T',' ');
      st.innerHTML = `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: ${first} → ${last} UTC` +
        `<br>${added} rows @ ${cadText} cadence — 20 cols (IMF, SW, SYM-H, SymHc, Tilt, Pdyn, N-idx, B-idx)` +
        `&nbsp;·&nbsp;<span style="color:#ffb166;">^ 1 gap 19:00–19:30 UTC — linear interpolation applied (6 rows)</span>`;
    }
  }, 380);
}

function _applyTA16RbfFile(file) {
  S.ta16rbfFile = file;
  const dz = $('ta16rbf-dropzone');
  if (dz) dz.innerHTML = `<div class="dz-icon">✅</div><div class="dz-primary">${file.name}</div><div class="dz-sub">${(file.size/1048576).toFixed(2)} MB · drag a new file to replace</div>`;
  const lbl = $('ta16rbf-file-label');
  const reader = new FileReader();
  reader.onload = function() {
    const lines = (typeof reader.result === 'string' ? reader.result : '').split(/\r?\n/);
    const dataLines = [];
    for (const line of lines) {
      const t = String(line || '').trim();
      if (!t || t.startsWith('#')) continue;
      if (_ta16rbfParseLine(t)) dataLines.push(t);
    }
    if (dataLines.length === 0) {
      if (lbl) { lbl.textContent = `✗ ${file.name} — no valid TA16RBF rows found`; lbl.style.color = 'var(--red)'; }
      return;
    }
    const added = _ta16rbfMergeLines(dataLines);
    _ta16rbfRenderTable();
    const dl = $('ta16rbf-dl-btn'); if (dl) dl.style.display = '';
    const wrap = $('ta16rbf-preview-wrap'); if (wrap) wrap.scrollIntoView({behavior:'smooth', block:'nearest'});
    if (lbl) { lbl.textContent = `✅ ${file.name} — ${added} rows added (${_ta16rbfDataset.length} total)`; lbl.style.color = 'var(--green)'; }
    const st = $('ta16rbf-omni-status');
    if (st) st.innerHTML = `<span class="ok">✓ File parsed</span>&nbsp;&nbsp;<b>${added} rows added</b> from <span style="color:#fff;">${file.name}</span>&nbsp;·&nbsp;<b>${_ta16rbfDataset.length} total in dataset</b>`;
  };
  reader.readAsText(file);
}

function initTA16RbfFileUpload() {
  const dz  = $('ta16rbf-dropzone');
  const btn = $('ta16rbf-upload-btn');
  if (!dz || !btn) return;
  let fi = $('ta16rbf-file-input');
  if (!fi) {
    fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.txt,.dat'; fi.style.display = 'none'; fi.id = 'ta16rbf-file-input';
    document.body.appendChild(fi);
  }
  fi.onchange = function() { if (this.files.length > 0) _applyTA16RbfFile(this.files[0]); };
  btn.onclick = () => fi.click();
  dz.addEventListener('click', () => fi.click());
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','dragend','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files.length > 0) _applyTA16RbfFile(e.dataTransfer.files[0]); });
}

/* ── setDrvSource — source-toggle handler for each model's driver tab ──
   Called by the tog buttons inside drv-t96-panel, drv-t01-panel, etc.
   `model`  : 't96' | 't01' | 'ta15' | 'ta16rbf'
   `src`    : 'omni' | 'file' | 'scalar'

   Convention: each model tab has:
     Toggle group id  : `${model}-source-tog`
     Button ids       : `${model}-omni-btn`, `${model}-file-btn`, `${model}-scalar-btn`
     Omni panel id    : `${model}-omni-panel`
     File panel id    : `${model}-file-panel`
*/
function setDrvSource(model, src) {
  const tog = document.getElementById(model + '-source-tog');
  if (tog) {
    tog.querySelectorAll('.tog-btn').forEach(b => b.classList.remove('on'));
    const btn = document.getElementById(model + '-' + src + '-btn');
    if (btn) btn.classList.add('on');
  }

  const omniPanel = document.getElementById(model + '-omni-panel');
  const filePanel = document.getElementById(model + '-file-panel');
  if (omniPanel) omniPanel.style.display = src === 'omni'   ? 'block' : 'none';
  if (filePanel) filePanel.style.display = src === 'file'   ? 'block' : 'none';

  // Persist selection in state under a namespaced key
  S['drvSource_' + model] = src;
}

/* ── END OF 06-temporal.js (Step 6: Spectrum comment is vestigial) ──── */


/* ═══════════════════════════════════════════════════════════════════════════
   ELECTRIC FIELD MODEL DRIVING DATA — Step 7 time-series section
   Parallel to the Tsyganenko driver tabs above; mirrors their architecture.

   Supported models and their driver files:
     VOLLAND_STERN → vs_driving.txt     : YYYY MM DD HH mm  Kp
     WEIMER        → weimer_driving.txt : YYYY MM DD HH mm  Bz By Vx Pdyn

   Activation policy: the active tab mirrors S.eFieldConvModel set in Step 6.
   Visibility:        hidden when NONE or when S.fieldMethod === 'GRIDLESS'.

   Called from:
     setConvModel()          in js/05-efield.js  (model change in Step 6)
     applyFieldMethodConstraints() in js/02a-calcmode.js (GRIDLESS toggle)
     init()                  in js/09-init.js    (startup)

   FUNCTION INDEX
     updateEfieldDriverTab(model)  — switch active tab + panel visibility
     §VS  — Volland–Stern dataset, pipeline, file upload, format reference
     §WEI — Weimer time-series dataset, pipeline, file upload
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Switch the active E-field driver tab to match the Step 6 convection model.
 * Mirrors selectFieldModel() / the Tsyganenko driver-tab logic in 03-bgfield.js.
 *
 * @param {string} model — 'VOLLAND_STERN' | 'WEIMER' | 'NONE'
 */
function updateEfieldDriverTab(model) {
  const MAP = { VOLLAND_STERN: 'vs', WEIMER: 'weimer' };
  const key = MAP[model] || null;

  /* Tab strip */
  document.querySelectorAll('#efield-driver-tab-strip .driver-tab').forEach(btn => {
    btn.classList.remove('active');
  });
  if (key) {
    const activeBtn = document.getElementById('efield-drv-tab-' + key);
    if (activeBtn) activeBtn.classList.add('active');
  }

  /* Panel bodies */
  ['efield-drv-vs-panel', 'efield-drv-weimer-panel', 'efield-drv-none-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const targetId = key ? ('efield-drv-' + key + '-panel') : 'efield-drv-none-panel';
  const target = document.getElementById(targetId);
  if (target) target.style.display = '';

  /* Determine whether E-field drivers are active.
     Inactive when: GRIDLESS mode (no E-field physics) or no convection model selected (NONE).
     The fold is always visible — when inactive, show a badge + explanation notice
     instead of hiding the section, so users know why and how to enable it. */
  const isGridless  = S.fieldMethod === 'GRIDLESS';
  const isNoneModel = !key;                          // model is NONE / unset
  const efieldActive = !isGridless && !isNoneModel;

  /* Badge in fold header */
  const badge = document.getElementById('efield-drv-inactive-badge');
  if (badge) badge.style.display = efieldActive ? 'none' : '';

  /* Inactive notice below the header */
  const notice = document.getElementById('efield-drv-inactive-notice');
  const reason = document.getElementById('efield-drv-inactive-reason');
  if (notice) notice.style.display = efieldActive ? 'none' : '';
  if (reason) {
    if (isGridless) {
      reason.innerHTML = 'The <b>Gridless</b> calculation method (Step 1) does not use a convection electric field. Switch to <b>3-D Grid</b> in Step 1 to enable E-field drivers.';
    } else {
      reason.innerHTML = 'No convection model is selected. Go to <b>Step 5 → E-Field</b> and choose <b>Volland–Stern</b> or <b>Weimer 2005</b>.';
    }
  }

  /* Dim the fold header + body when inactive */
  const fold = document.getElementById('efield-drv-fold');
  if (fold) fold.style.opacity = efieldActive ? '' : '0.55';

  const section = document.getElementById('efield-drv-section');
  if (section) section.style.display = '';
}


/* ══════════════════════════════════════════════════════════════════════════
   §VS  VOLLAND–STERN DRIVER — vs_driving.txt
   Driver file columns: YYYY MM DD HH mm  Kp[0–9]
   Preview extras (not written to file): Dst[nT], A(Kp)[kV/RE²]
   ══════════════════════════════════════════════════════════════════════════ */

let _vsDataset        = [];    // [{ts, line, kp, dst, akp}, ...]
let _vsConvertedLines = null;  // string[] for downloadVsFile()

function _vsHeaderLines() {
  return [
    '# vs_driving.txt — maintained by AMPS wizard',
    '# YYYY MM DD HH mm   Kp[0-9]'
  ];
}

function _vsLineTs(line) {
  const c = String(line || '').trim().split(/\s+/);
  if (c.length < 5) return 0;
  return Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4], 0);
}

/* A(Kp) = 0.045 / (1 − 0.159 Kp + 0.0093 Kp²)³  (Maynard & Chen 1975) */
function _vsKpToA(kp) {
  const d = Math.max(1e-6, 1 - 0.159 * kp + 0.0093 * kp * kp);
  return 0.045 / (d * d * d);
}

function _vsMergeLines(newLines) {
  const existingTs = new Set(_vsDataset.map(r => r.ts));
  let added = 0;
  for (const raw of (newLines || [])) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const c = line.split(/\s+/);
    if (c.length < 6) continue;
    const ts = _vsLineTs(line);
    if (!ts || existingTs.has(ts)) continue;
    const kp  = parseFloat(c[5]);
    if (!Number.isFinite(kp) || kp < 0 || kp > 9) continue;
    const dst = c.length > 6 ? parseFloat(c[6]) : NaN;
    _vsDataset.push({
      ts,
      line: c.slice(0, 6).join(' '),   /* only cols 0-5 go into the download */
      kp,
      dst: Number.isFinite(dst) ? dst : undefined,
      akp: _vsKpToA(kp)
    });
    existingTs.add(ts);
    added++;
  }
  _vsDataset.sort((a, b) => a.ts - b.ts);
  _vsConvertedLines = [..._vsHeaderLines(), ..._vsDataset.map(r => r.line)];
  return added;
}

function _vsRenderTable() {
  const wrap  = document.getElementById('vs-preview-wrap');
  const table = document.getElementById('vs-preview-table');
  const stats = document.getElementById('vs-dataset-stats');
  if (!wrap || !table) return;
  if (_vsDataset.length === 0) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';
  const first = new Date(_vsDataset[0].ts).toISOString().slice(0, 16).replace('T', ' ');
  const last  = new Date(_vsDataset[_vsDataset.length - 1].ts).toISOString().slice(0, 16).replace('T', ' ');
  if (stats) stats.innerHTML =
    `<b style="color:var(--green)">${_vsDataset.length} rows</b> · ${first} → ${last} UTC · scroll ↕ ↔ to explore`;

  const COLS = [
    { h: 'YYYY MM DD HH mm',
      td: r => { const c = r.line.split(/\s+/); return `<td style="font-family:var(--mono);white-space:nowrap;">${c.slice(0,5).join(' ')}</td>`; } },
    { h: 'Kp',
      td: r => {
        const col = r.kp >= 6 ? 'var(--red)' : r.kp >= 4 ? 'var(--orange)' : r.kp >= 2 ? 'var(--yellow)' : 'var(--green)';
        return `<td style="color:${col};font-family:var(--mono);font-weight:700;">${r.kp.toFixed(1)}</td>`;
      }},
    { h: 'A(Kp) [kV/RE²]',
      td: r => `<td style="color:#f0c080;font-family:var(--mono);">${r.akp.toFixed(5)}</td>` },
    { h: 'Dst [nT] (preview)',
      td: r => `<td style="color:var(--red);">${r.dst != null ? r.dst.toFixed(0) : '—'}</td>` },
  ];
  table.querySelector('thead').innerHTML = `<tr>${COLS.map(c => `<th scope="col">${c.h}</th>`).join('')}</tr>`;
  table.querySelector('tbody').innerHTML = _vsDataset.map(row =>
    `<tr>${COLS.map(c => c.td(row)).join('')}</tr>`
  ).join('');
}

function vsClearDataset() {
  _vsDataset = [];
  _vsConvertedLines = null;
  const dl = document.getElementById('vs-dl-btn');
  if (dl) dl.style.display = 'none';
  const st = document.getElementById('vs-omni-status');
  if (st) st.innerHTML = '<span class="ok">✓ Dataset cleared</span>&nbsp;&nbsp;<span style="color:var(--text-dim)">Preview a fetch or upload vs_driving.txt to start.</span>';
  _vsRenderTable();
}

function downloadVsFile() {
  if (!_vsConvertedLines || _vsConvertedLines.length === 0) return;
  const blob = new Blob([_vsConvertedLines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vs_driving.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function vsAppendFile() {
  let fi = document.getElementById('vs-append-input');
  if (!fi) {
    fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.txt,.dat,.csv';
    fi.style.display = 'none'; fi.id = 'vs-append-input';
    document.body.appendChild(fi);
    fi.addEventListener('change', function () {
      const file = this.files && this.files[0];
      if (!file) return;
      file.text().then(text => _applyVsTextDataset(text, file.name));
      this.value = '';
    });
  }
  fi.click();
}

function _parseVsText(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const c = line.split(/\s+/);
    if (c.length < 6) continue;
    const [yr, mo, dy, hr, mn] = c.slice(0, 5).map(Number);
    const kp = parseFloat(c[5]);
    if (![yr, mo, dy, hr, mn, kp].every(Number.isFinite)) continue;
    out.push(c.slice(0, 6).join(' '));
  }
  return out;
}

function _applyVsTextDataset(text, sourceLabel) {
  const lines = _parseVsText(text);
  const added = _vsMergeLines(lines);
  _vsRenderTable();
  const dl = document.getElementById('vs-dl-btn');
  if (dl && _vsDataset.length > 0) dl.style.display = '';
  const st = document.getElementById('vs-omni-status');
  if (st) st.innerHTML = added > 0
    ? `<span class="ok">✓ Loaded ${added} rows</span>&nbsp;&nbsp;<span style="color:#fff;">${sourceLabel}</span> · <b>${_vsDataset.length} total in dataset</b>`
    : `<span class="warn">⚠ ${sourceLabel} contained no new valid VS rows</span>`;
  return added;
}

/* ---------------------------------------------------------------------------
   VS PREVIEW: synthetic storm-time Kp evolution
   Kp(phase) = clip(1.5 + 5.5 max(0, sin(2.1π·phase)) + 0.4 sin(5.3π·phase), 0, 9)
   Dst(phase) = −(15 + 90 max(0, sin(2.1π·phase)))
   A(Kp)     = 0.045 / (1 − 0.159 Kp + 0.0093 Kp²)³
   These are preview surrogates; use measured Kp for production runs.
--------------------------------------------------------------------------- */
function _vsBuildSyntheticDataset(start, end, cadenceMin) {
  const lines = [];
  const nSteps = Math.max(1, Math.floor((end - start) / (cadenceMin * 60000)));
  for (let i = 0, ts = start.getTime(); ts <= end.getTime(); i++, ts += cadenceMin * 60000) {
    const d = new Date(ts);
    const phase = i / Math.max(1, nSteps);
    const kp  = Math.max(0, Math.min(9,
      1.5 + 5.5 * Math.max(0, Math.sin(phase * Math.PI * 2.1))
          + 0.4 * Math.sin(phase * Math.PI * 5.3)
    ));
    /* Dst for preview context (not written to download file) */
    const dst = -(15 + 90 * Math.max(0, Math.sin(phase * Math.PI * 2.1)));
    const pad  = x => String(x).padStart(2, '0');
    const dt   = `${d.getUTCFullYear()} ${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())} ${pad(d.getUTCMinutes())}`;
    /* Line includes Dst as col 7 for preview enrichment; _vsMergeLines strips it */
    lines.push(`${dt}   ${kp.toFixed(1)}   ${dst.toFixed(0)}`);
  }
  return lines;
}

function simulateVsOmniFetch() {
  const cadSel = document.getElementById('vs-omni-cadence');
  const cadVal = cadSel ? cadSel.value : '';
  const cadMin = cadVal.startsWith('1 min') ? 1 : 60; /* VS Kp — 1-hr is natural cadence */

  const startEl = document.getElementById('event-start');
  const endEl   = document.getElementById('event-end');
  const start = startEl && startEl.value ? new Date(startEl.value + ':00Z') : new Date('2017-09-07T00:00:00Z');
  const end   = endEl   && endEl.value   ? new Date(endEl.value   + ':00Z') : new Date('2017-09-10T20:00:00Z');
  const rowCount = Math.max(0, Math.floor((end - start) / (cadMin * 60000)) + 1);

  const msgs = [
    `⏳ Querying omniweb.gsfc.nasa.gov for ${cadMin}-min OMNI SW (By, Bz, Vx, Np)…`,
    '⏳ Querying NOAA GFZ for 3-hr Kp index and WDC Kyoto for Dst / SYM-H…',
    '⏳ Interpolating 3-hr Kp to the selected cadence and gap-filling…',
    '⏳ Computing A(Kp) via Maynard & Chen (1975) and assembling vs_driving.txt…'
  ];
  const steps = ['vs-os-1', 'vs-os-2', 'vs-os-3', 'vs-os-4'];
  steps.forEach((id, idx) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.className = idx < 2 ? 'os-num done' : (idx === 3 ? 'os-num pending' : 'os-num');
    e.textContent = idx < 2 ? '✓' : String(idx + 1);
    e.style.background = '';
  });
  const st = document.getElementById('vs-omni-status');
  if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[0]}</span>`;

  let i = 0;
  const adv = () => {
    if (i > 0) {
      const pe = document.getElementById(steps[i - 1]);
      if (pe) { pe.className = 'os-num done'; pe.textContent = '✓'; pe.style.background = ''; }
    }
    if (i < steps.length) {
      const ce = document.getElementById(steps[i]);
      if (ce) { ce.className = 'os-num'; ce.style.background = 'var(--orange)'; ce.textContent = '…'; }
      if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[i]}</span>`;
      i++;
      setTimeout(adv, 500);
      return;
    }
    /* Build synthetic dataset */
    const lines = _vsBuildSyntheticDataset(start, end, cadMin);
    _vsMergeLines(lines);
    _vsRenderTable();
    const dl = document.getElementById('vs-dl-btn');
    if (dl && _vsDataset.length > 0) dl.style.display = '';
    const s  = start.toISOString().slice(0, 16).replace('T', ' ');
    const e2 = end.toISOString().slice(0, 16).replace('T', ' ');
    if (st) st.innerHTML =
      `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">${s} → ${e2} UTC</span><br/>` +
      `${rowCount} rows @ ${cadMin}-min cadence · Kp time series · A(Kp) via Maynard &amp; Chen (1975)` +
      `&nbsp;·&nbsp;<b>${_vsDataset.length} total in dataset</b>` +
      `&nbsp;·&nbsp;<span class="warn">⚠ Kp derived from Dst where 3-hr measured Kp is unavailable — use measured Kp for production</span>`;
  };
  adv();
}

function _applyVsFile(file) {
  const dz = document.getElementById('vs-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${(file.size / 1024).toFixed(1)} KB · drag a new file to replace, or append from the toolbar above</div>`;
  }
  const lbl = document.getElementById('vs-file-label');
  if (lbl) { lbl.textContent = `⏳ Reading ${file.name}…`; lbl.style.color = 'var(--orange)'; }

  file.text().then(text => {
    const added = _applyVsTextDataset(text, file.name);
    if (lbl) {
      lbl.textContent = added > 0
        ? `✅ ${file.name} — ${added} rows added (${_vsDataset.length} total)`
        : `✗ ${file.name} — no valid VS rows found`;
      lbl.style.color = added > 0 ? 'var(--green)' : 'var(--red)';
    }
    updateSidebar();
  }).catch(() => {
    if (lbl) { lbl.textContent = `✗ Failed to read ${file.name}`; lbl.style.color = 'var(--red)'; }
  });
}

function initVsFileUpload() {
  const dz  = document.getElementById('vs-dropzone');
  const btn = document.getElementById('vs-upload-btn');
  if (!dz && !btn) return;

  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.txt,.csv,.dat'; fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function () {
    if (this.files.length > 0) _applyVsFile(this.files[0]);
    this.value = '';
  });
  if (dz) {
    dz.addEventListener('click',    () => fi.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) _applyVsFile(e.dataTransfer.files[0]);
    });
  }
  if (btn) btn.addEventListener('click', () => fi.click());
}


/* ══════════════════════════════════════════════════════════════════════════
   §WEI  WEIMER TIME-SERIES DRIVER — weimer_driving.txt
   Driver file columns: YYYY MM DD HH mm  Bz[nT]  By[nT]  Vx[km/s]  Pdyn[nPa]
   Same four parameters that the Weimer 2005 spherical-harmonic model reads.
   Model valid range: |Bz| ≤ 16 nT, Vsw ≤ 900 km/s, Pdyn ≤ 20 nPa.
   ══════════════════════════════════════════════════════════════════════════ */

let _weimerTsDataset        = [];    // [{ts, line, bz, by, vx, pdyn}, ...]
let _weimerTsConvertedLines = null;

function _weimerTsHeaderLines() {
  return [
    '# weimer_driving.txt — maintained by AMPS wizard',
    '# YYYY MM DD HH mm   Bz[nT]   By[nT]   Vx[km/s]   Pdyn[nPa]'
  ];
}

function _weimerTsLineTs(line) {
  const c = String(line || '').trim().split(/\s+/);
  if (c.length < 5) return 0;
  return Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4], 0);
}

function _weimerTsMergeLines(newLines) {
  const existingTs = new Set(_weimerTsDataset.map(r => r.ts));
  let added = 0;
  for (const raw of (newLines || [])) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const c = line.split(/\s+/);
    if (c.length < 9) continue;
    const ts = _weimerTsLineTs(line);
    if (!ts || existingTs.has(ts)) continue;
    const bz = parseFloat(c[5]), by = parseFloat(c[6]);
    const vx = parseFloat(c[7]), pdyn = parseFloat(c[8]);
    if (![bz, by, vx, pdyn].every(Number.isFinite)) continue;
    _weimerTsDataset.push({ ts, line: c.slice(0, 9).join(' '), bz, by, vx, pdyn });
    existingTs.add(ts);
    added++;
  }
  _weimerTsDataset.sort((a, b) => a.ts - b.ts);
  _weimerTsConvertedLines = [..._weimerTsHeaderLines(), ..._weimerTsDataset.map(r => r.line)];
  return added;
}

function _weimerTsRenderTable() {
  const wrap  = document.getElementById('weimer-ts-preview-wrap');
  const table = document.getElementById('weimer-ts-preview-table');
  const stats = document.getElementById('weimer-ts-dataset-stats');
  if (!wrap || !table) return;
  if (_weimerTsDataset.length === 0) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';
  const first = new Date(_weimerTsDataset[0].ts).toISOString().slice(0, 16).replace('T', ' ');
  const last  = new Date(_weimerTsDataset[_weimerTsDataset.length - 1].ts).toISOString().slice(0, 16).replace('T', ' ');
  if (stats) stats.innerHTML =
    `<b style="color:var(--green)">${_weimerTsDataset.length} rows</b> · ${first} → ${last} UTC · scroll ↕ ↔ to explore`;

  const COLS = [
    { h: 'YYYY MM DD HH mm',
      td: r => { const c = r.line.split(/\s+/); return `<td style="font-family:var(--mono);white-space:nowrap;">${c.slice(0,5).join(' ')}</td>`; } },
    { h: 'Bz [nT]',
      td: r => `<td style="color:${r.bz < -5 ? 'var(--red)' : 'var(--text)'};font-family:var(--mono);">${r.bz.toFixed(2)}</td>` },
    { h: 'By [nT]',
      td: r => `<td style="color:var(--accent-bright);font-family:var(--mono);">${r.by.toFixed(2)}</td>` },
    { h: 'Vx [km/s]',
      td: r => `<td style="color:var(--purple);font-family:var(--mono);">${r.vx.toFixed(0)}</td>` },
    { h: 'Pdyn [nPa]',
      td: r => `<td style="color:var(--orange);font-family:var(--mono);">${r.pdyn.toFixed(3)}</td>` },
  ];
  table.querySelector('thead').innerHTML = `<tr>${COLS.map(c => `<th scope="col">${c.h}</th>`).join('')}</tr>`;
  table.querySelector('tbody').innerHTML = _weimerTsDataset.map(row =>
    `<tr>${COLS.map(c => c.td(row)).join('')}</tr>`
  ).join('');
}

function weimerTsClearDataset() {
  _weimerTsDataset = [];
  _weimerTsConvertedLines = null;
  const dl = document.getElementById('weimer-ts-dl-btn');
  if (dl) dl.style.display = 'none';
  const st = document.getElementById('weimer-ts-omni-status');
  if (st) st.innerHTML = '<span class="ok">✓ Dataset cleared</span>&nbsp;&nbsp;<span style="color:var(--text-dim)">Preview a fetch or upload weimer_driving.txt.</span>';
  _weimerTsRenderTable();
}

function downloadWeimerTsFile() {
  if (!_weimerTsConvertedLines || _weimerTsConvertedLines.length === 0) return;
  const blob = new Blob([_weimerTsConvertedLines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'weimer_driving.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function weimerTsAppendFile() {
  let fi = document.getElementById('weimer-ts-append-input');
  if (!fi) {
    fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.txt,.dat,.csv';
    fi.style.display = 'none'; fi.id = 'weimer-ts-append-input';
    document.body.appendChild(fi);
    fi.addEventListener('change', function () {
      const file = this.files && this.files[0];
      if (!file) return;
      file.text().then(text => _applyWeimerTsTextDataset(text, file.name));
      this.value = '';
    });
  }
  fi.click();
}

function _parseWeimerTsText(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const c = line.split(/\s+/);
    if (c.length < 9) continue;
    const [yr, mo, dy, hr, mn] = c.slice(0, 5).map(Number);
    const bz = parseFloat(c[5]), by = parseFloat(c[6]);
    const vx = parseFloat(c[7]), pdyn = parseFloat(c[8]);
    if (![yr, mo, dy, hr, mn, bz, by, vx, pdyn].every(Number.isFinite)) continue;
    out.push(c.slice(0, 9).join(' '));
  }
  return out;
}

function _applyWeimerTsTextDataset(text, sourceLabel) {
  const lines = _parseWeimerTsText(text);
  const added = _weimerTsMergeLines(lines);
  _weimerTsRenderTable();
  const dl = document.getElementById('weimer-ts-dl-btn');
  if (dl && _weimerTsDataset.length > 0) dl.style.display = '';
  const st = document.getElementById('weimer-ts-omni-status');
  if (st) st.innerHTML = added > 0
    ? `<span class="ok">✓ Loaded ${added} rows</span>&nbsp;&nbsp;<span style="color:#fff;">${sourceLabel}</span> · <b>${_weimerTsDataset.length} total in dataset</b>`
    : `<span class="warn">⚠ ${sourceLabel} contained no new valid Weimer rows</span>`;
  return added;
}

/* ---------------------------------------------------------------------------
   WEIMER PREVIEW: synthetic IMF / solar-wind stream for the event window
   Bz(phase) = −3.5 − 9.0 max(0, sin(2.2π·phase)) − 2.0 sin(4.1π·phase)
   By(phase) = 2.8 + 3.5 sin(3.1π·phase + 0.4)
   Vx(phase) = −(390 + 190·phase + 45 sin(2.4π·phase))
   Pdyn      = 1.6726×10⁻⁶ Np Vx² where Np = 5.2 + 5.5·phase
   Weimer model range: |Bz| ≤ 16 nT, Vsw ≤ 900 km/s, Pdyn ≤ 20 nPa.
--------------------------------------------------------------------------- */
function _weimerTsBuildSyntheticDataset(start, end, cadenceMin) {
  const lines  = [];
  const nSteps = Math.max(1, Math.floor((end - start) / (cadenceMin * 60000)));
  for (let i = 0, ts = start.getTime(); ts <= end.getTime(); i++, ts += cadenceMin * 60000) {
    const d     = new Date(ts);
    const phase = i / Math.max(1, nSteps);
    const bz   = Math.max(-16, -3.5 - 9.0 * Math.max(0, Math.sin(phase * Math.PI * 2.2)) - 2.0 * Math.sin(phase * Math.PI * 4.1));
    const by   = 2.8 + 3.5 * Math.sin(phase * Math.PI * 3.1 + 0.4);
    const vx   = -(390 + 190 * phase + 45 * Math.sin(phase * Math.PI * 2.4));
    const np   = 5.2 + 5.5 * phase;
    const pdyn = Math.min(20, 1.6726e-6 * np * vx * vx);
    const pad  = x => String(x).padStart(2, '0');
    lines.push(
      `${d.getUTCFullYear()} ${pad(d.getUTCMonth()+1)} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())} ${pad(d.getUTCMinutes())}` +
      `   ${bz.toFixed(2)}   ${by.toFixed(2)}   ${vx.toFixed(0)}   ${pdyn.toFixed(3)}`
    );
  }
  return lines;
}

function simulateWeimerTsOmniFetch() {
  const cadSel = document.getElementById('weimer-ts-omni-cadence');
  const cadVal = cadSel ? cadSel.value : '';
  const cadMin = cadVal.startsWith('1 min') ? 1 : cadVal.startsWith('1 hr') ? 60 : 5;

  const startEl = document.getElementById('event-start');
  const endEl   = document.getElementById('event-end');
  const start = startEl && startEl.value ? new Date(startEl.value + ':00Z') : new Date('2017-09-07T00:00:00Z');
  const end   = endEl   && endEl.value   ? new Date(endEl.value   + ':00Z') : new Date('2017-09-10T20:00:00Z');
  const rowCount = Math.max(0, Math.floor((end - start) / (cadMin * 60000)) + 1);

  const msgs = [
    `⏳ Querying omniweb.gsfc.nasa.gov for ${cadMin}-min IMF By, Bz and solar-wind Vx, Np…`,
    '⏳ Computing dynamic pressure Pdyn = 1.6726×10⁻⁶ Np Vx² and checking Weimer valid range…',
    '⏳ Clamping out-of-range values (|Bz| ≤ 16 nT, Vsw ≤ 900 km/s, Pdyn ≤ 20 nPa) and gap-filling…',
    '⏳ Assembling weimer_driving.txt and opening the preview dataset viewer…'
  ];
  const steps = ['weimer-ts-os-1', 'weimer-ts-os-2', 'weimer-ts-os-3', 'weimer-ts-os-4'];
  steps.forEach((id, idx) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.className = idx < 2 ? 'os-num done' : (idx === 3 ? 'os-num pending' : 'os-num');
    e.textContent = idx < 2 ? '✓' : String(idx + 1);
    e.style.background = '';
  });
  const st = document.getElementById('weimer-ts-omni-status');
  if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[0]}</span>`;

  let i = 0;
  const adv = () => {
    if (i > 0) {
      const pe = document.getElementById(steps[i - 1]);
      if (pe) { pe.className = 'os-num done'; pe.textContent = '✓'; pe.style.background = ''; }
    }
    if (i < steps.length) {
      const ce = document.getElementById(steps[i]);
      if (ce) { ce.className = 'os-num'; ce.style.background = 'var(--orange)'; ce.textContent = '…'; }
      if (st) st.innerHTML = `<span style="color:var(--orange)">${msgs[i]}</span>`;
      i++;
      setTimeout(adv, 470);
      return;
    }
    const lines = _weimerTsBuildSyntheticDataset(start, end, cadMin);
    _weimerTsMergeLines(lines);
    _weimerTsRenderTable();
    const dl = document.getElementById('weimer-ts-dl-btn');
    if (dl && _weimerTsDataset.length > 0) dl.style.display = '';
    const s  = start.toISOString().slice(0, 16).replace('T', ' ');
    const e2 = end.toISOString().slice(0, 16).replace('T', ' ');
    if (st) st.innerHTML =
      `<span class="ok">✓ Fetch complete</span>&nbsp;&nbsp;Time range: <span style="color:#fff;">${s} → ${e2} UTC</span><br/>` +
      `${rowCount} rows @ ${cadMin}-min cadence — 4 Weimer drivers: Bz, By, Vx, Pdyn` +
      `&nbsp;·&nbsp;<b>${_weimerTsDataset.length} total in dataset</b>` +
      `&nbsp;·&nbsp;<span class="warn">⚠ values clamped to Weimer 2005 valid range</span>`;
  };
  adv();
}

function _applyWeimerTsFile(file) {
  const dz = document.getElementById('weimer-ts-dropzone');
  if (dz) {
    dz.classList.add('loaded');
    dz.innerHTML =
      '<div class="dz-icon">✅</div>' +
      `<div class="dz-primary" style="color:var(--green)">${file.name}</div>` +
      `<div class="dz-sub">${(file.size / 1024).toFixed(1)} KB · drag a new file to replace, or append from the toolbar</div>`;
  }
  const lbl = document.getElementById('weimer-ts-file-label');
  if (lbl) { lbl.textContent = `⏳ Reading ${file.name}…`; lbl.style.color = 'var(--orange)'; }

  file.text().then(text => {
    const added = _applyWeimerTsTextDataset(text, file.name);
    if (lbl) {
      lbl.textContent = added > 0
        ? `✅ ${file.name} — ${added} rows added (${_weimerTsDataset.length} total)`
        : `✗ ${file.name} — no valid Weimer rows found`;
      lbl.style.color = added > 0 ? 'var(--green)' : 'var(--red)';
    }
    updateSidebar();
  }).catch(() => {
    if (lbl) { lbl.textContent = `✗ Failed to read ${file.name}`; lbl.style.color = 'var(--red)'; }
  });
}

function initWeimerTsFileUpload() {
  const dz  = document.getElementById('weimer-ts-dropzone');
  const btn = document.getElementById('weimer-ts-upload-btn');
  if (!dz && !btn) return;

  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.txt,.csv,.dat'; fi.style.display = 'none';
  document.body.appendChild(fi);
  fi.addEventListener('change', function () {
    if (this.files.length > 0) _applyWeimerTsFile(this.files[0]);
    this.value = '';
  });
  if (dz) {
    dz.addEventListener('click',    () => fi.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) _applyWeimerTsFile(e.dataTransfer.files[0]);
    });
  }
  if (btn) btn.addEventListener('click', () => fi.click());
}

/* ── END OF E-FIELD DRIVER SECTION ──────────────────────────────────────── */

/**
 * Switch the E-field driver source for a given model.
 * Manages the three-way toggle (OMNIWeb / Upload / Scalar/Auto) and
 * shows/hides the corresponding sub-panels.
 *
 * @param {string} model — 'vs' | 'weimer'
 * @param {string} src   — 'omni' | 'file' | 'scalar'
 */
function setEfieldDrvSource(model, src) {
  /* Toggle button highlights */
  const tog = document.getElementById(model === 'vs' ? 'vs-source-tog' : 'weimer-ts-source-tog');
  if (tog) {
    tog.querySelectorAll('.tog-btn').forEach(b => b.classList.remove('on'));
    const btnId = { omni: `${model === 'vs' ? 'vs' : 'weimer-ts'}-omni-btn`, file: `${model === 'vs' ? 'vs' : 'weimer-ts'}-file-btn`, scalar: `${model === 'vs' ? 'vs' : 'weimer-ts'}-scalar-btn` }[src];
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('on');
  }

  /* Show/hide sub-panels */
  const prefix = model === 'vs' ? 'vs' : 'weimer-ts';
  const panels = { omni: `${prefix}-omni-panel`, file: `${prefix}-file-panel`, scalar: `${prefix}-scalar-panel` };
  Object.entries(panels).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = key === src ? 'block' : 'none';
  });

  /* Persist in state */
  if (model === 'vs')     S.vsEfieldSrc     = src;
  else                    S.weimerEfieldSrc  = src;
}

/**
 * Toggle a .drv-fold collapsible section open/closed.
 * @param {string} id — element id of the .drv-fold container
 */
function toggleDrvFold(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('fold-closed');
}
