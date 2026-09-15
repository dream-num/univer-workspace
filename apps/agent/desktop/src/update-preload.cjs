const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("workspaceUpdates", {
  getState: () => ipcRenderer.invoke("uwa:update-state"),
  check: () => ipcRenderer.invoke("uwa:update-check"),
  download: () => ipcRenderer.invoke("uwa:update-download"),
  pause: () => ipcRenderer.invoke("uwa:update-pause"),
  install: () => ipcRenderer.invoke("uwa:update-install"),
  releases: () => ipcRenderer.invoke("uwa:update-releases"),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("uwa:update-state", listener);
    return () => ipcRenderer.removeListener("uwa:update-state", listener);
  },
});
