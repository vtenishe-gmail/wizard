/*
=====================================================================
FILE: js/18-lonlat-viewer.js
PROJECT: AMPS CCMC Submission Interface v3 — Visualization Layer
PURPOSE: Lon/Lat structured-grid map viewer using Plotly.js.

  Parses Tecplot ASCII files (VARIABLES, ZONE I=, J=, F=POINT),
  renders heatmaps or contour-fill maps via Plotly, including:
    - Interactive zoom / pan / box-select / probe
    - Heatmap or contour-fill plot styles
    - Sharp (cell) or smooth (interpolated) rendering
    - Configurable colormaps with reversal
    - Adjustable color min / max with auto range
    - High-resolution continent outlines (TopoJSON world-atlas CDN)
    - Configurable continent line color and width
    - Longitude 0–360 or ±180 handling
    - Full hover readout (lon, lat, value)
    - PNG download via Plotly

  Requires Plotly.js loaded from CDN (see index.html <script> tag).
  Coastlines fetched once from cdn.jsdelivr.net/npm/world-atlas@2.

  Core rendering and coastline logic extracted from
  tecplot_lonlat_viewer_colorbar_scale_options_v2.html (user-provided).

PUBLIC API
  initLonLatViewer()            — wire controls + events
  loadTecplotFile(file)         — parse a File → render
  loadTecplotText(text, name)   — parse text string → render
  renderLonLatMap()             — redraw from current dataset

DEPENDS ON: Plotly.js (CDN), 01-state.js ($ helper, optional)
LAST UPDATED: 2026-03-07
=====================================================================
*/

const LLMAP = {};

LLMAP.dataset = null;
LLMAP.currentZoneIndex = 0;
LLMAP._coastlineTraces = null;
LLMAP._coastlineAttempted = false;

/*
 * Persistent on-plot numeric probe stamps.
 *
 * The built-in Plotly hover readout is excellent for transient inspection,
 * but it does not let the user leave a breadcrumb trail of values directly
 * on the figure. For geospace maps this is often needed when comparing the
 * same field across multiple geographic locations by eye.
 *
 * Data model used here:
 *   LLMAP.stamps[key] = [
 *     { x, y, z, label, field, zoneIndex, zoneTitle, lonMode }, ...
 *   ]
 *
 * where `key` is tied to the currently visualized zone + field + longitude
 * convention. This ensures that stamps belong to the exact visualized layer
 * rather than leaking across unrelated fields or zones.
 */
LLMAP.stamps = Object.create(null);


/* ═══════════════════════════════════════════════════════════════════
   §1  TECPLOT ASCII PARSER
   ═══════════════════════════════════════════════════════════════════ */

LLMAP.parseTecplot = function(text) {
  const lines = text.split(/\r?\n/);
  let titleLine = null;
  let varLine = null;
  let currentZone = null;
  const zones = [];

  /*
   * Multi-zone Tecplot parser.
   *
   * Previous behavior kept only the last encountered ZONE line and then
   * collected every following data row into a single dataset. That worked
   * for one-zone files, but it made structured-grid shell stacks or other
   * multi-zone lon/lat products impossible to browse.
   *
   * New behavior:
   *   - parse a single VARIABLES definition shared by all zones
   *   - create one zone object per ZONE block
   *   - preserve the zone title (ZONE T="...") for UI display
   *   - validate I×J and point count for each zone independently
   */
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[#!]/.test(line)) continue;

    if (/^title/i.test(line)) {
      titleLine = raw;
      continue;
    }

    if (/^variables/i.test(line)) {
      varLine = raw;
      continue;
    }

    if (/^zone/i.test(line)) {
      if (!varLine) throw new Error('VARIABLES line must appear before ZONE blocks.');

      const mi = raw.match(/I\s*=\s*(\d+)/i);
      const mj = raw.match(/J\s*=\s*(\d+)/i);
      const mt = raw.match(/T\s*=\s*"([^"]*)"/i);
      const I = mi ? parseInt(mi[1], 10) : 0;
      const J = mj ? parseInt(mj[1], 10) : 0;
      if (!I || !J) throw new Error('Each ZONE must provide I and J dimensions.');

      currentZone = {
        title: mt ? mt[1] : 'Zone ' + (zones.length + 1),
        rawZoneLine: raw,
        I: I,
        J: J,
        rows: []
      };
      zones.push(currentZone);
      continue;
    }

    if (!currentZone) continue;

    const vals = line.split(/[\s,]+/).filter(Boolean).map(Number);
    if (vals.length !== 0) currentZone.rows.push(vals);
  }

  if (!varLine) throw new Error('VARIABLES line not found.');
  if (zones.length === 0) throw new Error('ZONE line not found.');

  let fieldNames = [...varLine.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (fieldNames.length === 0) {
    fieldNames = varLine.replace(/^variables\s*=?\s*/i, '').split(/[\s,]+/).filter(Boolean);
  }
  if (fieldNames.length === 0) throw new Error('No variable names found.');

  for (const zone of zones) {
    const rows = [];
    for (const vals of zone.rows) {
      if (vals.length !== fieldNames.length) continue;
      const row = {};
      for (let i = 0; i < fieldNames.length; i++) row[fieldNames[i]] = vals[i];
      rows.push(row);
    }
    if (rows.length !== zone.I * zone.J) {
      throw new Error(`Zone "${zone.title}": expected ${zone.I * zone.J} points (I×J=${zone.I}×${zone.J}), got ${rows.length}.`);
    }
    zone.rows = rows;
  }

  const globalTitleMatch = titleLine ? titleLine.match(/TITLE\s*=\s*"([^"]*)"/i) : null;
  return {
    title: globalTitleMatch ? globalTitleMatch[1] : '',
    fieldNames,
    zones
  };
};


/* ═══════════════════════════════════════════════════════════════════
   §2  GRID BUILDER
   ═══════════════════════════════════════════════════════════════════ */

LLMAP._findField = function(names, patterns) {
  for (const p of patterns) {
    const f = names.find(n => p.test(n));
    if (f) return f;
  }
  return null;
};

LLMAP.buildGrid = function(zone, field, lonMode) {
  const lonField = LLMAP._findField(LLMAP.dataset.fieldNames, [/^lon/i, /longitude/i, /^phi/i]) || LLMAP.dataset.fieldNames[0];
  const latField = LLMAP._findField(LLMAP.dataset.fieldNames, [/^lat/i, /latitude/i, /^theta/i]) || LLMAP.dataset.fieldNames[1];

  const lonRow0 = [];
  for (let i = 0; i < zone.I; i++) lonRow0.push(zone.rows[i][lonField]);
  const latCol0 = [];
  for (let j = 0; j < zone.J; j++) latCol0.push(zone.rows[j * zone.I][latField]);

  let lons = lonRow0.slice();
  let lats = latCol0.slice();

  if (lonMode === 'pm180') {
    lons = lons.map(function(v) { let x = v; while (x > 180) { x -= 360; } while (x <= -180) { x += 360; } return x; });
    const order = lons.map(function(v, idx) { return { v: v, idx: idx }; }).sort(function(a, b) { return a.v - b.v; });
    const sortedLons = order.map(function(o) { return o.v; });
    const z = [];
    for (let j = 0; j < zone.J; j++) {
      const row = [];
      for (const o of order) row.push(zone.rows[j * zone.I + o.idx][field]);
      z.push(row);
    }
    return { lons: sortedLons, lats: lats, z: z };
  }

  const z = [];
  for (let j = 0; j < zone.J; j++) {
    const row = [];
    for (let i = 0; i < zone.I; i++) row.push(zone.rows[j * zone.I + i][field]);
    z.push(row);
  }
  return { lons: lons, lats: lats, z: z };
};

LLMAP.maybeTranspose = function(x, y, z) {
  let looksNormal = (z.length === y.length) && (z[0] && z[0].length === x.length);
  if (looksNormal) return { x: x, y: y, z: z };
  let zt = z[0].map(function(_, ci) { return z.map(function(row) { return row[ci]; }); });
  return { x: y, y: x, z: zt };
};


/* ═══════════════════════════════════════════════════════════════════
   §3  COASTLINE LOADING  (TopoJSON world-atlas via CDN)
   ═══════════════════════════════════════════════════════════════════ */

function _wrapLon180(v) { let x = v; while (x > 180) { x -= 360; } while (x <= -180) { x += 360; } return x; }
function _wrapLon360(v) { let x = v % 360; if (x < 0) { x += 360; } return x; }

LLMAP.getCoastlines = async function() {
  if (LLMAP._coastlineTraces !== null) return LLMAP._coastlineTraces;
  if (LLMAP._coastlineAttempted) return [];
  LLMAP._coastlineAttempted = true;

  let url = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
  try {
    let resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    let topo = await resp.json();

    const scale     = topo.transform?.scale     ?? [1, 1];
    const translate = topo.transform?.translate  ?? [0, 0];

    function decodeArc(arc) {
      let x = 0, y = 0, pts = [];
      for (const pt of arc) {
        x += pt[0]; y += pt[1];
        pts.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
      }
      return pts;
    }

    let arcs = topo.arcs.map(decodeArc);

    function arcByIndex(i) {
      if (i >= 0) return arcs[i];
      return arcs[~i].slice().reverse();
    }

    function stitch(indices) {
      let pts = [];
      for (let idx = 0; idx < indices.length; idx++) {
        let seg = arcByIndex(indices[idx]);
        if (idx === 0) { for (const p of seg) pts.push(p); }
        else           { for (const p of seg.slice(1)) pts.push(p); }
      }
      return pts;
    }

    function objectToRings(obj) {
      let out = [];
      if (obj.type === 'Polygon') {
        for (const arc of obj.arcs) out.push(stitch(arc));
      } else if (obj.type === 'MultiPolygon') {
        for (const poly of obj.arcs)
          for (const arc of poly) out.push(stitch(arc));
      } else if (obj.type === 'GeometryCollection') {
        for (const geom of obj.geometries)
          out = out.concat(objectToRings(geom));
      }
      return out;
    }

    let rings = objectToRings(topo.objects.countries);
    LLMAP._coastlineTraces = rings.map(function(ring) {
      return { rawLon: ring.map(function(p) { return p[0]; }),
               rawLat: ring.map(function(p) { return p[1]; }) };
    });
    return LLMAP._coastlineTraces;
  } catch (err) {
    console.warn('[lonlat-viewer] Could not load coastlines:', err);
    LLMAP._coastlineTraces = [];
    return [];
  }
};

LLMAP.makeCoastTrace = function(raw, usePm180, lineColor, lineWidth) {
  let x = [], y = [];
  let convert = usePm180 ? _wrapLon180 : _wrapLon360;
  let splitThreshold = usePm180 ? 180 : 300;

  for (let i = 0; i < raw.rawLon.length; i++) {
    let lon = convert(raw.rawLon[i]);
    let lat = raw.rawLat[i];
    if (i > 0 && x.length && x[x.length - 1] !== null) {
      if (Math.abs(lon - x[x.length - 1]) > splitThreshold) {
        x.push(null); y.push(null);
      }
    }
    x.push(lon); y.push(lat);
  }

  return {
    type: 'scatter', mode: 'lines',
    x: x, y: y,
    hoverinfo: 'skip', showlegend: false,
    line: { color: lineColor, width: Math.max(0.3, Number(lineWidth) || 1.0) }
  };
};



/* ═══════════════════════════════════════════════════════════════════
   §4  PERSISTENT PROBE STAMPS
   ═══════════════════════════════════════════════════════════════════ */

LLMAP.getStampKey = function(zoneIdx, field, lonMode, stampMode) {
  return String(zoneIdx) + '||' + String(field || '') + '||' + String(lonMode || 'as-is') + '||' + String(stampMode || 'full');
};

LLMAP.getCurrentStampKey = function() {
  return LLMAP.getStampKey(_llZoneIndex(), _llVal('llmap-field'), _llVal('llmap-lonmode'), _llVal('llmap-stamp-mode') || 'full');
};

LLMAP.getCurrentStamps = function() {
  let key = LLMAP.getCurrentStampKey();
  if (!LLMAP.stamps[key]) LLMAP.stamps[key] = [];
  return LLMAP.stamps[key];
};

LLMAP.syncStampModeToggle = function() {
  let select = document.getElementById('llmap-stamp-mode');
  let wrap = document.getElementById('llmap-stamp-mode-toggle');
  if (!select || !wrap) return;
  let mode = select.value || 'full';
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-stamp-mode]'), function(btn) {
    btn.classList.toggle('on', btn.getAttribute('data-stamp-mode') === mode);
  });
};

LLMAP.makeStampLabel = function(x, y, z, field, stampMode) {
  /*
   * Build the text label shown on-plot above each probe stamp marker.
   *
   * Two label modes are supported, selectable by the user through the
   * stamp-mode toggle in the Lon/Lat viewer control panel:
   *
   *   'value-only'  — bare numeric value only (e.g. "1.23456").
   *                    Useful when the user wants a clean, compact overlay
   *                    that does not clutter the map with repeated field
   *                    names and coordinate readouts, e.g. for publication
   *                    figures or dense multi-stamp comparisons.
   *
   *   'full'        — field name, value, and geographic coordinates on two
   *     (default)     lines (e.g. "Rc=1.23456\nlon=45.00°, lat=30.00°").
   *                    Best for exploratory work where the user needs the
   *                    full spatial context at a glance.
   *
   * In both modes the numeric value is formatted with toPrecision(6) for
   * consistent significant-figure display across many orders of magnitude.
   */
  if (stampMode === 'value-only') return Number(z).toPrecision(6);
  let valueLabel = field + '=' + Number(z).toPrecision(6);
  return valueLabel + '<br>lon=' + Number(x).toFixed(2) + '°, lat=' + Number(y).toFixed(2) + '°';
};

LLMAP.addStamp = function(pt, field) {
  if (!pt) return;
  let stamps = LLMAP.getCurrentStamps();
  let stampMode = _llVal('llmap-stamp-mode') || 'full';
  let x = Number(pt.x), y = Number(pt.y), z = Number(pt.z);
  if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;

  /*
   * Avoid stacking duplicate labels on repeated clicks at the same sampled
   * grid point. The tolerances are intentionally tiny because Plotly click
   * events on structured grids already snap to the nearest plotted cell/node.
   */
  let eps = 1.0e-9;
  let dup = stamps.find(function(s) {
    return Math.abs(s.x - x) < eps && Math.abs(s.y - y) < eps;
  });
  if (dup) return;

  stamps.push({
    x: x,
    y: y,
    z: z,
    field: field,
    zoneIndex: _llZoneIndex(),
    zoneTitle: LLMAP.dataset?.zones?.[_llZoneIndex()]?.title ?? '',
    lonMode: _llVal('llmap-lonmode') || 'as-is',
    stampMode: stampMode,
    label: LLMAP.makeStampLabel(x, y, z, field, stampMode)
  });
};

LLMAP.removeNearestStampAtPixel = function(clientX, clientY) {
  let plotDiv = document.getElementById('llmap-plot');
  if (!plotDiv?._fullLayout) return false;
  let stamps = LLMAP.getCurrentStamps();
  if (!stamps.length) return false;

  let fl = plotDiv._fullLayout;
  let xa = fl.xaxis, ya = fl.yaxis;
  if (!xa || !ya) return false;

  let rect = plotDiv.getBoundingClientRect();
  let px = clientX - rect.left;
  let py = clientY - rect.top;

  /*
   * Find the stamp nearest to the right-click location in screen space.
   * Pixel-space matching is the most intuitive for the user because zooming
   * changes visible map scale while the click target on the screen remains the
   * same. The threshold below can be adjusted later if needed.
   */
  let bestIdx = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < stamps.length; i++) {
    let sx = xa._offset + xa.l2p(stamps[i].x);
    let sy = ya._offset + ya.l2p(stamps[i].y);
    let d2 = (sx - px) * (sx - px) + (sy - py) * (sy - py);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }

  let removeRadiusPx = 18;
  if (bestIdx >= 0 && bestD2 <= removeRadiusPx * removeRadiusPx) {
    stamps.splice(bestIdx, 1);
    return true;
  }
  return false;
};

LLMAP.buildStampTrace = function() {
  let stamps = LLMAP.getCurrentStamps();
  if (!stamps.length) return null;

  /*
   * User-configurable stamp font appearance.
   *
   * The font size and color are read live from their respective UI controls
   * each time the map is re-rendered, so the user can adjust them at any
   * point and all existing + future stamps update immediately on the next
   * render cycle without needing to re-place them.
   *
   *   llmap-stamp-font-size   — <input type="number"> (6–28 px, default 10)
   *     Parsed as an integer; if the element is missing or contains an
   *     unparseable / out-of-range value, we fall back to the original
   *     hardcoded default of 10 px to avoid broken rendering.
   *
   *   llmap-stamp-font-color  — <select> dropdown of preset hex colors
   *     Falls back to near-white (#f8fafc) if the element is absent,
   *     matching the original default so behaviour is unchanged when
   *     the control is not present in the DOM (e.g. older HTML).
   *
   * Both values feed directly into the Plotly scatter-text `textfont`
   * property, which accepts standard CSS color strings and numeric px
   * sizes. The font family remains fixed at IBM Plex Mono for visual
   * consistency with the rest of the AMPS dark-theme dashboard.
   */
  let fontSize = parseInt(_llVal('llmap-stamp-font-size'), 10);
  if (!Number.isFinite(fontSize) || fontSize < 6) fontSize = 10;
  let fontColor = _llVal('llmap-stamp-font-color') || '#f8fafc';

  return {
    type: 'scatter',
    mode: 'markers+text',
    x: stamps.map(function(s) { return s.x; }),
    y: stamps.map(function(s) { return s.y; }),
    text: stamps.map(function(s) { return s.label; }),
    textposition: 'top center',
    textfont: { color: fontColor, size: fontSize, family: 'IBM Plex Mono, monospace' },
    marker: {
      size: 7,
      color: '#ffd04b',
      line: { color: '#111827', width: 1 }
    },
    hoverinfo: 'skip',
    showlegend: false,
    cliponaxis: false
  };
};

LLMAP.bindInteractiveStampEvents = function(plotDiv, field) {
  if (!plotDiv) return;

  /*
   * Remove prior listeners before attaching new ones. The viewer redraws with
   * Plotly.newPlot(), and without explicit cleanup each redraw would stack a
   * fresh copy of the same event handler.
   */
  if (plotDiv._llClickHandler) plotDiv.removeListener('plotly_click', plotDiv._llClickHandler);
  if (plotDiv._llContextHandler) plotDiv.removeEventListener('contextmenu', plotDiv._llContextHandler);

  plotDiv._llClickHandler = function(ev) {
    if (!ev?.points?.length) return;
    let pt = ev.points[0];
    LLMAP.addStamp(pt, field);
    renderLonLatMap();
  };
  plotDiv.on('plotly_click', plotDiv._llClickHandler);

  plotDiv._llContextHandler = function(ev) {
    ev.preventDefault();
    let removed = LLMAP.removeNearestStampAtPixel(ev.clientX, ev.clientY);
    if (removed) renderLonLatMap();
  };
  plotDiv.addEventListener('contextmenu', plotDiv._llContextHandler);
};

/* ═══════════════════════════════════════════════════════════════════
   §4  MAIN RENDER  (Plotly.newPlot)
   ═══════════════════════════════════════════════════════════════════ */

async function renderLonLatMap() {
  const ds = LLMAP.dataset;
  if (!ds?.zones?.length) return;
  if (typeof Plotly === 'undefined') { console.error('Plotly not loaded'); return; }

  /* Read controls */
  let zoneIdx = Math.max(0, Math.min(_llZoneIndex(), ds.zones.length - 1));
  let zone    = ds.zones[zoneIdx];
  let field   = _llVal('llmap-field')   || ds.fieldNames.find(function(f) { return !/^lon|^lat/i.test(f); });
  let cmap    = _llVal('llmap-cmap')    || 'Turbo';
  let lonMode = _llVal('llmap-lonmode') || 'as-is';
  let pStyle  = _llVal('llmap-style')   || 'heatmap';
  let reverse = _llChk('llmap-reverse');
  let smooth  = _llChk('llmap-smooth');
  let showC   = _llChk('llmap-coast');
  let cColor  = _llVal('llmap-coast-color') || '#444444';
  let cWidth  = parseFloat(_llVal('llmap-coast-width')) || 1.0;
  let zminStr = _llVal('llmap-zmin');
  let zmaxStr = _llVal('llmap-zmax');
  let lockSc  = _llChk('llmap-lock-scale');
  if (!field) return;

  /* Build grid */
  let grid  = LLMAP.buildGrid(zone, field, lonMode);
  let fixed = LLMAP.maybeTranspose(grid.lons, grid.lats, grid.z);

  let colorscale = cmap;
  if (reverse) colorscale += '_r';

  let zmin = (zminStr.trim() !== '') ? Number(zminStr) : undefined;
  let zmax = (zmaxStr.trim() !== '') ? Number(zmaxStr) : undefined;
  let isContour = (pStyle === 'contour');

  /* Main trace */
  let trace = {
    type:       isContour ? 'contour' : 'heatmap',
    x:          fixed.x,
    y:          fixed.y,
    z:          fixed.z,
    colorscale: colorscale,
    zmin:       Number.isFinite(zmin) ? zmin : undefined,
    zmax:       Number.isFinite(zmax) ? zmax : undefined,
    colorbar: {
      title: { text: field, side: 'top', font: { color: '#38c0ff', size: 11 } },
      orientation: 'v',
      x: 1.02, xanchor: 'left',
      y: 0.5,  yanchor: 'middle',
      len: 0.9, thickness: 18,
      tickfont: { color: '#8899aa', size: 10, family: 'IBM Plex Mono, monospace' }
    },
    hovertemplate: 'lon=%{x:.1f}°<br>lat=%{y:.1f}°<br>' + field + '=%{z:.6g}<extra></extra>'
  };

  if (!isContour) {
    trace.zsmooth = smooth ? 'best' : false;
  } else {
    trace.contours = {
      coloring: 'heatmap',
      showlines: !smooth,
      start: Number.isFinite(zmin) ? zmin : undefined,
      end:   Number.isFinite(zmax) ? zmax : undefined
    };
    trace.line = { width: smooth ? 0 : 0.8 };
    trace.smoothing = smooth ? 1.0 : 0;
  }

  let traces = [trace];

  /* Coastlines */
  let usePm180 = (lonMode === 'pm180');
  if (showC) {
    let coastData = await LLMAP.getCoastlines();
    for (const coast of coastData) {
      traces.push(LLMAP.makeCoastTrace(coast, usePm180, cColor, cWidth));
    }
  }

  let stampTrace = LLMAP.buildStampTrace();
  if (stampTrace) traces.push(stampTrace);

  let xMin = Math.min.apply(null, fixed.x);
  let xMax = Math.max.apply(null, fixed.x);
  let yMin = Math.min.apply(null, fixed.y);
  let yMax = Math.max.apply(null, fixed.y);

  /* Layout — dark theme matching AMPS dashboard */
  let layout = {
    title: { text: field + ' map — ' + zone.title, font: { color: '#38c0ff', size: 14, family: 'IBM Plex Sans, sans-serif' } },
    margin: { l: 60, r: 80, t: 45, b: 55 },
    paper_bgcolor: '#070e1c',
    plot_bgcolor:  '#0d1a2e',
    font: { color: '#8899aa', family: 'IBM Plex Mono, monospace', size: 10 },
    xaxis: {
      title: { text: 'Longitude (deg)', font: { color: '#b0b8c8', size: 12 } },
      zeroline: false, showgrid: true,
      gridcolor: 'rgba(255,255,255,0.07)',
      range: [xMin, xMax],
      color: '#8899aa',
      tickfont: { size: 10 }
    },
    yaxis: {
      title: { text: 'Latitude (deg)', font: { color: '#b0b8c8', size: 12 } },
      zeroline: false, showgrid: true,
      gridcolor: 'rgba(255,255,255,0.07)',
      range: [yMin, yMax],
      color: '#8899aa',
      tickfont: { size: 10 }
    }
  };

  if (lockSc) {
    layout.yaxis.scaleanchor = 'x';
    layout.yaxis.scaleratio = 1;
    layout.yaxis.constrain = 'range';
    layout.xaxis.constrain = 'range';
  }

  let plotDiv = document.getElementById('llmap-plot');
  if (!plotDiv) return;

  Plotly.newPlot(plotDiv, traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']
  }).then(function() {
    LLMAP.bindInteractiveStampEvents(plotDiv, field);
    let status = document.getElementById('llmap-status');
    if (status && LLMAP.dataset) {
      let nStamps = LLMAP.getCurrentStamps().length;
      let stampModeLabel = ((_llVal('llmap-stamp-mode') || 'full') === 'value-only') ? 'value only' : 'value + coordinates';
      status.textContent = 'Loaded map ready. Left click adds a persistent value stamp; right click near a stamp removes it. Stamp label mode: ' + stampModeLabel + '. Current stamp count: ' + nStamps + '.';
      status.style.color = '#2dd4a0';
    }
  });
}


/* ═══════════════════════════════════════════════════════════════════
   §5  CONTROL HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function _llVal(id) { let e = document.getElementById(id); return e ? e.value : ''; }
function _llChk(id) { let e = document.getElementById(id); return e ? e.checked : false; }
function _llZoneIndex() {
  let e = document.getElementById('llmap-zone');
  let v = e ? parseInt(e.value, 10) : 0;
  return Number.isFinite(v) ? v : 0;
}

LLMAP.updateZoneInfo = function() {
  let ds = LLMAP.dataset;
  let info = document.getElementById('llmap-zone-info');
  if (!info) return;
  if (!ds?.zones?.length) {
    info.textContent = '';
    return;
  }
  let zoneIdx = Math.max(0, Math.min(_llZoneIndex(), ds.zones.length - 1));
  let zone = ds.zones[zoneIdx];
  info.textContent = 'Zone ' + (zoneIdx + 1) + ' of ' + ds.zones.length + ' · ' + zone.title + ' · Grid ' + zone.I + '×' + zone.J;
};


/* ═══════════════════════════════════════════════════════════════════
   §6  INIT + EVENT WIRING
   ═══════════════════════════════════════════════════════════════════ */

function initLonLatViewer() {
  let ids = [
    'llmap-zone','llmap-field','llmap-cmap','llmap-lonmode','llmap-style','llmap-stamp-mode',
    /*
     * Stamp font appearance controls (added alongside stamp-mode).
     *
     * Including these IDs in the change-event wiring array ensures that
     * whenever the user adjusts the stamp font size spinner or picks a
     * new stamp font color from the dropdown, the map is immediately
     * re-rendered with the updated text styling applied to every visible
     * stamp. This gives live-preview feedback without requiring the user
     * to press the explicit "Render" button.
     */
    'llmap-stamp-font-size','llmap-stamp-font-color',
    'llmap-reverse','llmap-smooth','llmap-coast',
    'llmap-coast-color','llmap-coast-width',
    'llmap-zmin','llmap-zmax','llmap-lock-scale'
  ];
  ids.forEach(function(id) {
    let el = document.getElementById(id);
    if (el) el.addEventListener('change', function() { if (LLMAP.dataset) { LLMAP.updateZoneInfo(); renderLonLatMap(); } });
  });

  let stampToggle = document.getElementById('llmap-stamp-mode-toggle');
  let stampSelect = document.getElementById('llmap-stamp-mode');
  if (stampToggle && stampSelect) {
    Array.prototype.forEach.call(stampToggle.querySelectorAll('[data-stamp-mode]'), function(btn) {
      btn.addEventListener('click', function() {
        let mode = btn.getAttribute('data-stamp-mode') || 'full';
        if (stampSelect.value !== mode) {
          stampSelect.value = mode;
          LLMAP.syncStampModeToggle();
          stampSelect.dispatchEvent(new Event('change'));
        }
      });
    });
    LLMAP.syncStampModeToggle();
  }

  let fileInput = document.getElementById('llmap-file');
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      if (e.target.files[0]) loadTecplotFile(e.target.files[0]);
    });
  }

  let dlBtn = document.getElementById('llmap-download-png');
  if (dlBtn) {
    dlBtn.addEventListener('click', function() {
      if (typeof Plotly !== 'undefined') {
        Plotly.downloadImage('llmap-plot', {
          format: 'png', filename: 'amps_lonlat_map',
          width: 1400, height: 800, scale: 2
        });
      }
    });
  }
}

function loadTecplotFile(file) {
  let status = document.getElementById('llmap-status');
  file.text().then(function(text) { loadTecplotText(text, file.name); })
    .catch(function(err) { if (status) { status.textContent = 'Error: ' + err.message; status.style.color = '#ff5a5a'; } });
}

function loadTecplotText(text, name) {
  let status   = document.getElementById('llmap-status');
  let fieldSel = document.getElementById('llmap-field');
  let zoneSel  = document.getElementById('llmap-zone');
  try {
    LLMAP.dataset = LLMAP.parseTecplot(text);
    LLMAP.currentZoneIndex = 0;
    let ds = LLMAP.dataset;

    if (zoneSel) {
      zoneSel.innerHTML = '';
      ds.zones.forEach(function(z, idx) {
        let opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = (idx + 1) + ': ' + z.title;
        zoneSel.appendChild(opt);
      });
      zoneSel.value = '0';
      zoneSel.disabled = (ds.zones.length <= 1);
    }

    if (fieldSel) {
      fieldSel.innerHTML = '';
      ds.fieldNames.filter(function(f) { return !/^lon|^lat/i.test(f); }).forEach(function(f) {
        let opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        fieldSel.appendChild(opt);
      });
    }

    LLMAP.syncStampModeToggle();

    if (status) {
      let firstZone = ds.zones[0];
      status.textContent = 'Loaded: ' + (name || 'file') + ' · ' + ds.zones.length + ' zone(s)' +
        ' · First grid: ' + firstZone.I + '×' + firstZone.J +
        ' · Vars: ' + ds.fieldNames.join(', ');
      status.style.color = '#2dd4a0';
    }

    LLMAP.updateZoneInfo();
    renderLonLatMap();
  } catch (err) {
    if (status) { status.textContent = 'Parse error: ' + err.message; status.style.color = '#ff5a5a'; }
    console.error('[lonlat-viewer]', err);
  }
}
