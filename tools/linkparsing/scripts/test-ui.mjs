// Isolated Chromium + real Rust IPC. File dialogs are replaced only in this test
// with generated fixture paths; no personal browser profile or live platforms.
import {chromium} from 'playwright';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const work=mkdtempSync(join(tmpdir(),'linkparsing-ui-'));
const media=join(work,'synthetic fixture.mp4'),transcript=join(work,'text.json');
const ffmpeg='/opt/homebrew/bin/ffmpeg',ffprobe='/opt/homebrew/bin/ffprobe';
let importMedia=media;
let browser,server,worker,page;const calls=[],waiters=new Map(),asrStages=[],progressErrors=[];let seq=0,preferences=false,lastReport,outputError='';
const realAsr=process.env.LINKPARSING_TEST_ASR==='1';
try{
  let sound=['-f','lavfi','-i','sine=frequency=440:duration=2'];
  if(realAsr){const speech=join(work,'speech.aiff');assert.equal(spawnSync('/usr/bin/say',['-v','Samantha','-o',speech,'Hello world.']).status,0);sound=['-i',speech,'-af','apad'];}
  const built=spawnSync(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=10:d=2',...sound,'-c:v','mpeg4','-c:a','aac','-t','2',media]);assert.equal(built.status,0);
  writeFileSync(transcript,JSON.stringify({segments:[{start_ms:0,end_ms:700,text:'第一段真实测试文字'},{start_ms:700,end_ms:1400,text:'<img src=x onerror="window.injected=true">'},{start_ms:1400,end_ms:2000,text:'第三段内容'}]}));
  worker=spawn(join(root,'build/LinkParsing.app/Contents/MacOS/linkparsing-desktop'),[],{stdio:['pipe','pipe','pipe']});
  worker.stderr.on('data',d=>{outputError+=d;});
  createInterface({input:worker.stdout}).on('line',line=>{const result=JSON.parse(line);const waiting=waiters.get(result.id);if(waiting){if(result.event==='progress'){waiting.progress?.(result);return;}waiters.delete(result.id);waiting.done(result);}});
  async function ipc(command,progress){const id=++seq;const promise=new Promise(done=>waiters.set(id,{done,progress}));worker.stdin.write(JSON.stringify({id,command})+'\n');return promise;}
  let slowResolve=false,heldResolve;
  async function bridge(body){
    calls.push(body);let command;
    const success=data=>({id:body.id,ok:true,data});
    if(body.action==='preferences'){preferences=body.public_dns;return success({public_dns:preferences});}
    if(body.action==='workspace')return success({workspace:'测试素材目录'});
    // Shortcut dispatch only; this double never downloads from a live platform.
    if(body.action==='download')return success({cancelled:true});
    if(body.action==='resolve'){
      if(slowResolve)return new Promise(done=>{heldResolve=()=>done({id:body.id,ok:false,error:{code:'cancelled',message:'operation cancelled'}});});
      if(!body.public_dns)return {id:body.id,ok:false,error:{code:'dns_not_public',message:'redacted DNS failure'}};
      return success({resolved:{title:'网络恢复测试（传输替身）',duration_ms:2000,platform:'bilibili'}});
    }
    if(body.action==='cancel'&&heldResolve){heldResolve();heldResolve=null;return success({cancelling:true});}
    if(body.action==='doctor')command={type:'doctor'};
    else if(body.action==='import')command={type:'import',path:importMedia,workspace:work};
    else if(body.action==='transcript')command={type:'transcript',asset_id:body.asset_id,path:transcript};
    else if(body.action==='transcribe')command={type:'transcribe',asset_id:body.asset_id,language:body.language};
    else if(body.action==='ocr')command={type:'ocr',asset_id:body.asset_id,range:body.range,interval_ms:body.interval_ms,language:body.language};
    else if(body.action==='content')command={type:'content',asset_id:body.asset_id,offset:body.offset,text_source:body.text_source};
    else if(body.action==='export')command={type:'export',asset_id:body.asset_id,request:body.request,destination:work,text_source:body.text_source};
    else if(body.action==='reveal')return success({});
    else if(body.action==='cancel')command={type:'cancel'};
    else throw Error('Unexpected UI action: '+body.action);
    const result=await ipc(command,event=>{asrStages.push(event.data.stage);page.evaluate(reply=>window.desktopReply(reply),{...event,id:body.id}).catch(error=>progressErrors.push(error.message));});result.id=body.id;
    if(result.ok&&body.action==='doctor')result.data.preferences={public_dns:preferences,workspace:'测试素材目录'};
    if(result.ok&&result.data.report){
      lastReport=result.data.report;
      result.data={report:{...lastReport,can_reveal:!!lastReport.directory,outputs:lastReport.outputs.map(o=>({...o,...(o.files?{files:o.files.map(file=>basename(file))}:{})}))}};
    }
    return result;
  }
  const mime={html:'text/html',js:'text/javascript',css:'text/css'};
  server=createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1);
    if(!['index.html','app.js','app.css','logic.js'].includes(name)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[name.split('.').pop()]});res.end(readFileSync(join(root,'desktop',name)));
  });await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('__nativeTest',bridge);
  await page.addInitScript(()=>{window.webkit={messageHandlers:{desktop:{postMessage:body=>{window.__nativeTest(body).then(reply=>window.desktopReply(reply));}}}};});
  const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
  await page.getByText('后端已连接',{exact:true}).waitFor();
  mkdirSync(join(root,'build/ui-checks'),{recursive:true});
  assert.equal(await page.locator('#download').isDisabled(),true);
  assert.equal(await page.locator('#resolve').isDisabled(),true);
  await page.locator('#share').fill('   ');
  assert.equal(await page.locator('#download').isDisabled(),true);
  await page.locator('#share').press('Meta+Enter');
  assert.equal(calls.filter(c=>c.action==='download').length,0);
  await page.locator('#share').fill(('多行分享文案\n').repeat(15)+'https://www.bilibili.com/video/BV123');
  const longInput=await page.locator('#share').boundingBox();
  assert.ok(longInput.height>=64&&longInput.height<=140);
  await page.locator('#share').press('Meta+Enter');
  await page.waitForFunction(()=>!document.getElementById('share').disabled);
  assert.equal(calls.filter(c=>c.action==='download').length,1);
  await page.locator('#clearShare').click();
  assert.equal(await page.locator('#share').inputValue(),'');
  assert.equal(await page.locator('#share').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('#download').isDisabled(),true);
  assert.ok((await page.locator('#share').boundingBox()).height<=42);
  await page.locator('#share').blur();
  async function noHorizontalOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  for(const [width,height]of [[1200,800],[860,640]]){
    await page.setViewportSize({width,height});await noHorizontalOverflow();
    const composer=await page.locator('.link-composer').boundingBox();
    for(const id of ['share','resolve','download']){const box=await page.locator('#'+id).boundingBox();assert.ok(box.x>=composer.x&&box.x+box.width<=composer.x+composer.width);}
    await page.screenshot({path:join(root,`build/ui-checks/import-${width}.png`),animations:'disabled'});
  }
  await page.setViewportSize({width:1200,height:900});
  await page.locator('#navAsset').click();await page.locator('#extractEmpty').waitFor({state:'visible'});
  await page.locator('#navAgent').click();await page.locator('#agentPage').waitFor({state:'visible'});
  await page.locator('#navSettings').click();await page.locator('#settingsPage').waitFor({state:'visible'});
  await page.screenshot({path:join(root,'build/ui-checks/settings.png'),animations:'disabled'});
  await page.locator('#back').click();await page.locator('#agentPage').waitFor({state:'visible'});
  await page.locator('#navImport').click();
  await page.locator('#share').fill('https://www.bilibili.com/video/BV123');await page.locator('#resolve').click();
  await page.locator('#retryDns').waitFor({state:'visible'});await page.locator('#retryDns').click();
  await page.locator('#resolvedTitle').getByText('网络恢复测试（传输替身）').waitFor();assert.equal(preferences,true);
  assert.equal(calls.filter(c=>c.action==='resolve').at(-1).public_dns,true);
  await page.reload();await page.getByText('后端已连接',{exact:true}).waitFor();
  assert.equal(await page.locator('#publicDns').isChecked(),true);
  // Long-running failure/retry transport double tests navigation and UI cancellation.
  slowResolve=true;await page.locator('#share').fill('https://www.bilibili.com/video/BV123');await page.locator('#resolve').click();
  await page.locator('#progress').waitFor({state:'visible'});await page.locator('#navAsset').click();
  await page.locator('#extractEmpty').waitFor({state:'visible'});await page.locator('#cancel').click();
  await page.locator('#noticeText').getByText('任务已取消。已完成的导出文件会保留。',{exact:true}).waitFor();slowResolve=false;
  await page.locator('#navImport').click();await page.locator('#importLocal').click();await page.locator('#assetContent').waitFor({state:'visible'});
  assert.equal(await page.locator('#framesOn').isDisabled(),true);assert.equal(await page.locator('#originalOn').isDisabled(),true);
  assert.equal(await page.locator('#imageFormat').isDisabled(),true);
  await page.locator('#audioOn').focus();await page.locator('#audioOn').press('Space');
  assert.equal(await page.locator('#outputCount').innerText(),'0');assert.equal(await page.locator('#export').isDisabled(),true);
  await page.locator('#audioOn').press('Space');assert.equal(await page.locator('#outputCount').innerText(),'1');
  await page.locator('#tabText').focus();await page.locator('#tabText').press('ArrowRight');
  assert.equal(await page.locator('#tabFrames').getAttribute('aria-selected'),'true');
  await page.locator('#tabFrames').press('Home');assert.equal(await page.locator('#tabText').getAttribute('aria-selected'),'true');
  for(const [width,height]of [[1200,800],[860,640],[600,800]]){
    await page.setViewportSize({width,height});await noHorizontalOverflow();
    for(const id of ['navImport','navAsset','navAgent','navSettings']){const box=await page.locator('#'+id).boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.y+box.height<=height);}
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:join(root,`build/ui-checks/extract-${width}.png`),animations:'disabled'});
  }
  await page.setViewportSize({width:1200,height:900});
  if(realAsr){
    await page.locator('#asrLanguage').selectOption('en');await page.locator('#transcribe').click();
    await page.locator('#progress').waitFor({state:'visible'});await page.locator('#navAgent').click();
    await page.locator('#analysisItems article').first().waitFor({timeout:120000});
    assert.match(await page.locator('#analysisItems').innerText(),/hello.*world/i);
    assert.deepEqual(asrStages,['preparing','recognizing','saving']);assert.deepEqual(progressErrors,[]);
    assert.equal(await page.locator('#textOn').isChecked(),true);
    await page.locator('#navAsset').click();
  }
  await page.locator('[data-tab="ocr"]').click();await page.locator('#contentPanel').getByText(/画面文字按间隔采样/).waitFor();
  await page.locator('#ocr').click();
  await page.locator('#noticeText').getByText(/未识别到画面文字/).waitFor({timeout:60000});
  // Failed OCR preserves an existing speech transcript and its export selection.
  assert.equal(await page.locator('#textSource').inputValue(),'speech');
  assert.equal(await page.locator('#textOn').isChecked(),realAsr);
  await page.locator('[data-tab="frames"]').click();await page.locator('#contentPanel').getByText(/尚无已导出/).waitFor();
  await page.locator('[data-tab="text"]').click();await page.locator('#transcript').click();
  await page.locator('#contentPanel .transcript-row').first().waitFor();assert.equal(await page.locator('#contentPanel .transcript-row').count(),3);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.locator('#navAgent').click();await page.locator('#runAnalysis').click();await page.locator('#analysisItems article').first().waitFor();
  assert.equal(await page.locator('#analysisItems article').count(),3);
  await page.locator('#analysisMode').selectOption('text');assert.equal(await page.locator('#analysisItems time').count(),0);
  await page.locator('#analysisMode').selectOption('timeline');
  mkdirSync(join(root,'build/ui-checks'),{recursive:true});await page.screenshot({path:join(root,'build/ui-checks/analysis.png'),fullPage:true});
  await page.locator('#navAsset').click();await page.locator('#audioFormat').selectOption('wav');await page.locator('#fullRange').uncheck();
  await page.locator('#rangeStart').fill('0.5');await page.locator('#rangeEnd').fill('1.5');await page.locator('#openExport').click();
  await page.locator('#exportDialog').waitFor({state:'visible'});assert.match(await page.locator('#exportSummary').innerText(),/WAV/);
  await page.locator('#closeExport').click();await page.locator('#exportDialog').waitFor({state:'hidden'});assert.equal(calls.filter(c=>c.action==='export').length,0);
  await page.locator('#openExport').click();await page.keyboard.press('Escape');await page.locator('#exportDialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#openExport').evaluate(el=>el===document.activeElement),true);
  await page.locator('#export').click();await page.screenshot({path:join(root,'build/ui-checks/export.png'),fullPage:true});
  await page.locator('#confirmExport').click();await page.locator('#reportTitle').getByText('导出完成',{exact:true}).waitFor();
  assert.equal(lastReport.status,'completed');const audio=lastReport.outputs[0].files[0];
  const duration=spawnSync(ffprobe,['-v','error','-show_entries','format=duration','-of','csv=p=0',audio],{encoding:'utf8'});assert.equal(duration.status,0);assert.ok(Math.abs(Number(duration.stdout)-1)<.02);
  await page.locator('#reveal').click();await page.locator('#progress').waitFor({state:'hidden'});
  await page.screenshot({path:join(root,'build/ui-checks/extract.png'),fullPage:true});
  await page.locator('#navImport').click();await page.screenshot({path:join(root,'build/ui-checks/import.png'),fullPage:true});
  const screen=join(work,'screen.png'),screenVideo=join(work,'screen.mp4');
  assert.equal(spawnSync('swift',[join(root,'scripts/ocr-fixture.swift'),screen]).status,0);
  assert.equal(spawnSync(ffmpeg,['-v','error','-loop','1','-i',screen,'-t','3','-r','10','-c:v','mpeg4','-pix_fmt','yuv420p',screenVideo]).status,0);
  importMedia=screenVideo;
  await page.locator('#importLocal').click();await page.locator('#assetContent').waitFor({state:'visible'});
  await page.locator('#transcript').click();await page.locator('#contentPanel .transcript-row').first().waitFor();
  await page.locator('#ocrInterval').fill('1');await page.locator('#ocr').click();
  await page.locator('#noticeText').getByText('OCR 文字已保存；时间轴为采样估计。',{exact:true}).waitFor({timeout:60000});
  assert.equal(await page.locator('#textSource').inputValue(),'ocr');
  assert.match(await page.locator('#contentPanel').innerText(),/LinkParsing/);
  assert.match(await page.locator('#contentPanel').innerText(),/本地/);
  assert.equal(await page.locator('#framesOn').isDisabled(),true);
  await page.locator('#textSource').selectOption('speech');
  await page.locator('#tabText').click();await page.locator('#contentPanel').getByText('第一段真实测试文字',{exact:true}).waitFor();
  await page.locator('#textSource').selectOption('ocr');
  await page.locator('#contentPanel').getByText(/LinkParsing/).waitFor();
  await page.locator('#textFormat').selectOption('txt');await page.locator('#export').click();
  assert.match(await page.locator('#exportSource').innerText(),/OCR/);
  await page.locator('#confirmExport').click();await page.locator('#reportTitle').getByText('导出完成',{exact:true}).waitFor();
  assert.match(readFileSync(lastReport.outputs[0].files[0],'utf8'),/LinkParsing/);
  await page.screenshot({path:join(root,'build/ui-checks/ocr.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(outputError,'');
  console.log('PASS: empty/long input, clear/focus, download shortcut, keyboard switches/tabs, responsive layout (1200/860/600), empty-state navigation, back, DNS retry/preferences, navigation during task, cancellation, real import/transcript/analysis/export, dialog close/Escape/focus, XSS-safe text, 1-second WAV; real bilingual OCR, empty-frame failure, speech/OCR isolation and OCR text export.'+(realAsr?' Real ASR button, native progress events, spoken content and text selection also passed.':''));
}finally{
  if(browser)await browser.close();
  if(server)server.close();
  if(worker){worker.stdin.end();await new Promise(done=>worker.once('exit',done));}
  rmSync(work,{recursive:true,force:true});
}
