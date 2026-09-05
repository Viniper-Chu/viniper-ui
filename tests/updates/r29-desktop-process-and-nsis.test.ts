import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const desktopMain = path.join(root, "resources/viniper-ui/desktop/main.js");
const mainSource = readFileSync(desktopMain, "utf8");

test("desktop directly owns the real Python listener and update shutdown closes its readiness port", { timeout: 20000 }, async () => {
  const parsed = ts.createSourceFile(desktopMain, mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = new Set(["findPython", "stopOwnedUpdateServer", "waitForUpdateServerClosed", "requestReadiness", "requestJson", "delay"]);
  const selected = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && Boolean(node.name && names.has(node.name.text)));
  assert.equal(selected.length, names.size);
  const sandbox: any = {
    spawnSync, fs, path, http, URL, Promise, Date, setTimeout, clearTimeout,
    process: { platform: process.platform }, SERVER_STATUS_PROBE_TIMEOUT_MS: 500,
    localUrl: () => `http://127.0.0.1:${sandbox.port}`, port: 0,
  };
  vm.runInNewContext(selected.map((node) => node.getText(parsed)).join("\n"), sandbox, { filename: desktopMain });
  const python = sandbox.findPython();
  assert.ok(python && path.isAbsolute(python.command));
  assert.equal(path.basename(python.command).toLowerCase() === "py.exe", false);
  assert.equal(python.args.length, 0);
  const code = [
    "import json,os", "from http.server import BaseHTTPRequestHandler,HTTPServer",
    "class Handler(BaseHTTPRequestHandler):",
    " def do_GET(self):",
    "  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'pid':os.getpid(),'fixture':True}).encode())",
    " def log_message(self,*args): pass",
    "server=HTTPServer(('127.0.0.1',0),Handler)",
    "print(json.dumps({'pid':os.getpid(),'port':server.server_port}),flush=True)",
    "server.serve_forever()",
  ].join("\n");
  const child = spawn(python.command, ["-E", "-u", "-c", code], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const ready: any = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("private listener readiness timeout")), 5000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(output.slice(0, output.indexOf("\n")))); }
      });
    });
    assert.equal(ready.pid, child.pid, "desktop must own Python itself, not py.exe launcher");
    sandbox.port = ready.port;
    assert.equal((await sandbox.requestReadiness()).pid, child.pid);
    await sandbox.stopOwnedUpdateServer(child);
    await sandbox.waitForUpdateServerClosed();
    assert.equal(await sandbox.requestReadiness(), null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

test("Windows NSIS handoff keeps the exact final quoted /D argument without running an installer", { timeout: 20000 }, () => {
  const script = String.raw`
import ctypes,json,os,subprocess,sys,tempfile
from pathlib import Path
root=Path(sys.argv[1]);sys.dont_write_bytecode=True
sys.path.insert(0,str(root/'resources'/'viniper-ui'))
from update_manager import installer_command_line
task=root/'codex'/'工作输出'/'viniper-github-inapp-update-r29-20260905'/'runtime-test-tmp'
task.mkdir(parents=True,exist_ok=True)
fixture=Path(tempfile.mkdtemp(prefix='nsis-argv-',dir=task))
install=fixture/'install & 中文 空格';app_dir=install/'resources'/'viniper-ui';app_dir.mkdir(parents=True)
desktop=install/'Viniper workstation.exe';desktop.write_bytes(b'not-executable-fixture')
setup=fixture/'Viniper-workstation-Setup.exe';setup.write_bytes(b'not-executable-fixture')
command,target=installer_command_line(setup,desktop,app_dir=app_dir)
expected=f'"{setup.resolve()}" /D="{install.resolve()}"'
assert command==expected and target==install.resolve()
assert '/S' not in command and '--updated' not in command and '--force-run' not in command
bad=fixture/'wrong.exe';bad.write_bytes(b'fixture')
for executable,source in ((bad,app_dir),(desktop,fixture/'different-app')):
 try: installer_command_line(setup,executable,app_dir=source)
 except ValueError: pass
 else: raise AssertionError('invalid owner/install directory accepted')
if os.name=='nt':
 code="import ctypes,json; f=ctypes.windll.kernel32.GetCommandLineW; f.restype=ctypes.c_wchar_p; print(json.dumps(f()))"
 prefix=subprocess.list2cmdline([sys.executable,'-E','-c',code])
 tail=command[len(f'"{setup.resolve()}"'):]
 actual=subprocess.run(prefix+tail,executable=sys.executable,shell=False,capture_output=True,text=True,timeout=10,check=True)
 raw=json.loads(actual.stdout)
 assert raw.endswith(f' /D="{install.resolve()}"')
 bad_tail=subprocess.list2cmdline([f'/D="{install.resolve()}"'])
 assert bad_tail != tail.strip() and '\\"' in bad_tail
print(json.dumps({'installerExecutions':0,'providerCalls':0,'exactQuotedDirectory':True,'realWindowsCommandLine':os.name=='nt'}))
`;
  const args = process.platform === "win32" ? ["-3", "-E", "-c", script, root] : ["-E", "-c", script, root];
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", args, { cwd: root, encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout.trim());
  assert.equal(evidence.installerExecutions, 0);
  assert.equal(evidence.providerCalls, 0);
  assert.equal(evidence.exactQuotedDirectory, true);
  assert.equal(evidence.realWindowsCommandLine, process.platform === "win32");
});

test("stable packaging and native shell retain app identity, compatible user data and installer confirmation", () => {
  const profiles = JSON.parse(readFileSync(path.join(root, "resources/viniper-ui/profiles.json"), "utf8"));
  assert.equal(profiles.stable.app_id, "com.viniper.workstation");
  assert.equal(profiles.stable.data_dir_name, "Viniper workstation Preview");
  assert.equal(profiles.stable.shortcut_name, "Viniper workstation.lnk");
  const packager = readFileSync(path.join(root, "scripts/package-windows-stable.mjs"), "utf8");
  assert.match(packager, /appId:\s*profile\.app_id/);
  assert.match(packager, /oneClick:\s*false/);
  assert.match(packager, /perMachine:\s*false/);
  assert.match(packager, /shortcutName:\s*"Viniper workstation"/);
  assert.doesNotMatch(packager, /deleteAppDataOnUninstall:\s*true/);
  assert.match(mainSource, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
  assert.match(mainSource, /app\.setPath\("userData", workstationDataDir\(\)\)/);
});
