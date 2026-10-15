"""Claude-owned command routes for the desktop adapter.

The CLI does not expose its interactive command catalog through ``--help``.
Keep desktop equivalents explicit, augment them with names observed in native
session initialization, and send terminal-only actions to a real Claude TUI.
This module never sends a slash command as an LLM prompt or reads credentials.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Mapping, Sequence
from uuid import UUID


OWNER = "claude-code-cli"
CATALOG_SOURCE = "workstation-adapter"
_COMMAND_NAME = re.compile(r"[a-z][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*\Z")
_BOOTSTRAP = 'export PATH="$HOME/.local/bin:$PATH"; exec claude "$@"'

# These are routes implemented by the desktop, not a version-pinned claim about
# the CLI's complete slash menu. In particular, /goal is not invented for Claude.
_UI_ROUTES = (
    ("config", "设置", "打开 Claude code 的独立设置", "config"),
    ("model", "模型", "选择此 Claude code 会话使用的模型", "model"),
    ("permissions", "权限", "选择 Claude Code 原生权限模式", "permissions"),
    ("context", "上下文", "查看当前会话的上下文用量", "context"),
    ("status", "运行状态", "查看 Claude Code 版本、连接与运行状态", "status"),
    ("resume", "会话", "打开 Claude code 的会话列表", "sessions"),
    ("skills", "技能", "管理 Claude code 的技能", "skills"),
    ("add-dir", "项目与目录", "查看和选择此会话的项目目录", "project"),
    ("diff", "文件修改", "查看此会话产生的文件修改", "diff"),
)
_TERMINAL_ROUTES = (
    ("tasks", "后台任务", "在 Claude Code 原生界面查看后台工具任务与 Agent"),
    ("agents", "Agent", "在 Claude Code 原生界面创建或管理 Agent"),
    ("plugin", "插件", "在 Claude Code 原生界面安装和管理插件"),
    ("mcp", "MCP 管理", "在 Claude Code 原生界面管理 MCP 服务"),
    ("compact", "压缩上下文", "在原生界面压缩当前 Claude Code 会话"),
    ("init", "项目说明", "在原生界面创建或更新 CLAUDE.md"),
    ("review", "代码审查", "在 Claude Code 原生界面执行审查"),
    ("security-review", "安全审查", "在 Claude Code 原生界面执行安全审查"),
    ("rewind", "回退会话", "在原生界面选择会话与代码检查点"),
    ("hooks", "Hooks", "在 Claude Code 原生界面配置 Hooks"),
    ("memory", "记忆", "在 Claude Code 原生界面管理记忆"),
    ("effort", "思考强度", "在原生界面调整当前模型支持的思考强度"),
    ("fast", "快速模式", "在原生界面检查并选择可用的快速模式"),
    ("login", "登录", "在 Claude Code 原生界面登录"),
    ("logout", "退出登录", "在 Claude Code 原生界面管理登录状态"),
    ("keybindings", "快捷键", "在 Claude Code 原生界面配置快捷键"),
    ("statusline", "状态栏", "在 Claude Code 原生界面配置状态栏"),
    ("theme", "终端外观", "调整 Claude Code 原生终端的外观"),
    ("feedback", "反馈", "打开 Claude Code 原生反馈入口"),
)
_CLI_ROUTES = (
    ("help", "原生帮助", "显示当前已安装 Claude Code 的命令帮助", ("--help",)),
    ("doctor", "CLI 诊断", "运行 Claude Code 原生安装诊断", ("doctor",)),
)


class NativeInitializationError(RuntimeError):
    """The current native process rejected or malformed its initialization."""


def build_native_initialize_request(
    request_id: str,
    *,
    forward_subagent_text: bool = False,
) -> dict[str, Any]:
    """Build the SDK's control handshake, not a user/model message."""
    if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", request_id):
        raise ValueError("原生初始化请求 ID 无效")
    request: dict[str, Any] = {"subtype": "initialize", "hooks": None}
    if forward_subagent_text:
        request["forwardSubagentText"] = True
    return {"type": "control_request", "request_id": request_id, "request": request}


def parse_native_initialize_response(payload: Any, request_id: str) -> dict[str, Any] | None:
    """Match one SDK ACK and retain only capability metadata safe to project.

    The wire correlation ID lives under ``response``. Unrelated events must be
    processed by the caller's ordinary event reader. Do not expose ``account``,
    agent prompts, or the CLI's arbitrary session-state object to the renderer.
    """
    if not isinstance(payload, Mapping) or payload.get("type") != "control_response":
        return None
    response = payload.get("response")
    if not isinstance(response, Mapping) or response.get("request_id") != request_id:
        return None
    if response.get("subtype") == "error":
        raise NativeInitializationError("Claude Code 拒绝了初始化请求")
    if response.get("subtype") != "success" or not isinstance(response.get("response"), Mapping):
        raise NativeInitializationError("Claude Code 初始化回执格式无效")
    source = response["response"]

    def rows(key: str, allowed: Sequence[str]) -> list[dict[str, Any]]:
        values = source.get(key)
        if not isinstance(values, list):
            return []
        return [
            {name: item[name] for name in allowed if name in item and isinstance(item[name], (str, int, float, bool))}
            for item in values if isinstance(item, Mapping)
        ]

    return {
        "commands": rows("commands", ("name", "description", "argumentHint")),
        "models": rows("models", ("value", "displayName", "description", "supportsEffort")),
        "agents": rows("agents", ("name", "description", "model")),
        "current_permission_mode": str(source.get("current_permission_mode") or ""),
    }


def _probe_dict(probe: Any) -> dict[str, Any]:
    if hasattr(probe, "as_dict"):
        probe = probe.as_dict()
    return dict(probe) if isinstance(probe, Mapping) else {}


def _clean_name(value: Any) -> str:
    name = str(value or "").strip().removeprefix("/").lower()
    if not _COMMAND_NAME.fullmatch(name):
        raise ValueError("命令名称无效")
    return name


def _observed_names(values: Iterable[Any] | None) -> list[str]:
    names: list[str] = []
    for value in values or ():
        if isinstance(value, Mapping):
            value = value.get("name") or value.get("command")
        try:
            name = _clean_name(value)
        except ValueError:
            continue
        if name not in names:
            names.append(name)
    return names


def build_native_command_manifest(
    probe: Any,
    native_commands: Iterable[Any] | None = None,
) -> dict[str, Any]:
    """Build routes using the actual probe version and optional native names."""
    runtime = _probe_dict(probe)
    ready = bool(runtime.get("ready", runtime.get("status") == "ready"))
    version = str(runtime.get("version") or "")
    observed = set(_observed_names(native_commands))
    descriptors: list[dict[str, Any]] = []

    def add(name: str, title: str, description: str, execution: str, **extra: Any) -> None:
        descriptors.append({
            "command": f"/{name}", "title": title, "description": description,
            "execution": execution, "owner": OWNER, "cli_version": version,
            "available": execution == "native-ui" or ready,
            "source": "native-session" if name in observed else CATALOG_SOURCE,
            "ui_action": "", **extra,
        })

    for name, title, description, action in _UI_ROUTES:
        add(name, title, description, "native-ui", ui_action=action)
    for name, title, description, args in _CLI_ROUTES:
        add(name, title, description, "cli", cli_args=list(args))
    for name, title, description in _TERMINAL_ROUTES:
        add(name, title, description, "native-terminal")
    add("terminal", "原生交互面板", "在工作台内使用 Claude Code 完整原生界面", "native-terminal", owner=CATALOG_SOURCE)
    known = {item["command"][1:] for item in descriptors}
    for name in sorted(observed - known):
        add(name, f"/{name}", "在 Claude Code 原生界面执行此命令", "native-terminal")
    return {
        "ok": True, "owner": OWNER, "cli_version": version,
        "source": CATALOG_SOURCE,
        "catalog_complete": False,
        "commands": [item["command"] for item in descriptors],
        "descriptors": descriptors,
    }


def resolve_native_command(
    command: Any,
    arguments: Any = "",
    probe: Any = None,
    native_commands: Iterable[Any] | None = None,
) -> dict[str, Any]:
    """Resolve one route; CLI argument lists are fixed and never user-built."""
    name = _clean_name(command)
    detail = str(arguments or "").strip()
    if len(detail) > 4000 or any(ord(char) < 32 for char in detail):
        raise ValueError("命令参数应为不超过 4000 个字符的单行文本")
    manifest = build_native_command_manifest(probe, native_commands)
    descriptor = next((item for item in manifest["descriptors"] if item["command"] == f"/{name}"), None)
    if descriptor is None:
        raise ValueError("当前命令尚未由桌面适配器或 Claude Code 会话声明")
    result = {"ok": True, **descriptor, "arguments": detail}
    # Arguments on UI shortcuts can change native semantics (/model NAME,
    # /resume UUID, /add-dir PATH). Do not silently ignore them or claim success.
    if detail:
        result.update(execution="native-terminal", ui_action="", available=bool(_probe_dict(probe).get("ready", _probe_dict(probe).get("status") == "ready")))
        result.pop("cli_args", None)
    if result["execution"] == "native-terminal":
        result["command_to_type"] = "" if name == "terminal" else f"/{name}" + (f" {detail}" if detail else "")
        result["summary"] = "在 Claude Code 原生交互面板中继续；命令需在面板中确认执行。"
    elif result["execution"] == "native-ui":
        result["summary"] = result["description"]
    return result


def _single_value(value: Any, label: str, *, required: bool = False) -> str:
    text = str(value or "")
    if (required and not text) or any(ord(char) < 32 for char in text):
        raise ValueError(f"{label}无效")
    return text


def _wsl_argv(args: Sequence[str], *, workdir: str, distro: str, user: str) -> list[str]:
    """Use only a fixed shell bootstrap; every dynamic value remains argv data."""
    cwd = _single_value(workdir, "工作目录", required=True)
    if not cwd.startswith("/"):
        raise ValueError("工作目录必须是已映射的 WSL 绝对路径")
    for name, value in (("运行环境", distro), ("运行用户", user)):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", value):
            raise ValueError(f"{name}无效")
    return ["wsl.exe", "--distribution", distro, "--user", user, "--cd", cwd,
            "--exec", "sh", "-lc", _BOOTSTRAP, "viniper-native-cli", *args]


def build_native_cli_argv(
    command: Any,
    *,
    workdir: str,
    distro: str = "ViniperRuntime",
    user: str = "viniper",
) -> list[str]:
    """Only offline help and diagnosis are executable through this API."""
    name = _clean_name(command)
    route = next((item for item in _CLI_ROUTES if item[0] == name), None)
    if route is None:
        raise ValueError("该命令没有允许的非交互执行入口")
    return _wsl_argv(route[3], workdir=workdir, distro=distro, user=user)


def build_native_terminal_argv(
    *,
    workdir: str,
    model: str = "",
    permission_mode: str = "default",
    permission_modes: Sequence[str] = (),
    claude_session_id: str = "",
    resume: bool = False,
    name: str = "",
    settings_file: str = "",
    mcp_config_file: str = "",
    add_dirs: Sequence[str] = (),
    launcher: Sequence[str] | None = None,
    system_prompt_file: str = "",
    agents: Mapping[str, Any] | None = None,
    distro: str = "ViniperRuntime",
    user: str = "viniper",
) -> list[str]:
    """Launch a visible TUI with host-owned model/session/settings, no prompt.

    The caller owns process creation, credentials/environment bridging, and
    exclusion against an already-running session. ``command_to_type`` from the
    resolver is UI text only: this function intentionally cannot accept it.
    """
    mode = str(permission_mode)
    choices = tuple(permission_modes)
    if mode == "default" and choices and "default" not in choices and "manual" in choices:
        mode = "manual"
    if mode not in {"default", "manual", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"}:
        raise ValueError("Claude Code 权限模式无效")
    if choices and mode not in choices:
        raise ValueError("当前 Claude Code 不支持该权限模式")
    args: list[str] = []
    if mode == "bypassPermissions":
        args.append("--allow-dangerously-skip-permissions")
    args.extend(("--permission-mode", mode))
    if claude_session_id:
        try:
            session_id = str(UUID(str(claude_session_id)))
        except (ValueError, AttributeError):
            raise ValueError("Claude Code 会话 ID 无效") from None
        args.extend(("--resume" if resume else "--session-id", session_id))
    elif resume:
        raise ValueError("恢复原生会话需要明确的会话 ID")
    for flag, value, label in (
        ("--model", model, "模型"), ("--name", name, "会话名称"),
        ("--settings", settings_file, "设置路径"), ("--mcp-config", mcp_config_file, "MCP 路径"),
        ("--append-system-prompt-file", system_prompt_file, "项目说明路径"),
    ):
        text = _single_value(value, label)
        if text:
            if text.startswith("-"):
                raise ValueError(f"{label}不能以选项前缀开头")
            args.extend((flag, text))
    for directory in add_dirs:
        path = _single_value(directory, "附加目录", required=True)
        if not path.startswith("/"):
            raise ValueError("附加目录必须是绝对路径")
        args.extend(("--add-dir", path))
    if agents:
        args.extend(("--agents", json.dumps(dict(agents), ensure_ascii=False)))
    if launcher is not None:
        if not launcher or not all(_single_value(item, "CLI 路径", required=True) for item in launcher):
            raise ValueError("原生 CLI 启动程序无效")
        if not _single_value(workdir, "工作目录", required=True).startswith("/"):
            raise ValueError("原生工作目录必须是绝对路径")
        return [*launcher, *args]
    return _wsl_argv(args, workdir=workdir, distro=distro, user=user)
