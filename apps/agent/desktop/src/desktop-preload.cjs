const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("workspaceDesktop", {
  login: () => ipcRenderer.invoke("uwa:login"),
  openUpdates: () => ipcRenderer.invoke("uwa:open-updates"),
  diagnostics: () => ipcRenderer.invoke("uwa:diagnostics"),
  openDirectory: id => ipcRenderer.invoke("uwa:diagnostic-directory", id),
  exportDiagnostics: () => ipcRenderer.invoke("uwa:diagnostic-export"),
});
