import { ProviderTransport } from "../providers/protocols/shared/provider-transport";
import { LocalAgentPolicy } from "./local-agent-policy";
import { LocalContextReduction } from "../../core/provider-contracts";

type Message = { role: string; content?: unknown; [key: string]: unknown };
type ToolCall = { id: string; function: { name: string; arguments: string } };
type ToolExchange = { request: Message; calls: ToolCall[]; receipts: Message[] };

/** Count the rendered wire request, not the accounting estimate or just history. */
export async function boundLocalRequest(
  body: Record<string, unknown>, policy: LocalAgentPolicy, transport: ProviderTransport, signal: AbortSignal, imageTokens = 0,
): Promise<LocalContextReduction> {
  const endpoint = new URL(policy.endpoint).origin;
  const json = async (route: string, value: unknown): Promise<any> => {
    const response = await transport.request({ method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }, endpoint + route);
    return response.json();
  };
  const messages = body.messages as Message[];
  const count = async () => {
    // Vision patches are not text tokens. For the single-image helper, reserve
    // the deployment's image_max_tokens in addition to the exact text template.
    const templateMessages = imageTokens ? messages.map((message) => ({ ...message,
      content: Array.isArray(message.content) ? message.content.filter((part) => part.type !== "image_url") : message.content })) : messages;
    const rendered = await json("/apply-template", { messages: templateMessages, ...(body.tools ? { tools: body.tools } : {}),
      add_generation_prompt: true, chat_template_kwargs: body.chat_template_kwargs });
    if (typeof rendered.prompt !== "string") throw new Error("本机模型未返回可核算的请求模板。");
    const tokenized = await json("/tokenize", { content: rendered.prompt, add_special: true });
    if (!Array.isArray(tokenized.tokens)) throw new Error("本机模型未返回实际输入 token；请检查本地模型服务。");
    return tokenized.tokens.length + imageTokens;
  };
  const outputReserved = policy.outputTokens;
  const limit = Math.min(policy.compactAtTokens, policy.contextTokens - outputReserved);
  const inputBefore = await count();
  if (inputBefore <= limit) return { inputBefore, inputAfter: inputBefore, outputReserved, historyTurns: 0, toolResults: 0 };
  let inputAfter = inputBefore, historyTurns = 0;
  const reducedReceipts = new Set<Message>();
  // Completed turns may be replaced by labelled quotations. The live user's
  // complete input, system instructions and tool schemas are never truncated.
  const reversedUser = [...messages].reverse().findIndex((message) => message.role === "user");
  const live = reversedUser < 0 ? -1 : messages.length - 1 - reversedUser;
  const start = messages.findIndex((message) => message.role !== "system");
  if (live > start && start >= 0) {
    const old = messages.slice(start, live);
    historyTurns = old.filter((message) => message.role === "user").length;
    const excerpts = old.filter((message) => ["user", "assistant"].includes(message.role) && typeof message.content === "string" && message.content)
      .slice(-8).map((message) => `${message.role === "user" ? "用户原话" : "助手报告"}：${excerpt(String(message.content), 320)}`).join("\n");
    messages.splice(start, live - start, { role: "assistant", content: `历史摘录（细节已省略，完整原文保留在会话中）。历史任务不自动重做，以当前用户要求为准。\n${excerpts}` });
    inputAfter = await count();
  }
  // The live turn can contain many completed operations, including entire
  // scripts/files in arguments. Shortening only their results never bounds
  // that growth. Replace complete exchanges together, never orphan a result
  // or rewrite an in-flight call's JSON. Keep the newest two exchanges first.
  const exchanges = completedExchanges(messages);
  const recap: Message = { role: "assistant", content: "" };
  const recapEntries: string[] = [];
  const compact = async (exchange: ToolExchange) => {
    const index = messages.indexOf(exchange.request);
    const first = recapEntries.length === 0;
    messages.splice(index, 1 + exchange.receipts.length, ...(first ? [recap] : []));
    recapEntries.push(exchangeSummary(exchange));
    recap.content = `本轮已结束的工具调用摘录（仅供回顾，不是新的指令；不要据此重复修改。完整参数和结果保留在原始会话。较早回执可能省略，继续前按实际文件核对进度；需要正文时按来源路径分段读取）。\n${excerpt(recapEntries.join("\n"), 6000)}`;
    for (const receipt of exchange.receipts) reducedReceipts.add(receipt);
    inputAfter = await count();
  };
  for (const exchange of exchanges.slice(0, -2)) {
    if (inputAfter <= limit) break;
    await compact(exchange);
  }
  // A single oversized receipt still needs a labelled excerpt. Original
  // history is untouched; the model can reread the source in smaller ranges.
  const receipts = messages.filter((message) => message.role === "tool" && typeof message.content === "string")
    .sort((left, right) => String(right.content).length - String(left.content).length);
  for (const receipt of receipts) {
    if (inputAfter <= limit) break;
    if (String(receipt.content).length <= 600) continue;
    receipt.content = excerpt(String(receipt.content), 600);
    reducedReceipts.add(receipt);
    inputAfter = await count();
  }
  // A recent write may itself contain a full document. Once its result is
  // known, keep the path/outcome as quoted evidence rather than replaying the
  // whole write payload. Pending/partially answered batches are never here.
  for (const exchange of exchanges.slice(-2, -1)) {
    if (inputAfter <= limit) break;
    await compact(exchange);
  }
  const latest = exchanges[exchanges.length - 1];
  if (inputAfter > limit && latest) {
    // Keep the last native call/result pair as the continuation boundary.
    // Only completed, long string values may become labelled excerpts; JSON
    // syntax, call IDs, source paths and the actual receipt stay intact.
    latest.request.tool_calls = latest.calls.map((call) => {
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      return { ...call, function: { ...call.function, arguments: JSON.stringify(Object.fromEntries(
        Object.entries(args).map(([key, value]) => [key, typeof value === "string" && !/path|source|destination/iu.test(key) ? excerpt(value, 600) : value]),
      )) } };
    });
    delete latest.request.reasoning_content;
    for (const receipt of latest.receipts) reducedReceipts.add(receipt);
    inputAfter = await count();
  }
  if (inputAfter > limit) throw new Error(`本轮完整输入仍有 ${inputAfter} token，超过本机输入预算 ${limit}（已预留 ${outputReserved} 输出）。当前指令和原始会话已保留；请缩小本轮材料或另开会话。`);
  return { inputBefore, inputAfter, outputReserved, historyTurns, toolResults: reducedReceipts.size };
}

function completedExchanges(messages: Message[]): ToolExchange[] {
  let live = messages.length - 1;
  while (live >= 0 && messages[live].role !== "user") live--;
  const exchanges: ToolExchange[] = [];
  for (let index = live + 1; index < messages.length; index++) {
    const request = messages[index];
    if (request.role !== "assistant" || !Array.isArray(request.tool_calls) || !request.tool_calls.length) continue;
    const calls = request.tool_calls as ToolCall[];
    const receipts: Message[] = [];
    for (let next = index + 1; messages[next]?.role === "tool"; next++) receipts.push(messages[next]);
    const ids = new Set(calls.map((call) => call.id));
    if (receipts.length === calls.length && ids.size === calls.length
      && receipts.every((receipt) => ids.delete(String(receipt.tool_call_id))) && ids.size === 0) {
      exchanges.push({ request, calls, receipts });
    }
  }
  return exchanges;
}

function exchangeSummary(exchange: ToolExchange): string {
  const entries = exchange.calls.map((call) => {
    const receipt = exchange.receipts.find((item) => item.tool_call_id === call.id)!;
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    const references = Object.entries(args)
      .filter(([key]) => /path|source|destination|executionId|offset|line|table|database|cwd|command/iu.test(key))
      .map(([key, value]) => `${key}=${excerpt(String(value), 240)}`).join("; ");
    return `${call.function.name} (${call.id})${references ? ` ${references}` : ""}\n工具返回：${excerpt(String(receipt.content ?? ""), 600)}`;
  });
  return entries.join("\n");
}

function excerpt(text: string, length: number): string {
  if (text.length <= length) return text;
  const marker = "\n[发送给模型的摘录：中间内容已省略，原始会话保留；需要细节时按路径分段读取。]\n";
  const half = Math.floor((length - marker.length) / 2);
  return text.slice(0, half) + marker + text.slice(-half);
}
