import { BrowserWindow, session, net } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function toolWindow(id, directory, entryPoint, origin) {
  const isolated = session.fromPartition(`persist:toolbox-tool-${id}`);
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const base = origin || `toolbox-tool://${id}`;
  if (!origin) {
    if (await isolated.protocol.isProtocolHandled('toolbox-tool')) isolated.protocol.unhandle('toolbox-tool');
    const root = await realpath(directory);
    isolated.protocol.handle('toolbox-tool', async request => {
      try {
        const url = new URL(request.url);
        if (url.host !== id || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
        const file = await realpath(path.join(root, decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).href);
      } catch { return new Response('Not found', { status: 404 }); }
    });
  }
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(base + '/') || details.url.startsWith('blob:') || details.url.startsWith('data:')) });
  });
  const window = new BrowserWindow({ width: 1280, height: 840, title: id,
    webPreferences: { partition: `persist:toolbox-tool-${id}`, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const url = origin ? origin + '/' : `${base}/${entryPoint}`;
  window.webContents.on('will-navigate', (event, next) => { if (next.split('#')[0] !== url) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const closed = new Promise(resolve => window.once('closed', resolve));
  try { await window.loadURL(url); } catch (error) { window.destroy(); throw error; }
  return { window, closed, focus: () => window.focus(), stop: async () => { window.close(); await closed; } };
}

export async function launchTool({ id, directory, dataDir, launch }) {
  if (launch.type === 'html') return toolWindow(id, directory, launch.entryPoint);
  const token = randomUUID();
  const child = spawn(path.join(directory, launch.entryPoint), launch.args.map(arg => arg.replaceAll('{dataDir}', dataDir)), {
    cwd: directory, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, TOOLBOX_DATA_DIR: dataDir, ...(launch.readiness ? { TOOLBOX_READY_TOKEN: token } : {}) }
  });
  child.stdin.on('error', () => {});
  let exited = false;
  const closed = new Promise(resolve => child.once('close', code => { exited = true; resolve(code); }));
  const lines = createInterface({ input: child.stdout });
  let ready;
  try {
    ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('launchTimeout')), 45000);
      const finish = (error, value) => { clearTimeout(timer); child.off('error', failure); child.off('close', earlyExit); lines.off('line', line); error ? reject(error) : resolve(value); };
      const failure = error => finish(error);
      const earlyExit = () => finish(new Error('launchFailed'));
      const line = value => {
        try { const message = JSON.parse(value); if (message.toolboxReady === token) finish(null, message); } catch {}
      };
      child.once('error', failure); child.once('close', earlyExit);
      if (launch.readiness) lines.on('line', line);
      else child.once('spawn', () => finish(null, {}));
    });
    if (exited) throw new Error('launchFailed');
  } catch (error) { child.kill(); await closed; throw error; }
  const stop = async () => {
    if (exited) return;
    if (launch.readiness) child.stdin.end(); else child.kill();
    let timer;
    try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('toolStopTimeout')), 15000); })]); }
    finally { clearTimeout(timer); }
  };
  if (launch.type === 'loopback') {
    try {
      const url = new URL(ready.origin);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password || !ready.instance) throw new Error('invalidReadiness');
      const response = await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok || (await response.json()).instance !== ready.instance) throw new Error('invalidReadiness');
      const view = await toolWindow(id, directory, launch.entryPoint, url.origin);
      const finished = view.closed.then(stop);
      closed.then(() => { if (!view.window.isDestroyed()) view.window.destroy(); });
      return { ...view, ready, closed: finished, stop: async () => { await view.stop(); await finished; } };
    } catch (error) { await stop(); throw error; }
  }
  closed.then(() => lines.close());
  return { closed, stop, ready, pid: child.pid };
}
