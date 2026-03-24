/*
=====================================================================
FILE: js/19-trajectory-viewer.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Spacecraft trajectory viewer using Plotly.js.

  Two coordinated panels:
    A) Ground-track map: trajectory on lon/lat with continent outlines
       and color-coded by a selectable variable.
    B) Time-series plot: one variable vs time, linear or log scale,
       with threshold exceedance highlighting and hover probe.

  Parses Tecplot-style trajectory files with quoted ISO timestamps.

PUBLIC API
  initTrajectoryViewer()        — wire controls + events
  loadTrajectoryFile(file)      — parse File → render
  loadTrajectoryText(text,name) — parse text → render
  renderTrajectory()            — redraw both panels

DEPENDS ON: Plotly.js (CDN), 18-lonlat-viewer.js (LLMAP coastlines)
LAST UPDATED: 2026-03-07
=====================================================================
*/

let TRAJ = {};
TRAJ.dataset = null;

/*
CHANGE LOG — 2026-03-07 threshold/highlighting and style-control upgrade
---------------------------------------------------------------------
This file was extended in two related ways. These notes are intentionally
detailed so future maintenance can distinguish the original plotting logic
from the later bug-fix / usability work.

1) Threshold shading bug fix
   Earlier versions shaded threshold exceedance with a single Plotly trace
   using `fill: 'tozeroy'` (or equivalent gap-based logic) and `null` values
   outside the active range. Plotly can visually bridge across those gaps,
   especially when the curve repeatedly crosses the threshold, which led to
   red regions appearing where the data did *not* satisfy the selected
   criterion. That behavior was visible for both `Above` and `Below`.

   The current implementation no longer asks Plotly to infer the fill region
   from a discontinuous 1-D trace. Instead, it explicitly computes each
   contiguous threshold-satisfying interval and then draws one closed polygon
   per interval. Each polygon is bounded above/below by the actual data curve
   and closed back to the threshold line. When a segment crosses the
   threshold between samples, the crossing location is linearly interpolated
   in x so the shaded region begins and ends exactly at the crossing.

2) Time-series style controls
   The time-series panel now supports user-selected background mode/color,
   main line color, shaded-fill color, and fill transparency. A small style
   helper (`TRAJ._tsStyle`) centralizes those options so all plot elements
   that should visually match — line, markers, threshold line, threshold
   annotation border, and filled exceedance region — stay synchronized.

   Background handling is split into three modes:
     • dark        -> original mission-control dark palette
     • custom      -> user supplied solid color
     • transparent -> transparent paper and plot backgrounds for export

Maintenance note
   The threshold-segment builder and style helper are intentionally kept
   generic so they can be reused later if similar threshold highlighting is
   added to the lon/lat viewer, spectra viewer, or future dashboard cards.
*/


/* ═══════════════════════════════════════════════════════════════════
   §1  PARSER — Tecplot trajectory with quoted timestamps
   ═══════════════════════════════════════════════════════════════════ */

TRAJ.parse = function(text) {
  let lines = text.split(/\r?\n/);
  let varLine = null, zoneLine = null, titleLine = null;
  let dataLines = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || /^[#!]/.test(line)) continue;
    if (/^title/i.test(line))     { titleLine = line; continue; }
    if (/^variables/i.test(line)) { varLine = rawLine; continue; }
    if (/^zone/i.test(line))      { zoneLine = rawLine; continue; }
    if (varLine && zoneLine) dataLines.push(rawLine);
  }

  if (!varLine) throw new Error('VARIABLES line not found.');

  /* Parse variable names */
  let fieldNames = [];
  let matches = varLine.matchAll(/"([^"]+)"/g);
  for (let m of matches) fieldNames.push(m[1]);
  if (fieldNames.length === 0) {
    fieldNames = varLine.replace(/^variables\s*=?\s*/i, '').split(/[\s,]+/).filter(Boolean);
  }

  /* Parse zone I */
  let Nexpected = 0;
  if (zoneLine) {
    let mi = zoneLine.match(/I\s*=\s*(\d+)/i);
    if (mi) Nexpected = parseInt(mi[1], 10);
  }

  /* Parse data — handle quoted time strings */
  let rows = [];
  let timeIdx = -1;
  for (let i = 0; i < fieldNames.length; i++) {
    if (/time|utc|date/i.test(fieldNames[i])) { timeIdx = i; break; }
  }

  for (const dataLine of dataLines) {
    let raw = dataLine.trim();
    if (!raw) continue;

    let vals = [];
    let remaining = raw;

    /* Extract fields one at a time, handling quoted strings */
    for (let fi = 0; fi < fieldNames.length; fi++) {
      remaining = remaining.replace(/^\s+/, '');
      if (remaining.charAt(0) === '"') {
        let endQ = remaining.indexOf('"', 1);
        if (endQ < 0) endQ = remaining.length;
        vals.push(remaining.substring(1, endQ));
        remaining = remaining.substring(endQ + 1);
      } else {
        let spaceIdx = remaining.search(/\s/);
        if (spaceIdx < 0) spaceIdx = remaining.length;
        vals.push(remaining.substring(0, spaceIdx));
        remaining = remaining.substring(spaceIdx);
      }
    }

    if (vals.length !== fieldNames.length) continue;

    let row = {};
    for (let fi = 0; fi < fieldNames.length; fi++) {
      if (fi === timeIdx) {
        row[fieldNames[fi]] = vals[fi];
      } else {
        row[fieldNames[fi]] = parseFloat(vals[fi]);
      }
    }
    rows.push(row);
  }

  if (Nexpected > 0 && rows.length !== Nexpected) {
    console.warn('[traj] Expected ' + Nexpected + ' points, parsed ' + rows.length);
  }

  /* Extract title */
  let title = '';
  if (titleLine) {
    let tm = titleLine.match(/"([^"]+)"/);
    if (tm) title = tm[1];
  }

  return { fieldNames: fieldNames, rows: rows, timeField: timeIdx >= 0 ? fieldNames[timeIdx] : null, title: title };
};


/* ═══════════════════════════════════════════════════════════════════
   §2  HELPERS
   ═══════════════════════════════════════════════════════════════════ */

TRAJ._findField = function(names, patterns) {
  for (const pat of patterns) {
    const f = names.find(function(n) { return pat.test(n); });
    if (f) return f;
  }
  return null;
};

/** Get array of values for a field */
TRAJ._col = function(ds, field) {
  return ds.rows.map(function(r) { return r[field]; });
};

/** Format ISO time string for display: "Feb 10 14:00" */
TRAJ._shortTime = function(iso) {
  let d = new Date(iso);
  if (isNaN(d)) return iso;
  let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' ' +
    String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
};

/** Pick ~N nicely spaced tick indices from an array of length L */
TRAJ._tickIndices = function(L, N) {
  if (L <= N) {
    let all = [];
    for (let i = 0; i < L; i++) all.push(i);
    return all;
  }
  let step = (L - 1) / (N - 1);
  let indices = [];
  for (let k = 0; k < N; k++) indices.push(Math.round(k * step));
  return indices;
};


/* ═══════════════════════════════════════════════════════════════════
   §3  RENDER — GROUND TRACK MAP
   ═══════════════════════════════════════════════════════════════════ */

TRAJ._renderMap = async function() {
  let ds = TRAJ.dataset;
  if (!ds) return;
  let plotDiv = document.getElementById('traj-map-plot');
  if (!plotDiv) return;

  let colorField = _trVal('traj-map-color') || 'Rc_GV';
  let lonField = TRAJ._findField(ds.fieldNames, [/^lon/i]) || ds.fieldNames[1];
  let latField = TRAJ._findField(ds.fieldNames, [/^lat/i]) || ds.fieldNames[2];
  let timeField = ds.timeField;
  let styleCfg = TRAJ._tsStyle();

  let lons = TRAJ._col(ds, lonField);
  let lats = TRAJ._col(ds, latField);
  let colors = TRAJ._col(ds, colorField);
  let times = timeField ? TRAJ._col(ds, timeField) : lons.map(function(_,i) { return 'pt ' + i; });

  /* Hover text */
  let hoverTexts = [];
  for (let i = 0; i < lons.length; i++) {
    hoverTexts.push(
      (timeField ? TRAJ._shortTime(times[i]) : '') +
      '<br>lon=' + lons[i].toFixed(1) + '°  lat=' + lats[i].toFixed(1) + '°' +
      '<br>' + colorField + '=' + (typeof colors[i] === 'number' ? colors[i].toPrecision(4) : colors[i])
    );
  }

  let traces = [];

  /* Trajectory line (gray, behind markers) */
  traces.push({
    type: 'scatter', mode: 'lines',
    x: lons, y: lats,
    hoverinfo: 'skip', showlegend: false,
    line: { color: 'rgba(255,255,255,0.15)', width: 1.5 }
  });

  /* Trajectory markers colored by variable */
  traces.push({
    type: 'scatter', mode: 'markers',
    x: lons, y: lats,
    marker: {
      size: 8, color: colors,
      colorscale: 'Turbo', showscale: true,
      colorbar: {
        title: { text: colorField, side: 'top', font: { color: '#38c0ff', size: 10 } },
        thickness: 16, len: 0.85,
        tickfont: { color: '#8899aa', size: 9, family: 'IBM Plex Mono, monospace' }
      },
      line: { color: 'rgba(255,255,255,0.3)', width: 0.5 }
    },
    text: hoverTexts,
    hoverinfo: 'text',
    showlegend: false
  });

  /* Start / end markers */
  traces.push({
    type: 'scatter', mode: 'markers+text',
    x: [lons[0]], y: [lats[0]],
    marker: { size: 12, color: '#2dd4a0', symbol: 'diamond', line: { color: '#fff', width: 1 } },
    text: ['START'], textposition: 'top center',
    textfont: { color: '#2dd4a0', size: 9 },
    hoverinfo: 'skip', showlegend: false
  });
  traces.push({
    type: 'scatter', mode: 'markers+text',
    x: [lons[lons.length-1]], y: [lats[lats.length-1]],
    marker: { size: 12, color: '#ff5a5a', symbol: 'square', line: { color: '#fff', width: 1 } },
    text: ['END'], textposition: 'top center',
    textfont: { color: '#ff5a5a', size: 9 },
    hoverinfo: 'skip', showlegend: false
  });

  /* Coastlines */
  if (typeof LLMAP !== 'undefined' && LLMAP.getCoastlines) {
    let coastData = await LLMAP.getCoastlines();
    let usePm180 = (Math.min.apply(null, lons) < 0);
    for (const coast of coastData) {
      traces.push(LLMAP.makeCoastTrace(coast, usePm180, '#555555', 0.7));
    }
  }

  let layout = {
    title: { text: 'Ground Track — colored by ' + colorField, font: { color: '#38c0ff', size: 13, family: 'IBM Plex Sans, sans-serif' } },
    margin: { l: 55, r: 75, t: 40, b: 50 },
    paper_bgcolor: styleCfg.paperBg,
    plot_bgcolor: styleCfg.plotBg,
    font: { color: '#8899aa', family: 'IBM Plex Mono, monospace', size: 10 },
    xaxis: {
      title: { text: 'Longitude (deg)', font: { color: '#b0b8c8', size: 11 } },
      zeroline: false, showgrid: true, gridcolor: 'rgba(255,255,255,0.06)',
      color: '#8899aa', tickfont: { size: 9 }
    },
    yaxis: {
      title: { text: 'Latitude (deg)', font: { color: '#b0b8c8', size: 11 } },
      zeroline: false, showgrid: true, gridcolor: 'rgba(255,255,255,0.06)',
      color: '#8899aa', tickfont: { size: 9 },
      scaleanchor: 'x', scaleratio: 1, constrain: 'range'
    }
  };

  Plotly.newPlot(plotDiv, traces, layout, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d','select2d'] });
};


/* ═══════════════════════════════════════════════════════════════════
   §4  RENDER — TIME SERIES WITH THRESHOLD EXCEEDANCE
   ═══════════════════════════════════════════════════════════════════ */


/**
 * Build contiguous segments where the curve satisfies the threshold test.
 * Each returned segment has x[] and y[] arrays that already include any
 * interpolated threshold-crossing endpoints.
 */
/*
   Threshold shading geometry builder
   -------------------------------
   Inputs
     xVals   : monotonically increasing plotting coordinates (here: sample index)
     yVals   : plotted data values for the selected time-series variable
     thrVal  : numeric threshold entered by the user
     thrDir  : 'above' or 'below'

   Output
     Array of contiguous exceedance segments. Each segment stores only the
     *curve-side* polyline (x[], y[]) that satisfies the threshold criterion.
     The caller later closes each segment back to the threshold line to form
     a filled polygon.

   Why this exists
     Plotly filled traces are convenient for broad areas but can produce
     misleading artifacts when the active region is represented by a single
     trace with gaps/nulls. For a threshold problem, the physically correct
     filled area is piecewise: one island per contiguous interval where the
     curve is on the triggering side of the threshold. This helper computes
     those islands explicitly.

   Crossing treatment
     Whenever adjacent samples straddle the threshold, the exact crossing in
     x is estimated by linear interpolation. That is the minimal assumption
     consistent with the sampled line plot and is more accurate than snapping
     the shading edge to either sample index.
*/
TRAJ._buildThresholdSegments = function(xVals, yVals, thrVal, thrDir) {
  let isTriggered = (thrDir === 'below')
    ? function(v) { return v <= thrVal; }
    : function(v) { return v >= thrVal; };

  let segs = [];
  let curX = null;
  let curY = null;

  function ensureSegment() {
    if (!curX) { curX = []; curY = []; }
  }

  function closeSegment() {
    if (curX && curX.length >= 2) segs.push({ x: curX.slice(), y: curY.slice() });
    curX = null;
    curY = null;
  }

  function crossX(x0, y0, x1, y1) {
    let dy = y1 - y0;
    if (!isFinite(dy) || dy === 0) return 0.5 * (x0 + x1);
    let f = (thrVal - y0) / dy;
    if (!isFinite(f)) f = 0.5;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    return x0 + f * (x1 - x0);
  }

  for (let i = 0; i < yVals.length - 1; i++) {
    let x0 = xVals[i],   y0 = yVals[i];
    let x1 = xVals[i+1], y1 = yVals[i+1];

    if (!isFinite(y0) || !isFinite(y1)) {
      closeSegment();
      continue;
    }

    let c0 = isTriggered(y0);
    let c1 = isTriggered(y1);

    if (c0 && !curX) {
      curX = [x0];
      curY = [y0];
    }

    if (c0 && c1) {
      ensureSegment();
      if (curX.length === 0) {
        curX.push(x0); curY.push(y0);
      }
      curX.push(x1); curY.push(y1);
      continue;
    }

    if (c0 !== c1) {
      let xc = crossX(x0, y0, x1, y1);
      if (c0) {
        ensureSegment();
        if (curX.length === 0) {
          curX.push(x0); curY.push(y0);
        }
        curX.push(xc); curY.push(thrVal);
        closeSegment();
      } else {
        curX = [xc, x1];
        curY = [thrVal, y1];
      }
      continue;
    }

    closeSegment();
  }

  if (yVals.length > 0 && isFinite(yVals[yVals.length - 1]) && isTriggered(yVals[yVals.length - 1])) {
    ensureSegment();
    let xl = xVals[xVals.length - 1], yl = yVals[yVals.length - 1];
    if (curX.length === 0 || curX[curX.length - 1] !== xl || curY[curY.length - 1] !== yl) {
      curX.push(xl); curY.push(yl);
    }
  }
  closeSegment();
  return segs;
};


/* Convert #rgb / #rrggbb to numeric RGB components.
   Kept local to this viewer because the styling controls were added here
   first, but it can be promoted to a shared utility later if other panels
   gain user-selectable colors. */
TRAJ._hexToRgb = function(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let s = hex.trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null;
  if (s.length === 4) s = '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
  return {
    r: parseInt(s.slice(1,3), 16),
    g: parseInt(s.slice(3,5), 16),
    b: parseInt(s.slice(5,7), 16)
  };
};

/* Build a Plotly-friendly rgba(...) string from a hex color plus alpha.
   This is used for the shaded exceedance fill, threshold marker outline,
   and threshold annotation border so all threshold-related elements share
   the same hue family while differing only in opacity. */
TRAJ._rgba = function(hex, alpha) {
  let rgb = TRAJ._hexToRgb(hex);
  if (!rgb) return 'rgba(255,90,90,' + alpha + ')';
  let a = Number(alpha);
  if (!isFinite(a)) a = 1;
  if (a < 0) a = 0;
  if (a > 1) a = 1;
  return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + a + ')';
};

/*
   Collect all time-series styling options in one place.

   Rationale:
     Before the style upgrade, colors were hard-wired directly into the plot
     construction code. Once background/line/fill customization was added,
     repeating the same fallback and alpha logic inline would have made the
     render routine noisy and error-prone. Centralizing the style translation
     here makes `_renderTimeSeries()` easier to read and ensures that a color
     change propagates consistently to every related visual element.

   Returned fields:
     paperBg / plotBg   -> Plotly layout backgrounds
     lineColor          -> main series line + markers + title accent
     fillRgba           -> semi-transparent threshold exceedance polygons
     thrLineColor       -> dashed threshold line
     thrMarkerColor     -> highlighted exceedance markers
     thrMarkerOutline   -> subtle outline for highlighted markers
     annotationBorder   -> border color for the threshold label callout
*/
TRAJ._tsStyle = function() {
  let bgMode = _trVal('traj-ts-bg-mode') || 'dark';
  let bgColor = _trVal('traj-ts-bg-color') || '#0d1a2e';
  let lineColor = _trVal('traj-ts-line-color') || '#38c0ff';
  let fillColor = _trVal('traj-ts-fill-color') || '#ff5a5a';
  let fillAlpha = parseFloat(_trVal('traj-ts-fill-alpha'));
  if (!isFinite(fillAlpha)) fillAlpha = 0.12;
  fillAlpha = Math.max(0, Math.min(1, fillAlpha));

  let paperBg = '#070e1c';
  let plotBg = '#0d1a2e';
  if (bgMode === 'transparent') {
    paperBg = 'rgba(0,0,0,0)';
    plotBg = 'rgba(0,0,0,0)';
  } else if (bgMode === 'custom') {
    paperBg = bgColor;
    plotBg = bgColor;
  }

  return {
    bgMode: bgMode,
    paperBg: paperBg,
    plotBg: plotBg,
    lineColor: lineColor,
    fillColor: fillColor,
    fillAlpha: fillAlpha,
    fillRgba: TRAJ._rgba(fillColor, fillAlpha),
    thrLineColor: fillColor,
    thrMarkerColor: fillColor,
    thrMarkerOutline: TRAJ._rgba(fillColor, 0.5),
    annotationBorder: TRAJ._rgba(fillColor, 0.3)
  };
};

/*
   Render the lower time-series panel.

   Render order matters here:
     1. threshold exceedance fill polygons
     2. highlighted exceedance markers
     3. main line/marker series
     4. dashed threshold line + annotation

   That ordering keeps the fill visually behind the data while preserving
   clear red markers at exceedance samples and a readable threshold label.
*/
TRAJ._renderTimeSeries = function() {
  let ds = TRAJ.dataset;
  if (!ds) return;
  let plotDiv = document.getElementById('traj-ts-plot');
  if (!plotDiv) return;

  let varField  = _trVal('traj-ts-var') || ds.fieldNames[4];
  let scaleType = _trVal('traj-ts-scale') || 'linear';
  let thrStr    = _trVal('traj-thr-val');
  let thrVal    = (thrStr.trim() !== '') ? parseFloat(thrStr) : null;
  let thrDir    = _trVal('traj-thr-dir') || 'above';
  let timeField = ds.timeField;
  let styleCfg = TRAJ._tsStyle();

  /** Test whether a value triggers the threshold */
  let thrTest = (thrDir === 'below')
    ? function(v) { return v <= thrVal; }
    : function(v) { return v >= thrVal; };
  let thrLabel = (thrDir === 'below') ? 'Below threshold' : 'Above threshold';
  let thrWord  = (thrDir === 'below') ? 'BELOW' : 'ABOVE';

  let yVals = TRAJ._col(ds, varField);
  let times = timeField ? TRAJ._col(ds, timeField) : yVals.map(function(_,i) { return i; });

  /* Build x-axis: use sequential index, with time tick labels */
  let xIdx = [];
  for (let i = 0; i < yVals.length; i++) xIdx.push(i);

  /* Time tick labels */
  let tickIdxs = TRAJ._tickIndices(xIdx.length, 8);
  let tickVals = tickIdxs.map(function(i) { return i; });
  let tickTexts = tickIdxs.map(function(i) {
    return timeField ? TRAJ._shortTime(times[i]) : String(i);
  });

  /* Hover text with full time + value */
  let hoverTexts = [];
  for (let i = 0; i < yVals.length; i++) {
    let tStr = timeField ? times[i] : 'pt ' + i;
    hoverTexts.push(tStr + '<br>' + varField + ' = ' + (typeof yVals[i] === 'number' ? yVals[i].toPrecision(5) : yVals[i]));
  }

  let traces = [];

  /* Threshold exceedance shading — draw BEFORE main line */
  if (thrVal !== null && isFinite(thrVal)) {
    /*
       Build one filled polygon per contiguous threshold-exceedance interval.
       This avoids Plotly fill artifacts across null gaps and ensures shading
       appears only where the curve is actually above/below the threshold.
    */
    let shadeSegments = TRAJ._buildThresholdSegments(xIdx, yVals, thrVal, thrDir);
    shadeSegments.forEach(function(seg) {
      /*
         Convert one active threshold interval into a closed polygon:
           forward  pass -> follow the true data curve across the interval
           reverse pass -> return along the horizontal threshold baseline

         Using `fill: 'toself'` on an explicit polygon prevents Plotly from
         inventing connections across inactive gaps elsewhere in the record.
      */
      let polyX = seg.x.slice().concat(seg.x.slice().reverse());
      let polyY = seg.y.slice().concat(seg.x.map(function() { return thrVal; }).reverse());
      traces.push({
        type: 'scatter', mode: 'lines',
        x: polyX, y: polyY,
        line: { width: 0, color: 'rgba(0,0,0,0)' },
        fill: 'toself',
        fillcolor: styleCfg.fillRgba,
        hoverinfo: 'skip',
        showlegend: false
      });
    });

    /*
       Highlight the sampled points that themselves satisfy the criterion.
       These markers complement the filled polygons: the polygons show the
       continuous interval estimate, while the markers show the actual stored
       samples that triggered the condition.
    */
    let exX = [], exY = [], exH = [];
    for (let i = 0; i < yVals.length; i++) {
      if (thrTest(yVals[i])) {
        exX.push(xIdx[i]); exY.push(yVals[i]);
        exH.push((timeField ? TRAJ._shortTime(times[i]) : 'pt ' + i) +
          '<br>' + varField + ' = ' + yVals[i].toPrecision(5) +
          '<br><b>' + thrWord + ' THRESHOLD</b>');
      }
    }
    if (exX.length > 0) {
      traces.push({
        type: 'scatter', mode: 'markers',
        x: exX, y: exY,
        marker: { size: 9, color: styleCfg.thrMarkerColor, symbol: 'circle',
                  line: { color: styleCfg.thrMarkerOutline, width: 1 } },
        text: exH, hoverinfo: 'text',
        showlegend: true, name: thrLabel
      });
    }
  }

  /* Main data line */
  traces.push({
    type: 'scatter', mode: 'lines+markers',
    x: xIdx, y: yVals,
    line: { color: styleCfg.lineColor, width: 2 },
    marker: { size: 5, color: styleCfg.lineColor },
    text: hoverTexts, hoverinfo: 'text',
    showlegend: true, name: varField
  });

  /* Threshold line */
  let shapes = [];
  if (thrVal !== null && isFinite(thrVal)) {
    shapes.push({
      type: 'line', xref: 'paper', x0: 0, x1: 1,
      yref: 'y', y0: thrVal, y1: thrVal,
      line: { color: styleCfg.thrLineColor, width: 1.5, dash: 'dash' }
    });
  }

  let layout = {
    title: { text: varField + ' vs Time', font: { color: styleCfg.lineColor, size: 13, family: 'IBM Plex Sans, sans-serif' } },
    margin: { l: 70, r: 20, t: 40, b: 60 },
    paper_bgcolor: styleCfg.paperBg,
    plot_bgcolor: styleCfg.plotBg,
    font: { color: '#8899aa', family: 'IBM Plex Mono, monospace', size: 10 },
    xaxis: {
      title: { text: 'Time (UTC)', font: { color: '#b0b8c8', size: 11 } },
      zeroline: false, showgrid: true, gridcolor: 'rgba(255,255,255,0.06)',
      color: '#8899aa',
      tickmode: 'array', tickvals: tickVals, ticktext: tickTexts,
      tickangle: -30, tickfont: { size: 9 }
    },
    yaxis: {
      title: { text: varField, font: { color: '#b0b8c8', size: 11 } },
      zeroline: false, showgrid: true, gridcolor: 'rgba(255,255,255,0.06)',
      color: '#8899aa', tickfont: { size: 9 },
      type: scaleType === 'log' ? 'log' : 'linear'
    },
    shapes: shapes,
    legend: {
      bgcolor: 'rgba(7,14,28,0.7)', bordercolor: 'rgba(255,255,255,0.1)', borderwidth: 1,
      font: { color: '#b0b8c8', size: 9 },
      x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top'
    },
    annotations: (thrVal !== null && isFinite(thrVal)) ? [{
      x: 1.0, xref: 'paper', xanchor: 'right',
      y: thrVal, yref: 'y',
      text: 'threshold = ' + thrVal,
      showarrow: false,
      font: { color: styleCfg.thrLineColor, size: 9, family: 'IBM Plex Mono, monospace' },
      bgcolor: (styleCfg.bgMode === 'transparent') ? 'rgba(7,14,28,0.65)' : 'rgba(7,14,28,0.8)',
      bordercolor: styleCfg.annotationBorder, borderwidth: 1, borderpad: 3
    }] : []
  };

  Plotly.newPlot(plotDiv, traces, layout, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d','select2d'] });
};


/* ═══════════════════════════════════════════════════════════════════
   §5  MASTER RENDER
   ═══════════════════════════════════════════════════════════════════ */

async function renderTrajectory() {
  if (!TRAJ.dataset) return;
  await TRAJ._renderMap();
  TRAJ._renderTimeSeries();
}


/* ═══════════════════════════════════════════════════════════════════
   §6  CONTROL HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function _trVal(id) { let e = document.getElementById(id); return e ? e.value : ''; }


/* ═══════════════════════════════════════════════════════════════════
   §7  INIT + EVENT WIRING
   ═══════════════════════════════════════════════════════════════════ */

function initTrajectoryViewer() {
  /*
     Auto-render on control change.

     The new style controls intentionally re-render only the time-series
     panel, not the map panel, because they affect only the lower plot. This
     keeps UI feedback immediate and avoids unnecessary coastline/map redraws.
  */
  ['traj-map-color'].forEach(function(id) {
    let el = document.getElementById(id);
    if (el) el.addEventListener('change', function() { if (TRAJ.dataset) TRAJ._renderMap(); });
  });

  ['traj-ts-var', 'traj-ts-scale', 'traj-thr-val', 'traj-thr-dir', 'traj-ts-bg-mode', 'traj-ts-bg-color', 'traj-ts-line-color', 'traj-ts-fill-color', 'traj-ts-fill-alpha'].forEach(function(id) {
    let el = document.getElementById(id);
    if (el) el.addEventListener('change', function() { if (TRAJ.dataset) TRAJ._renderTimeSeries(); });
  });

  /* Threshold input: also trigger on Enter key and blur */
  let thrInput = document.getElementById('traj-thr-val');
  if (thrInput) {
    thrInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && TRAJ.dataset) TRAJ._renderTimeSeries();
    });
    thrInput.addEventListener('blur', function() {
      if (TRAJ.dataset) TRAJ._renderTimeSeries();
    });
  }

  /*
     Color pickers and alpha slider also listen to `input` so users get live
     visual feedback while dragging the control, not only after the control
     loses focus or fires a final `change` event.
  */
  ['traj-ts-bg-color', 'traj-ts-line-color', 'traj-ts-fill-color', 'traj-ts-fill-alpha'].forEach(function(id) {
    let el = document.getElementById(id);
    if (el) el.addEventListener('input', function() { if (TRAJ.dataset) TRAJ._renderTimeSeries(); });
  });

  /* File input */
  let fileInput = document.getElementById('traj-file');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      if (e.target.files[0]) loadTrajectoryFile(e.target.files[0]);
    });
  }

  /* PNG download */
  let dlMap = document.getElementById('traj-download-map');
  if (dlMap) dlMap.addEventListener('click', function() {
    if (typeof Plotly !== 'undefined') Plotly.downloadImage('traj-map-plot', { format: 'png', filename: 'trajectory_groundtrack', width: 1400, height: 700, scale: 2 });
  });
  let dlTs = document.getElementById('traj-download-ts');
  if (dlTs) dlTs.addEventListener('click', function() {
    if (typeof Plotly !== 'undefined') Plotly.downloadImage('traj-ts-plot', { format: 'png', filename: 'trajectory_timeseries', width: 1400, height: 500, scale: 2 });
  });
}

function loadTrajectoryFile(file) {
  let status = document.getElementById('traj-status');
  file.text().then(function(text) { loadTrajectoryText(text, file.name); })
    .catch(function(err) { if (status) { status.textContent = 'Error: ' + err.message; status.style.color = '#ff5a5a'; } });
}

function loadTrajectoryText(text, name) {
  let status = document.getElementById('traj-status');
  let mapColorSel = document.getElementById('traj-map-color');
  let tsVarSel = document.getElementById('traj-ts-var');

  try {
    TRAJ.dataset = TRAJ.parse(text);
    let ds = TRAJ.dataset;

    /* Populate field selectors — exclude time, lon, lat */
    let dataFields = ds.fieldNames.filter(function(f) { return !/^time|^lon|^lat/i.test(f); });

    [mapColorSel, tsVarSel].forEach(function(sel) {
      if (!sel) return;
      sel.innerHTML = '';
      dataFields.forEach(function(f) {
        let opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        sel.appendChild(opt);
      });
    });

    if (status) {
      status.textContent = 'Loaded: ' + (name || 'file') + ' · ' + ds.rows.length + ' points · ' +
        ds.fieldNames.length + ' variables' + (ds.title ? ' · ' + ds.title : '');
      status.style.color = '#2dd4a0';
    }

    renderTrajectory();
  } catch (err) {
    if (status) { status.textContent = 'Parse error: ' + err.message; status.style.color = '#ff5a5a'; }
    console.error('[traj-viewer]', err);
  }
}
