import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

function pythonContract(script: string): void {
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const executable = process.platform === "win32" ? "py" : "python3";
  const result = spawnSync(executable, [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c",
    `import sys\nsys.path.insert(0, ${JSON.stringify(resources)})\n${script}`,
  ], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("Claude command catalog uses real runtime metadata and separate native/UI routes", () => {
  pythonContract(String.raw`
from native_commands import build_native_command_manifest, resolve_native_command
from agent_runtime import RuntimeProbe, RuntimeCapabilities
probe = RuntimeProbe(status="ready", version="2.1.260 (Claude Code)", capabilities=RuntimeCapabilities(agent_registry=True))
manifest = build_native_command_manifest(probe, ["future-command", {"name": "team:review"}, "bad;name", "../escape"])
assert manifest["cli_version"] == "2.1.260 (Claude Code)"
assert manifest["catalog_complete"] is False
assert "/goal" not in manifest["commands"]
assert "/future-command" in manifest["commands"] and "/team:review" in manifest["commands"]
assert "/bad;name" not in manifest["commands"]
for command, action in (("model", "model"), ("permissions", "permissions"), ("config", "config")):
    route = resolve_native_command(command, probe=probe)
    assert route["execution"] == "native-ui" and route["ui_action"] == action
    assert route["owner"] == "claude-code-cli"
assert resolve_native_command("mcp", probe=probe)["execution"] == "native-terminal"
for command in ("agents", "tasks", "plugin"):
    assert resolve_native_command(command, probe=probe)["execution"] == "native-terminal"
assert resolve_native_command("doctor", probe=probe)["cli_args"] == ["doctor"]
assert resolve_native_command("help", probe=probe)["cli_args"] == ["--help"]
`);
});

test("Claude command arguments cannot turn a UI route into ignored options or injected CLI arguments", () => {
  pythonContract(String.raw`
from native_commands import resolve_native_command, build_native_cli_argv
probe = {"ready": True, "version": "next"}
route = resolve_native_command("/model", "Kimi-K3; echo unsafe", probe)
assert route["execution"] == "native-terminal"
assert route["command_to_type"] == "/model Kimi-K3; echo unsafe"
assert "cli_args" not in route and route["ui_action"] == ""
for command, arguments in (("/help;whoami", ""), ("/help", "ok\n/quit"), ("/help", "x" * 4001), ("unknown", "")):
    try: resolve_native_command(command, arguments, probe)
    except ValueError: pass
    else: raise AssertionError("invalid command accepted")
for command in ("model", "help --version", "doctor;whoami", "mcp"):
    try: build_native_cli_argv(command, workdir="/mnt/d/project")
    except ValueError: pass
    else: raise AssertionError("unsafe CLI route accepted")
args = build_native_cli_argv("help", workdir="/mnt/d/project with spaces")
assert args[-1] == "--help"
assert args[args.index("--cd") + 1] == "/mnt/d/project with spaces"
assert args[args.index("-lc") + 1] == 'export PATH="$HOME/.local/bin:$PATH"; exec claude "$@"'
`);
});

test("Claude terminal keeps model, settings, path and resumed session as data and never submits a slash prompt", () => {
  pythonContract(String.raw`
from native_commands import build_native_terminal_argv
sid = "8d805f37-31b6-40a0-9808-adc6990c67a6"
model = "custom-model;$(touch /tmp/not-run)"
cwd = "/mnt/d/project 'quoted' $literal"
args = build_native_terminal_argv(workdir=cwd, model=model, claude_session_id=sid,
    resume=True, permission_mode="default", permission_modes=("manual", "plan"),
    settings_file="/mnt/d/config with spaces.json", add_dirs=("/mnt/d/other $dir",))
assert args[args.index("--model") + 1] == model
assert args[args.index("--cd") + 1] == cwd
assert args[args.index("--permission-mode") + 1] == "manual"
assert args[args.index("--resume") + 1] == sid
script = args[args.index("-lc") + 1]
assert model not in script and cwd not in script and sid not in script
assert "-p" not in args and "--print" not in args
assert "--input-format" not in args and "--output-format" not in args
assert not any(value.startswith("/compact") for value in args)
full = build_native_terminal_argv(workdir="/tmp/project", permission_mode="bypassPermissions")
assert "--allow-dangerously-skip-permissions" in full
assert full[full.index("--permission-mode") + 1] == "bypassPermissions"
for options in ({"resume": True}, {"claude_session_id": "bad --resume"}, {"permission_mode": "bogus"}, {"model": "--evil"}):
    try: build_native_terminal_argv(workdir="/tmp/project", **options)
    except ValueError: pass
    else: raise AssertionError("invalid terminal options accepted")
`);
});

test("Claude missing runtime leaves local settings usable and marks native routes unavailable", () => {
  pythonContract(String.raw`
from native_commands import build_native_command_manifest, resolve_native_command
manifest = build_native_command_manifest({"status": "cli_missing", "version": ""})
rows = {item["command"]: item for item in manifest["descriptors"]}
assert rows["/config"]["available"] is True
assert rows["/compact"]["available"] is False
assert rows["/doctor"]["available"] is False
assert rows["/agents"]["execution"] == "native-terminal"
assert manifest["cli_version"] == ""
assert resolve_native_command("model", "some-model", {"ready": False})["available"] is False
`);
});

test("Claude streaming initialization correlates the native ACK and projects no account or agent prompts", () => {
  pythonContract(String.raw`
from native_commands import build_native_initialize_request, parse_native_initialize_response, NativeInitializationError
request = build_native_initialize_request("fixture:init:1", forward_subagent_text=True)
assert request == {"type":"control_request", "request_id":"fixture:init:1", "request":{"subtype":"initialize", "hooks":None, "forwardSubagentText":True}}
native = {"type":"control_response", "response":{"subtype":"success", "request_id":"fixture:init:1", "response":{
    "commands":[{"name":"plugin", "description":"Plugins", "argumentHint":"list"}],
    "models":[{"value":"native-model", "displayName":"Native", "description":"Model"}],
    "agents":[{"name":"Explore", "description":"Read-only", "prompt":"PRIVATE PROMPT"}],
    "current_permission_mode":"manual", "account":{"token":"PRIVATE TOKEN"}, "session_state":{"body":"PRIVATE BODY"}}}}
parsed = parse_native_initialize_response(native, "fixture:init:1")
assert parsed["commands"][0]["name"] == "plugin"
assert parsed["agents"][0]["name"] == "Explore"
assert "PRIVATE" not in str(parsed)
assert parsed["current_permission_mode"] == "manual"
assert parse_native_initialize_response(native, "different-run") is None
assert parse_native_initialize_response({"type":"system", "subtype":"init"}, "fixture:init:1") is None
assert parse_native_initialize_response({"type":"control_response", "request_id":"fixture:init:1", "response":{}}, "fixture:init:1") is None
for response in ({"subtype":"error", "error":"PRIVATE PROVIDER TOKEN"}, {"subtype":"success", "response":[]}):
    try:
        parse_native_initialize_response({"type":"control_response", "response":{"request_id":"fixture:init:1", **response}}, "fixture:init:1")
    except NativeInitializationError as error:
        assert "PRIVATE" not in str(error)
    else:
        raise AssertionError("malformed or rejected native ACK accepted")
`);
});
