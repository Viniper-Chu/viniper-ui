import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileTools } from "../../src/features/files/file-tools";
import { buildExternalCliCommand } from "../../src/platform/process/external-cli-window";
import { WindowsFileOpener } from "../../src/platform/process/windows-file-opener";

test("file.open is a computer-scoped managed tool and reports the native opener result", async () => {
  const opened: string[] = [];
  const [tool] = createFileTools({
    async open(path) {
      opened.push(path);
      return { ok: true, path };
    },
  });
  assert.equal(tool.name, "file.open");
  assert.equal(tool.authorizationScope, "computer");
  assert.equal(tool.readOnly, false);
  const result = await tool.execute({
    id: "open-1",
    name: "file.open",
    summary: "打开文件",
    readOnly: false,
    scope: "computer",
    input: { path: "D:\\fixture.pdf" },
  }, {
    sessionId: "session-a",
    runId: "run-a",
    signal: new AbortController().signal,
  });
  assert.deepEqual(opened, ["D:\\fixture.pdf"]);
  assert.equal(result.isError, false);
  assert.match(result.displayText ?? "", /系统默认应用打开/u);
});

test("file opener rejects a relative path before starting any operating-system process", async () => {
  const result = await new WindowsFileOpener().open("relative.pdf");
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "PATH_INVALID");
});

test("standalone CLI command binds the packaged CLI to the same data root and project", () => {
  const command = buildExternalCliCommand({
    executable: "C:\\Viniper\\Viniper workstation.exe",
    cliEntry: "C:\\Viniper\\dist\\src\\platform\\cli\\main.js",
    dataRoot: "C:\\Users\\fixture\\Viniper Data",
    projectRoot: "D:\\Agent",
  });
  assert.match(command, /title Viniper workstation CLI/u);
  assert.match(command, /color 0B/u);
  assert.match(command, /ELECTRON_RUN_AS_NODE=1/u);
  assert.match(command, /--data-root "C:\\Users\\fixture\\Viniper Data" --project "D:\\Agent"/u);
});
