import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { join } from "node:path";

test("installed Python Claude runtime carries full-access mode and native bypass flag", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const script = String.raw`
import json
import sys
from pathlib import Path
sys.path.insert(0, r"${resources.replace(/\\/g, "\\\\")}")
from agent_runtime import AgentRunSpec, RuntimeCapabilities, RuntimeProbe, WslAgentRuntime
from server import claude_fallback_model, claude_permission_mode

runtime = WslAgentRuntime(command_runner=lambda command: None)
runtime._last_probe = RuntimeProbe(
    status="ready",
    capabilities=RuntimeCapabilities(
        stream_json=True,
        structured_input=True,
        structured_interactions=True,
        permission_modes=("default", "acceptEdits", "bypassPermissions", "plan"),
        auto_compact=False,
    ),
)
spec = AgentRunSpec(
    session_id="fixture-session",
    claude_session_id="fixture-claude-session",
    session_name="fixture",
    workdir=r"C:\\fixture-project",
    model="Kimi-K3",
    permission_mode="bypassPermissions",
    resume=False,
)
command = runtime.build_command(spec)
assert "--permission-mode" in command
permission_index = command.index("--permission-mode")
assert command[permission_index + 1] == "bypassPermissions"
assert "--allow-dangerously-skip-permissions" in command
assert command.index("--allow-dangerously-skip-permissions") < permission_index
assert claude_permission_mode("fullAccess") == "bypassPermissions"
fallback_model = claude_fallback_model({"id": "anthropic", "model": "Kimi-K3"}, "Kimi-K3")
assert fallback_model == ""
assert "--fallback-model" not in command
print(json.dumps({
    "runtime": "WslAgentRuntime",
    "permissionMode": "bypassPermissions",
    "nativeBypassFlag": True,
    "claudeFallbackModel": fallback_model,
    "model": "Kimi-K3",
    "providerCalls": 0,
    "secretsOrBodies": False,
}))
`;
  const result = spawnSync(python, ["-3", "-E", "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"nativeBypassFlag": true/u);
});

test("Claude autocompact uses the native strategy while preserving model capacity", () => {
  const python = process.platform === "win32" ? "py" : "python3";
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const script = String.raw`
import json
import sys
sys.path.insert(0, r"${resources.replace(/\\/g, "\\\\")}")
from agent_runtime import AgentRunSpec, _claude_arguments

spec = AgentRunSpec(
    session_id="fixture-session",
    claude_session_id="fixture-claude-session",
    session_name="fixture",
    workdir=r"C:\\fixture-project",
    model="Kimi-K3",
    permission_mode="default",
    resume=False,
    effective_context_window=1048576,
)
args = _claude_arguments(spec, lambda value: value, permission_choices=("default",), auto_compact_supported=True)
index = args.index("--autocompact")
assert args[index + 1] == "auto"
assert "1048576" not in args
print(json.dumps({"autocompact": args[index + 1], "effectiveContextWindow": spec.effective_context_window, "providerCalls": 0}))
`;
  const result = spawnSync(python, ["-3", "-E", "-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"autocompact"\s*:\s*"auto"/u);
  assert.match(result.stdout, /"effectiveContextWindow"\s*:\s*1048576/u);
});
