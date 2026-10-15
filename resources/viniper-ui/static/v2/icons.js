const paths = {
  brand: "M4 5h4l4 13L20 5h-4l-4 7",
  compose: "M20 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5m4-1 7 7m-4-9 6 6-11 11-6 1 1-6Z",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  tasks: "M4 4h9M4 9h7M4 14h3m9-3a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3v3h2",
  document: "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h4",
  database: "M20 6c0 2-3.5 3-8 3S4 8 4 6s3.5-3 8-3 8 1 8 3ZM4 6v12c0 2 3.5 3 8 3s8-1 8-3V6M4 12c0 2 3.5 3 8 3s8-1 8-3",
  codeWindow: "M3 3h18v18H3ZM3 8h18M6 5.5h.1m3 0h.1m1 6-3 3 3 3m4-6 3 3-3 3",
  math: "M4 15h3l3 6 4-18h7M16 15h5m-2.5-2.5v5",
  arrowRight: "M4 12h16m-5-5 5 5-5 5",
  book: "M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8",

  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m8 10 4 4 4-4",
  down: "M12 5v14m-6-6 6 6 6-6",
  up: "M12 19V5m-6 6 6-6 6 6",
  stop: "M7 7h10v10H7z",
  sidebar: "M4 4h16v16H4zM9 4v16",
  chat: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Z",
  sparkles: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
  target: "M21 12a9 9 0 1 1-9-9m0 4a5 5 0 1 0 5 5m-5 0 8-8m-4 0h4v4",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm5.5 13 5 5",
  settings:
    "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  folder: "M3 6h7l2 2h9v11H3Z",
  files: "M7 3h9l4 4v14H7ZM16 3v5h4M3 6v12",
  file: "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h4",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-2-13-4 16",
  shield: "m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6ZM9 12l2 2 4-4",
  shieldAlert: "m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6ZM12 8v5m0 3v.1",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  edit: "m4 15 11-11 5 5L9 20H4ZM12 7l5 5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  steer: "M5 20V8a4 4 0 0 1 4-4h10m-5-1 5 1-1 5M5 13h8a4 4 0 0 1 4 4v3",
  check: "m5 12 4 4L19 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v6l4 2",
  plan: "M9 5h12M9 12h12M9 19h12M3 5h.1M3 12h.1M3 19h.1",
  play: "m8 4 12 8-12 8Z",
  pause: "M8 4v16M16 4v16",
  trash: "M4 7h16M9 3h6l1 4M6 7l1 14h10l1-14M10 11v6M14 11v6",
  link: "m10 14 4-4m-6 5-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0m2 2 2-2a4 4 0 0 1 5 5l-5 5a4 4 0 0 1-5 0",
  external: "M14 3h7v7m0-7L10 14M10 5H4v15h15v-6",
  terminal: "m4 6 6 6-6 6m9 0h7",
  plugin: "M8 3v5m8-5v5M5 8h14v5a7 7 0 0 1-14 0ZM12 20v3",
  copy: "M8 8h12v13H8ZM4 16H2V2h12v3",
};
export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === "more" ? '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>' : `<path d="${paths[name] || paths.sparkles}"/>`}</svg>`;
export function hydrateIcons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((node) => (node.innerHTML = icon(node.dataset.icon)));
}
