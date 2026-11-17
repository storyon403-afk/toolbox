// Native local acceptance using production HTTPS download/extract/state/launch paths.
import { _electron as electron } from 'playwright';
import { checkLinkParsePreferences } from './linkparse-windows-check.mjs';
import { createRequire } from 'node:module';
import { createServer } from 'node:https';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = process.cwd();
const target = `${process.platform}-${process.arch}`;
const packaged = process.env.TOOLBOX_ACCEPTANCE_EXECUTABLE;
const work = await mkdtemp(path.join(os.tmpdir(), 'toolbox-real-'));
const profile = path.join(work, 'profile'); await mkdir(profile);
const evidenceDir = path.join(root, 'documents/evidence/real-tools'); await mkdir(evidenceDir, { recursive: true });
const evidence = { date: new Date().toISOString(), target: `${process.platform}-${process.arch}`, scope: 'local HTTPS, real tool payloads, package revisions 0.0.1 → 0.0.2 from the same repaired source; not a public update release', tools: {}, checks: [], errors: [] };
const record = async () => writeFile(path.join(evidenceDir, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
function run(cmd, args, options={}) { const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 120000, ...options }); if (result.status !== 0) throw new Error(`${cmd}: ${result.stderr || result.stdout || result.error}`); return result.stdout; }
if (!packaged) run(process.execPath, ['scripts/prepare-desktop.mjs']);
const catalogFile = packaged ? path.join(work, 'catalog.json') : path.join(root, 'build/app/catalog/tools.json');
const originalCatalog = packaged ? null : await readFile(catalogFile);
const entry = pathToFileURL(path.join(root, 'build/app/desktop/main.mjs')).href;
const artifacts = JSON.parse(await readFile('dist/managed-acceptance/artifacts.json', 'utf8')).map(a => ({...a, file: path.isAbsolute(a.file) ? a.file : path.resolve('dist/managed-acceptance', a.file)}));
const ids = [...new Set(artifacts.map(item => item.id))];
const checks = Object.fromEntries(['distribution','install','launch','update','uninstall','isolation','recovery'].map(name => [name, true]));
await writeFile(path.join(work,'openssl.cnf'),'[req]\ndistinguished_name=dn\n[dn]\n');
run(process.env.OPENSSL || 'openssl', ['req','-config',path.join(work,'openssl.cnf'),'-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(work,'key.pem'),'-out',path.join(work,'cert.pem'),'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);
const server = createServer({ key: await readFile(path.join(work,'key.pem')), cert: await readFile(path.join(work,'cert.pem')) }, async (req, res) => {
  const artifact = artifacts.find(a => req.url === '/' + path.basename(a.file));
  if (req.url === '/corrupt.zip') { res.end('intentional acceptance checksum failure'); return; }
  if (!artifact) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Length', (await stat(artifact.file)).size);
  createReadStream(artifact.file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `https://127.0.0.1:${server.address().port}`;
const bundledCatalog = JSON.parse(await readFile('catalog/tools.json','utf8'));
const catalog = { schemaVersion: 1, tools: [...ids.map(id => ({ id, name: id, description: 'Real local acceptance package', targets: {} })), ...bundledCatalog.tools.filter(tool => !ids.includes(tool.id))] };
let app, page;
function release(id, version, corrupt=false) {
  const a = artifacts.find(a => a.id === id && a.version === version);
  return { status: 'verified', version, releaseUrl: `${origin}/${corrupt ? 'corrupt.zip' : path.basename(a.file)}`, sha256: a.sha256, launch: a.launch, checks,
    evidence: ['Ephemeral local acceptance catalog, never published or copied to production catalog'] };
}
async function setRelease(id, version, corrupt=false) { catalog.tools.find(t => t.id === id).targets[target] = release(id, version, corrupt); await writeFile(catalogFile, JSON.stringify(catalog)); if (app) await main('check'); }
for (const id of ids) await setRelease(id, '0.0.1');
async function launch() {
  const env = { ...process.env, TOOLBOX_TEST_DATA_DIR: profile, NODE_EXTRA_CA_CERTS: path.join(work,'cert.pem') }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : [path.join(root,'build/app')], env, timeout: 45000 });
  page = await app.firstWindow(); await page.waitForFunction(() => !!window.toolboxDesktop);
  page.on('pageerror', error => evidence.errors.push(error.message));
  if (packaged) await app.evaluate(async ({app}, catalogFile) => { const entry = app.getAppPath() + '/desktop/main.mjs'; const { service } = process.getBuiltinModule('node:module').createRequire(entry)(entry); await service.checking; service.remoteConfig = { schemaVersion: 1, repository: null }; service.remoteCatalog = null; service.catalogFile = catalogFile; await service.check(); }, catalogFile);
}
async function main(action, id) {
  return app.evaluate(async ({app}, { entry, action, id }) => {
    entry = process.getBuiltinModule('node:url').pathToFileURL(app.getAppPath() + '/desktop/main.mjs').href;
    const { service } = process.getBuiltinModule('node:module').createRequire(entry)(process.getBuiltinModule('node:url').fileURLToPath(entry));
    if (action === 'check') return service.check();
    if (action === 'snapshot') return service.snapshot();
    if (action === 'prepare') return service.lifecycle.install(id, { prepare: true });
    if (action === 'stop') { const handle = service.lifecycle.running.get(id); if (handle) { await handle.stop(); await handle.closed; } return; }
    if (action === 'ready') return service.lifecycle.running.get(id)?.ready;
    if (action === 'recover') return service.lifecycle.recover();
    if (action === 'uninstall') return service.lifecycle.uninstall(id);
    throw new Error('Unknown acceptance action');
  }, { entry, action, id });
}
async function action(id, action, ok=true) {
  const result = await page.evaluate(async ({id,action}) => window.toolboxDesktop.action(id,action), {id,action});
  assert.equal(result.ok, ok, `${id} ${action}: ${JSON.stringify(result)}`); return result;
}
async function uninstall(id) {
  // Simulate the user's affirmative choice at the native dialog boundary only;
  // exercise the actual renderer IPC, validation and lifecycle removal path.
  await app.evaluate(({dialog}) => {
    globalThis.toolboxTestDialog = { original: dialog.showMessageBox, calls: 0 };
    dialog.showMessageBox = async (_window, options) => {
      if (options.type !== 'question' || options.defaultId !== 0) throw Error('Unexpected uninstall dialog');
      globalThis.toolboxTestDialog.calls++;
      return { response: 1, checkboxChecked: false };
    };
  });
  try { await action(id,'uninstall'); }
  finally {
    const calls=await app.evaluate(({dialog})=>{ const state=globalThis.toolboxTestDialog;dialog.showMessageBox=state.original;delete globalThis.toolboxTestDialog;return state.calls; });
    assert.equal(calls,1);
  }
}
async function view(id) { for (let i=0;i<80;i++) { const found=app.windows().find(p => id==='rd' ? p.url().startsWith('http://127.0.0.1:') : p.url().startsWith('toolbox-tool://designdoc/')); if(found) return found; await new Promise(r=>setTimeout(r,50)); } throw Error('Tool window missing: '+id); }
const data = id => path.join(profile,'tools',id,'data');
const binary = (id,v) => path.join(profile,'tools',id,'versions',v);
async function nativeCheck(id, version, seed) {
  const a = artifacts.find(a => a.id===id && a.version===version);
  const executable = path.join(binary(id,version),a.launch.entryPoint);
  if (process.platform === 'win32' && id === 'linkparsing') {
    const output = await checkLinkParsePreferences(path.join(binary(id,version),'app/LinkParse.exe'),data(id),seed);
    await writeFile(path.join(evidenceDir,`${id}-${version}-${seed?'seed':'reopen'}.txt`),output);
    return;
  }
  const script = id==='languagemap' ? path.join(root,'tools/languagemap/tests',seed?'smoke.js':'reopen.js') : path.join(root,'tools/linkparsing/scripts/native-smoke.js');
  if(process.platform === 'win32')await rm(path.join(data(id),'test-result.json'),{force:true});
  const output = run(executable,['--self-test',data(id),script],{timeout:90000});
  if (process.platform === 'win32' && id === 'languagemap') { const result = JSON.parse(await readFile(path.join(data(id),'test-result.json'),'utf8')); assert.equal(result.ok,true,JSON.stringify(result)); } else assert.match(output,/PASS:/); if(id==='linkparsing')assert.match(output,seed?/preferences saved/:/preferences restored/);
  await writeFile(path.join(evidenceDir,`${id}-${version}-${seed?'seed':'reopen'}.txt`),output);
}
async function verifyContent(id) {
  await action(id,'open');
  if(id==='rd') { const p=await view(id); await p.locator('.article-title').waitFor(); assert.equal(await p.locator('.article-title').textContent(),'Toolbox lifecycle RD'); }
  else if(id==='designdoc') { const p=await view(id); await p.locator('.board').first().waitFor(); assert.equal(await p.evaluate(()=>localStorage.getItem('toolbox-acceptance')),'designdoc-kept'); assert.equal(await p.locator('.layer-row').count(),35); }
  else { const ready=await main('ready',id); assert.equal(ready.dataDir,data(id)); if(id==='linkparsing')for(const key of (process.platform==='win32'?['ffmpeg','ffprobe','download_ready']:['download_ready','asr','ocr']))assert.equal(ready.doctor[key],true); }
}
try {
  await launch();
  for (const id of ids) {
    evidence.tools[id]={checks:[]};
    await action(id,'install'); await writeFile(path.join(data(id),'acceptance-marker.txt'),id);
    assert.equal(JSON.parse(await readFile(path.join(binary(id,'0.0.1'),'toolbox-package.json'))).packageRevision,'0.0.1');
    evidence.tools[id].checks.push('HTTPS install and verified extraction of real payload'); await record();
  }
  for(const id of ids)await action(id,'open');
  assert((await main('snapshot')).tools.filter(t=>ids.includes(t.id)).every(t=>t.state==='running'));
  for(const id of ids) {
    if(id==='rd') {
      const p=await view(id); await p.locator('.article-title').waitFor();
      if(!await p.locator('#editMode').isVisible())await p.locator('#menuToggle').click();
      await p.locator('#editMode').click();await p.locator('[data-block="title"]').fill('Toolbox lifecycle RD');await p.locator('#publishButton').click();
      await p.locator('#formatbar').waitFor({state:'hidden'});
      const ready=await main('ready',id);assert.equal((await (await fetch(ready.origin+'/api/health')).json()).instance,ready.instance);
      assert.equal(await p.evaluate(()=>typeof window.toolboxDesktop),'undefined');
    } else if(id==='designdoc') {
      const p=await view(id);await p.locator('.board').first().waitFor();await p.locator('#addRect').click();
      await p.evaluate(()=>localStorage.setItem('toolbox-acceptance','designdoc-kept'));
      assert.equal(await p.locator('.layer-row').count(),35);assert.equal(await p.evaluate(()=>typeof require),'undefined');
    } else { const ready=await main('ready',id);assert.equal(ready.dataDir,data(id)); }
    assert.equal((await action(id,'install',false)).error,'toolBusy');
    let rejected=false;try{await main('uninstall',id);}catch{rejected=true;}assert(rejected);
    evidence.tools[id].checks.push('real launch, simultaneous isolation and running-operation guards');
  }
  for(const id of ids)await main('stop',id);
  for(const id of ids.filter(id => ['languagemap','linkparsing'].includes(id)))await nativeCheck(id,'0.0.1',true);
  await app.close();app=null;await launch();
  assert.equal((await main('snapshot')).tools.filter(t=>t.installedVersion==='0.0.1').length,ids.length);
  for(const id of ids){await verifyContent(id);await main('stop',id);}
  evidence.checks.push('Toolbox process restart restores all tested real installations and persisted content');
  for(const id of ids) {
    await setRelease(id,'0.0.2',true);
    assert.equal((await action(id,'install',false)).error,'checksumMismatch');
    assert.equal((await main('snapshot')).tools.find(t=>t.id===id).installedVersion,'0.0.1');
    await setRelease(id,'0.0.2');
    await verifyContent(id);await main('prepare',id);
    assert.equal((await main('snapshot')).tools.find(t=>t.id===id).installedVersion,'0.0.1');
    await main('stop',id);await action(id,'install');
    assert.equal(JSON.parse(await readFile(path.join(binary(id,'0.0.2'),'toolbox-package.json'))).packageRevision,'0.0.2');
    assert((await stat(binary(id,'0.0.1'))).isDirectory());
    await verifyContent(id);await main('stop',id);
    if(['languagemap','linkparsing'].includes(id))await nativeCheck(id,'0.0.2',false);
    if(process.platform === 'darwin' && ['languagemap','linkparsing'].includes(id))run('codesign',['--verify','--deep','--strict',path.join(binary(id,'0.0.2'),id==='languagemap'?'LanguageMap.app':'LinkParsing.app')]);
    evidence.tools[id].checks.push('bad update rejected with old version retained','download while running; activate staged revision after graceful close','updated executable launched; real data and preferences retained');
    const versions=path.dirname(binary(id,'0.0.2')),removed=path.join(profile,'tools',id,`removed-${randomUUID()}`);
    await rename(versions,removed);await main('recover');assert((await stat(binary(id,'0.0.2'))).isDirectory());
    evidence.tools[id].checks.push('interrupted uninstall recovered');await record();
    console.log('PASS lifecycle update:',id);
  }
  for(const id of ids) {
    const others=(await main('snapshot')).tools.filter(t=>t.id!==id).map(t=>[t.id,t.installedVersion]);
    const retained=id==='languagemap'?'records.json':id==='linkparsing'?(process.platform==='win32'?'preferences.json':'preferences.plist'):null;
    const before=retained?await readFile(path.join(data(id),retained)):null;
    await uninstall(id);
    assert.equal(await stat(path.dirname(binary(id,'0.0.2'))).then(()=>true,()=>false),false);
    assert.equal(await readFile(path.join(data(id),'acceptance-marker.txt'),'utf8'),id);
    if(retained)assert.deepEqual(await readFile(path.join(data(id),retained)),before);
    assert.deepEqual((await main('snapshot')).tools.filter(t=>t.id!==id).map(t=>[t.id,t.installedVersion]),others);
    await action(id,'install');await verifyContent(id);await main('stop',id);
    if(['languagemap','linkparsing'].includes(id))await nativeCheck(id,'0.0.2',false);
    await uninstall(id);
    evidence.tools[id].checks.push('uninstall removes only managed versions; other tools and real data unchanged','reinstall restores retained real data/browser partition');await record();
    console.log('PASS uninstall/reinstall:',id);
  }
  assert((await main('snapshot')).tools.every(t=>!t.installedVersion));
  assert.deepEqual(evidence.errors,[]);evidence.passed=true;await record();
  console.log('PASS: real tool lifecycles on ' + target);
} catch(error) { evidence.errors.push(error.stack);evidence.passed=false;await record();throw error; }
finally {
  if(app){for(const id of ids)await main('stop',id).catch(()=>{});await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  await new Promise(resolve=>server.close(resolve));if(originalCatalog)await writeFile(catalogFile,originalCatalog);
  if(evidence.passed)await rm(work,{recursive:true,force:true,maxRetries:20,retryDelay:250});else console.error('Isolated failure profile retained:',work);
}
