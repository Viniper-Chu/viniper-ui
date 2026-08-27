import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AgentIntent } from "../../src/core/contracts";
import { ProviderEvent, ProviderRequest } from "../../src/core/provider-contracts";
import { ModelProvider } from "../../src/features/providers/model-provider";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

class ProjectReadProvider implements ModelProvider {
  readonly descriptor = {
    id: "p1-local-fake",
    name: "P1 Local Fake",
    label: "P1 Local Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p1-local-model", label: "P1 Local Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ProviderRequest);
    if (this.requests.length === 1) {
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "p1-read-call",
          name: "project.read",
          arguments: { path: "fact.txt", startLine: 1, endLine: 2 },
          argumentsText: "{\"path\":\"fact.txt\",\"startLine\":1,\"endLine\":2}",
        },
      };
      return;
    }
    yield { kind: "text.delta", text: "已根据项目文件回答。" };
  }
}

class HallucinatedProjectReadProvider implements ModelProvider {
  readonly descriptor = {
    id: "p1-hallucination-fake",
    name: "P1 Hallucination Fake",
    label: "P1 Hallucination Fake · 本地",
    configuration: "demo" as const,
    available: true,
    realCallsEnabled: false,
    capabilities: ["tools"],
    models: [{ id: "p1-hallucination-model", label: "P1 Hallucination Model" }],
  };
  readonly requests: ProviderRequest[] = [];

  async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ProviderRequest);
    if (this.requests.length === 1) {
      yield {
        kind: "tool-call.completed",
        call: {
          type: "tool-call",
          callId: "hallucinated-project-read",
          name: "project.read",
          arguments: { path: "resources-app-marker.txt" },
          argumentsText: "{\"path\":\"resources-app-marker.txt\"}",
        },
      };
      return;
    }
    yield { kind: "text.delta", text: "已安全拒绝未开放工具。" };
  }
}

test("P1-01/P1-07/P1-09 application creates a canonical project session and runs registered tools through history", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "p1-runtime-data-"));
  const projectRoot = await mkdtemp(join(residue, "p1-runtime-project-"));
  await writeFile(join(projectRoot, "fact.txt"), "phase six\nvertical slice\n", "utf8");
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: projectRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  try {
    const provider = new ProjectReadProvider();
    bundle.runtime.providerRegistry().register(provider);
    const application = bundle.application as typeof bundle.application & {
      createProjectSession(path: string): Promise<{ id: string; workingDirectory: string }>;
    };
    const session = await application.createProjectSession(join(projectRoot, "."));
    assert.equal(session.workingDirectory, await realpath(projectRoot));
    assert.equal((session as typeof session & { projectAccess?: { enabled: boolean } }).projectAccess?.enabled, true);
    assert.equal(await application.setProviderModel(session.id, provider.descriptor.id, "p1-local-model"), true);
    const snapshot = application.snapshot();
    const selected = snapshot.sessions.find((item) => item.id === session.id)!;
    const intent: AgentIntent = {
      sessionId: session.id,
      text: "读取项目事实",
      attachments: [],
      selectedModel: selected.selectedModel,
      permissionMode: "auto",
    };
    await application.send(intent);
    await waitFor(() => !bundle.runtime.isRunning(session.id));

    assert.deepEqual(provider.requests[0].tools.filter((tool) => tool.name.startsWith("project.")).map((tool) => tool.name), [
      "project.delete",
      "project.diff",
      "project.edit",
      "project.list",
      "project.move",
      "project.read",
      "project.search",
      "project.write",
    ]);
    const continuation = provider.requests[1].history.at(-1)?.items[0];
    assert.equal(continuation?.type, "tool-result");
    if (continuation?.type !== "tool-result") return;
    assert.equal(continuation.callId, "p1-read-call");
    assert.equal(continuation.isError, false);
    assert.match(continuation.content, /phase six/u);
    const canonicalProjectRoot = await realpath(projectRoot);
    assert.equal(JSON.stringify(provider.requests).includes(canonicalProjectRoot), false, "Provider request must omit absolute project root");
    assert.equal(continuation.content.includes(canonicalProjectRoot), false, "Provider tool text must omit absolute project root");
    const providerHistoryText = provider.requests.flatMap((request) => request.history)
      .flatMap((entry) => entry.items)
      .filter((item) => item.type === "tool-result")
      .map((item) => item.content)
      .join("\n");
    assert.equal(providerHistoryText.includes(canonicalProjectRoot), false, "request history must omit absolute project root");
    const restoredSession = bundle.runtime.getSession(session.id)!;
    assert.equal(restoredSession.providerHistory.some((entry) => entry.items.some((item) => item.type === "tool-result")), true);
    const persistedToolText = restoredSession.providerHistory
      .flatMap((entry) => entry.items)
      .filter((item) => item.type === "tool-result")
      .map((item) => item.content)
      .join("\n");
    assert.equal(persistedToolText.includes(canonicalProjectRoot), false, "persisted provider history must omit absolute project root");
    assert.equal(restoredSession.activities.some((activity) => /读取/u.test(activity.detail) && !activity.detail.trim().startsWith("{")), true);
    assert.equal(bundle.application.snapshot().artifacts?.records.some((record) => record.runId && record.kind === "tool-output"), true);
  } finally {
    await bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("P1-01 an invalid project selection leaves the active session and history unchanged", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "p1-invalid-data-"));
  const workingRoot = await mkdtemp(join(residue, "p1-invalid-working-"));
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: workingRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  try {
    const before = bundle.application.snapshot();
    await assert.rejects(
      () => bundle.application.createProjectSession(join(workingRoot, "missing-project")),
      /不存在|未改变/u,
    );
    const after = bundle.application.snapshot();
    assert.equal(after.activeSessionId, before.activeSessionId);
    assert.equal(after.sessions.length, before.sessions.length);
    assert.deepEqual(after.sessions[0].messages, before.sessions[0].messages);
    assert.equal(after.sessions[0].projectAccess, undefined);
  } finally {
    bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workingRoot, { recursive: true, force: true });
  }
});

test("P1-01/P1-06 portable-style default or legacy sessions neither advertise nor execute project tools", async () => {
  const residue = resolve(process.cwd(), "codex", "运行残留");
  await mkdir(residue, { recursive: true });
  const dataRoot = await mkdtemp(join(residue, "p1-default-data-"));
  const programRoot = await mkdtemp(join(residue, "p1-portable-program-"));
  await writeFile(join(programRoot, "resources-app-marker.txt"), "HARNESS_INTERNAL_MUST_NOT_REACH_MODEL\n", "utf8");
  await writeFile(join(programRoot, "AGENTS.md"), "PROGRAM_DIRECTORY_AGENTS_MUST_NOT_REACH_PROVIDER\n", "utf8");
  const bundle = await createHarnessApplication({
    dataRoot,
    workingDirectory: programRoot,
    assetsRoot: dataRoot,
    secretVault: new UnavailableSecretVault(),
    demoDelayMs: 1,
  });
  try {
    const provider = new HallucinatedProjectReadProvider();
    bundle.runtime.providerRegistry().register(provider);
    const session = bundle.runtime.snapshot().sessions[0];
    assert.equal((session as typeof session & { projectAccess?: unknown }).projectAccess, undefined);
    assert.equal(await bundle.application.setProviderModel(session.id, provider.descriptor.id, "p1-hallucination-model"), true);
    await bundle.application.send({
      sessionId: session.id,
      text: "尝试读取程序目录",
      attachments: [],
      selectedModel: "p1-hallucination-model",
      permissionMode: "auto",
    });
    await waitFor(() => !bundle.runtime.isRunning(session.id));

    assert.deepEqual(provider.requests[0].tools.filter((tool) => tool.name.startsWith("project.")), []);
    const toolResult = provider.requests[1].history.at(-1)?.items[0];
    assert.equal(toolResult?.type, "tool-result");
    if (toolResult?.type !== "tool-result") return;
    assert.equal(toolResult.isError, true);
    assert.match(toolResult.content, /未向本次运行开放|未广告/u);
    assert.doesNotMatch(JSON.stringify(provider.requests), /HARNESS_INTERNAL_MUST_NOT_REACH_MODEL/u);
    assert.doesNotMatch(JSON.stringify(provider.requests), /PROGRAM_DIRECTORY_AGENTS_MUST_NOT_REACH_PROVIDER/u);
    const completedSession = bundle.runtime.getSession(session.id)!;
    assert.equal(completedSession.projectInstructions?.status, "missing");
    assert.match(completedSession.projectInstructions?.message ?? "", /未打开项目|未设置/u);
    await bundle.runtime.flushPersistence();
    const database = new DatabaseSync(join(dataRoot, "harness.sqlite"), { readOnly: true });
    const persisted = (database.prepare("SELECT payload_json FROM sessions").all() as Array<{ payload_json: string }>)
      .map((row) => row.payload_json)
      .join("\n");
    database.close();
    assert.doesNotMatch(persisted, /PROGRAM_DIRECTORY_AGENTS_MUST_NOT_REACH_PROVIDER/u);
    assert.match(persisted, /"status":"missing"/u);
  } finally {
    bundle.application.dispose();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(programRoot, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for P1 runtime");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
