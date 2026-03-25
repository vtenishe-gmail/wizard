/*
=====================================================================
FILE: js/11-docs.js
INTENT:
  JavaScript logic for the AMPS web wizard (static site). This module
  implements a focused part of the UI: state updates, model selection,
  preview rendering, or navigation.

METHODS / DESIGN:
  - Reads/writes the shared state object `S` (defined in js/01-state.js).
  - Uses direct DOM manipulation (no framework) for portability.
  - Functions are intentionally small and side-effectful: they update `S`
    and then update the DOM so the UI always reflects the current state.

IMPLEMENTATION NOTES:
  - Prefer pure helpers for formatting and mapping, but keep UI updates
    local so it’s clear which elements are affected.
  - Avoid introducing new global names unless necessary; when you do,
    document them here and in-line.
  - Keep behavior consistent between modular (index.html + js/*.js) and
    standalone (AMPS_Interface.html) entrypoints.

LAST UPDATED: 2026-02-21
=====================================================================
*/
/* =============================================================================
   FILE:    js/11-docs.js
   PROJECT: AMPS CCMC Submission Interface
   PURPOSE: "Docs" dropdown menu for PDF documentation.

            This mirrors the look-and-feel and interaction conventions of the
            Help dropdown (js/10-help.js) while doing something simpler:
              - Toggle the main Docs dropdown from the topbar
              - Expand/collapse category sections (Level 1)
              - Open PDF links in a new tab (handled by HTML target=_blank)
              - Close on outside click / ESC
              - Keyboard accessible (Enter / Space)

   DESIGN NOTES:
     * We intentionally reuse the existing CSS classes used by the Help menu
       (help-menu, help-section, help-section-header, etc.) so we don't need new
       styles and the UI stays consistent.

   DEPENDS ON: none (plain DOM APIs)
============================================================================= */
(function(){
  'use strict';

  function $(id){ return document.getElementById(id); }

  function isVisible(el){
    if(!el) return false;
    return el.style.display !== 'none' && el.style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function bindAccessibility(el){
    if(!el) return;
    if(!el.hasAttribute('tabindex')) el.setAttribute('tabindex','0');
    if(!el.hasAttribute('role')) el.setAttribute('role','button');
  }

  function onKeyActivate(e){
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      e.currentTarget.click();
    }
  }

  function setMenuOpen(open){
    let menu  = $('docs-main-menu');
    let arrow = $('docs-arrow');
    if(!menu) return;

    menu.style.display = open ? 'block' : 'none';
    if(arrow){
      arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  function toggleMenu(){
    let menu = $('docs-main-menu');
    if(!menu) return;
    let open = (menu.style.display === 'block');
    setMenuOpen(!open);
  }

  function closeMenu(){
    setMenuOpen(false);
  }

  function toggleSection(targetId){
    // Sections are keyed as:
    //   content: docs-content-<id>
    //   arrow:   docs-arrow-<id>
    let content = $('docs-content-' + targetId);
    let arrow   = $('docs-arrow-' + targetId);
    if(!content) return;

    let open = (content.style.display === 'block');
    content.style.display = open ? 'none' : 'block';
    if(arrow){
      arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
    }
  }

  function initDocsMenu(){
    let trigger = $('docs-trigger');
    let menu    = $('docs-main-menu');
    if(!trigger || !menu) return;

    // Ensure closed by default
    menu.style.display = 'none';

    // Trigger
    bindAccessibility(trigger);
    trigger.addEventListener('click', function(e){
      e.preventDefault();
      toggleMenu();
    }, true);
    trigger.addEventListener('keydown', onKeyActivate, true);

    // Delegated click handling
    document.addEventListener('click', function(e){
      // Section header click
      let hdr = e.target.closest('[data-docs-toggle]');
      if(hdr){
        e.preventDefault();
        e.stopPropagation();
        let tid = hdr.dataset.target;
        toggleSection(tid);
        return;
      }

      // Close if click outside docs dropdown
      let inside = e.target.closest('.docs-dropdown');
      if(!inside && isVisible(menu)){
        closeMenu();
      }
    }, true);

    // Keyboard accessibility for section headers
    let headers = document.querySelectorAll('[data-docs-toggle]');
    headers.forEach(function(h){
      bindAccessibility(h);
      h.addEventListener('keydown', onKeyActivate, true);
    });

    // ESC closes
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && isVisible(menu)) closeMenu();
    }, true);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initDocsMenu);
  }else{
    initDocsMenu();
  }
})();
