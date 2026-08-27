"""Expose compatible Viniper skills through Claude Code's official add-dir path.

Viniper keeps each source directory authoritative.  The managed WSL bridge
contains Linux symlinks only; it never overwrites a personal Claude skill with
the same command name.
"""

from __future__ import annotations

import json
import re
import shlex
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping


MANIFEST_VERSION = 1
SKILL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

SOURCE_DISPLAY_NAMES = {
    "project-claude": "项目 Claude 技能",
    "project-app-claude": "Viniper 内置 Claude 技能",
    "project-app-agents": "Viniper 内置技能",
    "project-agents": "项目通用技能",
    "global-claude": "Claude 用户技能",
    "global-codex": "Codex 用户技能",
    "global-agents": "通用用户技能",
    "local": "本地技能",
}

ZH_CN_SKILL_METADATA = {
    "hermes-multi-model-setup": {
        "name": "Hermes 多模型路由配置",
        "description": "配置 Hermes Agent 的多模型路由，让简单任务使用轻量模型、复杂任务交由高能力模型，并包含配置与验证步骤。",
    },
    "hermetic-package-install": {
        "name": "Hermes 隔离包安装",
        "description": "在 Hermes 的隔离 Python 环境中安装依赖，并处理系统级限制与依赖链。",
    },
    "latex-equation-to-image": {
        "name": "LaTeX 公式转 PNG 图片",
        "description": "使用 LaTeX 与 ImageMagick 将公式渲染为 PNG 图片，适合需要可视公式输出的场景。",
    },
}

STATUS_DISPLAY = {
    "available": ("Claude Code 可用", "已通过 Claude Code 官方 add-dir 技能路径发现。"),
    "viniper_only": ("仅 Viniper 可用", "该项目不是 Claude Code 可直接发现的 SKILL.md 目录。"),
    "conflict": ("存在同名冲突", "Claude Code 已有同名技能，Viniper 未覆盖它。"),
}


def contains_cjk(value: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


def localized_skill_fields(record: Mapping[str, Any]) -> dict[str, str]:
    slug = str(record.get("command") or record.get("slug") or "").strip()
    raw_name = str(record.get("name") or slug or "未命名技能").strip()
    raw_description = str(record.get("description") or "").strip()
    localized = ZH_CN_SKILL_METADATA.get(slug, {})
    if localized.get("name"):
        display_name = str(localized["name"])
    elif contains_cjk(raw_name):
        display_name = raw_name
    else:
        # Do not invent a semantic translation for an unknown local skill.
        # The Chinese prefix makes the UI explicit while preserving the
        # original title verbatim for recognition and search.
        display_name = f"本地技能 · {raw_name}"
    if localized.get("description"):
        display_description = str(localized["description"])
    elif contains_cjk(raw_description):
        display_description = raw_description
    else:
        display_description = (
            f"暂无中文简介。命令：/{slug or 'unknown'}；原始标题：{raw_name}。"
            "可打开详情查看原始说明。"
        )
    source = str(record.get("source") or record.get("category") or "local")
    return {
        "display_name": display_name,
        "display_description": display_description,
        "display_category": SOURCE_DISPLAY_NAMES.get(source, "本地技能"),
    }


def status_display(state: str, detail: str = "") -> dict[str, str]:
    normalized = state if state in STATUS_DISPLAY else "viniper_only"
    label, fallback = STATUS_DISPLAY[normalized]
    return {"state": normalized, "label": label, "detail": str(detail or fallback)}


def _atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(dict(payload), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _candidate(record: Mapping[str, Any], path_mapper: Callable[[str], str]) -> dict[str, str] | None:
    source_file = Path(str(record.get("absolute_path") or ""))
    name = str(record.get("command") or record.get("slug") or "").strip()
    if source_file.name.lower() != "skill.md" or not source_file.is_file():
        return None
    if not SKILL_NAME_PATTERN.fullmatch(name):
        return None
    return {
        "id": str(record.get("id") or ""),
        "name": name,
        "source": path_mapper(str(source_file.parent)),
        "source_path": str(record.get("path") or ""),
    }


def build_wsl_skill_bridge_script(
    candidates: Iterable[Mapping[str, str]],
    *,
    bridge_root: str,
    user_skills_root: str = "",
) -> str:
    bridge = shlex.quote(str(bridge_root))
    user_root = shlex.quote(str(user_skills_root)) if user_skills_root else '"$HOME/.claude/skills"'
    lines = [
        "set -eu",
        f"bridge_root={bridge}",
        'skills_root="$bridge_root/.claude/skills"',
        f"user_skills_root={user_root}",
        'mkdir -p "$skills_root"',
    ]
    for item in candidates:
        record_id = shlex.quote(str(item["id"]))
        name = shlex.quote(str(item["name"]))
        source = shlex.quote(str(item["source"]))
        lines.extend([
            f"record_id={record_id}",
            f"skill_name={name}",
            f"source_dir={source}",
            'target="$skills_root/$skill_name"',
            'user_target="$user_skills_root/$skill_name"',
            'if [ ! -f "$source_dir/SKILL.md" ]; then',
            '  printf "VINIPER_SKILL\\tviniper_only\\t%s\\tsource_unavailable\\n" "$record_id"',
            'elif [ -e "$user_target" ] || [ -L "$user_target" ]; then',
            '  printf "VINIPER_SKILL\\tconflict\\t%s\\tpersonal_skill_exists\\n" "$record_id"',
            'elif [ -L "$target" ]; then',
            '  current="$(readlink "$target")"',
            '  if [ "$current" = "$source_dir" ]; then',
            '    printf "VINIPER_SKILL\\tavailable\\t%s\\tunchanged\\n" "$record_id"',
            '  else',
            '    printf "VINIPER_SKILL\\tconflict\\t%s\\tmanaged_name_conflict\\n" "$record_id"',
            '  fi',
            'elif [ -e "$target" ]; then',
            '  printf "VINIPER_SKILL\\tconflict\\t%s\\tmanaged_name_conflict\\n" "$record_id"',
            'else',
            '  temporary="$skills_root/.viniper-${skill_name}-$$"',
            '  ln -s "$source_dir" "$temporary"',
            '  mv "$temporary" "$target"',
            '  printf "VINIPER_SKILL\\tavailable\\t%s\\tlinked\\n" "$record_id"',
            'fi',
        ])
    return "\n".join(lines) + "\n"


def parse_wsl_skill_bridge_output(output: str) -> dict[str, tuple[str, str]]:
    parsed: dict[str, tuple[str, str]] = {}
    for raw in str(output or "").splitlines():
        parts = raw.strip().split("\t", 3)
        if len(parts) != 4 or parts[0] != "VINIPER_SKILL":
            continue
        state, record_id, detail = parts[1:]
        if state not in STATUS_DISPLAY:
            continue
        parsed[record_id] = (state, detail)
    return parsed


def synchronize_skill_records(
    records: Iterable[Mapping[str, Any]],
    *,
    bridge_root: str,
    path_mapper: Callable[[str], str],
    command_runner: Callable[[str], Any],
    manifest_path: Path,
    user_skills_root: str = "",
) -> dict[str, Any]:
    materialized = [dict(record) for record in records]
    statuses: dict[str, dict[str, str]] = {}
    candidates: list[dict[str, str]] = []
    for record in materialized:
        record_id = str(record.get("id") or "")
        candidate = _candidate(record, path_mapper)
        if candidate is None:
            statuses[record_id] = status_display("viniper_only")
        else:
            candidates.append(candidate)

    script = build_wsl_skill_bridge_script(
        candidates,
        bridge_root=bridge_root,
        user_skills_root=user_skills_root,
    )
    completed = command_runner(script)
    returncode = int(getattr(completed, "returncode", 1) or 0)
    parsed = parse_wsl_skill_bridge_output(str(getattr(completed, "stdout", "") or ""))
    linked = unchanged = conflicts = 0
    for candidate in candidates:
        record_id = candidate["id"]
        state, reason = parsed.get(record_id, ("viniper_only", "bridge_result_missing"))
        if returncode != 0 and record_id not in parsed:
            reason = "bridge_command_failed"
        if state == "available":
            if reason == "linked":
                linked += 1
            else:
                unchanged += 1
            detail = "已通过 Claude Code 官方 add-dir 技能路径发现。"
        elif state == "conflict":
            conflicts += 1
            detail = "Claude Code 已有同名技能，Viniper 未覆盖它。"
        else:
            detail = "Claude Code 无法读取该技能源，当前仅在 Viniper 中展示。"
        statuses[record_id] = status_display(state, detail)

    viniper_only = sum(1 for item in statuses.values() if item["state"] == "viniper_only")
    available = sum(1 for item in statuses.values() if item["state"] == "available")
    manifest = {
        "version": MANIFEST_VERSION,
        "bridge_root": bridge_root,
        "skills": [
            {
                "source_id": candidate["id"],
                "command": candidate["name"],
                "source_path": candidate["source_path"],
                "state": statuses[candidate["id"]]["state"],
            }
            for candidate in candidates
        ],
    }
    _atomic_json(Path(manifest_path), manifest)
    return {
        "ok": returncode == 0,
        "target": bridge_root,
        "linked": linked,
        "updated": 0,
        "unchanged": unchanged,
        "conflicts": conflicts,
        "viniper_only": viniper_only,
        "available": available,
        "idempotent": linked == 0,
        "statuses": statuses,
    }
