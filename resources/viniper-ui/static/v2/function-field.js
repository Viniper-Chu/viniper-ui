// The example and the empty-state graph share f(x) = 4 − (x − 1)² on [−1, 3).
export function intersections(t) {
  if (t < 0 || t > 4) return [];
  if (t === 4) return [1];
  const distance = Math.sqrt(4 - t);
  return t === 0 ? [-1] : [1 - distance, 1 + distance];
}

export function setupFunctionField(page) {
  const svg = page.querySelector(".function-field");
  const slider = page.querySelector("#level-control");
  const nodes = Object.fromEntries([...svg.querySelectorAll("[data-part]")].map(n => [n.dataset.part, n]));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0, height = 0, level = 2.25, target = level, frame = 0, last = 0;
  const set = (el, values) => { for (const [key, val] of Object.entries(values)) el.setAttribute(key, val); };
  const x = value => width * ((width < 560 ? 0.55 : 0.64) + (value - 1) * (width < 560 ? 0.195 : 0.155));
  const y = value => height * (0.86 - 0.162 * value);

  function drawLevel() {
    const yy = y(level);
    set(nodes.level, {d: `M0 ${yy}H${width}`});
    const roots = intersections(level);
    [nodes.left, nodes.right].forEach((point, index) => {
      const visible = index < roots.length;
      const halo = index === 0 ? nodes.leftHalo : nodes.rightHalo;
      for (const node of [point, halo]) {
        node.style.display = visible ? "" : "none";
        if (visible) set(node, {cx:x(roots[index]), cy:yy});
      }
    });
    set(nodes.label,{x:Math.min(width-58,x(3)+8),y:yy-9});
    nodes.label.textContent = "t = " + Number(level.toFixed(2));
  }
  function layout() {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) { cancelAnimationFrame(frame); frame = 0; return; }
    width = bounds.width; height = bounds.height;
    set(svg,{viewBox:`0 0 ${width} ${height}`});
    set(nodes.curve,{d:`M${x(-1)} ${y(0)} Q${x(1)} ${y(8)} ${x(3)} ${y(0)}`});
    set(nodes.axes,{d:`M0 ${y(0)}H${width} M${x(0)} 8V${height}`});
    set(nodes.symmetry,{d:`M${x(1)} ${y(4)}V${y(0)}`});
    set(nodes.closed,{cx:x(-1),cy:y(0)}); set(nodes.open,{cx:x(3),cy:y(0)});
    set(nodes.equation,{x:x(1)+12,y:y(4)-13}); drawLevel();
  }
  function animate(now) {
    frame = 0;
    level += (target - level) * (1 - Math.exp(-Math.min(48, now-last)/60));
    last = now;
    if (Math.abs(level-target) < .007) level = target;
    drawLevel();
    if (level !== target) frame = requestAnimationFrame(animate);
  }
  function select(value, snapToBoundary = false) {
    value = Math.round(Math.max(-.5,Math.min(4.5,value))*20)/20;
    target = value;
    if (snapToBoundary && Math.abs(value - 4) < .081) target = 4;
    if (snapToBoundary && Math.abs(value) < .081) target = 0;
    slider.value = String(target);
    if (reduced.matches) { cancelAnimationFrame(frame); frame = 0; level = target; drawLevel(); }
    else if (!frame && level !== target) { last = performance.now(); frame = requestAnimationFrame(animate); }
  }
  function follow(event) {
    if (!page.classList.contains("is-empty") || event.target.closest("button,input,textarea,.composer,.model-notice") || !width) return;
    const r = page.getBoundingClientRect();
    const horizontal = (event.clientX-r.left)/r.width, vertical = (event.clientY-r.top)/r.height;
    select(-.65 + 5.35 * (.73*horizontal + .27*(1-vertical)), true);
  }
  page.addEventListener("pointermove",e=>{if(e.pointerType!=="touch")follow(e)}, {passive:true});
  page.addEventListener("pointerdown",e=>{if(e.pointerType==="touch")follow(e)}, {passive:true});
  slider.addEventListener("input",()=>select(Number(slider.value)));
  new ResizeObserver(layout).observe(svg);
  layout();
}
