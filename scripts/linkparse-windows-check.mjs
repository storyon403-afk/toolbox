// Native UI preference checks use the ordinary IPC contract; no production self-test endpoint.
import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
export function isolatedEnvironment(dataDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LINKPARSING_') && !key.startsWith('TOOLBOX_') && key !== 'ELECTRON_RUN_AS_NODE'));
  env.TOOLBOX_DATA_DIR = dataDir;
  if (process.platform === 'win32') env.PATH = path.join(process.env.SystemRoot,'System32');
  return env;
}
export async function checkLinkParsePreferences(executablePath, dataDir, seed) {
  const app = await electron.launch({executablePath, env:isolatedEnvironment(dataDir), timeout:45000});
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.doctor !== null);
    const doctor = await page.evaluate(() => state.doctor);
    for (const key of ['ffmpeg','ffprobe','download_ready']) assert.equal(doctor[key],true,key);
    if (seed) {
      const workspace = path.join(dataDir,'中文 workspace'); await mkdir(workspace,{recursive:true});
      await app.evaluate(({dialog}, workspace) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[workspace]}); },workspace);
      await page.evaluate(async () => { await request('workspace'); await request('preferences',{public_dns:true}); });
    } else {
      assert.equal(doctor.preferences.public_dns,true,'saved DNS preference');
      assert.equal(doctor.preferences.workspace,path.join(dataDir,'中文 workspace'),'saved workspace');
    }
    return `PASS: Windows preferences ${seed?'saved':'restored'}; bundled downloader and media runtimes ready\n`;
  } finally { await app.close(); }
}
