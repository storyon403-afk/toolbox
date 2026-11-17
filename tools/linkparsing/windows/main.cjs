'use strict';
const {app, BrowserWindow, dialog, ipcMain, shell, session} = require('electron');
const {spawn} = require('node:child_process');
const {join, dirname, basename, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {StringDecoder} = require('node:string_decoder');
const {commandFor} = require('./protocol.cjs');
const root = join(__dirname, '..');
const settings = require('./settings.cjs');
const {DouyinLogin} = require('./auth.cjs');
const {douyinShare} = require('./auth-utils.cjs');
const dataDir = process.env.TOOLBOX_DATA_DIR ? resolve(process.env.TOOLBOX_DATA_DIR) : app.getPath('userData');
require('node:fs').mkdirSync(dataDir,{recursive:true});
app.setPath('userData',dataDir);
const page = pathToFileURL(join(__dirname, 'ui/index.html')).href;
const initial = settings.load(dataDir);
const packaged = app.isPackaged;
const runtime = join(root,'runtime');
const backend = packaged ? join(runtime,'linkparsing-desktop.exe') : join(root,'target/release/linkparsing-desktop' + (process.platform === 'win32' ? '.exe' : ''));
const backendEnv = {...process.env, LINKPARSING_WORKER:join(root,'backend/worker/download.py')};
if (packaged) Object.assign(backendEnv, {
  LINKPARSING_PYTHON:join(runtime,'python/python.exe'), LINKPARSING_FFMPEG:join(runtime,'ffmpeg.exe'),
  LINKPARSING_FFPROBE:join(runtime,'ffprobe.exe'), LINKPARSING_NODE:join(runtime,'node.exe')
});
let loaded = false, readinessSent = false, doctor;
function ready() {
  if (readinessSent || !loaded || ended || !doctor?.ffmpeg || !doctor?.ffprobe || !doctor?.download_ready) return;
  if (process.env.TOOLBOX_READY_TOKEN) {
    readinessSent = true;
    const message = JSON.stringify({toolboxReady:process.env.TOOLBOX_READY_TOKEN,dataDir,doctor})+'\n';
    if (control) control.write(message); else process.stdout.write(message);
  }
}
function persist() { settings.save(dataDir,{workspace,publicDns}); }
let window, worker, ended = false, busy = false, quitting = false;
let workspace = initial.workspace, cookies, activeAsset, viewedAsset, sourceFolder, lastExport;
let publicDns = initial.publicDns;
let login;
const players = new Set();
async function openPreview(file) {
  if (!await shell.openPath(file)) return;
  const fallback = packaged ? join(runtime,'ffplay.exe') : process.env.LINKPARSING_FFPLAY;
  if (!fallback || !require('node:fs').existsSync(fallback)) throw Error('无法打开系统播放器，请检查文件关联。');
  await new Promise((resolve, reject) => {
    const player = spawn(fallback,['-hide_banner','-loglevel','error','-window_title','LinkParse · 查看素材',file],{windowsHide:false,stdio:'ignore'});
    players.add(player);
    player.once('spawn',resolve);
    player.once('error',() => { players.delete(player); reject(Error('无法打开备用播放器。')); });
    player.once('exit',() => players.delete(player));
  });
}
const pending = new Map();
function reply(value) { if (window && !window.isDestroyed()) window.webContents.send('desktop-reply', value); }
function success(id, data = {}) { reply({id, ok:true, data}); }
function failure(id, message) { reply({id, ok:false, error:{message}}); }
function backendExited() {
  if (ended) return;
  for (const entry of pending.values()) entry.authLease?.release();
  login?.close();
  ended = true; pending.clear();
  if (window && !window.isDestroyed()) window.webContents.send('backend-exited');
  if (quitting) app.quit();
}
function send(id, action, command, source, authLease) {
  if (ended || !worker.stdin.writable) throw Error('后端已退出，请重新打开应用。');
  pending.set(id, {action, source, authLease});
  try { worker.stdin.write(JSON.stringify({id, command}) + '\n'); }
  catch (error) { pending.delete(id); authLease?.release(); throw error; }
}
async function pick(directory, title) {
  const result = await dialog.showOpenDialog(window, {title, defaultPath:workspace,
    properties:directory ? ['openDirectory', 'createDirectory'] : ['openFile']});
  return result.canceled ? null : result.filePaths[0];
}
async function receive(raw) {
  const entry = pending.get(raw.id);
  if (!entry) return;
  if (raw.event === 'progress') { reply(raw); return; }
  try {
  if (entry.authLease) {
    login.mark(raw.ok, raw.error?.code);
    raw.account = await login.status();
  }
  if (raw.ok) {
    const data = raw.data;
    if (entry.action === 'doctor') { doctor = {...data}; data.preferences = {public_dns:publicDns, workspace:workspace || '未选择'}; data.account = await login.status(); ready(); }
    if (['import','download','resolve'].includes(entry.action)) data.workspace = workspace;
    if (data.asset) {
      if (activeAsset !== data.asset.id) { viewedAsset = null; lastExport = null; sourceFolder = null; }
      activeAsset = data.asset.id;
      if (entry.source) sourceFolder = dirname(entry.source);
    }
    if (data.source_directory) sourceFolder = data.source_directory;
    delete data.source_directory;
    if (data.preview_path) {
      // Launch only a backend-produced media path, never a renderer-supplied path or URL.
      try { await openPreview(data.preview_path); }
      catch (error) { failure(raw.id,error.message); return; }
      viewedAsset = activeAsset;
      success(raw.id, {opened:true}); return;
    }
    if (data.report) {
      lastExport = data.report.directory;
      delete data.report.directory;
      data.report.can_reveal = !!lastExport;
      for (const item of data.report.outputs) if (item.files) item.files = item.files.map(p => basename(p));
    }
  }
  reply(raw);
  } finally { pending.delete(raw.id); entry.authLease?.release(); }
}
async function dispatch(body) {
  const {id, action} = body;
  if (action === 'doctor' || action === 'cancel') return send(id, action, {type:action});
  if (action === 'workspace') {
    const selected = await pick(true, '选择素材保存目录');
    if (selected) { workspace = selected; persist(); }
    return success(id, {cancelled:!selected, workspace:workspace || '未选择'});
  }
  if (action === 'preferences') { publicDns = body.public_dns === true; persist(); return success(id, {public_dns:publicDns}); }
  if (action === 'account_status') return success(id, {account:await login.status()});
  if (action === 'login') {
    const result = await login.open();
    if (!result.cancelled) cookies = null;
    return success(id, {...result, account:await login.status()});
  }
  if (action === 'remove_login') return success(id, {account:await login.remove()});
  if (action === 'cookies') {
    const selected = await pick(false, '选择主动提供的 Netscape Cookie 文件');
    if (selected) cookies = selected;
    return success(id, {cancelled:!selected, cookie_name:cookies ? basename(cookies) : '未选择'});
  }
  if (action === 'clear_cookies') { cookies = null; return success(id, {cookie_name:'未选择'}); }
  if (action === 'reveal' || action === 'reveal_source') {
    const path = action === 'reveal' ? lastExport : sourceFolder;
    if (!path) throw Error('尚无可打开的目录。');
    if (await shell.openPath(path)) throw Error('无法打开目录。');
    return success(id);
  }
  if (['import','download','resolve'].includes(action)) {
    workspace ||= await pick(true, '选择素材保存目录');
    if (!workspace) return success(id, {cancelled:true});
    persist();
    if (action === 'import') {
      const path = await pick(false, '导入本地视频或音频');
      if (!path) return success(id, {cancelled:true});
      return send(id, action, {type:action, path, workspace}, path);
    }
    if (typeof body.share !== 'string' || Buffer.byteLength(body.share) > 16384) throw Error('分享链接无效。');
    const authLease = !cookies && douyinShare(body.share) ? await login.lease() : null;
    try { return send(id, action, {type:action, share:body.share, workspace, cookies:cookies || authLease?.file || null, public_dns:body.public_dns === true}, undefined, authLease); }
    catch (error) { authLease?.release(); throw error; }
  }
  if (action === 'reopen') {
    const directory = await pick(true, '打开包含 asset.json 的 download-* 素材目录');
    return directory ? send(id, action, {type:action, directory}) : success(id, {cancelled:true});
  }
  if (!activeAsset || body.asset_id !== activeAsset) throw Error('请先下载或导入素材。');
  if (action === 'review') {
    if (viewedAsset !== activeAsset) throw Error('请先查看完整素材，再审核。');
    const {response} = await dialog.showMessageBox(window, {type:'question', title:'人工审核源素材',
      message:'请确认已在播放器中实际查看完整视频，再作出结论。',
      detail:'打开播放器不等于已完成审核。确认无水印将允许视觉导出；这不是自动检测或去水印。',
      buttons:['取消','已查看完整视频，确认无水印','发现水印'], defaultId:0, cancelId:0, noLink:true});
    return response === 0 ? success(id, {cancelled:true}) : send(id, action,
      {type:action, asset_id:activeAsset, clean:response === 1, note:'用户在 Windows 原生确认框中完成完整素材人工审核'});
  }
  if (action === 'export' || action === 'transcript') {
    const path = await pick(action === 'export', action === 'export' ? '选择导出保存目录' : '导入时间轴 JSON');
    if (!path) return success(id, {cancelled:true});
    return send(id, action, commandFor(body, path));
  }
  return send(id, action, commandFor(body));
}
app.whenReady().then(() => {
  login = new DouyinLogin({electron:require('electron'), dataDir, parent:() => window});
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // This host loads only bundled local UI. Downloads belong to the Rust worker.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({cancel:!details.url.startsWith('file:') && !details.url.startsWith('data:')}));
  window = new BrowserWindow({width:1280, height:860, minWidth:960, minHeight:680, title:'LinkParse',
    webPreferences:{preload:join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true}});
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  worker = spawn(backend, [],
    {cwd:dataDir, windowsHide:true, stdio:['pipe','pipe','ignore'], env:backendEnv});
  worker.on('error', backendExited); worker.on('exit', backendExited); worker.stdin.on('error', backendExited);
  const decoder = new StringDecoder('utf8'); let buffer = '';
  worker.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 1024*1024) { worker.stdin.end(); backendExited(); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0,index); buffer = buffer.slice(index+1);
      try { receive(JSON.parse(line)).catch(() => backendExited()); } catch { backendExited(); }
    }
  });
  ipcMain.on('desktop-request', async (event, body) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page) return;
    if (!body || !Number.isSafeInteger(body.id) || body.id <= 0 || typeof body.action !== 'string') return;
    if (Buffer.byteLength(JSON.stringify(body)) > 65536) return failure(body.id,'请求过大。');
    if (ended) return failure(body.id,'后端已退出，请重新打开应用。');
    if (pending.has(body.id)) return;
    const cancellation = body.action === 'cancel';
    if ((busy || pending.size) && !cancellation) return failure(body.id,'请等待当前任务完成，或先取消。');
    if (!cancellation) busy = true;
    try { await dispatch(body); } catch (error) { failure(body.id, error.message); }
    finally { if (!cancellation) busy = false; }
  });
  window.webContents.on('did-finish-load', () => { loaded = true; ready(); if (ended) window.webContents.send('backend-exited'); });
  window.loadURL(page);
});
let control;
if (process.env.TOOLBOX_READY_TOKEN && process.env.LINKPARSE_CONTROL_PIPE) {
  control = require('node:net').createConnection(process.env.LINKPARSE_CONTROL_PIPE);
  control.setEncoding('utf8');
  let command = '';
  control.on('data', chunk => { command += chunk; if (command === 'quit\n' || command.length > 32) app.quit(); });
  control.on('end', () => app.quit());
  control.on('error', () => app.quit());
} else if (process.env.TOOLBOX_READY_TOKEN) {
  process.stdin.resume();
  process.stdin.on('end', () => app.quit());
  process.stdin.on('error', () => app.quit());
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  login?.dispose();
  for (const player of players) player.kill();
  if (worker && !ended) {
    event.preventDefault();
    if (!quitting) { quitting = true; worker.stdin.end(); }
  }
});
