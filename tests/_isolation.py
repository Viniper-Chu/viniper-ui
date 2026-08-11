"""Shared filesystem boundary for tests that import the server module."""

from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEST_DATA_ROOT = ROOT / "codex" / "运行残留" / "unittest-data-root"


def configure_server_data_root() -> Path:
    """Force server imports in the unittest suite into a project-local root."""
    TEST_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    (TEST_DATA_ROOT / "runtime").mkdir(parents=True, exist_ok=True)
    os.environ["VINIPER_UI_DATA_DIR"] = str(TEST_DATA_ROOT)
    os.environ["VINIPER_UI_RUNTIME_LOCATION"] = str(TEST_DATA_ROOT / "runtime")
    os.environ["VINIPER_UI_OPEN_BROWSER"] = "0"
    return TEST_DATA_ROOT
