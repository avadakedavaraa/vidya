/**
 * VidyaSetu — Shared Dark Mode Toggle
 * Light mode is default. Toggle persists in localStorage.
 * Respects prefers-color-scheme on first visit.
 */
(function () {
  const KEY = 'vs-theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  function getSaved() {
    return localStorage.getItem(KEY);
  }

  function getSystem() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    const btn = document.getElementById('vs-theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', theme === DARK ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', theme === DARK ? 'Switch to light mode' : 'Switch to dark mode');
      const sun = btn.querySelector('.vs-icon-sun');
      const moon = btn.querySelector('.vs-icon-moon');
      if (sun) sun.style.display = theme === DARK ? 'block' : 'none';
      if (moon) moon.style.display = theme === DARK ? 'none' : 'block';
    }
  }

  // Apply immediately (before paint) to avoid flash
  const initial = getSaved() || LIGHT;
  if (initial === DARK) {
    document.documentElement.setAttribute('data-theme', DARK);
  }

  function injectToggle() {
    if (document.getElementById('vs-theme-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'vs-theme-toggle';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.setAttribute('title', 'Toggle dark mode');
    btn.innerHTML = `
      <svg class="vs-icon-moon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="vs-icon-sun" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    `;

    btn.addEventListener('click', function () {
      const current = document.documentElement.getAttribute('data-theme') || LIGHT;
      applyTheme(current === DARK ? LIGHT : DARK);
    });

    document.body.appendChild(btn);

    // Apply correct icon state
    const current = document.documentElement.getAttribute('data-theme') || LIGHT;
    applyTheme(current);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const saved = getSaved() || LIGHT;
    applyTheme(saved);
    injectToggle();
  });

  // Expose globally for pages that have their own toggles
  window.VSTheme = {
    toggle: function () {
      const current = document.documentElement.getAttribute('data-theme') || LIGHT;
      applyTheme(current === DARK ? LIGHT : DARK);
    },
    set: applyTheme,
    get: function () {
      return document.documentElement.getAttribute('data-theme') || LIGHT;
    }
  };
})();
