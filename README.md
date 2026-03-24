# AMPS v2025 — Runs-on-Request Web Interface

**Adaptive Mesh Particle Simulator — CCMC Submission Interface + Visualization Dashboard**

---

## 1. What This Is

A fully static website (no server, no build step, no bundler) that serves two functions:

1. **Configure** — A 9-step wizard for setting up AMPS geospace particle transport simulations (SEP and GCR). The wizard generates an `AMPS_PARAM.in` configuration file for submission to the CCMC Runs-on-Request system.

2. **Visualize & Analyze** — An interactive dashboard for viewing AMPS simulation outputs: cutoff rigidity maps, spacecraft trajectories with associated data products, and energy spectra. All visualization is browser-based using Plotly.js.

The two modes are toggled via the topbar: **⚙ Configure** and **📊 Results**.

---

## 2. Quick Start

1. Extract the tar archive.
2. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).
3. No installation, no server, no internet required for the wizard. The Results view needs internet on first use to load Plotly.js from CDN and continent outlines from world-atlas CDN; both are cached by the browser after that.

Test data files (inside `js/`):
- `AMPS_PARAM_Sep2017_storm.in` — sample parameter file for loading
- `trajectory_sample.txt` — sample spacecraft trajectory
- `ts05_driving_sample.txt` — sample TS05 driving data

---

## 3. Architecture Overview

```
index.html                    Single-page application (both views)
├── css/
│   ├── 01-tokens.css         Design tokens (colors, fonts, spacing)
│   ├── 02-layout.css         Page layout (topbar, grid, sidebar, wizard strip)
│   ├── 03-components.css     UI components (buttons, inputs, cards, toggles)
│   ├── 04-diagrams.css       SVG/Canvas diagram styles
│   └── 05-dashboard.css      Dashboard + all viewer styles
├── js/
│   ├── 01-state.js           Global state object S + convenience helpers
│   ├── 02-wizard.js          Wizard navigation (data-driven WIZARD_STEPS array)
│   ├── 02a-calcmode.js       Step 1: calculation mode + constraint propagation
│   ├── 03-bgfield.js         Steps 2–3: particle species + background B-field models
│   ├── 04-boundary.js        Step 5: domain boundary (Shue/BOX) + SVG diagrams
│   ├── 05-efield.js          Step 4: electric field models
│   ├── 06-temporal.js        Step 6: field driving data (all OMNIWeb pipelines)
│   ├── 07-spectrum-output.js Steps 7–9: spectrum, output domain, output options
│   ├── 08-review.js          Step 10: review, AMPS_PARAM.in builder, sidebar
│   ├── 09-init.js            Boot sequence (DOMContentLoaded entry point)
│   ├── 10-help.js            Help menu
│   ├── 11-docs.js            Documentation menu
│   ├── 12-load.js            Load/parse existing AMPS_PARAM.in files
│   ├── 13-radcalc.js         Radiation computation engine (cookbook equations)
│   ├── 14-radbridge.js       Bridge: wizard state → results object R
│   ├── 15-charts.js          Canvas 2D chart primitives
│   ├── 16-dashboard.js       Dashboard panel rendering + view toggle
│   ├── 17-output-reader.js   AMPS output file parser
│   ├── 18-lonlat-viewer.js   Lon/Lat map viewer (Plotly + TopoJSON coastlines)
│   ├── 19-trajectory-viewer.js  Spacecraft trajectory viewer
│   └── 20-spectrum-viewer.js Multi-zone energy spectrum viewer
└── doc/                      PDF reference documents
```

### 3.1 Load Order

All scripts load via `<script>` tags in strict order (no ES modules, no bundler):

```
01-state.js           ← S object, $() helper (no dependencies)
02-wizard.js          ← WIZARD_STEPS array, navigation
02a-calcmode.js       ← constraint propagation
03-bgfield.js         ← field model selection
04-boundary.js        ← boundary geometry
05-efield.js          ← electric field
06-temporal.js        ← field driving data + all driver pipelines
07-spectrum-output.js ← spectrum + output domain + bins
08-review.js          ← AMPS_PARAM.in builder + sidebar
09-init.js            ← boot sequence (calls init functions for all modules)
10-help.js            ← help overlay
11-docs.js            ← docs menu
12-load.js            ← file load/parse
13-radcalc.js         ← RAD.* pure computation functions
14-radbridge.js       ← R results object, computePreview()
15-charts.js          ← CHART.* Canvas 2D primitives
16-dashboard.js       ← renderDashboard(), toggleView()
17-output-reader.js   ← output file drop zone + ASCII parser
18-lonlat-viewer.js   ← LLMAP.*, renderLonLatMap()
19-trajectory-viewer.js ← TRAJ.*, renderTrajectory()
20-spectrum-viewer.js   ← SPEC.*, renderSpectrumPlot()
```

### 3.2 External Dependencies

| Dependency | Source | Purpose | Required? |
|---|---|---|---|
| Plotly.js v2.35.2 | `cdn.plot.ly/plotly-2.35.2.min.js` | Lon/lat maps, trajectory plots, spectra (zoom, contour, probe) | Yes, for Results view |
| IBM Plex fonts | `fonts.googleapis.com` | Typography | Gracefully degrades to system fonts |
| world-atlas TopoJSON | `cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json` | Continent outlines on maps | Optional; maps work without coastlines |

The **wizard** (Configure view) works with zero external dependencies — even without internet.

### 3.3 Design Language

"NASA Mission Control" dark theme:
- Backgrounds: `#070e1c` (deep navy), `#0d1a2e` (panel), `#112240` (inset)
- Accent: `#38c0ff` (electric cyan), `#1a88d4` (interactive blue)
- Valid state: `#2dd4a0` (terminal green)
- Warnings: `#ff9a3c` (amber)
- Errors: `#ff5a5a` (red)
- Typography: IBM Plex Sans (UI), IBM Plex Mono (data/code)

All design tokens are in `css/01-tokens.css`. To reskin, edit only that file.

---

## 4. The Wizard (Configure View)

### 4.1 Step Overview

| # | Label | Panel id | Notes |
|---|---|---|---|
| 1 | Calc Mode | `panel-2` | Calculation target + field evaluation method (Gridless / 3-D Grid) |
| 2 | Particle | `panel-3` | Species, charge, mass |
| 3 | Bkg B-Field | `panel-4` | Tsyganenko model + scalar fallback drivers |
| 4 | E-Field | `panel-6` | Corotation + convection model; **skipped in Gridless mode** |
| 5 | Boundary | `panel-5` | Shue 1998 magnetopause or rectangular BOX |
| 6 | Field Driving Data | `panel-7` | Epoch Snapshot or Storm Period fetch pipelines |
| 7 | Spectrum | `panel-8` | SEP/GCR source spectrum |
| 8 | Output Domain | `panel-9` | Points, trajectory, or spherical shells |
| 9 | Review & Submit | `panel-11` | Validation, AMPS_PARAM.in preview, bundle download |

Steps 3 (Bkg B-Field) and 4 (E-Field) are adjacent so both field models are configured together before the boundary and driving data steps.

Step 4 (E-Field) is **skipped during sequential navigation** when `fieldMethod === 'GRIDLESS'` (electric field is physically excluded in that mode). It remains reachable by direct click and shows an explanatory overlay.

Note: panel HTML ids (`panel-2`, `panel-3`, …) are **fixed identifiers** in the markup and do **not** correspond to step numbers. Only the `WIZARD_STEPS` array order in `js/02-wizard.js` determines the step sequence.

### 4.2 Relationship Between Steps 3–4 and Step 6

**Steps 3 and 4** (Bkg B-Field and E-Field) let the user choose which mathematical models to run and expose parameter forms. Those parameter values serve as **fallback constants** — they are used only when no real observational data has been loaded in Step 6.

**Step 6 (Field Driving Data)** is where actual measured geophysical conditions are fetched from OMNIWeb or uploaded from file to replace those constants at run time.

- **Epoch Snapshot** — fetch one OMNIWeb row at the chosen epoch; produces a single-point dataset. Same download pipeline as Storm Period. Used for cutoff rigidity maps and frozen-field configurations.
- **Storm Period** — fetch a time-resolved record across a storm window. The B-field model updates every `FIELD_UPDATE_DT` minutes; particles are injected every `INJECT_DT` minutes.

In Epoch Snapshot mode cadence selectors are hidden, `event-start == event-end == epoch`, and the Scalar source tab is hidden from all driver panels (the real-data pipeline is always used).

**Shared driver infrastructure** — the same code handles both modes:

- **B-field drivers** — collapsible fold per Tsyganenko model (TS05, T96, T01, TA15, TA16RBF), each with: OMNIWeb auto-fetch pipeline simulation, file upload with drag-and-drop, in-memory dataset with merge/append/clear/download, scrollable preview table.
- **E-field drivers** — parallel VS (Volland–Stern) and Weimer 2005 folds with the same capabilities. The active fold tracks Step 4 model selection and is hidden when CONV_E_MODEL = NONE or in Gridless mode.

### 4.3 State Model

All configuration lives in a single global object `S` defined in `js/01-state.js`. Every wizard step reads from and writes to `S`. The sidebar summary, keyword previews, and AMPS_PARAM.in builder all read from `S`.

Key property groups in `S`:
- **Wizard meta:** `step`, `done` (completed steps)
- **Calculation mode:** `calcQuantity` (CUTOFF_RIGIDITY / DENSITY_SPECTRUM / DENSITY_3D), `fieldMethod` (GRIDLESS / GRID_3D)
- **Particle:** `species`, `charge`, `mass`
- **Background field:** `fieldModel` (TS05/T96/T01/TA15/TA16RBF/DIPOLE/BATSRUS/GAMERA) + per-model scalar driver parameters
- **Electric field:** `eFieldCoro`, `eFieldConvModel`, Volland-Stern/Weimer parameters
- **Domain boundary:** `boundaryType` (BOX/SHUE), Shue parameters, box extents
- **Field driving data:** `tempMode`, `eventStart`, `eventEnd`, `fieldDt`, `injectDt`, `tsSource`, `vsEfieldSrc`, `weimerEfieldSrc`
- **Spectrum:** `specType`, power-law/cutoff/LIS parameters
- **Output:** `outputMode` (POINTS/TRAJECTORY/SHELLS), energy bins, format, coordinates
- **Visualization:** `vizShieldingSet`, `vizEgridN`, `vizAutoUpdate`

### 4.4 Wizard Navigation

The `WIZARD_STEPS` array in `js/02-wizard.js` is the single source of truth for step ordering. Each entry specifies a panel ID, a label, and an optional `skipWhen` function. To add, remove, or reorder steps, edit this array — the wizard strip, numbering, progress bar, and Next/Prev navigation all adapt automatically.

### 4.5 AMPS_PARAM.in Generation

`buildReview()` in `js/08-review.js` reads the full `S` object and the in-memory driver datasets and produces a complete, commented AMPS_PARAM.in. Sections emitted:

```
#CALCULATION_MODE   — calc target, field method, grid config
#PARTICLE           — species + kinematics
#FIELD_MODEL        — selected B-field model + scalar drivers
#DOMAIN_BOUNDARY    — Shue or BOX geometry
#ELECTRIC_FIELD     — corotation, convection model, VS/Weimer driver source keywords
#TEMPORAL           — TEMPORAL_MODE, event window, TS_INPUT_MODE
#SPECTRUM           — spectral type + parameters
#OUTPUT_DOMAIN      — output mode + domain geometry
#OUTPUT_OPTIONS     — format, coordinates, energy bins
#NUMERICAL          — integration parameters
```

---

## 5. The Dashboard (Results View)

### 5.1 View Toggle

The topbar has two links: **⚙ Configure** and **📊 Results**. Clicking Results calls `toggleView('results')` (in `js/16-dashboard.js`), which hides the wizard layout and shows `<div id="results-view">`. State `S` and results `R` persist across toggles.

### 5.2 Current Visualization Cards

The Results view contains three full-width visualization cards in a CSS grid.

#### Card 1: Lon/Lat Map Viewer (`js/18-lonlat-viewer.js`)

**Purpose:** Display structured-grid 2D data on a lon/lat projection — primarily cutoff rigidity maps and other shell outputs from AMPS.

**Data format:** Tecplot ASCII with `VARIABLES = "lon_deg" "lat_deg" "Rc_GV" "Emin_MeV"` and `ZONE I=72, J=37, F=POINT`. Single zone.

**Features:**
- Heatmap or contour-fill plot style (Plotly `heatmap` / `contour` trace types)
- 13 colormaps (Turbo, Viridis, Plasma, Inferno, Magma, Cividis, Jet, Hot, Electric, Portland, RdBu, YlGnBu, Bluered) with reversal
- Sharp (cell-by-cell) or smooth (bilinear interpolated) rendering
- Adjustable color min/max with auto range
- High-resolution continent outlines from TopoJSON (world-atlas CDN)
- Configurable coastline color and line width
- Longitude handling: 0–360 or ±180 (auto-sorts data when switching)
- Lock lon/lat aspect ratio
- Interactive zoom, pan, box-select, hover probe with lon/lat/value readout
- PNG download

**Controls:** Left sidebar (230px) with file input, field selector, colormap, plot style, longitude mode, color range, rendering options, coastline options.

**Key functions:**
- `LLMAP.parseTecplot(text)` — parse Tecplot ASCII → `{ fieldNames, I, J, rows }`
- `LLMAP.buildGrid(ds, field, lonMode)` — build `{ lons, lats, z[][] }` from parsed data
- `LLMAP.getCoastlines()` — fetch + decode TopoJSON → array of `{ rawLon, rawLat }` rings (cached)
- `LLMAP.makeCoastTrace(raw, usePm180, color, width)` — build Plotly scatter trace for one coastline ring
- `renderLonLatMap()` — master render: builds traces + layout, calls `Plotly.newPlot()`

#### Card 2: Spacecraft Trajectory Viewer (`js/19-trajectory-viewer.js`)

**Purpose:** Display spacecraft trajectory ground tracks and time-series of associated data products — cutoff rigidity, dose proxies, integral fluxes, etc. — with threshold exceedance highlighting.

**Data format:** Tecplot ASCII with quoted ISO timestamps:
```
VARIABLES = "time_utc" "lon_deg" "lat_deg" "alt_km" "Rc_GV" "Ec_MeV" ...
ZONE T="ISS_2026-02-07_to_2026-03-07", I=50, F=POINT
"2026-02-07T00:00:00Z" -8.755 7.826 422.5 13.97 13060.8 ...
```

**Features — Ground Track Map:**
- Trajectory plotted as colored markers on lon/lat projection
- Color variable selectable from any data column (Rc_GV, alt_km, dose_proxy, etc.)
- Turbo colormap with Plotly colorbar
- Gray connecting line showing trajectory path
- Green diamond START / red square END markers
- TopoJSON continent outlines (reuses `LLMAP.getCoastlines()`)
- 1:1 lon/lat aspect ratio
- Full Plotly zoom/pan/hover

**Features — Time Series:**
- One variable at a time vs sequential time index
- ~8 evenly-spaced UTC time labels on x-axis (formatted as "Feb 10 14:00")
- Linear or log Y-axis scale
- Hover probe showing full ISO timestamp + precise value
- **Threshold exceedance visualization:**
  - Direction selector: "Above" or "Below" threshold
  - Dashed threshold line with labeled annotation
  - Shaded exceedance region using explicit closed-polygon segments (one per contiguous run)
  - Hover on triggering points shows "ABOVE THRESHOLD" or "BELOW THRESHOLD"
- **Time-series styling controls:**
  - Background mode: `Dark`, `Custom`, or `Transparent`
  - Custom background color picker
  - Main line color picker
  - Threshold-fill color picker
  - Fill transparency control (`Fill α`)

##### 5.2.2.a Threshold-shading implementation notes

The time-series viewer uses an explicit geometric approach for threshold shading:

1. Evaluate each pair of adjacent samples against the threshold criterion (`Above` or `Below`).
2. Split the curve into **contiguous threshold-satisfying segments**.
3. Where the curve crosses the threshold between samples, compute the crossing location by **linear interpolation**.
4. For each active segment, build a **closed polygon** that follows the data curve on one side and returns along the threshold line on the other.
5. Render each polygon with Plotly `scatter` + `fill: 'toself'`.

This eliminates false-color artifacts that appear when using a single discontinuous trace with `fill: 'tozerox'` and the data crosses the threshold multiple times.

##### 5.2.2.b Time-series style-control implementation notes

The time-series panel has a dedicated style helper (`TRAJ._tsStyle()`) that translates UI control values into Plotly colors and background settings. Changing the fill color automatically propagates to the filled threshold polygons, the dashed threshold line, the highlighted threshold markers, and the threshold annotation. `Transparent` background mode sets `paper_bgcolor` and `plot_bgcolor` to fully transparent RGBA so exported PNGs preserve transparency.

**Key functions:**
- `TRAJ.parse(text)` — parse Tecplot with quoted timestamps → `{ fieldNames, rows, timeField, title }`
- `TRAJ._buildThresholdSegments()` — split into contiguous active intervals with interpolated crossing points
- `TRAJ._tsStyle()` — collect/normalize background, line, fill, and alpha settings
- `TRAJ._renderMap()` — build and render the ground track Plotly plot
- `TRAJ._renderTimeSeries()` — build and render the time series Plotly plot
- `renderTrajectory()` — master: calls both renderers

#### Card 3: Energy Spectra Viewer (`js/20-spectrum-viewer.js`)

**Purpose:** Display energy spectra from multi-zone Tecplot files where each zone represents one spectrum (e.g., one time step along a trajectory).

**Data format:** Multi-zone Tecplot ASCII:
```
VARIABLES = "energy_MeV" "Jdiff_unshielded" "geomag_transmission" "Jdiff_local" ...
ZONE T="2026-02-07T00:00:00Z", I=64, F=POINT
1.000000 3.427e+00 0.0150 5.142e-02 ...
...
ZONE T="2026-02-07T13:42:51Z", I=64, F=POINT
...
```

**Features:**
- X and Y variable selectable from any column
- Independent linear/log controls for X and Y axes
- **Zone selection modes:** All / Show N zones (evenly spaced) / Every Nth
- Each spectrum in a distinct color (30-color palette, or HSL generation for >30)
- Legend with zone title (timestamps) — auto-hidden for >30 zones
- Hover probe showing zone title, X value, Y value

**Key functions:**
- `SPEC.parse(text)` — parse multi-zone Tecplot → `{ fieldNames, zones[], globalTitle }`
- `SPEC.selectZones(total, mode, param)` — return selected zone indices
- `SPEC.getColor(idx, total)` — distinct color for each spectrum
- `renderSpectrumPlot()` — master render

### 5.3 Computation Engine (`js/13-radcalc.js`, `js/14-radbridge.js`)

`js/13-radcalc.js` (RAD namespace) implements all equations from the "Space Radiation Cookbook":
- Rigidity ↔ energy conversions (Eq. 1)
- Integral fluxes, fluences, hardness index (Eqs. 2–5)
- CSDA degraded spectrum behind parametric Al shielding (Eq. 6)
- Dose proxy, TID proxy, LET spectrum, displacement damage, neutron equivalent (Eqs. 7–11)
- Exceedance durations, spectral fitting, energy moments (Eqs. 12–15)
- Embedded NIST PSTAR stopping-power tables for Al and Si

`js/14-radbridge.js` provides `computePreview()` (from wizard state) and `computeFromTimeSeries()` (from loaded data). `js/15-charts.js` provides Canvas 2D chart primitives. `js/16-dashboard.js` has `renderDashboard()` for Canvas-based panels.

These modules are loaded and functional but the Canvas-based dashboard panels (scoreboard, effects-vs-shielding, LET, time series) have been removed from the current HTML. They can be re-added by restoring the card markup.

---

## 6. Data Formats

### 6.1 Tecplot ASCII — Single Zone (Lon/Lat Maps)

```
VARIABLES = "lon_deg" "lat_deg" "Rc_GV" "Emin_MeV"
ZONE I=72, J=37, F=POINT
0.000000 -90.000000 0.1234 50.0
5.000000 -90.000000 0.1256 51.2
...
```

- `VARIABLES` line: variable names in double quotes, space-separated.
- `ZONE` line: must have `I=` and `J=` for the 2D structured grid dimensions.
- Data: one row per grid point, columns matching VARIABLES order. `I` varies fastest (row-major).
- Comments: lines starting with `#` or `!` are skipped.

### 6.2 Tecplot ASCII — Trajectory (Quoted Timestamps)

```
TITLE = "ISS trajectory test case"
VARIABLES = "time_utc" "lon_deg" "lat_deg" "alt_km" "Rc_GV" ...
ZONE T="ISS_2026-02-07_to_2026-03-07", I=50, F=POINT
"2026-02-07T00:00:00Z" -8.755 7.826 422.5 13.97 ...
```

- First column is an ISO 8601 timestamp in double quotes.
- Remaining columns are numeric, whitespace-separated.
- The parser auto-detects the time column by matching variable names against `/time|utc|date/i`.
- `TITLE` line is optional; displayed in status.
- `ZONE T="..."` title is optional; used for metadata.

### 6.3 Tecplot ASCII — Multi-Zone (Spectra)

```
TITLE = "Energy spectra (50 zones)"
VARIABLES = "energy_MeV" "Jdiff" "geomag_transmission" ...
ZONE T="2026-02-07T00:00:00Z", I=64, F=POINT
1.000 3.427e+00 0.0150 ...
...
ZONE T="2026-02-07T13:42:51Z", I=64, F=POINT
...
```

- Single `VARIABLES` line applies to all zones.
- Multiple `ZONE` blocks, each with its own `T="title"` and `I=N`.
- The zone title (typically an ISO timestamp) becomes the legend label.

---

## 7. How to Add a New Visualization Card

### 7.1 Overview

| Layer | File | What to add |
|---|---|---|
| Logic | `js/NN-yourmodule.js` | Parser, computation, Plotly render function |
| Markup | `index.html` | Card HTML inside `<div class="dash-grid">` |
| Style | `css/05-dashboard.css` | Layout classes for your card's internal structure |
| Init | `js/09-init.js` | One line: `if (typeof initYourViewer === 'function') initYourViewer();` |
| Script | `index.html` | `<script src="js/NN-yourmodule.js"></script>` before `</body>` |

### 7.2 Step-by-Step

**Step 1: Create `js/NN-yourmodule.js`**

```javascript
var YOURNS = {};
YOURNS.dataset = null;

/* §1 PARSER */
YOURNS.parse = function(text) {
  // Return { fieldNames, data, ... }
};

/* §2 RENDER */
function renderYourPlot() {
  var ds = YOURNS.dataset;
  if (!ds || typeof Plotly === 'undefined') return;
  var plotDiv = document.getElementById('your-plot-id');
  if (!plotDiv) return;

  var traces = [{ type: 'scatter', x: [...], y: [...] }];
  var layout = {
    paper_bgcolor: '#070e1c',
    plot_bgcolor: '#0d1a2e',
    font: { color: '#8899aa', family: 'IBM Plex Mono, monospace', size: 10 },
    xaxis: { zeroline: false, showgrid: true, gridcolor: 'rgba(255,255,255,0.06)', color: '#8899aa' },
    yaxis: { zeroline: false, showgrid: true, gridcolor: 'rgba(255,255,255,0.06)', color: '#8899aa' },
    margin: { l: 60, r: 20, t: 40, b: 50 }
  };
  Plotly.newPlot(plotDiv, traces, layout, { responsive: true, displaylogo: false });
}

/* §3 INIT */
function initYourViewer() {
  var fi = document.getElementById('your-file-input');
  if (fi) fi.addEventListener('change', function(e) {
    if (e.target.files[0]) e.target.files[0].text().then(function(text) {
      YOURNS.dataset = YOURNS.parse(text);
      renderYourPlot();
    });
  });
}
```

**Step 2: Add HTML card to `index.html`**

Inside `<div class="dash-grid">`:

```html
<div class="dash-card dash-card-full" id="dash-your-card">
  <div class="dash-card-title">
    <div class="dash-icon" style="background:rgba(R,G,B,0.12)">EMOJI</div>
    Your Card Title
  </div>

  <div class="traj-top-row">
    <div class="llmap-ctrl" style="min-width:240px;">
      <label for="your-file-input">Data file</label>
      <input id="your-file-input" type="file" accept=".dat,.txt,.csv" />
    </div>
    <div class="traj-status-wrap">
      <div class="llmap-status" id="your-status">Load a file.</div>
    </div>
  </div>

  <div class="traj-section">
    <div class="traj-section-hd">
      <span class="traj-section-label">Plot Title</span>
      <div class="traj-inline-ctrls">
        <label for="your-ctrl-1" style="font-size:10px;color:var(--text-dim);">Variable</label>
        <select id="your-ctrl-1" class="traj-sel"><option>Load file</option></select>
      </div>
    </div>
    <div class="traj-plot-wrap" style="height:480px;">
      <div id="your-plot-id" style="width:100%;height:480px;"></div>
    </div>
  </div>
</div>
```

**Step 3: Add `<script>` tag** before `</body>`:
```html
<script src="js/NN-yourmodule.js"></script>
```

**Step 4: Add init hook** in `js/09-init.js` inside `init()`:
```javascript
if (typeof initYourViewer === 'function') initYourViewer();
```

**Step 5: Verify**
```bash
node --check js/NN-yourmodule.js
grep -c 'your-plot-id' index.html
grep -c 'your-plot-id' js/NN-yourmodule.js
```

### 7.3 Reusable CSS Classes

| Class | Purpose |
|---|---|
| `.dash-card` | Standard card container (background, border, padding, radius) |
| `.dash-card-full` | Card spans full width (both grid columns) |
| `.dash-card-title` | Card header with icon + title text |
| `.traj-top-row` | Horizontal flex row for file input + status |
| `.traj-section` | Bordered subsection within a card |
| `.traj-section-hd` | Section header with label + inline controls |
| `.traj-section-label` | Uppercase label text for section header |
| `.traj-inline-ctrls` | Flex row of inline controls (selects, inputs, buttons) |
| `.traj-sel` | Styled `<select>` for inline use |
| `.traj-input` | Styled `<input>` for inline use |
| `.traj-plot-wrap` | Container for Plotly div (dark background, rounded corners) |
| `.llmap-ctrl` | Stacked label + input group |
| `.llmap-status` | Status text line (for file load feedback) |
| `.llmap-layout` | Two-column grid: controls sidebar (230px) + plot area |
| `.llmap-controls` | Vertical stack of controls for sidebar layout |
| `.llmap-check` | Checkbox label with inline flex alignment |

### 7.4 Reusable JS APIs from Existing Modules

**Coastlines** (from `js/18-lonlat-viewer.js`):
```javascript
var coastData = await LLMAP.getCoastlines();   // fetches + caches TopoJSON
var usePm180 = true;                            // or false for 0–360
for (var c = 0; c < coastData.length; c++) {
  traces.push(LLMAP.makeCoastTrace(coastData[c], usePm180, '#555555', 0.7));
}
```

**Radiation computation** (from `js/13-radcalc.js`):
```javascript
RAD.rigidity(Ek)                      // MeV → GV
RAD.cutoffEnergy(Rc)                  // GV → MeV
RAD.integralFlux(j, Egrid, E0)        // J(>E0) from spectrum
RAD.hardness(j, Egrid)                // H_{100/10}
RAD.csdaDegraded(j, Egrid, T)         // CSDA transport behind T g/cm²
RAD.doseProxy(jShielded, Egrid)       // dose rate in Si
RAD.ddd(jShielded, Egrid)             // displacement damage dose
RAD.neutronEquiv(dddVal)              // 1-MeV n_eq
RAD.sScale(J10)                       // NOAA S-scale evaluation
```

### 7.5 Plotly vs Canvas Decision

**Use Plotly** (already loaded) when you need: zoom/pan, contour lines, hover probes, 2D grids, high-quality PNG export. This is the recommended default for new cards.

**Use Canvas 2D** (`js/15-charts.js`) when you need: maximum performance for real-time updates, zero-dependency mode, or custom rendering that Plotly can't handle.

---

## 8. Namespace Conventions

| Namespace | Module | Purpose |
|---|---|---|
| `S` | `01-state.js` | Wizard configuration state |
| `R` | `14-radbridge.js` | Computation results |
| `RAD` | `13-radcalc.js` | Radiation physics functions |
| `CHART` | `15-charts.js` | Canvas chart primitives |
| `LLMAP` | `18-lonlat-viewer.js` | Lon/lat map viewer |
| `TRAJ` | `19-trajectory-viewer.js` | Trajectory viewer |
| `SPEC` | `20-spectrum-viewer.js` | Spectrum viewer |

Only public API functions (`initXxx`, `loadXxx`, `renderXxx`) are bare globals.

---

## 9. File-by-File Reference

| File | Lines | Role |
|---|---|---|
| `index.html` | 5 399 | Single-page application: wizard markup + dashboard markup |
| `css/01-tokens.css` | 199 | Design tokens (all colors, fonts, z-indices) |
| `css/02-layout.css` | 205 | Page layout (topbar, wizard strip, two-column grid) |
| `css/03-components.css` | 514 | UI components (buttons, inputs, cards, toggles, badges) |
| `css/04-diagrams.css` | 231 | SVG/Canvas diagram styles |
| `css/05-dashboard.css` | 564 | Dashboard + all viewer card styles |
| `js/01-state.js` | 463 | Global state `S`, `$()`, `set()`, SVG constants |
| `js/02-wizard.js` | 378 | `WIZARD_STEPS`, `goStep()`, `buildWizardStrip()` |
| `js/02a-calcmode.js` | 887 | Calculation mode selection + constraint propagation |
| `js/03-bgfield.js` | 1 750 | Background B-field model selection + driver forms |
| `js/04-boundary.js` | 556 | Domain boundary (Shue/BOX) + SVG cross-section diagrams |
| `js/05-efield.js` | 511 | Electric field models (Volland-Stern, Weimer 2005) |
| `js/06-temporal.js` | 3 702 | Field driving data — all OMNIWeb pipelines, in-memory datasets, upload handlers |
| `js/07-spectrum-output.js` | 828 | Source spectrum + output domain + energy bins |
| `js/08-review.js` | 910 | AMPS_PARAM.in builder, validation checks, sidebar summary |
| `js/09-init.js` | 175 | Boot sequence (all init calls) |
| `js/10-help.js` | 165 | Help overlay |
| `js/11-docs.js` | 159 | Documentation menu |
| `js/12-load.js` | 678 | Load/parse existing AMPS_PARAM.in files |
| `js/13-radcalc.js` | 771 | Pure radiation computation engine (cookbook equations + NIST tables) |
| `js/14-radbridge.js` | 364 | Bridge: `S` → `R`, `computePreview()`, export functions |
| `js/15-charts.js` | 497 | Canvas 2D: `logLogPlot`, `linePlot`, `gantt` |
| `js/16-dashboard.js` | 520 | Dashboard render + `toggleView()` |
| `js/17-output-reader.js` | 252 | AMPS output file ASCII parser |
| `js/18-lonlat-viewer.js` | 800 | Lon/lat map viewer (Plotly + TopoJSON) |
| `js/19-trajectory-viewer.js` | 815 | Trajectory ground track + time series viewer |
| `js/20-spectrum-viewer.js` | 368 | Multi-zone energy spectrum viewer |
| **Total** | **~27 700** | |

---

## 10. References

- **AMPS:** Adaptive Mesh Particle Simulator, NASA/CCMC
- **TS05 / T96 / T01 / TA15 / TA16RBF:** Tsyganenko empirical magnetospheric field models
- **Volland–Stern / Weimer 2005:** Magnetospheric convection electric field models
- **Qin-Denton database:** Pre-computed Tsyganenko storm driver indices — RBSP-ECT / Dartmouth
- **OMNIWeb:** NASA/GSFC solar wind and IMF data, omniweb.gsfc.nasa.gov
- **NIST PSTAR:** Proton stopping-power tables (embedded in `13-radcalc.js`)
- **Plotly.js:** MIT-licensed interactive charting, https://plotly.com/javascript/
- **world-atlas:** TopoJSON country boundaries, https://github.com/topojson/world-atlas
- **CCMC Runs-on-Request:** https://ccmc.gsfc.nasa.gov/requests/index.php
