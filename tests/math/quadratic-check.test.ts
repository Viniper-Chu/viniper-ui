import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { LocalFileHelperHost } from "../../src/platform/process/local-file-helper-host";

const host = new LocalFileHelperHost(join(process.cwd(), "agent-helpers"));
const check = (cases: Record<string, unknown>[]) =>
  host.execute("math.quadratic.check", { cases }, new AbortController().signal);

test("counts distinct roots from known factors, including open endpoints and repeated roots", async () => {
  const cases = [], expected = [];
  for (const [r, s] of [[-2, 1], [1, 1], [0, 2]]) {
    for (const scale of [1, -3]) {
      for (const [lower, upper] of [[-2, 1], [1, 1]]) {
        for (const lower_open of [true, false]) {
          for (const upper_open of [true, false]) {
            cases.push({ a: scale, b: -scale*(r+s), c: scale*r*s, lower, upper, lower_open, upper_open });
            expected.push([...new Set([r,s])].filter(x => (lower_open ? x>lower : x>=lower)
              && (upper_open ? x<upper : x<=upper)).length);
          }
        }
      }
    }
  }
  const result = await check(cases);
  assert.equal(result.ok, true);
  assert.deepEqual((result.cases as { distinct_roots: number }[]).map(row => row.distinct_roots), expected);
});

test("compares irrational roots with rationals exactly and handles constant and linear equations", async () => {
  const rows = [
    { a: 1, b: 0, c: -2, lower: "1.41421356237309504880", upper: "1.41421356237309504881" },
    { a: 1, b: 0, c: 1 }, { a: 0, b: 0, c: 0 }, { a: 0, b: 0, c: 0, lower: 3, upper: 3 },
    { a: 0, b: 0, c: 0, lower: 3, upper: 3, lower_open: true },
    { a: 0, b: 6, c: -2, lower: "1/3", lower_open: true }, { a: 0, b: 6, c: -2, upper: "1/3" },
  ];
  const result = await check(rows);
  assert.deepEqual((result.cases as { distinct_roots: unknown }[]).map(row => row.distinct_roots),
    [1, 0, "infinite", 1, 0, 0, 1]);
  assert.equal((await check([{ a: "1/0", b: 2, c: 0 }])).ok, false);
});

test("classifies all levels of a restricted polynomial including an excluded boundary and an interior extremum", async () => {
  const classify = async (family: Record<string, unknown>) => {
    const result = await host.execute("math.quadratic.check", { level_family: family }, new AbortController().signal);
    assert.equal(result.ok, true);
    return result.pieces as { t_equals?: string, distinct_roots: unknown }[];
  };
  // -x² on (-1,2] has left and right branches with different endpoint inclusion.
  const pieces = await classify({ a: -1, b: 0, c: 0, lower: -1, lower_open: true, upper: 2 });
  assert.deepEqual(pieces.filter(x => x.t_equals !== undefined).map(x => x.t_equals), ["-4", "-1", "0"]);
  assert.deepEqual(pieces.map(x => x.distinct_roots), [0, 1, 1, 1, 2, 1, 0]);
  assert.deepEqual((await classify({ a: 0, b: "-2/3", c: "1/7" })).map(x => x.distinct_roots), [1]);
  assert.deepEqual((await classify({ a: 0, b: 0, c: 2 })).map(x => x.distinct_roots), [0,"infinite",0]);
});

test("normalizes a parameter in either order in the constant term of a zero-form family", async () => {
  const classify = (c: string) => host.execute("math.quadratic.check",
    { level_family: { a: 2, b: 4, c, lower: 0 } }, new AbortController().signal);
  for (const c of ["1/3-2k", "-2*k+1/3", "1/3 − 2k"]) {
    const result = await classify(c);
    assert.equal(result.ok, true);
    assert.equal(result.parameter, "k");
    assert.deepEqual(result.normalized_level_coefficients, ["1", "2", "1/6"]);
    assert.deepEqual(result.geometry, {endpoints: [{side:"lower", x:"0", level:"1/6", included:true}],
      vertex: { x:"-1",level:"-5/6",in_domain:false,kind:"minimum" } });
    assert.deepEqual((result.pieces as {left_branch:number,right_branch:number,shared_vertex:number,distinct_roots:number}[])
      .map(row => [row.left_branch,row.right_branch,row.shared_vertex,row.distinct_roots]),
      [[0,0,0,0], [0,1,0,1], [0,1,0,1]]);
  }
  for (const c of ["a+b", "x+2", "0m-3", "t*t"]) assert.equal((await classify(c)).ok, false);
});

test("classifies multiple independent equations in one verification phase", async () => {
  const result = await host.execute("math.quadratic.check", { level_families: [
    { a:1, b:0, c:0 }, { a:0, b:0, c:"1/2" },
  ] }, new AbortController().signal);
  const families = result.families as { pieces: {distinct_roots: unknown}[] }[];
  assert.equal(result.ok, true);
  assert.deepEqual(families.map(f => f.pieces.map(p => p.distinct_roots)), [[0,1,2],[0,"infinite",0]]);
});

test("attributes roots to monotone branches with the vertex overlapping only when admitted", async () => {
  const result = await check([
    {a:1,b:-4,c:3,lower:0,upper:4}, {a:1,b:-4,c:3,lower:1,lower_open:true,upper:4},
    {a:-1,b:4,c:-4,lower:2,upper:4}, {a:-1,b:4,c:-4,lower:2,lower_open:true,upper:4},
    {a:1,b:-4,c:4,lower:2,upper:2}, {a:1,b:-4,c:4,lower:2,upper:2,upper_open:true},
    {a:1,b:-4,c:3,lower:0,upper:1}, {a:1,b:-4,c:3,lower:3,upper:5},
  ]);
  assert.deepEqual((result.cases as Record<string,number>[]).map(r =>
    [r.left_branch, r.right_branch, r.shared_vertex, r.distinct_roots]),
    [[1,1,0,2],[0,1,0,1],[1,1,1,1],[0,0,0,0],[1,1,1,1],[0,0,0,0],[1,0,0,1],[0,1,0,1]]);
});

test("open endpoints, excluded vertices and singleton branches have the advertised ranges", async () => {
  for (const [family, expected] of [
    [{a:-1,b:2,c:3,lower:-1,upper:3,upper_open:true}, ["左支的定义域为 [-1, 1]，严格递增，值域为 [0, 4]", "右支的定义域为 [1, 3)，严格递减，值域为 (0, 4]"]],
    [{a:1,b:-4,c:4,lower:2,lower_open:true,upper:4}, ["左支为空","右支的定义域为 (2, 4]，严格递增，值域为 (0, 4]"]],
    [{a:1,b:0,c:0,lower:0,upper:0}, ["左支仅含点","右支仅含点"]],
  ] as const) {
    const v = await host.execute("math.quadratic.check",{level_family:family},new AbortController().signal);
    for (const text of expected) assert.ok(String(v.branch_table).includes(text),text);
  }
});
