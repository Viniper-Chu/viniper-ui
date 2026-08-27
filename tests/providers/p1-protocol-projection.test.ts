import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRequest, ProviderToolDefinition } from "../../src/core/provider-contracts";
import { serializeAnthropicMessages } from "../../src/features/providers/protocols/anthropic-messages/anthropic-messages-provider";
import { serializeGeminiInteractions } from "../../src/features/providers/protocols/gemini-interactions/gemini-interactions-provider";
import { serializeOpenAIChat } from "../../src/features/providers/protocols/openai-chat/openai-chat-provider";
import { serializeOpenAIResponses } from "../../src/features/providers/protocols/openai-responses/openai-responses-provider";
import { serializeSenseNova } from "../../src/features/providers/protocols/sensenova/sensenova-provider";
import { encodeProviderToolName } from "../../src/features/providers/protocols/shared/tool-name-projection";
import { DOMESTIC_MODEL_PROFILES } from "../../src/features/providers/profiles/domestic-models";
import { ProjectFilesystem } from "../../src/features/programming/contracts";
import { createProgrammingTools } from "../../src/features/programming/project-tools";
import { ToolRegistry } from "../../src/features/tools/tool-registry";
import { protocolRequest, testProfile } from "./protocol-test-kit";

const projectTools: ProviderToolDefinition[] = projectToolDescriptors();
const expectedProjectTools = [
  "project.delete",
  "project.diff",
  "project.edit",
  "project.list",
  "project.move",
  "project.read",
  "project.search",
  "project.write",
];

test("P1/P2 four tool-capable protocol serializers project all eight project schemas and SenseNova fails closed", () => {
  const responsesProfile = testProfile("openai-responses", "https://local.invalid/responses");
  const responses = serializeOpenAIResponses(p1Request(responsesProfile), responsesProfile);
  assert.deepEqual(toolNames(responses.tools), expectedProjectTools);

  const anthropicProfile = testProfile("anthropic-messages", "https://local.invalid/messages");
  const anthropic = serializeAnthropicMessages(p1Request(anthropicProfile), anthropicProfile);
  assert.deepEqual(toolNames(anthropic.tools), expectedProjectTools.map((name) => encodeProviderToolName(name)));

  const geminiProfile = testProfile("gemini-interactions", "https://local.invalid/interactions");
  const gemini = serializeGeminiInteractions(p1Request(geminiProfile), geminiProfile);
  assert.deepEqual(toolNames(gemini.tools), expectedProjectTools);
  assert.equal(JSON.stringify(gemini.tools).includes("function_declarations"), false);

  const chatProfile = testProfile("openai-chat", "https://local.invalid/chat/completions");
  const chat = serializeOpenAIChat(p1Request(chatProfile), chatProfile);
  assert.deepEqual(nestedToolNames(chat.tools), expectedProjectTools);

  const senseProfile = testProfile("sensenova", "https://local.invalid/sense");
  const sense = serializeSenseNova(p1Request(senseProfile));
  assert.equal("tools" in sense, false);

  for (const body of [responses, anthropic, gemini, chat]) {
    assert.match(JSON.stringify(body), /additionalProperties[^}]*false/u);
  }
});

test("P1/P2 DeepSeek aliases all canonical project tool names only inside the OpenAI Chat boundary", () => {
  const deepseek = DOMESTIC_MODEL_PROFILES.find((profile) => profile.id === "deepseek")!;
  const serialized = serializeOpenAIChat(p1Request(deepseek, "deepseek-v4-flash"), deepseek);
  const names = nestedToolNames(serialized.tools);
  assert.equal(names.length, 8);
  assert.equal(names.every((name) => /^[A-Za-z0-9_-]{1,64}$/u.test(name)), true);
  assert.equal(names.some((name) => name.includes(".")), false);
  assert.equal(new Set(names).size, 8);
});

function projectToolDescriptors(): ProviderToolDefinition[] {
  const registry = new ToolRegistry();
  for (const tool of createProgrammingTools({} as ProjectFilesystem)) registry.register(tool);
  return registry.descriptors();
}

function p1Request(profile: Parameters<typeof protocolRequest>[0], model?: string): ProviderRequest {
  const request = protocolRequest(profile, model);
  return { ...request, tools: structuredClone(projectTools) };
}

function toolNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String((item as Record<string, unknown>).name ?? ""))
    : [];
}

function nestedToolNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(((item as { function?: { name?: unknown } }).function?.name) ?? ""))
    : [];
}
