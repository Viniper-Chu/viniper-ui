import asyncio
import base64
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles


APP_TITLE = "Viniper UI"
PROFILE_NAME = "deepseek-v4-pro"
VERSION_FILE = Path(__file__).resolve().parent / "VERSION"


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
PERMISSION_MODE_OPTIONS = [
    {
        "id": "default",
        "label": "Claude 默认",
        "description": "使用 Claude Code 默认权限策略",
    },
    {
        "id": "acceptEdits",
        "label": "自动接受编辑",
        "description": "自动允许文件编辑，其他高风险操作仍按 Claude Code 策略处理",
    },
    {
        "id": "auto",
        "label": "自动",
        "description": "使用 Claude Code 的自动权限策略",
    },
    {
        "id": "plan",
        "label": "计划模式",
        "description": "先规划，减少直接执行动作",
    },
    {
        "id": "dontAsk",
        "label": "不询问",
        "description": "拒绝需要确认的操作",
    },
    {
        "id": "bypassPermissions",
        "label": "总是允许",
        "description": "跳过 Claude Code 权限确认，适合已信任的本地任务",
    },
]
PERMISSION_MODE_IDS = {item["id"] for item in PERMISSION_MODE_OPTIONS}
DEFAULT_PERMISSION_MODE = env_value("VINIPER_UI_PERMISSION_MODE", "default")
if DEFAULT_PERMISSION_MODE not in PERMISSION_MODE_IDS:
    DEFAULT_PERMISSION_MODE = "default"
RUN_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_RUN_TIMEOUT", "0"))
HEARTBEAT_INTERVAL_SECONDS = int(env_value("VINIPER_UI_HEARTBEAT_INTERVAL", "15"))
NO_OUTPUT_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_NO_OUTPUT_TIMEOUT", str(40 * 60)))
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
UPDATE_SOURCE_FILE = VERSION_FILE.with_name("update_source.json")
UPDATE_MANIFEST_URL_ENV = env_value("VINIPER_UI_UPDATE_MANIFEST_URL", "").strip()
UPDATE_REPOSITORY_ENV = env_value("VINIPER_UI_UPDATE_REPO", "").strip()
UPDATE_HTTP_TIMEOUT_SECONDS = int(env_value("VINIPER_UI_UPDATE_TIMEOUT", "45"))
DEFAULT_CONTEXT_LIMIT = 128000
MODEL_OPTIONS = [
    {
        "id": "deepseek-v4-pro[1m]",
        "label": "DeepSeek V4 Pro",
        "description": "Complex coding and long context work",
        "context": 1000000,
    },
    {
        "id": "deepseek-v4-flash",
        "label": "DeepSeek V4 Flash",
        "description": "Faster daily work",
        "context": 128000,
    },
]
SHELL_OPTIONS = [
    {
        "id": "claude-code",
        "label": "Claude Code",
        "description": "Run the Claude Code CLI as the agent shell.",
        "available": True,
    },
    {
        "id": "custom-cli",
        "label": "Custom CLI",
        "description": "Reserved for future external agent shells with a command template.",
        "available": False,
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
SETTINGS_FILE = DATA_DIR / "settings.json"
KNOWN_WORK_DIRS = [
    BASE_DIR,
]

@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(refresh_windows_shortcuts)
    yield


app = FastAPI(title=APP_TITLE, lifespan=lifespan)
sessions: dict[str, dict[str, Any]] = {}
_skills_cache: dict[str, Any] = {"time": 0.0, "items": []}
_session_locks: dict[str, asyncio.Lock] = {}
_active_runs: dict[str, dict[str, Any]] = {}


def now_ts() -> float:
    return time.time()


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
    return {
        "id": str(raw.get("id") or session_id),
        "messages": raw.get("messages") if isinstance(raw.get("messages"), list) else [],
        "created": float(raw.get("created") or now_ts()),
        "updated": float(raw.get("updated") or raw.get("created") or now_ts()),
        "name": str(raw.get("name") or ""),
        "workdir": str(raw.get("workdir") or BASE_DIR),
        "claude_session_id": new_claude_session_id(raw.get("claude_session_id")),
        "claude_initialized": bool(raw.get("claude_initialized")),
        "summary": str(raw.get("summary") or ""),
    }


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
        },
        "shell": {
            "id": "claude-code",
            "custom_command": "",
        },
        "provider": {
            "id": "deepseek",
            "label": "DeepSeek",
            "base_url": "https://api.deepseek.com/anthropic",
            "api_key": "",
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


def normalize_settings(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = merge_dict(default_settings(), raw or {})
    appearance = settings["appearance"]
    if appearance.get("language") not in {item["id"] for item in LANGUAGE_OPTIONS}:
        appearance["language"] = "zh-CN"
    if appearance.get("theme") not in {item["id"] for item in THEME_OPTIONS}:
        appearance["theme"] = "system"
    if appearance.get("accent") not in {item["id"] for item in ACCENT_OPTIONS}:
        appearance["accent"] = "viniper"

    shell = settings["shell"]
    if shell.get("id") not in {item["id"] for item in SHELL_OPTIONS}:
        shell["id"] = "claude-code"

    provider = settings["provider"]
    provider["base_url"] = str(provider.get("base_url") or "https://api.deepseek.com/anthropic").strip()
    provider["api_key"] = str(provider.get("api_key") or "").strip()
    provider["models"] = normalize_model_options(provider.get("models"))
    ids = {item["id"] for item in provider["models"]}
    if provider.get("model") not in ids:
        provider["model"] = provider["models"][0]["id"]

    workspace = settings.setdefault("workspace", {})
    workspace["default_root"] = normalize_existing_dir(workspace.get("default_root"), platform_default_workspace_root())
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


def public_settings(settings: dict[str, Any] | None = None) -> dict[str, Any]:
    safe = json.loads(json.dumps(settings or load_app_settings(), ensure_ascii=False))
    provider = safe.get("provider", {})
    api_key = str(provider.get("api_key") or "")
    provider["api_key"] = ""
    provider["api_key_configured"] = bool(api_key or merged_env(include_app_settings=False).get("ANTHROPIC_AUTH_TOKEN") or merged_env(include_app_settings=False).get("ANTHROPIC_API_KEY"))
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
            "path": str(path.resolve()),
        })

    return saved


def attachment_display_lines(attachments: list[dict[str, Any]]) -> list[str]:
    return [
        f"[附件: {item.get('name')} · {format_bytes(int(item.get('size') or 0))} · {item.get('type') or 'application/octet-stream'}]"
        for item in attachments
    ]


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def choose_update_asset(manifest: dict[str, Any], requested_asset: str | None = None) -> dict[str, Any]:
    assets = manifest.get("assets")
    if isinstance(assets, dict):
        if requested_asset and isinstance(assets.get(requested_asset), dict):
            return dict(assets[requested_asset])
        system_name = platform.system().lower()
        preferred: list[str] = []
        if "darwin" in system_name:
            preferred.extend(["macos", "darwin"])
        elif "windows" in system_name:
            preferred.extend(["windows", "win"])
        elif "linux" in system_name:
            preferred.append("linux")
        preferred.extend(["app", "source", "zip"])
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
    raise ValueError("downloaded package does not contain Viniper UI app files")


def copy_update_tree(src: Path, dst: Path) -> None:
    backup_dir = DATA_DIR / "update-backups" / time.strftime("%Y%m%d-%H%M%S")
    backup_dir.mkdir(parents=True, exist_ok=True)
    allowed_files = ["server.py", "requirements.txt", "VERSION", "update_source.json", "start.bat"]
    allowed_dirs = ["static"]

    for name in allowed_files:
        source = src / name
        target = dst / name
        if not source.exists():
            continue
        if target.exists():
            shutil.copy2(target, backup_dir / name)
        shutil.copy2(source, target)

    for name in allowed_dirs:
        source = src / name
        target = dst / name
        if not source.exists() or not source.is_dir():
            continue
        if target.exists():
            shutil.copytree(target, backup_dir / name, dirs_exist_ok=True)
            shutil.rmtree(target)
        shutil.copytree(source, target)


def install_update_from_manifest(manifest: dict[str, Any], requested_asset: str | None = None) -> dict[str, Any]:
    asset = choose_update_asset(manifest, requested_asset)
    url = str(asset.get("url") or "")
    if not url:
        raise ValueError("selected update asset has no url")

    with tempfile.TemporaryDirectory(prefix="viniper-ui-update-") as tmp:
        tmp_dir = Path(tmp)
        package_path = tmp_dir / "update.zip"
        request = urllib.request.Request(url, headers={"User-Agent": f"ViniperUI/{APP_VERSION}"})
        with urllib.request.urlopen(request, timeout=UPDATE_HTTP_TIMEOUT_SECONDS) as response:
            package_path.write_bytes(response.read())

        expected_sha = str(asset.get("sha256") or "").strip().lower()
        actual_sha = sha256_file(package_path)
        if expected_sha and actual_sha.lower() != expected_sha:
            raise ValueError("downloaded update checksum does not match manifest")

        asset_name = str(asset.get("name") or package_path.name)
        if os.name == "nt" and asset_name.lower().endswith(".exe"):
            updates_dir = DATA_DIR / "updates"
            updates_dir.mkdir(parents=True, exist_ok=True)
            installer_path = updates_dir / safe_attachment_filename(asset_name)
            shutil.copy2(package_path, installer_path)
            subprocess.Popen([str(installer_path)], cwd=str(updates_dir), close_fds=True)
            return {
                "asset": asset,
                "sha256": asset.get("sha256") or "",
                "installer": str(installer_path),
                "installer_opened": True,
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
        "sha256": asset.get("sha256") or "",
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


def next_session_name() -> str:
    existing_numbers: set[int] = set()
    for session in sessions.values():
        existing_name = str(session.get("name") or "")
        match = re.fullmatch(r"新建会话（(\d+)）", existing_name)
        if match:
            existing_numbers.add(int(match.group(1)))

    number = 1
    while number in existing_numbers:
        number += 1
    return f"新建会话（{number}）"


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
            "messages": [],
            "created": now_ts(),
            "updated": now_ts(),
            "name": next_session_name(),
            "workdir": str(BASE_DIR),
            "claude_session_id": str(uuid.uuid4()),
            "claude_initialized": False,
            "summary": "",
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


def merged_env(include_app_settings: bool = True) -> dict[str, str]:
    settings_env = load_claude_settings().get("env", {})
    result = {k: str(v) for k, v in settings_env.items() if v is not None}
    if include_app_settings:
        provider = load_app_settings().get("provider", {})
        api_key = str(provider.get("api_key") or "").strip()
        base_url = str(provider.get("base_url") or "").strip()
        model = str(provider.get("model") or "").strip()
        if api_key:
            result["ANTHROPIC_AUTH_TOKEN"] = api_key
        if base_url:
            result["ANTHROPIC_BASE_URL"] = base_url
        if model:
            result["ANTHROPIC_MODEL"] = model
    for key in (
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "CLAUDE_CODE_SUBAGENT_MODEL",
    ):
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


def allowed_permission_mode(permission_mode: str | None) -> str:
    if permission_mode in PERMISSION_MODE_IDS:
        return str(permission_mode)
    return DEFAULT_PERMISSION_MODE


def deepseek_config(model_override: str | None = None) -> dict[str, str]:
    env = merged_env()
    api_key = env.get("ANTHROPIC_AUTH_TOKEN") or env.get("ANTHROPIC_API_KEY") or ""
    base_url = env.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
    return {
        "api_key": api_key,
        "base_url": base_url.rstrip("/"),
        "model": allowed_model(model_override),
    }


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


def claude_available() -> bool:
    try:
        return bool(shutil.which("claude"))
    except Exception:
        return False


def refresh_windows_shortcuts() -> None:
    if os.name != "nt":
        return
    icon = STATIC_DIR / "assets" / "viniper-icon.ico"
    installed_candidates = [
        BASE_DIR / "Viniper UI.exe",
        BASE_DIR.parent / "Viniper UI.exe",
        Path("C:/Program Files/Viniper UI/Viniper UI.exe"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Viniper UI" / "Viniper UI.exe",
    ]
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
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $workdir
    if ($icon) {{ $shortcut.IconLocation = $icon }}
    $shortcut.Save()
  }} catch {{}}
}}
if (Test-Path -LiteralPath $desktop) {{
  $desktopLinks = @(Get-ChildItem -LiteralPath $desktop -Filter 'Viniper UI*.lnk' -ErrorAction SilentlyContinue)
  if ($desktopLinks.Count -eq 0) {{
    Update-ViniperShortcut (Join-Path $desktop 'Viniper UI.lnk')
  }} else {{
    $desktopLinks | ForEach-Object {{ Update-ViniperShortcut $_.FullName }}
  }}
}}
if (Test-Path -LiteralPath $startMenu) {{
  Update-ViniperShortcut (Join-Path $startMenu 'Viniper UI.lnk')
}}
if (Test-Path -LiteralPath $taskbar) {{
  Get-ChildItem -LiteralPath $taskbar -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object {{ $_.Name -like 'Viniper UI*.lnk' }} |
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


def build_claude_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(merged_env())
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["NO_COLOR"] = "1"
    return env


def build_system_append(session: dict[str, Any]) -> str:
    summary = str(session.get("summary") or "").strip()
    isolation_note = (
        "当前 Viniper UI 会话与其他会话隔离。只把本会话传入的历史摘要、当前工作目录和用户消息"
        "作为连续上下文；不要主动引用其他 UI 会话的记忆。"
    )
    stability_note = (
        "稳定性要求：遇到 docx、pdf、图片很多或输出很长的任务时，不要把完整文件内容、完整图片清单、"
        "大段日志或二进制内容直接打印到聊天里；优先用脚本在工作目录生成中间文件或最终文件，"
        "聊天里只返回简短摘要、关键路径和下一步。这样可以避免第三方模型网关在工具结果后卡住。"
    )
    if not summary:
        return f"{isolation_note}\n\n{stability_note}"
    return f"{isolation_note}\n\n{stability_note}\n\n以下是网页端压缩后的历史摘要，请在回答时保持连续性：{summary}"


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
    add(Path.home() / "Desktop")
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
                    if entry.name not in FILE_CHANGE_SKIP_DIRS:
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


def changed_files_summary(before: dict[str, tuple[int, int]], roots: list[Path]) -> str:
    files = changed_watch_files(before, roots)
    if not files:
        return ""
    return "\n\n修改的文件：\n" + "\n".join(files)


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


def add_dir_args(session: dict[str, Any], prompt: str, attachments: list[dict[str, Any]] | None = None) -> list[str]:
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
            result.extend(["--add-dir", resolved])
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
    filename_stem = Path(skill.get("filename", "")).stem
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
    path = PROJECT_SKILLS_DIR / str(skill["filename"])
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


async def stream_chat(
    session_id: str,
    user_msg: str,
    is_guidance: bool = False,
    model: str | None = None,
    permission_mode: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
):
    lock = session_lock(session_id)
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
        async for chunk in stream_chat_impl(session_id, user_msg, is_guidance, model, permission_mode, attachments or []):
            yield chunk
    finally:
        try:
            lock.release()
        except RuntimeError:
            pass


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
):
    cfg = deepseek_config(model)
    if not cfg["api_key"]:
        yield sse({"type": "error", "content": "未找到 DeepSeek API key，请先配置 ANTHROPIC_AUTH_TOKEN。"})
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
    if attachments:
        display_prompt = f"{display_prompt}\n\n" + "\n".join(attachment_display_lines(attachments))

    resume_existing = bool(session.get("claude_initialized"))
    if resume_existing:
        claude_session_id = new_claude_session_id(session.get("claude_session_id"))
    else:
        claude_session_id = str(uuid.uuid4())
    session["claude_session_id"] = claude_session_id
    if not suppress_user_message:
        session["messages"] = list(session.get("messages", [])) + [{"role": "user", "content": display_prompt}]
    else:
        session["messages"] = list(session.get("messages", []))
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()

    context_prompt = append_attachment_prompt(expand_skill_prompt(prompt), attachments)

    session_args = ["--resume", claude_session_id] if resume_existing else ["--session-id", claude_session_id]
    fallback_model = "deepseek-v4-flash" if selected_model != "deepseek-v4-flash" else ""

    command = [
        *claude_launcher(),
        "-p",
        context_prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        selected_model,
        *session_args,
        "--permission-mode",
        selected_permission_mode,
        *add_dir_args(session, prompt, attachments),
    ]
    if fallback_model:
        command.extend(["--fallback-model", fallback_model])
    session_name = str(session.get("name") or "").strip()
    if session_name:
        command.extend(["--name", session_name])
    system_append = build_system_append(session)
    if system_append:
        command.extend(["--append-system-prompt", system_append])

    cwd = existing_workdir(str(session.get("workdir") or ""))
    watched_file_roots = file_change_watch_roots(cwd)
    before_file_state = snapshot_watch_files(watched_file_roots)
    assistant_text = ""
    thinking_text = ""
    assistant_segments: list[dict[str, str]] = []
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

    def append_assistant_segment(kind: str, text: str) -> None:
        if not text:
            return
        segment_type = "thinking" if kind == "thinking" else "text"
        if assistant_segments and assistant_segments[-1].get("type") == segment_type:
            assistant_segments[-1]["content"] = str(assistant_segments[-1].get("content") or "") + text
        else:
            assistant_segments.append({"type": segment_type, "content": text})

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
        message["segments"] = assistant_segments
        if thinking_text:
            message["thinking"] = thinking_text
        message["pending"] = True
        session["updated"] = now_ts()
        sessions[session_id] = session
        save_sessions_to_disk()

    def finalize_assistant(content: str | None = None, thinking: str | None = None) -> None:
        nonlocal finalized
        if content is not None and content != assistant_text and not assistant_segments:
            append_assistant_segment("text", content)
        message = ensure_assistant_message()
        message["content"] = assistant_text if content is None else content
        message["model"] = selected_model
        message["segments"] = assistant_segments
        final_thinking = thinking_text if thinking is None else thinking
        if final_thinking:
            message["thinking"] = final_thinking
        message.pop("pending", None)
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
    thinking_text = "正在通过 Claude Code 分析请求...\n"
    append_assistant_segment("thinking", thinking_text)
    save_assistant_progress(force=True)
    yield sse({"type": "thinking", "content": thinking_text})

    proc = None
    stderr_task = None
    try:
        await kill_orphaned_claude_session(claude_session_id)
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=str(cwd),
            env=build_claude_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        run_info = {"pid": proc.pid, "started": now_ts(), "prompt": prompt, "cancel_requested": False}
        _active_runs[session_id] = run_info
        stderr_task = asyncio.create_task(read_stderr(proc))

        assert proc.stdout is not None
        stdout_reader = ChunkedLineReader(proc.stdout)
        started = time.monotonic()
        last_heartbeat = started
        last_process_output = started
        while True:
            elapsed = time.monotonic() - started
            remaining = RUN_TIMEOUT_SECONDS - elapsed if RUN_TIMEOUT_SECONDS > 0 else None
            if remaining is not None and remaining <= 0:
                timed_out = True
                await kill_process_tree(proc.pid)
                break
            try:
                read_timeout = 10 if remaining is None else min(10, remaining)
                raw_line = await stdout_reader.readline(read_timeout)
            except asyncio.TimeoutError:
                now = time.monotonic()
                if (
                    SAFETY_GUARDS_ENABLED
                    and
                    action_task
                    and ACTION_TASK_IDLE_TIMEOUT_SECONDS > 0
                    and now - last_process_output >= ACTION_TASK_IDLE_TIMEOUT_SECONDS
                ):
                    action_idle_timeout = True
                    await kill_process_tree(proc.pid)
                    break
                if (
                    waiting_for == "model"
                    and MODEL_IDLE_TIMEOUT_SECONDS > 0
                    and now - last_process_output >= MODEL_IDLE_TIMEOUT_SECONDS
                ):
                    no_output_timeout = True
                    no_output_stage = "model"
                    await kill_process_tree(proc.pid)
                    break
                if NO_OUTPUT_TIMEOUT_SECONDS > 0 and now - last_process_output >= NO_OUTPUT_TIMEOUT_SECONDS:
                    no_output_timeout = True
                    no_output_stage = waiting_for
                    await kill_process_tree(proc.pid)
                    break
                if (
                    SAFETY_GUARDS_ENABLED
                    and
                    external_gui_command
                    and GUI_COMMAND_TIMEOUT_SECONDS > 0
                    and now - external_gui_started >= GUI_COMMAND_TIMEOUT_SECONDS
                ):
                    external_gui_timeout = True
                    await kill_process_tree(proc.pid)
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

            event_type = data.get("type")
            if event_type == "stream_event":
                waiting_for = "model"
                event = data.get("event") if isinstance(data.get("event"), dict) else {}
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta") if isinstance(event.get("delta"), dict) else {}
                    if delta.get("type") == "thinking_delta":
                        text = clean_stream_text(str(delta.get("thinking") or ""))
                        if text:
                            thinking_text += text
                            append_assistant_segment("thinking", text)
                            save_assistant_progress()
                            yield sse({"type": "thinking", "content": text})
                    elif delta.get("type") == "text_delta":
                        text = clean_stream_text(str(delta.get("text") or ""))
                        assistant_text += text
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
                        if block.get("type") == "text":
                            full_text = clean_stream_text(str(block.get("text") or ""))
                            if full_text and full_text not in assistant_text:
                                if full_text.startswith(assistant_text):
                                    delta = full_text[len(assistant_text):]
                                else:
                                    delta = ("\n" if assistant_text else "") + full_text
                                if delta:
                                    assistant_text += delta
                                    append_assistant_segment("text", delta)
                                    save_assistant_progress()
                                    yield sse({"type": "text", "content": delta})
                        elif block.get("type") == "tool_use":
                            saw_tool_use = True
                            command_text = tool_command(block)
                            text = tool_use_text(block)
                            thinking_text += text
                            append_assistant_segment("thinking", text)
                            save_assistant_progress()
                            yield sse({"type": "thinking", "content": text})
                            if SAFETY_GUARDS_ENABLED:
                                if is_external_gui_command(command_text):
                                    external_gui_command = command_text
                                    external_gui_started = time.monotonic()
                                if is_browser_open_command(command_text):
                                    if browser_open_seen:
                                        duplicate_open_command = command_text
                                        await kill_process_tree(proc.pid)
                                        break
                                    browser_open_seen = True
                                if is_foreground_server_command(command_text):
                                    blocked_command = command_text
                                    await kill_process_tree(proc.pid)
                                    break
                    waiting_for = "tool" if saw_tool_use else "model"
                continue

            if event_type == "user":
                waiting_for = "model"
                message = data.get("message") if isinstance(data.get("message"), dict) else {}
                text = tool_result_text(message)
                if text:
                    thinking_text += text
                    append_assistant_segment("thinking", text)
                    save_assistant_progress()
                    yield sse({"type": "thinking", "content": text})
                if external_gui_command:
                    external_gui_command = ""
                    external_gui_started = 0.0
                continue

            if event_type == "result":
                waiting_for = "done"
                final_result = clean_stream_text(str(data.get("result") or ""))
                if data.get("is_error"):
                    error_text = final_result or clean_stream_text(str(data))
                    final_result = error_text
                    if not (
                        (is_missing_claude_session_error(error_text) and not retry_missing_session)
                        or (is_claude_session_in_use_error(error_text) and not retry_session_in_use)
                    ):
                        yield sse({"type": "error", "content": error_text})
                continue

        return_code = await proc.wait()
        stderr_text = await stderr_task

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
            if no_output_stage == "model" and stall_recovery_count < MODEL_STALL_RECOVERY_ATTEMPTS:
                detail = (
                    f"底层 Claude Code 在等待模型/API 响应时连续 {MODEL_IDLE_TIMEOUT_SECONDS} 秒没有输出。"
                    "这不是本地工具还在执行，而是模型请求无响应；我已停止该进程，并用同一个 Claude Code 会话自动恢复一次。"
                )
                thinking_text += f"\n{detail}\n"
                append_assistant_segment("thinking", f"\n{detail}\n")
                yield sse({"type": "thinking", "content": f"\n{detail}\n"})
                if not assistant_text:
                    assistant_text = "正在恢复底层 Claude Code 会话，请稍等。"
                    append_assistant_segment("text", assistant_text)
                    yield sse({"type": "text", "content": assistant_text})
                finalize_assistant()
                session["updated"] = now_ts()
                session["claude_initialized"] = True
                sessions[session_id] = session
                save_sessions_to_disk()
                recovery_prompt = (
                    "继续完成上一项任务。上一轮底层模型/API 在工具结果返回后长时间没有输出，"
                    "Viniper UI 已经重启 Claude Code 进程并恢复同一个会话。"
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
            finalize_assistant(assistant_text)
            session["updated"] = now_ts()
            sessions[session_id] = session
            save_sessions_to_disk()
            yield sse({"type": "done"})
            return

        if return_code != 0:
            detail = stderr_text or final_result or f"claude exited with code {return_code}"
            if is_claude_session_in_use_error(detail) and not retry_session_in_use:
                remove_last_attempt_messages(session, display_prompt)
                was_initialized = bool(session.get("claude_initialized"))
                if not was_initialized:
                    session["claude_session_id"] = str(uuid.uuid4())
                session["claude_initialized"] = was_initialized
                session["updated"] = now_ts()
                sessions[session_id] = session
                save_sessions_to_disk()
                await kill_orphaned_claude_session(claude_session_id)
                await asyncio.sleep(2 if not was_initialized else 5)
                yield sse({
                    "type": "thinking",
                    "content": "\n底层 Claude Code 会话锁仍被占用，已清理残留进程并自动重试当前消息...\n",
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

            if is_missing_claude_session_error(detail) and not retry_missing_session:
                remove_last_attempt_messages(session, display_prompt)
                session["claude_session_id"] = str(uuid.uuid4())
                session["claude_initialized"] = False
                session["updated"] = now_ts()
                sessions[session_id] = session
                save_sessions_to_disk()
                yield sse({
                    "type": "thinking",
                    "content": "\n底层 Claude Code 会话已失效，正在重建会话并重试当前消息...\n",
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

        changed_summary = changed_files_summary(before_file_state, watched_file_roots)
        if changed_summary:
            assistant_text += changed_summary
            append_assistant_segment("text", changed_summary)
            yield sse({"type": "text", "content": changed_summary})

        finalize_assistant()
        session["updated"] = now_ts()
        session["claude_initialized"] = True
        sessions[session_id] = session
        save_sessions_to_disk()
        yield sse({"type": "done"})
    except asyncio.CancelledError:
        if proc and proc.returncode is None:
            await kill_process_tree(proc.pid)
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
        if proc and proc.returncode is None:
            await kill_process_tree(proc.pid)
            if not finalized:
                interruption_note = "连接中断，已停止底层 Claude Code 进程，避免任务在后台继续运行。"
                final_content = f"{assistant_text}\n\n{interruption_note}".strip() if assistant_text else interruption_note
                finalize_assistant(final_content)
        elif not finalized:
            save_assistant_progress(force=True)
        _active_runs.pop(session_id, None)


def list_skill_files() -> list[Path]:
    if not PROJECT_SKILLS_DIR.exists():
        return []
    return sorted(p for p in PROJECT_SKILLS_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".md")


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
        name = path.stem
        category = name.split("_", 1)[0] if "_" in name else "其他"
        title = name
        desc = ""
        content = path.read_text(encoding="utf-8", errors="replace")
        metadata = skill_metadata(content)
        command = metadata.get("name") or (name.split("_", 1)[1] if "_" in name else name)
        if metadata.get("description"):
            desc = metadata["description"][:180]
        found_title = False
        for raw in content.splitlines():
            line = raw.strip()
            if line.startswith("# ") and not found_title:
                title = line[2:].strip()
                found_title = True
            elif not desc and line and not line.startswith("#") and not line.startswith("---"):
                desc = line[:120]
                break
        skills.append(
            {
                "filename": path.name,
                "name": title,
                "command": command,
                "category": category,
                "description": desc,
                "path": str(path.relative_to(BASE_DIR)),
            }
        )

    _skills_cache["time"] = now
    _skills_cache["items"] = skills
    return skills


@app.get("/")
async def index():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    asset_version = re.sub(r"[^A-Za-z0-9_.-]", "", APP_VERSION) or str(int(time.time()))
    html = html.replace("__APP_VERSION__", asset_version)
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


@app.get("/api/status")
async def status():
    cfg = deepseek_config()
    update_source = read_update_source()
    settings = public_settings()
    return {
        "ok": True,
        "mode": "claude-code-cli",
        "profile": PROFILE_NAME,
        "version": APP_VERSION,
        "configured": bool(cfg["api_key"]),
        "base_url": cfg["base_url"],
        "messages_url": messages_url(cfg["base_url"]),
        "model": cfg["model"],
        "models": effective_model_options(),
        "settings": settings,
        "shells": SHELL_OPTIONS,
        "languages": LANGUAGE_OPTIONS,
        "themes": THEME_OPTIONS,
        "accents": ACCENT_OPTIONS,
        "claude_available": claude_available(),
        "permission_mode": DEFAULT_PERMISSION_MODE,
        "permission_modes": PERMISSION_MODE_OPTIONS,
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
        "models": effective_model_options(),
    }


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
            "ok": claude_available(),
            "detail": "available" if claude_available() else "not found on PATH",
        },
        {
            "id": "provider",
            "label": "Model provider",
            "ok": bool(cfg["api_key"] and cfg["base_url"]),
            "detail": messages_url(cfg["base_url"]),
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
    return {"ok": True, "message": "桌面和开始菜单快捷方式已指向软件版 Viniper UI。"}


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
            "asset": {
                "key": asset.get("key", "app"),
                "name": asset.get("name", ""),
                "size": asset.get("size", 0),
                "sha256": asset.get("sha256", ""),
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
                "安装后桌面快捷方式会指向软件版 Viniper UI，历史会话不会被清空。"
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
            "message": message,
            "asset": result.get("asset", {}),
            "sha256": result.get("sha256", ""),
            "dependencies": result.get("dependencies", ""),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"install update failed: {exc}")


@app.post("/api/chat/{session_id}")
async def chat(session_id: str, request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid JSON body")
    user_msg = str(body.get("message", "")).strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="message is required")
    model = allowed_model(str(body.get("model") or ""))
    permission_mode = allowed_permission_mode(str(body.get("permission_mode") or ""))
    attachments = save_chat_attachments(session_id, body.get("attachments") or [])
    return StreamingResponse(
        stream_chat(session_id, user_msg, bool(body.get("guidance")), model, permission_mode, attachments),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/chat/{session_id}/cancel")
async def cancel_chat(session_id: str):
    run = _active_runs.get(session_id)
    if not run:
        force_release_session_lock(session_id)
        return {"ok": True, "cancelled": False}

    run["cancel_requested"] = True
    await kill_process_tree(int(run.get("pid") or 0))
    force_release_session_lock(session_id)
    return {"ok": True, "cancelled": True}


@app.post("/api/sessions")
async def new_session(request: Request):
    body: dict[str, Any] = {}
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await request.json()
    sid = str(uuid.uuid4())[:8]
    name = str(body.get("name") or "").strip()
    if not name:
        name = next_session_name()
    sessions[sid] = {
        "id": sid,
        "messages": [],
        "created": now_ts(),
        "updated": now_ts(),
        "name": name,
        "workdir": str(body.get("workdir") or BASE_DIR),
        "claude_session_id": str(uuid.uuid4()),
        "claude_initialized": False,
        "summary": "",
    }
    save_sessions_to_disk()
    return {"session_id": sid, "name": sessions[sid]["name"], "workdir": sessions[sid]["workdir"]}


@app.get("/api/sessions")
async def list_sessions():
    return {
        "sessions": [
            {
                "id": sid,
                "name": session.get("name") or sid,
                "workdir": session.get("workdir") or "",
                "count": len(session.get("messages", [])),
                "created": session.get("created", 0),
                "updated": session.get("updated", session.get("created", 0)),
            }
            for sid, session in sorted(
                sessions.items(),
                key=lambda item: item[1].get("updated", item[1].get("created", 0)),
                reverse=True,
            )
        ]
    }


@app.get("/api/sessions/last")
async def last_session():
    if not sessions:
        return {"session": None}
    candidates = [(sid, session) for sid, session in sessions.items() if session.get("messages")]
    if not candidates:
        candidates = list(sessions.items())
    sid, session = max(
        candidates,
        key=lambda item: item[1].get("updated", item[1].get("created", 0)),
    )
    return clean_payload_value({
        "session": {
            "session_id": sid,
            "name": session.get("name", ""),
            "workdir": session.get("workdir", str(BASE_DIR)),
            "messages": session.get("messages", []),
            "message_count": len(session.get("messages", [])),
        }
    })


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="session not found")
    session = safe_session(session_id)
    return clean_payload_value({
        "session_id": session_id,
        "name": session.get("name", ""),
        "workdir": session.get("workdir", str(BASE_DIR)),
        "messages": session.get("messages", []),
        "message_count": len(session.get("messages", [])),
    })


@app.put("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    session = safe_session(session_id)
    body = await request.json()
    if "name" in body:
        session["name"] = str(body.get("name") or "")
    if "workdir" in body:
        session["workdir"] = str(body.get("workdir") or BASE_DIR)
    session["updated"] = now_ts()
    save_sessions_to_disk()
    return {"ok": True, "session": session}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    existed = session_id in sessions
    sessions.pop(session_id, None)
    remove_session_runtime_data(session_id)
    save_sessions_to_disk()
    return {"ok": True, "deleted": existed}


@app.get("/api/skills")
async def list_skills():
    return {"skills": get_skills()}


@app.get("/api/skills/{filename}")
async def read_skill(filename: str):
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise HTTPException(status_code=400, detail="invalid skill filename")
    path = PROJECT_SKILLS_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="skill not found")
    return {
        "filename": filename,
        "content": path.read_text(encoding="utf-8", errors="replace"),
    }


@app.post("/api/compress/{session_id}")
async def compress_context(session_id: str, request: Request):
    """Compress old messages into a summary to keep context manageable.
    Uses token-based threshold matching the frontend's estimation."""
    import urllib.request

    session = safe_session(session_id)
    messages = session.get("messages", [])
    if not messages:
        return {"ok": True, "compressed": False, "reason": "no messages"}
    try:
        body = await request.json()
    except Exception:
        body = {}

    # Token estimation matching frontend: ~3 chars per token
    model = allowed_model(str(body.get("model") or merged_env().get("ANTHROPIC_MODEL", "deepseek-v4-pro[1m]")))
    context_limits = {"deepseek-v4-pro[1m]": 1000000, "deepseek-v4-flash": 128000}
    limit = context_limits.get(model, 128000)
    threshold = int(limit * 0.65)

    total_chars = sum(len(str(m.get("content", ""))) + len(str(m.get("thinking", ""))) for m in messages)
    est_tokens = total_chars // 3

    if est_tokens < threshold:
        return {"ok": True, "compressed": False, "reason": f"tokens {est_tokens} below threshold {threshold}"}

    # Keep messages until remaining tokens fit comfortably under threshold
    keep_count = min(15, len(messages) // 2)
    target_keep = 0
    char_budget = threshold * 3
    running = 0
    for i in range(len(messages) - 1, -1, -1):
        m = messages[i]
        running += len(str(m.get("content", ""))) + len(str(m.get("thinking", "")))
        if running > char_budget * 0.4:
            target_keep = len(messages) - i
            break
    keep_count = max(keep_count, min(target_keep, len(messages) - 1))
    keep_count = max(5, min(keep_count, len(messages)))

    old_messages = messages[:-keep_count]
    recent_messages = messages[-keep_count:]

    # Build a summary prompt
    lines = []
    if session.get("summary"):
        lines.append(f"[此前摘要]: {session.get('summary')}")
    for msg in old_messages:
        role = "用户" if msg.get("role") == "user" else ("摘要" if msg.get("role") == "system" else "助手")
        content = str(msg.get("content", ""))[:800]
        if content:
            lines.append(f"[{role}]: {content}")
    conversation_text = "\n".join(lines)

    summary_prompt = (
        "请用简洁的中文总结以下对话历史，保留关键决策、文件路径、错误和重要结论。"
        "不要遗漏用户提出的需求或问题。控制在300字以内。\n\n"
        f"{conversation_text}"
    )

    cfg = deepseek_config()
    api_key = cfg["api_key"]
    if not api_key:
        return {"ok": False, "reason": "no api key"}

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
        return {"ok": False, "reason": f"summary failed: {exc}"}

    # Replace old messages with a single summary message and reset the Claude Code
    # session. The next turn carries this summary into a fresh Claude Code context.
    compressed_messages = [
        {
            "role": "system",
            "content": f"[上下文摘要] {summary}",
        },
        *recent_messages,
    ]
    session["messages"] = compressed_messages
    session["summary"] = summary
    session["claude_session_id"] = str(uuid.uuid4())
    session["claude_initialized"] = False
    session["updated"] = now_ts()
    sessions[session_id] = session
    save_sessions_to_disk()

    return {"ok": True, "compressed": True, "summary": summary[:200]}


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _startup_cleanup() -> None:
    """Clear stale pending flags and force-release any held session locks."""
    load_sessions_from_disk()
    for sid, session in sessions.items():
        for msg in session.get("messages", []):
            msg.pop("pending", None)
        if session.get("messages"):
            session["updated"] = now_ts()
    save_sessions_to_disk()
    _session_locks.clear()
    print(f"  Startup cleanup: {len(sessions)} sessions normalized.")


if __name__ == "__main__":
    import webbrowser

    import uvicorn

    _startup_cleanup()

    port = int(env_value("VINIPER_UI_PORT", "17373"))
    url = f"http://127.0.0.1:{port}"
    print(f"\n  Viniper UI -> {url}\n")
    if env_value("VINIPER_UI_OPEN_BROWSER", "1") != "0":
        webbrowser.open(url)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
