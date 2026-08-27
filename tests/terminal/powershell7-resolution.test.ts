import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePowerShell7Path } from "../../src/platform/process/windows-process-host";

test("WindowsProcessHost resolves the explicit PowerShell 7 entrypoint", () => {
  const value = resolvePowerShell7Path().toLowerCase();
  assert.match(value, /pwsh(?:\.exe)?$/u);
  assert.doesNotMatch(value, /windowspowershell[\\/]v1\.0[\\/]powershell/u);
});

