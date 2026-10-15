import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const mainPath = join(process.cwd(), "resources", "viniper-ui", "desktop", "main.js");
const source = readFileSync(mainPath, "utf8");
const parsed = ts.createSourceFile(mainPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functions(names: string[]) {
  const selected = parsed.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && Boolean(node.name && names.includes(node.name.text)));
  assert.equal(selected.length, names.length);
  return selected.map((node) => node.getText(parsed)).join("\n");
}
const quitHook = parsed.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(parsed) === "app.on"
  && node.expression.arguments[0]?.getText(parsed) === '"before-quit"');
assert.ok(quitHook);

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const stopping = deferred();
  const owned = { pid: 12345 };
  const calls = { stop: 0, start: 0, brokerClose: 0, trayDestroy: 0, quit: 0, prevented: 0 };
  const alerts: string[] = [];
  let beforeQuit!: (event: { preventDefault(): void }) => void;
  const sandbox: any = {
    Promise, serverProcess: owned, serverStopPromise: null, isQuitting: false,
    quitReady: false, quitPromise: null, updateQuitRequested: false, updateQuitReady: false,
    updateQuitPromise: null, mainWindow: null, DISPLAY_NAME: "fixture",
    stopOwnedProcess: async (process: unknown) => { assert.equal(process, owned); calls.stop++; await stopping.promise; },
    startServerProcess: async () => { calls.start++; }, waitForServer: async () => null,
    closeSecretBroker: async () => { calls.brokerClose++; },
    tray: { destroy: () => { calls.trayDestroy++; } },
    dialog: { showErrorBox: (_title: string, message: string) => { alerts.push(message); } },
    app: {
      on: (_event: string, callback: typeof beforeQuit) => { beforeQuit = callback; },
      quit: () => { calls.quit++; beforeQuit({ preventDefault: () => { calls.prevented++; } }); },
    },
  };
  vm.runInNewContext(`${functions(["stopServerProcess", "restartServer"])}\n${quitHook!.getText(parsed)}`, sandbox, { filename: mainPath });
  return { sandbox, calls, stopping, owned, alerts,
    requestQuit: () => beforeQuit({ preventDefault: () => { calls.prevented++; } }) };
}

test("desktop restart then Command-Q awaits the same owned-stop barrier and never starts another server", async () => {
  const f = fixture();
  const restarting = f.sandbox.restartServer();
  const shared = f.sandbox.serverStopPromise;
  assert.ok(shared);
  assert.equal(f.sandbox.stopServerProcess(), shared);
  f.requestQuit();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.calls.stop, 1);
  assert.equal(f.calls.quit, 0);
  assert.equal(f.calls.brokerClose, 0);
  assert.equal(f.sandbox.quitReady, false);
  f.stopping.resolve();
  await Promise.all([restarting, f.sandbox.quitPromise]);
  assert.equal(f.calls.start, 0);
  assert.equal(f.calls.stop, 1);
  assert.equal(f.calls.quit, 1);
  assert.equal(f.calls.brokerClose, 1);
  assert.equal(f.calls.trayDestroy, 1);
  assert.equal(f.calls.prevented, 1, "the second app.quit passes once cleanup is complete");
  assert.equal(f.sandbox.serverStopPromise, null);
});

test("a failed shared desktop stop restores ownership for retry without claiming quit success", async () => {
  const f = fixture();
  const stopping = f.sandbox.stopServerProcess();
  f.requestQuit();
  const rejected = assert.rejects(stopping, /fixture-stop-failed/u);
  f.stopping.reject(new Error("fixture-stop-failed"));
  await Promise.all([rejected, f.sandbox.quitPromise]);
  assert.equal(f.sandbox.serverProcess, f.owned);
  assert.equal(f.sandbox.serverStopPromise, null);
  assert.equal(f.sandbox.quitReady, false);
  assert.equal(f.sandbox.isQuitting, false);
  assert.equal(f.calls.quit, 0);
  assert.deepEqual(f.alerts, ["fixture-stop-failed"]);
  f.sandbox.stopOwnedProcess = async () => {};
  await f.sandbox.stopServerProcess();
  assert.equal(f.sandbox.serverProcess, null);
});

test("desktop quit during restart readiness prevents spawn, while an ordinary restart still starts once", async () => {
  const f = fixture();
  const checking = deferred();
  const readiness = deferred<null>();
  f.sandbox.waitForServer = async () => { checking.resolve(); return readiness.promise; };
  const restarting = f.sandbox.restartServer();
  f.stopping.resolve();
  await checking.promise;
  f.requestQuit();
  await f.sandbox.quitPromise;
  readiness.resolve(null);
  await restarting;
  assert.equal(f.calls.start, 0);

  const normal = fixture();
  const normalRestart = normal.sandbox.restartServer();
  normal.stopping.resolve();
  await normalRestart;
  assert.equal(normal.calls.start, 1);
});

test("desktop server startup rechecks quit after its asynchronous broker readiness barrier", async () => {
  const broker = deferred<unknown>();
  let starts = 0;
  const sandbox: any = {
    isQuitting: false,
    findPython: () => ({ command: "fixture-no-process", args: [] }),
    ensurePythonDependencies: () => {}, startSecretBroker: () => broker.promise,
    spawn: () => { starts++; throw new Error("A real process must never start in this fixture"); },
  };
  vm.runInNewContext(functions(["startServerProcess"]), sandbox, { filename: mainPath });
  const starting = sandbox.startServerProcess();
  sandbox.isQuitting = true;
  broker.resolve({ address: () => ({ port: 1 }) });
  await starting;
  assert.equal(starts, 0);
  sandbox.findPython = () => { throw new Error("Quit cannot initiate another startup probe"); };
  await sandbox.startServerProcess();
});
