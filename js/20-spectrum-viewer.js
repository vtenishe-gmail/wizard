/*
=====================================================================
FILE: js/20-spectrum-viewer.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Multi-zone energy spectrum viewer using Plotly.js.

  Parses Tecplot ASCII files with multiple ZONE blocks (one spectrum
  per zone). Renders overlaid spectra with:
    - Independent linear/log controls for X and Y axes
    - Zone selection: All, N evenly-spaced, or every Nth zone
    - Each spectrum in a distinct color with zone title legend
    - Hover probe showing energy, value, and zone title

PUBLIC API
  initSpectrumViewer()          — wire controls + events
  loadSpectrumFile(file)        — parse File → render
  loadSpectrumText(text,name)   — parse text → render
  renderSpectrumPlot()          — redraw

DEPENDS ON: Plotly.js (CDN)
LAST UPDATED: 2026-03-07
=====================================================================
*/

let SPEC = {};
SPEC.dataset = null;


/* ═══════════════════════════════════════════════════════════════════
   §1  MULTI-ZONE TECPLOT PARSER
   ═══════════════════════════════════════════════════════════════════ */

SPEC.parse = function(text) {
  let lines = text.split(/\r?\n/);
  let varLine = null, globalTitle = '';
  let zones = [];
  let currentZone = null;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || /^[#!]/.test(line)) continue;

    if (/^title\s*=/i.test(line)) {
      let tm = line.match(/"([^"]*)"/);
      if (tm) globalTitle = tm[1];
      continue;
    }

    if (/^variables/i.test(line)) {
      varLine = rawLine;
      continue;
    }

    if (/^zone/i.test(line)) {
      /* Start a new zone */
      let zt = line.match(/T\s*=\s*"([^"]*)"/i);
      let zi = line.match(/I\s*=\s*(\d+)/i);
      currentZone = {
        title: zt ? zt[1] : 'Zone ' + (zones.length + 1),
        I: zi ? parseInt(zi[1], 10) : 0,
        rows: []
      };
      zones.push(currentZone);
      continue;
    }

    /* Data line */
    if (currentZone && varLine) {
      let vals = line.split(/[\s,]+/).filter(Boolean).map(Number);
      if (vals.length > 0) currentZone.rows.push(vals);
    }
  }

  if (!varLine) throw new Error('VARIABLES line not found.');
  if (zones.length === 0) throw new Error('No ZONE blocks found.');

  /* Parse variable names */
  let fieldNames = [];
  let matches = varLine.matchAll(/"([^"]+)"/g);
  for (let m of matches) fieldNames.push(m[1]);
  if (fieldNames.length === 0) {
    fieldNames = varLine.replace(/^variables\s*=?\s*/i, '').split(/[\s,]+/).filter(Boolean);
  }

  return { fieldNames: fieldNames, zones: zones, globalTitle: globalTitle };
};


/* ═══════════════════════════════════════════════════════════════════
   §2  ZONE SELECTION LOGIC
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Return array of zone indices to display based on selection mode.
 *
 * @param {number} totalZones
 * @param {string} mode — 'all' | 'count' | 'step'
 * @param {number} param — number of zones (count) or step size (step)
 * @returns {number[]} selected zone indices (0-based)
 */
SPEC.selectZones = function(totalZones, mode, param) {
  if (mode === 'all' || totalZones <= 1) {
    let all = [];
    for (let i = 0; i < totalZones; i++) all.push(i);
    return all;
  }

  if (mode === 'count') {
    let n = Math.max(1, Math.min(param, totalZones));
    if (n >= totalZones) {
      let all2 = [];
      for (let i = 0; i < totalZones; i++) all2.push(i);
      return all2;
    }
    let step = (totalZones - 1) / (n - 1);
    let indices = [];
    for (let k = 0; k < n; k++) indices.push(Math.round(k * step));
    return indices;
  }

  if (mode === 'step') {
    let s = Math.max(1, Math.floor(param));
    let indices = [];
    for (let i = 0; i < totalZones; i += s) indices.push(i);
    /* Always include last zone */
    if (indices[indices.length - 1] !== totalZones - 1) indices.push(totalZones - 1);
    return indices;
  }

  return [0];
};


/* ═══════════════════════════════════════════════════════════════════
   §3  COLOR PALETTE — distinct colors for up to ~50 spectra
   ═══════════════════════════════════════════════════════════════════ */

SPEC.PALETTE = [
  '#38c0ff','#2dd4a0','#ff9a3c','#ff5a5a','#8b6ff7','#ffd04b',
  '#ff6bab','#60d6d6','#a0e040','#c090ff','#ff8060','#40a0ff',
  '#e0d060','#ff40a0','#40ffa0','#a0a0ff','#ffa040','#40e0e0',
  '#e06060','#60ff60','#c060ff','#ffe060','#60a0a0','#ff6060',
  '#6060ff','#a0ff60','#ff60ff','#60ffd0','#d0a060','#6090ff'
];

SPEC.getColor = function(idx, total) {
  if (total <= SPEC.PALETTE.length) {
    return SPEC.PALETTE[idx % SPEC.PALETTE.length];
  }
  /* For many zones, use HSL to generate evenly spaced hues */
  let hue = (idx / total * 360) % 360;
  return 'hsl(' + hue.toFixed(0) + ',80%,60%)';
};


/* ═══════════════════════════════════════════════════════════════════
   §4  MAIN RENDER
   ═══════════════════════════════════════════════════════════════════ */

function renderSpectrumPlot() {
  let ds = SPEC.dataset;
  if (!ds) return;
  if (typeof Plotly === 'undefined') return;

  let plotDiv = document.getElementById('spec-viewer-plot');
  if (!plotDiv) return;

  /* Read controls */
  let xField  = _spVal('spec-x-var') || ds.fieldNames[0];
  let yField  = _spVal('spec-y-var') || ds.fieldNames[1];
  let xScale  = _spVal('spec-x-scale') || 'log';
  let yScale  = _spVal('spec-y-scale') || 'log';
  let selMode = _spVal('spec-sel-mode') || 'all';
  let selParam = parseInt(_spVal('spec-sel-param')) || 10;

  /* Find field indices */
  let xIdx = ds.fieldNames.indexOf(xField);
  let yIdx = ds.fieldNames.indexOf(yField);
  if (xIdx < 0) xIdx = 0;
  if (yIdx < 0) yIdx = 1;

  /* Select zones */
  let zoneIndices = SPEC.selectZones(ds.zones.length, selMode, selParam);

  /* Build traces */
  let traces = [];
  for (let zi = 0; zi < zoneIndices.length; zi++) {
    let zIdx = zoneIndices[zi];
    let zone = ds.zones[zIdx];
    let xArr = [], yArr = [];

    for (const row of zone.rows) {
      if (row.length > Math.max(xIdx, yIdx)) {
        xArr.push(row[xIdx]);
        yArr.push(row[yIdx]);
      }
    }

    let color = SPEC.getColor(zi, zoneIndices.length);

    /* Short legend label from zone title */
    let label = zone.title;
    if (label.length > 24) {
      /* Try to extract just the timestamp part */
      let tMatch = label.match(/\d{4}-\d{2}-\d{2}T?\d{0,2}:?\d{0,2}/);
      if (tMatch) label = tMatch[0];
    }

    traces.push({
      type: 'scatter', mode: 'lines',
      x: xArr, y: yArr,
      line: { color: color, width: 1.5 },
      name: label,
      hovertemplate: label + '<br>' + xField + '=%{x:.4g}<br>' + yField + '=%{y:.4g}<extra></extra>'
    });
  }

  /* Layout */
  let layout = {
    title: { text: yField + ' vs ' + xField + ' (' + zoneIndices.length + ' of ' + ds.zones.length + ' zones)',
             font: { color: '#38c0ff', size: 13, family: 'IBM Plex Sans, sans-serif' } },
    margin: { l: 75, r: 20, t: 40, b: 55 },
    paper_bgcolor: '#070e1c',
    plot_bgcolor: '#0d1a2e',
    font: { color: '#8899aa', family: 'IBM Plex Mono, monospace', size: 10 },
    xaxis: {
      title: { text: xField, font: { color: '#b0b8c8', size: 11 } },
      type: xScale, zeroline: false, showgrid: true,
      gridcolor: 'rgba(255,255,255,0.06)', color: '#8899aa', tickfont: { size: 9 },
      exponentformat: 'power'
    },
    yaxis: {
      title: { text: yField, font: { color: '#b0b8c8', size: 11 } },
      type: yScale, zeroline: false, showgrid: true,
      gridcolor: 'rgba(255,255,255,0.06)', color: '#8899aa', tickfont: { size: 9 },
      exponentformat: 'power'
    },
    legend: {
      bgcolor: 'rgba(7,14,28,0.85)', bordercolor: 'rgba(255,255,255,0.08)', borderwidth: 1,
      font: { color: '#b0b8c8', size: 8, family: 'IBM Plex Mono, monospace' },
      tracegroupgap: 2,
      x: 1.0, xanchor: 'right', y: 1.0, yanchor: 'top'
    },
    showlegend: (zoneIndices.length <= 30)
  };

  Plotly.newPlot(plotDiv, traces, layout, {
    responsive: true, displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d','select2d']
  });

  /* Update info */
  let info = document.getElementById('spec-zone-info');
  if (info) info.textContent = 'Showing ' + zoneIndices.length + ' of ' + ds.zones.length + ' zones';
}


/* ═══════════════════════════════════════════════════════════════════
   §5  CONTROL HELPERS + VISIBILITY LOGIC
   ═══════════════════════════════════════════════════════════════════ */

function _spVal(id) { let e = document.getElementById(id); return e ? e.value : ''; }

/** Show/hide the param input and update its label based on mode */
function _spUpdateSelUI() {
  let mode = _spVal('spec-sel-mode');
  let paramWrap = document.getElementById('spec-sel-param-wrap');
  let paramLabel = document.getElementById('spec-sel-param-label');
  let paramInput = document.getElementById('spec-sel-param');
  if (!paramWrap) return;

  if (mode === 'all') {
    paramWrap.style.display = 'none';
  } else {
    paramWrap.style.display = '';
    if (mode === 'count') {
      if (paramLabel) paramLabel.textContent = 'Show N zones';
      if (paramInput) paramInput.placeholder = 'e.g. 10';
    } else {
      if (paramLabel) paramLabel.textContent = 'Every Nth zone';
      if (paramInput) paramInput.placeholder = 'e.g. 5';
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════
   §6  INIT + EVENT WIRING
   ═══════════════════════════════════════════════════════════════════ */

function initSpectrumViewer() {
  ['spec-x-var','spec-y-var','spec-x-scale','spec-y-scale','spec-sel-mode','spec-sel-param'].forEach(function(id) {
    let el = document.getElementById(id);
    if (el) el.addEventListener('change', function() {
      if (id === 'spec-sel-mode') _spUpdateSelUI();
      if (SPEC.dataset) renderSpectrumPlot();
    });
  });

  /* Param input: also on Enter and blur */
  let paramInput = document.getElementById('spec-sel-param');
  if (paramInput) {
    paramInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && SPEC.dataset) renderSpectrumPlot();
    });
    paramInput.addEventListener('blur', function() {
      if (SPEC.dataset) renderSpectrumPlot();
    });
  }

  let fileInput = document.getElementById('spec-file');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      if (e.target.files[0]) loadSpectrumFile(e.target.files[0]);
    });
  }

  let dlBtn = document.getElementById('spec-download-png');
  if (dlBtn) dlBtn.addEventListener('click', function() {
    if (typeof Plotly !== 'undefined') Plotly.downloadImage('spec-viewer-plot', { format: 'png', filename: 'energy_spectra', width: 1400, height: 700, scale: 2 });
  });

  _spUpdateSelUI();
}


function loadSpectrumFile(file) {
  let status = document.getElementById('spec-status');
  file.text().then(function(text) { loadSpectrumText(text, file.name); })
    .catch(function(err) { if (status) { status.textContent = 'Error: ' + err.message; status.style.color = '#ff5a5a'; } });
}

function loadSpectrumText(text, name) {
  let status = document.getElementById('spec-status');
  let xSel = document.getElementById('spec-x-var');
  let ySel = document.getElementById('spec-y-var');

  try {
    SPEC.dataset = SPEC.parse(text);
    let ds = SPEC.dataset;

    /* Populate field selectors */
    [xSel, ySel].forEach(function(sel) {
      if (!sel) return;
      sel.innerHTML = '';
      ds.fieldNames.forEach(function(f) {
        let opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        sel.appendChild(opt);
      });
    });

    /* Default: X = first field (energy), Y = second field */
    if (xSel && ds.fieldNames.length > 0) xSel.value = ds.fieldNames[0];
    if (ySel && ds.fieldNames.length > 1) ySel.value = ds.fieldNames[1];

    if (status) {
      status.textContent = 'Loaded: ' + (name || 'file') + ' · ' + ds.zones.length + ' zones · ' +
        ds.fieldNames.length + ' variables · ' + (ds.zones[0] ? ds.zones[0].rows.length : '?') + ' pts/zone';
      status.style.color = '#2dd4a0';
    }

    renderSpectrumPlot();
  } catch (err) {
    if (status) { status.textContent = 'Parse error: ' + err.message; status.style.color = '#ff5a5a'; }
    console.error('[spec-viewer]', err);
  }
}
