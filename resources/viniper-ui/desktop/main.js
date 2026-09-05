const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, ipcMain, safeStorage } = require("electron");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { selectPreviewProfile, statusMatchesProfile } = require("./profile-owner");

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
  app_id: "com.viniper.workstation.preview",
  product_name: "Viniper workstation",
  port: 17947,
  data_dir_name: "Viniper workstation Preview"
};
const STABLE_PROFILE = PROFILE_CONFIG.stable || {
  app_id: "com.viniper.workstation",
  product_name: "Viniper workstation",
  port: 17947,
  data_dir_name: "Viniper workstation Preview"
};
const DESKTOP_METADATA = (() => {
  try {
    return require(path.join(__dirname, "package.json"));
  } catch {
    return {};
  }
})();
const ICON_PATH = process.platform === "win32"
  ? path.join(APP_ROOT, "static", "assets", "viniper-harness-circuit-node.ico")
  : path.join(APP_ROOT, "static", "assets", "viniper-harness-circuit-node.png");
const ICON_ASSET_DIR = path.join(APP_ROOT, "static", "assets");
const BUNDLED_VERSION = readBundledVersion();
const DESKTOP_PROFILE = String(process.env.VINIPER_UI_PROFILE || DESKTOP_METADATA.viniperProfile || "").trim().toLowerCase();
const IS_PREVIEW = selectPreviewProfile({
  envPreview: process.env.VINIPER_UI_PREVIEW,
  packaged: app.isPackaged,
  execPath: process.execPath,
  metadataProfile: DESKTOP_METADATA.viniperProfile,
  previewMarker: fs.existsSync(path.join(APP_ROOT, "PREVIEW")),
});
const IS_STABLE = !IS_PREVIEW && DESKTOP_PROFILE === "stable";
const IS_WORKSTATION = IS_PREVIEW || IS_STABLE;
const ACTIVE_PROFILE_NAME = IS_STABLE ? "stable" : IS_PREVIEW ? "preview" : "formal-runtime";
const ACTIVE_PROFILE = IS_STABLE ? STABLE_PROFILE : IS_PREVIEW ? PREVIEW_PROFILE : {};
if (IS_PREVIEW) process.env.VINIPER_UI_PREVIEW = "1";
if (IS_STABLE) process.env.VINIPER_UI_PREVIEW = "0";
process.env.VINIPER_UI_PROFILE = ACTIVE_PROFILE_NAME;
const DISPLAY_NAME = String(ACTIVE_PROFILE.product_name || "Viniper");
const APP_USER_MODEL_ID = String(ACTIVE_PROFILE.app_id || "com.viniper.ui.desktop");
const TITLEBAR_HEIGHT = 32;

let port = Number(process.env.VINIPER_UI_PORT || (IS_WORKSTATION ? ACTIVE_PROFILE.port : 17373));
let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;
let isStarting = false;
let stdioBroken = false;
let alwaysOnTop = false;
let trayBadgeCount = 0;
let wslEnablePromise = null;
let secretBroker = null;
let secretBrokerToken = "";
let hostMigrationToken = "";
let hostMigrationConsumed = false;
let updateApplyPromise = null;
let updateQuitRequested = false;
let updateQuitReady = false;
let updateQuitPromise = null;

const SECRET_REFS_BY_MODE = Object.freeze({
  viniper: "provider.deepseek",
  claude: "provider.anthropic.api-key",
});

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

function applyWindowsTaskbarIdentity(window) {
  if (process.platform !== "win32" || !window || window.isDestroyed()) return;
  window.setIcon(appIcon());
  window.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: ICON_PATH,
    appIconIndex: 0,
    relaunchCommand: `"${process.execPath}"`,
    relaunchDisplayName: DISPLAY_NAME,
  });
}

function splashIconDataUrl() {
  const iconPath = path.join(APP_ROOT, "static", "assets", "viniper-harness-circuit-node.png");
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
      animation: mark-arrive 1.18s cubic-bezier(0.2, 0.82, 0.18, 1) both;
    }
    .boot-icon {
      width: 100%;
      height: 100%;
      object-fit: contain;
      clip-path: inset(0 100% 0 0 round 22px);
      opacity: 0;
      transform: scale(0.94);
      animation: v-reveal 1.18s cubic-bezier(0.18, 0.86, 0.24, 1) both;
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
      animation: v-shine 1.02s ease-out 0.12s both;
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
    @keyframes mark-arrive {
      0% { transform: scale(0.965); filter: drop-shadow(0 12px 22px rgba(0,18,22,0.18)); }
      56% { transform: scale(1.022); filter: drop-shadow(0 25px 44px rgba(0,18,22,0.37)); }
      100% { transform: scale(1); filter: drop-shadow(0 20px 34px rgba(0,18,22,0.28)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .boot-mark { animation: reduced-fade 180ms ease-out both !important; }
      .boot-icon { animation: none !important; opacity: 1; clip-path: none; transform: none; }
      .boot-mark::after { display: none; }
      @keyframes reduced-fade { from { opacity: 0; } to { opacity: 1; } }
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
  const exactSize = [16, 20, 24, 32].includes(Number(size)) ? Number(size) : 32;
  const ordinaryPath = path.join(ICON_ASSET_DIR, `viniper-harness-circuit-node-${exactSize}.png`);
  const badgePath = path.join(ICON_ASSET_DIR, `viniper-harness-circuit-node-badge-${exactSize}.png`);
  const useBadge = trayBadgeCount > 0 && fs.existsSync(badgePath);
  let image = nativeImage.createFromPath(useBadge ? badgePath : ordinaryPath);
  if (image.isEmpty()) image = nativeImage.createFromPath(ICON_PATH);
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

function workstationDataDir() {
  const configured = String(process.env.VINIPER_UI_DATA_DIR || "").trim();
  if (configured) return path.resolve(configured);
  const dataDirName = ACTIVE_PROFILE.data_dir_name || "Viniper workstation Preview";
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), dataDirName);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", dataDirName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), dataDirName);
}

function secureVaultPath() {
  return path.join(app.getPath("userData"), "secrets.enc.json");
}

function legacySecureVaultPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Viniper workstation", "Preview-0.1.0", "secrets.enc.json");
}

function readEncryptedRecords(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function decryptSafeValue(encoded) {
  const encrypted = Buffer.from(encoded, "base64");
  let decrypted;
  if (typeof safeStorage.decryptStringAsync === "function") {
    try {
      decrypted = await safeStorage.decryptStringAsync(encrypted);
    } catch {
      decrypted = safeStorage.decryptString(encrypted);
    }
  } else {
    decrypted = safeStorage.decryptString(encrypted);
  }
  return typeof decrypted === "string" ? decrypted : decrypted?.result;
}

async function encryptSafeValue(value) {
  let encrypted;
  if (typeof safeStorage.encryptStringAsync === "function") {
    try {
      encrypted = await safeStorage.encryptStringAsync(String(value));
    } catch {
      encrypted = safeStorage.encryptString(String(value));
    }
  } else {
    encrypted = safeStorage.encryptString(String(value));
  }
  return Buffer.from(encrypted).toString("base64");
}

async function migrateSecureVault() {
  const target = secureVaultPath();
  const source = legacySecureVaultPath();
  if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) return;
  if (!safeStorage.isEncryptionAvailable()) return;

  // Preserve a narrow encrypted source copy before inspecting target records;
  // an undecryptable target record must not suppress the recovery backup.
  const backup = path.join(app.getPath("userData"), "migration-backups", "secrets.enc.json.source");
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(source, backup);

  const targetRecords = readEncryptedRecords(target);
  const targetHasModeSecret = Object.values(SECRET_REFS_BY_MODE).some((ref) => Boolean(targetRecords[ref]));
  if (targetHasModeSecret) return;

  const sourceRecords = readEncryptedRecords(source);
  const selected = {};
  for (const ref of Object.values(SECRET_REFS_BY_MODE)) {
    const encoded = sourceRecords[ref];
    if (typeof encoded !== "string" || !encoded) continue;
    try {
      const value = await decryptSafeValue(encoded);
      if (!value) continue;
      selected[ref] = await encryptSafeValue(value);
    } catch {
      // A legacy record that cannot be decrypted is not copied into the new
      // vault; the source remains untouched and the mode stays unconfigured.
    }
  }
  if (!Object.keys(selected).length) return;

  // Only create the workstation-owned vault after at least one record was
  // successfully decrypted and re-encrypted by this host.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ ...targetRecords, ...selected }, null, 2), "utf8");
}

async function readSecureSecret(ref) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const encoded = readEncryptedRecords(secureVaultPath())[ref];
  if (typeof encoded !== "string" || !encoded) return null;
  try {
    const value = await decryptSafeValue(encoded);
    return String(value || "") || null;
  } catch {
    return null;
  }
}

function secretRefForMode(mode) {
  const value = String(mode || "").toLowerCase();
  return SECRET_REFS_BY_MODE[value === "claude" ? "claude" : "viniper"];
}

async function writeSecureSecretRef(ref, value) {
  if (!Object.values(SECRET_REFS_BY_MODE).includes(ref)) {
    return { ok: false, configured: false, length: 0, reason: "unsupported secret ref" };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, configured: false, length: 0, reason: "secure storage unavailable" };
  }
  const target = secureVaultPath();
  const records = readEncryptedRecords(target);
  const secret = String(value || "");
  if (!secret) {
    delete records[ref];
  } else {
    records[ref] = await encryptSafeValue(secret);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(records, null, 2), "utf8");
  return { ok: true, configured: Boolean(secret), length: secret.length };
}

async function writeSecureSecret(mode, value) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, configured: false, reason: "secure storage unavailable" };
  await migrateSecureVault();
  return writeSecureSecretRef(secretRefForMode(mode), value);
}

async function clearSecureSecret(mode) {
  return writeSecureSecret(mode, "");
}

async function startSecretBroker() {
  if (secretBroker) return secretBroker;
  await migrateSecureVault();
  secretBrokerToken = crypto.randomBytes(32).toString("hex");
  hostMigrationToken = String(process.env.VINIPER_HOST_MIGRATION_TOKEN || "");
  hostMigrationConsumed = false;
  const migrationEnabled = process.env.VINIPER_HOST_MIGRATION_ENABLED === "1" && hostMigrationToken.length >= 16;
  const readRequestBody = (request, limit = 32768) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("migration payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
  secretBroker = http.createServer(async (request, response) => {
    const remote = String(request.socket.remoteAddress || "");
    const authorized = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const migrationHeader = String(request.headers["x-viniper-migration-token"] || "");
    const migrationRequest = requestUrl.pathname === "/secret/migrate" && migrationEnabled && migrationHeader === hostMigrationToken;
    if (!authorized || (request.headers.authorization !== `Bearer ${secretBrokerToken}` && !migrationRequest)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const url = requestUrl;
    const rawMode = String(url.searchParams.get("mode") || "").toLowerCase();
    const mode = rawMode === "claude" ? "claude" : "viniper";
    const ref = SECRET_REFS_BY_MODE[mode];
    if (url.pathname === "/secret/migrate") {
      if (!migrationEnabled || hostMigrationConsumed || migrationHeader !== hostMigrationToken || request.method !== "POST") {
        response.writeHead(404);
        response.end();
        return;
      }
      hostMigrationConsumed = true;
      let values = {};
      try {
        values = JSON.parse(await readRequestBody(request));
      } catch {
        values = {};
      }
      const refs = Object.values(SECRET_REFS_BY_MODE);
      const migrated = {};
      for (const secretRef of refs) {
        const value = typeof values?.[secretRef] === "string" ? values[secretRef] : "";
        const result = value ? await writeSecureSecretRef(secretRef, value) : { ok: false, configured: false, length: 0 };
        migrated[secretRef] = {
          transferred: Boolean(value) && result.ok === true,
          configured: Boolean(result.configured),
          length: Number(result.length || 0),
        };
      }
      hostMigrationToken = "";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: Object.values(migrated).every((item) => item.transferred && item.configured), refs: migrated }));
      return;
    }
    if (url.pathname === "/secret/status") {
      const secret = await readSecureSecret(ref);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, mode, ref, configured: Boolean(secret) }));
      return;
    }
    if (url.pathname === "/secret/read") {
      const secret = await readSecureSecret(ref);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, configured: Boolean(secret), secret: secret || "" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const listenPort = migrationEnabled ? Number(process.env.VINIPER_HOST_MIGRATION_PORT || 0) : 0;
  await new Promise((resolve) => secretBroker.listen(listenPort, "127.0.0.1", resolve));
  return secretBroker;
}

async function closeSecretBroker() {
  const server = secretBroker;
  secretBroker = null;
  secretBrokerToken = "";
  hostMigrationToken = "";
  hostMigrationConsumed = false;
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

function formalUserDataDir() {
  const configured = String(process.env.VINIPER_UI_DATA_DIR || "").trim();
  if (configured) return path.resolve(configured);
  // Keep the public 4.x desktop data identity while the visible brand becomes Viniper.
  return path.join(app.getPath("appData"), "Viniper UI");
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

function setTitlebarTheme(theme = {}) {
  if (mainWindow && !mainWindow.isDestroyed() && process.platform === "win32" && typeof mainWindow.setTitleBarOverlay === "function") {
    const color = String(theme.color || "#f5f3ee");
    const symbolColor = String(theme.symbolColor || "#302f2b");
    mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  }
  return { ok: true };
}

// Ownership readiness is identity-only and must remain independent of slow
// provider, vault, WSL, and Claude runtime diagnostics.
const SERVER_STATUS_PROBE_TIMEOUT_MS = 1500;

function requestJson(urlPath, timeoutMs = SERVER_STATUS_PROBE_TIMEOUT_MS) {
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

function isTrustedUpdateSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try {
    const sender = new URL(event.senderFrame.url);
    return !sender.username && !sender.password && sender.origin === new URL(localUrl()).origin;
  } catch {
    return false;
  }
}

function requestAppUpdateInstall() {
  return new Promise((resolve) => {
    const unavailable = { ok: false, status: "failed", message: "无法联系本地更新服务，请稍后重试。" };
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const request = http.request({
      hostname: "127.0.0.1", port, path: "/api/update/apply", method: "POST", timeout: 15000,
      headers: { "Content-Type": "application/json", "Content-Length": "2", "Origin": new URL(localUrl()).origin },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 65536) { finish(unavailable); request.destroy(); }
      });
      response.on("error", () => finish(unavailable));
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) return finish(unavailable);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return finish({ ...payload, ok: false, status: "failed", message: payload.message || payload.detail || unavailable.message });
          }
          finish(payload);
        } catch { finish(unavailable); }
      });
    });
    request.on("timeout", () => { finish(unavailable); request.destroy(); });
    request.on("error", () => finish(unavailable));
    request.end("{}");
  });
}

async function installAppUpdate(event) {
  if (!isTrustedUpdateSender(event)) return { ok: false, status: "rejected", message: "更新只能由工作台主窗口发起。" };
  if (process.platform !== "win32" || !app.isPackaged || !IS_STABLE) {
    return { ok: false, status: "unavailable", message: "应用内安装更新仅支持已安装的 Windows 正式桌面版。" };
  }
  if (updateQuitRequested) return { ok: false, status: "installing", message: "正在退出工作台，请在安装器中继续。" };
  if (!serverProcess || !serverProcess.pid || serverProcess.exitCode !== null || serverProcess.killed) {
    return { ok: false, status: "unavailable", message: "当前本地服务不是由此窗口启动。请先从原工作台托盘退出，再重新打开后安装更新。" };
  }
  if (updateApplyPromise) return updateApplyPromise;
  updateApplyPromise = (async () => {
    const result = await requestAppUpdateInstall();
    if (result.ok === true && result.status === "installer_opened" && result.updated === false) {
      updateQuitRequested = true;
      // Return the acknowledged handoff first. Closing a window only hides this
      // app; app.quit runs the owned-service cleanup instead of NSIS taskkill.
      setImmediate(() => app.quit());
      return { ...result, desktop_quit_requested: true };
    }
    return result;
  })();
  try { return await updateApplyPromise; } finally { updateApplyPromise = null; }
}

function stopOwnedUpdateServer(owned, timeoutMs = 5000) {
  if (!owned || owned.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      owned.removeListener("exit", exited);
      owned.removeListener("error", failed);
      error ? reject(error) : resolve();
    };
    const exited = () => finish();
    const failed = () => finish(new Error("owned-server-stop-failed"));
    owned.once("exit", exited);
    owned.once("error", failed);
    timer = setTimeout(() => finish(new Error("owned-server-stop-timeout")), timeoutMs);
    try { if (!owned.kill()) failed(); } catch { failed(); }
  });
}

async function finishUpdateQuit() {
  const owned = serverProcess;
  try {
    await stopOwnedUpdateServer(owned);
    if (serverProcess === owned) serverProcess = null;
    await waitForUpdateServerClosed();
    await closeSecretBroker();
    updateQuitReady = true;
    app.quit();
  } catch {
    isQuitting = false;
    updateQuitRequested = false;
    updateQuitPromise = null;
    dialog.showErrorBox("暂时无法退出工作台", "安装器已经打开，但本地服务尚未退出。请取消安装，稍后从托盘退出工作台再试；未强制结束其他进程。");
  }
}

async function waitForUpdateServerClosed(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!(await requestReadiness(250))) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error("owned-server-port-still-open");
}

async function requestReadiness(timeoutMs = SERVER_STATUS_PROBE_TIMEOUT_MS) {
  return requestJson("/api/readiness", timeoutMs);
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await requestReadiness();
    if (status) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function expectedServerOwner() {
  return {
    preview: IS_PREVIEW,
    activeProfile: ACTIVE_PROFILE_NAME,
    productName: DISPLAY_NAME,
    dataDir: app.getPath("userData"),
  };
}

function serverStatusIsOwned(status) {
  return statusMatchesProfile(status, expectedServerOwner());
}

async function waitForOwnedServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await requestReadiness();
    if (serverStatusIsOwned(status)) return status;
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
    const probe = spawnSync(candidate.command, [...candidate.args, "-E", "-c", "import json, sys; print(json.dumps(sys.executable))"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 10000,
    });
    if (probe.status !== 0) continue;
    try {
      const executable = JSON.parse(String(probe.stdout || "").trim());
      if (typeof executable === "string" && path.isAbsolute(executable) && fs.statSync(executable).isFile()) {
        // py.exe is a launcher, not the listening Python process. Owning the
        // actual interpreter makes normal and update shutdown target one PID.
        return { command: path.resolve(executable), args: [] };
      }
    } catch { /* Try the next configured interpreter without logging stdout. */ }
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

async function startServerProcess() {
  const python = findPython();
  if (!python) {
    throw new Error("Python 3 was not found. Install Python 3.10+ and try again.");
  }
  ensurePythonDependencies(python);
  const broker = await startSecretBroker();
  const brokerAddress = broker.address();

  const script = path.join(APP_ROOT, "server.py");
  const env = {
    ...process.env,
    VINIPER_UI_OPEN_BROWSER: "0",
    VINIPER_UI_DESKTOP: "1",
    VINIPER_UI_PORT: String(port),
    VINIPER_HOST_SECRET_BROKER_PORT: String(brokerAddress?.port || ""),
    VINIPER_HOST_SECRET_BROKER_TOKEN: secretBrokerToken,
  };
  if (app.isPackaged) {
    env.VINIPER_UI_DESKTOP_EXE = process.execPath;
  }
  if (IS_WORKSTATION) {
    env.VINIPER_UI_PROFILE = ACTIVE_PROFILE_NAME;
    env.VINIPER_UI_PREVIEW = IS_PREVIEW ? "1" : "0";
    env.VINIPER_UI_DATA_DIR = app.getPath("userData");
    env.VINIPER_UI_RELEASE_STAGE = IS_PREVIEW ? "preview" : "stable";
    env.VINIPER_UI_ASSET_VERSION = `${BUNDLED_VERSION || "dev"}-${ACTIVE_PROFILE_NAME}-${Date.now()}`;
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
    safeMainLog("log", `[${DISPLAY_NAME}] Server exited (code=${code}), restarting in 2s...`);
    setTimeout(async () => {
      if (isQuitting || serverProcess) return;
      try {
        await startServerProcess();
        await waitForServer(30000);
        if (mainWindow) mainWindow.loadURL(localUrl());
      } catch {
        safeMainLog("error", `[${DISPLAY_NAME}] Server auto-restart failed.`);
      }
    }, 2000);
  });
}

async function ensureServer() {
  const existing = await waitForServer(1200);
  const existingOwned = serverStatusIsOwned(existing);
  if (existingOwned && (!BUNDLED_VERSION || existing.version === BUNDLED_VERSION)) return true;
  if (existing) {
    if (serverProcess) { serverProcess.kill(); serverProcess = null; }
    port = await findOpenPort(port + 1);
  }
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  await startServerProcess();
  const started = await waitForOwnedServer(30000);
  return Boolean(started && (!BUNDLED_VERSION || started.version === BUNDLED_VERSION));
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
    minWidth: 900,
    minHeight: 680,
    title: DISPLAY_NAME,
    icon: appIcon(),
    backgroundColor: "#f6fbff",
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32"
      ? { color: "#f5f3ee", symbolColor: "#302f2b", height: TITLEBAR_HEIGHT }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  applyWindowsTaskbarIdentity(mainWindow);

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
  applyWindowsTaskbarIdentity(mainWindow);
  if (process.platform === "win32") mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(alwaysOnTop, "floating");
  sendWindowState();
  mainWindow.show();
  applyWindowsTaskbarIdentity(mainWindow);
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
    await startServerProcess();
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

function enableWslPlatform() {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, status: "unsupported", message: "仅 Windows 需要启用 WSL2。" });
  }
  if (wslEnablePromise) return wslEnablePromise;

  const command = [
    "$ErrorActionPreference='Stop'",
    "$wsl=Join-Path $env:SystemRoot 'System32\\wsl.exe'",
    "$process=Start-Process -FilePath $wsl -ArgumentList @('--install','--no-distribution') -Verb RunAs -Wait -PassThru",
    "exit [int]$process.ExitCode"
  ].join("; ");
  wslEnablePromise = new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { stdio: "ignore", windowsHide: true }
    );
    child.once("error", () => resolve({
      ok: false,
      status: "failed",
      message: "未能启动 Windows WSL 安装；可以稍后重试或打开诊断。"
    }));
    child.once("close", (code) => resolve(code === 0
      ? { ok: true, status: "requested", message: "Windows 已接收 WSL 安装请求。" }
      : { ok: false, status: "cancelled_or_failed", message: "WSL 安装未完成；可以稍后重试。" }));
  }).finally(() => {
    wslEnablePromise = null;
  });
  return wslEnablePromise;
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
    { label: "置顶工作台窗口", type: "checkbox", checked: alwaysOnTop, click: toggleAlwaysOnTop },
    { label: "切换边栏", click: () => sendRendererCommand("toggle-sidebar") },
    { type: "separator" },
    { label: "设置", click: openSettingsWindow },
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
        { label: "新建会话", accelerator: "CmdOrCtrl+N", click: () => sendRendererCommand("new-viniper-session") },
        { label: "添加附件", accelerator: "CmdOrCtrl+O", click: () => sendRendererCommand("attach-file") },
        { label: "选择目录", accelerator: "CmdOrCtrl+Shift+O", click: () => sendRendererCommand("change-workdir") },
        { type: "separator" },
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
        { label: "置顶工作台窗口", type: "checkbox", checked: alwaysOnTop, click: toggleAlwaysOnTop },
        { type: "separator" },
        { label: "显示主窗口", click: showMainWindow },
        { label: "打开 settings", click: openSettingsWindow },
      ]
    }
  ]));
}

ipcMain.handle("viniper:get-window-state", () => ({ alwaysOnTop }));
ipcMain.handle("viniper:set-always-on-top", (_event, enabled) => setAlwaysOnTop(Boolean(enabled)));
ipcMain.handle("viniper:toggle-always-on-top", () => toggleAlwaysOnTop());
ipcMain.handle("viniper:set-titlebar-theme", (_event, theme) => setTitlebarTheme(theme));
ipcMain.handle("viniper:enable-wsl-platform", () => enableWslPlatform());
ipcMain.handle("viniper:install-app-update", (event) => installAppUpdate(event));
ipcMain.handle("viniper:save-provider-secret", (_event, payload = {}) =>
  writeSecureSecret(payload.mode, payload.value));
ipcMain.handle("viniper:clear-provider-secret", (_event, payload = {}) =>
  clearSecureSecret(payload.mode));
ipcMain.on("viniper:conversation-completed", markConversationCompleted);

if (IS_WORKSTATION) {
  app.setPath("userData", workstationDataDir());
} else {
  app.setPath("userData", formalUserDataDir());
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

app.on("before-quit", (event) => {
  isQuitting = true;
  if (updateQuitRequested && !updateQuitReady) {
    event.preventDefault();
    if (!updateQuitPromise) updateQuitPromise = finishUpdateQuit();
    return;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  void closeSecretBroker();
});
