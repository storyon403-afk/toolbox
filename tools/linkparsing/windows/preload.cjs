const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('linkparsing', {
  postMessage: message => ipcRenderer.send('desktop-request', message),
  onReply: callback => ipcRenderer.on('desktop-reply', (_event, reply) => callback(reply)),
  onExit: callback => ipcRenderer.on('backend-exited', () => callback())
});
