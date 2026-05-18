const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.VINIPER_UI_PORT || 17373);
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "viniper-ui")
  : path.resolve(__dirname, "..");
const ICON_PATH = process.platform === "win32"
  ? path.join(APP_ROOT, "static", "assets", "viniper-husky.ico")
  : path.join(APP_ROOT, "static", "assets", "viniper-husky.png");

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

function requestStatus(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(`${LOCAL_URL}/api/status`, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await requestStatus()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
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

function startServerProcess() {
  const python = findPython();
  if (!python) {
    throw new Error("Python 3 was not found. Install Python 3.10+ and try again.");
  }

  const script = path.join(APP_ROOT, "server.py");
  const env = {
    ...process.env,
    VINIPER_UI_OPEN_BROWSER: "0",
    VINIPER_UI_PORT: String(PORT)
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
  if (await waitForServer(1200)) return true;
  startServerProcess();
  return waitForServer(30000);
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("Viniper UI");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Viniper UI", click: showMainWindow },
    { label: "在浏览器打开", click: () => shell.openExternal(LOCAL_URL) },
    { type: "separator" },
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
      `本地服务没有在 ${PORT} 端口就绪。请确认 Python 3、requirements.txt 依赖和 Claude Code 已安装。`
    );
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: "Viniper UI",
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL(LOCAL_URL);
  mainWindow.once("ready-to-show", () => mainWindow.show());
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
    if (mainWindow) mainWindow.loadURL(LOCAL_URL);
  } catch (error) {
    dialog.showErrorBox("Viniper UI 重启失败", error.message);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(async () => {
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
