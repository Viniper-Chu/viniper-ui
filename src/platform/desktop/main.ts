import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from "electron";
import { join, resolve } from "node:path";
import { AgentIntent, AppSnapshot, PermissionMode, PRODUCT_NAME, PRODUCT_TITLE } from "../../core/contracts";
import { PermissionAccessSelection } from "../../core/permission-contracts";
import { createHarnessApplication } from "../bootstrap/create-harness-application";
import { acquireDataRootLease, DataRootLease } from "../persistence/data-root-lease";
import { SafeStorageSecretVault } from "../security/safe-storage-secret-vault";
import { createRuntimeClient, RuntimeApplicationClient, startRuntimeOwner, RuntimeOwner } from "../runtime-host/local-runtime-host";
import { DesktopApplication } from "./desktop-application";
import { getBrandingAssetPath } from "./branding-assets";
import { buildTrayMenuTemplate, traySessionsFromSnapshot } from "./tray-menu";
import { ElectronNotificationAdapter } from "../notifications/electron-notification-adapter";
import { openExternalCliWindow } from "../process/external-cli-window";
import { AgentEngineId, DEFAULT_AGENT_ENGINE } from "../../core/agent-engine-contracts";

const WINDOW_TITLE = PRODUCT_TITLE;
// Stable 1.6.x compatibility root: both release lanes lease the existing
// Workstation Preview data directory; no copy or implicit migration occurs.
const workstationCompatibilityDataRoot = process.env.AGENT_DESKTOP_PREVIEW_DATA_ROOT
  ? resolve(process.env.AGENT_DESKTOP_PREVIEW_DATA_ROOT)
  : join(app.getPath("appData"), "Viniper workstation Preview");
app.setPath("userData", workstationCompatibilityDataRoot);
const desktopAssetsRoot = process.env.AGENT_DESKTOP_ASSETS_ROOT
  ? resolve(process.env.AGENT_DESKTOP_ASSETS_ROOT)
  : app.isPackaged ? app.getAppPath() : resolve(app.getAppPath(), "../../..");
let mainWindow: BrowserWindow | null = null;
let desktopApplication: DesktopApplication | RuntimeApplicationClient;
let dataRootLease: DataRootLease | undefined;
let runtimeOwner: RuntimeOwner | undefined;
let tray: Tray | null = null;
let latestAppSnapshot: AppSnapshot | undefined;
let shutdownStarted = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function registerIpc(): void {
  ipcMain.handle("agent:snapshot", () => desktopApplication.snapshot());
  ipcMain.handle("agent:create-session", (_event, engineId: AgentEngineId = DEFAULT_AGENT_ENGINE) => desktopApplication.createSession(engineId));
  ipcMain.handle("agent:choose-project-session", async (_event, engineId: AgentEngineId = DEFAULT_AGENT_ENGINE) => {
    const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options = {
      title: "打开项目",
      buttonLabel: "新建项目会话",
      properties: ["openDirectory"] as Array<"openDirectory">,
    };
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) return { status: "cancelled" as const };
    try {
      const session = await desktopApplication.createProjectSession(selection.filePaths[0], engineId);
      return { status: "created" as const, sessionId: session.id, projectRoot: session.workingDirectory };
    } catch (error) {
      return {
        status: "rejected" as const,
        message: error instanceof Error ? error.message : "所选项目未能打开；当前会话未改变。",
      };
    }
  });
  ipcMain.handle("window:open-external-terminal", (_event, sessionId: string) => {
    const session = desktopApplication.snapshot().sessions.find((item) => item.id === sessionId);
    return openExternalCliWindow({
      executable: process.execPath,
      cliEntry: join(app.getAppPath(), "dist", "src", "platform", "cli", "main.js"),
      dataRoot: workstationCompatibilityDataRoot,
      projectRoot: session?.workingDirectory ?? process.cwd(),
    });
  });
  ipcMain.handle("agent:set-active", (_event, sessionId: string) => desktopApplication.setActiveSession(sessionId));
  ipcMain.handle("agent:rename-session", (_event, sessionId: string, title: string) => desktopApplication.renameSession(sessionId, title));
  ipcMain.handle("agent:toggle-pinned", (_event, sessionId: string) => desktopApplication.togglePinned(sessionId));
  ipcMain.handle("agent:delete-session", (_event, sessionId: string) => desktopApplication.deleteSession(sessionId));
  ipcMain.handle("agent:query-sessions", (_event, query) => desktopApplication.querySessions(query));
  ipcMain.handle("agent:set-smart-routing", (_event, enabled: boolean) => desktopApplication.setSmartRoutingEnabled(enabled));
  ipcMain.handle("agent:set-routing-strategy", (_event, strategy) => desktopApplication.setSmartRoutingStrategy(strategy));
  ipcMain.handle("agent:create-memory", (_event, input) => desktopApplication.createMemory(input));
  ipcMain.handle("agent:update-memory", (_event, id: string, text: string) => desktopApplication.updateMemory(id, text));
  ipcMain.handle("agent:set-memory-enabled", (_event, id: string, enabled: boolean) => desktopApplication.setMemoryEnabled(id, enabled));
  ipcMain.handle("agent:delete-memory", (_event, id: string) => desktopApplication.deleteMemory(id));
  ipcMain.handle("agent:build-index", (_event, sessionId: string) => desktopApplication.buildProjectIndex(sessionId));
  ipcMain.handle("agent:search-index", (_event, sessionId: string, query: string) => desktopApplication.searchProjectIndex(sessionId, query));
  ipcMain.handle("agent:set-index-semantic", (_event, enabled: boolean) => desktopApplication.setProjectIndexSemantic(enabled));
  ipcMain.handle("agent:set-model", (_event, sessionId: string, model: string) => desktopApplication.setModel(sessionId, model));
  ipcMain.handle("agent:set-provider-model", (_event, sessionId: string, providerId: string, model: string) =>
    desktopApplication.setProviderModel(sessionId, providerId, model));
  ipcMain.handle("agent:set-permission", (_event, sessionId: string, permissionMode: PermissionMode) =>
    desktopApplication.setPermissionMode(sessionId, permissionMode));
  ipcMain.handle("agent:set-permission-access", (_event, sessionId: string, selection: PermissionAccessSelection) =>
    desktopApplication.setPermissionAccess(sessionId, selection));
  ipcMain.handle("agent:restore-project-change", (_event, sessionId: string, receiptId: string) =>
    desktopApplication.restoreProjectChange(sessionId, receiptId));
  ipcMain.handle("agent:terminal-output", (_event, sessionId: string, input: Parameters<DesktopApplication["readTerminalOutput"]>[1]) =>
    desktopApplication.readTerminalOutput(sessionId, input));
  ipcMain.handle("agent:send", (_event, intent: AgentIntent) => desktopApplication.send(intent));
  ipcMain.handle("agent:cancel", (_event, sessionId: string) => desktopApplication.cancel(sessionId));
  ipcMain.handle("agent:list-runs", (_event, sessionId?: string) => desktopApplication.listRuns(sessionId));
  ipcMain.handle("agent:cancel-run", (_event, runId: string) => desktopApplication.cancelRun(runId));
  ipcMain.handle("agent:steer", (_event, runId: string, message: string) => desktopApplication.steer(runId, message));
  ipcMain.handle("agent:inject", (_event, runId: string, context: Record<string, unknown>) => desktopApplication.inject(runId, context));
  ipcMain.handle("agent:clear-steering", (_event, runId: string) => desktopApplication.clearSteering(runId));
  ipcMain.handle("agent:list-steering", (_event, runId?: string) => desktopApplication.listSteering(runId));
  ipcMain.handle("agent:resolve-tool-approval", (_event, sessionId: string, runId: string, callId: string, decision: "allow-once" | "reject") =>
    desktopApplication.resolveToolApproval(sessionId, runId, callId, decision));

  ipcMain.handle("coordination:send-message", (_event, source: string, target: string, text: string) =>
    desktopApplication.sendMessage(source, target, text));
  ipcMain.handle("coordination:delegate", (_event, source: string, target: string, text: string) =>
    desktopApplication.delegateTask(source, target, text));
  ipcMain.handle("coordination:wait", (_event, sessionId: string, filter: Parameters<DesktopApplication["waitForMessage"]>[1]) =>
    desktopApplication.waitForMessage(sessionId, filter));
  ipcMain.handle("coordination:cancel-wait", (_event, sessionId: string) => desktopApplication.cancelWait(sessionId));
  ipcMain.handle("coordination:mark-read", (_event, sessionId: string, envelopeId: string) =>
    desktopApplication.markRead(sessionId, envelopeId));

  ipcMain.handle("scheduler:create", (_event, draft: Parameters<DesktopApplication["createSchedule"]>[0]) =>
    desktopApplication.createSchedule(draft));
  ipcMain.handle("scheduler:set-enabled", (_event, id: string, enabled: boolean) =>
    desktopApplication.setScheduleEnabled(id, enabled));
  ipcMain.handle("scheduler:run-now", (_event, id: string) => desktopApplication.runScheduleNow(id));
  ipcMain.handle("scheduler:delete", (_event, id: string) => desktopApplication.deleteSchedule(id));
  ipcMain.handle("scheduler:restore", (_event, id: string) => desktopApplication.restoreSchedule(id));
  ipcMain.handle("notifications:mark-read", (_event, id: string) => desktopApplication.markNotificationRead(id));
  ipcMain.handle("artifacts:read", (_event, input) => desktopApplication.readArtifact(input));
  ipcMain.handle("transfer:export-archive", (_event, input) => desktopApplication.exportArchive(input));
  ipcMain.handle("transfer:stage-archive", (_event, sourcePath: string) => desktopApplication.stageArchiveImport(sourcePath));
  ipcMain.handle("transfer:preview-archive", (_event, stagingId: string) => desktopApplication.previewArchiveImport(stagingId));
  ipcMain.handle("transfer:merge-archive", (_event, stagingId: string, confirmed: boolean) => desktopApplication.mergeArchiveImport(stagingId, confirmed));
  ipcMain.handle("transfer:export-credentials", (_event, input) => desktopApplication.exportCredentialBundle(input));
  ipcMain.handle("transfer:import-credentials", (_event, input) => desktopApplication.importCredentialBundle(input));
  ipcMain.handle("diagnostics:preview", (_event, runId?: string) => desktopApplication.getDiagnosticsPreview(runId));
  ipcMain.handle("diagnostics:set-consent", (_event, enabled: boolean) => desktopApplication.setDiagnosticsConsent(enabled));
  ipcMain.handle("updates:check", (_event, channel) => desktopApplication.checkUpdates(channel));
  ipcMain.handle("updates:download", () => desktopApplication.downloadUpdate());
  ipcMain.handle("updates:confirm-install", () => desktopApplication.confirmUpdateInstall());
  ipcMain.handle("settings:snapshot", () => desktopApplication.getProductSettings());
  ipcMain.handle("settings:set", (_event, key: string, value: unknown) => desktopApplication.setProductSetting(key, value));
  ipcMain.handle("composition:center", () => desktopApplication.getCompositionCenter());
  ipcMain.handle("composition:set-preset", (_event, preset) => desktopApplication.setCompositionPreset(preset));
  ipcMain.handle("composition:select-custom", (_event, name: string) => desktopApplication.selectCustomComposition(name));
  ipcMain.handle("composition:copy-preset", (_event, source, name: string) => desktopApplication.copyCompositionPreset(source, name));
  ipcMain.handle("composition:set-capability", (_event, name: string, id: string, enabled: boolean) => desktopApplication.setCompositionCapability(name, id, enabled));
  ipcMain.handle("composition:reorder", (_event, name: string, order: string[]) => desktopApplication.reorderComposition(name, order));
  ipcMain.handle("composition:restore-default", () => desktopApplication.restoreDefaultComposition());

  ipcMain.handle("extensions:set-skill", (_event, sessionId: string, skillId: string, enabled: boolean) =>
    desktopApplication.setSkillEnabled(sessionId, skillId, enabled));
  ipcMain.handle("extensions:stage", (_event, input) => desktopApplication.stageExtension(input));
  ipcMain.handle("extensions:install", (_event, stagingId: string) => desktopApplication.installExtension(stagingId));
  ipcMain.handle("extensions:trust", (_event, id: string, version: string) => desktopApplication.trustExtension(id, version));
  ipcMain.handle("extensions:enable", (_event, id: string, enabled: boolean) => desktopApplication.enableExtension(id, enabled));
  ipcMain.handle("extensions:request-update", (_event, id: string, stagingId: string) => desktopApplication.requestExtensionUpdate(id, stagingId));
  ipcMain.handle("extensions:confirm-update", (_event, id: string) => desktopApplication.confirmExtensionUpdate(id));
  ipcMain.handle("extensions:request-rollback", (_event, id: string) => desktopApplication.requestExtensionRollback(id));
  ipcMain.handle("extensions:confirm-rollback", (_event, id: string) => desktopApplication.confirmExtensionRollback(id));
  ipcMain.handle("extensions:configure-mcp", (_event, input) => desktopApplication.configureMcp(input));
  ipcMain.handle("extensions:connect-mcp", (_event, id: string) => desktopApplication.connectMcp(id));

  ipcMain.handle("providers:save-secret", (_event, profileId: string, fieldId: string, value: string) =>
    desktopApplication.saveProviderSecret(profileId, fieldId, value));
  ipcMain.handle("providers:delete-secret", (_event, profileId: string, fieldId: string) =>
    desktopApplication.deleteProviderSecret(profileId, fieldId));
  ipcMain.handle("providers:set-endpoint", (_event, profileId: string, endpoint: string) =>
    desktopApplication.setProviderEndpoint(profileId, endpoint));
  ipcMain.handle("providers:set-manual-model", (_event, profileId: string, model: string) =>
    desktopApplication.setProviderManualModel(profileId, model));
  ipcMain.handle("providers:set-custom-options", (_event, input: Parameters<DesktopApplication["setCustomProviderOptions"]>[0]) =>
    desktopApplication.setCustomProviderOptions(input));
  ipcMain.handle("providers:set-capabilities", (_event, profileId: string, capabilities: Parameters<DesktopApplication["setProviderCapabilities"]>[1]) =>
    desktopApplication.setProviderCapabilities(profileId, capabilities));
  ipcMain.handle("providers:test-connection", (_event, profileId: string) => desktopApplication.testProviderConnection(profileId));
  ipcMain.handle("workspace:snapshot", (_event, workspaceId?: string) => desktopApplication.getWorkspaceSnapshot(workspaceId));
  ipcMain.handle("workspace:request-shared-commit", (_event, workspaceId: string) => desktopApplication.requestSharedCommit(workspaceId));
  ipcMain.handle("workspace:commit-shared", (_event, workspaceId: string, message: string, paths?: string[]) =>
    desktopApplication.commitShared(workspaceId, message, paths));
  ipcMain.handle("workspace:merge", (_event, workspaceId: string) => desktopApplication.mergeWorkspace(workspaceId));
  ipcMain.handle("workspace:restore", (_event, workspaceId: string) => desktopApplication.restoreWorkspace(workspaceId));
  ipcMain.handle("review:run", (_event, workspaceId: string) => desktopApplication.runReview(workspaceId));

  ipcMain.handle("window:state", (event) => windowState(windowForSender(event.sender)));
  ipcMain.handle("window:minimize", (event) => windowForSender(event.sender).minimize());
  ipcMain.handle("window:toggle-maximize", (event) => {
    const owner = windowForSender(event.sender);
    if (owner.isMaximized()) owner.unmaximize();
    else owner.maximize();
    return windowState(owner);
  });
  ipcMain.handle("window:close", async (event) => {
    const owner = windowForSender(event.sender);
    const settings = await desktopApplication.getProductSettings();
    if (settings.closeBehavior === "keep_running") {
      owner.hide();
      return;
    }
    if (settings.closeBehavior === "ask") {
      const result = await dialog.showMessageBox(owner, {
        type: "question",
        title: PRODUCT_NAME,
        message: "要关闭 Viniper workstation 吗？",
        detail: "选择隐藏会继续保留运行中的 Agent；选择退出会释放 Runtime。",
        buttons: ["隐藏", "退出", "取消"],
        defaultId: 0,
        cancelId: 2,
      });
      if (result.response === 0) {
        owner.hide();
        return;
      }
      if (result.response !== 1) return;
    }
    owner.close();
  });
}

async function createWindow(): Promise<void> {
  const requestedSize = /^(\d{3,4})x(\d{3,4})$/u.exec(process.env.AGENT_DESKTOP_WINDOW_SIZE ?? "");
  const width = requestedSize ? Math.max(760, Number(requestedSize[1])) : 1440;
  const height = requestedSize ? Math.max(580, Number(requestedSize[2])) : 900;
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 760,
    minHeight: 580,
    title: WINDOW_TITLE,
    icon: getBrandingAssetPath(desktopAssetsRoot, "nativeFallback"),
    backgroundColor: "#F4FAF9",
    frame: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  });

  desktopApplication.subscribe((snapshot) => {
    latestAppSnapshot = snapshot;
    refreshTrayMenu(snapshot);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("agent:update", snapshot);
  });
  const showMainWindow = (): void => {
    showAndFocusMainWindow(false);
  };
  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.webContents.once("did-finish-load", showMainWindow);
  const publishWindowState = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("window:state-changed", windowState(mainWindow));
  };
  mainWindow.on("maximize", publishWindowState);
  mainWindow.on("unmaximize", publishWindowState);
  mainWindow.on("show", () => refreshTrayMenu());
  mainWindow.on("hide", () => refreshTrayMenu());
  await mainWindow.loadFile(join(__dirname, "../../renderer/shell/index.html"));
}

function createTray(): void {
  if (tray || !desktopApplication) return;
  const iconPath = getBrandingAssetPath(desktopAssetsRoot, "nativeSmall");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.on("click", () => toggleMainWindow());
  refreshTrayMenu();
}

function refreshTrayMenu(snapshot?: AppSnapshot): void {
  if (!tray || !desktopApplication) return;
  const current = snapshot ?? latestAppSnapshot ?? desktopApplication.snapshot();
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    sessions: traySessionsFromSnapshot(current),
    windowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    onSelect: (sessionId) => {
      showAndFocusMainWindow();
      void desktopApplication.setActiveSession(sessionId);
    },
    onNewAgent: () => {
      void desktopApplication.createSession().then(() => showAndFocusMainWindow());
    },
    onToggleWindow: () => toggleMainWindow(),
    onQuit: () => app.quit(),
  })));
}

function showAndFocusMainWindow(focus = true): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  if (focus) mainWindow.focus();
}

function toggleMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else showAndFocusMainWindow();
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function windowForSender(sender: Electron.WebContents): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(sender);
  if (!owner || owner !== mainWindow || owner.isDestroyed()) throw new Error("窗口控制请求来源无效。");
  return owner;
}

function windowState(owner: BrowserWindow): { maximized: boolean } {
  return { maximized: owner.isMaximized() };
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setName(PRODUCT_NAME);
    if (process.platform === "win32") Menu.setApplicationMenu(null);
    const dataRoot = app.getPath("userData");
    try {
      desktopApplication = await createRuntimeClient(dataRoot);
    } catch {
      dataRootLease = await acquireDataRootLease(dataRoot, `${PRODUCT_NAME} 桌面端`);
      const bundle = await createHarnessApplication({
        dataRoot,
        workingDirectory: process.cwd(),
        assetsRoot: desktopAssetsRoot,
        secretVault: new SafeStorageSecretVault(join(dataRoot, "secrets.enc.json")),
        approvalHostMode: "interactive",
        allowExternalNetwork: true,
        systemNotificationAdapter: new ElectronNotificationAdapter(),
        previewFullAccessDefaults: true,
        claudeCode: { enabled: true },
      });
      runtimeOwner = await startRuntimeOwner({
        dataRoot,
        service: bundle.application,
        ownerId: `${PRODUCT_NAME} 桌面端`,
        lease: dataRootLease,
      });
      dataRootLease = undefined;
      desktopApplication = bundle.application;
    }
    registerIpc();
    await createWindow();
    createTray();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });
}

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  destroyTray();
  void (async () => {
    let failed = false;
    try {
      await runtimeOwner?.dispose();
      runtimeOwner = undefined;
      await desktopApplication?.dispose();
    } catch (error) {
      failed = true;
      process.stderr.write(`终端进程清理失败：${error instanceof Error ? error.message : String(error)}\n`);
    }
    try {
      await dataRootLease?.release();
    } catch (error) {
      failed = true;
      process.stderr.write(`数据根租约释放失败：${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (failed) app.exit(1);
    else app.quit();
  })();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
