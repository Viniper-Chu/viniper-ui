"""Run the real local API with a deterministic, offline Claude process adapter."""
import argparse
import json
import os
from pathlib import Path
import socket
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--root", type=Path, required=True)
options = parser.parse_args()
project = Path(__file__).resolve().parents[2]
root = options.root.resolve()
root.mkdir(parents=True, exist_ok=True)
assert root.is_relative_to(project / "codex"), "Fixture state must stay in codex outputs"
for key in list(os.environ):
    if key.startswith(("VINIPER_", "ANTHROPIC_", "CLAUDE_", "OPENAI_")):
        os.environ.pop(key, None)
os.environ.update({"HOME": str(root), "VINIPER_UI_DATA_DIR": str(root / "data"),
                   "VINIPER_UI_DEFAULT_WORKSPACE_ROOT": str(root), "VINIPER_UI_PORT": str(options.port),
                   "VINIPER_HARNESS_WORKDIR": str(root), "NO_PROXY": "127.0.0.1,localhost"})
data = root / "data"
data.mkdir(exist_ok=True)
settings = data / "settings.json"
if not settings.exists():
    settings.write_text(json.dumps({"runtime": {"use_cli_auth": True, "cli_model": "sonnet"},
                                   "workspace": {"default_root": str(root)}}))

original_connect = socket.socket.connect
def loopback_only(self, address):
    if self.family in {socket.AF_INET, socket.AF_INET6} and address[0] not in {"127.0.0.1", "::1", "localhost"}:
        raise RuntimeError("Offline integration server rejected an external connection")
    return original_connect(self, address)
socket.socket.connect = loopback_only
sys.path.insert(0, str(project / "resources" / "viniper-ui"))
import server
from posix_runtime import PosixAgentRuntime
import uvicorn
server._agent_runtime = PosixAgentRuntime([sys.executable, str(project / "tests/fixtures/claude-stream-fixture.py")])
server._agent_runtime.probe()
print(json.dumps({"fixture": True, "port": options.port, "root": str(root), "provider_requests": 0}), flush=True)
uvicorn.run(server.app, host="127.0.0.1", port=options.port, log_level="warning")
