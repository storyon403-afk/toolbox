import { app, BrowserWindow, ipcMain, protocol, net, session, dialog, Menu, Notification } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';
import { launchTool } from './tool-launcher.mjs';
import { DesktopService } from '../src/desktop-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiRoot = path.join(root, 'ui');
const testData = process.env.TOOLBOX_TEST_DATA_DIR;
if (testData && path.isAbsolute(testData)) app.setPath('userData', testData);
app.setName('Toolbox');
protocol.registerSchemesAsPrivileged(['toolbox', 'toolbox-tool'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
const lock = app.requestSingleInstanceLock();
let window, service, closing = false;
const trusted = frame => frame && frame === window?.webContents.mainFrame && /^toolbox:\/\/app\/index\.html(?:#.*)?$/.test(frame.url);
const errorReply = error => ({ ok: false, error: ['unverifiedPackage','toolBusy','missingExecutable','checksumMismatch','downloadRequired','invalidSettings','cancelled','alreadyInstalled','notInstalled'].includes(error.message) ? error.message : 'operationFailed' });
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || !trusted(event.senderFrame)) throw new Error('Untrusted sender');
    try { return { ok: true, value: await action(...args) }; } catch (error) { return errorReply(error); }
  });
}
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 720, minHeight: 600, title: 'Toolbox', show: false, backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!/^toolbox:\/\/app\/index\.html(?:#.*)?$/.test(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  window.loadURL('toolbox://app/index.html');
}
const strings = {
  'zh-CN': { quitBusy: '请先关闭运行中的工具，再退出 Toolbox。', remove: '卸载工具', detail: '只移除 Toolbox 管理的程序文件，保留工具数据。', cancel: '取消', updates: '个工具可更新' },
  ja: { quitBusy: '実行中のツールを閉じてから Toolbox を終了してください。', remove: 'ツールをアンインストール', detail: 'Toolbox が管理するプログラムのみ削除します。データは保持されます。', cancel: 'キャンセル', updates: '個のツールを更新できます' },
  en: { quitBusy: 'Close running tools before quitting Toolbox.', remove: 'Uninstall tool', detail: 'Remove only Toolbox-managed program files. Tool data is kept.', cancel: 'Cancel', updates: 'tool updates available' }
};
if (!lock) app.quit();
else app.whenReady().then(async () => {
  const uiReal = await realpath(uiRoot);
  protocol.handle('toolbox', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
      const file = await realpath(path.join(uiRoot, decodeURIComponent(url.pathname)));
      if (!file.startsWith(uiReal + path.sep)) return new Response('Forbidden', { status: 403 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  service = await new DesktopService({ root: app.getPath('userData'), target: `${process.platform}-${process.arch}`, catalogFile: path.join(root, 'catalog/tools.json'), remoteConfigFile: path.join(root, 'catalog/remote.json'), locale: app.getLocale(), version: app.getVersion(), launch: launchTool,
    notify: (count, locale) => { const text = strings[locale] || strings.en; if (Notification.isSupported()) new Notification({ title: 'Toolbox', body: `${count} ${text.updates}` }).show(); }
  }).init();
  handle('toolbox:snapshot', () => service.snapshot());
  handle('toolbox:settings', patch => service.settings(patch));
  handle('toolbox:check', () => service.check());
  handle('toolbox:action', async (id, action) => {
    if (typeof id !== 'string' || !service.catalog.tools.some(tool => tool.id === id) || !['install','open','uninstall','cancel'].includes(action)) throw new Error('invalidTool');
    if (action === 'uninstall') {
      const locale = service.store.data.settings.language || app.getLocale(); const text = strings[locale] || strings.en;
      const choice = await dialog.showMessageBox(window, { type: 'question', message: `${text.remove}: ${service.catalog.tools.find(tool => tool.id === id).name}`, detail: text.detail, buttons: [text.cancel, text.remove], cancelId: 0, defaultId: 0, noLink: true });
      if (choice.response === 1) await service.lifecycle.uninstall(id);
    } else await service.lifecycle[action](id);
    return service.snapshot();
  });
  service.on('change', value => { if (window && !window.isDestroyed()) window.webContents.send('toolbox:changed', value); });
  Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'darwin' ? [{ label: 'Toolbox', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'windowMenu' }] : [{ role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  createWindow(); await service.tick();
}).catch(error => { console.error('Toolbox startup failed:', error.message); app.exit(1); });
app.on('second-instance', () => { if (!window && service) createWindow(); else if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('activate', () => { if (!window && service) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (!service || closing) return;
  event.preventDefault();
  if (service.lifecycle.running.size) {
    if (!window) createWindow();
    const text = strings[service.store.data.settings.language] || strings.en;
    dialog.showMessageBox(window, { type: 'info', message: text.quitBusy });
    return;
  }
  closing = true;
  service.close().finally(() => app.quit());
});

// Main-process access for local acceptance; never exposed through renderer IPC.
export { service };
