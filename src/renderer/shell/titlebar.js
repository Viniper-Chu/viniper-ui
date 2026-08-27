export function createTitlebar(root, api, actions) {
  const icon = (name) => {
    const paths = {
      restore: '<rect x="7" y="7" width="10" height="10" rx="1"></rect><path d="M10 5h7a2 2 0 0 1 2 2v7"></path>',
      maximize: '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] ?? paths.maximize}</svg>`;
  };
  const triggers = [...root.querySelectorAll(".menu-trigger")];
  const menus = new Map(triggers.map((trigger) => [trigger, document.getElementById(trigger.dataset.menu)]));

  function closeMenus(returnFocus = false) {
    for (const [trigger, menu] of menus) {
      const wasOpen = !menu.classList.contains("hidden");
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
      if (returnFocus && wasOpen) trigger.focus();
    }
  }

  function openMenu(trigger) {
    const menu = menus.get(trigger);
    if (!menu) return;
    const opening = menu.classList.contains("hidden");
    closeMenus();
    if (!opening) return;
    menu.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    menu.querySelector("button:not(:disabled)")?.focus();
  }

  for (const trigger of triggers) {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(trigger);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openMenu(trigger);
      }
    });
  }

  for (const item of root.querySelectorAll("[data-titlebar-action]")) {
    item.addEventListener("click", async () => {
      const action = actions[item.dataset.titlebarAction];
      closeMenus();
      if (action) await action();
    });
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target)) closeMenus();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "k") {
      event.preventDefault();
      actions["focus-composer"]?.();
    }
  });

  root.querySelector("#titlebarSearchButton")?.addEventListener("click", () => actions["focus-composer"]?.());
  root.querySelector("#titlebarSettingsButton")?.addEventListener("click", () => actions.settings?.());
  root.querySelector("#windowMinimizeButton")?.addEventListener("click", () => api.minimizeWindow());
  root.querySelector("#windowMaximizeButton")?.addEventListener("click", () => api.toggleMaximizeWindow());
  root.querySelector("#windowCloseButton")?.addEventListener("click", () => api.closeWindow());

  const maximizeButton = root.querySelector("#windowMaximizeButton");
  const renderWindowState = (state) => {
    if (!maximizeButton) return;
    maximizeButton.innerHTML = icon(state?.maximized ? "restore" : "maximize");
    maximizeButton.setAttribute("aria-label", state?.maximized ? "还原窗口" : "最大化");
  };
  api.getWindowState().then(renderWindowState);
  const unsubscribe = api.subscribeWindowState(renderWindowState);

  return {
    render(sessionTitle, status) {
      const title = root.querySelector("#titlebarSessionTitle");
      const state = root.querySelector("#titlebarRunStatus");
      if (title) title.textContent = sessionTitle;
      if (state) state.textContent = status;
    },
    dispose() {
      unsubscribe?.();
    },
  };
}
