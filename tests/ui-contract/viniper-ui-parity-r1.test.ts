import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("R1 keeps the original Viniper shell baseline and one shared Agent conversation surface", async (t) => {
  const originalRoot = "D:\\Viniper\\resources\\viniper-ui\\static";
  let originalIndex = "";
  let originalStyle = "";
  try {
    [originalIndex, originalStyle] = await Promise.all([
      readFile(`${originalRoot}\\index.html`, "utf8"),
      readFile(`${originalRoot}\\style.css`, "utf8"),
    ]);
  } catch {
    t.skip("原版 Viniper 安装资源不可用，跳过本机基线对照");
    return;
  }

  const html = await readFile("src/renderer/shell/index.html", "utf8");
  const conversation = await readFile("src/renderer/conversation/conversation.js", "utf8");
  const provider = await readFile("src/renderer/providers/provider-settings.js", "utf8");
  const styles = await readFile("src/renderer/styles/v019-viniper-workstation.css", "utf8");

  assert.match(originalIndex, /id="messages"/u);
  assert.match(originalIndex, /id="input-area"/u);
  assert.match(originalStyle, /\.thinking-panel/u);
  assert.match(originalStyle, /(?:#|\.)message-trace-rail/u);

  const agentButtons = [...html.matchAll(/<button[^>]*data-agent-engine="([^"]+)"[\s\S]*?<img[^>]*src="([^"]+)"/gu)];
  assert.equal(agentButtons.length, 2);
  assert.equal(agentButtons[0][2], agentButtons[1][2], "两个 Agent 必须使用同一立体品牌资产");
  assert.match(html, /data-conversation-shell="viniper-claude-code"/u);
  assert.match(html, /data-event-source="canonical-runtime-snapshot"/u);
  assert.match(conversation, /projectActivityTimeline/u);
  assert.match(conversation, /thinking-icon/u);
  assert.match(conversation, /tool-status-dot/u);
  assert.match(conversation, /artifact-summary-path/u);
  assert.doesNotMatch(conversation, /engineId|selectedEngine/u);

  assert.match(styles, /\.app-menu-bar,[\s\S]*\.session-header-tools,[\s\S]*#openCoordinationButton\s*\{\s*display:\s*none/u);
  assert.match(styles, /\.session-filter-drawer\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(provider, /官网确认|依模型\/区域|REAL_API_UNPROVEN|vendor\s*·/u);
  assert.match(provider, /capabilityLabels/u);
});
