import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("R26 model capacity registry is provider-owned and model switches cannot keep 128K", async () => {
  const root = process.cwd();
  const registry = JSON.parse(await readFile(join(root, "resources", "viniper-ui", "model-capabilities.json"), "utf8"));
  const deepseek = registry.entries.filter((entry: { provider: string }) => entry.provider === "deepseek");
  assert.deepEqual(deepseek.map((entry: { model: string }) => entry.model), ["deepseek-v4-pro", "deepseek-flash"]);
  assert.deepEqual(deepseek.map((entry: { context_window: number }) => entry.context_window), [1048576, 1048576]);
  assert.ok(deepseek.every((entry: { status: string }) => entry.status === "verified"));
  const kimi = registry.entries.find((entry: { model: string }) => entry.model === "Kimi-K3");
  assert.equal(kimi.status, "verified");
  assert.equal(kimi.context_window, 1048576);
  assert.match(kimi.source, /official K3 full-context specification/u);
  assert.match(kimi.source, /deployment cap unverified/u);
  assert.match(kimi.source_url, /kimi\.com\/code\/docs\/en\/kimi-code\/models\.html/u);

  const server = await readFile(join(root, "resources", "viniper-ui", "server.py"), "utf8");
  const app = await readFile(join(root, "resources", "viniper-ui", "static", "app.js"), "utf8");
  assert.match(server, /model-capabilities\.json/u);
  assert.match(server, /context_limit_for_model\(selected_model, mode=mode/u);
  assert.match(server, /async def get_session_usage\(\s*\n\s*session_id: str,\s*\n\s*model: str = Query/u);
  assert.match(server, /Unknown deployments are deliberately unavailable/u);
  assert.match(app, /function modelCapacityMetadata\(/u);
  assert.doesNotMatch(app, /const CONTEXT_LIMITS/u, "renderer does not duplicate deployment capacity facts");
  assert.match(app, /model\?\.context_status/u);
  assert.match(app, /模型上下文容量未知/u);
});
