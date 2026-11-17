// Run with: windows/node_modules/.bin/electron windows/smoke.cjs
// Uses synthetic media and dialog/player substitutes; never contacts video platforms.
const {app, BrowserWindow, dialog, shell} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const work = fs.mkdtempSync(path.join(os.tmpdir(),'LinkParse 中文 smoke '));
process.env.TOOLBOX_DATA_DIR = path.join(work,'profile');
const media = path.join(work, '测试 ; $ 原片.mp4');
const generated = spawnSync(process.env.LINKPARSING_FFMPEG || 'ffmpeg', ['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:r=10:d=2','-f','lavfi','-i','sine=duration=2','-c:v','mpeg4','-c:a','aac','-shortest',media], {stdio:'ignore'});
assert.equal(generated.status, 0, 'FFmpeg fixture');
let choices = [work, media];
dialog.showOpenDialog = async () => ({canceled:false,filePaths:[choices.shift()]});
dialog.showMessageBox = async () => ({response:1});
shell.openPath = async () => '';
const timer = setTimeout(() => { console.error('FAIL: host smoke timeout'); app.exit(1); },30000);
require('./main.cjs');
async function waitFor(w, expression) {
  for (let i=0;i<150;i++) {
    if (await w.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw Error('UI condition timed out');
}
app.whenReady().then(async () => {
  const w=BrowserWindow.getAllWindows()[0];
  await new Promise(resolve => w.webContents.once('did-finish-load',resolve));
  try {
    await waitFor(w,'state.doctor !== null');
    assert.equal(await w.webContents.executeJavaScript('state.doctor.ffmpeg'),true);
    assert.equal(await w.webContents.executeJavaScript('typeof require'), 'undefined');
    await w.webContents.executeJavaScript("request('import').then(d=>setAsset(d.asset))");
    assert.equal(await w.webContents.executeJavaScript('state.asset.watermark'),'unknown');
    const before=await w.webContents.executeJavaScript("request('review',{asset_id:state.asset.id}).then(()=>false,()=>true)");
    assert.equal(before,true,'review requires preview');
    await w.webContents.executeJavaScript("request('preview',{asset_id:state.asset.id})");
    await w.webContents.executeJavaScript("request('review',{asset_id:state.asset.id}).then(d=>setAsset(d.asset))");
    assert.equal(await w.webContents.executeJavaScript('state.asset.watermark'),'verified_clean');
    choices=[work];
    // Use the existing UI request builder, preserving the original/full-duration contract.
    const result=await w.webContents.executeJavaScript(`(() => {document.getElementById('originalOn').checked=true; return request('export',{asset_id:state.asset.id,request:LPLogic.makeRequest({...form(),audio:false,original:true,full:false,start:'0',end:'1'},state.asset)});})()`);
    assert.ok(result.report);
    assert.equal(result.report.status, 'completed');
    const exported=[];
    function walk(dir) { for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,item.name); if(item.isDirectory()) walk(file);
      else if(path.basename(dir)==='original') exported.push(file);
    }}
    walk(work); assert.equal(exported.length,1); assert.deepEqual(fs.readFileSync(exported[0]),fs.readFileSync(media));
    console.log('PASS: Electron bridge, doctor, Chinese paths, import, review gate, preview handoff, export');
  } catch(error) { console.error('FAIL:',error.message); process.exitCode=1; }
  finally { clearTimeout(timer); w.close(); }
});
app.on('quit', () => { fs.rmSync(work,{recursive:true,force:true}); });
