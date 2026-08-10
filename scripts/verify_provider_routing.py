#!/usr/bin/env python3
"""Verify Viniper provider settings override stale machine-wide routing."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME_ROOT = ROOT / "codex" / "运行残留"
OFFICIAL_DEEPSEEK_URL = "https://api.deepseek.com/anthropic"
LEGACY_LOCAL_URL = "http://127.0.0.1:57322"


def inspect_provider(data_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "VINIPER_UI_DATA_DIR": str(data_dir),
            "VINIPER_UI_OPEN_BROWSER": "0",
            "ANTHROPIC_BASE_URL": LEGACY_LOCAL_URL,
            "ANTHROPIC_AUTH_TOKEN": "test-token",
        }
    )
    code = (
        "import json, server; "
        "cfg=server.provider_config(); "
        "env=server.build_claude_env(); "
        "print(json.dumps({'config_url': cfg['base_url'], "
        "'claude_url': env.get('ANTHROPIC_BASE_URL', ''), "
        "'token': env.get('ANTHROPIC_AUTH_TOKEN', '')}))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(ROOT),
        env=env,
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=True,
    )
    return json.loads(completed.stdout.strip().splitlines()[-1])


def write_settings(data_dir: Path, base_url: str) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "settings.json").write_text(
        json.dumps(
            {
                "provider": {
                    "id": "deepseek",
                    "label": "DeepSeek",
                    "base_url": base_url,
                    "model": "deepseek-v4-flash",
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def verify_app_setting_wins(data_dir: Path) -> None:
    write_settings(data_dir, OFFICIAL_DEEPSEEK_URL)
    result = inspect_provider(data_dir)
    assert result["config_url"] == OFFICIAL_DEEPSEEK_URL, result
    assert result["claude_url"] == OFFICIAL_DEEPSEEK_URL, result
    assert result["token"] == "test-token", result


def verify_legacy_gateway_migrates(data_dir: Path) -> None:
    write_settings(data_dir, LEGACY_LOCAL_URL)
    result = inspect_provider(data_dir)
    assert result["config_url"] == OFFICIAL_DEEPSEEK_URL, result
    assert result["claude_url"] == OFFICIAL_DEEPSEEK_URL, result


def main() -> int:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="provider-routing-", dir=RUNTIME_ROOT) as temp_dir:
        root = Path(temp_dir)
        verify_app_setting_wins(root / "settings-wins")
        verify_legacy_gateway_migrates(root / "legacy-migration")
    print("Viniper provider routing verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
