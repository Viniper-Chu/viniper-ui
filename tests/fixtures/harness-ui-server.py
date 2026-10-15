"""Real Harness/HTTP desktop fixture, with explicit Demo and external network disabled."""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--root", type=Path, required=True)
options = parser.parse_args()
repository = Path(__file__).resolve().parents[2]
root = options.root.resolve()
assert root.is_relative_to(repository / "codex")
root.mkdir(parents=True, exist_ok=True)
project = root / "project"
project.mkdir(exist_ok=True)
(project / "harness-local.txt").write_text("HARNESS_LOCAL_READ_OK\n", encoding="utf-8")
for name in list(os.environ):
    if name.startswith(("VINIPER_", "ANTHROPIC_", "CLAUDE_", "OPENAI_")):
        os.environ.pop(name, None)
os.environ.update({"VINIPER_UI_DATA_DIR": str(root / "data"),
                   "VINIPER_UI_DEFAULT_WORKSPACE_ROOT": str(project),
                   "VINIPER_UI_PORT": str(options.port), "VINIPER_UI_DEMO_ONLY": "1",
                   "VINIPER_DEMO_FIXTURE": "pending-tool",
                   "VINIPER_UI_ASSET_VERSION": f"fixture-{time.time_ns()}",
                   "VINIPER_HARNESS_ALLOW_EXTERNAL_NETWORK": "0",
                   "VINIPER_HARNESS_WORKDIR": str(project),
                   "CLAUDE_CONFIG_DIR": str(root / "claude"), "NO_PROXY": "127.0.0.1,localhost"})
original_connect = socket.socket.connect
def loopback_only(self, address):
    if self.family in {socket.AF_INET, socket.AF_INET6} and address[0] not in {"127.0.0.1", "::1", "localhost"}:
        raise RuntimeError("Offline Harness fixture rejected an external connection")
    return original_connect(self, address)
socket.socket.connect = loopback_only
sys.path.insert(0, str(repository / "resources" / "viniper-ui"))
import server
server._startup_cleanup()
import uvicorn
print(json.dumps({"fixture": "explicit-harness-demo", "port": options.port,
                  "workspace": str(project), "external_model_calls": 0}), flush=True)
uvicorn.run(server.app, host="127.0.0.1", port=options.port, log_level="warning")
