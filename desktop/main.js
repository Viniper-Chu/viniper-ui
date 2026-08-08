const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, ipcMain } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "viniper-ui")
  : path.resolve(__dirname, "..");
function readProfileConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_ROOT, "profiles.json"), "utf8"));
  } catch {
    return {};
  }
}

const PROFILE_CONFIG = readProfileConfig();
const PREVIEW_PROFILE = PROFILE_CONFIG.preview || {
  app_id: "com.viniper.desktop.preview",
  product_name: "Viniper Preview",
  port: 17946,
  data_dir_name: "Viniper Preview"
};
const DESKTOP_METADATA = (() => {
  try {
    return require(path.join(__dirname, "package.json"));
  } catch {
    return {};
  }
})();
const ICON_PATH = process.platform === "win32"
  ? path.join(APP_ROOT, "static", "assets", "viniper-icon.ico")
  : path.join(APP_ROOT, "static", "assets", "viniper-icon.png");
const BADGE_ICON_PATH = path.join(APP_ROOT, "static", "assets", "viniper-icon-badge-1.png");
const BUNDLED_VERSION = readBundledVersion();
const IS_PREVIEW = process.env.VINIPER_UI_PREVIEW === "1"
  || DESKTOP_METADATA.viniperProfile === "preview"
  || fs.existsSync(path.join(APP_ROOT, "PREVIEW"));
const DISPLAY_NAME = IS_PREVIEW ? PREVIEW_PROFILE.product_name : "Viniper UI";
const APP_USER_MODEL_ID = IS_PREVIEW ? PREVIEW_PROFILE.app_id : "com.viniper.ui.desktop";

let port = Number(process.env.VINIPER_UI_PORT || (IS_PREVIEW ? PREVIEW_PROFILE.port : 17373));
let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;
let isStarting = false;
let stdioBroken = false;
let alwaysOnTop = false;
let trayBadgeCount = 0;

function handleStdioError(error) {
  if (error && error.code === "EPIPE") {
    stdioBroken = true;
    return;
  }
  throw error;
}

process.stdout?.on?.("error", handleStdioError);
process.stderr?.on?.("error", handleStdioError);

function localUrl(options = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const params = new URLSearchParams();
  if (options.launch) params.set("launch", "1");
  if (IS_PREVIEW && (options.launch || options.cache)) {
    params.set("preview", "1");
    params.set("cache", String(Date.now()));
  }
  const query = params.toString();
  return query ? `${baseUrl}/?${query}` : baseUrl;
}

function appIcon(size = 0) {
  const image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty() || !size) return image;
  return image.resize({ width: size, height: size, quality: "best" });
}

function splashIconDataUrl() {
  const iconPath = path.join(APP_ROOT, "static", "assets", "viniper-icon.png");
  if (!fs.existsSync(iconPath)) return "";
  return `data:image/png;base64,${fs.readFileSync(iconPath).toString("base64")}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;

  const splashIcon = splashIconDataUrl();
  const splashHtml = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
      user-select: none;
    }
    body {
      display: grid;
      place-items: center;
    }
    .boot-mark {
      width: 154px;
      height: 154px;
      display: grid;
      place-items: center;
      filter: drop-shadow(0 20px 34px rgba(0, 18, 22, 0.32));
      animation: mark-breathe 1.7s ease-in-out 1.05s infinite;
    }
    .boot-icon {
      width: 100%;
      height: 100%;
      object-fit: contain;
      clip-path: inset(0 100% 0 0 round 22px);
      opacity: 0;
      transform: scale(0.94);
      animation: v-reveal 1.05s cubic-bezier(0.18, 0.86, 0.24, 1) both;
    }
    .boot-mark::after {
      content: "";
      position: absolute;
      width: 150px;
      height: 150px;
      border-radius: 30px;
      background: linear-gradient(105deg, transparent 26%, rgba(255,255,255,0.58) 45%, transparent 64%);
      mix-blend-mode: screen;
      opacity: 0;
      transform: translateX(-88px) skewX(-16deg);
      animation: v-shine 1.05s ease-out 0.18s both;
      pointer-events: none;
    }
    @keyframes v-reveal {
      0% {
        opacity: 0;
        clip-path: inset(0 100% 0 0 round 22px);
        filter: blur(10px) saturate(0.7);
        transform: scale(0.9);
      }
      58% {
        opacity: 1;
        clip-path: inset(0 18% 0 0 round 22px);
        filter: blur(0) saturate(1.08);
        transform: scale(1.045);
      }
      100% {
        opacity: 1;
        clip-path: inset(0 0 0 0 round 22px);
        filter: blur(0) saturate(1);
        transform: scale(1);
      }
    }
    @keyframes v-shine {
      0% { opacity: 0; transform: translateX(-96px) skewX(-16deg); }
      38% { opacity: 0.72; }
      100% { opacity: 0; transform: translateX(96px) skewX(-16deg); }
    }
    @keyframes mark-breathe {
      0%, 100% { transform: scale(1); filter: drop-shadow(0 20px 34px rgba(0,18,22,0.28)); }
      50% { transform: scale(1.025); filter: drop-shadow(0 24px 42px rgba(0,18,22,0.36)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .boot-mark, .boot-icon, .boot-mark::after { animation: none !important; opacity: 1; clip-path: none; transform: none; }
    }
  </style>
</head>
<body>
  <div class="boot-mark">
    <img class="boot-icon" src="${splashIcon}" alt="">
  </div>
</body>
</html>`;

  splashWindow = new BrowserWindow({
    width: 260,
    height: 260,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    title: DISPLAY_NAME,
    icon: appIcon(),
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.center();
  const splashB64 = Buffer.from(splashHtml, "utf8").toString("base64");
  await splashWindow.loadURL(`data:text/html;base64,${splashB64}`);
  splashWindow.showInactive();
  return splashWindow;
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
  }
  splashWindow = null;
}

function trayIcon(size = 0) {
  const useBadge = trayBadgeCount > 0 && fs.existsSync(BADGE_ICON_PATH);
  let image = nativeImage.createFromPath(useBadge ? BADGE_ICON_PATH : ICON_PATH);
  if (image.isEmpty() && useBadge) image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty() || !size) return image;
  return image.resize({ width: size, height: size, quality: "best" });
}

function updateTrayVisuals() {
  if (!tray) return;
  const size = process.platform === "win32" ? 16 : 22;
  const image = trayIcon(size);
  if (!image.isEmpty()) tray.setImage(image);
  tray.setToolTip(trayBadgeCount > 0 ? `${DISPLAY_NAME} - ${trayBadgeCount} 条新回复` : DISPLAY_NAME);
  try {
    app.setBadgeCount(trayBadgeCount);
  } catch {}
}

function setTrayBadge(count) {
  trayBadgeCount = Math.max(0, Math.min(99, Number(count) || 0));
  updateTrayVisuals();
  updateTrayMenu();
}

function clearTrayBadge() {
  if (trayBadgeCount > 0) setTrayBadge(0);
}

function markConversationCompleted() {
  const shouldBadge = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !mainWindow.isFocused();
  if (shouldBadge) setTrayBadge(1);
}

function readBundledVersion() {
  try {
    return fs.readFileSync(path.join(APP_ROOT, "VERSION"), "utf8").trim();
  } catch {
    return "";
  }
}

function safeMainLog(level, message) {
  if (stdioBroken) return;
  const output = `${message}\n`;
  const stream = level === "error" ? process.stderr : process.stdout;
  try {
    if (!stream || stream.destroyed || !stream.writable) return;
    stream.write(output);
  } catch (error) {
    if (error && error.code === "EPIPE") {
      stdioBroken = true;
      return;
    }
    throw error;
  }
}

function logServerChunk(level, chunk) {
  const text = chunk.toString().trim();
  if (!text) return;
  safeMainLog(level, `[${DISPLAY_NAME}] ${text}`);
}

function previewUserDataDir() {
  const dataDirName = PREVIEW_PROFILE.data_dir_name || "Viniper Preview";
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), dataDirName);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", dataDirName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), dataDirName);
}

function sendRendererCommand(command, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
  mainWindow.webContents.send("viniper-command", { command, payload });
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("viniper-window-state", { alwaysOnTop });
}

function setAlwaysOnTop(enabled) {
  alwaysOnTop = Boolean(enabled);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(alwaysOnTop, "floating");
  }
  updateTrayMenu();
  createApplicationMenu();
  sendWindowState();
  return { alwaysOnTop };
}

function toggleAlwaysOnTop() {
  return setAlwaysOnTop(!alwaysOnTop);
}

function openSettingsWindow() {
  sendRendererCommand("open-settings");
}

function openSkillsWindow() {
  shell.openExternal("https://www.skills.sh");
}

function requestJson(urlPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(`${localUrl()}${urlPath}`, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 500) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}

async function requestStatus(timeoutMs = 1500) {
  return requestJson("/api/status", timeoutMs);
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await requestStatus();
    if (status) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function findOpenPort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(findOpenPort(startPort + 1)));
    server.listen(startPort, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function findPython() {
  const candidates = process.platform === "win32"
    ? [
        { command: "py", args: ["-3"] },
        { command: "python", args: [] },
        { command: "python3", args: [] }
      ]
    : [
        { command: "python3", args: [] },
        { command: "python", args: [] }
      ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
      windowsHide: true,
      stdio: "ignore"
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function ensurePythonDependencies(python) {
  const requirements = path.join(APP_ROOT, "requirements.txt");
  if (!fs.existsSync(requirements)) return;

  const marker = path.join(app.getPath("userData"), `deps-${BUNDLED_VERSION || "dev"}.ok`);
  if (fs.existsSync(marker)) return;

  const result = spawnSync(python.command, [...python.args, "-m", "pip", "install", "-q", "-r", requirements], {
    cwd: APP_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000
  });
  if (result.status !== 0) {
    throw new Error(`Python dependencies failed to install.\n${result.stdout || ""}${result.stderr || ""}`);
  }
  fs.writeFileSync(marker, new Date().toISOString(), "utf8");
}

function startServerProcess() {
  const python = findPython();
  if (!python) {
    throw new Error("Python 3 was not found. Install Python 3.10+ and try again.");
  }
  ensurePythonDependencies(python);

  const script = path.join(APP_ROOT, "server.py");
  const env = {
    ...process.env,
    VINIPER_UI_OPEN_BROWSER: "0",
    VINIPER_UI_DESKTOP: "1",
    VINIPER_UI_PORT: String(port)
  };
  if (app.isPackaged) {
    env.VINIPER_UI_DESKTOP_EXE = process.execPath;
  }
  if (IS_PREVIEW) {
    env.VINIPER_UI_PREVIEW = "1";
    env.VINIPER_UI_DATA_DIR = path.join(app.getPath("userData"), "data");
    env.VINIPER_UI_ASSET_VERSION = `${BUNDLED_VERSION || "dev"}-preview-${Date.now()}`;
  }

  serverProcess = spawn(python.command, [...python.args, script], {
    cwd: APP_ROOT,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (chunk) => logServerChunk("log", chunk));
  serverProcess.stderr.on("data", (chunk) => logServerChunk("error", chunk));
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (isQuitting) return;
    safeMainLog("log", `[Viniper UI] Server exited (code=${code}), restarting in 2s...`);
    setTimeout(async () => {
      if (isQuitting || serverProcess) return;
      try {
        startServerProcess();
        await waitForServer(30000);
        if (mainWindow) mainWindow.loadURL(localUrl());
      } catch {
        safeMainLog("error", "[Viniper UI] Server auto-restart failed.");
      }
    }, 2000);
  });
}

async function ensureServer() {
  const existing = await waitForServer(1200);
  if (existing && (!BUNDLED_VERSION || existing.version === BUNDLED_VERSION)) return true;
  if (existing && BUNDLED_VERSION && existing.version !== BUNDLED_VERSION) {
    if (serverProcess) { serverProcess.kill(); serverProcess = null; }
    port = await findOpenPort(port + 1);
  }
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  startServerProcess();
  return Boolean(await waitForServer(30000));
}

async function createMainWindow() {
  if (isStarting) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return;
  }

  isStarting = true;
  const splashStartedAt = Date.now();
  await createSplashWindow();

  const ready = await ensureServer();
  if (!ready) {
    closeSplashWindow();
    isStarting = false;
    dialog.showErrorBox(
      `${DISPLAY_NAME} 启动失败`,
      `本地服务没有在 ${port} 端口就绪。请确认 Python 3、requirements.txt 依赖和 Claude Code 已安装。`
    );
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: IS_PREVIEW ? PREVIEW_PROFILE.product_name : "Viniper UI",
    icon: appIcon(),
    backgroundColor: "#f6fbff",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setIcon(appIcon());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(localUrl())) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localUrl())) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  try {
    await mainWindow.loadURL(localUrl({ cache: true }));
  } catch (error) {
    closeSplashWindow();
    isStarting = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    mainWindow = null;
    dialog.showErrorBox(`${DISPLAY_NAME} 启动失败`, error.message || String(error));
    return;
  }
  const remainingSplashMs = Math.max(0, 1450 - (Date.now() - splashStartedAt));
  if (remainingSplashMs > 0) await delay(remainingSplashMs);
  mainWindow.setIcon(appIcon());
  mainWindow.setAlwaysOnTop(alwaysOnTop, "floating");
  sendWindowState();
  mainWindow.show();
  closeSplashWindow();
  isStarting = false;

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      updateTrayMenu();
    }
  });
  mainWindow.on("focus", clearTrayBadge);
  mainWindow.on("show", clearTrayBadge);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!isStarting) createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  clearTrayBadge();
  updateTrayMenu();
  sendWindowState();
}

async function restartServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (await waitForServer(1200)) {
    if (mainWindow) mainWindow.reload();
    return;
  }
  try {
    startServerProcess();
    await waitForServer(30000);
    if (mainWindow) mainWindow.loadURL(localUrl());
  } catch (error) {
    dialog.showErrorBox(`${DISPLAY_NAME} 重启失败`, error.message);
  }
}

async function runDiagnosticsDialog() {
  const diagnostics = await requestJson("/api/diagnostics", 5000);
  if (!diagnostics) {
    dialog.showErrorBox(`${DISPLAY_NAME} 自检失败`, "无法连接本地服务。");
    return;
  }
  const lines = diagnostics.checks.map((item) => `${item.ok ? "✓" : "×"} ${item.label}: ${item.detail || ""}`);
  dialog.showMessageBox(mainWindow || undefined, {
    type: diagnostics.ok ? "info" : "warning",
    title: `${DISPLAY_NAME} 自检`,
    message: diagnostics.ok ? "自检通过" : "有项目需要处理",
    detail: lines.join("\n")
  });
}

function createTray() {
  if (tray) return;
  const image = trayIcon(process.platform === "win32" ? 16 : 22);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  updateTrayVisuals();
  updateTrayMenu();
  tray.on("click", showMainWindow);
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setToolTip(trayBadgeCount > 0 ? `${DISPLAY_NAME} - ${trayBadgeCount} 条新回复` : DISPLAY_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `打开 ${DISPLAY_NAME}`, click: showMainWindow },
    {
      label: mainWindow?.isVisible() ? "隐藏窗口" : "显示窗口",
      click: () => {
        if (mainWindow?.isVisible()) mainWindow.hide();
        else showMainWindow();
        updateTrayMenu();
      }
    },
    { label: "置顶聊天窗口", type: "checkbox", checked: alwaysOnTop, click: toggleAlwaysOnTop },
    { label: "切换边栏", click: () => sendRendererCommand("toggle-sidebar") },
    { type: "separator" },
    { label: "设置", click: openSettingsWindow },
    { label: "打开 skills.sh", click: openSkillsWindow },
    { label: "在浏览器打开", click: () => shell.openExternal(localUrl()) },
    { type: "separator" },
    { label: "运行自检", click: runDiagnosticsDialog },
    { label: "打开数据目录", click: () => shell.openPath(app.getPath("userData")) },
    { label: "重启本地服务", click: restartServer },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        { label: "新建会话", accelerator: "CmdOrCtrl+N", click: () => sendRendererCommand("new-chat") },
        { label: "添加附件", accelerator: "CmdOrCtrl+O", click: () => sendRendererCommand("attach-file") },
        { label: "选择目录", accelerator: "CmdOrCtrl+Shift+O", click: () => sendRendererCommand("change-workdir") },
        { type: "separator" },
        { label: "打开 skills.sh", click: openSkillsWindow },
        { label: `在浏览器打开 ${DISPLAY_NAME}`, click: () => shell.openExternal(localUrl()) },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "查看",
      submenu: [
        { label: "显示/隐藏边栏", accelerator: "CmdOrCtrl+B", click: () => sendRendererCommand("toggle-sidebar") },
        { label: "设置", accelerator: "CmdOrCtrl+,", click: openSettingsWindow },
        { type: "separator" },
        { role: "reload", label: "刷新" },
        { role: "forceReload", label: "强制刷新" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "togglefullscreen", label: "全屏" },
        { label: "置顶聊天窗口", type: "checkbox", checked: alwaysOnTop, click: toggleAlwaysOnTop },
        { type: "separator" },
        { label: "显示主窗口", click: showMainWindow },
        { label: "打开 settings", click: openSettingsWindow },
        { label: "打开 skills.sh", click: openSkillsWindow }
      ]
    }
  ]));
}

ipcMain.handle("viniper:get-window-state", () => ({ alwaysOnTop }));
ipcMain.handle("viniper:set-always-on-top", (_event, enabled) => setAlwaysOnTop(Boolean(enabled)));
ipcMain.handle("viniper:toggle-always-on-top", () => toggleAlwaysOnTop());
ipcMain.handle("viniper:open-skills", () => {
  openSkillsWindow();
  return { ok: true };
});
ipcMain.on("viniper:conversation-completed", markConversationCompleted);

if (IS_PREVIEW) {
  app.setPath("userData", previewUserDataDir());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(DISPLAY_NAME);
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.on("second-instance", showMainWindow);
  app.whenReady().then(async () => {
    createApplicationMenu();
    createTray();
    await createMainWindow();
  });
}

app.on("activate", showMainWindow);

app.on("before-quit", () => {
  isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
