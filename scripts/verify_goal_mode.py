#!/usr/bin/env python3
"""Verify Viniper UI goal-mode API state transitions."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import asyncio
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    data_dir = Path(tempfile.mkdtemp(prefix="viniper-ui-goals-"))
    os.environ["VINIPER_UI_DATA_DIR"] = str(data_dir)
    os.environ["VINIPER_UI_OPEN_BROWSER"] = "0"
    sys.path.insert(0, str(ROOT))

    server = importlib.import_module("server")

    with TestClient(server.app) as client:
        session_response = client.post("/api/sessions", json={"name": "Goal verify"})
        assert session_response.status_code == 200, session_response.text
        session_id = session_response.json()["session_id"]

        create_response = client.post(
            "/api/goals",
            json={
                "session_id": session_id,
                "prompt": "Finish a tiny verification task.",
                "model": "deepseek-v4-pro[1m]",
                "permission_mode": "default",
                "max_turns": 2,
                "auto_start": False,
            },
        )
        assert create_response.status_code == 200, create_response.text
        created = create_response.json()["goal"]
        goal_id = created["id"]
        assert created["status"] == "paused"
        assert created["session_id"] == session_id
        assert created["turn_count"] == 0
        assert created["title"].startswith("Finish a tiny verification task")

        prompt = server.build_goal_turn_prompt(created, 1)
        assert "Claude Code" not in prompt
        assert "current conversation" in prompt
        assert "dbs-goal" in prompt
        assert "Do not merely restate the goal" in prompt
        assert "single most important ambiguity" in prompt
        assert any("dbs-goal" in server.skill_aliases(skill) for skill in server.get_skills())
        next_prompt_goal = dict(created)
        next_prompt_goal["last_output"] = "First pass found a vague deliverable but did not verify it."
        next_prompt = server.build_goal_turn_prompt(next_prompt_goal, 2)
        assert "Previous goal-mode output to improve, not repeat" in next_prompt
        assert "First pass found a vague deliverable" in next_prompt
        assert server.GOAL_BETWEEN_TURN_DELAY_SECONDS >= 2.0
        assert server.goal_output_is_done("I will continue improving this.") is False
        assert server.goal_output_is_done(f"Finished.\n{server.GOAL_DONE_MARKER}") is True

        captured: dict[str, object] = {}
        original_stream_chat_impl = server.stream_chat_impl

        async def fake_stream_chat_impl(*args, **kwargs):
            captured["suppress_user_message"] = kwargs.get("suppress_user_message")
            yield server.sse({"type": "done"})

        server.stream_chat_impl = fake_stream_chat_impl
        try:
            async def collect_hidden_guidance() -> None:
                chunks = []
                async for chunk in server.stream_chat(
                    session_id,
                    "hidden goal controller prompt",
                    True,
                    "deepseek-v4-pro[1m]",
                    "default",
                    [],
                    suppress_user_message=True,
                ):
                    chunks.append(chunk)
                assert chunks

            asyncio.run(collect_hidden_guidance())
        finally:
            server.stream_chat_impl = original_stream_chat_impl

        assert captured.get("suppress_user_message") is True

        server.sessions[session_id]["messages"] = [
            {
                "role": "user",
                "content": "[GUIDANCE] Viniper UI Goal Mode is an outer controller.\n\nOriginal goal:\nsecret control text",
            },
            {
                "role": "assistant",
                "content": f"Visible answer {server.GOAL_CONTINUE_MARKER}",
                "segments": [{"type": "text", "content": f"Visible answer {server.GOAL_CONTINUE_MARKER}"}],
            },
        ]
        server.sanitize_goal_session_messages(session_id)
        cleaned_messages = server.sessions[session_id]["messages"]
        assert len(cleaned_messages) == 1
        assert cleaned_messages[0]["role"] == "assistant"
        assert server.GOAL_CONTINUE_MARKER not in cleaned_messages[0]["content"]
        assert server.GOAL_CONTINUE_MARKER not in cleaned_messages[0]["segments"][0]["content"]

        list_response = client.get("/api/goals")
        assert list_response.status_code == 200, list_response.text
        assert any(item["id"] == goal_id for item in list_response.json()["goals"])

        resume_response = client.post(f"/api/goals/{goal_id}/resume")
        assert resume_response.status_code == 200, resume_response.text
        resumed = resume_response.json()["goal"]
        assert resumed["status"] in {"running", "waiting"}

        pause_response = client.post(f"/api/goals/{goal_id}/pause")
        assert pause_response.status_code == 200, pause_response.text
        paused = pause_response.json()["goal"]
        assert paused["status"] == "paused"

        delete_response = client.delete(f"/api/goals/{goal_id}")
        assert delete_response.status_code == 200, delete_response.text
        assert delete_response.json()["deleted"] is True

        final_list = client.get("/api/goals")
        assert final_list.status_code == 200, final_list.text
        assert not any(item["id"] == goal_id for item in final_list.json()["goals"])

    print("Viniper UI goal-mode verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
