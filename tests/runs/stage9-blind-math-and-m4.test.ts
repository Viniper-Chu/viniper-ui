import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runAgentToolLoop } from "../../src/features/runs/tool-loop/agent-tool-loop";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { OpenAIChatProvider, serializeOpenAIChat } from "../../src/features/providers/protocols/openai-chat/openai-chat-provider";
import { providerOptions, protocolRequest, testProfile } from "../providers/protocol-test-kit";
import type { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
type TestModelProvider = Parameters<typeof runAgentToolLoop>[0]["provider"];

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DEDICATED_PYTHON = join(homedir(), "Library", "Application Support", "Viniper workstation", "runtime", "python", "bin", "python3");
const PYTHON_BIN = process.env.VINIPER_PYTHON || (existsSync(DEDICATED_PYTHON) ? DEDICATED_PYTHON : "python3");

test("M8: math_review verifies parametric roots, half-open endpoints, vertex multiplicity, ranges, and extraneous roots", () => {
  const script = `
import asyncio, json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO_ROOT, "resources", "viniper-ui"))})
from math_review import inconsistent_equality, verify_structured_math_check
from discussion import extract_blind_problem, discussion_events

# 1. Extended inline rational expression check (products, powers, TeX fractions)
err_inline = inconsistent_equality(r"代入得 $2\\times\\frac{5}{2} - (\\frac{5}{2})^2 = \\frac{5}{4}$。")
assert "-5/4" in err_inline and "5/4" in err_inline, err_inline
assert inconsistent_equality(r"代入得 $2\\times\\frac{5}{2} - (\\frac{5}{2})^2 = -\\frac{5}{4}$。") == ""

# 2. Valid parametric_roots on half-open [0, 3) for x^2 - 2x + a = 0  <=>  a = -x^2 + 2x
valid_param = """定稿结论如下。
\`\`\`math-check
{
  "type": "parametric_roots",
  "variable": "x",
  "parameter": "a",
  "parameter_expr": "-x^2 + 2*x",
  "domain": { "lower": "0", "upper": "3", "lower_open": false, "upper_open": true },
  "pieces": [
    { "condition": "a <= -3", "roots": 0 },
    { "condition": "-3 < a < 0", "roots": 1 },
    { "condition": "0 <= a < 1", "roots": 2 },
    { "condition": "a == 1", "roots": 1 },
    { "condition": "a > 1", "roots": 0 }
  ]
}
\`\`\`
"""
assert inconsistent_equality(valid_param) == ""

# 3. Half-open endpoint error (claiming a == -3 gives 1 root when x=3 is excluded)
bad_endpoint = valid_param.replace('{ "condition": "a <= -3", "roots": 0 }', '{ "condition": "a < -3", "roots": 0 }, { "condition": "a == -3", "roots": 1 }')
err_ep = inconsistent_equality(bad_endpoint)
assert "a = -3" in err_ep and "实际有 0 个" in err_ep, err_ep

# 4. Vertex multiplicity error (claiming double root at vertex a == 1 gives 2 distinct roots)
bad_vertex = valid_param.replace('{ "condition": "a == 1", "roots": 1 }', '{ "condition": "a == 1", "roots": 2 }')
err_vx = inconsistent_equality(bad_vertex)
assert "a = 1" in err_vx and "实际有 1 个" in err_vx, err_vx

# 5. Irrational root interval error (at a = -2, roots are 1 +- sqrt(3), only 1 + sqrt(3) in [0, 3))
bad_irr = valid_param.replace('{ "condition": "-3 < a < 0", "roots": 1 }', '{ "condition": "-3 < a < 0", "roots": 2 }')
err_irr = inconsistent_equality(bad_irr)
assert "实际有 1 个" in err_irr, err_irr

# 6. Function range check on [0, 3): valid (-3, 1] vs wrong closed [-3, 1]
valid_range = """\`\`\`math-check
{
  "type": "function_range",
  "variable": "x",
  "expr": "-x^2 + 2*x",
  "domain": { "lower": "0", "upper": "3", "lower_open": false, "upper_open": true },
  "range": { "lower": "-3", "upper": "1", "lower_open": true, "upper_open": false }
}
\`\`\`"""
assert verify_structured_math_check(valid_range) == ""
bad_range = valid_range.replace('"lower_open": true', '"lower_open": false')
assert "无法取到 -3" in verify_structured_math_check(bad_range)

# 7. Extraneous root check for rational equation 1/(x - 1) + 2 = 3/(x - 1)
valid_eq = """\`\`\`math-check
{ "type": "equation_roots", "variable": "x", "lhs": "1/(x - 1) + 2", "rhs": "3/(x - 1)", "roots": ["2"] }
\`\`\`"""
assert verify_structured_math_check(valid_eq) == ""
bad_extr = valid_eq.replace('"2"', '"1"')
assert "增根" in verify_structured_math_check(bad_extr)

# 8. Blind problem extraction & unanchored blind_math_check before reviewer sees lead draft
members = [
    {"name": "解题", "role": "主答初解", "model": "inkling-2-mini"},
    {"name": "复核", "role": "独立复核推导与端点", "model": "inkling-2-mini"},
]
q = "讨论方程 x^2 - 2x + a = 0 在区间 [0, 3) 上的实根个数，解题写完后交给 复核 复查，再交回 解题 定稿。"
extracted = extract_blind_problem(q, [], members)
assert "x^2 - 2x + a = 0" in extracted and "交回" not in extracted, extracted

self_posed_spoken = [("解题", "题目：设函数 f(x) = -x^2 + 2x，x ∈ [0, 3)，求值域。\\n\\n解：易知值域为 [-3, 1]（故意写错左端点锚点标记）。")]
extracted_self = extract_blind_problem("请 解题 自拟一道函数值域题，交给 复核 复查，再交回 解题。", self_posed_spoken, members)
assert "f(x) = -x^2 + 2x" in extracted_self and "故意写错左端点锚点标记" not in extracted_self, extracted_self

blind_inputs = []
stream_calls = []
session = {"messages": []}

class BlindAwareTransport:
    async def blind_math_check(self, sid, problem_text, model, permission, attachments, *, speaker):
        blind_inputs.append((speaker, problem_text))
        return "[math.quadratic.check 盲算回执] 值域 (-3, 1]，a = -3 时 0 根。"

    async def stream(self, sid, prompt, model, mode, attachments, *, speaker, display_prompt, suppress_user_message, room_history, verify_final_math):
        stream_calls.append((speaker, prompt, list(room_history or []), verify_final_math))
        yield {"type": "assistant_start", "speaker": speaker, "model": model}
        reply = {
            "解题": "初解草稿（误写 [-3, 1]）" if len(stream_calls) == 1 else "已采纳盲审订正为 (-3, 1]。",
            "复核": "对照盲算，初解误含 -3。",
        }[speaker]
        session["messages"].append({"role": "assistant", "speaker": speaker, "content": reply})
        session["last_run_status"] = "completed"
        yield {"type": "done"}

async def run_room():
    return [ev async for ev in discussion_events(BlindAwareTransport(), session, "r1", q, members, "ask", [])]

asyncio.run(run_room())
assert len(blind_inputs) == 1
assert blind_inputs[0][0] == "复核"
assert "误写 [-3, 1]" not in blind_inputs[0][1]
assert "防锚定基准" in stream_calls[1][1] and "盲算回执" in stream_calls[1][1]
assert "math-check" in stream_calls[2][1] and stream_calls[2][3] is True
assert any("解题：初解草稿" in h for h in stream_calls[2][2])
print("PYTHON_M8_OK")
`;
  const out = execFileSync(PYTHON_BIN, ["-c", script], { encoding: "utf8" });
  assert.match(out, /PYTHON_M8_OK/);
});

test("M4 & M0: local verified math round preserves tools + tool_choice:none + full history prefix and maps timings.prompt_ms", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "math.quadratic.check",
    description: "Exact quadratic check",
    readOnly: true,
    inputSchema: { type: "object", properties: {} },
    async execute(req) {
      return {
        toolId: req.id,
        text: JSON.stringify({
          ok: true,
          parameter: "a",
          geometry: { vertex: { x: "1", level: "1", included: true } },
          counts: [],
        }),
      };
    },
  });

  const capturedRequests: ProviderRequest[] = [];
  const rounds: ProviderEvent[][] = [
    [{
      kind: "tool-call.completed",
      call: {
        type: "tool-call",
        callId: "q1",
        name: "math.quadratic.check",
        arguments: {},
        argumentsText: "{}",
      },
    }],
    [{ kind: "text.delta", text: "由精确回执可得完整分段结论。" }],
  ];

  const localProvider: TestModelProvider = {
    descriptor: {
      id: "custom",
      name: "Local Inkling",
      label: "Local Inkling",
      configuration: "configured",
      available: true,
      realCallsEnabled: true,
      capabilities: ["streaming", "tools"],
      models: [{ id: "inkling-2-mini", label: "Inkling 2 Mini" }],
    },
    runtimePolicyFor: () => ({
      model: "inkling-2-mini",
      endpoint: "http://127.0.0.1:18080/v1",
      contextTokens: 32768,
      compactAtTokens: 24576,
      outputTokens: 4096,
      maxIterations: 12,
      defaultReasoning: "low",
      reasoningBudgets: {},
      parallelToolCalls: false,
      visionEnabled: false,
      structuredToolsJson: false,
      helperRevision: "r13",
    }),
    async *stream(req: ProviderRequest) {
      capturedRequests.push(structuredClone(req));
      const next = rounds.shift() ?? [];
      for (const ev of next) yield ev;
    },
  };

  const profile = testProfile("openai-chat", "http://127.0.0.1/v1/chat/completions");
  const baseReq: ProviderRequest = {
    ...protocolRequest(profile),
    sessionId: "s-m4",
    selectedModel: "inkling-2-mini",
    permissionMode: "full",
    reasoning: "low",
    history: [{ id: "u1", role: "user", items: [{ type: "text", text: "讨论方程 x^2 - 2x + a = 0 在 [0, 3) 上的实根个数" }] }],
    tools: [{
      name: "math.quadratic.check",
      description: "Exact quadratic check",
      readOnly: true,
      permission: "auto-read-only",
      inputSchema: { type: "object", properties: {} },
    }],
  };

  const res = await runAgentToolLoop({
    provider: localProvider,
    request: baseReq,
    toolRegistry: registry,
    completesVerification: (call, result) => call.name === "math.quadratic.check" && !result.isError,
    signal: new AbortController().signal,
    now: () => 1000,
    emit: async () => {},
    onProviderEvent: async () => {},
    appendHistory: async () => {},
  });

  assert.match(res.assistantText, /完整分段结论/);
  assert.equal(capturedRequests.length, 2);
  // Round 2 MUST preserve tools array, set toolChoice: "none", keep reasoning "low", and keep [user, assistant(tool-call), tool(result), user(writerInstructions)]
  assert.equal(capturedRequests[1].tools.length, 1);
  assert.equal(capturedRequests[1].toolChoice, "none");
  assert.equal(capturedRequests[1].reasoning, "low");
  assert.deepEqual(capturedRequests[1].history.map((h) => h.role), ["user", "assistant", "tool", "user"]);

  const wireBody = serializeOpenAIChat(capturedRequests[1], profile);
  assert.ok(Array.isArray(wireBody.tools) && wireBody.tools.length === 1);
  assert.equal(wireBody.tool_choice, "none");

  // Verify M0 timings.prompt_ms & predicted_ms mapping on OpenAIChatProvider
  const sseBody = [
    'data: {"choices":[{"delta":{"content":"收到"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":20,"total_tokens":1020},"timings":{"cache_n":900,"prompt_n":100,"prompt_ms":642.4,"predicted_n":20,"predicted_ms":1120.8}}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const chatProvider = new OpenAIChatProvider({
    ...providerOptions(profile),
    fetchImpl: async () => new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const events: ProviderEvent[] = [];
  for await (const ev of chatProvider.stream(baseReq, new AbortController().signal)) {
    events.push(ev);
  }
  const usageEv = events.find((e) => e.kind === "usage.completed");
  assert.ok(usageEv && usageEv.kind === "usage.completed");
  assert.equal(usageEv.usage.cacheHitInput, 900);
  assert.equal(usageEv.usage.cacheMissInput, 100);
  assert.equal(usageEv.usage.promptMs, 642);
  assert.equal(usageEv.usage.outputMs, 1121);
});

test("Stage 9 UI & revision contracts: revision >= 13, context cache/prefill details, math-check badge, and permission focus", () => {
  const rev = readFileSync(join(REPO_ROOT, "resources", "viniper-ui", "RELEASE_REVISION"), "utf8").trim();
  assert.ok(Number(rev) >= 13, `expected RELEASE_REVISION >= 13, got ${rev}`);

  const menusJs = readFileSync(join(REPO_ROOT, "resources", "viniper-ui", "static", "v2", "menus.js"), "utf8");
  assert.match(menusJs, /最近缓存命中/);
  assert.match(menusJs, /最近预填充耗时/);

  const mdJs = readFileSync(join(REPO_ROOT, "resources", "viniper-ui", "static", "conversation-markdown.js"), "utf8");
  assert.match(mdJs, /math-check-badge/);

  const appJs = readFileSync(join(REPO_ROOT, "resources", "viniper-ui", "static", "v2", "app.js"), "utf8");
  assert.match(appJs, /需要确认工具权限/);
  assert.match(appJs, /data-permission-answer/);
});
