const { contextBridge, ipcRenderer } = require('electron');
// No IPC object, filesystem, arbitrary URL, command or shell is exposed to the renderer.
contextBridge.exposeInMainWorld('toolboxDesktop', Object.freeze({
  snapshot: () => ipcRenderer.invoke('toolbox:snapshot'),
  settings: patch => ipcRenderer.invoke('toolbox:settings', patch),
  check: () => ipcRenderer.invoke('toolbox:check'),
  action: (id, action) => ipcRenderer.invoke('toolbox:action', id, action),
  subscribe: listener => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('toolbox:changed', handler);
    return () => ipcRenderer.removeListener('toolbox:changed', handler);
  }
}));
