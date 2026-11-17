// Exercise a relocated portable ZIP with synthetic media and ordinary host IPC.
// Native dialogs/player are substituted here; live desktop acceptance is separate.
import { _electron as electron } from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {extractPackage,sha256} from '../src/packages.mjs';
import {isolatedEnvironment,checkLinkParsePreferences} from './linkparse-windows-check.mjs';
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Native Windows x64 required');
const archive = path.resolve(process.argv[2] || 'tools/linkparsing/dist/LinkParse-0.1.0-Windows-x64.zip');
const work = await mkdtemp(path.join(os.tmpdir(),'LinkParse 中文 portable '));
const payload = path.join(work,'relocated'), dataDir = path.join(work,'profile'), workspace = path.join(work,'media');
await mkdir(workspace); await mkdir(dataDir);
const evidence = {date:new Date().toISOString(),target:'win32-x64',archiveSha256:await sha256(archive),checks:[],notCovered:['real video-platform downloads','actual native dialogs (separate live evidence)','optional ASR','Windows OCR and Agent (unavailable)','Windows ARM64'],passed:false};
let app;
function fallbackPlayers(payload) {
  const executable = path.join(payload,'resources/app/runtime/ffplay.exe').replaceAll("'", "''");
  const script = `$p=Get-Process | Where-Object { $_.ProcessName -eq 'ffplay' -and $_.Path -eq '${executable}' }; ConvertTo-Json -Compress -InputObject @($p | ForEach-Object { @{pid=$_.Id;visible=($_.MainWindowHandle -ne 0)} })`;
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(result.status,0,'inspect owned fallback player');
  return JSON.parse(result.stdout.trim());
}
async function files(directory) { const result=[]; for (const entry of await readdir(directory,{withFileTypes:true})) { const file=path.join(directory,entry.name); result.push(...(entry.isDirectory()?await files(file):[file])); } return result; }
try {
  await extractPackage(archive,payload);
  const manifest = JSON.parse(await readFile(path.join(payload,'manifest.json'),'utf8'));
  for (const [relative,digest] of Object.entries(manifest.files)) assert.equal(await sha256(path.join(payload,relative)),digest,relative);
  evidence.checks.push('all packaged file hashes match manifest after relocation');
  const executablePath = path.join(payload,'LinkParse.exe'), env = isolatedEnvironment(dataDir);
  const source = path.join(workspace,'测试 ; $ 原片.mp4');
  const ffmpeg=path.join(payload,'resources/app/runtime/ffmpeg.exe');
  const generated = spawnSync(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:r=10:d=2','-f','lavfi','-i','sine=duration=2','-c:v','mpeg4','-c:a','aac','-shortest',source],{env,timeout:30000,windowsHide:true});
  assert.equal(generated.status,0,'synthetic source');
  app = await electron.launch({executablePath,env,timeout:45000});
  const page = await app.firstWindow();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.waitForFunction(()=>typeof state!=='undefined' && state.doctor!==null);
  const doctor=await page.evaluate(()=>state.doctor);
  for(const key of ['ffmpeg','ffprobe','download_ready']) assert.equal(doctor[key],true,key);
  assert.equal(await page.evaluate(()=>typeof require),'undefined');
  const backendPath=path.join(payload,'resources/app/runtime/linkparsing-desktop.exe').replaceAll("'","''");
  const moduleCheck=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$p=Get-Process | Where-Object { $_.ProcessName -eq 'linkparsing-desktop' -and $_.Path -eq '${backendPath}' }; $p.Modules | Where-Object ModuleName -eq 'VCRUNTIME140.dll' | ForEach-Object FileName`],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(moduleCheck.status,0);
  assert.equal(moduleCheck.stdout.trim().toLowerCase(),path.join(payload,'resources/app/runtime/vcruntime140.dll').toLowerCase(),'backend actually loads bundled VC runtime');
  evidence.checks.push('backend loads VCRUNTIME140.dll from its package, not the system installation');
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};}),{sandbox:true,contextIsolation:true,nodeIntegration:false});
  const choices = async values => app.evaluate(({dialog,shell}, values)=>{globalThis.linkparseChoices=[...values];dialog.showOpenDialog=async()=>({canceled:false,filePaths:[globalThis.linkparseChoices.shift()]});dialog.showMessageBox=async()=>({response:1});shell.openPath=async()=>'No file association (acceptance fixture)';},values);
  await choices([workspace,source]);
  await page.evaluate(()=>request('import').then(d=>setAsset(d.asset)));
  assert.equal(await page.evaluate(()=>state.asset.watermark),'unknown');
  assert.equal(await page.evaluate(()=>request('review',{asset_id:state.asset.id}).then(()=>false,()=>true)),true);
  await page.evaluate(()=>request('preview',{asset_id:state.asset.id}));
  let visible=false;
  for(let attempt=0;attempt<20;attempt++){if(fallbackPlayers(payload).some(p=>p.visible)){visible=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}
  assert.equal(visible,true,'bundled player displays a real native window without a file association');
  await page.evaluate(()=>request('review',{asset_id:state.asset.id}).then(d=>setAsset(d.asset)));
  assert.equal(await page.evaluate(()=>state.asset.watermark),'verified_clean');
  for(const output of [{kind:'audio',format:'mp3'},{kind:'audio',format:'wav'},{kind:'frames',format:'png',timestamps_ms:[500]}]) {
    await choices([workspace]);
    const report = await page.evaluate(output=>request('export',{asset_id:state.asset.id,request:{range:{start_ms:0,end_ms:1000},outputs:[output]}}),output);
    assert.equal(report.report.status,'completed');
  }
  await choices([workspace]);
  const report = await page.evaluate(()=>request('export',{asset_id:state.asset.id,request:LPLogic.makeRequest({...form(),audio:false,original:true,full:false,start:'0',end:'1'},state.asset)}));
  assert.equal(report.report.status,'completed');
  const original=(await files(workspace)).filter(file=>path.basename(path.dirname(file))==='original');
  assert.equal(original.length,1);assert.deepEqual(await readFile(original[0]),await readFile(source));
  await mkdir('test-results/linkparse-windows',{recursive:true});
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.restore();window.show();window.focus();});
  await page.bringToFront();
  await page.screenshot({path:'test-results/linkparse-windows/portable.png'});
  assert.deepEqual(errors,[]);
  await app.close();app=null;
  assert.deepEqual(fallbackPlayers(payload),[],'owned player exits with LinkParse');
  evidence.checks.push('missing file association uses visible bundled ffplay; app close terminates its player');
  evidence.checks.push('restricted runtime PATH and Unicode relocation: doctor, sandbox, import, review gate, preview handoff, MP3/WAV/PNG and full-original export');
  await checkLinkParsePreferences(executablePath,dataDir,true);
  await checkLinkParsePreferences(executablePath,dataDir,false);
  evidence.checks.push('workspace and DNS preferences survive independent app restart');
  const child=spawn(path.join(payload,'resources/app/runtime/node.exe'),[path.join(payload,'resources/app/windows/managed.cjs')],{env:{...env,TOOLBOX_READY_TOKEN:'portable-acceptance'},stdio:['pipe','pipe','ignore'],windowsHide:false});
  const closed=once(child,'close');
  const lines=createInterface({input:child.stdout});
  try {
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('readiness timeout')),45000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',()=>{clearTimeout(timer);reject(Error('exited before readiness'));});
      lines.on('line',line=>{try{const value=JSON.parse(line);if(value.toolboxReady==='portable-acceptance'){clearTimeout(timer);resolve(value);}}catch{}});
    });
    assert.equal(ready.dataDir,dataDir);assert.equal(ready.doctor.download_ready,true);
    child.stdin.end();
    let timer;
    try { assert.equal((await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('EOF shutdown timeout')),15000);})]))[0],0); }
    finally {clearTimeout(timer);}
  } finally {lines.close();if(child.exitCode===null)child.kill();}
  evidence.checks.push('Toolbox readiness identity/data directory and graceful stdin EOF exit');
  evidence.passed=true;
} catch(error) {evidence.error=error.stack;throw error;}
finally {
  if(app)await app.close().catch(()=>{});
  await mkdir('documents/evidence',{recursive:true});
  await writeFile('documents/evidence/linkparse-windows-package.json',JSON.stringify(evidence,null,2)+'\n');
  if(evidence.passed)await rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:250});else console.error('Failure data:',work);
}
console.log('PASS: relocated LinkParse Windows portable package');
