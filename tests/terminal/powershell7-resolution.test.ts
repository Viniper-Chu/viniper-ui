import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePowerShell7Path } from "../../src/platform/process/windows-process-host";
import { createTerminalTools } from "../../src/features/terminal/terminal-tools";
import { TerminalService } from "../../src/features/terminal/terminal-service";

test("WindowsProcessHost resolves the explicit PowerShell 7 entrypoint", () => {
  const value = resolvePowerShell7Path().toLowerCase();
  assert.match(value, /pwsh(?:\.exe)?$/u);
  assert.doesNotMatch(value, /windowspowershell[\\/]v1\.0[\\/]powershell/u);
});

test("terminal schema describes the native platform shell", () => {
  const tool = createTerminalTools({} as TerminalService)[0];
  const schema = JSON.stringify(tool.inputSchema);
  if (process.platform === "win32") {
    assert.match(schema, /already PowerShell 7/);
    assert.match(schema, /pass the script directly/);
  } else {
    assert.match(schema, /POSIX/);
    assert.doesNotMatch(schema, /PowerShell/);
  }
});
