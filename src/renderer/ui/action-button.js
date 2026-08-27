const ICON_PATHS = Object.freeze({
  check: '<path d="m5 12 4 4L19 6"></path>',
  continue: '<path d="M12 4v14"></path><path d="m7 13 5 5 5-5"></path>',
  download: '<path d="M12 4v11"></path><path d="m7 11 5 5 5-5"></path><path d="M5 20h14"></path>',
  eye: '<path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"></path><circle cx="12" cy="12" r="2.5"></circle>',
  pause: '<path d="M8 5v14M16 5v14"></path>',
  play: '<path d="m8 5 11 7-11 7Z"></path>',
  power: '<path d="M12 3v9"></path><path d="M6.3 6.3a8 8 0 1 0 11.4 0"></path>',
  refresh: '<path d="M20 11a8 8 0 1 0 1 4"></path><path d="M20 5v6h-6"></path>',
  restore: '<path d="M9 7H4v5"></path><path d="M4 12a8 8 0 1 0 2-5"></path>',
});

export function setActionButtonPresentation(button, label, { icon, iconOnly = false } = {}) {
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.tooltip = label;
  if (!icon) {
    button.classList.remove("icon-action");
    button.textContent = label;
    return button;
  }
  button.classList.toggle("icon-action", iconOnly);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ui-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON_PATHS[icon] ?? "";
  const accessibleLabel = document.createElement("span");
  accessibleLabel.className = iconOnly ? "sr-only" : "button-label";
  accessibleLabel.textContent = label;
  button.replaceChildren(svg, accessibleLabel);
  return button;
}
