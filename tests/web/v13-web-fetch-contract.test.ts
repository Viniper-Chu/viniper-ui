import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { WebFetchService, createWebFetchTools } from "../../src/features/web/web-fetch-service";
import { createHarnessApplication } from "../../src/platform/bootstrap/create-harness-application";
import { UnavailableSecretVault } from "../../src/platform/security/unavailable-secret-vault";

test("web.fetch cleans HTML, preserves final URL/status, and bounds content", async () => {
  const service = new WebFetchService({
    fetchImpl: async () => new Response(
      `<html><head><title>官方说明</title><script>ignore()</script></head><body><h1>正文</h1><p>${"可信页面内容".repeat(100)}</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    ),
    maxChars: 32,
  });
  const result = await service.fetch({ url: "https://example.com/guide" });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, "https://example.com/guide");
  assert.equal(result.title, "官方说明");
  assert.match(result.content, /正文/u);
  assert.doesNotMatch(result.content, /ignore|<script>/u);
  assert.equal(result.truncated, true);
  assert.equal(result.contentTrustedAsInstructions, false);
});

test("web.fetch blocks file, localhost, loopback, and obvious private hosts", async () => {
  const service = new WebFetchService({ fetchImpl: async () => new Response("never") });
  for (const url of [
    "file:///C:/secret.txt",
    "http://localhost:8080/",
    "http://127.0.0.1:8080/",
    "http://192.168.1.20/",
    "http://10.0.0.4/",
  ]) {
    const result = await service.fetch({ url });
    assert.equal(result.ok, false, url);
    assert.equal(result.error?.code, "WEB_URL_BLOCKED", url);
  }
});

test("web.fetch rechecks a redirect final URL before reading private content", async () => {
  const service = new WebFetchService({
    fetchImpl: async () => {
      const response = new Response("must not be projected", { status: 200 });
      Object.defineProperty(response, "url", { value: "http://127.0.0.1:43111/secret" });
      return response;
    },
  });
  const result = await service.fetch({ url: "https://example.com/redirect" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "WEB_URL_BLOCKED");
  assert.equal(result.content, "");
});

test("web.fetch validates each manual redirect before requesting the next hop", async () => {
  const calls: string[] = [];
  const service = new WebFetchService({
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.redirect, "manual");
      return new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1:43111/secret" },
      });
    },
  });
  const result = await service.fetch({ url: "https://example.com/redirect" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "WEB_URL_BLOCKED");
  assert.deepEqual(calls, ["https://example.com/redirect"]);
});

test("web.fetch is registered through the formal application ToolRegistry with external permission", async () => {
  const root = await mkdtemp(join(process.cwd(), "codex", "运行残留", "v13-web-app-"));
  try {
    const bundle = await createHarnessApplication({
      dataRoot: root,
      workingDirectory: root,
      assetsRoot: root,
      secretVault: new UnavailableSecretVault(),
    });
    try {
      assert.equal(bundle.toolRegistry.has("web.fetch"), true);
      const tool = bundle.toolRegistry.get("web.fetch");
      assert.equal(tool.authorizationScope, "external");
      assert.match(tool.description, /外部不可信资料/u);
      assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ["url", "maxChars"]);
    } finally {
      await bundle.application.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("web tool construction stays available for a real ToolRegistry consumer", () => {
  const tools = createWebFetchTools(new WebFetchService({ fetchImpl: async () => new Response("ok") }));
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "web.fetch");
});
