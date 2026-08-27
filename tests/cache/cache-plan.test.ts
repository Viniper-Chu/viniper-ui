import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCachePlan,
  buildContextProfile,
  stableContextSkills,
  stableContextTools,
} from "../../src/features/cache/cache-plan";

test("CachePlan keeps stable segments before the current turn", () => {
  const profile = buildContextProfile({
    enabledSkills: [{
      id: "brief",
      name: "简报",
      description: "测试",
      source: "built-in",
      packagePath: "skills/brief/SKILL.md",
      body: "先结论。",
    }],
  });
  const plan = buildCachePlan("本轮任务", profile);
  assert.deepEqual(plan.stableSegments.map((segment) => segment.name), [
    "tool-schemas",
    "system",
    "project",
    "skills",
    "stable-history",
  ]);
  assert.equal(plan.reusablePrefix.includes("本轮任务"), false);
  assert.equal(plan.currentTurn, "本轮任务");
  assert.equal(plan.reusedContextChars > 0, true);
  assert.equal(plan.addedContextChars, 4);
  assert.match(plan.reusablePrefix, /Skill 简报/u);
});

test("ContextProfile canonicalizes tool and Skill discovery order for a byte-stable prefix", () => {
  const definition = (name: string, properties: Record<string, { type: "string" }>) => ({
    name,
    description: name,
    inputSchema: { type: "object" as const, properties, additionalProperties: false },
    readOnly: true,
    permission: "auto-read-only" as const,
  });
  const tools = [definition("z.last", { z: { type: "string" }, a: { type: "string" } }), definition("a.first", {})];
  const skills = [
    { id: "z", name: "末项", description: "z", source: "built-in" as const, packagePath: "z/SKILL.md", body: "z" },
    { id: "a", name: "首项", description: "a", source: "built-in" as const, packagePath: "a/SKILL.md", body: "a" },
  ];
  assert.deepEqual(stableContextTools(tools).map((tool) => tool.name), ["a.first", "z.last"]);
  assert.deepEqual(stableContextSkills(skills).map((skill) => skill.id), ["a", "z"]);

  const left = buildContextProfile({ tools, enabledSkills: skills });
  const right = buildContextProfile({ tools: [...tools].reverse(), enabledSkills: [...skills].reverse() });
  assert.equal(buildCachePlan("left", left).reusablePrefix, buildCachePlan("right", right).reusablePrefix);
  assert.equal(left.stableSegments[0].text.includes('"a":{"type":"string"},"z":{"type":"string"}'), true);
});

test("stable provider prefix excludes release-only version markers", () => {
  const profile = buildContextProfile({ projectInstructions: "保持同一项目语义。" });
  const project = profile.stableSegments.find((segment) => segment.name === "project")?.text ?? "";
  assert.doesNotMatch(project, /\bv?\d+\.\d+\.\d+\b/u);
  assert.match(project, /Viniper workstation Preview/u);
});
