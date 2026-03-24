/*
=====================================================================
FILE: js/10-help.js
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
   FILE:    js/10-help.js
   PROJECT: AMPS CCMC Submission Interface
   PURPOSE: Rebuilt Help dropdown menu (CSP-safe, no inline handlers).
            - Toggle main Help dropdown from the topbar
            - Expand/collapse Level-1 sections and Level-2 subsections
            - Close on outside click / ESC
            - Keyboard accessible (Enter / Space)
   DEPENDS ON: none (uses plain DOM APIs)
============================================================================= */
(function(){
  'use strict';

  function $(id){ return document.getElementById(id); }

  function isVisible(el){
    if(!el) return false;
    return el.style.display !== 'none' && el.style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function setArrowOpen(arrowEl, open){
    if(!arrowEl) return;
    arrowEl.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
  }

  function setMenuOpen(open){
    const menu = $('help-main-menu') || $('help-menu');
    const arrow = $('help-arrow');
    if(!menu) return;

    menu.style.display = open ? 'block' : 'none';
    if(arrow){
      arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  function toggleMenu(){
    const menu = $('help-main-menu') || $('help-menu');
    if(!menu) return;
    const open = (menu.style.display === 'block');
    setMenuOpen(!open);
  }

  function closeMenu(){
    setMenuOpen(false);
  }

  function togglePanel(kind, targetId){
    // kind: "section" -> content-<id>, arrow-<id>
    // kind: "subsection" -> content-<id>, arrow-<id>
    const content = $('content-' + targetId);
    const arrow   = $('arrow-' + targetId);
    if(!content) return;

    const open = (content.style.display === 'block');
    content.style.display = open ? 'none' : 'block';
    setArrowOpen(arrow, !open);
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

  function initHelpMenu(){
    const trigger = $('help-trigger') || document.querySelector('.help-trigger');
    const menu = $('help-main-menu') || $('help-menu');
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

    // Delegated handler for section/subsection headers
    document.addEventListener('click', function(e){
      const hdr = e.target.closest('[data-help-toggle]');
      if(hdr){
        e.preventDefault();
        e.stopPropagation();
        const kind = hdr.getAttribute('data-help-toggle');
        const tid  = hdr.getAttribute('data-target');
        togglePanel(kind, tid);
        return;
      }

      // Prevent # navigation inside menu links
      if(e.target.closest('.help-menu a[href="#"]')){
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Close if click outside help dropdown
      const inside = e.target.closest('.help-dropdown');
      if(!inside && isVisible(menu)){
        closeMenu();
      }
    }, true);

    // Keyboard accessibility for headers
    const headers = document.querySelectorAll('[data-help-toggle]');
    headers.forEach(function(h){
      bindAccessibility(h);
      h.addEventListener('keydown', onKeyActivate, true);
    });

    // ESC closes
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && isVisible(menu)){
        closeMenu();
      }
    }, true);

    // When resizing, keep it sane (optional)
    window.addEventListener('resize', function(){
      // do nothing; just ensure menu stays within viewport via CSS max-height
    }, {passive:true});
  }

  // Initialize after DOM is ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initHelpMenu);
  }else{
    initHelpMenu();
  }
})();