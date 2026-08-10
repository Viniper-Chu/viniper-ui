"""Persistent Viniper-wide Agent instructions stored under the active data root."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AgentInstructionsSnapshot:
    path: str
    content: str
    exists: bool
    updated_at: float | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class AgentInstructionsStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def read(self) -> AgentInstructionsSnapshot:
        if not self.path.exists():
            return AgentInstructionsSnapshot(str(self.path), "", False, None)
        content = self.path.read_text(encoding="utf-8")
        return AgentInstructionsSnapshot(
            str(self.path),
            content,
            True,
            self.path.stat().st_mtime,
        )

    def write(self, content: str) -> AgentInstructionsSnapshot:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        try:
            temporary.write_text(str(content), encoding="utf-8")
            os.replace(temporary, self.path)
        except Exception:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        return self.read()


__all__ = ["AgentInstructionsSnapshot", "AgentInstructionsStore"]
