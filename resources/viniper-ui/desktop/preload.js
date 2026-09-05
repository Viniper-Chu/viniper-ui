const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viniperDesktop", {
  platform: process.platform,
  getWindowState: () => ipcRenderer.invoke("viniper:get-window-state"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("viniper:set-always-on-top", Boolean(enabled)),
  toggleAlwaysOnTop: () => ipcRenderer.invoke("viniper:toggle-always-on-top"),
  setTitlebarTheme: (theme) => ipcRenderer.invoke("viniper:set-titlebar-theme", theme || {}),
  enableWslPlatform: () => ipcRenderer.invoke("viniper:enable-wsl-platform"),
  installAppUpdate: () => ipcRenderer.invoke("viniper:install-app-update"),
  saveProviderSecret: (mode, value) => ipcRenderer.invoke("viniper:save-provider-secret", { mode, value }),
  clearProviderSecret: (mode) => ipcRenderer.invoke("viniper:clear-provider-secret", { mode }),
  conversationCompleted: () => ipcRenderer.send("viniper:conversation-completed"),
  onCommand: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("viniper-command", listener);
    return () => ipcRenderer.removeListener("viniper-command", listener);
  },
  onWindowState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("viniper-window-state", listener);
    return () => ipcRenderer.removeListener("viniper-window-state", listener);
  }
});
