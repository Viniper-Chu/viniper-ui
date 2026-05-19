const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "viniper-ui")
  : path.resolve(__dirname, "..");
const ICON_PATH = process.platform === "win32"
  ? path.join(APP_ROOT, "static", "assets", "viniper-icon.ico")
  : path.join(APP_ROOT, "static", "assets", "viniper-icon.png");
const BUNDLED_VERSION = readBundledVersion();
const APP_USER_MODEL_ID = "com.viniper.ui.desktop";

let port = Number(process.env.VINIPER_UI_PORT || 17373);
let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

function localUrl() {
  return `http://127.0.0.1:${port}`;
}

function appIcon(size = 0) {
  const image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty() || !size) return image;
  return image.resize({ width: size, height: size, quality: "best" });
}

function readBundledVersion() {
  try {
    return fs.readFileSync(path.join(APP_ROOT, "VERSION"), "utf8").trim();
  } catch {
    return "";
  }
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
    VINIPER_UI_PORT: String(port)
  };

  serverProcess = spawn(python.command, [...python.args, script], {
    cwd: APP_ROOT,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (chunk) => {
    console.log(`[Viniper UI] ${chunk.toString().trim()}`);
  });
  serverProcess.stderr.on("data", (chunk) => {
    console.error(`[Viniper UI] ${chunk.toString().trim()}`);
  });
  serverProcess.on("exit", () => {
    serverProcess = null;
  });
}

async function ensureServer() {
  const existing = await waitForServer(1200);
  if (existing && (!BUNDLED_VERSION || existing.version === BUNDLED_VERSION)) return true;
  if (existing && BUNDLED_VERSION && existing.version !== BUNDLED_VERSION) {
    port = await findOpenPort(port + 1);
  }
  startServerProcess();
  return Boolean(await waitForServer(30000));
}

function createTray() {
  if (tray) return;
  const image = appIcon(process.platform === "win32" ? 16 : 22);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Viniper UI");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Viniper UI", click: showMainWindow },
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
  tray.on("click", showMainWindow);
}

async function createMainWindow() {
  const ready = await ensureServer();
  if (!ready) {
    dialog.showErrorBox(
      "Viniper UI 启动失败",
      `本地服务没有在 ${port} 端口就绪。请确认 Python 3、requirements.txt 依赖和 Claude Code 已安装。`
    );
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: "Viniper UI",
    icon: appIcon(),
    show: false,
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

  mainWindow.loadURL(localUrl());
  mainWindow.once("ready-to-show", () => {
    mainWindow.setIcon(appIcon());
    mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
    dialog.showErrorBox("Viniper UI 重启失败", error.message);
  }
}

async function runDiagnosticsDialog() {
  const diagnostics = await requestJson("/api/diagnostics", 5000);
  if (!diagnostics) {
    dialog.showErrorBox("Viniper UI 自检失败", "无法连接本地服务。");
    return;
  }
  const lines = diagnostics.checks.map((item) => `${item.ok ? "✓" : "×"} ${item.label}: ${item.detail || ""}`);
  dialog.showMessageBox(mainWindow || undefined, {
    type: diagnostics.ok ? "info" : "warning",
    title: "Viniper UI 自检",
    message: diagnostics.ok ? "自检通过" : "有项目需要处理",
    detail: lines.join("\n")
  });
}

function createApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Viniper UI",
      submenu: [
        { label: "打开 Viniper UI", click: showMainWindow },
        { label: "运行自检", click: runDiagnosticsDialog },
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
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "togglefullscreen", label: "全屏" }
      ]
    }
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName("Viniper UI");
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
