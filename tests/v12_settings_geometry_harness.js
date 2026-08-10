const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const scale = Number(process.argv.find((item) => item.startsWith("--scale="))?.split("=")[1] || "1");
const width = Number(process.argv.find((item) => item.startsWith("--width="))?.split("=")[1] || "1320");
const height = Number(process.argv.find((item) => item.startsWith("--height="))?.split("=")[1] || "900");
if (scale !== 1) app.commandLine.appendSwitch("force-device-scale-factor", String(scale));
app.disableHardwareAcceleration();

function fixtureBody() {
  const results = [
    ["Agent 壳 Claude Code 自定义 CLI", "Agent"],
    ["自定义 CLI 命令", "Agent"],
    ["环境变量 自定义 CLI", "Agent"],
    ["权限 默认 询问 自动 计划", "Agent"],
    ["权限 自动模式", "Agent"],
    ["权限 跳过权限", "Agent"],
  ].map(([title, detail]) => `<button type="button"><strong>${title}</strong><span>${detail}</span></button>`).join("");
  return `<div id="settings-modal" class="modal">
      <div class="modal-content settings-modal-content">
        <div class="settings-shell">
          <aside class="settings-sidebar">
            <h2>设置</h2>
            <label class="settings-search-box"><input type="search" value="AGENT"></label>
            <div id="settings-search-results" class="settings-search-results">${results}</div>
            <nav class="settings-nav"><button class="settings-nav-item active">一般</button></nav>
          </aside>
          <section class="settings-main"><div class="settings-center-content"><h3>一般</h3></div></section>
        </div>
      </div>
    </div>`;
}

async function measure(width, height, css) {
  const win = new BrowserWindow({ show: false, width, height });
  await win.loadFile(path.join(__dirname, "..", "static", "index.html"));
  await win.webContents.insertCSS(css);
  await win.webContents.executeJavaScript(`document.documentElement.lang = "zh-CN"; document.documentElement.dataset.theme = "light"; document.body.innerHTML = ${JSON.stringify(fixtureBody())};`);
  const result = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll("#settings-search-results button")];
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      items: items.map((item, index) => {
        const rect = item.getBoundingClientRect();
        const next = items[index + 1]?.getBoundingClientRect();
        const strong = item.querySelector("strong").getBoundingClientRect();
        const detail = item.querySelector("span").getBoundingClientRect();
        return {
          text: item.innerText.trim(),
          top: rect.top,
          bottom: rect.bottom,
          nextTop: next?.top ?? null,
          contentBottom: Math.max(strong.bottom, detail.bottom),
          clientHeight: item.clientHeight,
          scrollHeight: item.scrollHeight,
          computedHeight: getComputedStyle(item).height,
        };
      }),
    };
  })()`);
  win.destroy();
  return result;
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "..");
  const css = fs.readFileSync(path.join(root, "static", "style.css"), "utf8");
  const result = await measure(width, height, css);
  process.stdout.write(JSON.stringify({ scale, width, height, result }));
  app.quit();
}).catch((error) => {
  process.stderr.write(String(error?.stack || error));
  app.exit(1);
});
