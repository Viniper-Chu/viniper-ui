const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("viniperDesktop", {
  platform: process.platform
});
