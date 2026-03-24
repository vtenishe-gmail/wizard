/*
=====================================================================
FILE: js/16-dashboard.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Build and update the operator dashboard panels.

  Reads from the R results object (populated by 14-radbridge.js)
  and renders all visualization panels using CHART primitives
  (15-charts.js).

PUBLIC API
  toggleView(mode)       — switch between 'configure' and 'results'
  renderDashboard()      — redraw all panels from current R
  refreshPanel(name)     — redraw a single panel

DEPENDS ON: 01-state.js, 13-radcalc.js, 14-radbridge.js, 15-charts.js
LAST UPDATED: 2026-03-06
=====================================================================
*/

/* ═══════════════════════════════════════════════════════════════════
   COLLAPSIBLE CARD TOGGLE
   ═══════════════════════════════════════════════════════════════════ */

function dashToggle(id) {
  let el = document.getElementById(id);
  if (el) el.classList.toggle('collapsed');
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW TOGGLE — switch between Configure (wizard) and Results
   ═══════════════════════════════════════════════════════════════════ */

let _currentView = 'configure';

function toggleView(mode) {
  const wizardLayout = document.querySelector('.layout');
  const submitBar    = document.querySelector('.submit-bar');
  const resultsView  = $('results-view');
  const tbConfigure  = $('tb-configure');
  const tbResults    = $('tb-results');

  if (!resultsView) return;

  if (mode === 'results') {
    _currentView = 'results';
    if (wizardLayout) wizardLayout.style.display = 'none';
    if (submitBar)    submitBar.style.display    = 'none';
    resultsView.style.display = 'block';
    if (tbConfigure) tbConfigure.classList.remove('tb-active');
    if (tbResults)   tbResults.classList.add('tb-active');

    /* Auto-compute if results not yet available */
    if (!R.computedAt) computePreview();
    else renderDashboard();
  } else {
    _currentView = 'configure';
    if (wizardLayout) wizardLayout.style.display = '';
    if (submitBar)    submitBar.style.display    = '';
    resultsView.style.display = 'none';
    if (tbConfigure) tbConfigure.classList.add('tb-active');
    if (tbResults)   tbResults.classList.remove('tb-active');
  }
}


/* ═══════════════════════════════════════════════════════════════════
   RENDER DASHBOARD — master render function
   ═══════════════════════════════════════════════════════════════════ */

function renderDashboard() {
  if (_currentView !== 'results') return;
  if (!R.Egrid) return;

  _renderScoreboard();
  _renderSpectrumPlot();
  _renderCutoffPanel();
  _renderEffectsVsShielding();
  _renderLETPlot();
  _renderTimeSeriesPanel();
}


/* ═══════════════════════════════════════════════════════════════════
   PANEL 1: SCOREBOARD
   ═══════════════════════════════════════════════════════════════════ */

function _renderScoreboard() {
  const el = $('dash-scoreboard');
  if (!el) return;

  const fmtE = (v) => {
    if (v === 0) return '0';
    if (Math.abs(v) < 0.01 || Math.abs(v) >= 1e5) return v.toExponential(2);
    return v.toFixed(2);
  };
  const fmtSci = (v) => v === 0 ? '0' : v.toExponential(2);

  /* Color logic */
  const jClass = (v, warn, err) => {
    if (v >= err)  return 'sb-val-red';
    if (v >= warn) return 'sb-val-amber';
    return 'sb-val-green';
  };

  el.innerHTML = `
    <div class="sb-grid">
      <div class="sb-item">
        <div class="sb-label">R<sub>c</sub> ${R.mode==='preview'?'<span class="sb-est">(est.)</span>':''}</div>
        <div class="sb-val sb-val-cyan">${fmtE(R.Rc)} <span class="sb-unit">GV</span></div>
      </div>
      <div class="sb-item">
        <div class="sb-label">E<sub>c</sub></div>
        <div class="sb-val sb-val-cyan">${fmtE(R.Ec)} <span class="sb-unit">MeV</span></div>
      </div>
      <div class="sb-item">
        <div class="sb-label">J(&gt;10 MeV)</div>
        <div class="sb-val ${jClass(R.J10,10,1000)}">${fmtSci(R.J10)} <span class="sb-unit">pfu</span></div>
      </div>
      <div class="sb-item">
        <div class="sb-label">J(&gt;100 MeV)</div>
        <div class="sb-val ${jClass(R.J100,1,100)}">${fmtSci(R.J100)} <span class="sb-unit">pfu</span></div>
      </div>
      <div class="sb-item">
        <div class="sb-label">J(&gt;300 MeV)</div>
        <div class="sb-val">${fmtSci(R.J300)} <span class="sb-unit">pfu</span></div>
      </div>
      <div class="sb-item">
        <div class="sb-label">H<sub>100/10</sub></div>
        <div class="sb-val">${fmtE(R.H100_10)}</div>
      </div>
      <div class="sb-item">
        <div class="sb-label">γ (fit)</div>
        <div class="sb-val">${R.fit.gamma.toFixed(2)}</div>
      </div>
      <div class="sb-item">
        <div class="sb-label">E* (fit)</div>
        <div class="sb-val">${R.fit.Estar === Infinity ? '∞' : fmtE(R.fit.Estar)} <span class="sb-unit">MeV</span></div>
      </div>
      <div class="sb-item">
        <div class="sb-label">f<sub>trans</sub>(&gt;10)</div>
        <div class="sb-val">${R.fTrans10.toFixed(3)}</div>
      </div>
      <div class="sb-item">
        <div class="sb-label">f<sub>trans</sub>(&gt;100)</div>
        <div class="sb-val">${R.fTrans100.toFixed(3)}</div>
      </div>
    </div>

    <div class="sb-sscale">
      <div class="sb-sscale-title">NOAA S-Scale</div>
      <div class="sb-sscale-row">
        ${['S1','S2','S3','S4','S5'].map(s => {
          const active = R.sScale[s];
          return `<div class="sb-light ${active ? 'sb-light-on' : ''}">
            <div class="sb-light-dot" style="background:${active ? CHART.COLORS.red : 'rgba(255,255,255,0.1)'}"></div>
            <div class="sb-light-label">${s}</div>
            <div class="sb-light-thr">&ge;${RAD.S_SCALE[s]} pfu</div>
          </div>`;
        }).join('')}
      </div>
      <div class="sb-sscale-level">Level: <strong>${R.sScale.level}</strong></div>
    </div>
  `;
}


/* ═══════════════════════════════════════════════════════════════════
   PANEL 2: ENERGY SPECTRUM PLOT
   ═══════════════════════════════════════════════════════════════════ */

function _renderSpectrumPlot() {
  const canvas = $('dash-spectrum-canvas');
  if (!canvas || !R.Egrid) return;

  const series = [];

  /* Source spectrum (unfiltered) */
  series.push({
    x: R.Egrid, y: R.j,
    color: 'rgba(255,255,255,0.3)', dash: [4, 4],
    label: 'j(E) source'
  });

  /* Transmitted spectrum */
  series.push({
    x: R.Egrid, y: R.jTrans,
    color: CHART.COLORS.accent,
    label: `j_trans (Rc=${R.Rc.toFixed(2)} GV)`
  });

  /* Shielded spectra (behind each T) */
  const shieldColors = [CHART.COLORS.green, CHART.COLORS.amber, CHART.COLORS.red, CHART.COLORS.purple];
  let ci = 0;
  for (const T of R.Tset) {
    if (T === 0) continue; // skip T=0 (same as transmitted)
    if (R.shielded[T]) {
      series.push({
        x: R.Egrid, y: R.shielded[T].j,
        color: shieldColors[ci % shieldColors.length],
        label: `T=${T} g/cm²`
      });
      ci++;
    }
  }

  /* Find y range from non-zero data */
  let yMin = Infinity, yMax = -Infinity;
  for (const s of series) {
    for (const v of s.y) {
      if (v > 0) {
        yMin = Math.min(yMin, v);
        yMax = Math.max(yMax, v);
      }
    }
  }
  if (!isFinite(yMin)) { yMin = 1e-6; yMax = 1e6; }
  yMin = Math.pow(10, Math.floor(Math.log10(yMin)) - 1);
  yMax = Math.pow(10, Math.ceil(Math.log10(yMax)) + 1);

  const markers = [];
  if (R.Ec > 0 && R.Ec < 1e5) {
    markers.push({ x: R.Ec, color: CHART.COLORS.yellow, label: `Ec=${R.Ec.toFixed(0)} MeV` });
  }

  CHART.logLogPlot(canvas, {
    series: series,
    xRange: [R.Egrid[0], R.Egrid[R.Egrid.length - 1]],
    yRange: [yMin, yMax],
    xLabel: 'Kinetic energy E [MeV]',
    yLabel: 'j(E) [cm⁻²s⁻¹sr⁻¹MeV⁻¹]',
    title:  'Energy Spectrum — Source, Transmitted & Shielded',
    markers: markers,
    height: 300
  });
}


/* ═══════════════════════════════════════════════════════════════════
   PANEL 3: CUTOFF RIGIDITY
   ═══════════════════════════════════════════════════════════════════ */

function _renderCutoffPanel() {
  const el = $('dash-cutoff-info');
  if (!el) return;

  if (R.hasTimeSeries && R.ts?.Rc) {
    /* Time series: show Rc vs time */
    el.innerHTML = '<canvas id="dash-cutoff-canvas"></canvas>';
    const canvas = $('dash-cutoff-canvas');
    const N = R.ts.Rc.length;
    const xArr = new Float64Array(N);
    for (let i = 0; i < N; i++) xArr[i] = i;

    CHART.linePlot(canvas, {
      series: [
        { x: xArr, y: R.ts.Rc, color: CHART.COLORS.accent, label: 'Rc [GV]' },
        { x: xArr, y: R.ts.Ec, color: CHART.COLORS.yellow, label: 'Ec [MeV]', dash: [4,3] }
      ],
      xRange: [0, N - 1],
      yRange: [0, Math.max(...R.ts.Rc) * 1.2 || 15],
      xLabel: 'Time step',
      yLabel: 'Rc [GV] / Ec [MeV]',
      title:  'Cutoff Rigidity along Trajectory',
      height: 200
    });
  } else {
    /* Preview mode: single value display */
    el.innerHTML = `
      <div class="cutoff-single">
        <div class="cutoff-big">${R.Rc.toFixed(3)} <span class="sb-unit">GV</span></div>
        <div class="cutoff-sub">Effective cutoff energy: <strong>${R.Ec.toFixed(1)} MeV</strong></div>
        <div class="cutoff-note">
          Estimated from Dst = ${(S.dst||0).toFixed(0)} nT at L ≈ 6.6 using Smart &amp; Shea approximation.
          <br>Run AMPS for particle-traced cutoff rigidity.
        </div>
        <div class="cutoff-bar-wrap">
          <div class="cutoff-bar-label">0 GV</div>
          <div class="cutoff-bar-track">
            <div class="cutoff-bar-fill" style="width:${Math.min(100, R.Rc / 15 * 100).toFixed(0)}%"></div>
          </div>
          <div class="cutoff-bar-label">15 GV</div>
        </div>
      </div>
    `;
  }
}


/* ═══════════════════════════════════════════════════════════════════
   PANEL 4: EFFECTS VS SHIELDING  (Cookbook Figs. 4 & 6)
   ═══════════════════════════════════════════════════════════════════ */

function _renderEffectsVsShielding() {
  const doseCanvas = $('dash-dose-canvas');
  const neqCanvas  = $('dash-neq-canvas');
  if (!doseCanvas || !neqCanvas) return;
  if (!R.Tset || R.Tset.length === 0) return;

  const xArr = new Float64Array(R.Tset);
  const doseArr = new Float64Array(R.Tset.length);
  const neqArr  = new Float64Array(R.Tset.length);

  for (let i = 0; i < R.Tset.length; i++) {
    const T = R.Tset[i];
    doseArr[i] = R.shielded[T] ? R.shielded[T].dose : 0;
    neqArr[i]  = R.shielded[T] ? R.shielded[T].neq  : 0;
  }

  /* Dose proxy */
  let dMin = Infinity, dMax = 0;
  for (const v of doseArr) { if (v > 0) { dMin = Math.min(dMin, v); dMax = Math.max(dMax, v); } }
  if (!isFinite(dMin)) { dMin = 1e-15; dMax = 1e-5; }

  CHART.linePlot(doseCanvas, {
    series: [{ x: xArr, y: doseArr, color: CHART.COLORS.accent, label: `Rc=${R.Rc.toFixed(1)} GV`, dots: true }],
    xRange: [0, Math.max(...R.Tset) * 1.1],
    yRange: [Math.pow(10, Math.floor(Math.log10(dMin)) - 1), Math.pow(10, Math.ceil(Math.log10(dMax)) + 1)],
    xLabel: 'Al-equivalent T [g/cm²]',
    yLabel: 'Dose proxy [Gy/s]',
    title:  'Ionizing Dose Rate Proxy (Si) vs Shielding',
    yLog: true,
    dots: true,
    height: 220
  });

  /* n_eq */
  let nMin = Infinity, nMax = 0;
  for (const v of neqArr) { if (v > 0) { nMin = Math.min(nMin, v); nMax = Math.max(nMax, v); } }
  if (!isFinite(nMin)) { nMin = 1; nMax = 1e10; }

  CHART.linePlot(neqCanvas, {
    series: [{ x: xArr, y: neqArr, color: CHART.COLORS.green, label: `Rc=${R.Rc.toFixed(1)} GV`, dots: true }],
    xRange: [0, Math.max(...R.Tset) * 1.1],
    yRange: [Math.pow(10, Math.floor(Math.log10(nMin)) - 1), Math.pow(10, Math.ceil(Math.log10(nMax)) + 1)],
    xLabel: 'Al-equivalent T [g/cm²]',
    yLabel: 'n_eq [cm⁻²]',
    title:  'Displacement Damage (1-MeV n_eq) vs Shielding',
    yLog: true,
    dots: true,
    height: 220
  });
}


/* ═══════════════════════════════════════════════════════════════════
   PANEL 5: LET SPECTRUM
   ═══════════════════════════════════════════════════════════════════ */

function _renderLETPlot() {
  const canvas = $('dash-let-canvas');
  if (!canvas) return;

  const series = [];
  const colors = [CHART.COLORS.accent, CHART.COLORS.green, CHART.COLORS.amber, CHART.COLORS.red];
  let ci = 0;
  let yMin = Infinity, yMax = -Infinity;

  for (const T of R.Tset) {
    const ld = R.letData[T];
    if (!ld) continue;
    for (const v of ld.dj_dLET) {
      if (v > 0) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); }
    }
    series.push({
      x: ld.letGrid, y: ld.dj_dLET,
      color: colors[ci % colors.length],
      label: `T=${T} g/cm²`
    });
    ci++;
  }

  if (!isFinite(yMin)) { yMin = 1e-10; yMax = 1e2; }
  yMin = Math.pow(10, Math.floor(Math.log10(yMin)) - 1);
  yMax = Math.pow(10, Math.ceil(Math.log10(yMax)) + 1);

  /* LET range from data */
  let letMin = 0.001, letMax = 100;
  if (series.length > 0 && series[0].x.length > 0) {
    letMin = Math.max(0.001, series[0].x[series[0].x.length - 1]);  // LET decreases with E for protons
    letMax = Math.max(letMin * 10, series[0].x[0]);
    // Ensure proper order
    if (letMin > letMax) { const tmp = letMin; letMin = letMax; letMax = tmp; }
  }

  CHART.logLogPlot(canvas, {
    series: series,
    xRange: [Math.max(0.005, letMin * 0.5), letMax * 2],
    yRange: [yMin, yMax],
    xLabel: 'LET [MeV cm²/mg]',
    yLabel: 'dφ/dLET [cm⁻² s⁻¹ (MeV cm²/mg)⁻¹]',
    title:  'Proton LET Spectrum',
    markers: [
      { x: 1,  color: 'rgba(255,255,255,0.2)', label: 'LET=1' },
      { x: 10, color: 'rgba(255,255,255,0.2)', label: 'LET=10' }
    ],
    height: 260
  });
}


/* ═══════════════════════════════════════════════════════════════════
   PANEL 6: TIME SERIES (post-run only)
   ═══════════════════════════════════════════════════════════════════ */

function _renderTimeSeriesPanel() {
  const panel = $('dash-timeseries');
  if (!panel) return;

  if (!R.hasTimeSeries || !R.ts) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  const N = R.ts.J10.length;
  const xArr = new Float64Array(N);
  for (let i = 0; i < N; i++) xArr[i] = i * (R.ts.dt / 60); // minutes

  /* J(>10) and J(>100) vs time */
  const fluxCanvas = $('dash-ts-flux-canvas');
  if (fluxCanvas) {
    let yMax = 0;
    for (let i = 0; i < N; i++) yMax = Math.max(yMax, R.ts.J10[i], R.ts.J100[i]);
    yMax = Math.pow(10, Math.ceil(Math.log10(yMax || 1)) + 1);

    CHART.linePlot(fluxCanvas, {
      series: [
        { x: xArr, y: R.ts.J10,  color: CHART.COLORS.accent, label: 'J(>10 MeV)' },
        { x: xArr, y: R.ts.J100, color: CHART.COLORS.amber,  label: 'J(>100 MeV)' }
      ],
      xRange: [0, xArr[N - 1]],
      yRange: [0.1, yMax],
      xLabel: 'Time [min]',
      yLabel: 'Integral flux [pfu]',
      title:  'Integral Flux Time Series',
      yLog: true,
      bands: [
        { yLo: RAD.S_SCALE.S1, yHi: RAD.S_SCALE.S2, color: 'rgba(255,154,60,0.06)', label: 'S1' },
        { yLo: RAD.S_SCALE.S2, yHi: RAD.S_SCALE.S3, color: 'rgba(255,154,60,0.10)', label: 'S2' },
        { yLo: RAD.S_SCALE.S3, yHi: RAD.S_SCALE.S4, color: 'rgba(255,90,90,0.08)',  label: 'S3' },
        { yLo: RAD.S_SCALE.S4, yHi: RAD.S_SCALE.S5, color: 'rgba(255,90,90,0.12)',  label: 'S4' }
      ],
      height: 220
    });
  }

  /* Dose vs time */
  const doseCanvas = $('dash-ts-dose-canvas');
  if (doseCanvas) {
    const doseSeries = [];
    const cols = [CHART.COLORS.accent, CHART.COLORS.green, CHART.COLORS.amber, CHART.COLORS.red];
    let ci = 0, yMax = 0;
    for (const T of R.Tset) {
      if (R.ts.dose[T]) {
        for (let i = 0; i < N; i++) yMax = Math.max(yMax, R.ts.dose[T][i]);
        doseSeries.push({ x: xArr, y: R.ts.dose[T], color: cols[ci % cols.length], label: `T=${T}` });
        ci++;
      }
    }
    yMax = Math.pow(10, Math.ceil(Math.log10(yMax || 1e-15)) + 1);

    CHART.linePlot(doseCanvas, {
      series: doseSeries,
      xRange: [0, xArr[N - 1]],
      yRange: [1e-15, yMax],
      xLabel: 'Time [min]',
      yLabel: 'Dose proxy [Gy/s]',
      title:  'Dose Proxy vs Time (per shielding)',
      yLog: true,
      height: 220
    });
  }

  /* Exceedance Gantt */
  const ganttCanvas = $('dash-gantt-canvas');
  if (ganttCanvas && R.ts.exceedance10) {
    const totalMin = N * R.ts.dt / 60;
    const intervals = [];
    for (const iv of R.ts.exceedance10.intervals) {
      intervals.push({
        catIdx: 0,
        start: iv.startIdx / N,
        end:   (iv.endIdx + 1) / N
      });
    }
    if (R.ts.exceedance100) {
      for (const iv of R.ts.exceedance100.intervals) {
        intervals.push({
          catIdx: 1,
          start: iv.startIdx / N,
          end:   (iv.endIdx + 1) / N
        });
      }
    }

    CHART.gantt(ganttCanvas, {
      categories: [
        { label: 'J>10≥S1', color: CHART.COLORS.amber },
        { label: 'J>100≥1', color: CHART.COLORS.red }
      ],
      intervals: intervals,
      tRange: ['0 min', totalMin.toFixed(0) + ' min'],
      title: 'Threshold Exceedance Intervals'
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════
   REFRESH ON RESIZE
   ═══════════════════════════════════════════════════════════════════ */

let _resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(function() {
    if (_currentView === 'results') renderDashboard();
  }, 150);
});
