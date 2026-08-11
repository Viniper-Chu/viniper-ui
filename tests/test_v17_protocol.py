from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests._isolation import configure_server_data_root

configure_server_data_root()
import server
from agent_runtime import AgentRunSpec, RuntimeCapabilities, RuntimeProbe, _claude_arguments
from context_usage import ContextUsageLedger


ROOT = Path(__file__).resolve().parents[1]
RESIDUE = ROOT / "codex" / "运行残留" / "v17-red-green"


def run_renderer_harness() -> dict:
    electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
    if not electron.exists():
        raise AssertionError("bundled Electron runtime is required")
    RESIDUE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="renderer-", dir=RESIDUE) as temp:
        result_path = Path(temp) / "result.json"
        env = dict(os.environ)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        env["VINIPER_V17_RENDERER_RESULT"] = str(result_path)
        completed = subprocess.run(
            [str(electron), "--disable-error-dialog", str(ROOT / "tests" / "v17_renderer_harness.js")],
            cwd=ROOT,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=40,
            check=False,
        )
        if completed.returncode != 0 or not result_path.exists():
            raise AssertionError({
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "result_exists": result_path.exists(),
            })
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        if payload.get("__harnessError"):
            raise AssertionError(payload["__harnessError"])
        return payload


class RendererSessionAndInteractionRedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = run_renderer_harness()

    def test_session_switch_clears_dock_and_restores_only_target_truth(self) -> None:
        self.assertEqual(self.payload["initialA"], {"permissionMode": "plan", "cardCount": 1})
        self.assertEqual(self.payload["idleB"], {
            "permissionMode": "default",
            "source": "unavailable",
            "isStreaming": False,
            "cardCount": 0,
            "inputDisabled": False,
            "sendDisabled": False,
        })

    def test_commit_hides_active_card_and_matching_ack_is_idempotent(self) -> None:
        self.assertEqual(self.payload["committedA"], {
            "cardCount": 0,
            "pending": False,
            "awaiting": "permission-A",
            "status": "awaiting_cli_ack",
        })
        self.assertEqual(self.payload["restoredA"], {
            "permissionMode": "plan",
            "cardCount": 0,
            "awaiting": "permission-A",
        })
        self.assertEqual(self.payload["acceptedA"], {
            "cardCount": 0,
            "pending": False,
            "awaiting": False,
            "compactResults": 1,
        })
        self.assertEqual(self.payload["failedA"], {
            "cardCount": 1,
            "actionableControls": 0,
            "message": "owner exited",
            "pendingState": "failed",
        })

    def test_compact_boundary_and_images_are_projected_structurally(self) -> None:
        self.assertTrue(self.payload["compacting"]["a"])
        self.assertIn("正在压缩上下文", self.payload["compacting"]["notice"])
        self.assertEqual(self.payload["compacted"], {"a": False, "used": 15})
        self.assertEqual(self.payload["images"], {
            "assistant": 1,
            "tool": 1,
            "artifact": 1,
            "plainPath": 0,
        })
        self.assertEqual(self.payload["thinkingImageLive"], {"nested": True, "rendered": 1})
        self.assertEqual(self.payload["thinkingImageFinal"], {"thinkingSegments": 0, "rendered": 0})


class SessionPermissionModeRedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_sessions = dict(server.sessions)

    def tearDown(self) -> None:
        server.sessions.clear()
        server.sessions.update(self.original_sessions)

    def test_legacy_migrates_once_and_existing_sessions_keep_their_mode(self) -> None:
        settings = server.normalize_settings({"runtime": {"permission_mode": "plan"}})
        with patch.object(server, "load_app_settings", return_value=settings):
            legacy = server.normalize_session("legacy", {"id": "legacy", "mode": "agent"})
            explicit = server.normalize_session("explicit", {
                "id": "explicit", "mode": "agent", "permission_mode": "default",
            })
        self.assertEqual(legacy["permission_mode"], "plan")
        self.assertEqual(explicit["permission_mode"], "default")

    def test_auto_is_fail_closed_for_third_party_provider_and_dontask_is_discoverable_cli_extension(self) -> None:
        settings = server.normalize_settings({
            "runtime": {"permission_mode": "default", "enable_auto_mode": True, "allow_bypass_permissions": True},
        })
        capabilities = RuntimeCapabilities(
            auto_permission=True,
            permission_modes=("manual", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"),
        )
        runtime = unittest.mock.Mock()
        runtime.capabilities.return_value = capabilities
        with (
            patch.object(server, "load_app_settings", return_value=settings),
            patch.object(server, "agent_runtime", return_value=runtime),
            patch.object(server, "deepseek_config", return_value={
                "provider": "deepseek", "label": "DeepSeek", "base_url": "https://api.deepseek.example", "model": "deepseek-v4",
            }),
        ):
            modes = server.available_permission_mode_ids()
        self.assertNotIn("auto", modes)
        self.assertIn("bypassPermissions", modes)
        self.assertIn("dontAsk", {item["id"] for item in server.PERMISSION_MODE_OPTIONS})
        descriptors = {item["id"]: item for item in server.permission_mode_descriptors()}
        self.assertFalse(descriptors["auto"]["enabled"])
        self.assertTrue(descriptors["dontAsk"]["cli_only"])

    def test_bypass_is_both_session_state_and_real_cli_argument(self) -> None:
        spec = AgentRunSpec(
            session_id="A",
            claude_session_id="00000000-0000-4000-8000-000000000017",
            session_name="A",
            workdir=str(ROOT),
            model="fixture-model",
            permission_mode="bypassPermissions",
            resume=True,
        )
        command = _claude_arguments(spec, lambda value: value)
        index = command.index("--permission-mode")
        self.assertEqual(command[index + 1], "bypassPermissions")
        self.assertIn("--allow-dangerously-skip-permissions", command)
        normalized = server.normalize_session("A", {
            "id": "A", "mode": "agent", "permission_mode": "bypassPermissions",
        })
        self.assertEqual(normalized["permission_mode"], "bypassPermissions")


class NativeContextRedTests(unittest.TestCase):
    def test_current_usage_excludes_output_and_compact_boundary_is_session_scoped(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="context-", dir=RESIDUE) as temp:
            ledger = ContextUsageLedger(Path(temp) / "usage.json")
            snapshot = ledger.update_from_event(
                "A",
                {
                    "type": "result",
                    "context_window": {
                        "context_window_size": 200,
                        "current_usage": {
                            "input_tokens": 50,
                            "cache_creation_input_tokens": 20,
                            "cache_read_input_tokens": 30,
                            "output_tokens": 900,
                        },
                    },
                },
                model="fixture-model",
                fallback_limit=999,
            )
            self.assertIsNotNone(snapshot)
            self.assertEqual(snapshot.used_tokens, 100)
            self.assertEqual(snapshot.output_tokens, 900)
            self.assertEqual(snapshot.context_limit, 200)
            self.assertEqual(snapshot.ratio, 0.5)
            compacting = ledger.mark_compact_boundary("A", {"trigger": "auto", "pre_tokens": 100}, model="fixture-model", fallback_limit=200)
            self.assertTrue(compacting.compacting)
            self.assertFalse(ledger.get("B", model="fixture-model", context_limit=200).compacting)
            after = ledger.update_from_event(
                "A",
                {"context_window": {"context_window_size": 200, "current_usage": {"input_tokens": 10}}},
                model="fixture-model",
                fallback_limit=200,
            )
            self.assertFalse(after.compacting)
            self.assertEqual(after.used_tokens, 10)

    def test_legacy_cumulative_result_does_not_replace_current_window_truth(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="context-", dir=RESIDUE) as temp:
            ledger = ContextUsageLedger(Path(temp) / "usage.json")
            self.assertIsNone(ledger.update_from_event(
                "A",
                {"type": "result", "usage": {"input_tokens": 900, "output_tokens": 100}, "modelUsage": {"m": {"contextWindow": 200}}},
                model="m",
                fallback_limit=200,
            ))
            self.assertEqual(ledger.get("A", model="m", context_limit=200).source, "unavailable")

    def test_compatibility_compress_endpoint_never_replaces_claude_session(self) -> None:
        original_sessions = dict(server.sessions)
        try:
            server.sessions.clear()
            server.sessions["A"] = server.normalize_session("A", {
                "id": "A",
                "mode": "agent",
                "claude_session_id": "00000000-0000-4000-8000-000000000017",
                "messages": [{"role": "user", "content": "保留"}],
            })
            before = server.sessions["A"]["claude_session_id"]
            request = unittest.mock.Mock()
            result = asyncio.run(server.compress_context("A", request))
            self.assertFalse(result["compressed"])
            self.assertEqual(result["reason"], "native_compaction_only")
            self.assertEqual(server.sessions["A"]["claude_session_id"], before)
        finally:
            server.sessions.clear()
            server.sessions.update(original_sessions)


class StructuredImageRedTests(unittest.TestCase):
    def test_official_and_anthropic_image_shapes_normalize(self) -> None:
        raw = base64.b64encode(b"fixture-png").decode("ascii")
        direct = server.normalize_image_block({"type": "image", "data": raw, "mimeType": "image/png"}, alt="direct")
        anthropic = server.normalize_image_block({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": raw},
        }, alt="anthropic")
        self.assertEqual(direct["mime_type"], "image/png")
        self.assertEqual(anthropic["data"], raw)
        self.assertEqual(anthropic["alt"], "anthropic")

    def test_invalid_mime_base64_and_oversize_fail_closed(self) -> None:
        self.assertIsNone(server.normalize_image_block({"type": "image", "data": "AAAA", "mimeType": "image/svg+xml"}))
        self.assertIsNone(server.normalize_image_block({"type": "image", "data": "%%%", "mimeType": "image/png"}))
        with patch.object(server, "MAX_RENDER_IMAGE_BYTES", 8):
            too_large = base64.b64encode(b"123456789").decode("ascii")
            self.assertIsNone(server.normalize_image_block({"type": "image", "data": too_large, "mimeType": "image/png"}))

    def test_completed_transcript_hides_thinking_images_with_thinking(self) -> None:
        segments = [
            {"type": "thinking", "content": "内部过程", "images": [{"type": "image", "mime_type": "image/png", "data": "AAAA"}]},
            {"type": "text", "content": "最终正文"},
        ]
        self.assertEqual(server.finalize_transcript_segments(segments), [{"type": "text", "content": "最终正文"}])


class NodeEpipeRegressionTests(unittest.TestCase):
    def test_node_harness_writes_one_result_and_handles_epipe(self) -> None:
        normal = subprocess.run(
            ["node", str(ROOT / "tests" / "epipe_node_harness.js")],
            cwd=ROOT, text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False,
        )
        self.assertEqual(normal.returncode, 0, normal.stderr)
        self.assertEqual(json.loads(normal.stdout), {"ok": True, "writes": 1})
        env = dict(os.environ)
        env["VINIPER_NODE_HARNESS_FORCE_EPIPE"] = "1"
        broken = subprocess.run(
            ["node", str(ROOT / "tests" / "epipe_node_harness.js")],
            cwd=ROOT, env=env, text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False,
        )
        self.assertEqual(broken.returncode, 0, broken.stderr)
        self.assertNotIn("uncaught", broken.stderr.casefold())


class BrandAndReleaseSourceRedTests(unittest.TestCase):
    def test_formal_brand_changes_without_changing_legacy_app_id_or_preview_name(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        profiles = json.loads((ROOT / "profiles.json").read_text(encoding="utf-8"))
        self.assertEqual(package["build"]["productName"], "Viniper")
        self.assertEqual(package["build"]["appId"], "com.viniper.ui.desktop")
        self.assertEqual(profiles["preview"]["product_name"], "Viniper Preview")
        self.assertIn('else "Viniper"', (ROOT / "server.py").read_text(encoding="utf-8"))

    def test_release_sources_use_size_and_atomic_rollback_without_digest_or_release_deletion(self) -> None:
        sources = "\n".join((ROOT / path).read_text(encoding="utf-8") for path in [
            "server.py",
            "scripts/build_release.py",
            "scripts/build_desktop.py",
            "scripts/publish_release.ps1",
            "scripts/verify_release.py",
            ".github/workflows/release.yml",
        ])
        forbidden = "sha" + "256"
        self.assertNotIn(forbidden, sources.casefold())
        self.assertNotIn("deleteRelease", sources)
        self.assertNotIn("deleteRef", sources)
        self.assertIn('"size"', sources)


if __name__ == "__main__":
    unittest.main()
