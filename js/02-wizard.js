/*
=====================================================================
FILE: js/02-wizard.js
PURPOSE:
  Data-driven wizard navigation for the AMPS CCMC Submission Interface.

  The wizard step bar, panel visibility, Next/Prev navigation, and
  progress tracking are ALL driven by a single configuration array
  called WIZARD_STEPS (defined below).  To add, remove, or reorder
  steps you only need to edit that array — the rest of the code
  adapts automatically.  See README.md § "Adding / Removing Wizard
  Steps" for a complete walkthrough.

ARCHITECTURE:
  ┌─────────────────────────────────────────────────────────────┐
  │  WIZARD_STEPS  (config array — edit this to change steps)   │
  │  ┌─────────┬───────────┬───────────────┬──────────────────┐ │
  │  │  panel   │  label    │  skipWhen     │  isReview        │ │
  │  │ 'panel-1'│'Run Info' │  (optional)   │  false (default) │ │
  │  │ 'panel-6'│'E-Field'  │  fn → bool    │  false           │ │
  │  │ 'panel-11│'Review'   │  —            │  true            │ │
  │  └─────────┴───────────┴───────────────┴──────────────────┘ │
  │                          │                                   │
  │              buildWizardStrip() reads array,                 │
  │              generates <div class="wz-step"> elements        │
  │                          │                                   │
  │              goStep(n) uses array index (1-based)            │
  │              to show/hide panels and update strip             │
  └─────────────────────────────────────────────────────────────┘

  Step numbers shown in the UI are 1-based indices into WIZARD_STEPS.
  Panel HTML elements keep their original ids (panel-1 … panel-11),
  so existing CSS and JS that reference those ids still work.

PUBLIC API (called from HTML onclick / keyboard handlers):
  buildWizardStrip() — generate wizard step bar from WIZARD_STEPS
  goStep(n)          — navigate to wizard step n (1-based index)
  nextStep()         — advance one step (skips conditional steps)
  prevStep()         — go back one step (skips conditional steps)
  goToReview()       — jump to the review/submit step
  wizClick(n)        — step bar click handler (delegates to goStep)
  toggleSection(id)  — collapse/expand an accordion section card
  stepCount()        — total number of steps in WIZARD_STEPS
  completableSteps() — number of non-review steps (for progress bar)

DEPENDS ON: 01-state.js (S, $, updateSidebar, buildReview)
LAST UPDATED: 2026-03-03
=====================================================================
*/


/* ═══════════════════════════════════════════════════════════════════
   WIZARD_STEPS — the single source of truth for wizard navigation.
   ═══════════════════════════════════════════════════════════════════

   Each entry is an object with these fields:

     panel    (string, required)
              The id of the HTML <div class="step-panel"> that this
              step controls.  Example: 'panel-1', 'panel-9'.
              The panel div must already exist in index.html.

     label    (string, required)
              The text shown in the wizard step bar.  Keep it short
              (1–2 words) so it fits the horizontal strip.

     skipWhen (function → boolean, optional)
              If present, this function is called by nextStep() and
              prevStep().  When it returns true the step is silently
              skipped during sequential navigation (Next / Prev
              buttons).  The step is still reachable by clicking its
              label in the strip (wizClick).

              Example: The E-Field step is physically meaningless
              in gridless mode, so its skipWhen returns true when
              S.fieldMethod === 'GRIDLESS'.

     isReview (boolean, optional, default false)
              Marks this step as the terminal "Review & Submit" step.
              When navigating to a review step, goStep() calls
              buildReview() to regenerate the AMPS_PARAM.in preview.
              The review step is excluded from the progress bar
              denominator (it's the destination, not a completable
              task).  There should be exactly one review step, and
              it should be the LAST entry in the array.

   ─────────────────────────────────────────────────────────────────
   HOW TO ADD A NEW STEP:
     1. Create its <div id="panel-XX" class="step-panel"> in
        index.html (anywhere inside <div class="main-col">).
     2. Add an entry to WIZARD_STEPS at the desired position.
     3. That's it — the strip, numbering, navigation, and progress
        bar all update automatically.
   See README.md for the full checklist.
   ───────────────────────────────────────────────────────────────── */
const WIZARD_STEPS = [

  /* 1 */ { panel: 'panel-2',  label: 'Calc Mode' },
  /* 2 */ { panel: 'panel-3',  label: 'Particle' },
  /* 3 */ { panel: 'panel-4',  label: 'Bkg B-Field' },

  /* 5 — E-Field: skipped in sequential navigation when gridless,
         because the electric field is physically excluded from the
         simulation.  Still reachable by direct click on the strip
         (shows a "gridless overlay" explaining why). */
  { panel: 'panel-6',  label: 'E-Field',
    skipWhen: () => S.fieldMethod === 'GRIDLESS' },

  /* 5 */ { panel: 'panel-5',  label: 'Boundary' },

  /* 6 */ { panel: 'panel-7',  label: 'Field Driving Data' },
  /* 7 */ { panel: 'panel-8',  label: 'Spectrum' },
  /* 8 */ { panel: 'panel-9',  label: 'Output Domain' },

  /* Review & Submit — terminal step.  Triggers buildReview()
     to regenerate the AMPS_PARAM.in preview.  Excluded from the
     progress bar denominator. */
  { panel: 'panel-11', label: 'Review & Submit', isReview: true },
];


/* ═══════════════════════════════════════════════════════════════════
   HELPER FUNCTIONS — derived from WIZARD_STEPS
   ═══════════════════════════════════════════════════════════════════ */

/**
 * stepCount — total number of wizard steps.
 * The UI shows step numbers 1 … stepCount().
 */
function stepCount() { return WIZARD_STEPS.length; }

/**
 * completableSteps — number of steps that count toward progress.
 * Excludes review steps (isReview: true) because the review step
 * is the destination, not a completable task.  The progress bar
 * uses this as its denominator.
 */
function completableSteps() {
  return WIZARD_STEPS.filter(s => !s.isReview).length;
}

/**
 * panelIdForStep — return the HTML panel id for step n (1-based).
 * Example: panelIdForStep(1) → 'panel-1'
 */
function panelIdForStep(n) {
  const entry = WIZARD_STEPS[n - 1];
  return entry ? entry.panel : null;
}

/**
 * isReviewStep — true if step n is the review/submit step.
 */
function isReviewStep(n) {
  const entry = WIZARD_STEPS[n - 1];
  return entry ? !!entry.isReview : false;
}

/**
 * shouldSkipStep — true if step n should be skipped in sequential
 * navigation (Next/Prev buttons).  Always false for steps without
 * a skipWhen function.
 */
function shouldSkipStep(n) {
  const entry = WIZARD_STEPS[n - 1];
  return entry && typeof entry.skipWhen === 'function' && entry.skipWhen();
}


/* ═══════════════════════════════════════════════════════════════════
   buildWizardStrip — generate the step bar HTML from WIZARD_STEPS.
   ═══════════════════════════════════════════════════════════════════

   Called once during initialisation (from js/09-init.js).

   For each entry in WIZARD_STEPS, creates a clickable step element:
     <div class="wz-step" role="button" tabindex="0"
          onclick="wizClick(N)" onkeydown="…">
       <div class="wz-num">N</div>
       <span class="wz-label">Label</span>
     </div>

   The first step gets the 'active' class.  Step numbers in the UI
   are sequential 1, 2, 3 … regardless of the underlying panel ids.
   ═══════════════════════════════════════════════════════════════════ */
function buildWizardStrip() {
  const container = $('wizard-strip');
  if (!container) return;

  /* Clear any previous content (idempotent — safe to call twice) */
  container.innerHTML = '';

  WIZARD_STEPS.forEach((entry, idx) => {
    /* idx is 0-based; step numbers shown to the user are 1-based */
    const n = idx + 1;

    /* Create the step element */
    const div = document.createElement('div');
    div.className = 'wz-step' + (n === 1 ? ' active' : '');
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');

    /* Click handler: navigate to this step */
    div.onclick = () => wizClick(n);

    /* Keyboard handler: Enter or Space triggers the same action */
    div.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        wizClick(n);
      }
    };

    /* Step number circle + label text */
    div.innerHTML =
      '<div class="wz-num">' + n + '</div>' +
      '<span class="wz-label">' + entry.label + '</span>';

    container.appendChild(div);
  });
}


/* ═══════════════════════════════════════════════════════════════════
   goStep — navigate the wizard to step n (1-based).
   ═══════════════════════════════════════════════════════════════════

   What it does:
     1. Marks the current step as "done" (completed).
     2. Updates S.step to n.
     3. Shows the HTML panel for step n; hides all others.
        (Iterates ALL step-panels in the DOM, not just those in
        WIZARD_STEPS, so any unlisted panels stay hidden.)
     4. Updates the step-indicator strip (done / active styling).
     5. Manages Prev / Next / Submit button visibility.
     6. Scrolls to top and refreshes the sidebar.
     7. If n is the review step, calls buildReview().

   @param {number} n — target step (1 … stepCount())
   ═══════════════════════════════════════════════════════════════════ */
function goStep(n) {
  const N = stepCount();

  /* Guard: ignore out-of-range step numbers */
  if (n < 1 || n > N) return;

  /* ── 1. Mark current step as completed before leaving ── */
  S.done.add(S.step);
  S.step = n;

  /* ── 2. Show/hide ALL step-panel elements in the DOM ──
   *  We iterate every panel in the page, not just those listed
   *  in WIZARD_STEPS.  This ensures unlisted panels stay hidden.  The active panel
   *  is determined by looking up the panel id from WIZARD_STEPS. */
  const activePanelId = panelIdForStep(n);
  document.querySelectorAll('.step-panel').forEach(el => {
    el.classList.toggle('active', el.id === activePanelId);
  });

  /* ── 3. Update wizard step-indicator strip ──
   *  Each .wz-step element in the strip corresponds to one entry
   *  in WIZARD_STEPS (same order, same count).  We set 'done' for
   *  completed steps and 'active' for the current step. */
  const stepEls = document.querySelectorAll('#wizard-strip .wz-step');
  stepEls.forEach((el, idx) => {
    const stepNum = idx + 1;
    el.classList.remove('done', 'active');
    if (S.done.has(stepNum))  el.classList.add('done');
    else if (stepNum === n)   el.classList.add('active');
  });

  /* ── 4. Action bar buttons ──
   *  - Prev is disabled on the first step.
   *  - Next is hidden on the last step (review).
   *  - Submit is shown only on the review step. */
  const btnPrev   = $('btn-prev');
  const btnNext   = $('btn-next');
  const btnSubmit = $('btn-submit');
  if (btnPrev)   btnPrev.disabled          = (n === 1);
  if (btnNext)   btnNext.style.display     = (n < N) ? 'inline-flex' : 'none';
  if (btnSubmit) btnSubmit.style.display   = isReviewStep(n) ? 'inline-flex' : 'none';

  /* ── 5. Side effects ── */
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateSidebar();

  /* If this is the review step, regenerate the AMPS_PARAM.in preview */
  if (isReviewStep(n) && typeof buildReview === 'function') {
    buildReview();
  }
}


/* ═══════════════════════════════════════════════════════════════════
   nextStep / prevStep — sequential navigation with skip logic.
   ═══════════════════════════════════════════════════════════════════

   These are called by the "Next Step →" and "← Previous" buttons.
   They advance/retreat by one step, but automatically skip any step
   whose skipWhen function returns true.

   Example: In gridless mode, step 4 (E-Field) has
     skipWhen: () => S.fieldMethod === 'GRIDLESS'
   so pressing Next from step 5 (Boundary) jumps directly to step 6.

   Safety: the while loop is bounded by stepCount() to prevent
   infinite loops if ALL steps have skipWhen returning true (which
   should never happen, but defensive coding is good).
   ═══════════════════════════════════════════════════════════════════ */

/** Advance one wizard step, skipping conditional steps. */
function nextStep() {
  const N = stepCount();
  let next = S.step + 1;

  /* Skip steps whose skipWhen returns true */
  while (next <= N && shouldSkipStep(next)) next++;

  /* Navigate if still in range */
  if (next <= N) goStep(next);
}

/** Go back one wizard step, skipping conditional steps. */
function prevStep() {
  let prev = S.step - 1;

  /* Skip steps whose skipWhen returns true */
  while (prev >= 1 && shouldSkipStep(prev)) prev--;

  /* Navigate if still in range */
  if (prev >= 1) goStep(prev);
}


/* ═══════════════════════════════════════════════════════════════════
   goToReview — jump directly to the review/submit step.
   ═══════════════════════════════════════════════════════════════════
   Finds the last step marked isReview and navigates to it.
   Called by the "Review & Submit" button in the action bar.
   ═══════════════════════════════════════════════════════════════════ */
function goToReview() {
  /* Find the review step (search from end — it's usually last) */
  for (let i = WIZARD_STEPS.length - 1; i >= 0; i--) {
    if (WIZARD_STEPS[i].isReview) {
      goStep(i + 1);    /* +1 because goStep uses 1-based index */
      return;
    }
  }
  /* Fallback: go to the last step */
  goStep(stepCount());
}


/* ═══════════════════════════════════════════════════════════════════
   wizClick — step bar click handler.
   ═══════════════════════════════════════════════════════════════════
   Called when the user clicks a step label in the wizard strip.
   Allows random access to any step (no gating).

   @param {number} n — step number (1-based index into WIZARD_STEPS)
   ═══════════════════════════════════════════════════════════════════ */
function wizClick(n) {
  goStep(n);
}


/* ═══════════════════════════════════════════════════════════════════
   toggleSection — collapse/expand a .sect accordion card.
   ═══════════════════════════════════════════════════════════════════
   Toggling the 'closed' CSS class hides .sect-body and rotates
   the .chevron icon via CSS transform.

   @param {string} id — element ID of the .sect container
   ═══════════════════════════════════════════════════════════════════ */
function toggleSection(id) {
  const el = $(id);
  if (el) el.classList.toggle('closed');
}
