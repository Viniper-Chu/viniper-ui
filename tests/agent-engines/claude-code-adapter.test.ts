import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaudeCodeInvocation,
  buildClaudeCodeEnvironment,
  ClaudeCodeProvider,
  projectClaudeCodeLine,
} from "../../src/features/providers/claude-code-provider";
import { projectProviderEvent } from "../../src/features/runs/provider-event-projector";
import { mergeWslEnv, NodeClaudeCodeProcessHost } from "../../src/platform/process/claude-code-process-host";
import { protocolRequest, testProfile } from "../providers/protocol-test-kit";

function request() {
  return {
    ...protocolRequest(testProfile("anthropic-messages", "http://127.0.0.1:9/v1/messages"), "claude-code-default"),
    workingDirectory: "D:\\Viniper project",
  };
}

test("Claude Code native adapter keeps the project root and maps the shared permission control", () => {
  const invocation = buildClaudeCodeInvocation(request(), {
    executable: "claude",
    prefixArgs: [],
    transport: "native-cli",
    version: "fixture",
    useSpawnCwd: true,
  });

  assert.equal(invocation.executable, "claude");
  assert.equal(invocation.cwd, "D:\\Viniper project");
  assert.deepEqual(invocation.args.slice(0, 7), [
    "--print", "--output-format", "stream-json", "--verbose",
    "--no-session-persistence", "--permission-mode", "acceptEdits",
  ]);
  assert.match(invocation.args.at(-1) ?? "", /应用的结构化会话是唯一会话真源/u);
  assert.match(invocation.args.at(-1) ?? "", /User: 检查队列/u);
});

test("Claude Code maps every shared permission mode to a CLI 2.1.x accepted value", () => {
  const command = {
    executable: "claude",
    prefixArgs: [],
    transport: "native-cli" as const,
    version: "fixture",
    useSpawnCwd: true,
  };
  const mapped = (["ask", "auto", "full", "plan"] as const).map((permissionMode) => {
    const invocation = buildClaudeCodeInvocation({ ...request(), permissionMode }, command);
    return invocation.args[invocation.args.indexOf("--permission-mode") + 1];
  });
  assert.deepEqual(mapped, ["manual", "acceptEdits", "bypassPermissions", "plan"]);
});

test("Claude Code full access opts into native bypass acknowledgement", () => {
  const invocation = buildClaudeCodeInvocation({ ...request(), permissionMode: "full" }, {
    executable: "claude",
    prefixArgs: [],
    transport: "native-cli",
    version: "fixture",
    useSpawnCwd: true,
  });
  const permissionIndex = invocation.args.indexOf("--permission-mode");
  assert.equal(invocation.args[permissionIndex + 1], "bypassPermissions");
  assert.ok(invocation.args.includes("--allow-dangerously-skip-permissions"));
});

test("Claude Code WSL adapter inserts the Windows project root before the delegated CLI", () => {
  const invocation = buildClaudeCodeInvocation(request(), {
    executable: "wsl.exe",
    prefixArgs: ["-d", "ViniperRuntime", "--", "/home/viniper/.local/bin/claude"],
    transport: "wsl-cli",
    version: "fixture",
    useSpawnCwd: false,
  });

  assert.equal(invocation.cwd, undefined);
  assert.deepEqual(invocation.args.slice(0, 7), [
    "-d", "ViniperRuntime", "--cd", "D:\\Viniper project", "--", "/home/viniper/.local/bin/claude", "--print",
  ]);
  assert.equal(invocation.transport, "wsl-cli");
});

test("Claude Code stream-json projects text, external tool visibility, permission terminal and usage", () => {
  assert.deepEqual(projectClaudeCodeLine(JSON.stringify({
    type: "system",
    subtype: "init",
    permissionMode: "acceptEdits",
  })), [{ kind: "provider-permission.confirmed", mode: "acceptEdits" }]);

  assert.deepEqual(projectClaudeCodeLine(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "完成" }, { type: "tool_use", id: "call-1", name: "Write", input: {} }] },
  })), [
    { kind: "text.delta", text: "完成" },
    { kind: "provider-tool.started", callId: "call-1", name: "Write" },
  ]);

  assert.deepEqual(projectClaudeCodeLine(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "call-1", content: "ok" }] },
  })), [{ kind: "provider-tool.completed", callId: "call-1", isError: false }]);

  assert.deepEqual(projectClaudeCodeLine(JSON.stringify({
    type: "result",
    usage: {
      input_tokens: 10,
      output_tokens: 6,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 2,
    },
  })), [
    { kind: "provider-permission.completed", deniedCount: 0 },
    {
      kind: "usage.completed",
      usage: {
        input: 10,
        cacheHitInput: 4,
        cacheMissInput: 6,
        cacheWriteInput: 2,
        output: 6,
        reasoning: 0,
        toolUse: 0,
        total: 16,
        source: "provider",
      },
    },
  ]);
  assert.deepEqual(projectClaudeCodeLine("not-json"), []);
});

test("Claude Code authentication errors are classified instead of projected as successful text", async () => {
  const line = JSON.stringify({
    type: "assistant",
    error: "authentication_failed",
    is_api_error_message: true,
    message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] },
  });
  assert.deepEqual(projectClaudeCodeLine(line), [{
    kind: "provider.failed",
    code: "CLAUDE_CODE_AUTHENTICATION_FAILED",
    message: "Not logged in · Please run /login",
  }]);

  const provider = new ClaudeCodeProvider({
    command: {
      executable: "claude",
      prefixArgs: [],
      transport: "native-cli",
      version: "fixture",
      useSpawnCwd: true,
    },
    processHost: {
      async *lines() { yield line; },
    },
  });
  await assert.rejects(async () => {
    for await (const _event of provider.stream(request(), new AbortController().signal)) void _event;
  }, /CLAUDE_CODE_AUTHENTICATION_FAILED: Not logged in/u);
});

test("Claude Code API-key mode resolves secure settings into the child environment without renderer exposure", async () => {
  const seen: Array<{ env?: Record<string, string> }> = [];
  const successLine = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "fixture response" }] },
  });
  const provider = new ClaudeCodeProvider({
    command: {
      executable: "claude",
      prefixArgs: [],
      transport: "native-cli",
      version: "fixture",
      useSpawnCwd: true,
    },
    resolveApiKey: async () => "x".repeat(32),
    resolveBaseUrl: () => "https://fixture.example/v1/messages",
    processHost: {
      async *lines(invocation) {
        seen.push(invocation);
        yield successLine;
      },
    },
  });
  for await (const _event of provider.stream(request(), new AbortController().signal)) void _event;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].env?.ANTHROPIC_API_KEY?.length, 32);
  assert.equal(seen[0].env?.ANTHROPIC_BASE_URL, "https://fixture.example");
});

test("Claude Code gateway token mode maps one secure value to AUTH_TOKEN and carries non-secret aliases", () => {
  const token = "fixture-gateway-token";
  const environment = buildClaudeCodeEnvironment({
    authMode: "auth-token",
    authToken: token,
    apiKey: "should-not-be-forwarded",
    baseUrl: "https://gateway.example/v1/messages",
    model: "deepseek-v4-flash",
    smallFastModel: "deepseek-v4-pro",
  });
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, token);
  assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(environment.ANTHROPIC_BASE_URL, "https://gateway.example");
  assert.equal(environment.ANTHROPIC_MODEL, "deepseek-v4-flash");
  assert.equal(environment.ANTHROPIC_SMALL_FAST_MODEL, "deepseek-v4-pro");
});

test("Claude Code model alias contract forwards only values that actually exist", () => {
  const environment = buildClaudeCodeEnvironment({
    authMode: "auth-token",
    authToken: "fixture-token",
    model: "model-primary",
    defaultSonnetModel: "model-sonnet",
    defaultOpusModel: "model-opus",
    defaultHaikuModel: "model-haiku",
    smallFastModel: "model-fast",
    subagentModel: "model-subagent",
  });
  assert.deepEqual(Object.keys(environment).sort(), [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
  ].sort());
  assert.equal(environment.ANTHROPIC_DEFAULT_SONNET_MODEL, "model-sonnet");
  assert.equal(environment.ANTHROPIC_DEFAULT_OPUS_MODEL, "model-opus");
  assert.equal(environment.ANTHROPIC_DEFAULT_HAIKU_MODEL, "model-haiku");
  assert.equal(environment.CLAUDE_CODE_SUBAGENT_MODEL, "model-subagent");
});

test("WSLENV preserves existing entries and appends only actual child env names", () => {
  const merged = mergeWslEnv("KEEP/u:ANTHROPIC_MODEL", {
    ANTHROPIC_AUTH_TOKEN: "fixture-secret",
    ANTHROPIC_BASE_URL: "https://fixture.example",
  });
  assert.equal(merged, "KEEP/u:ANTHROPIC_MODEL:ANTHROPIC_AUTH_TOKEN:ANTHROPIC_BASE_URL");
  assert.doesNotMatch(merged ?? "", /fixture-secret/u);
  assert.doesNotMatch(merged ?? "", /ANTHROPIC_API_KEY/u);
});

test("WSL invocation keeps secrets out of args and prompt JSON while transport metadata selects the bridge", () => {
  const secret = "fixture-wsl-secret";
  const invocation = buildClaudeCodeInvocation(request(), {
    executable: "wsl.exe",
    prefixArgs: ["-d", "ViniperRuntime", "--", "/home/viniper/.local/bin/claude"],
    transport: "wsl-cli",
    version: "fixture",
    useSpawnCwd: false,
  }, {
    authMode: "auth-token",
    authToken: secret,
    baseUrl: "https://gateway.example/anthropic",
    model: "model-fixture",
  });
  assert.equal(invocation.transport, "wsl-cli");
  assert.doesNotMatch(JSON.stringify({ args: invocation.args }), new RegExp(secret, "u"));
  assert.equal(invocation.env?.ANTHROPIC_AUTH_TOKEN, secret);
  assert.equal(invocation.env?.ANTHROPIC_API_KEY, undefined);
});

test("native transport delivers bridged-equivalent configuration to a real child without adding WSLENV entries", async () => {
  const host = new NodeClaudeCodeProcessHost();
  const lines: string[] = [];
  for await (const line of host.lines({
    executable: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({ bridge: process.env.WSLENV, probe: process.env.VINIPER_NATIVE_ENV_PROBE, url: process.env.ANTHROPIC_BASE_URL, model: process.env.ANTHROPIC_MODEL, cwd: process.cwd() }))"],
    cwd: process.cwd(),
    env: {
      WSLENV: "PREEXISTING/u", VINIPER_NATIVE_ENV_PROBE: "visible-in-native-child",
      ANTHROPIC_BASE_URL: "https://fixture.example", ANTHROPIC_MODEL: "model-fixture",
    },
    transport: "native-cli",
  }, new AbortController().signal)) lines.push(line);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    bridge: "PREEXISTING/u", probe: "visible-in-native-child", url: "https://fixture.example",
    model: "model-fixture", cwd: process.cwd(),
  });
});

test("wsl.exe printenv fixture sees non-secret bridged variables when WSL is available", async (t) => {
  if (process.platform !== "win32") {
    t.skip("WSL transport is Windows-only");
    return;
  }
  const host = new NodeClaudeCodeProcessHost();
  const lines: string[] = [];
  try {
    for await (const line of host.lines({
      executable: "wsl.exe",
      args: ["-d", "ViniperRuntime", "--", "printenv", "VINIPER_WSL_ENV_PROBE", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"],
      env: {
        VINIPER_WSL_ENV_PROBE: "visible-only-with-wslenv",
        ANTHROPIC_BASE_URL: "https://fixture.example",
        ANTHROPIC_MODEL: "model-fixture",
      },
      transport: "wsl-cli",
    }, new AbortController().signal)) lines.push(line);
  } catch {
    t.skip("ViniperRuntime WSL fixture unavailable");
    return;
  }
  assert.deepEqual(lines, ["visible-only-with-wslenv", "https://fixture.example", "model-fixture"]);
});

test("Claude Code official API-key mode never mirrors the secret into AUTH_TOKEN", () => {
  const environment = buildClaudeCodeEnvironment({
    authMode: "api-key",
    apiKey: "fixture-api-key",
    authToken: "should-not-be-forwarded",
  });
  assert.equal(environment.ANTHROPIC_API_KEY, "fixture-api-key");
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, undefined);
});

test("Claude Code closes authentication before spawning when the host vault has no selected credential", async () => {
  let spawned = false;
  const provider = new ClaudeCodeProvider({
    command: {
      executable: "claude",
      prefixArgs: [],
      transport: "native-cli",
      version: "fixture",
      useSpawnCwd: true,
    },
    resolveAuthMode: () => "auth-token",
    resolveSecret: async () => null,
    processHost: {
      async *lines() {
        spawned = true;
        yield JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "must not run" }] } });
      },
    },
  });
  await assert.rejects(async () => {
    for await (const _event of provider.stream(request(), new AbortController().signal)) void _event;
  }, /CLAUDE_CODE_AUTHENTICATION_MISSING: Claude Code 网关 Token 未配置/u);
  assert.equal(spawned, false);
});

test("Claude Code prompt and projected events never echo the child credential", () => {
  const secret = "fixture-private-value";
  const invocation = buildClaudeCodeInvocation(request(), {
    executable: "claude",
    prefixArgs: [],
    transport: "native-cli",
    version: "fixture",
    useSpawnCwd: true,
  }, { authMode: "auth-token", authToken: secret });
  assert.doesNotMatch(JSON.stringify(invocation.args), new RegExp(secret, "u"));
  assert.deepEqual(projectClaudeCodeLine(JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "safe output" }] },
  })), [{ kind: "text.delta", text: "safe output" }]);
});

test("Claude Code tool and permission events become visible canonical runtime activities", async () => {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const context = {
    session: { activities: [] } as never,
    assistantMessageId: "assistant-1",
    thinkingActivityId: "thinking-1",
    now: () => 123,
    emit: async (type: string, payload: unknown) => { emitted.push({ type, payload }); },
    appendText: () => undefined,
    providerLabel: "Claude code",
  };
  await projectProviderEvent({ kind: "provider-permission.confirmed", mode: "acceptEdits" }, context as never);
  await projectProviderEvent({ kind: "provider-tool.started", callId: "call-1", name: "Write" }, context as never);
  await projectProviderEvent({ kind: "provider-tool.completed", callId: "call-1", isError: false }, context as never);
  await projectProviderEvent({ kind: "provider-permission.completed", deniedCount: 0 }, context as never);
  assert.deepEqual(emitted.map((entry) => entry.type), [
    "interaction.requested",
    "tool.requested",
    "tool.completed",
    "interaction.resolved",
  ]);
  assert.match(JSON.stringify(emitted), /Claude code 工具已完成/u);
  assert.match(JSON.stringify(emitted), /无拒绝项/u);
});

test("Claude Code cancellation terminates only the spawned process tree", async () => {
  const host = new NodeClaudeCodeProcessHost();
  const controller = new AbortController();
  const childScript = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "process.stdout.write(`${process.pid}|${child.pid}\\n`);",
    "setInterval(() => {}, 1000);",
  ].join("");
  let ownedPids: number[] = [];
  await assert.rejects(async () => {
    for await (const line of host.lines({ executable: process.execPath, args: ["-e", childScript] }, controller.signal)) {
      ownedPids = line.split("|").map(Number);
      controller.abort();
    }
  }, /CLAUDE_CODE_CANCELLED/u);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(ownedPids.length, 2);
  assert.ok(ownedPids.every((pid) => !processIsAlive(pid)), `owned process remained: ${ownedPids.join(",")}`);
  assert.equal(processIsAlive(process.pid), true);
});

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
