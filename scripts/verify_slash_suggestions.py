#!/usr/bin/env python3
"""Verify slash-command suggestions stay wired into the thin UI shell."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(text: str, needle: str, detail: str) -> None:
    if needle not in text:
        raise SystemExit(detail)


def main() -> int:
    index_html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    app_js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    style_css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

    require(index_html, 'id="slash-suggestions"', "composer must include the slash suggestions popup")
    require(app_js, "CLAUDE_NATIVE_SLASH_COMMANDS", "app.js must define native Claude Code slash command suggestions")
    require(app_js, 'command: "/goal"', "slash suggestions must include Claude Code native /goal")
    if "parseGoalSlashCommand" in app_js or "openGoalModal" in app_js:
        raise SystemExit("/goal must pass through to Claude Code instead of opening Viniper UI goal mode")
    require(app_js, "renderSlashSuggestions", "app.js must render slash suggestions while typing")
    require(app_js, "acceptSlashSuggestion", "app.js must accept a selected slash suggestion")
    require(app_js, "handleSlashSuggestionKeydown", "app.js must support keyboard navigation for slash suggestions")
    require(app_js, "updateSlashSuggestions", "app.js must update suggestions on textarea input")
    require(app_js, 'panel.addEventListener("pointerdown"', "slash suggestions must support direct pointer/click selection")
    require(app_js, 'command: `/${skill.command || skill.name || skill.id}`', "skill commands must be included in slash suggestions")
    require(style_css, ".slash-suggestions", "style.css must style the slash suggestions popup")

    print("Viniper UI slash suggestion verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
