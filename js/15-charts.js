/*
=====================================================================
FILE: js/15-charts.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Lightweight Canvas 2D chart primitives matching the
         "NASA Mission Control" design language.

  All functions operate on a <canvas> element and draw directly.
  No external library dependencies.

PUBLIC API
  CHART.logLogPlot(canvas, opts)  — log-log line chart (spectra)
  CHART.linePlot(canvas, opts)    — linear or semi-log line chart
  CHART.barChart(canvas, opts)    — vertical bar chart
  CHART.gantt(canvas, opts)       — horizontal Gantt-style timeline
  CHART.heatmap(canvas, opts)     — 2D heatmap with colorbar

DEPENDS ON: nothing (standalone)
LAST UPDATED: 2026-03-06
=====================================================================
*/

const CHART = {};

/* ═══════════════════════════════════════════════════════════════════
   THEME — colours drawn from the AMPS design tokens
   ═══════════════════════════════════════════════════════════════════ */
CHART.COLORS = {
  bg:         '#070e1c',
  panel:      '#0d1a2e',
  grid:       'rgba(255,255,255,0.06)',
  gridMajor:  'rgba(255,255,255,0.12)',
  axis:       'rgba(255,255,255,0.3)',
  text:       'rgba(255,255,255,0.55)',
  textBright: 'rgba(255,255,255,0.85)',
  accent:     '#38c0ff',
  green:      '#2dd4a0',
  amber:      '#ff9a3c',
  red:        '#ff5a5a',
  purple:     '#8b6ff7',
  yellow:     '#ffd04b',
  series: ['#38c0ff','#2dd4a0','#ff9a3c','#ff5a5a','#8b6ff7','#ffd04b','#ff6bab','#60d6d6']
};

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

CHART.PAD = { top: 30, right: 20, bottom: 45, left: 65 };

/** Size canvas to its container and return drawing dimensions */
CHART._size = function(canvas, height) {
  const W = canvas.parentElement ? canvas.parentElement.clientWidth : 500;
  const H = height || 220;
  canvas.width  = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  return { ctx, W, H };
};

/** Draw background fill */
CHART._bg = function(ctx, W, H) {
  ctx.fillStyle = CHART.COLORS.bg;
  ctx.fillRect(0, 0, W, H);
};

/** Format number for axis label */
CHART._fmt = function(v, isLog) {
  if (isLog) {
    const e = Math.round(Math.log10(v));
    if (e === 0) return '1';
    if (e === 1) return '10';
    return '10' + (e < 0 ? '⁻' : '') + String(Math.abs(e)).split('').map(
      d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
  }
  if (Math.abs(v) >= 1e4 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(1);
  if (v === Math.floor(v)) return String(v);
  return v.toFixed(1);
};

/** Draw grid lines + axis labels for log-log or lin-log */
CHART._axes = function(ctx, W, H, pad, xRange, yRange, xLabel, yLabel, xLog, yLog) {
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top  - pad.bottom;

  /* Map data → pixel */
  const xMap = xLog
    ? (v => pad.left + (Math.log10(v) - Math.log10(xRange[0])) / (Math.log10(xRange[1]) - Math.log10(xRange[0])) * pw)
    : (v => pad.left + (v - xRange[0]) / (xRange[1] - xRange[0]) * pw);
  const yMap = yLog
    ? (v => pad.top + (1 - (Math.log10(v) - Math.log10(yRange[0])) / (Math.log10(yRange[1]) - Math.log10(yRange[0]))) * ph)
    : (v => pad.top + (1 - (v - yRange[0]) / (yRange[1] - yRange[0])) * ph);

  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';

  /* X grid + labels */
  const xTicks = xLog ? CHART._logTicks(xRange[0], xRange[1]) : CHART._linTicks(xRange[0], xRange[1], 6);
  for (const t of xTicks) {
    const x = xMap(t);
    if (x < pad.left || x > W - pad.right) continue;
    ctx.strokeStyle = CHART.COLORS.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
    ctx.fillStyle = CHART.COLORS.text;
    ctx.fillText(CHART._fmt(t, xLog), x, H - pad.bottom + 14);
  }

  /* Y grid + labels */
  ctx.textAlign = 'right';
  const yTicks = yLog ? CHART._logTicks(yRange[0], yRange[1]) : CHART._linTicks(yRange[0], yRange[1], 6);
  for (const t of yTicks) {
    const y = yMap(t);
    if (y < pad.top || y > H - pad.bottom) continue;
    ctx.strokeStyle = CHART.COLORS.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = CHART.COLORS.text;
    ctx.fillText(CHART._fmt(t, yLog), pad.left - 6, y + 3);
  }

  /* Axis border */
  ctx.strokeStyle = CHART.COLORS.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, pw, ph);

  /* Labels */
  ctx.fillStyle = CHART.COLORS.textBright;
  ctx.font = '11px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'center';
  if (xLabel) ctx.fillText(xLabel, pad.left + pw / 2, H - 4);
  if (yLabel) {
    ctx.save();
    ctx.translate(13, pad.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }

  return { xMap, yMap, pw, ph };
};

/** Generate log-scale tick values */
CHART._logTicks = function(lo, hi) {
  const ticks = [];
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) {
    ticks.push(Math.pow(10, e));
  }
  return ticks;
};

/** Generate linear tick values */
CHART._linTicks = function(lo, hi, n) {
  const step = (hi - lo) / n;
  const ticks = [];
  for (let v = lo; v <= hi + step * 0.01; v += step) ticks.push(v);
  return ticks;
};


/* ═══════════════════════════════════════════════════════════════════
   LOG-LOG PLOT — primary chart for energy spectra
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Draw a log-log line chart.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 *   opts.series:   [{x, y, color, label, dash?}]    — Float64Arrays
 *   opts.xRange:   [lo, hi]                           — data range
 *   opts.yRange:   [lo, hi]
 *   opts.xLabel:   string
 *   opts.yLabel:   string
 *   opts.title:    string (optional)
 *   opts.markers:  [{x, color, label}]               — vertical markers
 *   opts.height:   number (optional, default 220)
 *   opts.bands:    [{yLo, yHi, color, label}]        — horizontal bands
 */
CHART.logLogPlot = function(canvas, opts) {
  if (!canvas) return;
  const { ctx, W, H } = CHART._size(canvas, opts.height || 220);
  CHART._bg(ctx, W, H);

  const pad = { ...CHART.PAD };
  if (opts.title) pad.top = 40;

  const { xMap, yMap, pw, ph } = CHART._axes(
    ctx, W, H, pad, opts.xRange, opts.yRange,
    opts.xLabel, opts.yLabel, true, true
  );

  /* Title */
  if (opts.title) {
    ctx.fillStyle = CHART.COLORS.textBright;
    ctx.font = 'bold 12px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, pad.left, 18);
  }

  /* Horizontal bands (e.g. S-scale thresholds) */
  if (opts.bands) {
    for (const band of opts.bands) {
      const y0 = Math.max(pad.top, yMap(band.yHi));
      const y1 = Math.min(H - pad.bottom, yMap(band.yLo));
      ctx.fillStyle = band.color || 'rgba(255,90,90,0.05)';
      ctx.fillRect(pad.left, y0, pw, y1 - y0);
      if (band.label) {
        ctx.fillStyle = CHART.COLORS.text;
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(band.label, W - pad.right - 4, y0 + 10);
      }
    }
  }

  /* Vertical markers (e.g. Ec line) */
  if (opts.markers) {
    for (const m of opts.markers) {
      const x = xMap(m.x);
      if (x >= pad.left && x <= W - pad.right) {
        ctx.strokeStyle = m.color || CHART.COLORS.amber;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
        ctx.setLineDash([]);
        if (m.label) {
          ctx.fillStyle = m.color || CHART.COLORS.amber;
          ctx.font = '9px "IBM Plex Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText(m.label, x + 3, pad.top + 12);
        }
      }
    }
  }

  /* Series */
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, pw, ph);
  ctx.clip();

  for (let si = 0; si < opts.series.length; si++) {
    const s = opts.series[si];
    ctx.strokeStyle = s.color || CHART.COLORS.series[si % CHART.COLORS.series.length];
    ctx.lineWidth = s.lineWidth || 1.5;
    if (s.dash) ctx.setLineDash(s.dash);
    else ctx.setLineDash([]);

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.x.length; i++) {
      if (s.y[i] <= 0) continue;
      const px = xMap(s.x[i]);
      const py = yMap(s.y[i]);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.setLineDash([]);

  /* Legend */
  if (opts.series.length > 1 || (opts.series.length === 1 && opts.series[0].label)) {
    let lx = pad.left + 8;
    let ly = pad.top + (opts.title ? 14 : 8);
    ctx.font = '9px "IBM Plex Sans", sans-serif';
    for (let si = 0; si < opts.series.length; si++) {
      const s = opts.series[si];
      if (!s.label) continue;
      const col = s.color || CHART.COLORS.series[si % CHART.COLORS.series.length];
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      if (s.dash) ctx.setLineDash(s.dash);
      else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 18, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = CHART.COLORS.textBright;
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 22, ly + 3);
      ly += 14;
    }
  }
};


/* ═══════════════════════════════════════════════════════════════════
   LINEAR / SEMI-LOG PLOT — for time series, effects-vs-T, etc.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Draw a line chart with linear X and optionally log Y.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts — same as logLogPlot, plus:
 *   opts.yLog:    boolean (default false)
 *   opts.xLog:    boolean (default false)
 *   opts.dots:    boolean — draw dots at data points
 */
CHART.linePlot = function(canvas, opts) {
  if (!canvas) return;
  const { ctx, W, H } = CHART._size(canvas, opts.height || 220);
  CHART._bg(ctx, W, H);

  const pad = { ...CHART.PAD };
  if (opts.title) pad.top = 40;
  const xLog = !!opts.xLog;
  const yLog = !!opts.yLog;

  const { xMap, yMap, pw, ph } = CHART._axes(
    ctx, W, H, pad, opts.xRange, opts.yRange,
    opts.xLabel, opts.yLabel, xLog, yLog
  );

  /* Title */
  if (opts.title) {
    ctx.fillStyle = CHART.COLORS.textBright;
    ctx.font = 'bold 12px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, pad.left, 18);
  }

  /* Horizontal bands */
  if (opts.bands) {
    for (const band of opts.bands) {
      /* S3923 fix: the original ternary `yLog ? band.yHi : band.yHi` returned
       * the same value in both branches, making the condition dead code. yMap
       * already handles log-scale internally (see CHART._axes), so the raw
       * band boundary value is passed directly — matching the logLogPlot
       * implementation above. */
      const y0 = Math.max(pad.top, yMap(band.yHi));
      const y1 = Math.min(H - pad.bottom, yMap(band.yLo));
      ctx.fillStyle = band.color || 'rgba(255,90,90,0.08)';
      ctx.fillRect(pad.left, y0, pw, y1 - y0);
    }
  }

  /* Vertical markers */
  if (opts.markers) {
    for (const m of opts.markers) {
      const x = xMap(m.x);
      if (x >= pad.left && x <= W - pad.right) {
        ctx.strokeStyle = m.color || CHART.COLORS.amber;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /* Series */
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, pw, ph);
  ctx.clip();

  for (let si = 0; si < opts.series.length; si++) {
    const s = opts.series[si];
    const col = s.color || CHART.COLORS.series[si % CHART.COLORS.series.length];
    ctx.strokeStyle = col;
    ctx.lineWidth = s.lineWidth || 1.5;
    if (s.dash) ctx.setLineDash(s.dash);
    else ctx.setLineDash([]);

    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.x.length; i++) {
      const yv = s.y[i];
      if (yLog && yv <= 0) continue;
      const px = xMap(s.x[i]);
      const py = yMap(yv);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    /* Dots */
    if (opts.dots || s.dots) {
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      for (let i = 0; i < s.x.length; i++) {
        const yv = s.y[i];
        if (yLog && yv <= 0) continue;
        const px = xMap(s.x[i]);
        const py = yMap(yv);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  ctx.setLineDash([]);

  /* Legend */
  if (opts.series.some(s => s.label)) {
    let lx = pad.left + 8;
    let ly = pad.top + (opts.title ? 14 : 8);
    ctx.font = '9px "IBM Plex Sans", sans-serif';
    for (let si = 0; si < opts.series.length; si++) {
      const s = opts.series[si];
      if (!s.label) continue;
      const col = s.color || CHART.COLORS.series[si % CHART.COLORS.series.length];
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      if (s.dash) ctx.setLineDash(s.dash); else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 18, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = CHART.COLORS.textBright;
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 22, ly + 3);
      ly += 14;
    }
  }
};


/* ═══════════════════════════════════════════════════════════════════
   GANTT CHART — for exceedance duration display
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Horizontal Gantt-style timeline.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 *   opts.categories: [{label, color}]
 *   opts.intervals:  [{catIdx, start, end}]  — start/end as fraction 0..1
 *   opts.tRange:     [t0_label, t1_label]
 *   opts.title:      string
 *   opts.height:     number
 */
CHART.gantt = function(canvas, opts) {
  if (!canvas) return;
  const nCat = opts.categories.length;
  const rowH = 24;
  const totalH = opts.height || (60 + nCat * (rowH + 6));
  const { ctx, W, H } = CHART._size(canvas, totalH);
  CHART._bg(ctx, W, H);

  const pad = { top: 32, right: 20, bottom: 28, left: 65 };
  const pw = W - pad.left - pad.right;

  /* Title */
  if (opts.title) {
    ctx.fillStyle = CHART.COLORS.textBright;
    ctx.font = 'bold 12px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, pad.left, 18);
  }

  /* Rows */
  ctx.font = '10px "IBM Plex Mono", monospace';
  for (let c = 0; c < nCat; c++) {
    const cat = opts.categories[c];
    const y   = pad.top + c * (rowH + 6);

    /* Label */
    ctx.fillStyle = CHART.COLORS.textBright;
    ctx.textAlign = 'right';
    ctx.fillText(cat.label, pad.left - 8, y + rowH / 2 + 3);

    /* Track background */
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(pad.left, y, pw, rowH);

    /* Intervals */
    const catIntervals = (opts.intervals || []).filter(iv => iv.catIdx === c);
    for (const iv of catIntervals) {
      const x0 = pad.left + iv.start * pw;
      const x1 = pad.left + iv.end * pw;
      ctx.fillStyle = cat.color || CHART.COLORS.red;
      ctx.fillRect(x0, y + 2, Math.max(2, x1 - x0), rowH - 4);
    }
  }

  /* Time axis labels */
  if (opts.tRange) {
    ctx.fillStyle = CHART.COLORS.text;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(opts.tRange[0], pad.left, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText(opts.tRange[1], W - pad.right, H - 8);
  }

  /* Border */
  ctx.strokeStyle = CHART.COLORS.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, pw, nCat * (rowH + 6));
};
