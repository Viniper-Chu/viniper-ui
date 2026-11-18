import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("resources/viniper-ui/static/v2/function-field.js", "utf8").replace(/\bexport /g, "");

test("logarithmic-exponential background counts distinct intersections at extrema and the closed endpoint", () => {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  for (const [level, count] of [[-4, 1], [-2, 3], [-1, 1], [.5, 1], [1, 0]]) {
    const roots = ctx.intersections(level) as number[];
    assert.equal(roots.length, count);
    for (const x of roots) {
      assert.ok(x > 0 && x <= 2.5);
      assert.ok(Math.abs(Math.log(x) + Math.exp(x) - 5 * x - level) < 1e-9);
    }
  }
  for (const level of [-1.3493613177560466, -2.615614837657664]) assert.equal(ctx.intersections(level).length, 2);
  const endpoint = ctx.intersections(Math.log(2.5) + Math.exp(2.5) - 12.5);
  assert.equal(endpoint.length, 1);
  assert.equal(endpoint[0], 2.5);
});

test("pixel lens settles, honors reduced motion and stops drawing when a conversation opens", () => {
  const frames = new Map<number, (now: number) => void>();
  const events: Record<string, (event?: any) => void> = {};
  const observers: Array<() => void> = [];
  let now = 0, id = 0, empty = true, maximum = 0;
  const context = {setTransform() {}, clearRect() {}, fillRect(_x: number, _y: number, width: number) { maximum = Math.max(maximum, width); }};
  const canvas = {getContext: () => context, getBoundingClientRect: () => ({width: 1000, height: 700, left: 0, top: 0})};
  const slider = {value: "-2", addEventListener: (name: string, callback: () => void) => { events["slider-" + name] = callback; }};
  const readout = {textContent: ""};
  const reduced = {matches: false, addEventListener() {}};
  const page = {hidden: false, classList: {contains: () => empty},
    querySelector: (selector: string) => selector.includes("canvas") ? canvas : selector.includes("level-control") ? slider : readout,
    addEventListener: (name: string, callback: () => void) => { events[name] = callback; }};
  const ctx = vm.createContext({devicePixelRatio: 2, matchMedia: () => reduced,
    performance: {now: () => now}, document: {hidden: false, documentElement: {}, addEventListener() {}},
    getComputedStyle: () => ({getPropertyValue: () => "#245E54"}),
    requestAnimationFrame: (callback: (now: number) => void) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (key: number) => frames.delete(key),
    MutationObserver: class { constructor(callback: () => void) { observers.push(callback); } observe() {} },
    ResizeObserver: class { observe() {} },
  });
  vm.runInContext(source, ctx);
  ctx.setupFunctionField(page);
  assert.equal(frames.size, 0);
  const tick = () => { now += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); };
  events.pointermove({pointerType: "mouse", clientX: 585, clientY: 245, target: {closest: () => null}});
  for (let i = 0; i < 100 && frames.size; i++) tick();
  assert.equal(frames.size, 0);
  assert.ok(maximum > 6, "the pointer enlarges pixels");
  reduced.matches = true;
  slider.value = "-2.05"; events["slider-input"](); tick();
  assert.equal(readout.textContent, "t = -2.05");
  assert.equal(frames.size, 0);
  slider.value = "-1"; events["slider-input"]();
  empty = false; observers[0]();
  assert.equal(frames.size, 0);
});
