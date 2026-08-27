import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AgentRuntime } from "../../src/features/runs/agent-runtime";
import { ProviderRegistry } from "../../src/features/providers/provider-registry";
import { FileStore } from "../../src/platform/persistence/file-store";
import { TokenLedger } from "../../src/features/telemetry/token-ledger";
import { ToolRegistry } from "../../src/features/tools/tool-registry";

export async function createRuntimeFixture(): Promise<{
  runtime: AgentRuntime;
  telemetry: TokenLedger;
  store: FileStore;
  root: string;
  dispose(): Promise<void>;
}> {
  const outputRoot = join(process.cwd(), "codex", "运行残留");
  await mkdir(outputRoot, { recursive: true });
  const root = await mkdtemp(join(outputRoot, "runtime-test-"));
  const store = new FileStore(root);
  const tokenLedger = new TokenLedger(store);
  await tokenLedger.initialize();
  const runtime = new AgentRuntime({
    persistence: store,
    defaultWorkingDirectory: "D:\\Agent",
    registry: new ProviderRegistry(20),
    toolRegistry: new ToolRegistry(),
    tokenLedger,
  });
  await runtime.initialize();
  return {
    runtime,
    telemetry: tokenLedger,
    store,
    root,
    dispose: async () => {
      await runtime.flushPersistence();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function waitFor(predicate: () => boolean, timeoutMs = 1600): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for Agent Runtime state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
