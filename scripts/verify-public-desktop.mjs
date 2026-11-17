// Native acceptance against the published repository, always with disposable data.
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const executablePath = process.argv[2];
if (!executablePath || process.platform !== 'win32' || process.arch !== 'x64') throw Error('Run on Windows x64: node scripts/verify-public-desktop.mjs PATH/TO/Toolbox.exe');
const profile = await mkdtemp(path.join(os.tmpdir(), 'toolbox-public-native-'));
const env = { ...process.env, TOOLBOX_TEST_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const report = { target: 'win32-x64', scope: 'Published GitHub catalog and exact public packages: installation, native launch, restart, retained-data uninstall/reinstall, update from a controlled local 0.0.0 record to the real published version; not future-version compatibility', tools: [], passed: false };
let app;
async function main(action, id) {
  return app.evaluate(async ({ app }, { action, id }) => {
    const entry = app.getAppPath() + '/desktop/main.mjs';
    const { service } = process.getBuiltinModule('node:module').createRequire(entry)(entry);
    if (action === 'check') return service.check();
    if (action === 'snapshot') return service.snapshot();
    if (action === 'stop') { const handle = service.lifecycle.running.get(id); await handle?.stop(); await handle?.closed; return; }
    await service.lifecycle[action](id); return service.snapshot();
  }, { action, id });
}
async function launch() {
  app = await electron.launch({ executablePath, args: [], env, timeout: 45000 });
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.toolboxDesktop);
}
try {
  await launch();
  const checked = await main('check'); assert.equal(checked.lastCheck.result, 'upToDate'); assert.equal(checked.catalogSource, 'remote');
  const tools = checked.tools.filter(tool => tool.installable); assert.equal(tools.length, 4);
  for (const tool of tools) {
    await main('install', tool.id); await main('open', tool.id);
    assert.equal((await main('snapshot')).tools.find(row => row.id === tool.id).state, 'running');
    await main('stop', tool.id);
    await writeFile(path.join(profile, 'tools', tool.id, 'data', 'acceptance-marker.txt'), 'retain');
    report.tools.push({ id: tool.id, version: tool.version, install: true, nativeLaunch: true });
    console.log(`Installed and launched public ${tool.id}`);
  }
  await app.close(); app = null; await launch();
  assert.ok((await main('snapshot')).tools.every(tool => tool.installedVersion));
  for (const tool of tools) {
    await main('uninstall', tool.id);
    assert.equal(await readFile(path.join(profile, 'tools', tool.id, 'data', 'acceptance-marker.txt'), 'utf8'), 'retain');
    await main('install', tool.id); await main('open', tool.id); await main('stop', tool.id);
    Object.assign(report.tools.find(row => row.id === tool.id), { restart: true, retainedDataReinstall: true });
    console.log(`Reinstalled public ${tool.id} with retained data`);
  }
  // The first public release has no previous public version. Exercise the actual
  // public update path with a deliberately older isolated installation record.
  await app.close(); app = null;
  const stateFile = path.join(profile, 'state.json'), state = JSON.parse(await readFile(stateFile, 'utf8'));
  for (const tool of tools) {
    await rename(path.join(profile, 'tools', tool.id, 'versions', tool.version), path.join(profile, 'tools', tool.id, 'versions', '0.0.0'));
    state.installations[tool.id].version = '0.0.0';
  }
  await writeFile(stateFile, JSON.stringify(state)); await launch(); await main('check');
  for (const tool of tools) {
    assert.equal((await main('snapshot')).tools.find(row => row.id === tool.id).state, 'updateAvailable');
    await main('install', tool.id); await main('open', tool.id); await main('stop', tool.id);
    assert.equal(await readFile(path.join(profile, 'tools', tool.id, 'data', 'acceptance-marker.txt'), 'utf8'), 'retain');
    report.tools.find(row => row.id === tool.id).publicUpdateFromControlledRecord = true;
    console.log(`Updated ${tool.id} from controlled record to public ${tool.version}`);
  }
  report.passed = true;
} catch (error) { report.error = error.stack; process.exitCode = 1; }
finally {
  if (app) {
    for (const tool of report.tools) await main('stop', tool.id).catch(() => {});
    await app.close();
  }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/public-desktop.json', JSON.stringify(report, null, 2) + '\n');
  if (report.passed) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  console.log(JSON.stringify(report));
}
