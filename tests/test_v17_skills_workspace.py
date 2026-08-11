from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests._isolation import configure_server_data_root

configure_server_data_root()
import server
from agent_runtime import AgentRunSpec


ROOT = Path(__file__).resolve().parents[1]
RESIDUE = ROOT / "codex" / "运行残留" / "v17-skills-red-green"


def write_skill(
    root: Path,
    slug: str,
    *,
    title: str,
    description: str,
    frontmatter_name: str | None = None,
) -> Path:
    path = root / slug / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"---\nname: {frontmatter_name or slug}\ndescription: {description}\n---\n\n# {title}\n\n{description}\n",
        encoding="utf-8",
    )
    return path


def run_workspace_harness() -> dict:
    electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
    if not electron.is_file():
        raise AssertionError("bundled Electron runtime is required")
    RESIDUE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="renderer-", dir=RESIDUE) as temp:
        result_path = Path(temp) / "skills-workspace.json"
        env = dict(os.environ)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        env["VINIPER_V17_SKILLS_RESULT"] = str(result_path)
        completed = subprocess.run(
            [str(electron), "--disable-error-dialog", str(ROOT / "tests" / "v17_skills_workspace_harness.js")],
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
        if not result_path.is_file():
            raise AssertionError({
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "result_exists": result_path.exists(),
            })
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        if payload.get("error"):
            raise AssertionError(payload["error"])
        if completed.returncode != 0:
            raise AssertionError({
                "returncode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "payload": payload,
            })
        return payload


class SkillsWorkspaceGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = run_workspace_harness()

    def test_skills_is_a_workspace_page_directly_below_mode_bar(self) -> None:
        for name in ("large", "half"):
            item = self.payload[name]["open"]
            self.assertFalse(item["hidden"])
            self.assertAlmostEqual(item["skills"]["left"], item["main"]["left"], delta=1.0)
            self.assertAlmostEqual(item["skills"]["top"], item["modeBar"]["bottom"], delta=1.0)
            self.assertLessEqual(item["skills"]["right"], item["viewport"]["width"] + 1)
            self.assertLessEqual(item["skills"]["bottom"], item["viewport"]["height"] + 1)
            self.assertGreaterEqual(item["layout"]["height"], item["skills"]["height"] * 0.62)
            self.assertAlmostEqual(item["viewport"]["dpr"], 1.5, delta=0.05)

    def test_conversation_surfaces_are_inert_and_hidden_while_skills_is_open(self) -> None:
        for name in ("large", "half"):
            item = self.payload[name]["open"]
            for surface in ("chat", "messages", "input", "dock"):
                value = item[surface]
                self.assertTrue(value["inert"] or value["visibility"] == "hidden" or value["display"] == "none")
                self.assertEqual(value["ariaHidden"], "true")
                self.assertEqual(value["pointerEvents"], "none")

    def test_half_screen_reflows_without_global_shrink(self) -> None:
        self.assertGreaterEqual(len(self.payload["large"]["open"]["gridColumns"].split()), 2)
        self.assertEqual(len(self.payload["half"]["open"]["gridColumns"].split()), 1)
        # Windows' hidden-titlebar frame can add two CSS pixels at DPR 1.5.
        self.assertAlmostEqual(self.payload["half"]["open"]["viewport"]["width"], 900, delta=3)

    def test_skill_markdown_code_controls_stay_inside_their_code_block(self) -> None:
        for name in ("large", "half"):
            evidence = self.payload[name]["open"]["codeBlocks"]
            self.assertTrue(evidence["contained"], evidence)

    def test_return_restores_same_session_messages_and_scroll(self) -> None:
        for name in ("large", "half"):
            item = self.payload[name]
            self.assertTrue(item["closed"]["hidden"])
            self.assertEqual(item["before"]["sessionId"], item["open"]["state"]["sessionId"])
            self.assertEqual(item["before"]["sessionId"], item["closed"]["state"]["sessionId"])
            self.assertEqual(item["before"]["messages"], item["closed"]["state"]["messages"])
            self.assertAlmostEqual(item["before"]["scrollTop"], item["closed"]["state"]["scrollTop"], delta=1.0)
            self.assertFalse(item["closed"]["chat"]["inert"])
            self.assertNotEqual(item["closed"]["chat"]["ariaHidden"], "true")


class SkillsMetadataAndSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        RESIDUE.mkdir(parents=True, exist_ok=True)
        self.temp = Path(tempfile.mkdtemp(prefix="metadata-", dir=RESIDUE))
        self.claude = self.temp / "claude"
        self.agents = self.temp / "agents"
        write_skill(
            self.claude,
            "hermes-multi-model-setup",
            title="Hermes Multi-Model Routing Setup",
            description="Configure Hermes Agent to route simple and complex requests.",
        )
        write_skill(
            self.claude,
            "hermetic-package-install",
            title="Hermetic Package Install",
            description="Install packages in a managed Hermes environment.",
        )
        write_skill(
            self.claude,
            "latex-equation-to-image",
            title="LaTeX Equation to PNG Image",
            description="Render LaTeX equations as PNG images.",
        )
        self.old_roots = server.SKILL_SOURCE_ROOTS
        self.old_dirs = server.PROJECT_SKILLS_DIRS
        self.old_cache = server._skills_cache
        server.SKILL_SOURCE_ROOTS = [("global-claude", self.claude), ("global-agents", self.agents)]
        server.PROJECT_SKILLS_DIRS = [self.claude, self.agents]
        server._skills_cache = {"time": 0.0, "items": []}

    def tearDown(self) -> None:
        server.SKILL_SOURCE_ROOTS = self.old_roots
        server.PROJECT_SKILLS_DIRS = self.old_dirs
        server._skills_cache = self.old_cache
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_known_english_metadata_has_maintainable_chinese_display_without_changing_identity(self) -> None:
        items = {item["slug"]: item for item in server.get_skills()}
        expected = {
            "hermes-multi-model-setup": "Hermes 多模型路由配置",
            "hermetic-package-install": "Hermes 隔离包安装",
            "latex-equation-to-image": "LaTeX 公式转 PNG 图片",
        }
        for slug, title in expected.items():
            with self.subTest(slug=slug):
                item = items[slug]
                self.assertNotEqual(item["name"], title)
                self.assertEqual(item["display_name"], title)
                self.assertRegex(item["display_description"], r"[\u4e00-\u9fff]")
                self.assertEqual(item["id"], f"global-claude:{slug}/SKILL.md")
                self.assertEqual(item["path"], f"global-claude/{slug}/SKILL.md")
                self.assertEqual(item["command"], slug)
                self.assertEqual(item["category"], "global-claude")
                self.assertRegex(item["display_category"], r"[\u4e00-\u9fff]")

    def test_command_comes_from_official_top_level_directory_not_frontmatter_display_name(self) -> None:
        write_skill(
            self.claude,
            "stable-command",
            title="A Friendly Display Title",
            description="A useful skill with an English description.",
            frontmatter_name="Friendly Name With Spaces",
        )
        server._skills_cache = {"time": 0.0, "items": []}
        item = next(skill for skill in server.get_skills() if skill["slug"] == "stable-command")
        self.assertEqual(item["command"], "stable-command")
        self.assertEqual(item["name"], "Friendly Name With Spaces")
        self.assertEqual(item["id"], "global-claude:stable-command/SKILL.md")

    def test_command_preserves_underscore_in_official_directory_slug(self) -> None:
        write_skill(
            self.claude,
            "stable_command",
            title="Stable command heading",
            description="A useful skill.",
            frontmatter_name="Stable command display",
        )
        server._skills_cache = {"time": 0.0, "items": []}
        item = next(skill for skill in server.get_skills() if skill["slug"] == "stable_command")
        self.assertEqual(item["command"], "stable_command")

    def test_frontmatter_name_precedes_heading_for_personal_skill_display(self) -> None:
        write_skill(
            self.claude,
            "frontmatter-wins",
            title="Heading must not replace metadata",
            description="A useful skill.",
            frontmatter_name="Frontmatter Display Name",
        )
        server._skills_cache = {"time": 0.0, "items": []}
        item = next(skill for skill in server.get_skills() if skill["slug"] == "frontmatter-wins")
        self.assertEqual(item["name"], "Frontmatter Display Name")

    def test_only_official_top_level_skill_directories_are_listed(self) -> None:
        nested = self.claude / "temporary-repo" / "examples" / "nested-copy" / "SKILL.md"
        nested.parent.mkdir(parents=True, exist_ok=True)
        nested.write_text("---\nname: nested-copy\n---\n# Nested copy\n", encoding="utf-8")
        server._skills_cache = {"time": 0.0, "items": []}
        ids = {item["id"] for item in server.get_skills()}
        self.assertNotIn("global-claude:temporary-repo/examples/nested-copy/SKILL.md", ids)

    def test_personal_claude_source_precedes_generic_duplicate(self) -> None:
        write_skill(
            self.agents,
            "hermes-multi-model-setup",
            title="Generic duplicate",
            description="Lower priority duplicate.",
        )
        server._skills_cache = {"time": 0.0, "items": []}
        ids = [item["id"] for item in server.get_skills() if item["slug"] == "hermes-multi-model-setup"]
        self.assertEqual(ids[0], "global-claude:hermes-multi-model-setup/SKILL.md")
        self.assertEqual(ids[1], "global-agents:hermes-multi-model-setup/SKILL.md")

    def test_unknown_english_skill_has_specific_chinese_fallback_without_fake_translation(self) -> None:
        write_skill(
            self.claude,
            "unknown-alpha",
            title="Heading alpha",
            description="Does alpha work.",
            frontmatter_name="Alpha Tool",
        )
        write_skill(
            self.claude,
            "unknown-beta",
            title="Heading beta",
            description="Does beta work.",
            frontmatter_name="Beta Tool",
        )
        server._skills_cache = {"time": 0.0, "items": []}
        items = {item["slug"]: item for item in server.get_skills()}
        alpha = items["unknown-alpha"]
        beta = items["unknown-beta"]
        self.assertEqual(alpha["display_name"], "本地技能 · Alpha Tool")
        self.assertIn("/unknown-alpha", alpha["display_description"])
        self.assertIn("原始标题：Alpha Tool", alpha["display_description"])
        self.assertIn("/unknown-beta", beta["display_description"])
        self.assertNotEqual(alpha["display_description"], beta["display_description"])

    def test_every_card_has_honest_chinese_display_fields_and_preserves_raw_identity(self) -> None:
        write_skill(self.claude, "unknown-alpha", title="Alpha Tool", description="Does alpha work.")
        server._skills_cache = {"time": 0.0, "items": []}
        for item in server.get_skills():
            with self.subTest(skill=item["id"]):
                self.assertRegex(item["display_name"], r"[\u4e00-\u9fff]")
                self.assertRegex(item["display_description"], r"[\u4e00-\u9fff]")
                self.assertTrue(item["name"])
                self.assertEqual(item["command"], item["slug"])

    def test_sync_to_official_claude_skills_path_is_copy_only_conflict_safe_and_idempotent(self) -> None:
        write_skill(
            self.agents,
            "hermes-multi-model-setup",
            title="Duplicate",
            description="Must not overwrite the higher-priority source.",
        )
        write_skill(self.agents, "existing-user-skill", title="Source", description="Source copy")
        sync = getattr(server, "sync_skills_to_claude", None)
        self.assertIsNotNone(sync, "server must expose the production skill sync seam")
        calls: list[str] = []

        def runner(script: str) -> subprocess.CompletedProcess:
            calls.append(script)
            reason = "linked" if len(calls) == 1 else "unchanged"
            output = "\n".join([
                f"VINIPER_SKILL\tavailable\tglobal-claude:hermes-multi-model-setup/SKILL.md\t{reason}",
                f"VINIPER_SKILL\tavailable\tglobal-claude:hermetic-package-install/SKILL.md\t{reason}",
                f"VINIPER_SKILL\tavailable\tglobal-claude:latex-equation-to-image/SKILL.md\t{reason}",
                "VINIPER_SKILL\tconflict\tglobal-agents:hermes-multi-model-setup/SKILL.md\tmanaged_name_conflict",
                "VINIPER_SKILL\tconflict\tglobal-agents:existing-user-skill/SKILL.md\tpersonal_skill_exists",
            ])
            return subprocess.CompletedProcess(["wsl.exe"], 0, stdout=output, stderr="")

        manifest = self.temp / "runtime" / "claude-skill-bridge.json"
        kwargs = {
            "bridge_root": "/tmp/viniper-skill-fixture",
            "user_skills_root": "/tmp/viniper-home/.claude/skills",
            "command_runner": runner,
            "path_mapper": lambda value: str(value).replace("\\", "/"),
            "manifest_path": manifest,
            "force": True,
        }
        first = sync(**kwargs)
        second = sync(**kwargs)

        self.assertIn('skills_root="$bridge_root/.claude/skills"', calls[0])
        self.assertIn('ln -s "$source_dir" "$temporary"', calls[0])
        self.assertNotIn("cp -", calls[0])
        self.assertTrue(manifest.is_file())
        manifest_payload = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertEqual(manifest_payload["bridge_root"], "/tmp/viniper-skill-fixture")
        self.assertIn("global-claude:hermes-multi-model-setup/SKILL.md", {
            item["source_id"] for item in manifest_payload["skills"]
        })
        self.assertGreaterEqual(first["linked"], 3)
        self.assertGreaterEqual(first["conflicts"], 2)
        self.assertEqual(second["linked"], 0)
        self.assertEqual(second["updated"], 0)
        self.assertTrue(second["idempotent"])
        statuses = second["statuses"]
        self.assertEqual(statuses["global-claude:hermes-multi-model-setup/SKILL.md"]["state"], "available")
        self.assertEqual(statuses["global-agents:hermes-multi-model-setup/SKILL.md"]["state"], "conflict")
        self.assertEqual(statuses["global-agents:existing-user-skill/SKILL.md"]["state"], "conflict")

    def test_agent_run_spec_and_final_wsl_command_include_managed_skill_add_dir(self) -> None:
        session = {"workdir": str(ROOT)}
        directories = server.agent_add_dirs(session, "普通任务", [])
        bridge_root = server.claude_skill_bridge_root()
        self.assertIn(bridge_root, directories)
        spec = AgentRunSpec(
            session_id="skills-session",
            claude_session_id="00000000-0000-4000-8000-000000000001",
            session_name="skills-session",
            workdir=str(ROOT),
            model="fake-model",
            permission_mode="default",
            resume=False,
            add_dirs=tuple(directories),
        )
        command = server.agent_runtime().build_command(spec)
        pairs = list(zip(command, command[1:]))
        self.assertIn(("--add-dir", bridge_root), pairs)

    @unittest.skipUnless(os.environ.get("VINIPER_RUN_WSL_SKILL_DISCOVERY") == "1", "explicit local WSL discovery probe")
    def test_managed_claude_cli_discovers_skill_from_isolated_home_without_provider(self) -> None:
        sync = getattr(server, "sync_skills_to_claude", None)
        self.assertIsNotNone(sync)
        home = server.agent_runtime().map_path(str(self.temp / "wsl-home"))
        bridge = f"{home}/viniper-skill-library"
        user_skills = f"{home}/.claude/skills"
        result = sync(
            bridge_root=bridge,
            user_skills_root=user_skills,
            manifest_path=self.temp / "runtime" / "wsl-skill-bridge.json",
            force=True,
        )
        repeat = sync(
            bridge_root=bridge,
            user_skills_root=user_skills,
            manifest_path=self.temp / "runtime" / "wsl-skill-bridge.json",
            force=True,
        )
        self.assertGreaterEqual(result["available"], 3)
        self.assertEqual(repeat["linked"], 0)
        self.assertTrue(repeat["idempotent"])
        debug_file = f"{home}/claude-debug.log"
        command = (
            f'export HOME={shlex.quote(home)}; export PATH="/home/viniper/.local/bin:$PATH"; '
            'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; '
            'export ANTHROPIC_API_KEY="local-fixture"; '
            'export ANTHROPIC_BASE_URL="http://127.0.0.1:9"; '
            f'timeout 10 claude --bare --no-chrome --add-dir {shlex.quote(bridge)} '
            f'--debug-file {shlex.quote(debug_file)} -p /hermes-multi-model-setup '
            '>/dev/null 2>&1 || true; '
            f'test -f {shlex.quote(debug_file)}; '
            f'grep -F "getSkills returning: 3 skill dir commands" {shlex.quote(debug_file)}'
        )
        completed = subprocess.run(
            ["wsl.exe", "-d", "ViniperRuntime", "--user", "viniper", "--exec", "bash", "-lc", command],
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
        combined = f"{completed.stdout}\n{completed.stderr}"
        self.assertEqual(completed.returncode, 0, combined)
        self.assertIn("getSkills returning: 3 skill dir commands", combined)


if __name__ == "__main__":
    unittest.main()
