/** Minimal host-owned MCP JSON-RPC connector.  Only loopback HTTP endpoints
 * are accepted; the renderer never receives credentials or raw transport
 * details.  The returned discovery snapshot is intentionally data-only so the
 * ExtensionManager can expose tools without pretending that a connector is a
 * full agent runtime. */
export interface LoopbackMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface LoopbackMcpSnapshot {
  protocolVersion?: string;
  serverInfo?: unknown;
  tools: LoopbackMcpTool[];
  callTool(name: string, args?: unknown): Promise<unknown>;
}

export async function connectLoopbackMcp(endpoint: string): Promise<LoopbackMcpSnapshot> {
  const url = new URL(endpoint);
  if (!(["localhost", "127.0.0.1", "::1"] as string[]).includes(url.hostname.toLowerCase())) {
    throw new Error("OUTBOUND_NETWORK_BLOCKED");
  }
  let nextId = 0;
  const request = async (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const requestFn = globalThis.fetch;
    if (!requestFn) throw new Error("MCP_FETCH_UNAVAILABLE");
    const response = await requestFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
    const payload = await response.json() as { error?: { message?: string }; result?: any };
    if (payload.error) throw new Error(String(payload.error.message || "MCP_RPC_ERROR"));
    return payload.result ?? {};
  };

  const initialize = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
      clientInfo: { name: "Viniper workstation", version: "1.8.1" },
  });
  const listed = await request("tools/list");
  const tools = Array.isArray(listed.tools)
    ? listed.tools.filter((tool: any) => tool && typeof tool.name === "string").map((tool: any) => ({
      name: tool.name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    }))
    : [];
  return {
    protocolVersion: typeof initialize.protocolVersion === "string" ? initialize.protocolVersion : undefined,
    serverInfo: initialize.serverInfo,
    tools,
    callTool: (name, args) => request("tools/call", { name, arguments: args ?? {} }),
  };
}
