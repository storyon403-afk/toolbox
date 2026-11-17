// Verify Quick Tunnel polling and fallback when an SSE-capable proxy drops events.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
let browser,server;
async function action(page,id){if(!await page.locator('#'+id).isVisible())await page.locator('#menuToggle').click();await page.locator('#'+id).click()}
async function stop(){if(server&&!server.killed){const child=server;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')});}server=null;}
(async()=>{
 browser=await chromium.launch({headless:true});
 for(const mode of ['poll','fallback']){
  const port=await require('./port.cjs').availablePort(),origin=`http://127.0.0.1:${port}`,data=fs.mkdtempSync(path.join(os.tmpdir(),'pangzhu-sync-'));
  const publicOrigin=mode==='poll'?'https://fixture-sharing.trycloudflare.com':'https://review.example.com';
  server=spawn(process.env.PANGZHU_SERVER||path.join(root,'..','bin',process.platform==='win32'?'pangzhu.exe':'pangzhu'),['--port',String(port),'--data-dir',data,'--public-url',publicOrigin]);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve()});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code))});});
  const authorContext=await browser.newContext({viewport:{width:900,height:760}}),reviewContext=await browser.newContext();
  let eventRequests=0;const errors=[];
  for(const context of [authorContext,reviewContext]){
   await context.route('**/api/events',route=>{eventRequests++;return route.abort()});
  }
  const author=await authorContext.newPage(),reviewer=await reviewContext.newPage();
  for(const p of [author,reviewer])p.on('pageerror',e=>errors.push(e.message));
  await author.goto(origin+'/?share=1');await author.locator('#shareWindow').waitFor();
  assert.equal(await author.locator('#shareUrl').inputValue(),publicOrigin+'/review');
  if(mode==='poll'){
   assert.match(await author.locator('#shareScope').textContent(),/临时分享/);
   await author.screenshot({path:path.join(root,'previews/quick-share-desktop.png')});
   await author.setViewportSize({width:390,height:844});
   assert.equal(await author.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await author.screenshot({path:path.join(root,'previews/quick-share-mobile.png')});
  }
  await author.keyboard.press('Escape');
  await reviewer.goto(origin+'/review');await reviewer.locator('.article-title').waitFor();
  await action(author,'editMode');await author.locator('[data-block=title]').fill('Polling publication');await author.locator('#publishButton').click();
  await reviewer.waitForFunction(()=>document.getElementById('versionLabel').textContent==='v2',null,{timeout:12000});
  await action(author,'editMode');await author.locator('[data-block=b3]').fill('Unpublished draft survives polling');
  await reviewer.locator('[data-block=b1]').evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,5);const s=getSelection();s.removeAllRanges();s.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});
  await reviewer.locator('#selectionButton').click();await reviewer.locator('#noteInput').fill('Feedback through polling');await reviewer.locator('#saveNote').click();
  await author.waitForFunction(()=>document.getElementById('commitCount').textContent==='1',null,{timeout:12000});
  assert.equal(await author.locator('[data-block=b3]').textContent(),'Unpublished draft survives polling');
  assert.equal((await reviewContext.request.post(origin+'/review/api/publish',{data:{}})).status(),403);
  if(mode==='poll')assert.equal(eventRequests,0);else assert.ok(eventRequests>0);
  assert.deepEqual(errors,[]);
  await authorContext.close();await reviewContext.close();await stop();
 }
 console.log('PASS: Quick Tunnel skips SSE; bounded polling syncs publications and feedback; drafts survive; failed SSE falls back; local share link opens automatically.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();await stop()});
