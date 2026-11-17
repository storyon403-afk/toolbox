'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {loginURL, remoteResource, cookieText} = require('./auth-utils.cjs');

class DouyinLogin {
  constructor({electron, dataDir, parent}) {
    this.electron = electron; this.parent = parent; this.dataDir = dataDir;
    this.directory = path.join(dataDir, 'accounts');
    this.tempRoot = path.join(dataDir, 'auth-tmp');
    fs.mkdirSync(this.directory, {recursive:true, mode:0o700});
    fs.mkdirSync(this.tempRoot, {recursive:true, mode:0o700});
    this.stateFile = path.join(this.directory, 'douyin-status.json');
    this.session = electron.session.fromPath(path.join(this.directory, 'douyin'));
    this.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.session.on('will-download', event => event.preventDefault());
    this.session.webRequest.onBeforeRequest((details, callback) => callback({cancel:!remoteResource(details.url)}));
    this.leases = new Set(); this.sweep();
  }
  sweep() {
    for (const item of fs.readdirSync(this.tempRoot, {withFileTypes:true})) {
      const match = /^douyin-(\d+)-/.exec(item.name);
      if (!match || !item.isDirectory() || item.isSymbolicLink()) continue;
      try { process.kill(Number(match[1]), 0); } catch (error) {
        if (error.code === 'ESRCH') fs.rmSync(path.join(this.tempRoot, item.name), {recursive:true, force:true});
      }
    }
  }
  async text() {
    const cookies = (await Promise.all(['douyin.com', 'iesdouyin.com'].map(domain => this.session.cookies.get({domain})))).flat();
    return cookieText(cookies);
  }
  async status() {
    const value = this.saved();
    const verified = Number.isFinite(value.verifiedAt), expired = value.expired === true;
    const present = !!await this.text();
    return {state:present && this.accepted() ? (expired ? 'expired' : verified ? 'connected' : 'unverified') : 'disconnected', can_remove:present || this.accepted()};
  }
  saved() {
    try {
      if (fs.statSync(this.stateFile).size > 4096) return {};
      const value = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return {savedAt:Number.isFinite(value?.savedAt) ? value.savedAt : undefined,
        verifiedAt:Number.isFinite(value?.verifiedAt) ? value.verifiedAt : undefined, expired:value?.expired === true};
    } catch { return {}; }
  }
  save(value) {
    const temporary = this.stateFile + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value), {mode:0o600});
    fs.renameSync(temporary, this.stateFile);
  }
  accepted() { const value = this.saved(); return Number.isFinite(value.savedAt) || Number.isFinite(value.verifiedAt) || value.expired === true; }
  mark(ok, code) {
    if (ok) this.save({verifiedAt:Date.now(), expired:false});
    else if (code === 'authentication_required') this.save({expired:true});
  }
  async lease() {
    if (!this.accepted()) return null;
    const text = await this.text();
    if (!text) return null;
    const directory = fs.mkdtempSync(path.join(this.tempRoot, `douyin-${process.pid}-`));
    const file = path.join(directory, 'cookies.txt');
    try { fs.writeFileSync(file, text, {mode:0o600, flag:'wx'}); }
    catch (error) { fs.rmSync(directory, {recursive:true, force:true}); throw error; }
    const lease = {file, release:() => { fs.rmSync(directory, {recursive:true, force:true}); this.leases.delete(lease); }};
    this.leases.add(lease); return lease;
  }
  async remove() {
    fs.rmSync(this.stateFile, {force:true});
    this.close();
    if (this.teardown) await this.teardown;
    for (const lease of this.leases) lease.release();
    await this.session.closeAllConnections();
    await this.session.clearStorageData(); await this.session.clearCache();
    // Clear cookies last, after service workers and in-flight page requests stop.
    for (const cookie of await this.session.cookies.get({})) {
      const domain = cookie.domain.replace(/^\./, '');
      await this.session.cookies.remove(`http${cookie.secure ? 's' : ''}://${domain}${cookie.path}`, cookie.name);
    }
    await this.session.cookies.flushStore();
    return this.status();
  }
  close() { if (this.window && !this.window.isDestroyed()) this.window.close(); }
  dispose() { this.close(); for (const lease of this.leases) lease.release(); }
  async open(url = 'https://www.douyin.com/') {
    if (this.opening) { this.window?.restore(); this.window?.focus(); return this.opening; }
    const {BrowserWindow, WebContentsView, ipcMain} = this.electron;
    await this.session.setProxy({mode:'system'});
    const local = pathToFileURL(path.join(__dirname, 'ui/login.html')).href;
    const host = new BrowserWindow({width:1100, height:820, minWidth:820, minHeight:620,
      parent:this.parent?.(), title:'登录抖音 · LinkParse', autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname, 'auth-preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true}});
    this.window = host;
    host.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    host.webContents.on('will-navigate', event => event.preventDefault());
    const view = new WebContentsView({webPreferences:{session:this.session, contextIsolation:true, nodeIntegration:false, sandbox:true}});
    this.teardown = new Promise(resolve => view.webContents.once('destroyed', resolve));
    host.contentView.addChildView(view);
    const layout = () => { const [width,height] = host.getContentSize(); view.setBounds({x:0,y:0,width,height:Math.max(0,height-84)}); };
    host.on('resize', layout); layout();
    const navigate = (event, target) => { if (!loginURL(target)) event.preventDefault(); };
    view.webContents.on('will-navigate', navigate); view.webContents.on('will-redirect', navigate);
    view.webContents.setWindowOpenHandler(({url}) => { if (loginURL(url)) view.webContents.loadURL(url).catch(() => {}); return {action:'deny'}; });
    const status = (message, busy=false) => { if (!host.isDestroyed()) host.webContents.send('linkparse-login-status', {message,busy}); };
    let completed = false, handling = false;
    this.opening = new Promise(resolve => {
      const action = async (event, name) => {
        if (event.sender !== host.webContents || event.senderFrame !== host.webContents.mainFrame || event.senderFrame.url !== local) return;
        if (name === 'cancel') return host.close();
        if (name !== 'complete' || handling) return;
        handling = true;
        try {
          if (!await this.text()) { status('尚未获取到登录状态，请先在官方页面完成登录或验证。'); return; }
          await this.session.cookies.flushStore();
          this.save({savedAt:Date.now(), expired:false});
          completed = true; host.close();
        } catch { status('暂时无法保存登录状态，请重试。'); }
        finally { handling = false; }
      };
      ipcMain.on('linkparse-login-action', action);
      host.once('closed', () => {
        ipcMain.removeListener('linkparse-login-action', action);
        if (!view.webContents.isDestroyed()) view.webContents.close();
        this.window = null; this.opening = null; resolve({cancelled:!completed});
      });
    });
    try { await host.loadURL(local); }
    catch { host.close(); throw Error('无法打开登录窗口，请重新启动应用。'); }
    view.webContents.loadURL(loginURL(url) ? url : 'https://www.douyin.com/').catch(() => status('官方页面加载失败，请检查网络；可关闭后重试。'));
    host.show(); host.focus();
    return this.opening;
  }
}
module.exports = {DouyinLogin};
