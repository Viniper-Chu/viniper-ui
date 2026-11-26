import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { SecretVault } from "../../src/core/ports";

class MemorySecretVault implements SecretVault {
  private readonly store = new Map<string, string>();
  isEncryptionAvailable(): boolean { return true; }
  async setSecret(id: string, value: string): Promise<void> { this.store.set(id, value); }
  async readSecret(id: string): Promise<string | null> { return this.store.get(id) ?? null; }
  async deleteSecret(id: string): Promise<void> { this.store.delete(id); }
  async isConfigured(id: string): Promise<boolean> { return this.store.has(id); }
}

test("interruptedRunPolicy=fail marks crashed runs as failed without replaying provider/tool work", async () => {
  const root = await mkdtemp(join(tmpdir(), "viniper-stage4-crash-"));
  try {
    const first = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new MemorySecretVault(),
    });
    const session = first.runtime.snapshot().sessions[0];
    const runId = "crashed-bridge-run-1";
    const now = Date.now();
    await first.storage.saveSnapshot({
      schemaVersion: 3,
      productVersion: "3.0.1",
      activeSessionId: session.id,
      sessions: [{ ...session, status: "running", activeRunId: runId, activeRunIds: [runId] }],
    });
    await first.storage.appendEvent({
      id: "crashed-run-started",
      sessionId: session.id,
      type: "run.started",
      timestamp: now,
      payload: { runId, origin: { kind: "user" }, inputText: "请修改重要文件" },
    });
    await first.storage.appendEvent({
      id: "crashed-user-msg",
      sessionId: session.id,
      type: "message.user",
      timestamp: now + 1,
      payload: {
        runId,
        origin: { kind: "user" },
        message: { id: "m1", role: "user", text: "请修改重要文件", createdAt: now + 1, status: "completed" },
      },
    });
    await first.application.dispose();

    const resumed = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new MemorySecretVault(),
      interruptedRunPolicy: "fail",
    });
    try {
      await new Promise((r) => setTimeout(r, 50));
      const runs = resumed.runtime.listRuns(session.id);
      const target = runs.find((r) => r.runId === runId);
      assert.ok(target);
      assert.equal(target.status, "failed");
      const events = resumed.runtime.getSession(session.id)!.events;
      assert.equal(events.some((e) => e.type === "run.replaying"), false, "must never replay automatically");
      assert.ok(events.some((e) => e.type === "run.failed" && (e.payload as any).reason === "interrupted_by_restart"));
      assert.equal(resumed.runtime.getSession(session.id)!.activeRunId, undefined);
    } finally {
      await resumed.runtime.flushPersistence();
      await resumed.application.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistChain recovers after a transient persistence failure instead of bricking later events", async () => {
  const root = await mkdtemp(join(tmpdir(), "viniper-stage4-persist-"));
  try {
    const bundle = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: process.cwd(),
      assetsRoot: process.cwd(),
      secretVault: new MemorySecretVault(),
    });
    try {
      const session = bundle.runtime.snapshot().sessions[0];
      const origCommit = bundle.storage.commitEvent.bind(bundle.storage);
      let failOnce = true;
      bundle.storage.commitEvent = async (event, snapshot) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("simulated disk transient error");
        }
        return origCommit(event, snapshot);
      };
      await assert.rejects(() => bundle.runtime.renameSession(session.id, "第一次改名"), /simulated disk transient error/);
      const ok = await bundle.runtime.renameSession(session.id, "恢复后改名");
      assert.equal(ok, true);
      assert.equal(bundle.runtime.getSession(session.id)?.title, "恢复后改名");
    } finally {
      await bundle.application.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupted sessions.json is backed up and never overwritten with empty state on startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "viniper-stage4-sessions-"));
  try {
    const sessionsPath = join(root, "sessions.json");
    const brokenPayload = '{"s1": {"name": "未写完的数学讨论';
    await writeFile(sessionsPath, brokenPayload, "utf8");

    const harnessScript = `
import ast, json, os, shutil, sys, time, uuid
from pathlib import Path
from typing import Any

data_dir = Path(sys.argv[1])
source = Path("resources/viniper-ui/server.py").read_text(encoding="utf-8")
module = ast.parse(source)
wanted = {"_parse_normalized_sessions", "load_sessions_from_disk", "save_sessions_to_disk", "_startup_cleanup"}
selected = ast.Module(
    body=[n for n in module.body if (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in {"_sessions_corrupt_lock", "_sessions_corrupt_backed_up"} for t in n.targets))
          or (isinstance(n, ast.FunctionDef) and n.name in wanted)],
    type_ignores=[],
)
ns = {
    "Any": Any, "Path": Path, "json": json, "os": os, "shutil": shutil, "sys": sys, "time": time, "uuid": uuid,
    "DATA_DIR": data_dir, "SESSIONS_FILE": data_dir / "sessions.json", "MODE_VINIPER": "viniper",
    "sessions": {}, "_session_locks": {}, "now_ts": lambda: 1000.0,
    "normalize_session": lambda sid, s: {**s, "session_id": sid},
    "is_leaked_goal_control_message": lambda _m: False,
    "finalize_transcript_segments": lambda segs: segs or [],
}
exec(compile(selected, "server.py", "exec"), ns)
ns["_startup_cleanup"]()
if sys.argv[2] == "recover":
    loaded = ns["load_sessions_from_disk"]()
    assert "s1" in loaded and loaded["s1"]["name"] == "从备份恢复的会话", loaded
    print("RECOVERED_OK")
`;
    const py = spawnSync("python3", ["-I", "-B", "-c", harnessScript, root, "corrupt"], { encoding: "utf8", timeout: 15000 });
    assert.equal(py.status, 0, py.stderr || py.stdout);
    const preserved = await readFile(sessionsPath, "utf8");
    assert.equal(preserved, brokenPayload, "corrupted original must not be wiped to {}");
    const files = await readdir(root);
    assert.ok(files.some((f) => f.startsWith("sessions.corrupt-") && f.endsWith(".json")), "corrupt backup created");

    // Also verify recovery from .json.bak when available
    const validBackup = JSON.stringify({ s1: { name: "从备份恢复的会话", mode: "viniper", messages: [] } });
    await writeFile(join(root, "sessions.json.bak"), validBackup, "utf8");
    const pyRecover = spawnSync("python3", ["-I", "-B", "-c", harnessScript, root, "recover"], { encoding: "utf8", timeout: 15000 });
    assert.equal(pyRecover.status, 0, pyRecover.stderr || pyRecover.stdout);
    assert.match(pyRecover.stdout, /RECOVERED_OK/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
