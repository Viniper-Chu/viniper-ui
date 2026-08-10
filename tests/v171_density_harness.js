const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();

async function measure(root, width, height, surface) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    minWidth: 900,
    minHeight: 680,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f5f3ee", symbolColor: "#302f2b", height: 32 },
    webPreferences: { partition: `temporary:v171-density-${process.pid}-${width}-${height}-${surface}` },
  });
  await win.loadFile(path.join(root, "static", "index.html"));
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, "static", "style.css"), "utf8"));
  const result = await win.webContents.executeJavaScript(`(async () => {
    document.documentElement.dataset.fontSize = "normal";
    document.body.dataset.viewMode = ${JSON.stringify(surface === "agent-composer" ? "agent" : "chat")};
    const main = document.querySelector("#main");
    if (main) main.classList.toggle("agent-view", ${surface === "agent-composer"});
    const composer = document.querySelector("#composer");
    if (composer) composer.dataset.surface = ${JSON.stringify(surface)};
    await new Promise((resolve) => setTimeout(resolve, 260));
    const selectors = [
      "body",
      "#app",
      "#topbar",
      ".topbar-nav-button",
      ".topbar-nav-button .nav-icon",
      ".view-tab",
      ".view-tab-icon",
      ".sidebar-nav-item",
      "#composer",
      "#user-input",
      ".send-button",
    ];
    const result = Object.fromEntries(selectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return [selector, null];
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return [selector, {
        width: bounds.width,
        height: bounds.height,
        fontSize: Number.parseFloat(style.fontSize) || 0,
        lineHeight: style.lineHeight,
        transform: style.transform,
        zoom: style.zoom || "1",
      }];
    }));
    return {
      requested: { width: ${width}, height: ${height} },
      windowBounds: ${JSON.stringify(win.getBounds())},
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      compactBreakpoint: matchMedia("(max-width: 819px)").matches,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      metrics: result,
    };
  })()`);
  win.destroy();
  return result;
}

app.whenReady().then(async () => {
  const resultPath = process.env.VINIPER_V171_DENSITY_RESULT;
  if (!resultPath) throw new Error("VINIPER_V171_DENSITY_RESULT is required");
  const root = path.resolve(__dirname, "..");
  const keeper = new BrowserWindow({ show: false, width: 1, height: 1 });
  const payload = {
    largeChat: await measure(root, 1280, 800, "chat-composer"),
    largeAgent: await measure(root, 1280, 800, "agent-composer"),
    halfChat: await measure(root, 900, 700, "chat-composer"),
    halfAgent: await measure(root, 900, 700, "agent-composer"),
  };
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), "utf8");
  keeper.destroy();
  app.quit();
}).catch((error) => {
  const resultPath = process.env.VINIPER_V171_DENSITY_RESULT;
  if (resultPath) fs.writeFileSync(resultPath, JSON.stringify({ error: error.stack || String(error) }), "utf8");
  app.exit(1);
});
