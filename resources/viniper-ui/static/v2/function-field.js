// The preview and the example use f(x) = ln(x) + exp(x) − 5x, 0 < x ≤ 2.5.
export const functionValue = x => Math.log(x) + Math.exp(x) - 5 * x;
const derivative = x => 1 / x + Math.exp(x) - 5;

function bisect(fn, left, right) {
  const sign = Math.sign(fn(left));
  for (let i = 0; i < 54; i++) {
    const middle = (left + right) / 2;
    if (Math.sign(fn(middle)) === sign) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}

const branches = [1e-8, bisect(derivative, .1, .7), bisect(derivative, .7, 2.5), 2.5];
export function intersections(level) {
  const roots = [];
  const add = x => { if (!roots.some(root => Math.abs(root - x) < 1e-7)) roots.push(x); };
  for (let i = 1; i < branches.length; i++) {
    const left = branches[i - 1], right = branches[i];
    const a = functionValue(left) - level, b = functionValue(right) - level;
    if (Math.abs(a) < 1e-10) add(left);
    if (Math.abs(b) < 1e-10) add(right);
    if (a * b < 0) add(bisect(x => functionValue(x) - level, left, right));
  }
  return roots.sort((a, b) => a - b);
}

export function setupFunctionField(page) {
  const canvas = page.querySelector("canvas.function-field");
  const context = canvas.getContext("2d");
  const slider = page.querySelector("#level-control");
  const readout = page.querySelector(".field-readout");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0, height = 0, plotHeight = 0, pixels = [], colors = {};
  let frame = 0, last = 0, level = Number(slider.value), targetLevel = level;
  const lens = {x: 0, y: 0, strength: 0, targetX: 0, targetY: 0, targetStrength: 0};
  const active = () => page.classList.contains("is-empty") && !page.hidden && !document.hidden;
  const screenX = x => width * (.065 + x / 2.5 * .89);
  const screenY = y => height * .025 + (1.1 - y) / 5.1 * plotHeight;

  function rebuild() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    if (!width || !height) { cancelAnimationFrame(frame); frame = 0; return; }
    plotHeight = Math.min(390, Math.max(170, height * .44));
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const style = getComputedStyle(page);
    colors = {curve: style.getPropertyValue("--accent").trim(), grid: style.getPropertyValue("--secondary").trim(), level: style.getPropertyValue("--graph-level").trim()};
    pixels = [];
    const gap = width < 600 ? 8 : 9;
    for (let px = gap / 2; px < width; px += gap) {
      const x = (px / width - .065) / .89 * 2.5;
      const curveY = x > 0 && x <= 2.5 ? screenY(functionValue(x)) : -10000;
      const slope = x > 0 ? -derivative(x) * plotHeight / 5.1 / (width * .89 / 2.5) : 0;
      for (let py = gap / 2; py < height; py += gap) {
        const distance = Math.abs(py - curveY) / Math.sqrt(1 + slope * slope);
        const core = Math.exp(-distance * distance / 19);
        const ribbon = Math.exp(-distance * distance / 650);
        const fade = Math.max(0, Math.min(1, (height * .81 - py) / (height * .24)));
        const edge = Math.min(1, px / 70, (width - px) / 70);
        const variation = .75 + .25 * Math.sin(px * .14 + py * .08) ** 2;
        const opacity = (.065 + .45 * core + .16 * ribbon) * fade * edge * variation;
        if (opacity > .003) pixels.push({x: px, y: py, size: 1 + 1.35 * core + .55 * ribbon, opacity, curve: ribbon > .03});
      }
    }
    render();
  }

  function magnify(x, y) {
    const dx = x - lens.x, dy = y - lens.y;
    const radius = Math.min(145, width * .24);
    const distance = Math.hypot(dx, dy) / radius;
    const weight = Math.max(0, 1 - distance * distance) ** 2 * lens.strength;
    return {x: x + dx * .26 * weight, y: y + dy * .26 * weight, weight};
  }

  function square(x, y, size, opacity, color) {
    const point = magnify(x, y);
    const side = size * (1 + 2.4 * point.weight);
    context.globalAlpha = Math.min(1, opacity * (1 + 2 * point.weight));
    context.fillStyle = color;
    context.fillRect(point.x - side / 2, point.y - side / 2, side, side);
  }

  function render() {
    context.clearRect(0, 0, width, height);
    for (const point of pixels) square(point.x, point.y, point.size, point.opacity, point.curve ? colors.curve : colors.grid);
    const yy = screenY(level);
    for (let x = 5; x < width; x += 9) square(x, yy, 1.3, .35, colors.level);
    for (const x of intersections(level)) {
      const xx = screenX(x);
      square(xx, yy, 5, .94, colors.level);
      for (const offset of [-9, 9]) {
        square(xx + offset, yy, 2, .42, colors.level);
        square(xx, yy + offset, 2, .42, colors.level);
      }
    }
    context.globalAlpha = 1;
    readout.textContent = "t = " + Number(level.toFixed(2));
  }

  function animate(now) {
    frame = 0;
    if (!active()) return;
    const amount = reduced.matches ? 1 : 1 - Math.exp(-Math.min(48, now - last) / 55);
    last = now;
    const approach = (value, target, tolerance) => Math.abs(target - value) < tolerance ? target : value + (target - value) * amount;
    level = approach(level, targetLevel, .002);
    lens.x = approach(lens.x, lens.targetX, .25);
    lens.y = approach(lens.y, lens.targetY, .25);
    lens.strength = approach(lens.strength, lens.targetStrength, .002);
    render();
    if (level !== targetLevel || lens.x !== lens.targetX || lens.y !== lens.targetY || lens.strength !== lens.targetStrength) frame = requestAnimationFrame(animate);
  }

  function requestDraw() {
    if (!frame && active() && width) { last = performance.now(); frame = requestAnimationFrame(animate); }
  }
  function select(value) {
    targetLevel = Math.max(-4, Math.min(1, Math.round(value * 20) / 20));
    slider.value = String(targetLevel);
    requestDraw();
  }
  function follow(event) {
    if (!active() || !width) return;
    if (event.target.closest("button,input,textarea,.composer,.model-notice")) { lens.targetStrength = 0; requestDraw(); return; }
    const rect = canvas.getBoundingClientRect();
    lens.targetX = event.clientX - rect.left;
    lens.targetY = event.clientY - rect.top;
    lens.targetStrength = 1;
    if (!lens.strength) { lens.x = lens.targetX; lens.y = lens.targetY; }
    // Keep intersection movement slow enough to read while exploring the lens.
    select(-3.5 + 3.8 * lens.targetX / width);
  }
  page.addEventListener("pointermove", event => { if (event.pointerType !== "touch") follow(event); }, {passive: true});
  page.addEventListener("pointerdown", event => { if (event.pointerType === "touch") follow(event); }, {passive: true});
  page.addEventListener("pointerleave", () => { lens.targetStrength = 0; requestDraw(); });
  slider.addEventListener("input", () => { lens.targetStrength = 0; select(Number(slider.value)); });
  reduced.addEventListener("change", requestDraw);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else requestDraw();
  });
  new MutationObserver(() => {
    if (active()) rebuild();
    else { cancelAnimationFrame(frame); frame = 0; lens.strength = lens.targetStrength = 0; }
  }).observe(page, {attributes: true, attributeFilter: ["class", "hidden"]});
  new MutationObserver(rebuild).observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
  new ResizeObserver(rebuild).observe(canvas);
  rebuild();
}
