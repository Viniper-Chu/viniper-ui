import asyncio
import base64
import copy
import http.client
import httpx
import inspect
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from context_lifecycle import (
    ContextAdapterUnavailable,
    ContextLifecycle,
    ExternalSummaryAdapter,
    NativeContextAdapter,
)
from context_usage import ContextUsageLedger, ContextUsageSnapshot
from daily_usage import DailyUsageLedger
from agent_runtime import (
    AgentRunSpec,
    MANAGED_DISTRO_NAME,
    MANAGED_DISTRO_USER,
    RuntimeProbe,
    WindowsNativeRuntime,
    WslAgentRuntime,
    stable_session_name,
)
from agent_instructions import AgentInstructionsStore
from agent_host_bridge import (
    MCP_RESPONSE_ACK_STAGE,
    PERMISSION_PROMPT_MCP_QUALIFIED_TOOL,
    HostInteractionChannel,
    build_hook_response,
    build_hook_settings,
    build_passive_hook_settings,
    build_permission_prompt_mcp_config,
    build_permission_prompt_response,
)
from agent_queue import AgentQueueStore
from agent_run_coordinator import (
    ActiveRunExists,
    AgentRunCoordinator,
    AgentRunJournal,
    DurableInteractionStore,
)
from native_peer import ClaudeCrossSessionAdapter, NativePeerMessaging, build_native_send_instruction
from skill_sync import localized_skill_fields, status_display, synchronize_skill_records
from wsl_runtime import RuntimeUpdateCoordinator, WslRuntimeProvisioner


PROFILE_NAME = "agent-shell"
VERSION_FILE = Path(__file__).resolve().parent / "VERSION"
PROFILE_FILE = Path(__file__).resolve().parent / "profiles.json"


def read_profile_config() -> dict[str, Any]:
    try:
        data = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def env_value(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def read_app_version() -> str:
    env_version = env_value("VINIPER_UI_VERSION", "").strip()
    if env_version:
        return env_version
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.1.0"
    except Exception:
        return "0.1.0"


APP_VERSION = read_app_version()
PREVIEW_MODE = env_value("VINIPER_UI_PREVIEW", "").strip() == "1" or VERSION_FILE.with_name("PREVIEW").exists()
PREVIEW_PROFILE = read_profile_config().get("preview", {})
if not isinstance(PREVIEW_PROFILE, dict):
    PREVIEW_PROFILE = {}
APP_TITLE = str(PREVIEW_PROFILE.get("product_name") or "Viniper Preview") if PREVIEW_MODE else "Viniper"
ACTIVE_PROFILE = "preview" if PREVIEW_MODE else "formal-runtime"
ASSET_VERSION = env_value("VINIPER_UI_ASSET_VERSION", "").strip() or APP_VERSION
SESSION_MODES = {"chat", "agent"}


def normalize_session_mode(value: Any) -> str:
    return "chat" if str(value or "").strip().lower() == "chat" else "agent"
PERMISSION_MODE_OPTIONS = [
    {
        "id": "default",
        "label": "询问权限",
        "description": "Claude 在需要权限时暂停并询问",
    },
    {
        "id": "acceptEdits",
        "label": "自动接受编辑",
        "description": "自动允许文件编辑，其他高风险操作仍会询问",
    },
    {
        "id": "plan",
        "label": "计划模式",
        "description": "先规划，减少直接执行动作",
    },
    {
        "id": "auto",
        "label": "自动模式",
        "description": "由 Claude Code 的可用自动模式判断动作",
    },
    {
        "id": "bypassPermissions",
        "label": "跳过权限",
        "description": "跳过 Claude Code 权限确认，仅在设置中明确启用后提供",
    },
]
PERMISSION_MODE_IDS = {item["id"] for item in PERMISSION_MODE_OPTIONS}
DEFAULT_PERMISSION_MODE = env_value("VINIPER_UI_PERMISSION_MODE", "default")
if DEFAULT_PERMISSION_MODE not in PERMISSION_MODE_IDS:
    DEFAULT_PERMISSION_MODE = "default"
CLAUDE_REQUIRED_OPTIONS = [
    "-p",
    "--output-format",
    "--include-partial-messages",
    "--include-hook-events",
    "--model",
    "--session-id",
    "--resume",
    "--permission-mode",
    "--allow-dangerously-skip-permissions",
    "--fallback-model",
    "--name",
    "--append-system-prompt",
    "--add-dir",
    "--settings",
    "--mcp-config",
    "--permission-prompt-tool",
    "--verbose",
]
CLAUDE_REQUIRED_PERMISSION_MODES = [
    "default",
    "acceptEdits",
    "auto",
    "bypassPermissions",
    "dontAsk",
    "plan",
]
RUN_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_RUN_TIMEOUT", "0"))
HEARTBEAT_INTERVAL_SECONDS = int(env_value("VINIPER_UI_HEARTBEAT_INTERVAL", "15"))
NO_OUTPUT_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_NO_OUTPUT_TIMEOUT", str(40 * 60)))
CLI_INTERACTION_ACK_TIMEOUT_SECONDS = float(env_value("VINIPER_UI_CLI_ACK_TIMEOUT", "30"))
HOST_HOOK_COMPATIBILITY_GRACE_SECONDS = float(env_value("VINIPER_UI_HOOK_COMPAT_GRACE", "0.35"))
MODEL_IDLE_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_MODEL_IDLE_TIMEOUT", str(25 * 60)))
MODEL_STALL_RECOVERY_ATTEMPTS = int(env_value("VINIPER_UI_MODEL_STALL_RECOVERY_ATTEMPTS", "2"))
GUI_COMMAND_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_GUI_COMMAND_TIMEOUT", "0"))
ACTION_TASK_IDLE_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_ACTION_IDLE_TIMEOUT", "0"))
SAFETY_GUARDS_ENABLED = env_value("VINIPER_UI_SAFETY_GUARDS", "0") == "1"
TOOL_RESULT_DISPLAY_LIMIT = int(env_value("VINIPER_UI_TOOL_RESULT_LIMIT", "8000"))
STREAM_READ_CHUNK_SIZE = max(
    4096,
    int(env_value("VINIPER_UI_STREAM_READ_CHUNK_SIZE", str(64 * 1024))),
)
MAX_ATTACHMENT_BYTES = int(env_value("VINIPER_UI_MAX_ATTACHMENT_BYTES", str(50 * 1024 * 1024)))
MAX_ATTACHMENT_TOTAL_BYTES = int(env_value("VINIPER_UI_MAX_ATTACHMENT_TOTAL_BYTES", str(100 * 1024 * 1024)))
MAX_RENDER_IMAGE_BYTES = int(env_value("VINIPER_UI_MAX_RENDER_IMAGE_BYTES", str(10 * 1024 * 1024)))
SUPPORTED_RENDER_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
}
IMAGE_SUFFIX_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}
UPDATE_SOURCE_FILE = VERSION_FILE.with_name("update_source.json")
UPDATE_MANIFEST_URL_ENV = env_value("VINIPER_UI_UPDATE_MANIFEST_URL", "").strip()
UPDATE_REPOSITORY_ENV = env_value("VINIPER_UI_UPDATE_REPO", "").strip()
UPDATE_HTTP_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_UPDATE_TIMEOUT", "45"))
UPDATE_DOWNLOAD_RETRIES = int(env_value("VINIPER_UI_UPDATE_RETRIES", "5"))
UPDATE_DOWNLOAD_CHUNK_SIZE = max(64 * 1024, int(env_value("VINIPER_UI_UPDATE_CHUNK_SIZE", str(1024 * 1024))))
DEFAULT_CONTEXT_LIMIT = 128000
DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic"
LEGACY_DEEPSEEK_BASE_URLS = {
    "http://127.0.0.1:57322",
    "http://localhost:57322",
}
MODEL_OPTIONS = [
    {
        "id": "deepseek-v4-pro[1m]",
        "label": "DeepSeek V4 Pro",
        "description": "复杂编码与长上下文工作",
        "context": 1000000,
    },
    {
        "id": "deepseek-v4-flash",
        "label": "DeepSeek V4 Flash",
        "description": "更快完成日常工作",
        "context": 128000,
    },
]
SHELL_OPTIONS = [
    {
        "id": "claude-code",
        "label": "Claude Code",
        "description": "使用 Claude Code CLI 作为 Agent 执行壳。",
        "available": True,
    },
    {
        "id": "custom-cli",
        "label": "自定义 CLI",
        "description": "通过标准输入输出运行本地 Agent CLI，并从标准输入发送任务。",
        "available": True,
    },
]
LANGUAGE_OPTIONS = [
    {"id": "zh-CN", "label": "简体中文"},
    {"id": "en-US", "label": "English"},
]
THEME_OPTIONS = [
    {"id": "system", "label": "跟随系统"},
    {"id": "light", "label": "浅色"},
    {"id": "dark", "label": "深色"},
]
ACCENT_OPTIONS = [
    {"id": "viniper", "label": "Viniper"},
    {"id": "blue", "label": "Ocean"},
    {"id": "green", "label": "Forest"},
    {"id": "rose", "label": "Rose"},
]
FONT_SIZE_OPTIONS = [
    {"id": "xs", "label": "更小"},
    {"id": "sm", "label": "小"},
    {"id": "normal", "label": "标准"},
    {"id": "lg", "label": "大"},
    {"id": "xl", "label": "更大"},
]

MOJIBAKE_MARKERS = (
    "\ufffd",
    "\u00c2",
    "\u00c3",
    "\u00c5",
    "\u00c6",
    "\u00c7",
    "\u00c8",
    "\u00c9",
    "\u00e2",
    "\u00e4",
    "\u00e5",
    "\u00e6",
    "\u00e7",
    "\u00e8",
    "\u00e9",
    "\u00ef",
    "\u2018",
    "\u2019",
    "\u201c",
    "\u201d",
    "\u2026",
    "\u2030",
)
GBK_MOJIBAKE_MARKERS = (
    "\u59dd",
    "\u6d93",
    "\u95c7",
    "\u7039",
    "\u7487",
    "\u9359",
    "\u934f",
    "\u95c8",
    "\u7e43",
    "\u7eeb",
    "\u9365",
    "\u9436",
    "\u93b4",
    "\u951b",
    "\u951f",
    "\u69b4",
    "\u6fb6",
    "\u6fa7",
    "\u93c2",
)

APP_DIR = Path(__file__).resolve().parent
BASE_DIR = APP_DIR.parent
STATIC_DIR = APP_DIR / "static"
PROJECT_SKILLS_DIR = BASE_DIR / ".claude" / "skills"
PROJECT_SKILLS_DIRS = [
    Path.home() / ".claude" / "skills",
    PROJECT_SKILLS_DIR,
    APP_DIR / ".claude" / "skills",
    APP_DIR / ".agents" / "skills",
    BASE_DIR / ".agents" / "skills",
    Path.home() / ".codex" / "skills",
    Path.home() / ".agents" / "skills",
]
SKILL_SOURCE_ROOTS = [
    ("global-claude", Path.home() / ".claude" / "skills"),
    ("project-claude", PROJECT_SKILLS_DIR),
    ("project-app-claude", APP_DIR / ".claude" / "skills"),
    ("project-app-agents", APP_DIR / ".agents" / "skills"),
    ("project-agents", BASE_DIR / ".agents" / "skills"),
    ("global-codex", Path.home() / ".codex" / "skills"),
    ("global-agents", Path.home() / ".agents" / "skills"),
]
GOAL_SKILL_COMMAND = "dbs-goal"
USER_CLAUDE_SETTINGS = Path.home() / ".claude" / "settings.json"
LEGACY_DATA_DIR = APP_DIR / "data"


def platform_default_workspace_root() -> Path:
    configured = env_value("VINIPER_UI_DEFAULT_WORKSPACE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt":
        for letter in ("D", "C"):
            root = Path(f"{letter}:/")
            if root.exists() and root.is_dir():
                return root
    return Path.home()


def normalize_existing_dir(value: Any, fallback: Path | None = None) -> str:
    fallback_path = fallback or platform_default_workspace_root()
    text = str(value or "").strip()
    if not text:
        return str(fallback_path)
    path = Path(text).expanduser()
    try:
        if path.exists() and path.is_dir():
            return str(path.resolve())
    except Exception:
        pass
    return str(fallback_path)


def default_data_dir() -> Path:
    configured = env_value("VINIPER_UI_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    if PREVIEW_MODE:
        data_dir_name = str(PREVIEW_PROFILE.get("data_dir_name") or "Viniper Preview")
        if os.name == "nt":
            base = os.environ.get("APPDATA")
            if base:
                return Path(base) / data_dir_name
        if sys.platform == "darwin":
            return Path.home() / "Library" / "Application Support" / data_dir_name
        return Path.home() / ".local" / "share" / data_dir_name.lower().replace(" ", "-")
    if os.name == "nt":
        base = os.environ.get("APPDATA")
        if base:
            return Path(base) / "Viniper UI"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Viniper UI"
    return Path.home() / ".local" / "share" / "viniper-ui"


DATA_DIR = default_data_dir()
ATTACHMENTS_DIR = DATA_DIR / "attachments"
SESSIONS_FILE = DATA_DIR / "sessions.json"
AGENT_QUEUE_FILE = DATA_DIR / "runtime" / "agent-queue.json"
AGENT_RUN_JOURNAL_FILE = DATA_DIR / "runtime" / "agent-runs.json"
INTERACTION_STATE_FILE = DATA_DIR / "runtime" / "interaction-state.json"
GOALS_FILE = DATA_DIR / "goals.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
KNOWN_WORK_DIRS = [
    BASE_DIR,
]

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not PREVIEW_MODE:
        await asyncio.to_thread(refresh_windows_shortcuts)
    update_task = asyncio.create_task(runtime_update_coordinator().ensure_current(APP_VERSION))
    yield
    if _agent_run_coordinator is not None:
        await _agent_run_coordinator.shutdown()
    if not update_task.done():
        update_task.cancel()


app = FastAPI(title=APP_TITLE, lifespan=lifespan)
sessions: dict[str, dict[str, Any]] = {}
goals: dict[str, dict[str, Any]] = {}
_skills_cache: dict[str, Any] = {"time": 0.0, "items": []}
_skill_sync_cache: dict[str, Any] = {"time": 0.0, "target": "", "result": {}}
_skill_sync_statuses: dict[str, dict[str, str]] = {}
_skill_sync_lock = threading.Lock()
_session_locks: dict[str, asyncio.Lock] = {}
_active_runs: dict[str, dict[str, Any]] = {}
_chat_tasks: dict[str, asyncio.Task] = {}
_goal_tasks: dict[str, asyncio.Task] = {}
_context_lifecycle: ContextLifecycle | None = None
_agent_runtime: WslAgentRuntime | WindowsNativeRuntime | None = None
_runtime_provisioner: WslRuntimeProvisioner | None = None
_runtime_update_coordinator: RuntimeUpdateCoordinator | None = None
_agent_instructions_store: AgentInstructionsStore | None = None
_context_usage_ledger: ContextUsageLedger | None = None
_daily_usage_ledger: DailyUsageLedger | None = None
_agent_queue_store: AgentQueueStore | None = None
_agent_run_coordinator: AgentRunCoordinator | None = None
_agent_run_journal: AgentRunJournal | None = None
_durable_interaction_store: DurableInteractionStore | None = None
_native_peer_messaging: NativePeerMessaging = ClaudeCrossSessionAdapter()


def now_ts() -> float:
    return time.time()


def managed_runtime_location() -> Path:
    configured = env_value("VINIPER_UI_RUNTIME_LOCATION", "").strip()
    if configured:
        return Path(configured).expanduser()
    local_app_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    profile_name = str(PREVIEW_PROFILE.get("data_dir_name") or "Viniper Preview") if PREVIEW_MODE else "Viniper"
    return local_app_data / profile_name / "Runtime" / "ViniperRuntime"


def agent_runtime() -> WslAgentRuntime | WindowsNativeRuntime:
    global _agent_runtime
    if _agent_runtime is None:
        _agent_runtime = WslAgentRuntime()
    return _agent_runtime


def agent_run_coordinator() -> AgentRunCoordinator:
    global _agent_run_coordinator
    if _agent_run_coordinator is None:
        _agent_run_coordinator = AgentRunCoordinator(decode=sse_payloads)
    return _agent_run_coordinator


def agent_run_journal() -> AgentRunJournal:
    global _agent_run_journal
    expected = DATA_DIR / "runtime" / "agent-runs.json"
    if _agent_run_journal is None or _agent_run_journal.path != expected:
        _agent_run_journal = AgentRunJournal(expected)
    return _agent_run_journal


def durable_interaction_store() -> DurableInteractionStore:
    global _durable_interaction_store
    expected = DATA_DIR / "runtime" / "interaction-state.json"
    if _durable_interaction_store is None or _durable_interaction_store.path != expected:
        _durable_interaction_store = DurableInteractionStore(expected)
    return _durable_interaction_store


def runtime_provisioner() -> WslRuntimeProvisioner:
    global _runtime_provisioner
    if _runtime_provisioner is None:
        _runtime_provisioner = WslRuntimeProvisioner(
            runtime=agent_runtime(),
            state_path=DATA_DIR / "runtime" / "provision-state.json",
            install_location=managed_runtime_location(),
        )
    return _runtime_provisioner


def runtime_update_coordinator() -> RuntimeUpdateCoordinator:
    global _runtime_update_coordinator
    if _runtime_update_coordinator is None:
        _runtime_update_coordinator = RuntimeUpdateCoordinator(
            agent_runtime(),
            DATA_DIR / "runtime" / "update-state.json",
            lambda: {sid for sid, run in _active_runs.items() if run.get("kind") == "agent"},
        )
    return _runtime_update_coordinator


def runtime_payload_from_probe(probe: RuntimeProbe) -> dict[str, Any]:
    payload = probe.as_dict()
    payload["install_location"] = str(managed_runtime_location())
    payload["configured"] = probe.ready
    payload["update"] = runtime_update_coordinator().status()
    return payload


def runtime_public_status(*, refresh: bool = False) -> dict[str, Any]:
    runtime = agent_runtime()
    cached_probe = getattr(runtime, "cached_probe", None)
    probe = runtime.probe() if refresh else (cached_probe() if callable(cached_probe) else None)
    if probe is None:
        probe = RuntimeProbe(
            status="checking",
            detail="managed WSL runtime compatibility check is in progress",
        )
    return runtime_payload_from_probe(probe)


def agent_instructions_store() -> AgentInstructionsStore:
    global _agent_instructions_store
    if _agent_instructions_store is None:
        _agent_instructions_store = AgentInstructionsStore(DATA_DIR / "AGENT.md")
    return _agent_instructions_store


def read_agent_instructions() -> str:
    return agent_instructions_store().read().content


def context_usage_ledger() -> ContextUsageLedger:
    global _context_usage_ledger
    if _context_usage_ledger is None:
        _context_usage_ledger = ContextUsageLedger(DATA_DIR / "runtime" / "context-usage.json")
    return _context_usage_ledger


def context_usage_payload(session_id: str, model: str = "") -> dict[str, Any]:
    selected_model = allowed_model(model) if model else allowed_model("")
    return context_usage_ledger().get(
        session_id,
        model=selected_model,
        context_limit=context_limit_for_model(selected_model),
    ).as_dict()


def daily_usage_ledger() -> DailyUsageLedger:
    global _daily_usage_ledger
    if _daily_usage_ledger is None:
        _daily_usage_ledger = DailyUsageLedger(DATA_DIR / "runtime" / "daily-usage.json")
    return _daily_usage_ledger


def agent_queue_store() -> AgentQueueStore:
    global _agent_queue_store
    if _agent_queue_store is None:
        _agent_queue_store = AgentQueueStore(AGENT_QUEUE_FILE)
    return _agent_queue_store


def prepare_agent_host_channel(
    runtime: WslAgentRuntime | WindowsNativeRuntime,
    session_id: str,
    run_id: str,
) -> tuple[HostInteractionChannel, Path, Path | None]:
    safe_session_id = re.sub(r"[^A-Za-z0-9_-]", "-", str(session_id or "session"))[:80] or "session"
    root = DATA_DIR / "runtime" / "agent-host" / safe_session_id / str(run_id)
    channel = HostInteractionChannel(root, session_id=session_id, run_id=run_id)
    script_path = Path(__file__).resolve().with_name("agent_host_bridge.py")
    if isinstance(runtime, WslAgentRuntime):
        hook_script = runtime.map_path(script_path)
        hook_channel = runtime.map_path(root)
        settings_payload = build_passive_hook_settings()
        mcp_config_path: Path | None = root / "mcp-config.json"
        mcp_config_path.write_text(
            json.dumps(
                build_permission_prompt_mcp_config(
                    script_path=hook_script,
                    channel_path=hook_channel,
                ),
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    else:
        hook_script = str(script_path)
        hook_channel = str(root)
        settings_payload = build_hook_settings(script_path=hook_script, channel_path=hook_channel)
        mcp_config_path = None
    settings_path = root / "hook-settings.json"
    settings_path.write_text(
        json.dumps(settings_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return channel, settings_path, mcp_config_path


def _viniper_peer_runs() -> dict[str, dict[str, Any]]:
    return {
        str(session_id): {
            "claude_session_id": str(run.get("claude_session_id") or ""),
            "peer_name": str(run.get("peer_name") or ""),
            "display_name": str(run.get("display_name") or session_id),
        }
        for session_id, run in _active_runs.items()
        if run.get("kind") == "agent"
        and str(run.get("claude_session_id") or "")
        and str(run.get("peer_name") or "")
    }


async def native_peer_status_payload(session_id: str) -> dict[str, Any]:
    """Project native peer availability without creating a parallel mailbox."""

    sid = str(session_id)
    session = safe_session(sid)
    if normalize_session_mode(session.get("mode")) != "agent":
        return {
            "available": False,
            "verified": False,
            "reason": "Chat 不具备 Agent 跨会话能力",
            "discovery": "unavailable",
            "targets": [],
        }
    if is_custom_shell(load_app_settings().get("shell", {})):
        return {
            "available": False,
            "verified": False,
            "reason": "原生跨会话消息仅由受管 Claude Code WSL2 运行时提供",
            "discovery": "unavailable",
            "targets": [],
        }
    runtime_capabilities = await asyncio.to_thread(agent_runtime().capabilities)
    if runtime_capabilities.platform != "wsl2" or not runtime_capabilities.native_cli:
        return {
            "available": False,
            "verified": False,
            "reason": runtime_capabilities.reason or "原生跨会话消息需要受管 WSL2 Linux Claude Code 运行时",
            "discovery": "unavailable",
            "targets": [],
        }
    observed = _native_peer_messaging.capability_for(sid)
    if not observed.send_message:
        observed = _native_peer_messaging.best_capability()
    targets = _native_peer_messaging.reachable_targets(
        sid,
        _viniper_peer_runs(),
        current_session_id=sid,
    )
    roster_verified = bool(observed.available and _native_peer_messaging.roster_observed(sid))
    available = bool(roster_verified and targets)
    reason = observed.reason
    if observed.available and not roster_verified:
        reason = "当前会话尚未取得原生 ListAgents 可达会话列表"
    elif roster_verified and not targets:
        reason = "当前没有另一个真实运行且可达的 Viniper Agent 会话"
    return {
        **observed.as_dict(),
        "available": available,
        "verified": roster_verified,
        "reason": reason,
        "targets": targets,
    }


async def prepare_native_peer_request(
    sender_session_id: str,
    target_session_id: str,
    message: str,
) -> dict[str, str]:
    """Validate a native target against the live CLI registry."""

    status = await native_peer_status_payload(sender_session_id)
    target = next(
        (item for item in status.get("targets", []) if str(item.get("session_id")) == str(target_session_id)),
        None,
    )
    if not status.get("verified"):
        raise HTTPException(status_code=409, detail=status.get("reason") or "尚未验证原生 SendMessage 能力")
    if target is None:
        raise HTTPException(status_code=409, detail="目标 Viniper Agent 会话当前未运行或原生能力尚未验证")
    content = str(message or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="message is required")
    return {
        "target_session_id": str(target["session_id"]),
        "target_peer_name": str(target["peer_name"]),
        "target_display_name": str(target["display_name"]),
        "message": content,
    }


def decorate_peer_event(payload: dict[str, Any]) -> dict[str, Any]:
    """Attach safe Viniper identity to an incoming native peer event."""

    result = dict(payload)
    if result.get("type") != "peer_incoming":
        return result
    sender = str(result.get("sender") or "")
    for session_id, run in _viniper_peer_runs().items():
        if str(run.get("peer_name") or "") == sender:
            result["sender_session_id"] = session_id
            result["sender_display_name"] = str(run.get("display_name") or sender)
            break
    return result


def session_lock(session_id: str) -> asyncio.Lock:
    lock = _session_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _session_locks[session_id] = lock
    return lock


def force_release_session_lock(session_id: str) -> None:
    """Replace a held session lock so stuck waiters can proceed."""
    old = _session_locks.pop(session_id, None)
    if old is not None and old.locked():
        _session_locks[session_id] = asyncio.Lock()


def new_claude_session_id(value: Any = None) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        return str(uuid.uuid4())


def is_missing_claude_session_error(detail: str) -> bool:
    value = str(detail or "").lower()
    return (
        "no conversation found with session id" in value
        or "conversation not found" in value
        or "session not found" in value
    )


def is_claude_session_in_use_error(detail: str) -> bool:
    value = str(detail or "").lower()
    return "session id" in value and "already in use" in value


def normalize_session(session_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    last_run_status = str(raw.get("last_run_status") or "")
    if last_run_status not in {"running", "completed", "failed", "cancelled"}:
        last_run_status = ""
    configured_default = str(load_app_settings().get("runtime", {}).get("permission_mode") or DEFAULT_PERMISSION_MODE)
    if configured_default in {"ask", "manual"}:
        configured_default = "default"
    if configured_default not in PERMISSION_MODE_IDS or configured_default == "dontAsk":
        configured_default = "default"
    stored_permission_mode = str(raw.get("permission_mode") or configured_default)
    if stored_permission_mode in {"ask", "manual"}:
        stored_permission_mode = "default"
    if stored_permission_mode not in PERMISSION_MODE_IDS or stored_permission_mode == "dontAsk":
        stored_permission_mode = configured_default
    mode = normalize_session_mode(raw.get("mode"))
    normalized = {
        "id": str(raw.get("id") or session_id),
        "mode": mode,
        "messages": raw.get("messages") if isinstance(raw.get("messages"), list) else [],
        "created": float(raw.get("created") or now_ts()),
        "updated": float(raw.get("updated") or raw.get("created") or now_ts()),
        "name": str(raw.get("name") or ""),
        "workdir": str(raw.get("workdir") or BASE_DIR),
        "pinned": bool(raw.get("pinned")),
        "unread": bool(raw.get("unread")),
        "last_run_status": last_run_status,
        # Chat never resumes a Claude Code run. Preserve its stored value
        # exactly during startup migration instead of manufacturing an Agent
        # session identifier for an empty legacy field.
        "claude_session_id": (
            new_claude_session_id(raw.get("claude_session_id"))
            if mode == "agent"
            else str(raw.get("claude_session_id") or "")
        ),
        "claude_initialized": bool(raw.get("claude_initialized")),
        "summary": str(raw.get("summary") or ""),
    }
    # The v17 migration is intentionally narrow: only legacy Agent sessions
    # acquire the configured default. Chat sessions that predate the field are
    # left byte-semantically alone, while an already stored value is retained.
    if mode == "agent" or "permission_mode" in raw:
        normalized["permission_mode"] = stored_permission_mode
    # These user-owned collections may be present in older/newer compatible
    # session records. Normalization must not discard them during startup.
    for key in ("queue", "attachments"):
        if key in raw:
            normalized[key] = raw[key]
    return normalized


def session_sort_key(item: tuple[str, dict[str, Any]]) -> tuple[int, float, float, str]:
    """Return the deterministic order for the session list."""
    session_id, session = item
    return (
        0 if bool(session.get("pinned")) else 1,
        -float(session.get("updated", session.get("created", 0)) or 0),
        float(session.get("created", 0) or 0),
        str(session_id),
    )


def load_sessions_from_disk() -> dict[str, dict[str, Any]]:
    if not SESSIONS_FILE.exists():
        return {}
    try:
        raw = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}

    loaded: dict[str, dict[str, Any]] = {}
    for session_id, session in raw.items():
        if isinstance(session, dict):
            loaded[str(session_id)] = normalize_session(str(session_id), session)
    return loaded


def save_sessions_to_disk() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = SESSIONS_FILE.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(sessions, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(SESSIONS_FILE)


GOAL_STATUSES = {"running", "paused", "waiting", "completed", "failed"}
GOAL_DEFAULT_MAX_TURNS = 12
GOAL_MAX_TURNS_LIMIT = 100
GOAL_DONE_MARKER = "[VINIPER_GOAL_DONE]"
GOAL_CONTINUE_MARKER = "[VINIPER_GOAL_CONTINUE]"
GOAL_BETWEEN_TURN_DELAY_SECONDS = 2.5


def normalize_goal(goal_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    status = str(raw.get("status") or "paused")
    if status not in GOAL_STATUSES:
        status = "paused"
    max_turns = int(raw.get("max_turns") or GOAL_DEFAULT_MAX_TURNS)
    max_turns = min(GOAL_MAX_TURNS_LIMIT, max(1, max_turns))
    return {
        "id": str(raw.get("id") or goal_id),
        "session_id": str(raw.get("session_id") or ""),
        "title": str(raw.get("title") or "目标任务"),
        "prompt": str(raw.get("prompt") or ""),
        "status": status,
        "model": allowed_model(str(raw.get("model") or "")),
        "permission_mode": allowed_permission_mode(str(raw.get("permission_mode") or DEFAULT_PERMISSION_MODE)),
        "turn_count": max(0, int(raw.get("turn_count") or 0)),
        "max_turns": max_turns,
        "created": float(raw.get("created") or now_ts()),
        "updated": float(raw.get("updated") or raw.get("created") or now_ts()),
        "last_run": float(raw.get("last_run") or 0),
        "last_output": str(raw.get("last_output") or ""),
        "last_error": str(raw.get("last_error") or ""),
        "current_step": str(raw.get("current_step") or ""),
    }


def session_runtime_state(session_id: str, session: dict[str, Any] | None = None) -> str:
    coordinated = _agent_run_coordinator.snapshot(str(session_id)) if _agent_run_coordinator is not None else None
    if coordinated and coordinated.get("active"):
        if coordinated.get("status") == "awaiting_cli_ack":
            return "awaiting_cli_ack"
        if coordinated.get("pending_interaction") or coordinated.get("status") == "waiting_input":
            return "waiting_input"
        if coordinated.get("status") == "failed":
            return "failed"
        return "running"
    run = _active_runs.get(str(session_id))
    if run:
        if run.get("awaiting_interaction_ack"):
            return "awaiting_cli_ack"
        if run.get("pending_interaction"):
            return "waiting_input"
        if run.get("status") == "failed":
            return "failed"
        return "running"
    durable_interaction = agent_interaction_broker.pending_for(str(session_id))
    if durable_interaction:
        interaction_state = str(durable_interaction.get("interaction_state") or "pending")
        if interaction_state in {"response_committed", "awaiting_cli_ack"}:
            return "awaiting_cli_ack"
        if interaction_state == "failed":
            return "failed"
        if interaction_state in {"created", "pending", "answering", "waiting_input"}:
            return "waiting_input"
    if session and str(session.get("last_run_status") or "") == "failed":
        return "failed"
    if session and session.get("unread"):
        return "completed_unread"
    return "idle"


def coordinated_run_snapshot(session_id: str) -> dict[str, Any] | None:
    if _agent_run_coordinator is None:
        return None
    return _agent_run_coordinator.snapshot(str(session_id))


def pending_interaction_for_session(session_id: str) -> dict[str, Any] | None:
    snapshot = coordinated_run_snapshot(session_id)
    if snapshot and snapshot.get("active") and snapshot.get("pending_interaction"):
        return copy.deepcopy(snapshot["pending_interaction"])
    return agent_interaction_broker.pending_for(str(session_id))


def project_permission_denied_event(
    data: dict[str, Any],
    *,
    session_id: str,
    run_id: str,
    store: DurableInteractionStore | None = None,
) -> dict[str, Any]:
    """Persist and project one official permission_denied terminal event.

    The durable record and renderer event intentionally share the same
    tool-use identity and error content, so a rejected tool can never become a
    vanished card or an unmatched transcript row.
    """
    tool_use_id = str(data.get("tool_use_id") or "")
    message = clean_stream_text(str(
        data.get("message") or data.get("decision_reason") or "权限请求已被拒绝"
    ))
    projected = {
        "type": "tool_result",
        "tool_id": tool_use_id,
        "tool_use_id": tool_use_id,
        "status": "失败",
        "content": message,
        "permission_denied": True,
        "is_error": True,
    }
    denied_event = {
        **copy.deepcopy(data),
        "session_id": str(data.get("session_id") or session_id),
        "run_id": str(data.get("run_id") or run_id),
        "tool_result": {
            "tool_use_id": tool_use_id,
            "is_error": True,
            "content": message,
        },
    }
    if tool_use_id:
        (store or durable_interaction_store()).record_permission_denied(denied_event)
    return projected


def load_goals_from_disk() -> dict[str, dict[str, Any]]:
    if not GOALS_FILE.exists():
        return {}
    try:
        raw = json.loads(GOALS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}

    loaded: dict[str, dict[str, Any]] = {}
    for goal_id, goal in raw.items():
        if not isinstance(goal, dict):
            continue
        normalized = normalize_goal(str(goal_id), goal)
        if normalized["status"] == "running":
            normalized["status"] = "paused"
            normalized["last_error"] = f"{APP_TITLE} restarted while this goal was running."
        loaded[str(goal_id)] = normalized
    return loaded


def save_goals_to_disk() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = GOALS_FILE.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(goals, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(GOALS_FILE)


def default_settings() -> dict[str, Any]:
    return {
        "account": {
            "display_name": "Viniper 用户",
            "signed_in": False,
        },
        "appearance": {
            "language": "zh-CN",
            "theme": "system",
            "accent": "viniper",
            "font_size": "normal",
        },
        "shell": {
            "id": "claude-code",
            "custom_command": "",
            "custom_env": "",
        },
        "provider": {
            "id": "deepseek",
            "label": "DeepSeek",
            "base_url": DEFAULT_DEEPSEEK_BASE_URL,
            "api_key": "",
            "api_key_env": "ANTHROPIC_AUTH_TOKEN",
            "base_url_env": "ANTHROPIC_BASE_URL",
            "model_env": "ANTHROPIC_MODEL",
            "model": "deepseek-v4-pro[1m]",
            "models": MODEL_OPTIONS,
        },
        "desktop": {
            "open_at_login": False,
            "minimize_to_tray": True,
        },
        "workspace": {
            "default_root": str(platform_default_workspace_root()),
        },
        "runtime": {
            "kind": "wsl2",
            "cross_session_inbound": "permissions",
            "permission_mode": "default",
            "enable_auto_mode": False,
            "allow_bypass_permissions": False,
        },
    }


def merge_dict(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_dict(result[key], value)
        else:
            result[key] = value
    return result


def normalize_model_options(value: Any) -> list[dict[str, Any]]:
    raw_items = value if isinstance(value, list) else MODEL_OPTIONS
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        label = str(item.get("label") or model_id).strip()
        description = str(item.get("description") or "").strip()
        try:
            context = int(item.get("context") or DEFAULT_CONTEXT_LIMIT)
        except Exception:
            context = DEFAULT_CONTEXT_LIMIT
        normalized.append(
            {
                "id": model_id,
                "label": label,
                "description": description,
                "context": max(context, 8192),
            }
        )
    return normalized or [dict(item) for item in MODEL_OPTIONS]


def normalize_provider_base_url(provider_id: Any, value: Any) -> str:
    base_url = str(value or "").strip().rstrip("/")
    if str(provider_id or "").strip().lower() == "deepseek":
        if not base_url or base_url.lower() in LEGACY_DEEPSEEK_BASE_URLS:
            return DEFAULT_DEEPSEEK_BASE_URL
    return base_url or DEFAULT_DEEPSEEK_BASE_URL


def normalize_settings(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = merge_dict(default_settings(), raw or {})
    appearance = settings["appearance"]
    if appearance.get("language") not in {item["id"] for item in LANGUAGE_OPTIONS}:
        appearance["language"] = "zh-CN"
    if appearance.get("theme") not in {item["id"] for item in THEME_OPTIONS}:
        appearance["theme"] = "system"
    if appearance.get("accent") not in {item["id"] for item in ACCENT_OPTIONS}:
        appearance["accent"] = "viniper"
    if appearance.get("font_size") not in {item["id"] for item in FONT_SIZE_OPTIONS}:
        appearance["font_size"] = "normal"

    shell = settings["shell"]
    if shell.get("id") not in {item["id"] for item in SHELL_OPTIONS}:
        shell["id"] = "claude-code"
    shell["custom_command"] = str(shell.get("custom_command") or "").strip()
    shell["custom_env"] = str(shell.get("custom_env") or "").strip()

    provider = settings["provider"]
    provider["id"] = str(provider.get("id") or "custom").strip() or "custom"
    provider["label"] = str(provider.get("label") or provider["id"]).strip() or provider["id"]
    provider["base_url"] = normalize_provider_base_url(provider["id"], provider.get("base_url"))
    provider["api_key"] = str(provider.get("api_key") or "").strip()
    provider["api_key_env"] = str(provider.get("api_key_env") or "ANTHROPIC_AUTH_TOKEN").strip() or "ANTHROPIC_AUTH_TOKEN"
    provider["base_url_env"] = str(provider.get("base_url_env") or "ANTHROPIC_BASE_URL").strip() or "ANTHROPIC_BASE_URL"
    provider["model_env"] = str(provider.get("model_env") or "ANTHROPIC_MODEL").strip() or "ANTHROPIC_MODEL"
    provider["models"] = normalize_model_options(provider.get("models"))
    ids = {item["id"] for item in provider["models"]}
    if provider.get("model") not in ids:
        provider["model"] = provider["models"][0]["id"]

    workspace = settings.setdefault("workspace", {})
    workspace["default_root"] = normalize_existing_dir(workspace.get("default_root"), platform_default_workspace_root())
    runtime = settings.setdefault("runtime", {})
    runtime["kind"] = "wsl2"
    inbound = str(runtime.get("cross_session_inbound") or "permissions")
    runtime["cross_session_inbound"] = inbound if inbound in {"permissions", "accept", "hold", "reject"} else "permissions"
    permission_mode = str(runtime.get("permission_mode") or "default")
    if permission_mode in {"ask", "manual"}:
        permission_mode = "default"
    runtime["permission_mode"] = permission_mode if permission_mode in PERMISSION_MODE_IDS else "default"
    runtime["enable_auto_mode"] = bool(runtime.get("enable_auto_mode"))
    runtime["allow_bypass_permissions"] = bool(runtime.get("allow_bypass_permissions"))
    return settings


def load_app_settings() -> dict[str, Any]:
    if not SETTINGS_FILE.exists():
        return normalize_settings()
    try:
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    return normalize_settings(raw if isinstance(raw, dict) else {})


def save_app_settings(settings: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    normalized = normalize_settings(settings)
    tmp_path = SETTINGS_FILE.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(SETTINGS_FILE)


def provider_env_names(provider: dict[str, Any] | None = None) -> dict[str, str]:
    provider = provider if isinstance(provider, dict) else load_app_settings().get("provider", {})
    return {
        "api_key": str(provider.get("api_key_env") or "ANTHROPIC_AUTH_TOKEN").strip() or "ANTHROPIC_AUTH_TOKEN",
        "base_url": str(provider.get("base_url_env") or "ANTHROPIC_BASE_URL").strip() or "ANTHROPIC_BASE_URL",
        "model": str(provider.get("model_env") or "ANTHROPIC_MODEL").strip() or "ANTHROPIC_MODEL",
    }


def public_settings(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    safe = json.loads(json.dumps(settings or load_app_settings(), ensure_ascii=False))
    provider = safe.get("provider", {})
    api_key = str(provider.get("api_key") or "")
    provider["api_key"] = ""
    names = provider_env_names(provider)
    external_env = merged_env(include_app_settings=False)
    provider["api_key_configured"] = bool(
        api_key
        or external_env.get(names["api_key"])
        or external_env.get("ANTHROPIC_AUTH_TOKEN")
        or external_env.get("ANTHROPIC_API_KEY")
        or external_env.get("OPENAI_API_KEY")
    )
    return safe


def read_sessions_file(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def merge_session_files(source: Path, target: Path) -> None:
    source_data = read_sessions_file(source)
    if not source_data:
        return

    target_data = read_sessions_file(target) if target.exists() else {}
    changed = False
    for session_id, source_session in source_data.items():
        if not isinstance(source_session, dict):
            continue
        existing = target_data.get(session_id)
        if not isinstance(existing, dict):
            target_data[session_id] = source_session
            changed = True
            continue
        source_updated = float(source_session.get("updated") or source_session.get("created") or 0)
        existing_updated = float(existing.get("updated") or existing.get("created") or 0)
        if source_updated > existing_updated:
            target_data[session_id] = source_session
            changed = True

    if changed:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(target_data, ensure_ascii=False, indent=2), encoding="utf-8")


def migrate_legacy_data_dir() -> None:
    try:
        if LEGACY_DATA_DIR.resolve() == DATA_DIR.resolve():
            return
    except Exception:
        pass

    legacy_sessions = LEGACY_DATA_DIR / "sessions.json"
    if legacy_sessions.exists():
        merge_session_files(legacy_sessions, SESSIONS_FILE)

    legacy_attachments = LEGACY_DATA_DIR / "attachments"
    if legacy_attachments.exists() and legacy_attachments.is_dir():
        ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
        for item in legacy_attachments.iterdir():
            target = ATTACHMENTS_DIR / item.name
            if target.exists():
                continue
            if item.is_dir():
                shutil.copytree(item, target)
            elif item.is_file():
                shutil.copy2(item, target)


def format_bytes(size: int) -> str:
    value = float(max(size, 0))
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{int(size)} B"


def safe_attachment_filename(name: Any) -> str:
    original = Path(str(name or "attachment.bin")).name
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", original).strip(" ._")
    if not cleaned:
        cleaned = "attachment.bin"
    return cleaned[:120]


def normalize_image_block(block: Any, *, alt: str = "") -> dict[str, Any] | None:
    """Normalize only explicit supported image blocks; never infer images from text."""
    if not isinstance(block, dict) or str(block.get("type") or "") != "image":
        return None
    source = block.get("source") if isinstance(block.get("source"), dict) else None
    if source is not None and str(source.get("type") or "") not in {"", "base64"}:
        return None
    payload = source or block
    mime_type = str(
        payload.get("mimeType")
        or payload.get("mime_type")
        or payload.get("media_type")
        or block.get("mimeType")
        or block.get("mime_type")
        or ""
    ).strip().lower()
    if mime_type not in SUPPORTED_RENDER_IMAGE_MIME_TYPES:
        return None
    encoded = str(payload.get("data") or "").strip()
    if encoded.startswith("data:") and "," in encoded:
        header, encoded = encoded.split(",", 1)
        if mime_type not in header.lower() or ";base64" not in header.lower():
            return None
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except Exception:
        return None
    if not decoded or len(decoded) > MAX_RENDER_IMAGE_BYTES:
        return None
    return {
        "type": "image",
        "mime_type": mime_type,
        "data": base64.b64encode(decoded).decode("ascii"),
        "alt": str(alt or block.get("alt") or "图片")[:160],
    }


def local_artifact_image(path: Any, allowed_roots: list[Path]) -> dict[str, Any] | None:
    try:
        target = Path(str(path or "")).resolve()
        roots = [Path(root).resolve() for root in allowed_roots]
        if not target.is_file() or not any(target == root or target.is_relative_to(root) for root in roots):
            return None
        mime_type = IMAGE_SUFFIX_MIME_TYPES.get(target.suffix.lower())
        if not mime_type or target.stat().st_size > MAX_RENDER_IMAGE_BYTES:
            return None
        encoded = base64.b64encode(target.read_bytes()).decode("ascii")
        return normalize_image_block(
            {"type": "image", "mimeType": mime_type, "data": encoded},
            alt=target.name,
        )
    except (OSError, ValueError):
        return None


def save_chat_attachments(session_id: str, raw_items: Any) -> list[dict[str, Any]]:
    if not raw_items:
        return []
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=400, detail="attachments must be a list")

    target_dir = ATTACHMENTS_DIR / safe_attachment_filename(session_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, Any]] = []
    total_size = 0

    for index, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail=f"attachment {index} is invalid")

        original_name = str(item.get("name") or f"attachment-{index}.bin")
        mime_type = str(item.get("type") or "application/octet-stream")
        encoded = str(item.get("data") or "")
        if encoded.startswith("data:") and "," in encoded:
            encoded = encoded.split(",", 1)[1]

        try:
            content = base64.b64decode(encoded, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail=f"attachment {original_name} is not valid base64")

        if len(content) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail=f"attachment {original_name} is larger than {format_bytes(MAX_ATTACHMENT_BYTES)}")
        total_size += len(content)
        if total_size > MAX_ATTACHMENT_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail=f"attachments exceed {format_bytes(MAX_ATTACHMENT_TOTAL_BYTES)}")

        filename = f"{uuid.uuid4().hex[:10]}_{safe_attachment_filename(original_name)}"
        path = target_dir / filename
        path.write_bytes(content)
        saved.append({
            "name": original_name,
            "type": mime_type,
            "size": len(content),
            "filename": filename,
            "path": str(path.resolve()),
        })

    return saved


def attachment_display_lines(attachments: list[dict[str, Any]]) -> list[str]:
    return [
        f"[附件: {item.get('name')} · {format_bytes(int(item.get('size') or 0))} · {item.get('type') or 'application/octet-stream'}]"
        for item in attachments
    ]


def attachment_message_items(attachments: list[dict[str, Any]], session_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    safe_id = safe_attachment_filename(session_id)
    for item in attachments:
        message_item = {
            "name": item.get("name") or "attachment",
            "type": item.get("type") or "application/octet-stream",
            "size": int(item.get("size") or 0),
        }
        filename = str(item.get("filename") or "")
        if filename:
            message_item["url"] = f"/api/attachments/{safe_id}/{safe_attachment_filename(filename)}"
        items.append(message_item)
    return items


def append_attachment_prompt(prompt: str, attachments: list[dict[str, Any]]) -> str:
    if not attachments:
        return prompt

    lines = [
        "",
        "[本轮附件已由网页端保存为本机文件。不要把附件内容当作聊天文本；请按用户请求用 Claude Code 的 Read/Bash/相关工具解析这些文件。]",
        "附件列表：",
    ]
    has_image = False
    has_archive = False
    for item in attachments:
        name = str(item.get("name") or "attachment")
        mime_type = str(item.get("type") or "application/octet-stream")
        path = str(item.get("path") or "")
        size = format_bytes(int(item.get("size") or 0))
        suffix = Path(name).suffix.lower()
        has_image = has_image or mime_type.startswith("image/") or suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
        has_archive = has_archive or suffix in {".zip", ".tar", ".gz", ".tgz", ".tar.gz", ".7z", ".rar"}
        lines.append(f"- 原名: {name}; 类型: {mime_type}; 大小: {size}; 路径: {path}")

    if has_image:
        lines.append("图片附件请优先用 Read 工具查看图像内容，再根据用户问题回答。")
    if has_archive:
        lines.append("压缩包附件请先用合适命令列出内容，再按需解压到附件目录或工作目录中处理。")
    return f"{prompt.rstrip()}\n\n" + "\n".join(lines)


def read_update_source() -> dict[str, str]:
    source: dict[str, str] = {}
    if UPDATE_SOURCE_FILE.exists():
        try:
            raw = json.loads(UPDATE_SOURCE_FILE.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                source.update({str(k): str(v) for k, v in raw.items() if v})
        except Exception:
            pass
    if UPDATE_REPOSITORY_ENV:
        source["repository"] = UPDATE_REPOSITORY_ENV
    if UPDATE_MANIFEST_URL_ENV:
        source["manifest_url"] = UPDATE_MANIFEST_URL_ENV
    repository = source.get("repository", "").strip().strip("/")
    if repository and not source.get("manifest_url"):
        source["manifest_url"] = f"https://github.com/{repository}/releases/latest/download/latest.json"
    return source


def version_key(value: str) -> tuple[int, ...]:
    numbers = re.findall(r"\d+", str(value or ""))
    if not numbers:
        return (0,)
    return tuple(int(item) for item in numbers[:4])


def is_newer_version(candidate: str, current: str = APP_VERSION) -> bool:
    left = version_key(candidate)
    right = version_key(current)
    width = max(len(left), len(right))
    return left + (0,) * (width - len(left)) > right + (0,) * (width - len(right))


def fetch_json_url(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": f"ViniperUI/{APP_VERSION}"})
    with urllib.request.urlopen(request, timeout=UPDATE_HTTP_TIMEOUT_SECONDS) as response:
        raw = response.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("update manifest is not a JSON object")
    return data


def update_requires_installer(manifest: dict[str, Any]) -> bool:
    migration = manifest.get("migration") if isinstance(manifest.get("migration"), dict) else {}
    return bool(manifest.get("requires_installer") is True or migration.get("requires_installer") is True)


def _installer_asset(assets: Any) -> dict[str, Any] | None:
    if isinstance(assets, dict):
        for key in ("installer", "windows-installer", "nsis", "setup"):
            item = assets.get(key)
            if isinstance(item, dict) and item.get("url"):
                result = dict(item)
                result["key"] = key
                return result
        for key, item in assets.items():
            if not isinstance(item, dict) or not item.get("url"):
                continue
            name = str(item.get("name") or item.get("url") or "")
            if name.casefold().endswith(".exe"):
                result = dict(item)
                result["key"] = str(key)
                return result
    if isinstance(assets, list):
        for item in assets:
            if isinstance(item, dict) and str(item.get("name") or item.get("url") or "").casefold().endswith(".exe"):
                return dict(item)
    return None


def choose_update_asset(manifest: dict[str, Any], requested_asset: str | None = None) -> dict[str, Any]:
    assets = manifest.get("assets")
    if update_requires_installer(manifest):
        installer = _installer_asset(assets)
        if installer is None:
            raise ValueError("this update requires a full Windows installer, but the manifest has no installer asset")
        if requested_asset and str(installer.get("key") or "") != str(requested_asset):
            raise ValueError("this runtime migration cannot use a portable update asset")
        return installer
    if isinstance(assets, dict):
        if requested_asset and isinstance(assets.get(requested_asset), dict):
            return dict(assets[requested_asset])
        # In-app updates should prefer the small portable package. Full platform
        # installers are still published for manual downloads, but they are large
        # enough to fail more often on flaky GitHub/proxy connections.
        for key in ("app", "portable", "source", "zip"):
            item = assets.get(key)
            if isinstance(item, dict) and item.get("url"):
                item = dict(item)
                item["key"] = key
                return item
        system_name = platform.system().lower()
        preferred: list[str] = []
        if "darwin" in system_name:
            preferred.extend(["macos", "darwin"])
        elif "windows" in system_name:
            preferred.extend(["windows", "win"])
        elif "linux" in system_name:
            preferred.append("linux")
        for key in preferred:
            item = assets.get(key)
            if isinstance(item, dict) and item.get("url"):
                item = dict(item)
                item["key"] = key
                return item
        for key, item in assets.items():
            if isinstance(item, dict) and item.get("url"):
                item = dict(item)
                item["key"] = str(key)
                return item
    if isinstance(assets, list):
        for item in assets:
            if isinstance(item, dict) and item.get("url"):
                return dict(item)
    raise ValueError("update manifest has no downloadable asset")


def download_update_asset(asset: dict[str, Any], target_path: Path) -> None:
    url = str(asset.get("url") or "")
    if not url:
        raise ValueError("selected update asset has no url")

    expected_size = int(asset.get("size") or 0)
    if expected_size <= 0:
        raise ValueError("selected update asset has no positive size")
    part_path = target_path.with_name(f"{target_path.name}.part")
    last_error: Exception | None = None

    for attempt in range(max(1, UPDATE_DOWNLOAD_RETRIES)):
        downloaded = part_path.stat().st_size if part_path.exists() else 0
        headers = {"User-Agent": f"ViniperUI/{APP_VERSION}"}
        if downloaded > 0:
            headers["Range"] = f"bytes={downloaded}-"
        request = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(request, timeout=UPDATE_HTTP_TIMEOUT_SECONDS) as response:
                status = int(getattr(response, "status", response.getcode() or 200))
                if downloaded > 0 and status != 206:
                    downloaded = 0
                mode = "ab" if downloaded > 0 else "wb"
                with part_path.open(mode) as handle:
                    while True:
                        try:
                            chunk = response.read(UPDATE_DOWNLOAD_CHUNK_SIZE)
                        except http.client.IncompleteRead as exc:
                            if exc.partial:
                                handle.write(exc.partial)
                            raise
                        if not chunk:
                            break
                        handle.write(chunk)

            actual_size = part_path.stat().st_size
            if expected_size and actual_size != expected_size:
                raise ValueError(f"incomplete update download: {actual_size} of {expected_size} bytes")
            part_path.replace(target_path)
            return
        except Exception as exc:
            last_error = exc
            if attempt < UPDATE_DOWNLOAD_RETRIES - 1:
                time.sleep(min(2 ** attempt, 8))

    raise ValueError(f"download update failed after {UPDATE_DOWNLOAD_RETRIES} attempts: {last_error}")


def safe_extract_zip(zip_path: Path, target_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            destination = (target_dir / member.filename).resolve()
            if not str(destination).startswith(str(target_dir.resolve())):
                raise ValueError(f"unsafe zip entry: {member.filename}")
        archive.extractall(target_dir)


def find_update_app_root(extract_dir: Path) -> Path:
    candidates = [
        extract_dir / "viniper-ui",
        extract_dir / f"ViniperUI-{APP_VERSION}" / "viniper-ui",
    ]
    candidates.extend(path for path in extract_dir.rglob("viniper-ui") if path.is_dir())
    candidates.extend(path for path in [extract_dir] if (path / "server.py").exists())
    for candidate in candidates:
        if (candidate / "server.py").exists() and (candidate / "static").exists():
            return candidate
    raise ValueError("downloaded package does not contain Viniper app files")


def copy_update_tree(src: Path, dst: Path) -> None:
    batch = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    backup_dir = DATA_DIR / "update-backups" / batch
    staging_dir = DATA_DIR / "update-staging" / batch
    backup_dir.mkdir(parents=True, exist_ok=True)
    staging_dir.mkdir(parents=True, exist_ok=False)
    allowed_files = [
        "server.py", "context_lifecycle.py", "context_usage.py", "daily_usage.py", "skill_sync.py",
        "agent_instructions.py", "agent_runtime.py", "agent_host_bridge.py",
        "agent_queue.py", "agent_run_coordinator.py", "native_peer.py", "wsl_runtime.py",
        "profiles.json", "requirements.txt", "VERSION", "update_source.json", "start.bat",
    ]
    allowed_dirs = ["static", "scripts", ".agents"]
    required_runtime = [name for name in allowed_files if name.endswith(".py")]
    missing = [name for name in required_runtime if not (src / name).is_file()]
    if missing:
        raise ValueError(f"update package missing runtime modules: {', '.join(missing)}")

    for name in allowed_files:
        source = src / name
        if source.is_file():
            shutil.copy2(source, staging_dir / name)
    for name in allowed_dirs:
        source = src / name
        if source.is_dir():
            shutil.copytree(source, staging_dir / name)

    applied: list[str] = []
    try:
        for name in [*allowed_files, *allowed_dirs]:
            staged = staging_dir / name
            if not staged.exists():
                continue
            target = dst / name
            previous = backup_dir / name
            if target.exists():
                os.replace(target, previous)
            applied.append(name)
            os.replace(staged, target)
    except Exception:
        for name in reversed(applied):
            target = dst / name
            previous = backup_dir / name
            if target.exists():
                failed = backup_dir / f"failed-new-{name.replace('/', '_')}"
                os.replace(target, failed)
            if previous.exists():
                os.replace(previous, target)
        raise


def install_update_from_manifest(manifest: dict[str, Any], requested_asset: str | None = None) -> dict[str, Any]:
    asset = choose_update_asset(manifest, requested_asset)
    url = str(asset.get("url") or "")
    if not url:
        raise ValueError("selected update asset has no url")

    with tempfile.TemporaryDirectory(prefix="viniper-ui-update-") as tmp:
        tmp_dir = Path(tmp)
        package_path = tmp_dir / "update.zip"
        download_update_asset(asset, package_path)

        asset_name = str(asset.get("name") or package_path.name)
        if update_requires_installer(manifest) and not asset_name.lower().endswith(".exe"):
            raise ValueError("runtime migration requires the full Windows installer")
        if os.name == "nt" and asset_name.lower().endswith(".exe"):
            updates_dir = DATA_DIR / "updates"
            updates_dir.mkdir(parents=True, exist_ok=True)
            installer_path = updates_dir / safe_attachment_filename(asset_name)
            shutil.copy2(package_path, installer_path)
            subprocess.Popen([str(installer_path)], cwd=str(updates_dir), close_fds=True)
            return {
                "asset": asset,
                "installer": str(installer_path),
                "installer_opened": True,
                "requires_installer": update_requires_installer(manifest),
                "dependencies": "",
            }

        extract_dir = tmp_dir / "extract"
        extract_dir.mkdir()
        safe_extract_zip(package_path, extract_dir)
        update_root = find_update_app_root(extract_dir)
        copy_update_tree(update_root, APP_DIR)

    deps_output = ""
    requirements = APP_DIR / "requirements.txt"
    if requirements.exists():
        try:
            completed = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "-r", str(requirements)],
                cwd=str(APP_DIR),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=180,
                check=False,
            )
            deps_output = completed.stdout[-1200:] if completed.stdout else ""
        except Exception as exc:
            deps_output = f"dependency install skipped: {exc}"

    if os.name == "nt":
        refresh_windows_shortcuts()

    return {
        "asset": asset,
        "dependencies": deps_output,
        "restarting": True,
    }


def _schedule_restart() -> None:
    """Schedule a delayed restart of the server after the HTTP response is sent."""
    if os.name != "nt":
        return

    async def _restart():
        await asyncio.sleep(0.5)
        try:
            if env_value("VINIPER_UI_DESKTOP", "") == "1":
                pass
            else:
                start_script = APP_DIR / "start.bat"
                if start_script.exists():
                    subprocess.Popen(
                        ["cmd.exe", "/c", "start", "", "cmd", "/c", str(start_script)],
                        cwd=str(APP_DIR),
                        close_fds=True,
                    )
        except Exception:
            pass
        os._exit(0)

    try:
        asyncio.create_task(_restart())
    except Exception:
        pass


migrate_legacy_data_dir()
sessions.update(load_sessions_from_disk())


def next_session_name(mode: str = "agent") -> str:
    prefix = "新建聊天" if normalize_session_mode(mode) == "chat" else "新建会话"
    existing_numbers: set[int] = set()
    for session in sessions.values():
        existing_name = str(session.get("name") or "")
        match = re.fullmatch(rf"{re.escape(prefix)}（(\d+)）", existing_name)
        if match:
            existing_numbers.add(int(match.group(1)))

    number = 1
    while number in existing_numbers:
        number += 1
    return f"{prefix}（{number}）"


def remove_dir_inside(path: Path, base: Path) -> None:
    try:
        resolved = path.resolve()
        base_resolved = base.resolve()
        if resolved == base_resolved or not resolved.is_relative_to(base_resolved):
            return
        if resolved.exists() and resolved.is_dir():
            shutil.rmtree(resolved)
    except Exception:
        pass


def remove_session_runtime_data(session_id: str) -> None:
    safe_id = safe_attachment_filename(session_id)
    remove_dir_inside(ATTACHMENTS_DIR / safe_id, ATTACHMENTS_DIR)
    remove_dir_inside(DATA_DIR / "session-memory" / safe_id, DATA_DIR / "session-memory")


def safe_session(session_id: str) -> dict[str, Any]:
    if session_id not in sessions:
        sessions[session_id] = {
            "id": session_id,
            "mode": "agent",
            "messages": [],
            "created": now_ts(),
            "updated": now_ts(),
            "name": next_session_name("agent"),
            "workdir": str(BASE_DIR),
            "pinned": False,
            "unread": False,
            "last_run_status": "",
            "claude_session_id": str(uuid.uuid4()),
            "claude_initialized": False,
            "summary": "",
            "permission_mode": allowed_permission_mode(None),
        }
        save_sessions_to_disk()
    session = normalize_session(session_id, sessions[session_id])
    sessions[session_id] = session
    return session


def load_claude_settings() -> dict[str, Any]:
    if not USER_CLAUDE_SETTINGS.exists():
        return {}
    try:
        return json.loads(USER_CLAUDE_SETTINGS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def parse_env_lines(value: Any) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw_line in str(value or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, item = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        env[key] = item.strip().strip("\"'")
    return env


def merged_env(include_app_settings: bool = True) -> dict[str, str]:
    settings_env = load_claude_settings().get("env", {})
    result = {k: str(v) for k, v in settings_env.items() if v is not None}
    if include_app_settings:
        settings = load_app_settings()
        provider = settings.get("provider", {})
        names = provider_env_names(provider)
        api_key = str(provider.get("api_key") or "").strip()
        base_url = str(provider.get("base_url") or "").strip()
        model = str(provider.get("model") or "").strip()
        if api_key:
            result[names["api_key"]] = api_key
        if base_url:
            result[names["base_url"]] = base_url
        if model:
            result[names["model"]] = model
        result["VINIPER_PROVIDER"] = str(provider.get("id") or "")
        result["VINIPER_PROVIDER_LABEL"] = str(provider.get("label") or "")
        result["VINIPER_BASE_URL"] = base_url
        result["VINIPER_MODEL"] = model
        if api_key:
            result["VINIPER_API_KEY"] = api_key
        result.update(parse_env_lines(settings.get("shell", {}).get("custom_env", "")))
    extra_keys = []
    if include_app_settings:
        names = provider_env_names(load_app_settings().get("provider", {}))
        extra_keys.extend([names["api_key"], names["base_url"], names["model"]])
    for key in tuple(dict.fromkeys((
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "CLAUDE_CODE_SUBAGENT_MODEL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OPENAI_MODEL",
        *extra_keys,
    ))):
        if os.environ.get(key):
            result[key] = os.environ[key]
    return result


def effective_model_options() -> list[dict[str, Any]]:
    return normalize_model_options(load_app_settings().get("provider", {}).get("models"))


def allowed_model(model: str | None) -> str:
    models = effective_model_options()
    ids = {item["id"] for item in models}
    if model in ids:
        return str(model)
    app_model = str(load_app_settings().get("provider", {}).get("model") or "").strip()
    if app_model in ids:
        return app_model
    env_model = str(merged_env(include_app_settings=False).get("ANTHROPIC_MODEL") or "").strip()
    return env_model if env_model in ids else models[0]["id"]


def available_permission_mode_ids() -> set[str]:
    app_settings = load_app_settings()
    settings = app_settings.get("runtime", {})
    available = {"default", "acceptEdits", "plan"}
    provider = deepseek_config()
    provider_id = str(provider.get("provider") or "").strip().lower()
    provider_label = str(provider.get("label") or "").strip().lower()
    provider_url = str(provider.get("base_url") or "").strip().lower()
    provider_model = str(provider.get("model") or "").strip().lower()
    native_anthropic = (
        bool(app_settings.get("account", {}).get("signed_in"))
        and
        provider_id in {"anthropic", "claude"}
        and "deepseek" not in provider_label
        and (not provider_url or "api.anthropic.com" in provider_url)
        and (not provider_model or provider_model.startswith("claude"))
    )
    if bool(settings.get("enable_auto_mode")) and native_anthropic and agent_runtime().capabilities().auto_permission:
        available.add("auto")
    if bool(settings.get("allow_bypass_permissions")):
        available.add("bypassPermissions")
    return available


def allowed_permission_mode(permission_mode: str | None) -> str:
    value = str(permission_mode or "").strip()
    if value in {"ask", "manual"}:
        value = "default"
    settings = load_app_settings().get("runtime", {})
    available = available_permission_mode_ids()
    configured_default = str(settings.get("permission_mode") or DEFAULT_PERMISSION_MODE)
    if configured_default in {"ask", "manual"}:
        configured_default = "default"
    fallback = configured_default if configured_default in available else "default"
    return value if value in available else fallback


def require_permission_mode(permission_mode: str | None) -> str:
    value = str(permission_mode or "").strip()
    if value not in available_permission_mode_ids():
        raise HTTPException(status_code=400, detail="unknown permission_mode")
    return value


def session_permission_mode(session: dict[str, Any]) -> str:
    """Return the durable per-session Desktop permission mode, fail closed."""
    value = str(session.get("permission_mode") or "default")
    if value in available_permission_mode_ids():
        return value
    session["permission_mode"] = "default"
    return "default"


def provider_config(model_override: str | None = None) -> dict[str, str]:
    settings = load_app_settings()
    provider = settings.get("provider", {})
    names = provider_env_names(provider)
    env = merged_env(include_app_settings=False)
    api_key = (
        str(provider.get("api_key") or "").strip()
        or env.get(names["api_key"])
        or env.get("ANTHROPIC_AUTH_TOKEN")
        or env.get("ANTHROPIC_API_KEY")
        or env.get("OPENAI_API_KEY")
        or ""
    )
    base_url = (
        str(provider.get("base_url") or "").strip()
        or env.get(names["base_url"])
        or env.get("ANTHROPIC_BASE_URL")
        or env.get("OPENAI_BASE_URL")
        or DEFAULT_DEEPSEEK_BASE_URL
    )
    return {
        "provider": str(provider.get("id") or "custom"),
        "label": str(provider.get("label") or "Model Provider"),
        "api_key": api_key,
        "base_url": base_url.rstrip("/"),
        "model": allowed_model(model_override),
    }


def deepseek_config(model_override: str | None = None) -> dict[str, str]:
    return provider_config(model_override)


def messages_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/anthropic"):
        return f"{base}/v1/messages"
    if base.endswith("/anthropic/v1") or base.endswith("/v1"):
        return f"{base}/messages"
    return f"{base}/v1/messages"


def claude_launcher() -> list[str]:
    found = shutil.which("claude")
    candidates = [
        Path.home() / "AppData" / "Roaming" / "npm" / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe",
        Path(found) if found else None,
        Path.home() / "AppData" / "Roaming" / "npm" / "claude",
        Path.home() / "AppData" / "Roaming" / "npm" / "claude.cmd",
        Path.home() / "AppData" / "Roaming" / "npm" / "claude.ps1",
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            path = str(candidate)
            if path.lower().endswith((".cmd", ".bat")):
                return ["cmd.exe", "/d", "/c", path]
            if path.lower().endswith(".ps1"):
                return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path]
            return [path]
    return ["claude"]


def native_claude_available() -> bool:
    try:
        if shutil.which("claude"):
            return True
        candidates = [
            Path.home() / "AppData" / "Roaming" / "npm" / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe",
            Path.home() / "AppData" / "Roaming" / "npm" / "claude",
            Path.home() / "AppData" / "Roaming" / "npm" / "claude.cmd",
            Path.home() / "AppData" / "Roaming" / "npm" / "claude.ps1",
        ]
        return any(path.exists() for path in candidates)
    except Exception:
        return False


def claude_available() -> bool:
    return agent_runtime().probe().ready


def claude_cli_compatibility() -> dict[str, Any]:
    probe = agent_runtime().probe()
    return {
        "ok": probe.ready,
        "detail": probe.detail,
        "version": probe.version,
        "runtime": "wsl2",
        "capabilities": probe.capabilities.as_dict(),
        "native_migration_available": native_claude_available(),
    }


def current_windows_desktop_exe() -> Path | None:
    if os.name != "nt":
        return None
    configured = env_value("VINIPER_UI_DESKTOP_EXE", "").strip().strip('"')
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.exists() and candidate.is_file() and candidate.name.lower() in {"viniper.exe", "viniper ui.exe"}:
            return candidate.resolve()

    for root in (APP_DIR, *APP_DIR.parents):
        for executable_name in ("Viniper.exe", "Viniper UI.exe"):
            candidate = root / executable_name
            if candidate.exists() and candidate.is_file():
                return candidate.resolve()
    return None


def refresh_windows_shortcuts() -> None:
    if os.name != "nt" or PREVIEW_MODE:
        return
    icon = STATIC_DIR / "assets" / "viniper-icon.ico"
    installed_candidates = [
        current_windows_desktop_exe(),
        BASE_DIR / "Viniper.exe",
        BASE_DIR.parent / "Viniper.exe",
        Path("C:/Program Files/Viniper/Viniper.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Viniper" / "Viniper.exe",
        BASE_DIR / "Viniper UI.exe",
        BASE_DIR.parent / "Viniper UI.exe",
        Path("C:/Program Files/Viniper UI/Viniper UI.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Viniper UI" / "Viniper UI.exe",
    ]
    installed_candidates = [path for path in installed_candidates if path is not None]
    installed_exe = next((path for path in installed_candidates if path.exists()), installed_candidates[-1])
    start_script = APP_DIR / "start.bat"
    target_path = installed_exe if installed_exe.exists() else start_script
    if not target_path.exists():
        return

    icon_location = f"{target_path},0" if installed_exe.exists() else (f"{icon},0" if icon.exists() else "")
    desktop = Path.home() / "Desktop"
    start_menu = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    taskbar = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Internet Explorer" / "Quick Launch" / "User Pinned" / "TaskBar"
    ps = rf"""
$shell = New-Object -ComObject WScript.Shell
$target = '{str(target_path).replace("'", "''")}'
$workdir = '{str(target_path.parent).replace("'", "''")}'
$icon = '{icon_location.replace("'", "''")}'
$desktop = '{str(desktop).replace("'", "''")}'
$startMenu = '{str(start_menu).replace("'", "''")}'
$taskbar = '{str(taskbar).replace("'", "''")}'
function Update-ViniperShortcut($path) {{
  try {{
    $exists = Test-Path -LiteralPath $path
    $shortcut = $shell.CreateShortcut($path)
    $changed = -not $exists
    if ($shortcut.TargetPath -ne $target) {{
      $shortcut.TargetPath = $target
      $changed = $true
    }}
    if ($shortcut.WorkingDirectory -ne $workdir) {{
      $shortcut.WorkingDirectory = $workdir
      $changed = $true
    }}
    if ($icon -and $shortcut.IconLocation -ne $icon) {{
      $shortcut.IconLocation = $icon
      $changed = $true
    }}
    if ($changed) {{ $shortcut.Save() }}
  }} catch {{}}
}}
if (Test-Path -LiteralPath $desktop) {{
  Update-ViniperShortcut (Join-Path $desktop 'Viniper.lnk')
  Get-ChildItem -LiteralPath $desktop -Filter 'Viniper UI*.lnk' -ErrorAction SilentlyContinue |
    ForEach-Object {{ Update-ViniperShortcut $_.FullName }}
}}
if (Test-Path -LiteralPath $startMenu) {{
  Update-ViniperShortcut (Join-Path $startMenu 'Viniper.lnk')
}}
if (Test-Path -LiteralPath $taskbar) {{
  Get-ChildItem -LiteralPath $taskbar -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object {{ $_.Name -like 'Viniper*.lnk' }} |
    ForEach-Object {{ Update-ViniperShortcut $_.FullName }}
}}
"""
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=8,
            check=False,
        )
    except Exception:
        pass


def build_agent_env(cfg: dict[str, str] | None = None, session: dict[str, Any] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env.update(merged_env())
    cfg = cfg or provider_config()
    provider = load_app_settings().get("provider", {})
    names = provider_env_names(provider)
    env["VINIPER_PROVIDER"] = cfg.get("provider", "")
    env["VINIPER_PROVIDER_LABEL"] = cfg.get("label", "")
    env["VINIPER_BASE_URL"] = cfg.get("base_url", "")
    env["VINIPER_MODEL"] = cfg.get("model", "")
    if cfg.get("base_url"):
        env[names["base_url"]] = cfg["base_url"]
    if cfg.get("model"):
        env[names["model"]] = cfg["model"]
    if cfg.get("api_key"):
        env["VINIPER_API_KEY"] = cfg.get("api_key", "")
        env[names["api_key"]] = cfg["api_key"]
    if session:
        env["VINIPER_SESSION_ID"] = str(session.get("id") or "")
        env["VINIPER_WORKDIR"] = str(session.get("workdir") or "")
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def build_claude_env(cfg: dict[str, str] | None = None, session: dict[str, Any] | None = None) -> dict[str, str]:
    cfg = cfg or provider_config()
    env = build_agent_env(cfg, session)
    env["ANTHROPIC_BASE_URL"] = cfg.get("base_url", "")
    env["ANTHROPIC_MODEL"] = cfg.get("model", "")
    if cfg.get("api_key"):
        env["ANTHROPIC_AUTH_TOKEN"] = cfg["api_key"]
    env["NO_COLOR"] = "1"
    return env


def runtime_bridge_keys() -> tuple[str, ...]:
    names = provider_env_names(load_app_settings().get("provider", {}))
    return tuple(dict.fromkeys((
        names["api_key"],
        names["base_url"],
        names["model"],
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "CLAUDE_CODE_SUBAGENT_MODEL",
        "VINIPER_PROVIDER",
        "VINIPER_PROVIDER_LABEL",
        "VINIPER_BASE_URL",
        "VINIPER_MODEL",
        "VINIPER_API_KEY",
        "VINIPER_SESSION_ID",
        "VINIPER_WORKDIR",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
    )))


def active_shell_settings() -> dict[str, Any]:
    return load_app_settings().get("shell", {})


def active_shell_label(shell_id: str | None = None) -> str:
    value = shell_id or str(active_shell_settings().get("id") or "claude-code")
    for option in SHELL_OPTIONS:
        if option["id"] == value:
            return str(option.get("label") or value)
    return value


def is_custom_shell(settings: dict[str, Any] | None = None) -> bool:
    shell = settings if isinstance(settings, dict) else active_shell_settings()
    return str(shell.get("id") or "claude-code") == "custom-cli"


def shell_quote(value: Any) -> str:
    text = str(value)
    if os.name == "nt":
        return subprocess.list2cmdline([text])
    return shlex.quote(text)


def format_custom_command(template: str, cfg: dict[str, str], session: dict[str, Any], permission_mode: str) -> str:
    replacements = {
        "model": cfg.get("model", ""),
        "base_url": cfg.get("base_url", ""),
        "provider": cfg.get("provider", ""),
        "provider_label": cfg.get("label", ""),
        "workdir": str(session.get("workdir") or ""),
        "session_id": str(session.get("id") or ""),
        "permission_mode": permission_mode,
    }
    command = template
    for key, value in replacements.items():
        command = command.replace("{" + key + "}", shell_quote(value))
    return command


def build_generic_cli_prompt(
    session: dict[str, Any],
    prompt: str,
    attachments: list[dict[str, Any]],
    agent_instructions: str = "",
) -> str:
    history = []
    for message in list(session.get("messages", []))[-12:]:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "message")
        content = str(message.get("content") or "").strip()
        if content:
            history.append(f"{role}: {content}")
    parts = [
        f"You are running inside {APP_TITLE} as a thin wrapper around a user-selected agent shell.",
        "Use the current working directory and return concise progress plus final results.",
    ]
    system_append = build_system_append(session, agent_instructions)
    if system_append:
        parts.append(system_append)
    if history:
        parts.append("Recent conversation:\n" + "\n\n".join(history))
    parts.append("Current user message:\n" + append_attachment_prompt(prompt, attachments))
    return "\n\n".join(parts)


def build_system_append(session: dict[str, Any], agent_instructions: str = "") -> str:
    summary = str(session.get("summary") or "").strip()
    isolation_note = (
        f"当前 {APP_TITLE} 会话与其他会话隔离。只把本会话传入的历史摘要、当前工作目录和用户消息"
        "作为连续上下文；不要主动引用其他 UI 会话的记忆。"
    )
    stability_note = (
        "稳定性要求：遇到 docx、pdf、图片很多或输出很长的任务时，不要把完整文件内容、完整图片清单、"
        "大段日志或二进制内容直接打印到聊天里；优先用脚本在工作目录生成中间文件或最终文件，"
        "聊天里只返回简短摘要、关键路径和下一步。这样可以避免第三方模型网关在工具结果后卡住。"
    )
    parts = [isolation_note, stability_note]
    if summary:
        parts.append(f"以下是网页端压缩后的历史摘要，请在回答时保持连续性：{summary}")
    instructions = str(agent_instructions or "")
    if instructions.strip():
        parts.append(
            "以下是用户在 Viniper 全局 AGENT.md 中保存的自定义指令。"
            "它与工作目录中的 CLAUDE.md、AGENTS.md 可以同时生效；请在本次 Agent 工作中遵循：\n"
            f"{instructions}"
        )
    return "\n\n".join(parts)


def prepare_agent_system_prompt(session: dict[str, Any]) -> Path:
    """Read AGENT.md for this turn and materialize one private prompt file."""
    content = build_system_append(session, read_agent_instructions())
    prompt_dir = DATA_DIR / "runtime" / "prompts"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    session_token = safe_attachment_filename(str(session.get("id") or "session"))
    target = prompt_dir / f"{session_token}-{uuid.uuid4().hex}.md"
    temporary = target.with_suffix(".md.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(target)
    return target


def cleanup_agent_system_prompt(path: Path | str | None) -> None:
    if not path:
        return
    target = Path(path)
    prompt_dir = (DATA_DIR / "runtime" / "prompts").resolve()
    try:
        resolved = target.resolve()
        if resolved.parent == prompt_dir:
            resolved.unlink(missing_ok=True)
    except OSError:
        pass


def existing_workdir(value: str | None) -> Path:
    if value:
        path = Path(value)
        if path.exists() and path.is_dir():
            return path
    return BASE_DIR


FILE_CHANGE_SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "update-backups",
    "codex",
    "cache_data",
}
FILE_CHANGE_SKIP_SUFFIXES = {".pyc", ".pyo", ".tmp", ".temp", ".log"}
FILE_CHANGE_SCAN_LIMIT = 8000
FILE_CHANGE_RESULT_LIMIT = 12


def safe_resolve_path(path: Path) -> Path:
    try:
        return path.expanduser().resolve()
    except Exception:
        return path.expanduser()


def should_watch_file_root(path: Path) -> bool:
    root = safe_resolve_path(path)
    try:
        if not root.exists() or not root.is_dir():
            return False
        # Avoid scanning an entire drive such as D:\.
        if root.parent == root:
            return False
        if os.name == "nt" and re.fullmatch(r"[A-Za-z]:\\?", str(root)):
            return False
    except Exception:
        return False
    return True


def file_change_watch_roots(workdir: Path) -> list[Path]:
    roots: list[Path] = []

    def add(path: Path) -> None:
        root = safe_resolve_path(path)
        if should_watch_file_root(root) and root not in roots:
            roots.append(root)

    add(workdir)
    return roots


def iter_watch_files(root: Path, limit: int = FILE_CHANGE_SCAN_LIMIT):
    count = 0
    stack = [root]
    while stack and count < limit:
        current = stack.pop()
        try:
            entries = list(current.iterdir())
        except Exception:
            continue
        for entry in entries:
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if entry.name.casefold() not in FILE_CHANGE_SKIP_DIRS:
                        stack.append(entry)
                    continue
                if not entry.is_file() or entry.suffix.lower() in FILE_CHANGE_SKIP_SUFFIXES:
                    continue
                stat = entry.stat()
            except Exception:
                continue
            count += 1
            yield safe_resolve_path(entry), stat
            if count >= limit:
                break


def snapshot_watch_files(roots: list[Path]) -> dict[str, tuple[int, int]]:
    snapshot: dict[str, tuple[int, int]] = {}
    for root in roots:
        for path, stat in iter_watch_files(root):
            snapshot[str(path).lower()] = (int(getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))), int(stat.st_size))
    return snapshot


def changed_watch_files(before: dict[str, tuple[int, int]], roots: list[Path]) -> list[str]:
    changed: list[tuple[int, str]] = []
    seen: set[str] = set()
    for root in roots:
        for path, stat in iter_watch_files(root):
            key = str(path).lower()
            current = (int(getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))), int(stat.st_size))
            if key in seen or before.get(key) == current:
                continue
            seen.add(key)
            changed.append((current[0], str(path)))
    changed.sort(key=lambda item: item[0], reverse=True)
    return [path for _, path in changed[:FILE_CHANGE_RESULT_LIMIT]]


def directory_payload(path: Path) -> dict[str, str]:
    return {"path": str(path), "name": path.name or str(path)}


def filesystem_roots() -> list[dict[str, str]]:
    roots: list[Path] = []

    def add(path: Path) -> None:
        try:
            resolved = path.expanduser().resolve()
            if resolved.exists() and resolved.is_dir() and resolved not in roots:
                roots.append(resolved)
        except Exception:
            pass

    add(Path(load_app_settings().get("workspace", {}).get("default_root") or platform_default_workspace_root()))
    add(platform_default_workspace_root())
    add(BASE_DIR)
    add(Path.home())
    if os.name == "nt":
        for code in range(ord("A"), ord("Z") + 1):
            add(Path(f"{chr(code)}:/"))
    return [directory_payload(path) for path in roots]


def resolve_existing_directory(value: Any | None, fallback: Path | None = None) -> Path:
    path = Path(str(value or fallback or platform_default_workspace_root())).expanduser()
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail="directory does not exist")
    return resolved


def validate_folder_name(name: Any) -> str:
    value = str(name or "").strip().strip(". ")
    if not value:
        raise HTTPException(status_code=400, detail="folder name is required")
    if re.search(r'[<>:"/\\|?*\x00-\x1f]', value):
        raise HTTPException(status_code=400, detail="folder name contains invalid characters")
    return value[:120]


def agent_add_dirs(session: dict[str, Any], prompt: str, attachments: list[dict[str, Any]] | None = None) -> list[str]:
    paths: list[Path] = [existing_workdir(str(session.get("workdir") or ""))]
    paths.extend(path for path in KNOWN_WORK_DIRS if path.exists())
    for item in attachments or []:
        path = Path(str(item.get("path") or ""))
        if path.exists():
            paths.append(path.parent)

    # Let Claude Code touch obvious Windows paths named in the prompt.
    for drive in ("C", "D", "E"):
        token = f"{drive}:/"
        if token.lower() in prompt.lower():
            root = Path(f"{drive}:/")
            if root.exists():
                paths.append(root)

    result: list[str] = []
    seen: set[str] = set()
    for path in paths:
        try:
            resolved = str(path.resolve())
        except Exception:
            resolved = str(path)
        key = resolved.lower()
        if key not in seen:
            seen.add(key)
            result.append(resolved)
    skill_bridge = claude_skill_bridge_root()
    if skill_bridge and skill_bridge.lower() not in seen:
        result.append(skill_bridge)
    return result


def add_dir_args(session: dict[str, Any], prompt: str, attachments: list[dict[str, Any]] | None = None) -> list[str]:
    """Compatibility helper; AgentRuntime owns final CLI argument construction."""
    result: list[str] = []
    for directory in agent_add_dirs(session, prompt, attachments):
        result.extend(["--add-dir", directory])
    return result


def mojibake_score(text: str) -> int:
    if not text:
        return 0
    score = text.count("\ufffd") * 30
    score += sum(8 for ch in text if 0x80 <= ord(ch) <= 0x9F)
    for marker in MOJIBAKE_MARKERS:
        score += text.count(marker) * 2
    for marker in GBK_MOJIBAKE_MARKERS:
        score += text.count(marker) * 4
    return score


def repair_with_encoding(text: str, encoding: str) -> str | None:
    try:
        repaired = text.encode(encoding).decode("utf-8")
    except UnicodeError:
        return None
    return repaired if repaired != text else None


def clean_stream_text(value: str) -> str:
    text = str(value)
    score = mojibake_score(text)
    if score < 6:
        return text

    candidates = [text]
    for encoding in ("latin1", "cp1252", "gb18030", "gbk"):
        repaired = repair_with_encoding(text, encoding)
        if repaired:
            candidates.append(repaired)

    # Some terminal paths double-wrap mojibake. One extra pass is enough and
    # keeps normal multilingual text from being touched.
    for candidate in list(candidates[1:]):
        for encoding in ("latin1", "cp1252", "gb18030", "gbk"):
            repaired = repair_with_encoding(candidate, encoding)
            if repaired:
                candidates.append(repaired)

    best = min(candidates, key=lambda item: (mojibake_score(item), -len(item)))
    return best if mojibake_score(best) < score else text


def clean_payload_value(value: Any) -> Any:
    if isinstance(value, str):
        return clean_stream_text(value)
    if isinstance(value, list):
        return [clean_payload_value(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_payload_value(item) for key, item in value.items()}
    return value


def sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(clean_payload_value(payload), ensure_ascii=False)}\n\n"


class InteractionRequestError(RuntimeError):
    """A structured CLI interaction could not be safely matched or answered."""


def _control_display_text(value: Any, limit: int = 320) -> str:
    text = clean_stream_text(str(value or "")).strip()
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def _permission_display_payload(tool_input: dict[str, Any], summary: str = "") -> dict[str, str]:
    """Expose only short, user-action-relevant permission details to the renderer."""
    display: dict[str, str] = {}
    for key in ("command", "file_path", "path", "url"):
        value = _control_display_text(tool_input.get(key))
        if value:
            display[key] = value
    description = _control_display_text(tool_input.get("description") or summary)
    if description:
        display["description"] = description
    return display


def _question_answer_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, Any] = {}
    for key, answer in value.items():
        result[str(key)] = ", ".join(str(item) for item in answer) if isinstance(answer, list) else answer
    return result


def _control_request_body(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    body = payload.get("request")
    if isinstance(body, dict) and isinstance(body.get("request"), dict):
        body = body["request"]
    if not isinstance(body, dict):
        body = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if isinstance(body, dict) and isinstance(body.get("request"), dict):
        body = body["request"]
    return body if isinstance(body, dict) else {}


def normalize_control_request(payload: Any) -> dict[str, Any] | None:
    """Normalize only Claude's explicit structured control request envelopes.

    Plain assistant text is deliberately ignored. This function is the single
    server-side gate for inline questions and permission cards.
    """
    if not isinstance(payload, dict):
        return None
    event_type = str(payload.get("type") or "").strip().lower()
    nested = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    tool_name = str(payload.get("name") or payload.get("tool_name") or "")
    tool_input = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    structured_question_tool = (
        event_type in {"tool_start", "tool_use"}
        and tool_name.casefold() == "askuserquestion"
        and isinstance(tool_input.get("questions"), list)
    )
    if (
        event_type != "control_request"
        and str(nested.get("type") or "").strip().lower() != "control_request"
        and not structured_question_tool
    ):
        return None
    body = payload if structured_question_tool else _control_request_body(payload)
    subtype = "askuserquestion" if structured_question_tool else str(
        body.get("subtype")
        or body.get("request_type")
        or body.get("kind")
        or body.get("type")
        or payload.get("subtype")
        or ""
    ).strip().lower()
    request_id = str(
        payload.get("request_id")
        or payload.get("tool_id")
        or payload.get("id")
        or body.get("request_id")
        or nested.get("request_id")
        or ""
    ).strip()
    if not request_id:
        return None

    tool_name = str(body.get("tool_name") or body.get("name") or tool_name)
    question_input = body.get("input") if isinstance(body.get("input"), dict) else {}
    question_payload = body if isinstance(body.get("questions"), list) else question_input

    if subtype in {"askuserquestion", "ask_user_question", "question", "questions"} or (
        subtype == "can_use_tool"
        and tool_name.casefold() == "askuserquestion"
        and isinstance(question_payload.get("questions"), list)
    ):
        questions = question_payload.get("questions") if isinstance(question_payload.get("questions"), list) else []
        normalized_questions: list[dict[str, Any]] = []
        for question in questions:
            if not isinstance(question, dict):
                continue
            options = question.get("options") if isinstance(question.get("options"), list) else []
            normalized_questions.append({
                "question": clean_stream_text(str(question.get("question") or question.get("prompt") or "")),
                "header": clean_stream_text(str(question.get("header") or "")),
                "multiSelect": bool(question.get("multiSelect")),
                "options": [
                    {
                        "label": clean_stream_text(str(option.get("label") or "")),
                        "description": clean_stream_text(str(option.get("description") or "")),
                    }
                    for option in options if isinstance(option, dict) and str(option.get("label") or "").strip()
                ],
            })
        return {
            "type": "interaction_request",
            "kind": "question",
            "request_id": request_id,
            "questions": normalized_questions,
            "_original_questions": copy.deepcopy(questions),
            "_response_mode": "continuation" if structured_question_tool else "control_response",
            "allowed_actions": ["answer", "skip"] if structured_question_tool else ["answer"],
        }

    if subtype in {"can_use_tool", "permission", "permission_request", "tool_permission"}:
        raw_suggestions = body.get("permission_suggestions") or body.get("suggestions") or []
        permission_updates: list[dict[str, Any]] = []
        if isinstance(raw_suggestions, list):
            for item in raw_suggestions:
                if not isinstance(item, dict):
                    continue
                candidate = item.get("permission_update") if isinstance(item.get("permission_update"), dict) else item
                if not isinstance(candidate, dict) or not any(candidate.get(field) for field in ("destination", "type", "behavior", "rules")):
                    continue
                permission_updates.append(copy.deepcopy(candidate))
        tool_input = copy.deepcopy(body.get("input") if isinstance(body.get("input"), dict) else {})
        summary = clean_stream_text(str(body.get("description") or body.get("summary") or ""))
        allowed_actions = ["deny", "allow_once"]
        if permission_updates:
            allowed_actions.append("allow_always")
        return {
            "type": "interaction_request",
            "kind": "permission",
            "request_id": request_id,
            "tool_name": tool_name or "工具",
            "input": tool_input,
            "summary": summary,
            "display": _permission_display_payload(tool_input, summary),
            "_permission_updates": permission_updates,
            "allowed_actions": allowed_actions,
        }

    return None


def build_stream_json_user_envelope(prompt: str, session_id: str | None = None) -> dict[str, Any]:
    """Build the first NDJSON user event for a bidirectional CLI run."""
    envelope: dict[str, Any] = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": str(prompt or "")}],
        },
    }
    if session_id:
        envelope["session_id"] = str(session_id)
    return envelope


def build_control_response_envelope(record: dict[str, Any], action: str, answers: Any = None, value: Any = None) -> dict[str, Any]:
    kind = str(record.get("kind") or "")
    request_id = str(record.get("request_id") or "")
    if kind == "permission":
        if action == "deny":
            response = {"behavior": "deny", "message": "用户拒绝了本次操作"}
        elif action in {"allow_later", "allow_always"}:
            permission_updates = copy.deepcopy(record.get("_permission_updates") or [])
            if not permission_updates:
                response = {"behavior": "deny", "message": "当前请求没有可验证的后续权限规则"}
            else:
                response = {
                    "behavior": "allow",
                    "updatedInput": copy.deepcopy(record.get("input") or {}),
                    "updatedPermissions": permission_updates,
                }
        else:
            response = {"behavior": "allow", "updatedInput": copy.deepcopy(record.get("input") or {})}
        return {"type": "control_response", "request_id": request_id, "response": response}
    answer_value = _question_answer_map(copy.deepcopy(answers if answers is not None else value))
    original_questions = copy.deepcopy(record.get("_original_questions"))
    if not isinstance(original_questions, list):
        original_questions = copy.deepcopy(record.get("questions") or [])
    return {
        "type": "control_response",
        "request_id": request_id,
        "response": {
            "behavior": "allow",
            "updatedInput": {"questions": original_questions, "answers": answer_value},
        },
    }


def build_question_continuation_envelope(record: dict[str, Any], action: str, answers: Any = None) -> dict[str, Any]:
    """Resume a CLI stream that surfaced AskUserQuestion only as tool events."""
    answer_map = _question_answer_map(copy.deepcopy(answers))
    if action == "skip":
        guidance = (
            "[Viniper 问答续写] 用户选择跳过刚才的 AskUserQuestion。"
            "请在不再次输出该失败工具结果的情况下继续当前任务。"
        )
    else:
        guidance = (
            "[Viniper 问答续写] 用户已回答刚才的 AskUserQuestion。"
            f"精确答案：{json.dumps(answer_map, ensure_ascii=False, separators=(',', ':'))}。"
            "请沿用这些答案继续当前任务，不要重复提问，也不要解释问答桥接。"
        )
    return build_stream_json_user_envelope(guidance)


class ActiveAgentInputError(RuntimeError):
    """A same-run Agent input could not be written safely."""


class ActiveAgentInputChannel:
    """Serialize every NDJSON input written to one active Agent run."""

    def __init__(self, active_runs: Any) -> None:
        self._active_runs = active_runs

    def _runs(self) -> dict[str, dict[str, Any]]:
        runs = self._active_runs() if callable(self._active_runs) else self._active_runs
        return runs if isinstance(runs, dict) else {}

    @staticmethod
    def _lock_for(run: dict[str, Any]) -> asyncio.Lock:
        lock = run.get("input_lock")
        if lock is None:
            lock = asyncio.Lock()
            run["input_lock"] = lock
        return lock

    @staticmethod
    def _writer_is_closing(writer: Any) -> bool:
        probe = getattr(writer, "is_closing", None)
        if not callable(probe):
            return False
        try:
            return bool(probe())
        except Exception:
            return True

    async def write(
        self,
        session_id: str,
        run: dict[str, Any],
        envelope: dict[str, Any],
        *,
        process_identity: str = "",
    ) -> None:
        sid = str(session_id or "")
        if not sid or not isinstance(run, dict):
            raise ActiveAgentInputError("Agent 运行标识无效")
        lock = self._lock_for(run)
        async with lock:
            if self._runs().get(sid) is not run:
                raise ActiveAgentInputError("当前 Agent 任务已经结束，请重新发送")
            if run.get("kind") != "agent":
                raise ActiveAgentInputError("当前会话不是可引导的 Agent 任务")
            if process_identity and str(run.get("process_identity") or "") != str(process_identity):
                raise ActiveAgentInputError("Agent 输入不属于当前运行进程")
            writer = run.get("stdin")
            if writer is None or self._writer_is_closing(writer):
                raise ActiveAgentInputError("当前 Agent 输入通道已关闭，请重新发送")
            writer.write((json.dumps(envelope, ensure_ascii=False) + "\n").encode("utf-8"))
            drain = getattr(writer, "drain", None)
            if drain is not None:
                result = drain()
                if inspect.isawaitable(result):
                    await result

    async def send_guidance(self, session_id: str, message: str) -> dict[str, Any]:
        sid = str(session_id or "")
        text = str(message or "").strip()
        if not text:
            raise ActiveAgentInputError("运行中引导不能为空")
        run = self._runs().get(sid)
        if not isinstance(run, dict) or run.get("kind") != "agent":
            raise ActiveAgentInputError("当前会话没有正在运行的 Agent 任务")
        claude_session_id = str(run.get("claude_session_id") or "")
        if not claude_session_id:
            raise ActiveAgentInputError("当前 Agent 会话标识不可用")
        await self.write(
            sid,
            run,
            build_stream_json_user_envelope(text, claude_session_id),
            process_identity=str(run.get("process_identity") or ""),
        )
        return {"ok": True, "accepted": True, "queued": True, "session_id": sid}


active_agent_input_channel = ActiveAgentInputChannel(lambda: _active_runs)


def finalize_transcript_segments(segments: Any) -> list[dict[str, Any]]:
    """Persist completed activity/text while hiding transient thinking."""
    if not isinstance(segments, list):
        return []
    return [
        copy.deepcopy(segment)
        for segment in segments
        if isinstance(segment, dict) and str(segment.get("type") or "") != "thinking"
    ]


def persist_accepted_agent_turn(
    session_id: str,
    display_prompt: str,
    model: str,
    attachments: list[dict[str, Any]] | None = None,
) -> str:
    """Persist the accepted Agent turn before its SSE producer can fail."""
    session = safe_session(session_id)
    turn_id = str(uuid.uuid4())
    user_message: dict[str, Any] = {
        "role": "user",
        "content": str(display_prompt or ""),
        "turn_id": turn_id,
    }
    if attachments:
        user_message["attachments"] = attachment_message_items(attachments, session_id)
    assistant_message = {
        "role": "assistant",
        "content": "",
        "model": str(model or ""),
        "segments": [],
        "pending": True,
        "turn_id": turn_id,
    }
    session["messages"] = [
        *list(session.get("messages", [])),
        user_message,
        assistant_message,
    ]
    session["last_run_status"] = "running"
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()
    return turn_id


def finalize_accepted_agent_turn_failure(
    session_id: str,
    turn_id: str,
    detail: str,
    model: str = "",
) -> None:
    """Keep the user turn and replace its pending assistant with a retryable error."""
    session = safe_session(session_id)
    message: dict[str, Any] | None = None
    for candidate in reversed(session.get("messages", [])):
        if (
            isinstance(candidate, dict)
            and candidate.get("role") == "assistant"
            and str(candidate.get("turn_id") or "") == str(turn_id)
        ):
            message = candidate
            break
    if message is None:
        message = {"role": "assistant", "turn_id": str(turn_id)}
        session.setdefault("messages", []).append(message)
    content = str(detail or "Agent 请求失败")
    if not content.startswith("错误："):
        content = f"错误：{content}"
    message.update({
        "content": content,
        "model": str(model or message.get("model") or ""),
        "segments": [{"type": "text", "content": content}],
        "error": str(detail or "Agent 请求失败"),
        "retryable": True,
    })
    message.pop("pending", None)
    message.pop("thinking", None)
    session["last_run_status"] = "failed"
    session["unread"] = True
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()


def process_is_alive(pid: int) -> bool:
    value = int(pid or 0)
    if value <= 1:
        return False
    try:
        os.kill(value, 0)
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def reconcile_orphaned_agent_runs(
    session_records: dict[str, dict[str, Any]],
    *,
    journal: AgentRunJournal,
    runtime: Any,
    owner_alive: Any = process_is_alive,
    interaction_store: DurableInteractionStore | None = None,
    at: float | None = None,
) -> list[dict[str, Any]]:
    """Fail closed only journaled runs whose exact backend owner is gone."""
    results: list[dict[str, Any]] = []
    timestamp = float(at if at is not None else now_ts())
    failure_text = "运行 owner 已失效；任务中断，请求未执行。"
    for entry in journal.active():
        session_id = str(entry.get("session_id") or "")
        run_id = str(entry.get("coordinator_run_id") or "")
        owner_pid = int(entry.get("owner_pid") or 0)
        if owner_alive(owner_pid):
            results.append({"session_id": session_id, "run_id": run_id, "status": "owned"})
            continue
        try:
            cleaned = bool(runtime.cleanup_orphaned(
                str(entry.get("session_key") or ""),
                int(entry.get("runtime_pgid") or 0),
                int(entry.get("runtime_pid") or 0),
            ))
        except (OSError, ValueError):
            cleaned = False
        session = session_records.get(session_id)
        if isinstance(session, dict):
            message: dict[str, Any] | None = None
            for candidate in reversed(session.get("messages", [])):
                if isinstance(candidate, dict) and candidate.get("role") == "assistant" and candidate.get("pending"):
                    message = candidate
                    break
            if message is None:
                message = {"role": "assistant"}
                session.setdefault("messages", []).append(message)
            message.update({
                "content": failure_text,
                "segments": [{"type": "text", "content": failure_text}],
                "error": "owner_lost",
                "retryable": True,
            })
            message.pop("pending", None)
            message.pop("thinking", None)
            session["last_run_status"] = "failed"
            session["unread"] = True
            session["updated"] = timestamp
        if interaction_store is not None:
            try:
                interaction_store.fail_owner(session_id, run_id, reason=failure_text)
            except ValueError:
                pass
        journal.finish(session_id, run_id, status="failed")
        results.append({
            "session_id": session_id,
            "run_id": run_id,
            "status": "cleaned" if cleaned else "not_found",
        })
    return results


class AgentInteractionBroker:
    """Match one explicit CLI interaction to its same-run response channel."""

    def __init__(
        self,
        input_channel: ActiveAgentInputChannel | None = None,
        store_factory: Any = None,
        managed_channels_only: bool = False,
    ) -> None:
        self._pending: dict[str, dict[str, Any]] = {}
        self._input_channel = input_channel
        self._store_factory = store_factory
        self._managed_channels_only = bool(managed_channels_only)

    def _store(self) -> DurableInteractionStore | None:
        if self._store_factory is None:
            return None
        candidate = self._store_factory() if callable(self._store_factory) else self._store_factory
        return candidate if isinstance(candidate, DurableInteractionStore) else None

    @staticmethod
    def _public_record(record: dict[str, Any] | None) -> dict[str, Any] | None:
        if not record:
            return None
        safe_keys = {
            "type", "kind", "request_id", "tool_use_id", "session_id", "run_id",
            "tool_name", "summary", "workdir", "allowed_actions", "questions", "display",
            "agent_id", "response", "interaction_state", "terminal", "failure_message",
            "blocked_path", "decision_reason", "decision_reason_type", "title",
            "display_name", "description", "risk",
        }
        public = {key: copy.deepcopy(value) for key, value in record.items() if key in safe_keys}
        state = str(record.get("interaction_state") or record.get("state") or "")
        if state == "waiting_input":
            state = "pending"
        if state:
            public["interaction_state"] = state
        if state not in {"created", "pending"}:
            public["allowed_actions"] = []
        return public

    def pending_for(self, session_id: str) -> dict[str, Any] | None:
        store = self._store()
        if store is not None:
            durable = store.public_for_session(str(session_id))
            if durable is not None:
                return durable
        record = self._pending.get(str(session_id))
        if not record or str(record.get("state") or "waiting_input") not in {
            "waiting_input", "answering", "response_committed", "awaiting_cli_ack", "failed",
        }:
            return None
        return self._public_record(record)

    def unsettled_for(self, session_id: str) -> bool:
        sid = str(session_id)
        store = self._store()
        if store is not None and any(str(item.get("session_id") or "") == sid for item in store.active()):
            return True
        return sid in self._pending

    def _record_from_durable(self, session_id: str, request_id: str) -> dict[str, Any] | None:
        store = self._store()
        if store is None:
            return None
        durable = store.record_for(str(session_id), str(request_id))
        if not durable:
            return None
        private = durable.get("private") if isinstance(durable.get("private"), dict) else {}
        channel_path = str(durable.get("host_channel") or "")
        channel = HostInteractionChannel(channel_path) if channel_path else None
        return {
            "type": "interaction_request",
            "kind": str(durable.get("kind") or ""),
            "request_id": str(durable.get("request_id") or ""),
            "tool_use_id": str(durable.get("tool_use_id") or durable.get("request_id") or ""),
            "bridge_request_id": str(durable.get("bridge_request_id") or ""),
            "session_id": str(durable.get("session_id") or ""),
            "run_id": str(durable.get("run_id") or ""),
            "process_identity": str(durable.get("process_identity") or ""),
            "tool_name": str(durable.get("tool_name") or ""),
            "questions": copy.deepcopy(durable.get("questions") or []),
            "_original_questions": copy.deepcopy(private.get("original_questions") or []),
            "_tool_input": copy.deepcopy(private.get("tool_input") or {}),
            "_permission_suggestions": copy.deepcopy(private.get("permission_suggestions") or []),
            "display": copy.deepcopy(durable.get("display") or {}),
            "summary": str(durable.get("summary") or ""),
            "workdir": str(durable.get("workdir") or ""),
            "allowed_actions": copy.deepcopy(durable.get("allowed_actions") or []),
            "_response_mode": str(durable.get("response_mode") or "host_hook"),
            "_committed_response": copy.deepcopy(durable.get("response") or {}),
            "_committed_action": str(durable.get("action") or ""),
            "_host_channel": channel,
            "state": str(durable.get("state") or ""),
        }

    def _persist_host_request(self, record: dict[str, Any], channel: HostInteractionChannel) -> None:
        store = self._store()
        if store is None:
            return
        if self._managed_channels_only:
            try:
                channel.root.resolve().relative_to((DATA_DIR / "runtime" / "agent-host").resolve())
            except ValueError:
                return
        run_id = str(record.get("run_id") or channel.run_id or "").strip()
        if not run_id:
            raise ValueError("host interaction is missing its run identity")
        # ``record`` also owns live runtime objects (the active run, stdin,
        # locks and the channel instance).  Persist the immutable protocol
        # envelope only; attempting to deepcopy the whole record reaches
        # asyncio Futures on real WSL runs and aborts before the card appears.
        durable_entry = {
            key: value
            for key, value in record.items()
            if key not in {
                "_run", "_host_channel", "_channel", "stdin", "_input_lock",
            }
        }
        created = store.create({
            **durable_entry,
            "run_id": run_id,
            "host_channel": str(channel.root),
            "response_mode": str(record.get("_response_mode") or "host_hook"),
        })
        if str(created.get("state") or "") == "created":
            store.mark_pending(str(record.get("session_id") or ""), str(record.get("request_id") or ""))

    def ack_status_for(self, session_id: str) -> dict[str, Any] | None:
        record = self._pending.get(str(session_id))
        if record is None:
            store = self._store()
            durable = store.latest_for_session(str(session_id)) if store is not None else None
            if durable and str(durable.get("state") or "") in {"response_committed", "awaiting_cli_ack"}:
                record = self._record_from_durable(session_id, str(durable.get("request_id") or ""))
        if not record or str(record.get("_response_mode") or "") not in {
            "host_hook", "permission_prompt_mcp",
        }:
            return None
        channel = record.get("_host_channel")
        if not isinstance(channel, HostInteractionChannel):
            return None
        status = channel.acknowledgement(str(record.get("bridge_request_id") or ""))
        status["session_id"] = str(record.get("session_id") or "")
        status["request_id"] = str(record.get("request_id") or "")
        status["state"] = str(record.get("state") or "waiting_input")
        self._sync_durable_ack(record, status)
        return status

    def _sync_durable_ack(self, record: dict[str, Any], acknowledgement: dict[str, Any]) -> None:
        store = self._store()
        if store is None:
            return
        session_id = str(record.get("session_id") or "")
        request_id = str(record.get("request_id") or "")
        if not session_id or not request_id:
            return
        for stage in (
            "response_committed", "response_read", "stdout_written_and_flushed",
            MCP_RESPONSE_ACK_STAGE, "hook_exit",
        ):
            if not acknowledgement.get(stage):
                continue
            try:
                store.record_ack(
                    session_id,
                    request_id,
                    stage,
                    exit_code=(acknowledgement.get("hook_exit_code") if stage == "hook_exit" else None),
                )
            except ValueError:
                continue

    def expire_unacknowledged(self, *, now: float | None = None, timeout_seconds: float) -> list[dict[str, str]]:
        current = float(now if now is not None else time.time())
        expired: list[dict[str, str]] = []
        for sid, record in list(self._pending.items()):
            if str(record.get("state") or "") != "awaiting_cli_ack":
                continue
            if current - float(record.get("response_committed_at") or current) < max(0.01, float(timeout_seconds)):
                continue
            request_id = str(record.get("request_id") or "")
            bound_run = record.get("_run")
            if isinstance(bound_run, dict):
                bound_run["pending_interaction"] = None
                bound_run["awaiting_interaction_ack"] = None
                bound_run["interaction_failure"] = "cli_ack_timeout"
            channel = record.get("_host_channel")
            if isinstance(channel, HostInteractionChannel):
                channel.finalize("timeout", reason="cli_ack_timeout")
            store = self._store()
            if store is not None:
                try:
                    store.fail_owner(
                        sid,
                        str(record.get("run_id") or ""),
                        reason="Claude 未确认本次交互；请求未执行。",
                    )
                except ValueError:
                    pass
            self._pending.pop(sid, None)
            expired.append({"session_id": sid, "request_id": request_id, "reason": "cli_ack_timeout"})
        return expired

    def confirm_cli_tool_result(self, session_id: str, request_id: str, *, success: bool) -> dict[str, Any] | None:
        sid = str(session_id)
        record = self._pending.get(sid)
        if not record or str(record.get("state") or "") != "awaiting_cli_ack":
            return None
        if str(record.get("request_id") or "") != str(request_id):
            return None
        channel = record.get("_host_channel")
        if not isinstance(channel, HostInteractionChannel):
            return None
        bridge_id = str(record.get("bridge_request_id") or "")
        channel.record_cli_tool_result(bridge_id, str(request_id), success=bool(success))
        response_mode = str(record.get("_response_mode") or "")
        store = self._store()
        durable = store.record_for(sid, str(request_id)) if store is not None else None
        committed_response = record.get("_committed_response")
        if not isinstance(committed_response, dict) and isinstance(durable, dict):
            committed_response = durable.get("response")
        response_behavior = DurableInteractionStore.response_behavior(committed_response)
        expected_tool_result_success = response_behavior != "deny"
        deadline = time.monotonic() + 0.25
        while True:
            acknowledgement = channel.acknowledgement(bridge_id)
            if response_mode == "permission_prompt_mcp":
                protocol_ready = all(bool(acknowledgement.get(stage)) for stage in (
                    "response_committed", "response_read", MCP_RESPONSE_ACK_STAGE,
                ))
            else:
                protocol_ready = all(bool(acknowledgement.get(stage)) for stage in (
                    "response_committed", "response_read", "stdout_written_and_flushed", "hook_exit",
                )) and int(acknowledgement.get("hook_exit_code") or 0) == 0
            if protocol_ready or time.monotonic() >= deadline:
                break
            time.sleep(0.005)
        tool_result_matches = bool(success) == expected_tool_result_success
        accepted = bool(protocol_ready and tool_result_matches)
        self._sync_durable_ack(record, acknowledgement)
        if store is not None:
            try:
                store.record_ack(
                    sid,
                    str(request_id),
                    "cli_tool_result",
                    success=bool(success),
                )
            except ValueError:
                pass
        bound_run = record.get("_run")
        if isinstance(bound_run, dict):
            bound_run["pending_interaction"] = None
            bound_run["awaiting_interaction_ack"] = None
            if not accepted:
                bound_run["interaction_failure"] = "cli_tool_result_mismatch" if not tool_result_matches else "cli_ack_incomplete"
        self._pending.pop(sid, None)
        terminal_state = "denied" if response_behavior == "deny" and accepted else ("accepted" if accepted else "failed")
        return {
            "session_id": sid,
            "request_id": str(request_id),
            "accepted": accepted,
            "success": bool(success),
            "terminal_state": terminal_state,
            "acknowledgement": acknowledgement,
            "reason": "" if accepted else ("cli_tool_result_mismatch" if not tool_result_matches else "cli_ack_incomplete"),
        }

    def create_request(
        self,
        session_id: str,
        process_identity: str,
        payload: Any,
        stdin: Any = None,
        workdir: str = "",
        run: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        normalized = normalize_control_request(payload)
        if normalized is None:
            return None
        sid = str(session_id)
        request_id = str(normalized["request_id"])
        existing = self._pending.get(sid)
        if existing and existing.get("request_id") == request_id:
            if str(existing.get("process_identity")) != str(process_identity):
                return None
            if stdin is not None:
                existing["stdin"] = stdin
            if run is not None:
                existing["_run"] = run
            return self._public_record(existing) or {}
        if existing:
            return None
        record = {
            **normalized,
            "session_id": sid,
            "process_identity": str(process_identity),
            "workdir": str(workdir or ""),
            "stdin": stdin,
            "_run": run,
            "_input_lock": asyncio.Lock(),
            "payload": copy.deepcopy(payload),
            "state": "waiting_input",
            "created": now_ts(),
        }
        self._pending[sid] = record
        return self.pending_for(sid) or {}

    def create_host_request(
        self,
        session_id: str,
        process_identity: str,
        normalized: dict[str, Any],
        channel: HostInteractionChannel,
        *,
        workdir: str = "",
        run: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if not isinstance(normalized, dict) or normalized.get("type") != "interaction_request":
            return None
        request_id = str(normalized.get("request_id") or "").strip()
        bridge_request_id = str(normalized.get("bridge_request_id") or "").strip()
        if not request_id or not bridge_request_id:
            return None
        sid = str(session_id)
        owner_mode = (
            "permission_prompt_mcp"
            if str(normalized.get("_transport") or "") == "permission_prompt_mcp"
            else "host_hook"
        )
        existing = self._pending.get(sid)
        if existing and str(existing.get("request_id")) == request_id:
            if str(existing.get("process_identity")) != str(process_identity):
                return None
            if str(existing.get("_response_mode") or "") in {"host_hook", "permission_prompt_mcp"}:
                return self._public_record(existing) or {}
            if str(existing.get("state") or "waiting_input") != "waiting_input":
                return None
            # The official owner wins if it arrives during the bounded stdout
            # compatibility grace window without creating a second card.
            display = copy.deepcopy(normalized.get("display_payload") or {})
            channel.bind_process_identity(str(process_identity))
            try:
                channel.record_interaction(
                    bridge_request_id,
                    request_id,
                    str(normalized.get("kind") or ""),
                    str(normalized.get("tool_name") or ""),
                )
            except FileExistsError:
                pass
            normalized_copy = {
                key: copy.deepcopy(value)
                for key, value in normalized.items()
                if key != "_channel"
            }
            replacement = {
                **normalized_copy,
                "display": display,
                "session_id": sid,
                "process_identity": str(process_identity),
                "workdir": str(workdir or normalized.get("workdir") or ""),
                "_run": run or existing.get("_run"),
                "_response_mode": owner_mode,
                "_host_channel": channel,
                "state": "waiting_input",
                "created": existing.get("created") or now_ts(),
            }
            replacement["run_id"] = str(normalized.get("run_id") or channel.run_id or "")
            self._pending[sid] = replacement
            try:
                self._persist_host_request(replacement, channel)
            except ValueError:
                self._pending.pop(sid, None)
                return None
            return self.pending_for(sid) or {}
        if existing:
            return None
        display = copy.deepcopy(normalized.get("display_payload") or {})
        channel.bind_process_identity(str(process_identity))
        try:
            channel.record_interaction(
                bridge_request_id,
                request_id,
                str(normalized.get("kind") or ""),
                str(normalized.get("tool_name") or ""),
            )
        except FileExistsError:
            pass
        normalized_copy = {
            key: copy.deepcopy(value)
            for key, value in normalized.items()
            if key != "_channel"
        }
        record = {
            **normalized_copy,
            "display": display,
            "session_id": sid,
            "process_identity": str(process_identity),
            "workdir": str(workdir or normalized.get("workdir") or ""),
            "_run": run,
            "_response_mode": owner_mode,
            "_host_channel": channel,
            "state": "waiting_input",
            "created": now_ts(),
        }
        record["run_id"] = str(normalized.get("run_id") or channel.run_id or "")
        self._pending[sid] = record
        try:
            self._persist_host_request(record, channel)
        except ValueError:
            self._pending.pop(sid, None)
            return None
        return self.pending_for(sid) or {}

    async def resolve(
        self,
        session_id: str,
        request_id: str,
        kind: str,
        action: str,
        *,
        stdin: Any = None,
        run: dict[str, Any] | None = None,
        process_identity: str = "",
        answers: Any = None,
        value: Any = None,
    ) -> dict[str, Any]:
        sid = str(session_id)
        record = self._pending.get(sid)
        if record is None:
            record = self._record_from_durable(sid, str(request_id))
        if not record:
            raise InteractionRequestError("interaction request is stale or already answered")
        if str(record.get("request_id")) != str(request_id) or str(record.get("kind")) != str(kind):
            raise InteractionRequestError("interaction request does not match the active request")
        if process_identity and str(record.get("process_identity")) != str(process_identity):
            raise InteractionRequestError("interaction request belongs to another process")
        allowed = {str(item) for item in record.get("allowed_actions") or []}
        if action not in allowed and not (kind == "question" and action in {"answer", "submit"}):
            raise InteractionRequestError("interaction action is not allowed")
        owner_mode = str(record.get("_response_mode") or "")
        if owner_mode in {"host_hook", "permission_prompt_mcp"}:
            try:
                normalized_action = "answer" if kind == "question" and action in {"answer", "submit"} else action
                if owner_mode == "permission_prompt_mcp":
                    response = build_permission_prompt_response(
                        record, normalized_action, answers=answers, value=value,
                    )
                else:
                    response = build_hook_response(
                        record, normalized_action, answers=answers, value=value,
                    )
                channel = record.get("_host_channel")
                if not isinstance(channel, HostInteractionChannel):
                    raise InteractionRequestError("interaction host channel is unavailable")
                store = self._store()
                durable_before = store.record_for(sid, str(request_id)) if store is not None else None
                if durable_before and str(durable_before.get("state") or "") in {"accepted", "denied", "cancelled", "failed", "terminal"}:
                    raise InteractionRequestError("interaction request is no longer answerable")
                if store is not None and str((durable_before or {}).get("state") or "") in {"created", "pending"}:
                    store.begin_answer(sid, str(request_id))
                channel.respond(str(record.get("bridge_request_id") or ""), response, action=action)
                if store is not None and durable_before is not None:
                    store.commit_response(sid, str(request_id), action=normalized_action, response=response)
                    store.mark_awaiting_cli_ack(sid, str(request_id))
                record["_committed_response"] = copy.deepcopy(response)
                record["_committed_action"] = normalized_action
                record["state"] = "awaiting_cli_ack"
                record["response_committed_at"] = time.time()
            except (FileExistsError, OSError, ValueError) as exc:
                raise InteractionRequestError(str(exc)) from exc
        elif kind == "question" and record.get("_response_mode") == "continuation":
            envelope = build_question_continuation_envelope(record, action, answers)
        else:
            envelope = build_control_response_envelope(record, "answer" if kind == "question" else action, answers, value)
        if owner_mode not in {"host_hook", "permission_prompt_mcp"}:
            active_run = run or record.get("_run")
            if self._input_channel is not None and isinstance(active_run, dict):
                try:
                    await self._input_channel.write(
                        sid,
                        active_run,
                        envelope,
                        process_identity=process_identity or str(record.get("process_identity") or ""),
                    )
                except ActiveAgentInputError as exc:
                    raise InteractionRequestError(str(exc)) from exc
            else:
                writer = stdin or record.get("stdin")
                if writer is None:
                    raise InteractionRequestError("interaction process stdin is unavailable")
                async with record["_input_lock"]:
                    writer.write((json.dumps(envelope, ensure_ascii=False) + "\n").encode("utf-8"))
                    drain = getattr(writer, "drain", None)
                    if drain is not None:
                        result = drain()
                        if inspect.isawaitable(result):
                            await result
        bound_run = run or record.get("_run")
        if isinstance(bound_run, dict) and str(bound_run.get("pending_interaction") or "") == str(request_id):
            bound_run["pending_interaction"] = None
        if owner_mode in {"host_hook", "permission_prompt_mcp"}:
            if isinstance(bound_run, dict):
                bound_run["awaiting_interaction_ack"] = str(request_id)
            return {
                "ok": True,
                "request_id": str(request_id),
                "kind": kind,
                "action": action,
                "status": "awaiting_cli_ack",
                "acknowledgement": self.ack_status_for(sid),
            }
        self._pending.pop(sid, None)
        return {"ok": True, "request_id": str(request_id), "kind": kind, "action": action, "status": "accepted"}

    def invalidate(self, session_id: str, reason: str = "") -> dict[str, Any] | None:
        sid = str(session_id)
        record = self._pending.pop(sid, None)
        if record is None:
            store = self._store()
            durable = store.latest_for_session(sid) if store is not None else None
            if durable and str(durable.get("state") or "") in DurableInteractionStore._OPEN_STATES:
                record = self._record_from_durable(sid, str(durable.get("request_id") or ""))
        if record is not None:
            record["invalidated_reason"] = str(reason or "cancelled")
            owner_mode = str(record.get("_response_mode") or "")
            explicit_cancel = str(reason or "") == "cancelled"
            if explicit_cancel and owner_mode in {"host_hook", "permission_prompt_mcp"}:
                channel = record.get("_host_channel")
                if isinstance(channel, HostInteractionChannel):
                    try:
                        action = "skip" if record.get("kind") == "question" else "deny"
                        if owner_mode == "permission_prompt_mcp":
                            response = build_permission_prompt_response(record, action)
                        else:
                            response = build_hook_response(record, action)
                        channel.respond(
                            str(record.get("bridge_request_id") or ""),
                            response,
                        )
                    except (FileExistsError, OSError, ValueError):
                        pass
            store = self._store()
            if store is not None:
                try:
                    if explicit_cancel:
                        store.mark_cancelled(sid, str(record.get("request_id") or ""), reason="用户已停止任务")
                    else:
                        store.fail_owner(
                            sid,
                            str(record.get("run_id") or ""),
                            reason="任务中断；请求未执行。",
                        )
                except ValueError:
                    pass
            bound_run = record.get("_run")
            if isinstance(bound_run, dict):
                bound_run["pending_interaction"] = None
                bound_run["awaiting_interaction_ack"] = None
        return record


agent_interaction_broker = AgentInteractionBroker(
    input_channel=active_agent_input_channel,
    store_factory=durable_interaction_store,
    managed_channels_only=True,
)


def tool_use_text(block: dict[str, Any]) -> str:
    name = str(block.get("name") or "tool")
    tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
    command = tool_input.get("command") or tool_input.get("file_path") or tool_input.get("path") or ""
    description = tool_input.get("description") or ""
    details = clean_stream_text(" ".join(str(part) for part in (description, command) if part))
    return f"\n\n[Claude Code 工具] {name}{': ' + details if details else ''}\n"


def tool_result_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if not isinstance(content, list):
        return ""

    chunks: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        raw = block.get("content") or ""
        if isinstance(raw, list):
            raw = "\n".join(str(item.get("text", item)) for item in raw if isinstance(item, dict))
        text = clean_stream_text(str(raw).strip())
        if len(text) > TOOL_RESULT_DISPLAY_LIMIT:
            text = text[:TOOL_RESULT_DISPLAY_LIMIT] + "\n...[工具输出过长，显示已截断]"
        status = "失败" if block.get("is_error") else "完成"
        chunks.append(f"\n[工具结果/{status}]\n{text}\n")
    return "".join(chunks)


async def read_stderr(proc: asyncio.subprocess.Process) -> str:
    if proc.stderr is None:
        return ""
    chunks: list[bytes] = []
    while True:
        chunk = await proc.stderr.read(4096)
        if not chunk:
            break
        chunks.append(chunk)
    return clean_stream_text(b"".join(chunks).decode("utf-8", errors="replace").strip())


class ChunkedLineReader:
    """Read newline-delimited subprocess output without StreamReader.readline limits."""

    def __init__(self, stream: asyncio.StreamReader, chunk_size: int = STREAM_READ_CHUNK_SIZE):
        self.stream = stream
        self.chunk_size = chunk_size
        self.buffer = bytearray()
        self.eof = False

    async def readline(self, timeout: float | None) -> bytes:
        while True:
            newline_index = self.buffer.find(b"\n")
            if newline_index >= 0:
                line = bytes(self.buffer[: newline_index + 1])
                del self.buffer[: newline_index + 1]
                return line

            if self.eof:
                if not self.buffer:
                    return b""
                line = bytes(self.buffer)
                self.buffer.clear()
                return line

            chunk = await asyncio.wait_for(self.stream.read(self.chunk_size), timeout=timeout)
            if chunk:
                self.buffer.extend(chunk)
            else:
                self.eof = True


async def kill_process_tree(pid: int | None) -> None:
    if not pid:
        return
    try:
        killer = await asyncio.create_subprocess_exec(
            "taskkill.exe",
            "/PID",
            str(pid),
            "/T",
            "/F",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await killer.communicate()
    except Exception:
        try:
            proc = await asyncio.create_subprocess_exec(
                "powershell",
                "-NoProfile",
                "-Command",
                f"Stop-Process -Id {int(pid)} -Force -ErrorAction SilentlyContinue",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.communicate()
        except Exception:
            pass


async def kill_orphaned_claude_session(claude_session_id: str) -> None:
    session_token = str(claude_session_id or "").strip()
    if not session_token:
        return
    if os.name == "nt":
        ps = rf"""
$sid = '{session_token.replace("'", "''")}'
$selfPid = $PID
Get-CimInstance Win32_Process |
  Where-Object {{
    $_.ProcessId -ne $selfPid -and
    $_.CommandLine -and
    (
      $_.Name -like 'claude*' -or
      $_.Name -like 'node*'
    ) -and
    $_.CommandLine -match ('(--session-id|--resume)\s+' + [regex]::Escape($sid))
  }} |
  ForEach-Object {{
    try {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }} catch {{}}
  }}
"""
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=8,
                check=False,
            )
        except Exception:
            pass
        return

    if shutil.which("pkill"):
        try:
            await asyncio.to_thread(
                subprocess.run,
                ["pkill", "-f", session_token],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=8,
                check=False,
            )
        except Exception:
            pass


def remove_last_attempt_messages(session: dict[str, Any], display_prompt: str) -> None:
    current_messages = list(session.get("messages", []))
    if (
        current_messages
        and current_messages[-1].get("role") == "assistant"
        and current_messages[-1].get("pending")
    ):
        current_messages.pop()
    if (
        current_messages
        and current_messages[-1].get("role") == "user"
        and current_messages[-1].get("content") == display_prompt
    ):
        current_messages.pop()
    session["messages"] = current_messages


def tool_command(block: dict[str, Any]) -> str:
    tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
    return str(tool_input.get("command") or "")


def is_foreground_server_command(command: str) -> bool:
    lower = command.lower()
    long_running = any(
        token in lower
        for token in (
            "npm run dev",
            "npm start",
            "vite --",
            "vite ",
            "node --watch",
            "python -m uvicorn",
            "uvicorn ",
        )
    )
    if not long_running:
        return False
    backgrounded = any(
        token in lower
        for token in (
            "start-process",
            "cmd.exe /c start",
            "start /b",
            "nohup ",
            "setsid ",
        )
    )
    return not backgrounded


def is_browser_open_command(command: str) -> bool:
    lower = command.lower()
    if not any(prefix in lower for prefix in ("http://", "https://", "file://")):
        return False
    openers = (
        "cmd.exe /c start",
        "cmd /c start",
        "start-process",
        "explorer.exe",
        "msedge.exe",
        "microsoft\\edge\\application\\msedge",
        "chrome.exe",
        "google\\chrome\\application\\chrome",
        "rundll32 url.dll,fileprotocolhandler",
    )
    return any(token in lower for token in openers)


def is_external_gui_command(command: str) -> bool:
    lower = command.lower()
    gui_tokens = (
        "winword",
        "word.application",
        "documents.open",
        "documents.add",
        ".docx",
        ".docm",
        ".doc\"",
        ".doc'",
        "invoke-item",
        "os.startfile",
        "start-process",
        "explorer.exe",
        "cmd.exe /c start",
        "cmd /c start",
        "rundll32 url.dll,fileprotocolhandler",
        "msedge.exe",
        "chrome.exe",
    )
    return any(token in lower for token in gui_tokens)


def is_action_task_prompt(prompt: str) -> bool:
    lower = prompt.lower()
    action_tokens = (
        "打开",
        "启动",
        "运行",
        "安装",
        "部署",
        "转换",
        "转成",
        "导出",
        "保存",
        "新建",
        "创建",
        "编辑",
        "修改文件",
        "写入",
        "网页",
        "网站",
        "程序",
        "浏览器",
        "文件",
        "资料",
        "文档",
        "word",
        "excel",
        "powerpoint",
        "ppt",
        "pdf",
        "docx",
        "xlsx",
        "pptx",
        "skill",
        "npm",
        "vite",
        "python ",
        "powershell",
        "cmd.exe",
    )
    return any(token in lower for token in action_tokens)


def skill_aliases(skill: dict[str, str]) -> set[str]:
    filename_stem = str(skill.get("slug") or Path(skill.get("filename", "")).stem)
    command = str(skill.get("command") or "")
    display_name = str(skill.get("name") or "")
    aliases = {command, filename_stem, display_name}
    if "_" in filename_stem:
        aliases.add(filename_stem.split("_", 1)[1])
    normalized: set[str] = set()
    for alias in aliases:
        value = alias.strip().lower()
        if value:
            normalized.add(value)
            normalized.add(value.replace(" ", "-"))
    return normalized


def parse_skill_directive(prompt: str) -> tuple[dict[str, str], str] | None:
    stripped = prompt.lstrip()
    if not stripped.startswith("/"):
        return None

    parts = stripped.split(maxsplit=2)
    if not parts:
        return None

    if parts[0].lower() == "/skill" and len(parts) >= 2:
        token = parts[1].lstrip("/").lower()
        rest = parts[2] if len(parts) >= 3 else ""
    else:
        token = parts[0].lstrip("/").lower()
        rest = stripped[len(parts[0]):].lstrip()

    for skill in get_skills():
        if token in skill_aliases(skill):
            return skill, rest
    return None


def expand_skill_prompt(prompt: str) -> str:
    parsed = parse_skill_directive(prompt)
    if not parsed:
        return prompt

    skill, rest = parsed
    path = skill_file_from_record(skill)
    if not path:
        return prompt
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return prompt

    request = rest.strip() or "请按这个 skill 继续执行。"
    return (
        f"[网页端已展开本地技能说明文件: {skill.get('command') or skill.get('name')}]\n"
        "不要再调用 slash command，也不要检查当前可用 skill 列表；"
        "该技能说明已经完整粘贴在下方，请直接把它当作本次任务的专用操作规范，并严格按它处理用户请求。\n\n"
        "<skill>\n"
        f"{content}\n"
        "</skill>\n\n"
        "用户请求：\n"
        f"{request}"
    )


def public_goal(goal: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": goal.get("id", ""),
        "session_id": goal.get("session_id", ""),
        "title": goal.get("title", ""),
        "prompt": goal.get("prompt", ""),
        "status": goal.get("status", "paused"),
        "model": goal.get("model", ""),
        "permission_mode": goal.get("permission_mode", DEFAULT_PERMISSION_MODE),
        "turn_count": int(goal.get("turn_count") or 0),
        "max_turns": int(goal.get("max_turns") or GOAL_DEFAULT_MAX_TURNS),
        "created": float(goal.get("created") or 0),
        "updated": float(goal.get("updated") or 0),
        "last_run": float(goal.get("last_run") or 0),
        "last_output": str(goal.get("last_output") or "")[-1200:],
        "last_error": str(goal.get("last_error") or ""),
        "current_step": str(goal.get("current_step") or ""),
    }


def get_goal_or_404(goal_id: str) -> dict[str, Any]:
    goal = goals.get(goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="goal not found")
    normalized = normalize_goal(goal_id, goal)
    goals[goal_id] = normalized
    return normalized


def sse_payloads(chunk: str) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for part in str(chunk or "").split("\n\n"):
        for line in part.splitlines():
            if not line.startswith("data: "):
                continue
            try:
                payload = json.loads(line[6:])
            except Exception:
                continue
            if isinstance(payload, dict):
                payloads.append(payload)
    return payloads


def unique_skill_dirs() -> list[Path]:
    seen: set[str] = set()
    dirs: list[Path] = []
    for path in PROJECT_SKILLS_DIRS:
        try:
            key = str(path.resolve())
        except Exception:
            key = str(path)
        if key in seen:
            continue
        seen.add(key)
        dirs.append(path)
    return dirs


def unique_skill_source_roots() -> list[tuple[str, Path]]:
    seen: set[str] = set()
    roots: list[tuple[str, Path]] = []
    for source, path in SKILL_SOURCE_ROOTS:
        try:
            key = str(path.resolve()).lower()
        except Exception:
            key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        roots.append((source, path))
    return roots


def skill_source_for_path(path: Path) -> tuple[str, Path]:
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    for source, root in unique_skill_source_roots():
        try:
            if resolved == root.resolve() or root.resolve() in resolved.parents:
                return source, root
        except Exception:
            continue
    return "local", path.parent


def skill_name_from_path(path: Path) -> str:
    return path.parent.name if path.name.lower() == "skill.md" else path.stem


def claude_skill_bridge_root() -> str:
    configured = env_value("VINIPER_UI_CLAUDE_SKILL_BRIDGE_ROOT", "").strip()
    return configured or f"/home/{MANAGED_DISTRO_USER}/.local/share/viniper/skill-library"


def run_wsl_skill_bridge(script: str) -> subprocess.CompletedProcess:
    try:
        completed = subprocess.run(
            [
                "wsl.exe", "--distribution", MANAGED_DISTRO_NAME,
                "--user", MANAGED_DISTRO_USER, "--exec", "bash", "-s",
            ],
            # Passing text through a Windows TextIO wrapper translates LF to
            # CRLF; bash -s then reads tokens such as `set -eu\r`.  Send the
            # generated POSIX script as UTF-8 bytes so WSL receives exact LF.
            input=str(script).replace("\r\n", "\n").encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
            check=False,
        )
        return subprocess.CompletedProcess(
            completed.args,
            completed.returncode,
            stdout=bytes(completed.stdout or b"").decode("utf-8", errors="replace"),
            stderr=bytes(completed.stderr or b"").decode("utf-8", errors="replace"),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return subprocess.CompletedProcess(["wsl.exe"], 1, stdout="", stderr=str(exc))


def skill_id_from_path(path: Path) -> str:
    source, root = skill_source_for_path(path)
    try:
        relative = path.resolve().relative_to(root.resolve()).as_posix()
    except Exception:
        relative = path.name
    return f"{source}:{relative}"


def skill_display_path(path: Path) -> str:
    source, root = skill_source_for_path(path)
    try:
        return f"{source}/{path.resolve().relative_to(root.resolve()).as_posix()}"
    except Exception:
        pass
    for root in (APP_DIR, BASE_DIR):
        try:
            return str(path.relative_to(root))
        except ValueError:
            continue
    return str(path)


def skill_file_from_record(skill: dict[str, str]) -> Path | None:
    record_id = str(skill.get("id") or "").strip()
    if ":" in record_id:
        source, relative = record_id.split(":", 1)
        for candidate_source, root in unique_skill_source_roots():
            if candidate_source != source:
                continue
            try:
                candidate = (root / relative).resolve()
                if root.resolve() in candidate.parents and candidate.is_file() and candidate.suffix.lower() == ".md":
                    return candidate
            except Exception:
                return None
        return None
    absolute = str(skill.get("absolute_path") or "").strip()
    if absolute:
        path = Path(absolute)
        if path.exists() and path.is_file():
            return path
    filename = str(skill.get("filename") or "").strip()
    if filename:
        for directory in unique_skill_dirs():
            candidates = [
                directory / filename,
                directory / skill.get("id", "") / filename,
                directory / skill.get("id", "") / "SKILL.md",
            ]
            for candidate in candidates:
                if candidate.exists() and candidate.is_file():
                    return candidate
    return None


def find_skill(command: str) -> dict[str, str] | None:
    token = command.strip().lstrip("/").lower()
    if not token:
        return None
    for skill in get_skills():
        if token in skill_aliases(skill):
            return skill
    return None


def read_skill_content(command: str, limit: int | None = None) -> str:
    skill = find_skill(command)
    if not skill:
        return ""
    path = skill_file_from_record(skill)
    if not path:
        return ""
    try:
        content = path.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        return ""
    if limit and len(content) > limit:
        return content[:limit].rstrip() + "\n\n[skill truncated for goal-mode context]"
    return content


def goal_skill_section() -> str:
    content = read_skill_content(GOAL_SKILL_COMMAND, limit=18000)
    if not content:
        return (
            "Goal refinement protocol:\n"
            "- Audit the goal for vague words, missing deliverables, missing failure conditions, and missing next actions.\n"
            "- Each turn must deepen or verify the previous turn instead of repeating it.\n"
        )
    return (
        f"Embedded goal skill: {GOAL_SKILL_COMMAND}\n"
        "Use this skill as the goal-refinement protocol, but adapt it to autonomous goal mode: "
        "when the skill asks to pause for user input, first infer from files, command output, and previous turns; "
        "ask the user only if the missing information blocks further work.\n"
        "<goal-skill>\n"
        f"{content}\n"
        "</goal-skill>\n"
    )


def build_goal_turn_prompt(goal: dict[str, Any], turn_number: int) -> str:
    original = str(goal.get("prompt") or "").strip()
    last_output = str(goal.get("last_output") or "").strip()
    last_section = f"\nPrevious goal-mode output to improve, not repeat:\n{last_output[-3500:]}\n" if last_output else ""
    max_turns = int(goal.get("max_turns") or GOAL_DEFAULT_MAX_TURNS)
    phase = "初始审计" if turn_number <= 1 else ("递进深化" if turn_number < max_turns else "最终收束")
    return (
        "Viniper UI Goal Mode is a hidden outer controller for the current conversation. "
        "Continue the user's long-running goal through the configured agent shell. "
        "The visible reply should be useful and concise. Use tools when needed. Do not invent completed work.\n\n"
        f"{goal_skill_section()}\n"
        f"Original goal:\n{original}\n"
        f"{last_section}\n"
        f"Turn: {turn_number} / {max_turns}. Phase: {phase}.\n\n"
        "Required behavior for this turn:\n"
        "1. Start from the original goal and the previous output. Identify the single most important ambiguity, risk, or incomplete deliverable that remains.\n"
        "2. Apply the dbs-goal idea of making every vague word do work: define the checkable artifact, failure condition, next action, and verification evidence for this turn.\n"
        "3. Execute the next concrete improvement or verification step. Do not merely restate the goal and do not repeat earlier work unless verification shows it was wrong.\n"
        "4. At the end of the visible answer, briefly report: this turn's finding, this turn's concrete improvement, what remains next.\n"
        "5. Only mark the goal done when the deliverable is actually complete and verified. If the goal is complete, end the final hidden line with "
        f"{GOAL_DONE_MARKER}. If further refinement or execution remains, end the final hidden line with {GOAL_CONTINUE_MARKER}."
    )


def goal_output_is_done(output: str) -> bool:
    value = str(output or "")
    if GOAL_DONE_MARKER in value:
        return True
    if GOAL_CONTINUE_MARKER in value:
        return False
    return False


def strip_goal_control_markers(value: str) -> str:
    return (
        str(value or "")
        .replace(GOAL_DONE_MARKER, "")
        .replace(GOAL_CONTINUE_MARKER, "")
        .strip()
    )


def is_leaked_goal_control_message(message: dict[str, Any]) -> bool:
    if message.get("role") != "user":
        return False
    content = str(message.get("content") or "")
    return "[GUIDANCE]" in content and "Viniper UI Goal Mode" in content and "Original goal:" in content


def sanitize_goal_session_messages(session_id: str) -> None:
    session = safe_session(session_id)
    changed = False
    messages = []
    for message in list(session.get("messages", [])):
        if isinstance(message, dict) and is_leaked_goal_control_message(message):
            changed = True
            continue
        messages.append(message)
    session["messages"] = messages

    for message in reversed(messages):
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        for key in ("content", "thinking"):
            if key in message:
                cleaned = strip_goal_control_markers(str(message.get(key) or ""))
                if cleaned != message.get(key):
                    message[key] = cleaned
                    changed = True
        for segment in message.get("segments") or []:
            if not isinstance(segment, dict) or "content" not in segment:
                continue
            cleaned = strip_goal_control_markers(str(segment.get("content") or ""))
            if cleaned != segment.get("content"):
                segment["content"] = cleaned
                changed = True
        break

    if changed:
        session["updated"] = now_ts()
        sessions[session_id] = session
        save_sessions_to_disk()


def start_goal_task(goal_id: str) -> None:
    task = _goal_tasks.get(goal_id)
    if task and not task.done():
        return
    _goal_tasks[goal_id] = asyncio.create_task(run_goal_loop(goal_id))


async def stop_goal_task(goal_id: str, goal: dict[str, Any] | None = None) -> None:
    task = _goal_tasks.pop(goal_id, None)
    if task and not task.done():
        task.cancel()
    target_goal = goal or goals.get(goal_id)
    if target_goal:
        run = _active_runs.get(str(target_goal.get("session_id") or ""))
        if run:
            try:
                await kill_process_tree(int(run.get("pid") or 0))
            except Exception:
                pass
            force_release_session_lock(str(target_goal.get("session_id") or ""))


async def run_goal_loop(goal_id: str) -> None:
    await asyncio.sleep(0.1)
    try:
        while True:
            goal = goals.get(goal_id)
            if not goal or goal.get("status") != "running":
                return

            goal = normalize_goal(goal_id, goal)
            if goal["turn_count"] >= goal["max_turns"]:
                goal["status"] = "waiting"
                goal["current_step"] = "Reached the configured turn limit. Resume to continue."
                goal["updated"] = now_ts()
                goals[goal_id] = goal
                save_goals_to_disk()
                return

            turn_number = int(goal["turn_count"]) + 1
            goal["current_step"] = f"Running turn {turn_number}"
            goal["last_run"] = now_ts()
            goal["last_error"] = ""
            goal["updated"] = now_ts()
            goals[goal_id] = goal
            save_goals_to_disk()

            output_parts: list[str] = []
            error_text = ""
            prompt = build_goal_turn_prompt(goal, turn_number)
            async for chunk in stream_chat(
                str(goal.get("session_id") or ""),
                prompt,
                True,
                str(goal.get("model") or ""),
                str(goal.get("permission_mode") or DEFAULT_PERMISSION_MODE),
                [],
                suppress_user_message=True,
            ):
                for payload in sse_payloads(chunk):
                    content = str(payload.get("content") or "")
                    if payload.get("type") in {"text", "thinking"} and content:
                        output_parts.append(content)
                    elif payload.get("type") == "error":
                        error_text = content or "Goal turn failed."
                        output_parts.append(error_text)
                current = goals.get(goal_id)
                if not current or current.get("status") != "running":
                    return

            goal = goals.get(goal_id)
            if not goal:
                return
            sanitize_goal_session_messages(str(goal.get("session_id") or ""))
            goal = normalize_goal(goal_id, goal)
            goal["turn_count"] = int(goal.get("turn_count") or 0) + 1
            output = strip_goal_control_markers(clean_stream_text("".join(output_parts))).strip()
            goal["last_output"] = output[-4000:]
            goal["updated"] = now_ts()

            if error_text:
                goal["status"] = "failed"
                goal["last_error"] = error_text[:1200]
                goal["current_step"] = "Stopped after an error."
                goals[goal_id] = goal
                save_goals_to_disk()
                return

            if goal_output_is_done(output):
                goal["status"] = "completed"
                goal["current_step"] = "Completed."
                goals[goal_id] = goal
                save_goals_to_disk()
                return

            if int(goal["turn_count"]) >= int(goal["max_turns"]):
                goal["status"] = "waiting"
                goal["current_step"] = "Reached the configured turn limit. Resume to continue."
                goals[goal_id] = goal
                save_goals_to_disk()
                return

            goal["current_step"] = f"Turn {turn_number} finished; starting the next turn shortly."
            goals[goal_id] = goal
            save_goals_to_disk()
            await asyncio.sleep(GOAL_BETWEEN_TURN_DELAY_SECONDS)
    except asyncio.CancelledError:
        goal = goals.get(goal_id)
        if goal and goal.get("status") == "running":
            goal["status"] = "paused"
            goal["current_step"] = "Paused."
            goal["updated"] = now_ts()
            goals[goal_id] = goal
            save_goals_to_disk()
        raise
    except Exception as exc:
        goal = goals.get(goal_id)
        if goal:
            goal["status"] = "failed"
            goal["last_error"] = str(exc)[:1200]
            goal["current_step"] = "Goal runner failed."
            goal["updated"] = now_ts()
            goals[goal_id] = goal
            save_goals_to_disk()
    finally:
        task = _goal_tasks.get(goal_id)
        if task is asyncio.current_task():
            _goal_tasks.pop(goal_id, None)


class ChatTransport:
    """Text-only Anthropic-compatible transport; it never launches an agent process."""

    def __init__(self, provider_request=None):
        self.provider_request = provider_request

    @staticmethod
    def build_messages(session: dict[str, Any], prompt: str) -> list[dict[str, str]]:
        history: list[dict[str, str]] = []
        for message in session.get("messages", []):
            if not isinstance(message, dict) or message.get("pending"):
                continue
            role = str(message.get("role") or "")
            if role not in {"user", "assistant"}:
                continue
            content = str(message.get("content") or "").strip()
            if content:
                history.append({"role": role, "content": content})
        history.append({"role": "user", "content": prompt})
        return history

    @staticmethod
    def build_payload(session: dict[str, Any], prompt: str, model: str) -> dict[str, Any]:
        return {
            "model": model,
            "max_tokens": 4096,
            "messages": ChatTransport.build_messages(session, prompt),
            "stream": True,
        }

    async def _provider_events(self, cfg: dict[str, str], payload: dict[str, Any]):
        if self.provider_request is not None:
            result = self.provider_request(cfg, payload)
            if inspect.isawaitable(result):
                result = await result
            if hasattr(result, "__aiter__"):
                async for event in result:
                    if isinstance(event, dict):
                        yield event
            else:
                for event in result or []:
                    if isinstance(event, dict):
                        yield event
            return

        if not cfg.get("api_key"):
            raise RuntimeError(f"未找到 {cfg.get('label') or '模型供应商'} API key，请在设置里配置 API Key 或环境变量。")

        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "x-api-key": cfg["api_key"],
            "anthropic-version": "2023-06-01",
        }
        async with httpx.AsyncClient(timeout=120.0, trust_env=True) as client:
            async with client.stream("POST", messages_url(cfg["base_url"]), headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    value = str(line or "").strip()
                    if not value or value.startswith(":"):
                        continue
                    if value.startswith("data:"):
                        value = value[5:].strip()
                    if value == "[DONE]":
                        break
                    try:
                        event = json.loads(value)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(event, dict):
                        yield event

    async def stream(self, session_id: str, user_msg: str, model: str | None = None):
        session = safe_session(session_id)
        if normalize_session_mode(session.get("mode")) != "chat":
            raise RuntimeError("ChatTransport 只能服务 Chat 会话。")
        prompt = str(user_msg or "").strip()
        if not prompt:
            return
        cfg = provider_config(model)
        selected_model = cfg["model"]
        payload = self.build_payload(session, prompt, selected_model)
        session["messages"] = list(session.get("messages", [])) + [{"role": "user", "content": prompt}]
        session["last_run_status"] = "running"
        session["updated"] = now_ts()
        sessions[session_id] = session
        save_sessions_to_disk()

        assistant_text = ""
        thinking_text = ""
        segments: list[dict[str, Any]] = []
        thinking_started = False
        started = time.monotonic()
        last_save = 0.0

        def append_segment(segment_type: str, content: str) -> None:
            if not content:
                return
            if segments and segments[-1].get("type") == segment_type:
                segments[-1]["content"] = str(segments[-1].get("content") or "") + content
            else:
                segments.append({"type": segment_type, "content": content})

        def save_progress(force: bool = False) -> None:
            nonlocal last_save
            now = time.monotonic()
            if not force and now - last_save < 1.0:
                return
            last_save = now
            session.setdefault("messages", []).append({
                "role": "assistant",
                "content": assistant_text,
                "thinking": thinking_text,
                "model": selected_model,
                "segments": copy.deepcopy(segments),
                "elapsed_seconds": max(0, round(now - started)),
                "pending": True,
            })
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()

        def update_pending() -> None:
            for message in reversed(session.get("messages", [])):
                if isinstance(message, dict) and message.get("role") == "assistant" and message.get("pending"):
                    message.update({
                        "content": assistant_text,
                        "thinking": thinking_text,
                        "model": selected_model,
                        "segments": copy.deepcopy(segments),
                        "elapsed_seconds": max(0, round(time.monotonic() - started)),
                    })
                    return

        save_progress(force=True)
        yield {
            "type": "assistant_start",
            "mode": "chat",
            "model": selected_model,
        }
        try:
            async for event in self._provider_events(cfg, payload):
                event_type = str(event.get("type") or "")
                if event_type == "content_block_start":
                    block = event.get("content_block") if isinstance(event.get("content_block"), dict) else {}
                    if block.get("type") == "thinking" and not thinking_started:
                        thinking_started = True
                        yield {"type": "thinking_start", "elapsed": 0}
                    continue
                if event_type == "content_block_delta":
                    delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
                    delta_type = str(delta.get("type") or "")
                    if delta_type == "thinking_delta":
                        text = clean_stream_text(str(delta.get("thinking") or ""))
                        if text:
                            if not thinking_started:
                                thinking_started = True
                                yield {"type": "thinking_start", "elapsed": 0}
                            thinking_text += text
                            append_segment("thinking", text)
                            update_pending()
                            yield {"type": "thinking_delta", "content": text, "elapsed": max(0, round(time.monotonic() - started))}
                    elif delta_type == "text_delta":
                        text = clean_stream_text(str(delta.get("text") or ""))
                        if text:
                            if thinking_started:
                                thinking_started = False
                                yield {"type": "thinking_complete", "elapsed": max(0, round(time.monotonic() - started))}
                            assistant_text += text
                            append_segment("text", text)
                            update_pending()
                            yield {"type": "text", "content": text}
                    continue
                if event_type in {"thinking", "thinking_delta"}:
                    text = clean_stream_text(str(event.get("content") or event.get("thinking") or ""))
                    if text:
                        if not thinking_started:
                            thinking_started = True
                            yield {"type": "thinking_start", "elapsed": 0}
                        thinking_text += text
                        append_segment("thinking", text)
                        update_pending()
                        yield {"type": "thinking_delta", "content": text, "elapsed": max(0, round(time.monotonic() - started))}
                    continue
                if event_type in {"text", "text_delta"}:
                    text = clean_stream_text(str(event.get("content") or event.get("text") or ""))
                    if text:
                        if thinking_started:
                            thinking_started = False
                            yield {"type": "thinking_complete", "elapsed": max(0, round(time.monotonic() - started))}
                        assistant_text += text
                        append_segment("text", text)
                        update_pending()
                        yield {"type": "text", "content": text}
                    continue
                if event_type == "message_stop" and thinking_started:
                    thinking_started = False
                    yield {"type": "thinking_complete", "elapsed": max(0, round(time.monotonic() - started))}

            if thinking_started:
                thinking_started = False
                yield {"type": "thinking_complete", "elapsed": max(0, round(time.monotonic() - started))}
            update_pending()
            for message in reversed(session.get("messages", [])):
                if isinstance(message, dict) and message.get("role") == "assistant" and message.get("pending"):
                    message["segments"] = finalize_transcript_segments(message.get("segments"))
                    message.pop("thinking", None)
                    message.pop("pending", None)
                    break
            session["last_run_status"] = "completed"
            session["unread"] = True
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield {"type": "done"}
        except asyncio.CancelledError:
            update_pending()
            for message in reversed(session.get("messages", [])):
                if isinstance(message, dict) and message.get("role") == "assistant" and message.get("pending"):
                    message["segments"] = finalize_transcript_segments(message.get("segments"))
                    message.pop("thinking", None)
                    message.pop("pending", None)
                    message["cancelled"] = True
                    break
            session["last_run_status"] = "cancelled"
            session["unread"] = True
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            raise
        except Exception as exc:
            update_pending()
            for message in reversed(session.get("messages", [])):
                if isinstance(message, dict) and message.get("role") == "assistant" and message.get("pending"):
                    message["segments"] = finalize_transcript_segments(message.get("segments"))
                    message.pop("thinking", None)
                    message.pop("pending", None)
                    message["error"] = str(exc)
                    break
            session["last_run_status"] = "failed"
            session["unread"] = True
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield {"type": "error", "content": f"Chat 请求失败：{exc}"}
            yield {"type": "done"}


class AgentTransport:
    """Stable seam around the existing Agent/CLI stream implementation."""

    async def stream(self, session_id: str, user_msg: str, is_guidance: bool = False,
                     model: str | None = None, permission_mode: str | None = None,
                     attachments: list[dict[str, Any]] | None = None,
                     suppress_user_message: bool = False,
                     process_factory: Any = None,
                     peer_request: dict[str, str] | None = None,
                     queued_item_id: str = "",
                     accepted_turn_id: str = ""):
        async for chunk in stream_chat_impl(
            session_id,
            user_msg,
            is_guidance,
            model,
            permission_mode,
            attachments or [],
            suppress_user_message=suppress_user_message,
            process_factory=process_factory,
            peer_request=peer_request,
            queued_item_id=queued_item_id,
            accepted_turn_id=accepted_turn_id,
        ):
            yield chunk


CHAT_TRANSPORT = ChatTransport()
AGENT_TRANSPORT = AgentTransport()


async def stream_chat(
    session_id: str,
    user_msg: str,
    is_guidance: bool = False,
    model: str | None = None,
    permission_mode: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    suppress_user_message: bool = False,
    peer_request: dict[str, str] | None = None,
    accepted_turn_id: str = "",
):
    lock = session_lock(session_id)
    agent_mode = False
    try:
        await asyncio.wait_for(lock.acquire(), timeout=6)
    except asyncio.TimeoutError:
        yield sse({
            "type": "error",
            "content": "上一个任务还在运行，已拦截这次重复提交。如果刚才点了停止按钮，等几秒钟再发即可。",
        })
        yield sse({"type": "done"})
        return
    try:
        session = safe_session(session_id)
        mode = normalize_session_mode(session.get("mode"))
        if mode == "chat":
            if is_guidance or attachments or permission_mode:
                yield sse({
                    "type": "error",
                    "content": "Chat 只接受普通对话文本，不支持权限、附件、技能或 Agent 指令。",
                })
                yield sse({"type": "done"})
                return
            task = asyncio.current_task()
            if task is not None:
                _chat_tasks[session_id] = task
                _active_runs[session_id] = {
                    "kind": "chat",
                    "task": task,
                    "started": now_ts(),
                    "cancel_requested": False,
                }
            try:
                async for event in CHAT_TRANSPORT.stream(session_id, user_msg, model):
                    yield sse(event)
            finally:
                _chat_tasks.pop(session_id, None)
                _active_runs.pop(session_id, None)
        else:
            agent_mode = True
            current_message = user_msg
            current_model = model
            current_permission = permission_mode
            current_attachments = attachments or []
            current_suppress = suppress_user_message
            current_peer_request = peer_request
            current_accepted_turn_id = str(accepted_turn_id or "")
            queued_item: dict[str, Any] | None = None
            while True:
                saw_done = False
                saw_error = False
                runtime_started = False
                async for chunk in AGENT_TRANSPORT.stream(
                    session_id,
                    current_message,
                    is_guidance if queued_item is None else False,
                    current_model,
                    current_permission,
                    current_attachments,
                    suppress_user_message=current_suppress,
                    peer_request=current_peer_request,
                    queued_item_id=str(queued_item.get("id") or "") if queued_item else "",
                    accepted_turn_id=current_accepted_turn_id,
                ):
                    for payload in sse_payloads(chunk):
                        event_type = str(payload.get("type") or "")
                        if event_type == "runtime_started":
                            runtime_started = True
                            if queued_item is not None:
                                agent_queue_store().mark_started(session_id, str(queued_item.get("id") or ""))
                                yield sse({
                                    "type": "queue_removed",
                                    "session_id": session_id,
                                    "item_id": str(queued_item.get("id") or ""),
                                })
                        elif event_type == "error":
                            saw_error = True
                        elif event_type == "done":
                            saw_done = True
                    yield chunk

                current_accepted_turn_id = ""

                if queued_item is not None and not runtime_started:
                    agent_queue_store().pause_dispatch(session_id, str(queued_item.get("id") or ""))
                run_status = str(safe_session(session_id).get("last_run_status") or "")
                if not saw_done or saw_error or run_status != "completed":
                    break
                token = agent_queue_store().authorize_drain(session_id, str(uuid.uuid4()), "done")
                if not token:
                    break
                queued_item = agent_queue_store().claim_authorized(session_id, token)
                if queued_item is None:
                    break
                yield sse({
                    "type": "queue_dispatch",
                    "session_id": session_id,
                    "item": {
                        key: copy.deepcopy(queued_item.get(key))
                        for key in ("id", "text", "attachments", "model", "permission_mode", "status", "created_at")
                    },
                })
                current_message = str(queued_item.get("text") or "")
                current_model = str(queued_item.get("model") or model or "")
                current_permission = str(queued_item.get("permission_mode") or permission_mode or "")
                current_attachments = copy.deepcopy(queued_item.get("attachments") or [])
                current_suppress = False
                current_peer_request = None
    finally:
        if agent_mode:
            agent_queue_store().pause_pending(session_id)
        try:
            lock.release()
        except RuntimeError:
            pass


async def stream_custom_cli_impl(
    session_id: str,
    user_msg: str,
    is_guidance: bool = False,
    model: str | None = None,
    permission_mode: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    suppress_user_message: bool = False,
):
    settings = load_app_settings()
    shell_settings = settings.get("shell", {})
    command_template = str(shell_settings.get("custom_command") or "").strip()
    if not command_template:
        yield sse({"type": "error", "content": "Custom CLI is selected, but no command template is configured in Settings."})
        yield sse({"type": "done"})
        return

    cfg = provider_config(model)
    session = safe_session(session_id)
    selected_model = cfg["model"]
    selected_permission_mode = allowed_permission_mode(permission_mode)
    attachments = attachments or []
    prompt = user_msg.strip()
    if is_guidance:
        prompt = f"[GUIDANCE] {prompt}"
    display_prompt = prompt
    if not suppress_user_message:
        user_message = {"role": "user", "content": display_prompt}
        if attachments:
            user_message["attachments"] = attachment_message_items(attachments, session_id)
        session["messages"] = list(session.get("messages", [])) + [user_message]
    session["last_run_status"] = "running"
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()

    cwd = existing_workdir(str(session.get("workdir") or ""))
    watched_file_roots = file_change_watch_roots(cwd)
    before_file_state = snapshot_watch_files(watched_file_roots)
    command = format_custom_command(command_template, cfg, session, selected_permission_mode)
    stdin_prompt = build_generic_cli_prompt(session, prompt, attachments, read_agent_instructions())
    assistant_text = ""
    thinking_text = ""
    started = time.monotonic()

    yield sse({
        "type": "assistant_start",
        "model": selected_model,
        "mode": "custom-cli",
        "permission_mode": selected_permission_mode,
    })
    proc = None
    stderr_task = None
    coordinator_run_id = ""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(cwd),
            env=build_agent_env(cfg, session),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _active_runs[session_id] = {"pid": proc.pid, "started": now_ts(), "prompt": prompt, "cancel_requested": False}
        stderr_task = asyncio.create_task(read_stderr(proc))
        if proc.stdin is not None:
            proc.stdin.write(stdin_prompt.encode("utf-8", errors="replace"))
            await proc.stdin.drain()
            proc.stdin.close()

        assert proc.stdout is not None
        stdout_reader = ChunkedLineReader(proc.stdout)
        last_heartbeat = started
        while True:
            if RUN_TIMEOUT_SECONDS > 0 and time.monotonic() - started >= RUN_TIMEOUT_SECONDS:
                await kill_process_tree(proc.pid)
                detail = f"Custom CLI exceeded {RUN_TIMEOUT_SECONDS} seconds and was stopped."
                yield sse({"type": "error", "content": detail})
                assistant_text = assistant_text or detail
                break
            try:
                raw_line = await stdout_reader.readline(10)
            except asyncio.TimeoutError:
                now = time.monotonic()
                if now - last_heartbeat >= HEARTBEAT_INTERVAL_SECONDS:
                    yield sse({"type": "heartbeat", "elapsed": round(now - started), "action_task": False, "waiting_for": "custom-cli"})
                    last_heartbeat = now
                continue
            if not raw_line:
                break
            text = clean_stream_text(raw_line.decode("utf-8", errors="replace"))
            if not text:
                continue
            assistant_text += text
            yield sse({"type": "text", "content": text})

        return_code = await proc.wait()
        stderr_text = await stderr_task if stderr_task else ""
        if _active_runs.get(session_id, {}).get("cancel_requested"):
            session["last_run_status"] = "cancelled"
            session["unread"] = True
            assistant_text = assistant_text or "已停止当前任务，输入已恢复。"
            yield sse({"type": "text", "content": assistant_text})
        elif return_code != 0:
            session["last_run_status"] = "failed"
            session["unread"] = True
            detail = stderr_text or f"Custom CLI exited with code {return_code}"
            yield sse({"type": "error", "content": detail[:3000]})
            assistant_text = assistant_text or f"错误：{detail}"
        elif not assistant_text.strip():
            assistant_text = "任务已完成，但自定义 CLI 没有返回文本输出。"
            yield sse({"type": "text", "content": assistant_text})

        if not session.get("last_run_status") or session.get("last_run_status") == "running":
            session["last_run_status"] = "completed"
        session["unread"] = True

        changed_files = changed_watch_files(before_file_state, watched_file_roots)
        artifact_segments = []
        for path in changed_files:
            artifact = {"type": "artifact", "path": path, "name": Path(path).name, "status": "success"}
            image = local_artifact_image(path, watched_file_roots)
            if image is not None:
                artifact["image"] = image
            artifact_segments.append(artifact)
        for segment in artifact_segments:
            yield sse(segment)

        session = safe_session(session_id)
        session.setdefault("messages", []).append({
            "role": "assistant",
            "content": assistant_text,
            "model": selected_model,
            "segments": ([{"type": "text", "content": assistant_text}] if assistant_text else []) + artifact_segments,
            "elapsed_seconds": max(0, round(time.monotonic() - started)),
        })
        session["updated"] = now_ts()
        sessions[session_id] = session
        save_sessions_to_disk()
        yield sse({"type": "done"})
    except Exception as exc:
        session["last_run_status"] = "failed"
        session["unread"] = True
        detail = f"Custom CLI failed: {exc}"
        yield sse({"type": "error", "content": detail})
        yield sse({"type": "done"})
    finally:
        if proc and proc.returncode is None:
            await kill_process_tree(proc.pid)
        if stderr_task and not stderr_task.done():
            stderr_task.cancel()
        _active_runs.pop(session_id, None)


async def stream_chat_impl(
    session_id: str,
    user_msg: str,
    is_guidance: bool = False,
    model: str | None = None,
    permission_mode: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    retry_missing_session: bool = False,
    retry_session_in_use: bool = False,
    suppress_user_message: bool = False,
    stall_recovery_count: int = 0,
    process_factory: Any = None,
    peer_request: dict[str, str] | None = None,
    queued_item_id: str = "",
    accepted_turn_id: str = "",
):
    settings = load_app_settings()
    if is_custom_shell(settings.get("shell", {})):
        async for chunk in stream_custom_cli_impl(
            session_id,
            user_msg,
            is_guidance,
            model,
            permission_mode,
            attachments or [],
            suppress_user_message,
        ):
            yield chunk
        return

    cfg = deepseek_config(model)
    if not cfg["api_key"]:
        detail = f"未找到 {cfg['label']} API key，请在设置里配置 API Key 或环境变量。"
        if accepted_turn_id:
            finalize_accepted_agent_turn_failure(session_id, accepted_turn_id, detail, cfg["model"])
        yield sse({"type": "error", "content": detail})
        yield sse({"type": "done"})
        return

    runtime = WindowsNativeRuntime(claude_launcher(), process_factory=process_factory) if process_factory else agent_runtime()
    if isinstance(runtime, WslAgentRuntime):
        runtime_probe = runtime.probe()
        if not runtime_probe.ready:
            yield sse({
                "type": "runtime_status",
                "runtime": runtime_probe.as_dict(),
            })
            yield sse({
                "type": "error",
                "content": "Agent 需要先完成 ViniperRuntime（WSL2）运行时设置。Chat 仍可正常使用。",
            })
            if accepted_turn_id:
                finalize_accepted_agent_turn_failure(
                    session_id,
                    accepted_turn_id,
                    "Agent 需要先完成 ViniperRuntime（WSL2）运行时设置。Chat 仍可正常使用。",
                    cfg["model"],
                )
            yield sse({"type": "done"})
            return

    session = safe_session(session_id)
    selected_model = cfg["model"]
    selected_permission_mode = allowed_permission_mode(permission_mode)
    attachments = attachments or []
    prompt = user_msg.strip()
    if is_guidance:
        prompt = f"[GUIDANCE] {prompt}"
    display_prompt = prompt
    if peer_request:
        prompt = build_native_send_instruction(
            str(peer_request.get("target_peer_name") or ""),
            str(peer_request.get("message") or user_msg),
        )
        display_prompt = (
            f"发送给 {str(peer_request.get('target_display_name') or peer_request.get('target_peer_name') or '目标会话')}："
            f"{str(peer_request.get('message') or user_msg)}"
        )

    resume_existing = bool(session.get("claude_initialized"))
    if resume_existing:
        claude_session_id = new_claude_session_id(session.get("claude_session_id"))
    else:
        claude_session_id = str(uuid.uuid4())
    session["claude_session_id"] = claude_session_id
    defer_queued_user = bool(queued_item_id and not suppress_user_message)
    if not accepted_turn_id and not suppress_user_message and not defer_queued_user:
        user_message = {"role": "user", "content": display_prompt}
        if attachments:
            user_message["attachments"] = attachment_message_items(attachments, session_id)
        session["messages"] = list(session.get("messages", [])) + [user_message]
    else:
        session["messages"] = list(session.get("messages", []))
    session["last_run_status"] = "running"
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()

    context_prompt = append_attachment_prompt(prompt, attachments)

    fallback_model = "deepseek-v4-flash" if selected_model != "deepseek-v4-flash" else ""
    system_prompt_path = prepare_agent_system_prompt(session)
    usage_run_id = str(uuid.uuid4())
    host_channel, host_settings_path, host_mcp_config_path = prepare_agent_host_channel(
        runtime, session_id, usage_run_id,
    )

    cwd = existing_workdir(str(session.get("workdir") or ""))
    run_spec = AgentRunSpec(
        session_id=session_id,
        claude_session_id=claude_session_id,
        session_name=stable_session_name(str(session.get("name") or "session"), session_id),
        workdir=str(cwd),
        model=selected_model,
        permission_mode=selected_permission_mode,
        resume=resume_existing,
        add_dirs=tuple(agent_add_dirs(session, prompt, attachments)),
        fallback_model=fallback_model,
        system_prompt_file=str(system_prompt_path),
        settings_file=str(host_settings_path),
        mcp_config_file=str(host_mcp_config_path) if host_mcp_config_path else "",
        permission_prompt_tool=(
            PERMISSION_PROMPT_MCP_QUALIFIED_TOOL if host_mcp_config_path is not None else ""
        ),
        environment=build_claude_env(cfg, session),
        bridge_keys=runtime_bridge_keys(),
    )
    watched_file_roots = file_change_watch_roots(cwd)
    before_file_state = snapshot_watch_files(watched_file_roots)
    assistant_text = ""
    thinking_text = ""
    assistant_segments: list[dict[str, Any]] = []
    message_started_at = time.monotonic()
    final_result = ""
    stderr_text = ""
    timed_out = False
    blocked_command = ""
    duplicate_open_command = ""
    browser_open_seen = False
    external_gui_command = ""
    external_gui_started = 0.0
    external_gui_timeout = False
    action_task = is_action_task_prompt(prompt)
    action_idle_timeout = False
    no_output_timeout = False
    no_output_stage = ""
    waiting_for = "model"
    assistant_message_index: int | None = None
    last_progress_save = 0.0
    finalized = False
    coordinator_run_id = usage_run_id
    interaction_protocol_failure = ""
    run_started_at: float | None = None
    active_thinking_started_at: float | None = None
    active_thinking_segment_index: int | None = None
    fallback_question_tool_ids: set[str] = set()
    published_interaction_ids: set[str] = set()
    compatibility_interactions: dict[str, dict[str, Any]] = {}
    fallback_input_closed = False

    if accepted_turn_id:
        for index in range(len(session.get("messages", [])) - 1, -1, -1):
            message = session["messages"][index]
            if (
                isinstance(message, dict)
                and message.get("role") == "assistant"
                and str(message.get("turn_id") or "") == str(accepted_turn_id)
            ):
                assistant_message_index = index
                break

    def elapsed_seconds_since(started_at: float) -> int:
        return max(0, int(round(time.monotonic() - started_at)))

    def total_elapsed_seconds() -> int:
        return elapsed_seconds_since(message_started_at)

    def refresh_active_thinking_elapsed() -> None:
        if active_thinking_started_at is None or active_thinking_segment_index is None:
            return
        if active_thinking_segment_index >= len(assistant_segments):
            return
        segment = assistant_segments[active_thinking_segment_index]
        if segment.get("type") == "thinking":
            segment["elapsed_seconds"] = elapsed_seconds_since(active_thinking_started_at)

    def close_active_thinking() -> None:
        nonlocal active_thinking_started_at, active_thinking_segment_index
        refresh_active_thinking_elapsed()
        active_thinking_started_at = None
        active_thinking_segment_index = None

    def append_assistant_segment(kind: str, text: str) -> None:
        nonlocal active_thinking_started_at, active_thinking_segment_index
        if not text:
            return
        segment_type = "thinking" if kind == "thinking" else "text"
        if segment_type != "thinking":
            close_active_thinking()
        if assistant_segments and assistant_segments[-1].get("type") == segment_type:
            assistant_segments[-1]["content"] = str(assistant_segments[-1].get("content") or "") + text
        else:
            assistant_segments.append({"type": segment_type, "content": text})
        if segment_type == "thinking":
            if active_thinking_segment_index != len(assistant_segments) - 1:
                active_thinking_started_at = time.monotonic()
                active_thinking_segment_index = len(assistant_segments) - 1
                assistant_segments[active_thinking_segment_index]["elapsed_seconds"] = 0
            refresh_active_thinking_elapsed()

    def append_thinking_image(image: dict[str, Any]) -> None:
        nonlocal active_thinking_started_at, active_thinking_segment_index
        if active_thinking_segment_index is None or active_thinking_segment_index >= len(assistant_segments):
            assistant_segments.append({"type": "thinking", "content": "", "images": [], "elapsed_seconds": 0})
            active_thinking_segment_index = len(assistant_segments) - 1
            active_thinking_started_at = time.monotonic()
        segment = assistant_segments[active_thinking_segment_index]
        if segment.get("type") != "thinking":
            return
        images = segment.setdefault("images", [])
        if isinstance(images, list):
            images.append(copy.deepcopy(image))
        refresh_active_thinking_elapsed()

    def append_activity_segment(activity_type: str, **payload: Any) -> None:
        segment = {"type": activity_type}
        segment.update({key: value for key, value in payload.items() if value is not None})
        assistant_segments.append(segment)

    def close_fallback_stream_input() -> None:
        nonlocal fallback_input_closed
        if fallback_input_closed or proc is None or proc.stdin is None:
            return
        fallback_input_closed = True
        try:
            if proc.stdin.can_write_eof():
                proc.stdin.write_eof()
            else:
                proc.stdin.close()
        except (AttributeError, NotImplementedError, RuntimeError):
            proc.stdin.close()

    def ensure_assistant_message() -> dict[str, Any]:
        nonlocal assistant_message_index
        if (
            assistant_message_index is not None
            and assistant_message_index < len(session.get("messages", []))
            and isinstance(session["messages"][assistant_message_index], dict)
            and session["messages"][assistant_message_index].get("role") == "assistant"
        ):
            return session["messages"][assistant_message_index]
        session.setdefault("messages", []).append({"role": "assistant", "content": "", "model": selected_model, "pending": True})
        assistant_message_index = len(session["messages"]) - 1
        return session["messages"][assistant_message_index]

    def save_assistant_progress(force: bool = False) -> None:
        nonlocal last_progress_save
        now = time.monotonic()
        if not force and now - last_progress_save < 1.0:
            return
        last_progress_save = now
        message = ensure_assistant_message()
        message["content"] = assistant_text
        message["model"] = selected_model
        message["segments"] = copy.deepcopy(assistant_segments)
        message["elapsed_seconds"] = total_elapsed_seconds()
        if thinking_text:
            message["thinking"] = thinking_text
        message["pending"] = True
        session["updated"] = now_ts()
        sessions[session_id] = session
        save_sessions_to_disk()

    def finalize_assistant(content: str | None = None, thinking: str | None = None, status: str | None = None) -> None:
        nonlocal finalized
        close_active_thinking()
        if content is not None and content != assistant_text and not assistant_segments:
            append_assistant_segment("text", content)
        message = ensure_assistant_message()
        message["content"] = assistant_text if content is None else content
        message["model"] = selected_model
        message["segments"] = finalize_transcript_segments(assistant_segments)
        message["elapsed_seconds"] = total_elapsed_seconds()
        message.pop("thinking", None)
        message.pop("pending", None)
        session["last_run_status"] = status or ("failed" if str(content or "").startswith("错误：") else "completed")
        session["unread"] = True
        session["updated"] = now_ts()
        sessions[session_id] = session
        save_sessions_to_disk()
        finalized = True

    yield sse({
        "type": "assistant_start",
        "model": selected_model,
        "mode": "claude-code-cli",
        "permission_mode": selected_permission_mode,
    })
    if not defer_queued_user:
        save_assistant_progress(force=True)

    proc = None
    stderr_task = None
    try:
        cleanup_stale = getattr(runtime, "cleanup_stale", None)
        if cleanup_stale is not None:
            await cleanup_stale(run_spec)
        proc = await runtime.spawn_session(run_spec)
        process_identity = proc.process_identity
        coordinator_snapshot = coordinated_run_snapshot(session_id) or {}
        coordinator_run_id = str(coordinator_snapshot.get("run_id") or usage_run_id)
        if isinstance(runtime, WslAgentRuntime):
            runtime_identity = None
            for _attempt in range(20):
                runtime_identity = await asyncio.to_thread(runtime.inspect_session_identity, proc.session_key)
                if runtime_identity:
                    break
                await asyncio.sleep(0.025)
            if runtime_identity:
                agent_run_journal().begin({
                    "session_id": session_id,
                    "coordinator_run_id": coordinator_run_id,
                    "owner_pid": os.getpid(),
                    "runtime": "wsl2",
                    "session_key": proc.session_key,
                    "process_identity": process_identity,
                    "runtime_pid": int(runtime_identity.get("runtime_pid") or 0),
                    "runtime_pgid": int(runtime_identity.get("runtime_pgid") or 0),
                    "host_channel": str(host_channel.root),
                    "started_at": now_ts(),
                })
        run_info = {
            "kind": "agent",
            "pid": proc.pid,
            "started": now_ts(),
            "prompt": prompt,
            "cancel_requested": False,
            "stdin": proc.stdin,
            "process_identity": process_identity,
            "pending_interaction": None,
            "awaiting_interaction_ack": None,
            "runtime": runtime,
            "runtime_process": proc,
            "claude_session_id": claude_session_id,
            "peer_name": run_spec.session_name,
            "display_name": str(session.get("name") or run_spec.session_name),
            "peer_capability": None,
            "usage_run_id": usage_run_id,
            "model": selected_model,
            "permission_mode": selected_permission_mode,
            "host_channel": host_channel,
            # Managed WSL uses one run-private MCP permission prompt owner.
            # Native migration/test adapters retain legacy stdout fixtures.
            "host_hooks_enabled": isinstance(runtime, WslAgentRuntime),
            "published_interaction_ids": published_interaction_ids,
            "session_record": session,
        }
        _active_runs[session_id] = run_info
        if defer_queued_user:
            user_message = {"role": "user", "content": display_prompt}
            if attachments:
                user_message["attachments"] = attachment_message_items(attachments, session_id)
            session["messages"] = list(session.get("messages", [])) + [user_message]
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            save_assistant_progress(force=True)
        yield sse({"type": "runtime_started", "session_id": session_id, "run_id": usage_run_id})
        if proc.stdin is None:
            raise RuntimeError("Claude Code stream-json stdin is unavailable")
        await active_agent_input_channel.write(
            session_id,
            run_info,
            build_stream_json_user_envelope(context_prompt, claude_session_id),
            process_identity=process_identity,
        )
        stderr_task = asyncio.create_task(read_stderr(proc))

        assert proc.stdout is not None
        stdout_reader = ChunkedLineReader(proc.stdout)
        run_started_at = time.monotonic()
        started = run_started_at
        last_heartbeat = started
        last_process_output = started
        published_ack_stage = ""
        while True:
            for host_request in host_channel.pending():
                interaction = agent_interaction_broker.create_host_request(
                    session_id,
                    process_identity,
                    host_request,
                    host_channel,
                    workdir=str(cwd),
                    run=run_info,
                )
                if interaction is None:
                    yield sse({
                        "type": "error",
                        "content": "底层 CLI 返回了无法安全匹配的宿主交互请求，未自动允许。",
                    })
                    continue
                interaction_id = str(interaction.get("request_id") or "")
                agent_run_journal().mark_interaction(
                    session_id,
                    kind=str(interaction.get("kind") or ""),
                    request_id=interaction_id,
                )
                compatibility_interactions.pop(interaction_id, None)
                if interaction_id in published_interaction_ids:
                    continue
                if active_thinking_started_at is not None:
                    close_active_thinking()
                    yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                published_interaction_ids.add(interaction_id)
                if interaction.get("kind") == "question":
                    fallback_question_tool_ids.add(interaction_id)
                run_info["pending_interaction"] = interaction_id
                run_info["awaiting_interaction_ack"] = None
                waiting_for = "interaction"
                yield sse(interaction)
            compatibility_now = time.monotonic()
            for compatibility_id, candidate in list(compatibility_interactions.items()):
                if compatibility_id in published_interaction_ids:
                    compatibility_interactions.pop(compatibility_id, None)
                    continue
                if compatibility_now - float(candidate.get("observed_at") or compatibility_now) < HOST_HOOK_COMPATIBILITY_GRACE_SECONDS:
                    continue
                compatibility_interactions.pop(compatibility_id, None)
                if run_info.get("host_hooks_enabled"):
                    interaction_protocol_failure = "interaction_owner_request_missing"
                    await runtime.cancel(session_id)
                    break
                interaction = agent_interaction_broker.create_request(
                    session_id,
                    process_identity,
                    candidate.get("payload"),
                    stdin=proc.stdin,
                    workdir=str(cwd),
                    run=run_info,
                )
                if interaction is None:
                    yield sse({
                        "type": "error",
                        "content": "底层 CLI 返回了无法安全匹配的兼容交互请求，未自动允许。",
                    })
                    continue
                interaction_id = str(interaction.get("request_id") or "")
                if active_thinking_started_at is not None:
                    close_active_thinking()
                    yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                published_interaction_ids.add(interaction_id)
                if interaction.get("kind") == "question":
                    fallback_question_tool_ids.add(interaction_id)
                interaction["session_id"] = session_id
                run_info["pending_interaction"] = interaction_id
                run_info["awaiting_interaction_ack"] = None
                waiting_for = "interaction"
                yield sse(interaction)
            if interaction_protocol_failure:
                break
            ack_status = agent_interaction_broker.ack_status_for(session_id)
            if ack_status and str(ack_status.get("state") or "") == "awaiting_cli_ack":
                run_info["pending_interaction"] = None
                run_info["awaiting_interaction_ack"] = str(ack_status.get("request_id") or "")
                waiting_for = "awaiting_cli_ack"
                ack_stage = str(ack_status.get("stage") or "response_committed")
                if ack_stage != published_ack_stage:
                    published_ack_stage = ack_stage
                    yield sse({
                        "type": "interaction_ack",
                        "request_id": str(ack_status.get("request_id") or ""),
                        "status": "awaiting_cli_ack",
                        "stage": ack_stage,
                    })
            elapsed = time.monotonic() - started
            remaining = RUN_TIMEOUT_SECONDS - elapsed if RUN_TIMEOUT_SECONDS > 0 else None
            if remaining is not None and remaining <= 0:
                timed_out = True
                await runtime.cancel(session_id)
                break
            try:
                read_timeout = 0.2 if remaining is None else min(0.2, remaining)
                raw_line = await stdout_reader.readline(read_timeout)
            except asyncio.TimeoutError:
                now = time.monotonic()
                expired_acks = agent_interaction_broker.expire_unacknowledged(
                    now=time.time(),
                    timeout_seconds=CLI_INTERACTION_ACK_TIMEOUT_SECONDS,
                )
                expired_ack = next((item for item in expired_acks if item.get("session_id") == session_id), None)
                if expired_ack is not None:
                    interaction_protocol_failure = str(expired_ack.get("reason") or "cli_ack_timeout")
                    no_output_timeout = True
                    no_output_stage = "awaiting_cli_ack"
                    await agent_run_coordinator().acknowledge_interaction(
                        session_id,
                        str(expired_ack.get("request_id") or ""),
                        success=False,
                    )
                    await runtime.cancel(session_id)
                    break
                if (
                    SAFETY_GUARDS_ENABLED
                    and
                    action_task
                    and waiting_for != "interaction"
                    and ACTION_TASK_IDLE_TIMEOUT_SECONDS > 0
                    and now - last_process_output >= ACTION_TASK_IDLE_TIMEOUT_SECONDS
                ):
                    action_idle_timeout = True
                    await runtime.cancel(session_id)
                    break
                if (
                    waiting_for == "model"
                    and MODEL_IDLE_TIMEOUT_SECONDS > 0
                    and now - last_process_output >= MODEL_IDLE_TIMEOUT_SECONDS
                ):
                    no_output_timeout = True
                    no_output_stage = "model"
                    await runtime.cancel(session_id)
                    break
                if (
                    waiting_for != "interaction"
                    and NO_OUTPUT_TIMEOUT_SECONDS > 0
                    and now - last_process_output >= NO_OUTPUT_TIMEOUT_SECONDS
                ):
                    no_output_timeout = True
                    no_output_stage = waiting_for
                    await runtime.cancel(session_id)
                    break
                if (
                    SAFETY_GUARDS_ENABLED
                    and
                    external_gui_command
                    and GUI_COMMAND_TIMEOUT_SECONDS > 0
                    and now - external_gui_started >= GUI_COMMAND_TIMEOUT_SECONDS
                ):
                    external_gui_timeout = True
                    await runtime.cancel(session_id)
                    break
                if now - last_heartbeat >= HEARTBEAT_INTERVAL_SECONDS:
                    yield sse({
                        "type": "heartbeat",
                        "elapsed": round(now - started),
                        "action_task": action_task,
                        "waiting_for": waiting_for,
                    })
                    save_assistant_progress(force=True)
                    last_heartbeat = now
                continue
            if not raw_line:
                break
            last_process_output = time.monotonic()
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                # Filter out Claude Code internal debug noise
                if line.startswith("[Claude Code]") or line.startswith("[DEBUG]") or line.startswith("[WARN]") or line.startswith("[ERROR]") or line.startswith("[STARTUP]") or line.startswith("[API"):
                    continue
                if len(line) < 4:
                    continue
                text = f"{clean_stream_text(line)}\n"
                assistant_text += text
                append_assistant_segment("text", text)
                save_assistant_progress()
                yield sse({"type": "text", "content": text})
                continue

            daily_usage_ledger().record_event(usage_run_id, session_id, data)
            usage_snapshot = context_usage_ledger().update_from_event(
                session_id,
                data,
                model=selected_model,
                fallback_limit=context_limit_for_model(selected_model),
            )
            if usage_snapshot is not None:
                yield sse({"type": "usage", "usage": usage_snapshot.as_dict()})

            event_type = data.get("type")
            if event_type == "system" and str(data.get("subtype") or "") == "compact_boundary":
                compacting_snapshot = context_usage_ledger().mark_compact_boundary(
                    session_id,
                    data,
                    model=selected_model,
                    fallback_limit=context_limit_for_model(selected_model),
                )
                yield sse({
                    "type": "compact_boundary",
                    "session_id": session_id,
                    "run_id": usage_run_id,
                    "trigger": str(data.get("trigger") or "auto"),
                    "pre_tokens": int(data.get("pre_tokens") or 0),
                    "usage": compacting_snapshot.as_dict(),
                })
                continue
            if event_type == "system" and str(data.get("subtype") or "") == "init":
                cli_version = str(data.get("claude_code_version") or runtime.runtime_version())
                runtime_capabilities = runtime.capabilities()
                peer_capability = _native_peer_messaging.observe_init(
                    session_id,
                    cli_version,
                    data,
                    registry_supported=False,
                )
                run_info["peer_capability"] = peer_capability.as_dict()
                yield sse({"type": "peer_capability", "peer": peer_capability.as_dict()})
                continue

            if event_type == "system" and str(data.get("subtype") or "") == "permission_denied":
                try:
                    denied_projection = project_permission_denied_event(
                        data,
                        session_id=session_id,
                        run_id=usage_run_id,
                    )
                except ValueError:
                    denied_projection = {
                        "type": "tool_result",
                        "tool_id": str(data.get("tool_use_id") or ""),
                        "tool_use_id": str(data.get("tool_use_id") or ""),
                        "status": "失败",
                        "content": clean_stream_text(str(
                            data.get("message") or data.get("decision_reason") or "权限请求已被拒绝"
                        )),
                        "permission_denied": True,
                        "is_error": True,
                    }
                append_activity_segment(
                    "tool_result",
                    tool_id=str(denied_projection.get("tool_id") or ""),
                    status="失败",
                    content=str(denied_projection.get("content") or ""),
                )
                save_assistant_progress()
                yield sse(denied_projection)
                continue

            peer_events = [
                decorate_peer_event(item)
                for item in (_native_peer_messaging.observe_event(session_id, data) or [])
            ]
            peer_tool_ids = {
                str(item.get("tool_id") or "")
                for item in peer_events
                if str(item.get("tool_id") or "")
            }
            if peer_events:
                if active_thinking_started_at is not None:
                    close_active_thinking()
                    yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                for peer_event in peer_events:
                    append_activity_segment(
                        str(peer_event.get("type") or "peer_event"),
                        **{key: value for key, value in peer_event.items() if key != "type"},
                    )
                    yield sse(peer_event)
                save_assistant_progress()

            if str(event_type or "").strip().lower() == "control_request":
                if run_info.get("host_hooks_enabled"):
                    normalized_compatibility = normalize_control_request(data)
                    if normalized_compatibility is None:
                        yield sse({
                            "type": "error",
                            "content": "底层 CLI 返回了无法识别的结构化交互请求，未自动允许。",
                        })
                        continue
                    compatibility_id = str(normalized_compatibility.get("request_id") or "")
                    compatibility_interactions.setdefault(compatibility_id, {
                        "payload": copy.deepcopy(data),
                        "observed_at": time.monotonic(),
                    })
                    continue
                interaction = agent_interaction_broker.create_request(
                    session_id,
                    process_identity,
                    data,
                    stdin=proc.stdin,
                    workdir=str(cwd),
                    run=run_info,
                )
                if interaction is None:
                    yield sse({
                        "type": "error",
                        "content": "底层 CLI 返回了无法识别的结构化交互请求，未自动允许。",
                    })
                    continue
                interaction_id = str(interaction.get("request_id") or "")
                if interaction_id in published_interaction_ids:
                    continue
                if active_thinking_started_at is not None:
                    close_active_thinking()
                    yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                published_interaction_ids.add(interaction_id)
                if interaction.get("kind") == "question":
                    fallback_question_tool_ids.add(interaction_id)
                interaction["session_id"] = session_id
                run_info["pending_interaction"] = interaction_id
                run_info["awaiting_interaction_ack"] = None
                waiting_for = "interaction"
                yield sse(interaction)
                continue

            if event_type == "stream_event":
                waiting_for = "model"
                event = data.get("event") if isinstance(data.get("event"), dict) else {}
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
                    fallback_question_pending = bool(run_info.get("pending_interaction"))
                    if delta.get("type") == "thinking_delta":
                        text = clean_stream_text(str(delta.get("thinking") or ""))
                        if text and not fallback_question_pending:
                            if active_thinking_started_at is None:
                                yield sse({"type": "thinking_start", "elapsed": 0})
                            thinking_text += text
                            append_assistant_segment("thinking", text)
                            save_assistant_progress()
                            yield sse({"type": "thinking", "content": text})
                    elif delta.get("type") == "text_delta":
                        text = clean_stream_text(str(delta.get("text") or ""))
                        if fallback_question_pending:
                            continue
                        assistant_text += text
                        if active_thinking_started_at is not None:
                            close_active_thinking()
                            yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                        append_assistant_segment("text", text)
                        save_assistant_progress()
                        yield sse({"type": "text", "content": text})
                continue

            if event_type == "assistant":
                message = data.get("message") if isinstance(data.get("message"), dict) else {}
                content = message.get("content")
                saw_tool_use = False
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "thinking":
                            full_thinking = clean_stream_text(str(block.get("thinking") or ""))
                            if full_thinking and full_thinking != thinking_text:
                                if full_thinking.startswith(thinking_text):
                                    delta = full_thinking[len(thinking_text):]
                                elif full_thinking not in thinking_text:
                                    delta = ("\n" if thinking_text else "") + full_thinking
                                else:
                                    delta = ""
                                if delta:
                                    if active_thinking_started_at is None:
                                        yield sse({"type": "thinking_start", "elapsed": 0})
                                    thinking_text += delta
                                    append_assistant_segment("thinking", delta)
                                    save_assistant_progress()
                                    yield sse({"type": "thinking", "content": delta})
                        elif block.get("type") == "text":
                            full_text = clean_stream_text(str(block.get("text") or ""))
                            if str(run_info.get("pending_interaction") or "") in fallback_question_tool_ids:
                                continue
                            if full_text and full_text not in assistant_text:
                                if full_text.startswith(assistant_text):
                                    delta = full_text[len(assistant_text):]
                                else:
                                    delta = ("\n" if assistant_text else "") + full_text
                                if delta:
                                    if active_thinking_started_at is not None:
                                        close_active_thinking()
                                        yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                                    assistant_text += delta
                                    append_assistant_segment("text", delta)
                                    save_assistant_progress()
                                    yield sse({"type": "text", "content": delta})
                        elif block.get("type") == "image":
                            image = normalize_image_block(block, alt=str(block.get("alt") or "Claude 输出图片"))
                            if image is not None:
                                if active_thinking_started_at is not None:
                                    append_thinking_image(image)
                                    outbound_image = {**image, "scope": "thinking"}
                                else:
                                    append_activity_segment("image", **{key: value for key, value in image.items() if key != "type"})
                                    outbound_image = image
                                save_assistant_progress()
                                yield sse(outbound_image)
                        elif block.get("type") == "tool_use":
                            saw_tool_use = True
                            if active_thinking_started_at is not None:
                                close_active_thinking()
                                yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                            command_text = tool_command(block)
                            tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
                            tool_id = str(block.get("id") or uuid.uuid4())
                            tool_name = str(block.get("name") or "tool")
                            if tool_name == "SendMessage" and tool_id in peer_tool_ids:
                                continue
                            if tool_name.casefold() == "askuserquestion" and isinstance(tool_input.get("questions"), list):
                                if tool_id in published_interaction_ids:
                                    fallback_question_tool_ids.add(tool_id)
                                    continue
                                if run_info.get("host_hooks_enabled"):
                                    fallback_question_tool_ids.add(tool_id)
                                    compatibility_interactions.setdefault(tool_id, {
                                        "payload": {
                                            "type": "tool_start",
                                            "tool_id": tool_id,
                                            "name": tool_name,
                                            "input": copy.deepcopy(tool_input),
                                        },
                                        "observed_at": time.monotonic(),
                                    })
                                    continue
                                interaction = agent_interaction_broker.create_request(
                                    session_id,
                                    process_identity,
                                    {
                                        "type": "tool_start",
                                        "tool_id": tool_id,
                                        "name": tool_name,
                                        "input": tool_input,
                                    },
                                    stdin=proc.stdin,
                                    workdir=str(cwd),
                                    run=run_info,
                                )
                                if interaction is None:
                                    yield sse({
                                        "type": "error",
                                        "content": "底层 CLI 返回了无法识别的问题请求，未自动继续。",
                                    })
                                    continue
                                if tool_id not in published_interaction_ids:
                                    if active_thinking_started_at is not None:
                                        close_active_thinking()
                                        yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
                                    fallback_question_tool_ids.add(tool_id)
                                    published_interaction_ids.add(tool_id)
                                    interaction["session_id"] = session_id
                                    run_info["pending_interaction"] = tool_id
                                    run_info["awaiting_interaction_ack"] = None
                                    waiting_for = "interaction"
                                    yield sse(interaction)
                                continue
                            summary = clean_stream_text(" ".join(
                                str(part) for part in (
                                    tool_input.get("description") or "",
                                    command_text or tool_input.get("file_path") or tool_input.get("path") or "",
                                ) if part
                            ))
                            append_activity_segment(
                                "tool_start",
                                tool_id=tool_id,
                                name=tool_name,
                                summary=summary,
                                status="running",
                            )
                            save_assistant_progress()
                            yield sse({
                                "type": "tool_start",
                                "tool_id": tool_id,
                                "name": tool_name,
                                "summary": summary,
                                "status": "running",
                            })
                            if SAFETY_GUARDS_ENABLED:
                                if is_external_gui_command(command_text):
                                    external_gui_command = command_text
                                    external_gui_started = time.monotonic()
                                if is_browser_open_command(command_text):
                                    if browser_open_seen:
                                        duplicate_open_command = command_text
                                        await runtime.cancel(session_id)
                                        break
                                    browser_open_seen = True
                                if is_foreground_server_command(command_text):
                                    blocked_command = command_text
                                    await runtime.cancel(session_id)
                                    break
                    waiting_for = "interaction" if run_info.get("pending_interaction") else ("tool" if saw_tool_use else "model")
                continue

            if event_type == "user":
                waiting_for = "model"
                message = data.get("message") if isinstance(data.get("message"), dict) else {}
                content = message.get("content")
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict) or block.get("type") != "tool_result":
                            continue
                        tool_result_id = str(block.get("tool_use_id") or "")
                        interaction_ack = agent_interaction_broker.confirm_cli_tool_result(
                            session_id,
                            tool_result_id,
                            success=not bool(block.get("is_error")),
                        )
                        if interaction_ack is not None:
                            accepted = bool(interaction_ack.get("accepted"))
                            await agent_run_coordinator().acknowledge_interaction(
                                session_id,
                                tool_result_id,
                                success=accepted,
                            )
                            yield sse({
                                "type": "interaction_ack",
                                "request_id": tool_result_id,
                                "status": "accepted" if accepted else "failed",
                                "stage": "cli_tool_result",
                            })
                            waiting_for = "model" if accepted else "done"
                            if not accepted:
                                interaction_protocol_failure = str(interaction_ack.get("reason") or "cli_ack_failed")
                                yield sse({
                                    "type": "error",
                                    "content": "底层 CLI 未确认本次交互结果，任务已安全停止。",
                                })
                                await runtime.cancel(session_id)
                                break
                        if tool_result_id in peer_tool_ids:
                            continue
                        if tool_result_id in fallback_question_tool_ids:
                            continue
                        raw = block.get("content") or ""
                        result_images: list[dict[str, Any]] = []
                        if isinstance(raw, list):
                            text_items: list[str] = []
                            for item in raw:
                                if not isinstance(item, dict):
                                    continue
                                image = normalize_image_block(item, alt="工具输出图片")
                                if image is not None:
                                    result_images.append(image)
                                elif item.get("type") == "text":
                                    text_items.append(str(item.get("text") or ""))
                            raw = "\n".join(text_items)
                        elif isinstance(raw, dict):
                            image = normalize_image_block(raw, alt="工具输出图片")
                            result_images = [image] if image is not None else []
                            raw = ""
                        detail = clean_stream_text(str(raw).strip())
                        if len(detail) > TOOL_RESULT_DISPLAY_LIMIT:
                            detail = detail[:TOOL_RESULT_DISPLAY_LIMIT] + "\n...[工具输出过长，显示已截断]"
                        status = "失败" if block.get("is_error") else "完成"
                        append_activity_segment(
                            "tool_result",
                            tool_id=tool_result_id,
                            status=status,
                            content=detail,
                            images=result_images,
                        )
                        save_assistant_progress()
                        yield sse({
                            "type": "tool_result",
                            "tool_id": tool_result_id,
                            "status": status,
                            "content": detail,
                            "images": result_images,
                        })
                if interaction_protocol_failure:
                    break
                if isinstance(content, list) and any(isinstance(block, dict) and block.get("type") == "tool_result" for block in content):
                    waiting_for = "model"
                if external_gui_command:
                    external_gui_command = ""
                    external_gui_started = 0.0
                continue

            if event_type == "result":
                waiting_for = "done"
                final_result = clean_stream_text(str(data.get("result") or ""))
                if data.get("is_error"):
                    error_text = final_result or clean_stream_text(str(data))
                    if str(run_info.get("pending_interaction") or "") in fallback_question_tool_ids:
                        final_result = ""
                        continue
                    final_result = error_text
                    if not (
                        (is_missing_claude_session_error(error_text) and not retry_missing_session)
                        or (is_claude_session_in_use_error(error_text) and not retry_session_in_use)
                    ):
                        yield sse({"type": "error", "content": error_text})
                if not run_info.get("pending_interaction"):
                    close_fallback_stream_input()
                continue

        if active_thinking_started_at is not None:
            close_active_thinking()
            yield sse({"type": "thinking_complete", "elapsed": total_elapsed_seconds()})
        return_code = await proc.wait()
        mark_finished = getattr(runtime, "mark_finished", None)
        if mark_finished is not None:
            mark_finished(session_id, proc)
        stderr_text = await stderr_task
        unsettled_at_exit = agent_interaction_broker.unsettled_for(session_id)
        if unsettled_at_exit and not interaction_protocol_failure:
            ack = agent_interaction_broker.ack_status_for(session_id) or {}
            interaction_protocol_failure = "process_exited_before_cli_ack"
            await agent_run_coordinator().acknowledge_interaction(
                session_id,
                str(ack.get("request_id") or run_info.get("pending_interaction") or ""),
                success=False,
            )
        agent_interaction_broker.invalidate(session_id, reason="process-exited")
        if _active_runs.get(session_id) is not None:
            _active_runs[session_id]["pending_interaction"] = None
            _active_runs[session_id]["awaiting_interaction_ack"] = None

        if interaction_protocol_failure and not no_output_timeout:
            detail = (
                "官方交互入口未接管底层结构化交互，任务已安全停止并恢复输入。"
                if interaction_protocol_failure == "interaction_owner_request_missing"
                else "底层 CLI 未完成本次交互确认，任务已安全停止并恢复输入。"
            )
            yield sse({"type": "error", "content": detail})
            finalize_assistant(f"错误：{detail}")
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if external_gui_timeout:
            detail = (
                "外部程序或文档打开命令长时间没有返回，我已自动停止底层等待并恢复输入。"
                "如果 Word 或浏览器窗口已经打开，可以直接继续操作；如果没打开，请再发一次，我会换用后台打开方式。"
            )
            if not assistant_text:
                assistant_text = detail
                append_assistant_segment("text", detail)
                yield sse({"type": "text", "content": detail})
            else:
                assistant_text = f"{assistant_text}\n\n{detail}"
                append_assistant_segment("text", f"\n\n{detail}")
                yield sse({"type": "text", "content": f"\n\n{detail}"})
            finalize_assistant()
            session["updated"] = now_ts()
            session["claude_initialized"] = True
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if action_idle_timeout:
            detail = (
                f"这个动作型任务已经连续 {ACTION_TASK_IDLE_TIMEOUT_SECONDS} 秒没有任何 Claude Code 输出，"
                "我已自动停止底层等待并恢复输入，避免界面一直卡住。"
                "这通常是 Claude Code 在等待模型响应、文件转换工具或外部程序时没有返回。"
                "你可以把任务拆小一点再发，例如先让我只定位第 21 讲资料，再让我单独转换 PDF。"
            )
            yield sse({"type": "error", "content": detail})
            finalize_assistant(f"错误：{detail}")
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if no_output_timeout:
            if no_output_stage == "model" and stall_recovery_count < MODEL_STALL_RECOVERY_ATTEMPTS and not peer_request:
                detail = (
                    f"底层 Claude Code 在等待模型/API 响应时连续 {MODEL_IDLE_TIMEOUT_SECONDS} 秒没有输出。"
                    "这不是本地工具还在执行，而是模型请求无响应；我已停止该进程，并用同一个 Claude Code 会话自动恢复一次。"
                )
                yield sse({"type": "working_status", "content": "正在恢复底层 Claude Code 会话…", "detail": detail})
                finalize_assistant()
                session["updated"] = now_ts()
                session["claude_initialized"] = True
                sessions[session_id] = session
                save_sessions_to_disk()
                recovery_prompt = (
                    "继续完成上一项任务。上一轮底层模型/API 在工具结果返回后长时间没有输出，"
                    f"{APP_TITLE} 已经重启 Claude Code 进程并恢复同一个会话。"
                    "请先检查当前工作目录里已经生成或已经读取过的内容，避免重复执行已完成步骤；"
                    "如果需要继续处理大文件、图片很多的 docx/pdf 或长日志，请用脚本生成文件，"
                    "聊天里只返回简短摘要、关键路径和最终结果。"
                )
                async for chunk in stream_chat_impl(
                    session_id,
                    recovery_prompt,
                    True,
                    model,
                    permission_mode,
                    [],
                    retry_missing_session=True,
                    suppress_user_message=True,
                    stall_recovery_count=stall_recovery_count + 1,
                ):
                    yield chunk
                return

            if no_output_stage == "awaiting_cli_ack":
                detail = (
                    "底层 CLI 在收到交互回答后没有返回匹配的工具结果，"
                    "本次任务已安全停止并恢复输入。"
                )
            else:
                detail = (
                    f"Claude Code 已连续 {MODEL_IDLE_TIMEOUT_SECONDS if no_output_stage == 'model' else NO_OUTPUT_TIMEOUT_SECONDS} 秒没有任何输出，"
                    "我已自动停止这次任务并恢复输入。"
                    f"最后等待阶段：{no_output_stage or 'unknown'}。"
                    "这通常表示底层模型请求、网络连接或外部工具进入了无响应状态；"
                    "已完成的文件会保留，你可以缩小任务范围后继续。"
                )
            yield sse({"type": "error", "content": detail})
            finalize_assistant(f"错误：{detail}")
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if duplicate_open_command:
            detail = (
                "我已经执行过一次打开网页命令，并拦截了本轮后续重复打开，避免继续弹出一堆浏览器窗口。"
                "如果页面没有浮到最前面，请先切到已有浏览器窗口查看；确实没打开时，再单独让我重试一次。"
            )
            if not assistant_text:
                assistant_text = detail
                append_assistant_segment("text", detail)
                yield sse({"type": "text", "content": detail})
            else:
                assistant_text = f"{assistant_text}\n\n{detail}"
                append_assistant_segment("text", f"\n\n{detail}")
                yield sse({"type": "text", "content": f"\n\n{detail}"})
            finalize_assistant()
            session["updated"] = now_ts()
            session["claude_initialized"] = True
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if blocked_command:
            detail = (
                "我拦下了一个会常驻不退出的前台命令，避免网页一直卡住：\n"
                f"`{blocked_command}`\n\n"
                "打开本地网页时应该后台启动服务，或者服务已运行时直接打开 URL。"
            )
            yield sse({"type": "error", "content": detail})
            finalize_assistant(f"错误：{detail}")
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if timed_out:
            detail = f"Claude Code 执行超过 {RUN_TIMEOUT_SECONDS} 秒，我已停止这次任务，避免网页无限等待。"
            yield sse({"type": "error", "content": detail})
            finalize_assistant(f"错误：{detail}")
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if _active_runs.get(session_id, {}).get("cancel_requested"):
            assistant_text = "已停止当前任务，输入已恢复。"
            append_assistant_segment("text", assistant_text)
            yield sse({"type": "text", "content": assistant_text})
            finalize_assistant(assistant_text, status="cancelled")
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if return_code != 0:
            detail = stderr_text or final_result or f"claude exited with code {return_code}"
            if is_claude_session_in_use_error(detail) and not retry_session_in_use and not peer_request:
                remove_last_attempt_messages(session, display_prompt)
                was_initialized = bool(session.get("claude_initialized"))
                if not was_initialized:
                    session["claude_session_id"] = str(uuid.uuid4())
                session["claude_initialized"] = was_initialized
                session["updated"] = now_ts()
                sessions[session_id] = session
                save_sessions_to_disk()
                cleanup_stale = getattr(runtime, "cleanup_stale", None)
                if cleanup_stale is not None:
                    await cleanup_stale(run_spec)
                await asyncio.sleep(2 if not was_initialized else 5)
                yield sse({
                    "type": "working_status",
                    "content": "底层 Claude Code 会话锁仍被占用，正在清理并重试…",
                })
                async for chunk in stream_chat_impl(
                    session_id,
                    user_msg,
                    is_guidance,
                    model,
                    permission_mode,
                    attachments,
                    retry_missing_session,
                    retry_session_in_use=True,
                ):
                    yield chunk
                return

            if is_missing_claude_session_error(detail) and not retry_missing_session and not peer_request:
                remove_last_attempt_messages(session, display_prompt)
                session["claude_session_id"] = str(uuid.uuid4())
                session["claude_initialized"] = False
                session["updated"] = now_ts()
                sessions[session_id] = session
                save_sessions_to_disk()
                yield sse({
                    "type": "working_status",
                    "content": "底层 Claude Code 会话已失效，正在重建并重试…",
                })
                async for chunk in stream_chat_impl(
                    session_id,
                    user_msg,
                    is_guidance,
                    model,
                    permission_mode,
                    attachments,
                    retry_missing_session=True,
                ):
                    yield chunk
                return
            yield sse({"type": "error", "content": detail[:3000]})
            finalize_assistant(f"错误：{detail}")
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if not assistant_text and final_result:
            assistant_text = final_result
            append_assistant_segment("text", final_result)
            yield sse({"type": "text", "content": final_result})

        for path in changed_watch_files(before_file_state, watched_file_roots):
            artifact = {"type": "artifact", "path": path, "name": Path(path).name, "status": "success"}
            image = local_artifact_image(path, watched_file_roots)
            if image is not None:
                artifact["image"] = image
            assistant_segments.append(artifact)
            yield sse(artifact)

        finalize_assistant()
        session["updated"] = now_ts()
        session["claude_initialized"] = True
        sessions[session_id] = session
        save_sessions_to_disk()
        yield sse({"type": "done"})
    except asyncio.CancelledError:
        if proc and proc.returncode is None:
            await runtime.cancel(session_id)
        if stderr_task:
            stderr_task.cancel()
        force_release_session_lock(session_id)
        raise
    except FileNotFoundError:
        detail = "找不到 claude 命令，请确认 Claude Code 已安装并在 PATH 中。"
        finalize_assistant(f"错误：{detail}")
        yield sse({"type": "error", "content": detail})
        yield sse({"type": "done"})
    except Exception as exc:
        detail = f"Claude Code 启动失败：{exc}"
        finalize_assistant(f"错误：{detail}")
        yield sse({"type": "error", "content": detail})
        yield sse({"type": "done"})
    finally:
        had_unsettled_interaction = agent_interaction_broker.unsettled_for(session_id)
        agent_interaction_broker.invalidate(session_id, reason="stream-finished")
        if had_unsettled_interaction:
            host_channel.cancel_all("stream-finished")
        if proc and proc.stdin is not None:
            try:
                proc.stdin.close()
            except Exception:
                pass
        if proc and proc.returncode is None:
            await runtime.cancel(session_id)
            if not finalized:
                interruption_note = "连接中断，已停止底层 Claude Code 进程，避免任务在后台继续运行。"
                final_content = f"{assistant_text}\n\n{interruption_note}".strip() if assistant_text else interruption_note
                finalize_assistant(
                    final_content,
                    status="cancelled" if _active_runs.get(session_id, {}).get("cancel_requested") else "failed",
                )
        elif not finalized:
            save_assistant_progress(force=True)
        mark_finished = getattr(runtime, "mark_finished", None)
        if mark_finished is not None:
            mark_finished(session_id, proc)
        cleanup_agent_system_prompt(system_prompt_path)
        _active_runs.pop(session_id, None)
        terminal = "completed" if finalized and str(session.get("last_run_status") or "") == "completed" else "failed"
        if str(session.get("last_run_status") or "") == "cancelled":
            terminal = "cancelled"
        elif no_output_stage == "awaiting_cli_ack":
            terminal = "timeout"
        host_channel.finalize(terminal, reason=interaction_protocol_failure or terminal)
        host_channel.cleanup()
        agent_run_journal().finish(
            session_id,
            coordinator_run_id,
            status=terminal,
        )


def list_skill_files() -> list[Path]:
    files: list[Path] = []
    seen: set[str] = set()
    for directory in unique_skill_dirs():
        if not directory.exists():
            continue
        candidates = sorted(
            [
                *(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() == ".md"),
                *(p for p in directory.glob("*/SKILL.md") if p.is_file()),
            ],
            key=lambda item: str(item).lower(),
        )
        for path in candidates:
            try:
                key = str(path.resolve())
            except Exception:
                key = str(path)
            if key in seen:
                continue
            seen.add(key)
            files.append(path)
    return files


def skill_metadata(content: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    in_frontmatter = False
    delimiter_count = 0
    for raw in content.splitlines():
        line = raw.strip()
        if line == "---":
            delimiter_count += 1
            if delimiter_count == 1:
                in_frontmatter = True
                continue
            break
        if not in_frontmatter or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key in {"name", "description"}:
            metadata[key] = value.strip().strip("\"'")
    return metadata


def get_skills() -> list[dict[str, str]]:
    now = time.time()
    if now - _skills_cache["time"] < 30:
        return _skills_cache["items"]

    skills: list[dict[str, str]] = []
    for path in list_skill_files():
        record_id = skill_id_from_path(path)
        source, _root = skill_source_for_path(path)
        name = skill_name_from_path(path)
        category = source
        title = name
        desc = ""
        content = path.read_text(encoding="utf-8", errors="replace")
        metadata = skill_metadata(content)
        # Claude Code derives the slash command from the official skill
        # directory name. Underscores are part of that stable identity.
        command = name
        if metadata.get("name"):
            title = metadata["name"]
        if metadata.get("description"):
            desc = metadata["description"][:180]
        # Frontmatter `name` is the display title for personal/project skills;
        # the first H1 is only a fallback when that field is absent.
        found_title = bool(metadata.get("name"))
        for raw in content.splitlines():
            line = raw.strip()
            if line.startswith("# ") and not found_title:
                title = line[2:].strip()
                found_title = True
            elif not desc and line and not line.startswith("#") and not line.startswith("---"):
                desc = line[:120]
                break
        record = {
                "id": record_id,
                "filename": path.name,
                "slug": name,
                "name": title,
                "command": command,
                "category": category,
                "description": desc,
                "path": skill_display_path(path),
                "source": source,
                "absolute_path": str(path),
            }
        record.update(localized_skill_fields(record))
        record["claude"] = copy.deepcopy(
            _skill_sync_statuses.get(record_id) or status_display("viniper_only")
        )
        skills.append(record)

    _skills_cache["time"] = now
    _skills_cache["items"] = skills
    return skills


def sync_skills_to_claude(
    *,
    bridge_root: str | None = None,
    user_skills_root: str = "",
    command_runner: Any = None,
    path_mapper: Any = None,
    manifest_path: Path | None = None,
    force: bool = False,
) -> dict[str, Any]:
    global _skill_sync_statuses
    target = str(bridge_root or claude_skill_bridge_root())
    effective_user_root = str(user_skills_root or env_value("VINIPER_UI_CLAUDE_USER_SKILLS_ROOT", "").strip())
    target_key = f"{target}|{effective_user_root}"
    now = time.time()
    with _skill_sync_lock:
        cached = _skill_sync_cache.get("result")
        if (
            not force
            and isinstance(cached, dict)
            and cached
            and _skill_sync_cache.get("target") == target_key
            and now - float(_skill_sync_cache.get("time") or 0) < 30
        ):
            return copy.deepcopy(cached)

        runtime = agent_runtime()
        records = get_skills()
        result = synchronize_skill_records(
            records,
            bridge_root=target,
            path_mapper=path_mapper or runtime.map_path,
            command_runner=command_runner or run_wsl_skill_bridge,
            manifest_path=manifest_path or (DATA_DIR / "runtime" / "claude-skill-bridge.json"),
            user_skills_root=effective_user_root,
        )
        statuses = result.get("statuses") if isinstance(result.get("statuses"), dict) else {}
        _skill_sync_statuses = {
            str(record_id): copy.deepcopy(value)
            for record_id, value in statuses.items()
            if isinstance(value, dict)
        }
        for record in records:
            record_id = str(record.get("id") or "")
            record["claude"] = copy.deepcopy(
                _skill_sync_statuses.get(record_id) or status_display("viniper_only")
            )
        _skill_sync_cache.update({"time": now, "target": target_key, "result": copy.deepcopy(result)})
        return copy.deepcopy(result)


@app.get("/")
async def index():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    asset_version = re.sub(r"[^A-Za-z0-9_.-]", "", ASSET_VERSION) or str(int(time.time()))
    html = html.replace("__APP_VERSION__", asset_version)
    html = html.replace("__APP_TITLE__", APP_TITLE)
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "no-store, max-age=0",
        },
    )


@app.get("/favicon.ico")
async def favicon():
    icon = STATIC_DIR / "assets" / "viniper-icon.ico"
    if icon.exists():
        return FileResponse(icon)
    raise HTTPException(status_code=404, detail="favicon not found")


@app.get("/api/attachments/{session_id}/{filename}")
async def attachment_file(session_id: str, filename: str):
    safe_id = safe_attachment_filename(session_id)
    safe_name = safe_attachment_filename(Path(filename).name)
    target = (ATTACHMENTS_DIR / safe_id / safe_name).resolve()
    root = (ATTACHMENTS_DIR / safe_id).resolve()
    if root not in target.parents or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="attachment not found")
    return FileResponse(target)


@app.get("/api/status")
async def status():
    cfg = deepseek_config()
    update_source = read_update_source()
    settings = public_settings()
    runtime_status = runtime_public_status()
    shell = settings.get("shell", {})
    shell_id = str(shell.get("id") or "claude-code")
    runtime_configured = bool(cfg["api_key"]) if shell_id == "claude-code" else bool(str(shell.get("custom_command") or "").strip())
    return {
        "ok": True,
        "mode": "custom-cli" if shell_id == "custom-cli" else "claude-code-cli",
        "profile": PROFILE_NAME,
        "active_profile": ACTIVE_PROFILE,
        "product_name": APP_TITLE,
        "version": APP_VERSION,
        "preview": PREVIEW_MODE,
        "configured": runtime_configured,
        "provider": cfg["provider"],
        "provider_label": cfg["label"],
        "base_url": cfg["base_url"],
        "messages_url": messages_url(cfg["base_url"]),
        "model": cfg["model"],
        "models": effective_model_options(),
        "settings": settings,
        "shells": SHELL_OPTIONS,
        "languages": LANGUAGE_OPTIONS,
        "themes": THEME_OPTIONS,
        "accents": ACCENT_OPTIONS,
        "font_sizes": FONT_SIZE_OPTIONS,
        "claude_available": bool(runtime_status.get("ready")),
        "runtime": runtime_status,
        "permission_mode": allowed_permission_mode(str(settings.get("runtime", {}).get("permission_mode") or DEFAULT_PERMISSION_MODE)),
        "permission_modes": [item for item in PERMISSION_MODE_OPTIONS if item["id"] in available_permission_mode_ids()],
        "data_dir": str(DATA_DIR),
        "update": {
            "configured": bool(update_source.get("manifest_url")),
            "repository": update_source.get("repository", ""),
            "manifest_url": update_source.get("manifest_url", ""),
        },
    }


@app.get("/api/settings")
async def get_settings():
    return {
        "ok": True,
        "settings": public_settings(),
        "shells": SHELL_OPTIONS,
        "languages": LANGUAGE_OPTIONS,
        "themes": THEME_OPTIONS,
        "accents": ACCENT_OPTIONS,
        "font_sizes": FONT_SIZE_OPTIONS,
        "models": effective_model_options(),
    }


@app.get("/api/usage/daily")
async def get_daily_usage(days: int = Query(default=14, ge=7, le=90)):
    return {"ok": True, **daily_usage_ledger().daily(days)}


@app.get("/api/agent-instructions")
async def get_agent_instructions():
    return {"ok": True, **agent_instructions_store().read().as_dict()}


@app.put("/api/agent-instructions")
async def update_agent_instructions(request: Request):
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("content"), str):
        raise HTTPException(status_code=400, detail="content must be a string")
    try:
        snapshot = agent_instructions_store().write(body["content"])
    except OSError as exc:
        raise HTTPException(status_code=500, detail="保存 AGENT.md 失败；原内容已保留。") from exc
    return {"ok": True, **snapshot.as_dict()}


@app.get("/api/runtime/status")
async def get_runtime_status():
    probe = await asyncio.to_thread(agent_runtime().probe)
    return {"ok": True, "runtime": runtime_payload_from_probe(probe)}


@app.post("/api/runtime/provision")
async def provision_runtime():
    if any(run.get("kind") == "agent" for run in _active_runs.values()):
        raise HTTPException(status_code=409, detail="请等待所有 Agent 会话停止后再设置运行时")
    result = await runtime_provisioner().provision()
    if result.status == "ready":
        await asyncio.to_thread(sync_skills_to_claude, force=True)
    return {"ok": result.status == "ready", "runtime": result.as_dict()}


@app.post("/api/runtime/platform-result")
async def record_runtime_platform_result(request: Request):
    body = await request.json()
    result = runtime_provisioner().record_platform_result(bool(body.get("succeeded")))
    return {"ok": result.status != "wsl_missing", "runtime": result.as_dict()}


@app.post("/api/runtime/update")
async def update_runtime():
    result = await runtime_update_coordinator().ensure_current(APP_VERSION)
    if result.status in {"current", "compatible"}:
        await asyncio.to_thread(sync_skills_to_claude, force=True)
    return {"ok": result.status in {"current", "compatible"}, "runtime_update": result.as_dict()}


@app.put("/api/settings")
async def update_settings(request: Request):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="settings body must be an object")

    current = load_app_settings()
    incoming = body.get("settings") if isinstance(body.get("settings"), dict) else body
    merged = merge_dict(current, incoming)

    incoming_provider = incoming.get("provider") if isinstance(incoming.get("provider"), dict) else {}
    if not incoming_provider.get("api_key"):
        merged["provider"]["api_key"] = current.get("provider", {}).get("api_key", "")
    if incoming_provider.get("clear_api_key") is True:
        merged["provider"]["api_key"] = ""

    save_app_settings(merged)
    return {
        "ok": True,
        "settings": public_settings(load_app_settings()),
        "models": effective_model_options(),
        "permission_modes": [item for item in PERMISSION_MODE_OPTIONS if item["id"] in available_permission_mode_ids()],
    }


@app.get("/api/filesystem/roots")
async def get_filesystem_roots():
    settings = load_app_settings()
    default_root = resolve_existing_directory(settings.get("workspace", {}).get("default_root"), platform_default_workspace_root())
    return {
        "ok": True,
        "default_root": str(default_root),
        "roots": filesystem_roots(),
    }


@app.get("/api/filesystem/children")
async def get_filesystem_children(path: str | None = None):
    current = resolve_existing_directory(path, platform_default_workspace_root())
    directories: list[dict[str, Any]] = []
    try:
        for item in current.iterdir():
            try:
                if item.is_dir():
                    directories.append({
                        "path": str(item.resolve()),
                        "name": item.name,
                        "hidden": item.name.startswith("."),
                    })
            except Exception:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    directories.sort(key=lambda item: item["name"].lower())
    return {
        "ok": True,
        "path": str(current),
        "name": current.name or str(current),
        "parent": str(current.parent) if current.parent != current else "",
        "directories": directories[:500],
    }


@app.post("/api/filesystem/folders")
async def create_filesystem_folder(request: Request):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="folder body must be an object")
    parent = resolve_existing_directory(body.get("parent"), platform_default_workspace_root())
    name = validate_folder_name(body.get("name"))
    target = parent / name
    try:
        target.mkdir(parents=False, exist_ok=True)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "path": str(target.resolve()), "name": target.name}


def resolve_local_artifact_path(value: Any) -> Path:
    raw = str(value or "").strip().strip("\"'`")
    if not raw:
        raise HTTPException(status_code=400, detail="file path is required")
    if os.name == "nt":
        match = re.match(r"^/mnt/([a-zA-Z])/(.+)$", raw)
        if match:
            raw = f"{match.group(1).upper()}:/{match.group(2)}"
    path = Path(raw).expanduser()
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="file does not exist")
    return resolved


@app.post("/api/files/open")
async def open_local_artifact(request: Request):
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="file body must be an object")
    path = resolve_local_artifact_path(body.get("path"))
    action = str(body.get("action") or "open")
    try:
        if os.name == "nt":
            if action == "reveal":
                if path.is_dir():
                    subprocess.Popen(["explorer.exe", str(path)], close_fds=True)
                else:
                    subprocess.Popen(["explorer.exe", "/select,", str(path)], close_fds=True)
            else:
                os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            if action == "reveal":
                subprocess.Popen(["open", "-R", str(path)], close_fds=True)
            else:
                subprocess.Popen(["open", str(path)], close_fds=True)
        else:
            target = str(path.parent if action == "reveal" and path.is_file() else path)
            subprocess.Popen(["xdg-open", target], close_fds=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"open file failed: {exc}") from exc
    return {"ok": True, "path": str(path), "action": action}


@app.get("/api/diagnostics")
async def diagnostics():
    cfg = deepseek_config()
    settings = load_app_settings()
    shell = settings.get("shell", {})
    shell_id = str(shell.get("id") or "claude-code")
    runtime_probe = await asyncio.to_thread(agent_runtime().probe)
    runtime_status = runtime_payload_from_probe(runtime_probe)
    runtime_ready = bool(runtime_status.get("ready"))
    runtime_version = str(runtime_status.get("version") or "")
    runtime_detail = (
        f"ViniperRuntime / Claude Code {runtime_version}" if runtime_ready and runtime_version
        else ("ViniperRuntime 已就绪" if runtime_ready else f"ViniperRuntime：{runtime_status.get('status') or '未就绪'}")
    )
    checks = [
        {
            "id": "python",
            "label": "Python",
            "ok": True,
            "detail": sys.version.split()[0],
        },
        {
            "id": "claude",
            "label": "Claude Code CLI",
            "ok": True if shell_id == "custom-cli" else runtime_ready,
            "detail": "Custom CLI 不需要 ViniperRuntime" if shell_id == "custom-cli" else runtime_detail,
        },
        {
            "id": "claude_compatibility",
            "label": "Claude Code 兼容性",
            "ok": True if shell_id == "custom-cli" else runtime_ready,
            "detail": "Custom CLI 使用独立兼容合同" if shell_id == "custom-cli" else runtime_detail,
        },
        {
            "id": "provider",
            "label": "Model provider",
            "ok": bool((cfg["api_key"] or shell_id == "custom-cli") and cfg["base_url"]),
            "detail": f"{cfg['label']} / {cfg['base_url']}",
        },
        {
            "id": "agent_shell",
            "label": "Agent 执行壳",
            "ok": runtime_ready if shell_id == "claude-code" else bool(str(shell.get("custom_command") or "").strip()),
            "detail": runtime_detail if shell_id == "claude-code" else str(shell.get("custom_command") or "尚未配置"),
        },
        {
            "id": "data",
            "label": "User data",
            "ok": DATA_DIR.exists() or DATA_DIR.parent.exists(),
            "detail": str(DATA_DIR),
        },
        {
            "id": "static",
            "label": "Static assets",
            "ok": STATIC_DIR.exists() and (STATIC_DIR / "app.js").exists(),
            "detail": str(STATIC_DIR),
        },
    ]
    return {
        "ok": all(item["ok"] for item in checks),
        "version": APP_VERSION,
        "checks": checks,
    }


@app.post("/api/desktop/shortcut")
async def create_desktop_shortcut():
    if os.name != "nt":
        return {"ok": False, "message": "当前系统不需要 Windows 桌面快捷方式。"}
    await asyncio.to_thread(refresh_windows_shortcuts)
    return {"ok": True, "message": f"桌面和开始菜单快捷方式已指向软件版 {APP_TITLE}。"}


@app.post("/api/update/check")
async def check_update(request: Request):
    body: dict[str, Any] = {}
    try:
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()
    except Exception:
        body = {}

    source = read_update_source()
    manifest_url = str(body.get("manifest_url") or source.get("manifest_url") or "").strip()
    if not manifest_url:
        return {
            "ok": True,
            "configured": False,
            "current_version": APP_VERSION,
            "update_available": False,
            "message": "未配置更新源。发布到 GitHub Release 后，在 update_source.json 中写入 manifest_url 即可启用。",
        }

    try:
        manifest = await asyncio.to_thread(fetch_json_url, manifest_url)
        latest_version = str(manifest.get("version") or "")
        asset = choose_update_asset(manifest)
        update_available = is_newer_version(latest_version, APP_VERSION)
        return {
            "ok": True,
            "configured": True,
            "current_version": APP_VERSION,
            "latest_version": latest_version,
            "update_available": update_available,
            "manifest_url": manifest_url,
            "repository": source.get("repository", ""),
            "notes": str(manifest.get("notes") or manifest.get("changelog") or ""),
            "published_at": str(manifest.get("published_at") or ""),
            "requires_installer": update_requires_installer(manifest),
            "asset": {
                "key": asset.get("key", "app"),
                "name": asset.get("name", ""),
                "size": asset.get("size", 0),
            },
        }
    except Exception as exc:
        return {
            "ok": False,
            "configured": True,
            "current_version": APP_VERSION,
            "update_available": False,
            "manifest_url": manifest_url,
            "message": f"检查更新失败：{exc}",
        }


@app.post("/api/update/install")
async def install_update(request: Request):
    body: dict[str, Any] = {}
    try:
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()
    except Exception:
        body = {}

    source = read_update_source()
    manifest_url = str(body.get("manifest_url") or source.get("manifest_url") or "").strip()
    if not manifest_url:
        raise HTTPException(status_code=400, detail="update manifest url is not configured")

    try:
        manifest = await asyncio.to_thread(fetch_json_url, manifest_url)
        latest_version = str(manifest.get("version") or "")
        if not is_newer_version(latest_version, APP_VERSION) and not body.get("force"):
            return {
                "ok": True,
                "updated": False,
                "current_version": APP_VERSION,
                "latest_version": latest_version,
                "message": "当前已经是最新版本。",
            }
        result = await asyncio.to_thread(install_update_from_manifest, manifest, body.get("asset"))
        if result.get("installer_opened"):
            message = (
                "新版桌面安装器已下载并打开。请按安装器提示完成安装；"
                f"安装后桌面快捷方式会指向软件版 {APP_TITLE}，历史会话不会被清空。"
            )
        else:
            message = (
                "更新完成！服务器即将自动重启，新版将在几秒后可用。"
            )
            _schedule_restart()
        return {
            "ok": True,
            "updated": True,
            "previous_version": APP_VERSION,
            "latest_version": latest_version,
            "restart_required": True,
            "restarting": bool(result.get("restarting")) and not bool(result.get("installer_opened")),
            "installer_opened": bool(result.get("installer_opened")),
            "requires_installer": update_requires_installer(manifest),
            "message": message,
            "asset": result.get("asset", {}),
            "dependencies": result.get("dependencies", ""),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"install update failed: {exc}")


async def coordinated_agent_event_stream(session_id: str, run_id: str, after_sequence: int = 0):
    async for payload in agent_run_coordinator().subscribe(
        session_id,
        run_id,
        after_sequence=after_sequence,
    ):
        yield sse(payload)


@app.post("/api/chat/{session_id}")
async def chat(session_id: str, request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    user_msg = str(body.get("message", "")).strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="message is required")
    session = safe_session(session_id)
    mode = normalize_session_mode(session.get("mode"))
    peer_target_session_id = str(body.get("peer_target_session_id") or "").strip()
    peer_request: dict[str, str] | None = None
    if mode == "chat":
        if body.get("attachments"):
            raise HTTPException(status_code=400, detail="Chat sessions do not accept attachments")
        if body.get("guidance"):
            raise HTTPException(status_code=400, detail="Chat sessions do not accept guidance")
        if str(body.get("permission_mode") or "").strip():
            raise HTTPException(status_code=400, detail="Chat sessions do not accept permission mode")
        if str(body.get("interaction_mode") or "").strip() not in {"", "chat"}:
            raise HTTPException(status_code=400, detail="session mode is immutable")
        for field in ("skill", "skill_command", "slash_command", "command"):
            if str(body.get(field) or "").strip():
                raise HTTPException(status_code=400, detail="Chat sessions do not accept Agent commands")
        if peer_target_session_id:
            raise HTTPException(status_code=400, detail="Chat sessions do not accept peer messages")
    elif body.get("guidance"):
        raise HTTPException(status_code=400, detail="运行中引导必须使用当前 Agent run 的 guidance 接口")
    elif peer_target_session_id:
        if body.get("attachments") or body.get("guidance"):
            raise HTTPException(status_code=400, detail="原生跨会话消息不接受附件或 guidance")
        peer_request = await prepare_native_peer_request(session_id, peer_target_session_id, user_msg)
    model = allowed_model(str(body.get("model") or ""))
    permission_mode = None
    if mode == "agent":
        permission_mode = session_permission_mode(session)
        requested_permission_mode = str(body.get("permission_mode") or "").strip()
        if requested_permission_mode:
            validated_permission_mode = require_permission_mode(requested_permission_mode)
            if validated_permission_mode != permission_mode:
                raise HTTPException(status_code=409, detail="permission_mode does not match this session")
    attachments = [] if mode == "chat" else save_chat_attachments(session_id, body.get("attachments") or [])
    if mode == "agent":
        coordinator = agent_run_coordinator()
        if coordinator.has_active(session_id):
            raise HTTPException(status_code=409, detail="当前 Agent 会话已有任务在运行")
        display_prompt = user_msg
        if peer_request:
            display_prompt = (
                f"发送给 {str(peer_request.get('target_display_name') or peer_request.get('target_peer_name') or '目标会话')}："
                f"{str(peer_request.get('message') or user_msg)}"
            )
        accepted_turn_id = persist_accepted_agent_turn(
            session_id,
            display_prompt,
            model,
            attachments,
        )
        try:
            record = coordinator.start(
                session_id,
                lambda: stream_chat(
                    session_id,
                    user_msg,
                    bool(body.get("guidance")),
                    model,
                    permission_mode,
                    attachments,
                    peer_request=peer_request,
                    accepted_turn_id=accepted_turn_id,
                ),
                metadata={"model": model, "permission_mode": permission_mode, "input_ready": False},
            )
        except ActiveRunExists as exc:
            raise HTTPException(status_code=409, detail="当前 Agent 会话已有任务在运行") from exc
        return StreamingResponse(
            coordinated_agent_event_stream(session_id, record.run_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "X-Viniper-Run-Id": record.run_id,
            },
        )

    return StreamingResponse(
        stream_chat(
            session_id,
            user_msg,
            bool(body.get("guidance")),
            model,
            permission_mode,
            attachments,
            peer_request=peer_request,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/chat/{session_id}/events")
async def resume_agent_events(
    session_id: str,
    run_id: str = Query(min_length=1),
    after_sequence: int = Query(default=0, ge=0),
):
    snapshot = coordinated_run_snapshot(session_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    if str(snapshot.get("run_id") or "") != str(run_id):
        raise HTTPException(status_code=409, detail="Agent run has changed")
    return StreamingResponse(
        coordinated_agent_event_stream(session_id, run_id, after_sequence),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Viniper-Run-Id": run_id},
    )


@app.get("/api/sessions/{session_id}/peers")
async def get_native_peers(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True, "peer": await native_peer_status_payload(session_id)}


@app.get("/api/chat/{session_id}/queue")
async def get_agent_queue(session_id: str):
    session = safe_session(session_id)
    if normalize_session_mode(session.get("mode")) != "agent":
        raise HTTPException(status_code=409, detail="Chat 不支持 Agent 待发送队列")
    return {"ok": True, "session_id": session_id, "items": agent_queue_store().list(session_id)}


@app.post("/api/chat/{session_id}/queue")
async def enqueue_agent_message(session_id: str, request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="queue body must be an object")
    session = safe_session(session_id)
    if normalize_session_mode(session.get("mode")) != "agent":
        raise HTTPException(status_code=409, detail="Chat 不支持 Agent 待发送队列")
    coordinated_context = agent_run_coordinator().run_metadata(session_id)
    if not coordinated_context:
        raise HTTPException(status_code=409, detail="当前 Agent 未运行，请直接发送")
    message = str(body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="待发送内容不能为空")
    attachments = save_chat_attachments(session_id, body.get("attachments") or [])
    item = agent_queue_store().enqueue(
        session_id,
        message,
        model=str(coordinated_context.get("model") or allowed_model("")),
        permission_mode=str(coordinated_context.get("permission_mode") or allowed_permission_mode(None)),
        attachments=attachments,
    )
    return {"ok": True, "queued": True, "item": item}


@app.patch("/api/chat/{session_id}/queue/{item_id}")
async def edit_agent_queue_item(session_id: str, item_id: str, request: Request):
    session = safe_session(session_id)
    if normalize_session_mode(session.get("mode")) != "agent":
        raise HTTPException(status_code=409, detail="Chat 不支持 Agent 待发送队列")
    try:
        body = await request.json()
        item = agent_queue_store().edit(session_id, item_id, str(body.get("message") or ""))
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "item": item}


@app.delete("/api/chat/{session_id}/queue/{item_id}")
async def cancel_agent_queue_item(session_id: str, item_id: str):
    session = safe_session(session_id)
    if normalize_session_mode(session.get("mode")) != "agent":
        raise HTTPException(status_code=409, detail="Chat 不支持 Agent 待发送队列")
    try:
        item = agent_queue_store().cancel(session_id, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "cancelled": True, "item_id": item.get("id")}


@app.post("/api/chat/{session_id}/cancel")
async def cancel_chat(session_id: str):
    agent_queue_store().clear_authorization(session_id)
    run = _active_runs.get(session_id)
    snapshot = coordinated_run_snapshot(session_id)
    coordinated_active = bool(snapshot and snapshot.get("active"))
    if not run and not coordinated_active:
        agent_interaction_broker.invalidate(session_id, reason="cancelled")
        force_release_session_lock(session_id)
        return {"ok": True, "cancelled": False}

    if run:
        run["cancel_requested"] = True
    agent_interaction_broker.invalidate(session_id, reason="cancelled")
    if run:
        run["pending_interaction"] = None
    if coordinated_active:
        await agent_run_coordinator().request_cancel(session_id)
    if run and run.get("kind") == "chat":
        task = run.get("task") or _chat_tasks.get(session_id)
        if isinstance(task, asyncio.Task) and task is not asyncio.current_task() and not task.done():
            task.cancel()
    elif run:
        runtime = run.get("runtime")
        if runtime is not None:
            await runtime.cancel(session_id)
        else:
            await kill_process_tree(int(run.get("pid") or 0))
    if coordinated_active:
        await agent_run_coordinator().cancel(session_id)
    force_release_session_lock(session_id)
    return {"ok": True, "cancelled": True}


@app.post("/api/chat/{session_id}/guidance")
async def guide_active_agent(session_id: str, request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="guidance body must be an object")
    if set(body) - {"message"}:
        raise HTTPException(status_code=400, detail="运行中引导只接受纯文本 message")
    message = str(body.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="运行中引导不能为空")
    session = safe_session(session_id)
    if normalize_session_mode(session.get("mode")) != "agent":
        raise HTTPException(status_code=409, detail="Chat 不支持运行中引导")
    run = _active_runs.get(session_id)
    if not isinstance(run, dict) or run.get("kind") != "agent":
        raise HTTPException(status_code=409, detail="当前会话没有正在运行的 Agent 任务")
    if run.get("pending_interaction") or run.get("awaiting_interaction_ack") or agent_interaction_broker.unsettled_for(session_id):
        raise HTTPException(status_code=409, detail="请先处理当前问题或权限请求")
    try:
        result = await active_agent_input_channel.send_guidance(session_id, message)
    except ActiveAgentInputError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run_session = run.get("session_record")
    session = run_session if isinstance(run_session, dict) else safe_session(session_id)
    session.setdefault("messages", []).append({
        "role": "user",
        "content": message,
        "guidance": True,
    })
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()
    return result


@app.post("/api/chat/{session_id}/interaction")
async def answer_chat_interaction(session_id: str, request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="interaction body must be an object")
    run = _active_runs.get(session_id)
    if not run or run.get("kind") != "agent":
        raise HTTPException(status_code=409, detail="没有正在等待交互的 Agent 任务")
    try:
        result = await agent_interaction_broker.resolve(
            session_id,
            str(body.get("request_id") or ""),
            str(body.get("kind") or ""),
            str(body.get("action") or ""),
            stdin=run.get("stdin"),
            run=run,
            process_identity=str(run.get("process_identity") or ""),
            answers=body.get("answers"),
            value=body.get("value"),
        )
    except InteractionRequestError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run["pending_interaction"] = None
    request_id = str(body.get("request_id") or "")
    if str(result.get("status") or "") == "awaiting_cli_ack":
        run["awaiting_interaction_ack"] = request_id
        await agent_run_coordinator().commit_interaction_response(session_id, request_id)
    else:
        run["awaiting_interaction_ack"] = None
        await agent_run_coordinator().resolve_interaction(session_id, request_id)
    return result


@app.post("/api/sessions")
async def new_session(request: Request):
    body: dict[str, Any] = {}
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await request.json()
    sid = str(uuid.uuid4())[:8]
    mode = normalize_session_mode(body.get("mode"))
    name = str(body.get("name") or "").strip()
    if not name:
        name = next_session_name(mode)
    sessions[sid] = {
        "id": sid,
        "mode": mode,
        "messages": [],
        "created": now_ts(),
        "updated": now_ts(),
        "name": name,
        "workdir": str(body.get("workdir") or BASE_DIR),
        "pinned": False,
        "unread": False,
        "last_run_status": "",
        "claude_session_id": str(uuid.uuid4()),
        "claude_initialized": False,
        "summary": "",
        "permission_mode": allowed_permission_mode(None),
    }
    save_sessions_to_disk()
    return {
        "session_id": sid,
        "mode": mode,
        "name": sessions[sid]["name"],
        "workdir": sessions[sid]["workdir"],
        "pinned": False,
        "unread": False,
        "runtime_state": "idle",
        "updated": sessions[sid]["updated"],
        "revision": context_revision(sessions[sid]),
        "context_usage": context_usage_payload(sid),
        "permission_mode": sessions[sid]["permission_mode"],
    }


@app.get("/api/sessions")
async def list_sessions():
    return {
        "sessions": [
            {
                "id": sid,
                "mode": normalize_session_mode(session.get("mode")),
                "name": session.get("name") or sid,
                "workdir": session.get("workdir") or "",
                "count": len(session.get("messages", [])),
                "created": session.get("created", 0),
                "updated": session.get("updated", session.get("created", 0)),
                "pinned": bool(session.get("pinned")),
                "unread": bool(session.get("unread")),
                "runtime_state": session_runtime_state(sid, session),
                "pending_interaction": pending_interaction_for_session(sid),
                "active_run": coordinated_run_snapshot(sid),
                "revision": context_revision(session),
                "context_usage": context_usage_payload(sid),
                "permission_mode": str(session.get("permission_mode") or "default"),
            }
            for sid, session in sorted(sessions.items(), key=session_sort_key)
        ]
    }


@app.get("/api/sessions/last")
async def last_session(mode: str | None = None):
    if not sessions:
        return {"session": None}
    target_mode = normalize_session_mode(mode) if mode is not None else None
    scoped = [
        (sid, session) for sid, session in sessions.items()
        if target_mode is None or normalize_session_mode(session.get("mode")) == target_mode
    ]
    if not scoped:
        return {"session": None}
    candidates = [(sid, session) for sid, session in scoped if session.get("messages")]
    if not candidates:
        candidates = scoped
    sid, session = max(
        candidates,
        key=lambda item: item[1].get("updated", item[1].get("created", 0)),
    )
    return clean_payload_value({
        "session": {
            "session_id": sid,
            "mode": normalize_session_mode(session.get("mode")),
            "name": session.get("name", ""),
            "workdir": session.get("workdir", str(BASE_DIR)),
            "pinned": bool(session.get("pinned")),
            "unread": bool(session.get("unread")),
            "runtime_state": session_runtime_state(sid, session),
            "pending_interaction": pending_interaction_for_session(sid),
            "active_run": coordinated_run_snapshot(sid),
            "messages": session.get("messages", []),
            "message_count": len(session.get("messages", [])),
            "updated": session.get("updated", session.get("created", 0)),
            "revision": context_revision(session),
            "context_usage": context_usage_payload(sid),
            "permission_mode": str(session.get("permission_mode") or "default"),
        }
    })


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="session not found")
    sanitize_goal_session_messages(session_id)
    session = safe_session(session_id)
    session["unread"] = False
    sessions[session_id] = session
    save_sessions_to_disk()
    return clean_payload_value({
        "session_id": session_id,
        "mode": normalize_session_mode(session.get("mode")),
        "name": session.get("name", ""),
        "workdir": session.get("workdir", str(BASE_DIR)),
        "pinned": bool(session.get("pinned")),
        "unread": bool(session.get("unread")),
        "runtime_state": session_runtime_state(session_id, session),
        "pending_interaction": pending_interaction_for_session(session_id),
        "active_run": coordinated_run_snapshot(session_id),
        "messages": session.get("messages", []),
        "message_count": len(session.get("messages", [])),
        "updated": session.get("updated", session.get("created", 0)),
        "revision": context_revision(session),
        "context_usage": context_usage_payload(session_id),
        "permission_mode": str(session.get("permission_mode") or "default"),
    })


@app.get("/api/sessions/{session_id}/usage")
async def get_session_usage(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True, "usage": context_usage_payload(session_id)}


@app.put("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    session = safe_session(session_id)
    body = await request.json()
    metadata_changed = False
    if "name" in body:
        session["name"] = str(body.get("name") or "")
        metadata_changed = True
    if "workdir" in body:
        session["workdir"] = str(body.get("workdir") or BASE_DIR)
        metadata_changed = True
    if "pinned" in body:
        session["pinned"] = bool(body.get("pinned"))
    if "unread" in body:
        session["unread"] = bool(body.get("unread"))
    if "permission_mode" in body:
        if normalize_session_mode(session.get("mode")) != "agent":
            raise HTTPException(status_code=400, detail="Chat sessions do not accept permission mode")
        session["permission_mode"] = require_permission_mode(body.get("permission_mode"))
    if metadata_changed:
        session["updated"] = now_ts()
    save_sessions_to_disk()
    return {"ok": True, "session": session}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    if _active_runs.get(session_id):
        raise HTTPException(status_code=409, detail="运行中的会话必须先停止，才能删除。")
    existed = session_id in sessions
    sessions.pop(session_id, None)
    remove_session_runtime_data(session_id)
    context_usage_ledger().remove(session_id)
    save_sessions_to_disk()
    return {"ok": True, "deleted": existed}


@app.get("/api/skills")
async def list_skills():
    sync = await asyncio.to_thread(sync_skills_to_claude)
    public_sync = {
        key: sync.get(key)
        for key in ("ok", "linked", "updated", "unchanged", "conflicts", "viniper_only", "available", "idempotent")
    }
    return {"skills": get_skills(), "sync": public_sync}


@app.get("/api/skills/{filename:path}")
async def read_skill(filename: str):
    if not filename or not filename.endswith(".md"):
        raise HTTPException(status_code=400, detail="invalid skill filename")
    skill = next((item for item in get_skills() if item.get("id") == filename), None)
    path = skill_file_from_record(skill) if skill else None
    if not path:
        raise HTTPException(status_code=404, detail="skill not found")
    return {
        "id": filename,
        "filename": path.name,
        "source": skill.get("source", "") if skill else "",
        "display_name": skill.get("display_name", "") if skill else "",
        "display_description": skill.get("display_description", "") if skill else "",
        "display_category": skill.get("display_category", "") if skill else "",
        "claude": copy.deepcopy(skill.get("claude") or status_display("viniper_only")) if skill else status_display("viniper_only"),
        "content": path.read_text(encoding="utf-8", errors="replace"),
    }


CONTEXT_COMPRESS_THRESHOLD = 0.65
CONTEXT_LIMITS = {
    "deepseek-v4-pro[1m]": 1000000,
    "deepseek-v4-flash": 128000,
}


def context_limit_for_model(model: str) -> int:
    return CONTEXT_LIMITS.get(model, DEFAULT_CONTEXT_LIMIT)


def context_revision(session: dict[str, Any]) -> str:
    """Return a monotonic-enough revision without reading message contents."""
    updated = float(session.get("updated") or session.get("created") or 0)
    message_count = len(session.get("messages", []))
    claude_session_id = str(session.get("claude_session_id") or "")
    return f"{updated:.6f}:{message_count}:{claude_session_id}"


def split_context_messages(messages: list[dict[str, Any]], threshold_tokens: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    keep_count = min(15, len(messages) // 2)
    target_keep = 0
    char_budget = threshold_tokens * 3
    running = 0
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        running += len(str(message.get("content", ""))) + len(str(message.get("thinking", "")))
        if running > char_budget * 0.4:
            target_keep = len(messages) - index
            break
    keep_count = max(keep_count, min(target_keep, len(messages) - 1))
    keep_count = max(5, min(keep_count, len(messages)))
    return messages[:-keep_count], messages[-keep_count:]


def compression_prompt(messages: list[dict[str, Any]], existing_summary: str, threshold_tokens: int) -> str:
    old_messages, _ = split_context_messages(messages, threshold_tokens)
    lines: list[str] = []
    if existing_summary:
        lines.append(f"[此前摘要]: {existing_summary}")
    for message in old_messages:
        role = "用户" if message.get("role") == "user" else ("摘要" if message.get("role") == "system" else "助手")
        content = str(message.get("content", ""))[:800]
        if content:
            lines.append(f"[{role}]: {content}")
    conversation_text = "\n".join(lines)
    return (
        "请用简洁的中文总结以下对话历史，保留关键决策、文件路径、错误和重要结论。"
        "不要遗漏用户提出的需求或问题。控制在300字以内。\n\n"
        f"{conversation_text}"
    )


async def summarize_with_deepseek(
    messages: list[dict[str, Any]],
    existing_summary: str,
    model: str,
) -> str:
    """External fallback only; never used as proof of native Claude compaction."""
    import urllib.request

    cfg = deepseek_config()
    api_key = cfg["api_key"]
    if not api_key:
        raise ContextAdapterUnavailable("no external summary API key")

    threshold = int(context_limit_for_model(model) * CONTEXT_COMPRESS_THRESHOLD)
    summary_prompt = compression_prompt(messages, existing_summary, threshold)

    try:
        req_body = json.dumps({
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": "你是一个对话摘要助手。输出简洁摘要。"},
                {"role": "user", "content": summary_prompt},
            ],
            "max_tokens": 600,
            "temperature": 0.3,
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.deepseek.com/v1/chat/completions",
            data=req_body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )

        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None, lambda: urllib.request.urlopen(req, timeout=30)
        )
        result = json.loads(resp.read().decode("utf-8"))
        summary = result["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        raise RuntimeError(f"summary failed: {exc}") from exc

    if not summary:
        raise ContextAdapterUnavailable("external summary was empty")
    return summary


async def persist_context_summary(
    session_id: str,
    revision: str,
    summary: str,
    snapshot: list[dict[str, Any]],
    threshold_tokens: int,
) -> bool:
    current = safe_session(session_id)
    if context_revision(current) != revision:
        return False

    _, recent_messages = split_context_messages(snapshot, threshold_tokens)
    candidate = copy.deepcopy(current)
    candidate["messages"] = [
        {"role": "system", "content": f"[上下文摘要] {summary}"},
        *recent_messages,
    ]
    candidate["summary"] = summary
    candidate["claude_session_id"] = str(uuid.uuid4())
    candidate["claude_initialized"] = False
    candidate["updated"] = now_ts()
    previous = sessions.get(session_id)
    sessions[session_id] = candidate
    try:
        save_sessions_to_disk()
    except Exception:
        if previous is not None:
            sessions[session_id] = previous
        else:
            sessions.pop(session_id, None)
        raise
    return True


def context_lifecycle() -> ContextLifecycle:
    global _context_lifecycle
    if _context_lifecycle is None:
        async def unavailable_external(messages: list[dict[str, Any]], existing_summary: str) -> str:
            raise ContextAdapterUnavailable("external summary adapter requires a configured provider")

        _context_lifecycle = ContextLifecycle(
            NativeContextAdapter(),
            ExternalSummaryAdapter(unavailable_external, semantic_key="external-summary:unavailable"),
            threshold=CONTEXT_COMPRESS_THRESHOLD,
        )
    return _context_lifecycle


@app.post("/api/compress/{session_id}")
async def compress_context(session_id: str, request: Request):
    """Compatibility endpoint; native Claude Code exclusively owns compaction."""
    session = safe_session(session_id)
    return {
        "ok": True,
        "compressed": False,
        "reason": "native_compaction_only",
        "status": "idle",
        "session_id": session_id,
        "claude_session_id": str(session.get("claude_session_id") or ""),
        "usage": context_usage_payload(session_id),
    }


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _startup_cleanup() -> None:
    """Reconcile exact journaled owners and make interrupted turns visible."""
    loaded = load_sessions_from_disk()
    sessions.clear()
    sessions.update(loaded)
    recovered = reconcile_orphaned_agent_runs(
        sessions,
        journal=agent_run_journal(),
        runtime=agent_runtime(),
        interaction_store=durable_interaction_store(),
    )
    for sid, session in sessions.items():
        cleaned_messages = []
        session_changed = False
        for msg in session.get("messages", []):
            if isinstance(msg, dict) and is_leaked_goal_control_message(msg):
                session_changed = True
                continue
            if isinstance(msg, dict) and msg.get("pending"):
                session_changed = True
                detail = "应用在任务完成前重新启动；本轮已中断，可重新发送。"
                msg["content"] = str(msg.get("content") or detail)
                msg["segments"] = finalize_transcript_segments(msg.get("segments"))
                if not msg["segments"] and msg["content"]:
                    msg["segments"] = [{"type": "text", "content": msg["content"]}]
                msg["error"] = "backend_restarted"
                msg["retryable"] = True
                msg.pop("pending", None)
                msg.pop("thinking", None)
                session["last_run_status"] = "failed"
                session["unread"] = True
            cleaned_messages.append(msg)
        session["messages"] = cleaned_messages
        if session_changed:
            session["updated"] = now_ts()
    save_sessions_to_disk()
    _session_locks.clear()
    print(f"  Startup cleanup: {len(sessions)} sessions normalized; {len(recovered)} journal entries reconciled.")


if __name__ == "__main__":
    import webbrowser

    import uvicorn

    _startup_cleanup()

    port = int(env_value("VINIPER_UI_PORT", "17373"))
    url = f"http://127.0.0.1:{port}"
    print(f"\n  {APP_TITLE} -> {url}\n")
    if env_value("VINIPER_UI_OPEN_BROWSER", "1") != "0":
        webbrowser.open(url)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
