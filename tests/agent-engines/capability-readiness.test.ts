import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Harness capabilities report Application Port failures and use the actual MCP capability", () => {
  const residue = join(process.cwd(), "codex", "运行残留");
  mkdirSync(residue, { recursive: true });
  const root = mkdtempSync(join(residue, "capability-readiness-"));
  try {
    const code = `
import os,sys,asyncio
os.environ['VINIPER_UI_DATA_DIR']=sys.argv[1]
sys.path.insert(0,'resources/viniper-ui')
import server
from pathlib import Path
async def probe(**kwargs): return {'ready':True,'capabilities':{}}
async def sync(): return {}
class Port:
    fail=False
    mcp=False
    async def control(self, op):
        if self.fail: raise RuntimeError('bridge offline')
        return {'mcp':self.mcp,'collaboration':True,'subagents':True}
port=Port()
server.runtime_probe_snapshot=probe
server.sync_harness_host_configuration=sync
server.VINIPER_TRANSPORT.application_port=port
original_skills=server.get_skills
server.get_skills=lambda *args: []
async def check():
    data=await server.capability_status(mode='viniper')
    assert data['status']=='available' and data['mcp']['status']=='unavailable'
    port.mcp=True
    data=await server.capability_status(mode='viniper')
    assert data['mcp']['status']=='available'
    port.fail=True
    data=await server.capability_status(mode='viniper')
    assert data['status']=='unavailable' and data['mcp']['status']=='unavailable'
    assert data['collaboration']['status']=='unavailable'
    assert data['reason']=='bridge offline' and '暂不可用' in data['summary']
    server.get_skills=original_skills
    project=Path(sys.argv[1])/'project'
    skill=project/'.agents'/'skills'/'local-check'/'SKILL.md'
    skill.parent.mkdir(parents=True)
    skill.write_text('---\\nname: Local check\\ndescription: Offline fixture\\n---\\n# Check\\n')
    server.default_session_workdir=lambda: project
    first=await server.list_skills(mode='viniper',refresh=True)
    record=next(item for item in first['skills'] if item['command']=='local-check')
    detail=await server.read_skill(record['id'],mode='viniper')
    assert 'Offline fixture' in detail['content']
    skill.write_text('---\\nname: Updated check\\n---\\n# Updated\\n')
    second=await server.list_skills(mode='viniper',refresh=True)
    assert next(item for item in second['skills'] if item['command']=='local-check')['name']=='Updated check'
asyncio.run(check())
print('PASS: capability readiness')
`;
    const python = process.platform === "win32" ? "py" : "python3";
    const result = spawnSync(python, [...(process.platform === "win32" ? ["-3"] : []), "-B", "-c", code, root], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS: capability readiness/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
