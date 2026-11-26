"""Measure inline SVG motion without executing the submitted page's scripts."""
import base64
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def browser_path():
    candidates = [shutil.which(name) for name in ("chromium", "chromium-browser", "google-chrome", "msedge")]
    candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                   "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        if os.environ.get(key):
            for suffix in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"):
                candidates.append(Path(os.environ[key]) / suffix)
    return next((str(p) for p in candidates if p and Path(p).is_file()), None)


def inspect_motion(path, contacts=()):
    if not isinstance(contacts, (list, tuple)) or len(contacts) > 8 or any(
        not isinstance(pair, dict) or any(not isinstance(pair.get(k), str) or not 0 < len(pair[k]) <= 128 for k in ("tip", "target"))
        for pair in contacts
    ):
        raise ValueError("contacts 需要最多 8 对既有元素的 tip 和 target ID。")
    source = Path(path)
    if source.suffix.lower() not in (".html", ".htm", ".svg") or not source.is_file():
        raise ValueError("需要现有的 HTML 或 SVG 文件。")
    with source.open("rb") as stream:
        content = stream.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        raise ValueError("此工具仅采样 1 MiB 以内的独立 SVG 或 HTML。")
    content.decode("utf-8-sig")
    browser = browser_path()
    if not browser:
        raise ValueError("没有找到 Chromium、Chrome 或 Edge，未运行浏览器动态检查。")
    template = Path(__file__).with_name("svg-motion-probe.html").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="viniper-svg-") as temp:
        page = Path(temp) / "probe.html"
        pairs = base64.b64encode(json.dumps(contacts).encode()).decode("ascii")
        page.write_text(template.replace("__CONTACTS_BASE64__", pairs)
                        .replace("__SOURCE_BASE64__", base64.b64encode(content).decode("ascii")), encoding="utf-8")
        result = subprocess.run([browser, "--headless", "--disable-background-networking", "--disable-sync",
                                 "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                                 "--user-data-dir=" + str(Path(temp) / "profile"), "--dump-dom", page.as_uri()],
                                capture_output=True, timeout=18, check=False)
    match = re.search(r'<pre id="result">([^<]+)</pre>', result.stdout.decode("utf-8", errors="replace"))
    if not match or result.returncode:
        raise ValueError("浏览器未返回 SVG 采样结果。")
    return json.loads(html.unescape(match[1]))
