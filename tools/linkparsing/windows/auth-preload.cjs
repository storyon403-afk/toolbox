'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('loginControls', {
  complete: () => ipcRenderer.send('linkparse-login-action', 'complete'),
  cancel: () => ipcRenderer.send('linkparse-login-action', 'cancel'),
  onStatus: callback => ipcRenderer.on('linkparse-login-status', (_event, status) => callback(status))
});
