import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { test } from "node:test";
import { ExtensionManager } from "../../src/features/extensions/extension-manager";
import { ExtensionPackageManager } from "../../src/features/extensions/extension-package-manager";
import { connectLoopbackMcp } from "../../src/features/extensions/loopback-mcp-connector";
import { PersistedExtensionMetadata } from "../../src/core/extension-contracts";
import { ToolExecutor, ToolRegistry } from "../../src/features/tools/tool-registry";

async function fixture() {
  const calls: Array<{ path: string; method: string; params: any }> = [];
  const names = new Map<string, string[]>([
    ["/first", ["workstation.identity", "coordination.send-message"]],
    ["/second", ["workstation.identity", "coordination.send-message"]],
    ["/collision", ["new-before-collision", "workstation.identity"]],
    ["/duplicate", ["workstation.identity", "workstation.identity"]],
  ]);
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    const path = request.url || "/first";
    calls.push({ path, method: body.method, params: body.params });
    let result: unknown;
    if (body.method === "initialize") result = { protocolVersion: "2024-11-05", serverInfo: { name: path, version: "1" }, capabilities: { tools: {} } };
    else if (body.method === "tools/list") {
      // Ensure competing connect/refresh/disconnect calls cross real HTTP I/O.
      await new Promise((resolve) => setTimeout(resolve, 25));
      result = { tools: (names.get(path) || []).map((name) => ({ name, inputSchema: { type: "object" } })) };
    } else if (body.method === "tools/call") result = { content: [{ type: "text", text: JSON.stringify({ path, name: body.params.name, input: body.params.arguments }) }], isError: false };
    else throw new Error(`Unexpected test MCP method: ${body.method}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const registry = new ToolRegistry();
  let saved: PersistedExtensionMetadata = { enabledSkillsBySession: {} };
  const dataRoot = join(process.cwd(), "codex", "运行残留", "mcp-lifecycle");
  const manager = new ExtensionManager({
    dataRoot,
    persistence: { loadExtensionMetadata: async () => structuredClone(saved), saveExtensionMetadata: async (value) => { saved = structuredClone(value); } },
    packages: new ExtensionPackageManager({ dataRoot }),
    processHost: { invoke: async () => { throw new Error("No plugin process is allowed in this fixture"); }, dispose: async () => {} },
    toolRegistry: registry, mcpConnector: connectLoopbackMcp,
  });
  await manager.initialize();
  return { manager, registry, calls, names, endpoint, cleanup: async () => {
    await manager.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

function localTool(name: string): ToolExecutor {
  return { name, description: "owned local tool", readOnly: true, inputSchema: { type: "object" },
    execute: async (request) => ({ toolId: request.id, text: "builtin unchanged" }) };
}

test("real HTTP MCP concurrent connects share one discovery and namespace tools independently of builtins and other connections", async () => {
  const f = await fixture();
  try {
    const builtin = localTool("coordination.send-message");
    f.registry.register(builtin);
    await f.manager.configureMcp({ id: "workstation-loopback", endpoint: `${f.endpoint}/first` });
    const connected = await Promise.all(Array.from({ length: 6 }, () => f.manager.connectMcp("workstation-loopback")));
    assert.ok(connected.every((value) => value === connected[0]));
    assert.equal(f.calls.filter((call) => call.path === "/first" && call.method === "initialize").length, 1);
    assert.equal(f.manager.snapshot().mcpConnections?.[0].connected, true);
    assert.equal(f.manager.snapshot().mcpConnections?.[0].lastError, undefined);
    await f.manager.configureMcp({ id: "second", endpoint: `${f.endpoint}/second` });
    await f.manager.connectMcp("second");
    assert.equal(f.registry.get("coordination.send-message"), builtin);
    assert.equal(f.registry.descriptors().length, 5);
    for (const [id, path] of [["workstation-loopback", "/first"], ["second", "/second"]]) {
      const name = `mcp.${id}.coordination.send-message`;
      const value = await f.registry.get(name).execute({ id: `call-${id}`, name, summary: "local fixture", readOnly: false,
        scope: "computer", input: { marker: id } }, { sessionId: "s", runId: "r", signal: new AbortController().signal });
      assert.equal(value.isError, false);
      const payload = JSON.parse((value.data as any).content[0].text);
      assert.deepEqual(payload, { path, name: "coordination.send-message", input: { marker: id } });
    }
    await f.manager.disconnectMcp("workstation-loopback");
    assert.equal(f.registry.has("mcp.workstation-loopback.workstation.identity"), false);
    assert.equal(f.registry.has("mcp.second.workstation.identity"), true);
    assert.equal(f.registry.get("coordination.send-message"), builtin);
  } finally { await f.cleanup(); }
});

test("MCP collision rejects the entire discovered set without replacing another owner or leaving partial tools", async () => {
  const f = await fixture();
  try {
    const otherOwner = localTool("mcp.collision.workstation.identity");
    f.registry.register(otherOwner);
    await f.manager.configureMcp({ id: "collision", endpoint: `${f.endpoint}/collision` });
    await assert.rejects(f.manager.connectMcp("collision"), /MCP_TOOL_NAME_COLLISION/u);
    assert.equal(f.registry.get(otherOwner.name), otherOwner);
    assert.equal(f.registry.has("mcp.collision.new-before-collision"), false);
    assert.equal(f.manager.snapshot().mcpConnections?.find((item) => item.id === "collision")?.connected, false);
    f.registry.unregister(otherOwner.name);
    await f.manager.connectMcp("collision");
    assert.equal(f.registry.has("mcp.collision.new-before-collision"), true, "a rejected operation cannot poison future reconnects");
    await f.manager.configureMcp({ id: "duplicate", endpoint: `${f.endpoint}/duplicate` });
    await assert.rejects(f.manager.connectMcp("duplicate"), /MCP_TOOL_NAME_COLLISION/u);
    assert.equal(f.registry.has("mcp.duplicate.workstation.identity"), false);
  } finally { await f.cleanup(); }
});

test("MCP disconnect/configure/refresh serialize behind discovery and revoke only their own tool bindings", async () => {
  const f = await fixture();
  try {
    await f.manager.configureMcp({ id: "workstation-loopback", endpoint: `${f.endpoint}/first` });
    const connecting = f.manager.connectMcp("workstation-loopback");
    const disconnecting = f.manager.disconnectMcp("workstation-loopback");
    await Promise.all([connecting, disconnecting]);
    assert.equal(f.manager.snapshot().mcpConnections?.[0].connected, false);
    assert.equal(f.registry.descriptors().length, 0);
    await f.manager.connectMcp("workstation-loopback");
    await f.manager.configureMcp({ id: "workstation-loopback", endpoint: `${f.endpoint}/first` });
    assert.equal(f.manager.snapshot().mcpConnections?.[0].connected, true, "idempotent host configuration preserves a live connection");
    await f.manager.configureMcp({ id: "workstation-loopback", endpoint: `${f.endpoint}/second` });
    assert.equal(f.registry.descriptors().length, 0);
    assert.equal(f.manager.snapshot().mcpConnections?.[0].connected, false);
    await Promise.all([f.manager.refreshMcp("workstation-loopback"), f.manager.connectMcp("workstation-loopback")]);
    assert.equal(f.manager.snapshot().mcpConnections?.[0].connected, true);
    const name = "mcp.workstation-loopback.workstation.identity";
    f.registry.unregister(name);
    const replacement = localTool(name);
    f.registry.register(replacement);
    await f.manager.disconnectMcp("workstation-loopback");
    assert.equal(f.registry.get(name), replacement, "disconnect must not delete a later different owner");
  } finally { await f.cleanup(); }
});
