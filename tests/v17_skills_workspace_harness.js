const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1.5");
app.disableHardwareAcceleration();

function rectOf(node) {
  const rect = node?.getBoundingClientRect?.();
  return rect ? {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  } : null;
}

async function measure(root, width, height) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    minWidth: 900,
    minHeight: 680,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f5f3ee", symbolColor: "#302f2b", height: 32 },
    webPreferences: {
      partition: `temporary:v17-skills-${process.pid}-${width}-${height}`,
    },
  });
  await win.loadFile(path.join(root, "static", "index.html"));
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, "static", "style.css"), "utf8"));
  await win.webContents.executeJavaScript('document.documentElement.dataset.skipSplash = "true";');
  await win.webContents.executeJavaScript(
    fs.readFileSync(path.join(root, "static", "app.js"), "utf8") + "\nnull;\n//# sourceURL=viniper-app.js",
  );
  await win.webContents.executeJavaScript('document.dispatchEvent(new Event("DOMContentLoaded"));');
  await new Promise((resolve) => setTimeout(resolve, 80));
  const result = await win.webContents.executeJavaScript(`(async () => {
    document.documentElement.dataset.skipSplash = "true";
    document.querySelector("#launch-splash")?.remove();
    const api = globalThis.__VINIPER_TEST_API__;
    api.setViewMode("agent");
    api.state.sessionId = "session-A";
    api.state.sessionMode = "agent";
    api.state.messages = [{role:"user", content:"保留的会话正文"}];
    const messages = document.querySelector("#messages");
    messages.innerHTML = Array.from({length: 80}, (_, index) => '<p>会话 A 行 ' + index + '</p>').join("");
    const chat = document.querySelector("#chat-container");
    chat.scrollTop = 320;
    const dock = document.querySelector("#interaction-dock");
    dock.innerHTML = '<button type="button">旧会话权限卡</button>';
    const before = {
      sessionId: api.state.sessionId,
      messages: api.state.messages.length,
      scrollTop: chat.scrollTop,
    };
    document.querySelector("#customize-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const surface = (selector) => {
      const node = document.querySelector(selector);
      const style = getComputedStyle(node);
      return {
        rect: (${rectOf.toString()})(node),
        display: style.display,
        visibility: style.visibility,
        pointerEvents: style.pointerEvents,
        inert: Boolean(node.inert),
        ariaHidden: node.getAttribute("aria-hidden"),
      };
    };
    const skills = document.querySelector("#skills-view");
    const layout = document.querySelector(".skills-layout");
    const detail = document.querySelector("#skill-detail");
    const detailContent = document.querySelector("#skill-detail-content");
    detail.classList.remove("hidden");
    detailContent.innerHTML = '<section class="skill-original-content"><pre><span class="code-lang">bash</span><button class="copy-btn">复制</button><code>printf safe</code></pre></section>';
    const codePre = (${rectOf.toString()})(detailContent.querySelector("pre"));
    const codeLang = (${rectOf.toString()})(detailContent.querySelector(".code-lang"));
    const copyButton = (${rectOf.toString()})(detailContent.querySelector(".copy-btn"));
    const codeControlsContained = Boolean(codePre && codeLang && copyButton
      && codeLang.top >= codePre.top && codeLang.bottom <= codePre.bottom
      && copyButton.top >= codePre.top && copyButton.bottom <= codePre.bottom);
    detail.classList.add("hidden");
    detailContent.innerHTML = "";
    const open = {
      viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
      main: (${rectOf.toString()})(document.querySelector("#main")),
      modeBar: (${rectOf.toString()})(document.querySelector("#workspace-mode-bar")),
      skills: (${rectOf.toString()})(skills),
      layout: (${rectOf.toString()})(layout),
      gridColumns: getComputedStyle(layout).gridTemplateColumns,
      hidden: skills.classList.contains("hidden"),
      chat: surface("#chat-container"),
      messages: surface("#messages"),
      input: surface("#input-area"),
      dock: surface("#interaction-dock"),
      codeBlocks: {pre: codePre, lang: codeLang, copy: copyButton, contained: codeControlsContained},
      state: {sessionId: api.state.sessionId, messages: api.state.messages.length, scrollTop: chat.scrollTop},
    };
    document.querySelector("#close-skills-view-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const closed = {
      hidden: skills.classList.contains("hidden"),
      chat: surface("#chat-container"),
      input: surface("#input-area"),
      state: {sessionId: api.state.sessionId, messages: api.state.messages.length, scrollTop: chat.scrollTop},
    };
    return {requested: {width:${width}, height:${height}}, before, open, closed};
  })()`);
  win.destroy();
  return result;
}

app.whenReady().then(async () => {
  const resultPath = process.env.VINIPER_V17_SKILLS_RESULT;
  if (!resultPath) throw new Error("VINIPER_V17_SKILLS_RESULT is required");
  const root = path.resolve(__dirname, "..");
  const keeper = new BrowserWindow({ show: false, width: 1, height: 1 });
  const payload = {
    large: await measure(root, 1280, 800),
    half: await measure(root, 900, 700),
  };
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");
  keeper.destroy();
  app.quit();
}).catch((error) => {
  const resultPath = process.env.VINIPER_V17_SKILLS_RESULT;
  if (resultPath) fs.writeFileSync(resultPath, JSON.stringify({error: error.stack || String(error)}), "utf8");
  app.exit(1);
});
