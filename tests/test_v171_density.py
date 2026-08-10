from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RESIDUE = ROOT / "codex" / "运行残留" / "v171-density-red-green"


def run_density_harness() -> dict:
    electron = ROOT / "desktop" / "node_modules" / "electron" / "dist" / "electron.exe"
    if not electron.exists():
        raise AssertionError("bundled Electron runtime is required")
    RESIDUE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="renderer-", dir=RESIDUE) as temp:
        result_path = Path(temp) / "density.json"
        env = dict(os.environ)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        env["VINIPER_V171_DENSITY_RESULT"] = str(result_path)
        completed = subprocess.run(
            [str(electron), "--disable-error-dialog", str(ROOT / "tests" / "v171_density_harness.js")],
            cwd=ROOT,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=35,
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
        if payload.get("error"):
            raise AssertionError(payload["error"])
        return payload


class ResponsiveDensityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = run_density_harness()

    def test_half_screen_keeps_large_screen_core_density(self) -> None:
        pairs = [
            ("largeChat", "halfChat"),
            ("largeAgent", "halfAgent"),
        ]
        selectors = {
            "body": ("fontSize",),
            "#topbar": ("height", "fontSize"),
            ".topbar-nav-button": ("height", "fontSize"),
            ".topbar-nav-button .nav-icon": ("height",),
            ".view-tab": ("height", "fontSize"),
            ".view-tab-icon": ("height",),
            ".sidebar-nav-item": ("height", "fontSize"),
            "#composer": ("height", "fontSize"),
            "#user-input": ("height", "fontSize"),
            ".send-button": ("height", "fontSize"),
        }
        for large_name, half_name in pairs:
            large = self.payload[large_name]
            half = self.payload[half_name]
            for selector, keys in selectors.items():
                with self.subTest(surface=large_name, selector=selector):
                    self.assertIsNotNone(large["metrics"][selector])
                    self.assertIsNotNone(half["metrics"][selector])
                    for key in keys:
                        self.assertAlmostEqual(
                            large["metrics"][selector][key],
                            half["metrics"][selector][key],
                            delta=1.0,
                        )

    def test_half_screen_is_a_real_900_css_pixel_window_without_global_scaling(self) -> None:
        for name in ("halfChat", "halfAgent"):
            item = self.payload[name]
            self.assertLessEqual(abs(item["viewport"]["width"] - 900), 20)
            self.assertFalse(item["compactBreakpoint"])
            self.assertEqual(item["horizontalOverflow"], 0)
            for selector in ("body", "#app", "#topbar", "#composer"):
                self.assertIn(item["metrics"][selector]["zoom"], ("1", "normal"))
                self.assertEqual(item["metrics"][selector]["transform"], "none")

    def test_core_controls_remain_readable_without_shrinking_content(self) -> None:
        for name in ("largeChat", "halfChat", "largeAgent", "halfAgent"):
            item = self.payload[name]["metrics"]
            self.assertGreaterEqual(item["body"]["fontSize"], 14)
            self.assertGreaterEqual(item[".view-tab"]["fontSize"], 13)
            self.assertGreaterEqual(item[".topbar-nav-button"]["height"], 28)
            self.assertGreaterEqual(item[".topbar-nav-button .nav-icon"]["height"], 16)
            self.assertGreaterEqual(item["#user-input"]["fontSize"], 14)
            self.assertGreaterEqual(item[".send-button"]["height"], 30)

    def test_candidate_launcher_defaults_to_native_dpi(self) -> None:
        launcher = (ROOT / "codex" / "脚本工具" / "start_v13_candidate_electron.ps1").read_text(encoding="utf-8")
        self.assertIn('[ValidateSet("native", "1", "1.25", "1.5")]', launcher)
        self.assertIn('[string]$Scale = "native"', launcher)
        self.assertIn('if ($Scale -ne "native")', launcher)
        self.assertNotIn('-ArgumentList @("--remote-debugging-port=$DebugPort", "--force-device-scale-factor=$Scale")', launcher)


if __name__ == "__main__":
    unittest.main()
