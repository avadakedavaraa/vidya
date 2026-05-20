(() => {
  const STORAGE_KEY = "vs-theme";
  const THEMES = {
    dark: "dark",
    light: "light",
  };

  function getSavedTheme() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function getCurrentTheme() {
    return document.documentElement.getAttribute("data-theme") || THEMES.light;
  }

  function syncToggleButton(theme) {
    const button = document.getElementById("vs-theme-toggle");

    if (!button) {
      return;
    }

    const label =
      theme === THEMES.dark ? "Switch to light mode" : "Switch to dark mode";

    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);

    const sunIcon = button.querySelector(".vs-icon-sun");
    const moonIcon = button.querySelector(".vs-icon-moon");

    if (sunIcon) {
      sunIcon.style.display = theme === THEMES.dark ? "block" : "none";
    }

    if (moonIcon) {
      moonIcon.style.display = theme === THEMES.dark ? "none" : "block";
    }
  }

  function applyTheme(theme, options = {}) {
    const { persist = true } = options;

    document.documentElement.setAttribute("data-theme", theme);

    if (persist) {
      localStorage.setItem(STORAGE_KEY, theme);
    }

    syncToggleButton(theme);
  }

  function toggleTheme() {
    const nextTheme =
      getCurrentTheme() === THEMES.dark ? THEMES.light : THEMES.dark;

    applyTheme(nextTheme);
  }

  function injectToggleButton() {
    if (document.getElementById("vs-theme-toggle")) {
      return;
    }

    const button = document.createElement("button");
    button.id = "vs-theme-toggle";
    button.setAttribute("aria-label", "Toggle dark mode");
    button.setAttribute("title", "Toggle dark mode");
    button.innerHTML = `
      <svg class="vs-icon-moon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="vs-icon-sun" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    `;

    button.addEventListener("click", toggleTheme);
    document.body.appendChild(button);
    syncToggleButton(getCurrentTheme());
  }

  function getSidebarParts() {
    return {
      overlay:
        document.getElementById("overlay") ||
        document.getElementById("sidebarOverlay"),
      sidebar: document.getElementById("sidebar"),
    };
  }

  function setSidebarState(isOpen) {
    const { sidebar, overlay } = getSidebarParts();

    if (!sidebar) {
      return;
    }

    sidebar.classList.toggle("open", isOpen);
    sidebar.classList.toggle("active", isOpen);

    if (overlay) {
      overlay.classList.toggle("open", isOpen);
      overlay.classList.toggle("active", isOpen);
    }

    if (window.innerWidth <= 900) {
      document.body.style.overflow = isOpen ? "hidden" : "";
    } else if (!isOpen) {
      document.body.style.overflow = "";
    }
  }

  function openSidebar() {
    setSidebarState(true);
  }

  function closeSidebar() {
    setSidebarState(false);
  }

  function toggleSidebar() {
    const { sidebar } = getSidebarParts();

    if (!sidebar) {
      return;
    }

    const isOpen =
      sidebar.classList.contains("open") ||
      sidebar.classList.contains("active");

    setSidebarState(!isOpen);
  }

  function closeSidebarOnDesktop() {
    if (window.innerWidth > 900) {
      closeSidebar();
    }
  }

  const savedTheme = getSavedTheme();

  if (savedTheme === THEMES.dark) {
    applyTheme(THEMES.dark, { persist: false });
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(getSavedTheme() || THEMES.light);
    injectToggleButton();
  });

  window.addEventListener("resize", closeSidebarOnDesktop);

  window.VSTheme = {
    get() {
      return getCurrentTheme();
    },
    set(theme) {
      applyTheme(theme);
    },
    toggle: toggleTheme,
  };

  window.closeSidebar = closeSidebar;
  window.openSidebar = openSidebar;
  window.toggleSidebar = toggleSidebar;
  window.toggleTheme = toggleTheme;
})();
