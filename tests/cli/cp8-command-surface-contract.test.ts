import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCliLine } from "../../src/platform/cli/parser";

const cp8Commands = [
  "/session-delete session-1",
  "/memory-create project 记住这条本地事实",
  "/memory-update memory-1 更新后的事实",
  "/memory-enable memory-1 off",
  "/memory-delete memory-1",
  "/index build",
  "/index search 关键字",
  "/index semantic on",
  "/schedule-create once-fixture",
  "/schedule-enable schedule-1 off",
  "/schedule-run schedule-1",
  "/schedule-delete schedule-1",
  "/schedule-restore schedule-1",
  "/extension-stage staging-1",
  "/extension-install staging-1",
  "/extension-trust extension-1 1.0.0",
  "/extension-enable extension-1 on",
  "/extension-update extension-1 staging-2",
  "/extension-update-confirm extension-1",
  "/extension-rollback extension-1",
  "/extension-rollback-confirm extension-1",
  "/mcp-config fixture http://127.0.0.1:43111/mcp",
  "/mcp-connect fixture",
  "/local-models",
  "/local-model-register local-fixture",
  "/local-model-confirm local-fixture 1",
  "/local-model-update local-fixture 2",
  "/local-model-update-confirm local-fixture",
  "/provider-endpoint deepseek http://127.0.0.1:43111",
  "/provider-manual-model deepseek deepseek-v4-flash",
  "/provider-capabilities deepseek tools",
  "/diagnostics-consent on",
  "/update-download",
  "/update-install",
  "/setting closeBehavior quit",
  "/credential-export D:/tmp/fixture.vault",
  "/credential-import D:/tmp/fixture.vault",
  "/artifact-read artifact-1 run-1 0 128",
] as const;

test("CP8 CLI command surface parses all required local application-port entry points", () => {
  for (const line of cp8Commands) {
    const result = parseCliLine(line);
    assert.equal(result.ok, true, `${line}: ${result.ok ? "" : result.message}`);
  }
});
