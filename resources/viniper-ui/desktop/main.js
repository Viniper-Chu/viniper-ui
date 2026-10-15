const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, ipcMain, safeStorage } = require("electron");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { selectPreviewProfile, statusMatchesProfile } = require("./profile-owner");
const { desktopEnvironment, resolvePython, isLocalNavigation, isExternalNavigation, isTrustedRenderer, stopOwnedProcess } = require("./platform-runtime");
const { createMacKeychainVault } = require("./mac-keychain-vault");
const nativeCredentialVault = process.platform === "darwin" && app.isPackaged
  && fs.existsSync(path.join(process.resourcesPath, "runtime", "bin", "viniper-keychain"))
  ? createMacKeychainVault({ helperPath: path.join(process.resourcesPath, "runtime", "bin", "viniper-keychain"), applicationPath: process.execPath })
  : null;

Object.assign(process.env, desktopEnvironment({ resourcesPath: app.isPackaged ? process.resourcesPath : "" }));

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
  product_name: "Viniper",
  port: 17947,
  data_dir_name: "Viniper workstation Preview"
};
const STABLE_PROFILE = PROFILE_CONFIG.stable || {
  app_id: "com.viniper.workstation",
  product_name: "Viniper",
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
let serverStopPromise = null;
let isQuitting = false;
let isStarting = false;
let stdioBroken = false;
let alwaysOnTop = false;
let trayBadgeCount = 0;
let secretBroker = null;
let secretBrokerToken = "";
let hostMigrationToken = "";
let hostMigrationConsumed = false;
let updateApplyPromise = null;
let updateQuitRequested = false;
let updateQuitReady = false;
let updateQuitPromise = null;
let quitReady = false;
let quitPromise = null;

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
      sandbox: true
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
  const dataDirName = process.platform === "darwin" && IS_STABLE
    ? "Viniper workstation"
    : ACTIVE_PROFILE.data_dir_name || "Viniper workstation Preview";
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

async function secureStorageAvailable() {
  try {
    if (nativeCredentialVault) return await nativeCredentialVault.available();
    // On macOS the synchronous probe itself may wait for Keychain consent.
    // A rejected async probe is a denial/unavailable store, not an invitation
    // to prompt again on the main thread. Only older Electron lacks this API.
    if (typeof safeStorage.isAsyncEncryptionAvailable === "function") {
      return await safeStorage.isAsyncEncryptionAvailable();
    }
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function decryptSafeValue(encoded) {
  if (encoded.startsWith("vpk1:")) {
    if (!nativeCredentialVault) throw new Error("native credential storage unavailable");
    return nativeCredentialVault.decrypt(encoded);
  }
  const encrypted = Buffer.from(encoded, "base64");
  if (typeof safeStorage.decryptStringAsync === "function") {
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    if (typeof decrypted?.result !== "string") throw new Error("secure storage decryption unavailable");
    return decrypted.result;
  }
  return safeStorage.decryptString(encrypted);
}

async function encryptSafeValue(value) {
  if (nativeCredentialVault) return nativeCredentialVault.encrypt(value);
  const encrypted = typeof safeStorage.encryptStringAsync === "function"
    ? await safeStorage.encryptStringAsync(String(value))
    : safeStorage.encryptString(String(value));
  if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("secure storage encryption unavailable");
  return encrypted.toString("base64");
}

async function migrateSecureVault(requestedRef) {
  const target = secureVaultPath();
  const source = legacySecureVaultPath();
  if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) return;

  const refs = requestedRef ? [requestedRef] : Object.values(SECRET_REFS_BY_MODE);
  const targetRecords = readEncryptedRecords(target);
  const sourceRecords = readEncryptedRecords(source);
  const missingRefs = refs.filter((ref) => !targetRecords[ref] && typeof sourceRecords[ref] === "string" && sourceRecords[ref]);
  if (!missingRefs.length) return;
  if (!await secureStorageAvailable()) return;

  // Preserve a narrow encrypted source copy before inspecting target records;
  // an undecryptable target record must not suppress the recovery backup.
  const backup = path.join(app.getPath("userData"), "migration-backups", "secrets.enc.json.source");
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(source, backup);

  const selected = {};
  for (const ref of missingRefs) {
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
  // A provider save can finish while legacy decryption waits for consent.
  // Preserve those newer records instead of replacing them with the migration.
  fs.writeFileSync(target, JSON.stringify({ ...selected, ...readEncryptedRecords(target) }, null, 2), "utf8");
}

async function readSecureSecret(ref) {
  await migrateSecureVault(ref);
  const encoded = readEncryptedRecords(secureVaultPath())[ref];
  if (typeof encoded !== "string" || !encoded) return null;
  // Querying macOS Keychain can display an authorization prompt after a
  // local ad-hoc app update. An empty vault needs no Keychain access at all.
  if (!await secureStorageAvailable()) return null;
  try {
    const value = await decryptSafeValue(encoded);
    if (value && nativeCredentialVault && !encoded.startsWith("vpk1:")) {
      // Migrate only a successfully decrypted record, without replacing a
      // newer concurrent save or any other Agent's encrypted credentials.
      try {
        const migrated = await encryptSafeValue(value);
        const records = readEncryptedRecords(secureVaultPath());
        if (records[ref] === encoded) {
          records[ref] = migrated;
          fs.writeFileSync(secureVaultPath(), JSON.stringify(records, null, 2), { mode: 0o600 });
        }
      } catch { /* Keep the original encrypted record if migration fails. */ }
    }
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
  if (!await secureStorageAvailable()) {
    return { ok: false, configured: false, length: 0, reason: "secure storage unavailable" };
  }
  const target = secureVaultPath();
  const secret = String(value || "");
  let encoded;
  try {
    if (secret) encoded = await encryptSafeValue(secret);
  } catch {
    return { ok: false, configured: false, length: 0, reason: "secure storage encryption unavailable" };
  }
  // Read after encryption: concurrent saves may update another Agent's
  // record while this operation awaits Keychain authorization.
  const records = readEncryptedRecords(target);
  if (!secret) {
    delete records[ref];
  } else {
    records[ref] = encoded;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(records, null, 2), "utf8");
  return { ok: true, configured: Boolean(secret), length: secret.length };
}

async function writeSecureSecret(mode, value) {
  const ref = secretRefForMode(mode);
  await migrateSecureVault(ref);
  return writeSecureSecretRef(ref, value);
}

async function clearSecureSecret(mode) {
  return writeSecureSecret(mode, "");
}

function secureSecretMetadata(ref) {
  const current = readEncryptedRecords(secureVaultPath())[ref];
  const legacy = current ? null : readEncryptedRecords(legacySecureVaultPath())[ref];
  const configured = typeof (current || legacy) === "string" && Boolean(current || legacy);
  return { configured, access: configured ? (current ? "not-checked" : "migration-required") : "not-configured" };
}

async function startSecretBroker() {
  if (secretBroker) return secretBroker;
  // Starting the UI and reading configuration must not unlock any Provider's
  // credentials. Only an explicit read/save accesses the operating-system vault.
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
    try {
    response.setHeader("Cache-Control", "no-store");
    const remote = String(request.socket.remoteAddress || "");
    const authorized = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    let requestUrl;
    try { requestUrl = new URL(request.url || "/", "http://127.0.0.1"); }
    catch { response.writeHead(400); response.end(); return; }
    const migrationHeader = String(request.headers["x-viniper-migration-token"] || "");
    const migrationRequest = requestUrl.pathname === "/secret/migrate" && migrationEnabled && migrationHeader === hostMigrationToken;
    if (!authorized || request.headers.origin || request.headers["sec-fetch-site"]
      || (request.headers.authorization !== `Bearer ${secretBrokerToken}` && !migrationRequest)) {
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
    if (url.pathname === "/secret/status" && request.method === "GET") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, mode, ref, ...secureSecretMetadata(ref) }));
      return;
    }
    if (url.pathname === "/secret/read" && request.method === "GET") {
      const secret = await readSecureSecret(ref);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, configured: Boolean(secret), secret: secret || "" }));
      return;
    }
    response.writeHead(404);
    response.end();
    } catch {
      if (response.destroyed) return;
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, reason: "secure-storage-unavailable" }));
    }
  });
  const listenPort = migrationEnabled ? Number(process.env.VINIPER_HOST_MIGRATION_PORT || 0) : 0;
  secretBroker.requestTimeout = 10000;
  secretBroker.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    secretBroker.once("error", reject);
    secretBroker.listen(listenPort, "127.0.0.1", () => {
      secretBroker.removeListener("error", reject);
      resolve();
    });
  });
  return secretBroker;
}

async function closeSecretBroker() {
  const server = secretBroker;
  secretBroker = null;
  secretBrokerToken = "";
  hostMigrationToken = "";
  hostMigrationConsumed = false;
  if (!server) return;
  server.closeAllConnections?.();
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
  return isTrustedRenderer(event, mainWindow, localUrl());
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
  return resolvePython({ userData: app.getPath("userData"), environment: process.env, packaged: app.isPackaged });
}

function ensurePythonDependencies(python) {
  const requirements = path.join(APP_ROOT, "requirements.txt");
  if (!fs.existsSync(requirements)) return;

  if (process.platform === "darwin") {
    const check = spawnSync(python.command, ["-c", "import fastapi, uvicorn, httpx"], {
      env: process.env, encoding: "utf8", timeout: 15000,
    });
    if (check.status !== 0) {
      throw new Error("工作台的 Python 运行环境未安装完整。请在项目中运行 npm run install:macos，完成后重新打开应用。");
    }
    return;
  }

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
  if (isQuitting) return;
  const python = findPython();
  if (!python) {
    throw new Error(process.platform === "darwin"
      ? "未找到工作台专属 Python 环境。请在项目中运行 npm run install:macos，再重新打开应用。"
      : "Python 3 was not found. Install Python 3.10+ and try again.");
  }
  ensurePythonDependencies(python);
  const broker = await startSecretBroker();
  if (isQuitting) return;
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
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const owned = serverProcess;
  owned.stdout.on("data", (chunk) => logServerChunk("log", chunk));
  owned.stderr.on("data", (chunk) => logServerChunk("error", chunk));
  owned.on("error", (error) => safeMainLog("error", `[${DISPLAY_NAME}] ${error.message}`));
  owned.on("exit", (code) => {
    if (serverProcess !== owned) return;
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
    await stopServerProcess();
    port = await findOpenPort(port + 1);
  }
  await stopServerProcess();
  port = await findOpenPort(port);
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
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 17 } : undefined,
    titleBarOverlay: process.platform === "win32"
      ? { color: "#f5f3ee", symbolColor: "#302f2b", height: TITLEBAR_HEIGHT }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  applyWindowsTaskbarIdentity(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalNavigation(url, localUrl())) return { action: "allow" };
    if (isExternalNavigation(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isLocalNavigation(url, localUrl())) {
      event.preventDefault();
      if (isExternalNavigation(url)) void shell.openExternal(url);
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
  mainWindow.on("closed", () => { mainWindow = null; });
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
  if (isQuitting) return;
  await stopServerProcess();
  if (isQuitting) return;
  const ready = await waitForServer(1200);
  if (isQuitting) return;
  if (ready) {
    if (mainWindow) mainWindow.reload();
    return;
  }
  try {
    await startServerProcess();
    if (isQuitting) return;
    await waitForServer(30000);
    if (!isQuitting && mainWindow) mainWindow.loadURL(localUrl());
  } catch (error) {
    dialog.showErrorBox(`${DISPLAY_NAME} 重启失败`, error.message);
  }
}

function stopServerProcess() {
  if (serverStopPromise) return serverStopPromise;
  const owned = serverProcess;
  if (!owned) return Promise.resolve();
  serverProcess = null;
  // Restart and quit can arrive together. Retain one completion barrier even
  // after clearing the restartable process reference, until cleanup finishes.
  serverStopPromise = Promise.resolve().then(() => stopOwnedProcess(owned)).catch((error) => {
    if (!serverProcess) serverProcess = owned;
    throw error;
  }).finally(() => { serverStopPromise = null; });
  return serverStopPromise;
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
    { label: "窗口置顶", type: "checkbox", checked: alwaysOnTop, click: toggleAlwaysOnTop },
    { label: "切换边栏", click: () => sendRendererCommand("toggle-sidebar") },
    { type: "separator" },
    { label: "设置", click: openSettingsWindow },
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
    ...(process.platform === "darwin" ? [{
      label: DISPLAY_NAME,
      submenu: [
        { role: "about", label: `关于 ${DISPLAY_NAME}` },
        { type: "separator" },
        { label: "设置…", accelerator: "Cmd+,", click: openSettingsWindow },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${DISPLAY_NAME}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "显示全部" },
        { type: "separator" },
        { role: "quit", label: `退出 ${DISPLAY_NAME}` },
      ],
    }] : []),
    {
      label: "文件",
      submenu: [
        { label: "新建会话", accelerator: "CmdOrCtrl+N", click: () => sendRendererCommand("new-viniper-session") },
        { label: "添加附件", accelerator: "CmdOrCtrl+O", click: () => sendRendererCommand("attach-file") },
        { label: "选择目录", accelerator: "CmdOrCtrl+Shift+O", click: () => sendRendererCommand("change-workdir") },
        { type: "separator" },
        { type: "separator" },
        ...(process.platform === "darwin" ? [{ role: "close", label: "关闭窗口" }] : [{ role: "quit", label: "退出" }])
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
        ...(process.platform === "darwin" ? [] : [{ label: "设置", accelerator: "CmdOrCtrl+,", click: openSettingsWindow }]),
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
        { label: "窗口置顶", type: "checkbox", checked: alwaysOnTop, click: toggleAlwaysOnTop },
        { type: "separator" },
        { label: "显示主窗口", click: showMainWindow },
        { label: "打开设置", click: openSettingsWindow },
      ]
    }
  ]));
}

function trustedDesktopHandler(handler) {
  return (event, ...args) => {
    if (!isTrustedUpdateSender(event)) throw new Error("操作必须来自工作台主窗口。");
    return handler(...args);
  };
}

ipcMain.handle("viniper:choose-project", trustedDesktopHandler(async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "选择工作目录", properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
}));
ipcMain.handle("viniper:open-external", trustedDesktopHandler(async (url) => {
  const parsed = new URL(String(url));
  if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) throw new Error("不支持的链接类型");
  await shell.openExternal(parsed.toString());
}));

ipcMain.handle("viniper:get-window-state", trustedDesktopHandler(() => ({ alwaysOnTop })));
ipcMain.handle("viniper:set-always-on-top", trustedDesktopHandler((enabled) => setAlwaysOnTop(Boolean(enabled))));
ipcMain.handle("viniper:toggle-always-on-top", trustedDesktopHandler(() => toggleAlwaysOnTop()));
ipcMain.handle("viniper:set-titlebar-theme", trustedDesktopHandler((theme) => setTitlebarTheme(theme)));
ipcMain.handle("viniper:install-app-update", (event) => installAppUpdate(event));
ipcMain.handle("viniper:save-provider-secret", trustedDesktopHandler((payload = {}) =>
  writeSecureSecret(payload.mode, payload.value)));
ipcMain.handle("viniper:clear-provider-secret", trustedDesktopHandler((payload = {}) =>
  clearSecureSecret(payload.mode)));
ipcMain.on("viniper:conversation-completed", (event) => { if (isTrustedUpdateSender(event)) markConversationCompleted(); });

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
    if (process.platform === "darwin") {
      app.setAboutPanelOptions({ applicationName: DISPLAY_NAME, applicationVersion: BUNDLED_VERSION, copyright: "Viniper" });
      // Use the bundle's macOS icon canvas. Replacing it with the edge-to-edge
      // brand PNG makes the Dock icon visibly larger than neighbouring apps.
      if (app.isPackaged) app.dock?.setIcon(path.join(process.resourcesPath, "Viniper-dock.png"));
    }
    createApplicationMenu();
    createTray();
    await createMainWindow();
  }).catch((error) => {
    isStarting = false;
    closeSplashWindow();
    dialog.showErrorBox(`${DISPLAY_NAME} 启动失败`, error.message || String(error));
    app.quit();
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
  if (quitReady) return;
  event.preventDefault();
  if (quitPromise) return;
  quitPromise = (async () => {
    try {
      await stopServerProcess();
      await closeSecretBroker();
      tray?.destroy();
      tray = null;
      quitReady = true;
      app.quit();
    } catch (error) {
      isQuitting = false;
      quitPromise = null;
      dialog.showErrorBox("暂时无法退出工作台", error.message || String(error));
    }
  })();
});
