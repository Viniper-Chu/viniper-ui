import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const mainPath = join(process.cwd(), "resources", "viniper-ui", "desktop", "main.js");
const source = readFileSync(mainPath, "utf8");
const parsed = ts.createSourceFile(mainPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Set(["isTrustedUpdateSender", "requestAppUpdateInstall", "installAppUpdate", "stopOwnedUpdateServer", "finishUpdateQuit"]);
const declarations = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && Boolean(node.name && functions.has(node.name.text))).map((node) => node.getText(parsed)).join("\n");
assert.equal(parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && functions.has(node.name.text)).length, functions.size);

class OwnedProcess extends EventEmitter {
  pid = 1234;
  exitCode: number | null = null;
  killed = false;
  killCount = 0;
  behavior = "exit";
  kill() {
    this.killCount += 1;
    if (this.behavior === "reject") return false;
    this.killed = true;
    if (this.behavior === "exit") queueMicrotask(() => { this.exitCode = 0; this.emit("exit", 0); });
    return true;
  }
}

function fixture(payload: unknown = { ok: true, status: "installer_opened", updated: false }, httpStatus = 200) {
  const calls: Array<{ options: any; body?: string }> = [];
  const scheduled: Array<() => void> = [];
  const alerts: unknown[][] = [];
  const frame = { url: "http://127.0.0.1:17947/?launch=1" };
  const sender = { mainFrame: frame };
  const owned = new OwnedProcess();
  const sandbox: any = {
    URL, Promise, setTimeout, clearTimeout,
    setImmediate: (callback: () => void) => { scheduled.push(callback); },
    mainWindow: { isDestroyed: () => false, webContents: sender },
    localUrl: () => "http://127.0.0.1:17947", port: 17947,
    process: { platform: "win32" }, IS_STABLE: true,
    app: { isPackaged: true, quitCount: 0, quit() { this.quitCount += 1; } },
    serverProcess: owned, isQuitting: false,
    updateApplyPromise: null, updateQuitRequested: false, updateQuitReady: false, updateQuitPromise: null,
    closeSecretBroker: async () => { sandbox.brokerClosed += 1; }, brokerClosed: 0,
    waitForUpdateServerClosed: async () => undefined,
    dialog: { showErrorBox: (...args: unknown[]) => { alerts.push(args); } },
    http: { request(options: any, callback: (response: any) => void) {
      const call: { options: any; body?: string } = { options }; calls.push(call);
      const request: any = new EventEmitter();
      request.destroy = () => undefined;
      request.end = (body: string) => {
        call.body = body;
        queueMicrotask(() => {
          const response: any = new EventEmitter();
          response.statusCode = httpStatus;
          response.setEncoding = () => undefined;
          callback(response);
          response.emit("data", typeof payload === "string" ? payload : JSON.stringify(payload));
          response.emit("end");
        });
      };
      return request;
    } },
  };
  vm.runInNewContext(declarations, sandbox, { filename: mainPath });
  return { sandbox, event: { sender, senderFrame: frame }, owned, calls, scheduled, alerts };
}

test("desktop update IPC accepts only its own main frame and a fixed localhost request", async () => {
  const f = fixture();
  for (const event of [undefined, {}, { sender: {}, senderFrame: f.event.senderFrame }, { ...f.event, senderFrame: { ...f.event.senderFrame } }]) {
    assert.equal((await f.sandbox.installAppUpdate(event)).ok, false);
  }
  for (const url of ["https://example.test", "http://127.0.0.1:17948/", "http://127.0.0.1:17947.example.test/", "http://user:secret@127.0.0.1:17947/"]) {
    f.event.senderFrame.url = url;
    assert.equal((await f.sandbox.installAppUpdate(f.event)).ok, false);
  }
  assert.equal(f.calls.length, 0);
  f.event.senderFrame.url = "http://127.0.0.1:17947/";
  const result = await f.sandbox.installAppUpdate(f.event, { installer: "untrusted.exe" });
  assert.equal(result.desktop_quit_requested, true);
  assert.equal(result.updated, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.hostname, "127.0.0.1");
  assert.equal(f.calls[0].options.path, "/api/update/apply");
  assert.equal(f.calls[0].options.method, "POST");
  assert.equal(f.calls[0].options.headers.Origin, "http://127.0.0.1:17947");
  assert.equal(f.calls[0].body, "{}");
  assert.equal(f.sandbox.app.quitCount, 0);
  assert.equal(f.scheduled.length, 1);
  f.scheduled[0]();
  assert.equal(f.sandbox.app.quitCount, 1);
});

test("desktop update never quits on active-task refusal, malformed acknowledgement or installer failure", async () => {
  for (const [payload, status] of [
    [{ detail: "仍有任务正在运行" }, 409], [{ ok: true, status: "installer_opened", updated: false }, 500],
    [{ ok: true, status: "ready", updated: false }, 200], [{ ok: true, status: "installer_opened", updated: true }, 200],
    [{ ok: false, status: "installer_opened", updated: false }, 200], ["not-json", 200], [[], 200],
  ] as Array<[unknown, number]>) {
    const f = fixture(payload, status);
    await f.sandbox.installAppUpdate(f.event);
    assert.equal(f.scheduled.length, 0);
    assert.equal(f.sandbox.app.quitCount, 0);
    assert.equal(f.owned.killCount, 0);
  }
});

test("desktop update excludes unpackaged, preview and externally owned services and is single-flight", async () => {
  for (const setting of ["unpackaged", "preview", "external", "exited", "nonwindows"]) {
    const f = fixture();
    if (setting === "unpackaged") f.sandbox.app.isPackaged = false;
    if (setting === "preview") f.sandbox.IS_STABLE = false;
    if (setting === "external") f.sandbox.serverProcess = null;
    if (setting === "exited") f.owned.exitCode = 1;
    if (setting === "nonwindows") f.sandbox.process.platform = "darwin";
    assert.equal((await f.sandbox.installAppUpdate(f.event)).ok, false);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  const results = await Promise.all([f.sandbox.installAppUpdate(f.event), f.sandbox.installAppUpdate(f.event)]);
  assert.equal(results.every((result) => result.desktop_quit_requested), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.scheduled.length, 1);
});

test("update quit waits for the exact owned service and retains the app if shutdown fails", async () => {
  const f = fixture();
  const unrelated = new OwnedProcess();
  f.sandbox.updateQuitRequested = true;
  await f.sandbox.finishUpdateQuit();
  assert.equal(f.owned.killCount, 1);
  assert.equal(unrelated.killCount, 0);
  assert.equal(f.sandbox.serverProcess, null);
  assert.equal(f.sandbox.brokerClosed, 1);
  assert.equal(f.sandbox.updateQuitReady, true);
  assert.equal(f.sandbox.app.quitCount, 1);
  assert.equal(f.alerts.length, 0);

  const rejected = fixture();
  rejected.owned.behavior = "reject";
  rejected.sandbox.updateQuitRequested = true;
  await rejected.sandbox.finishUpdateQuit();
  assert.equal(rejected.sandbox.app.quitCount, 0);
  assert.equal(rejected.sandbox.updateQuitRequested, false);
  assert.equal(rejected.alerts.length, 1);
  assert.equal(rejected.sandbox.brokerClosed, 0);

  const stalled = fixture();
  stalled.owned.behavior = "stall";
  await assert.rejects(stalled.sandbox.stopOwnedUpdateServer(stalled.owned, 10), /owned-server-stop-timeout/);
  assert.equal(stalled.owned.killCount, 1);
});

test("preload exposes a parameterless update capability and before-quit takes the update cleanup path", () => {
  let exposed: any;
  const invokes: unknown[][] = [];
  vm.runInNewContext(readFileSync(join(process.cwd(), "resources/viniper-ui/desktop/preload.js"), "utf8"), {
    process: { platform: "win32" },
    require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: any) => { exposed = api; } }, ipcRenderer: { invoke: (...args: unknown[]) => { invokes.push(args); } } }),
  });
  exposed.installAppUpdate({ installer: "untrusted.exe" });
  assert.deepEqual(invokes, [["viniper:install-app-update"]]);
  assert.match(source, /ipcMain\.handle\("viniper:install-app-update", \(event\) => installAppUpdate\(event\)\)/);
  assert.match(source, /updateQuitRequested && !updateQuitReady[\s\S]*?event\.preventDefault\(\)[\s\S]*?finishUpdateQuit\(\)/);
  assert.doesNotMatch(declarations.replace(/\/\/[^\n]*/g, ""), /taskkill|\/im|process\.kill\(/);
});
