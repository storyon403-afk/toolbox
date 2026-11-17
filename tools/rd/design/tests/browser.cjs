// Run with a Node environment containing Playwright. Uses an isolated SQLite DB.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const data = fs.mkdtempSync(path.join(os.tmpdir(),'pangzhu-test-'));
let port, origin;
let server, browser;
async function startServer(){
  port ??= await require('./port.cjs').availablePort();origin=`http://127.0.0.1:${port}`;
  server=spawn(process.env.PANGZHU_SERVER || path.join(root,'..','bin',process.platform==='win32'?'pangzhu.exe':'pangzhu'),['--port',String(port),'--data-dir',data]);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timeout')),5000);
    server.stdout.once('data',()=>{clearTimeout(timer);resolve();});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exit '+code));});
  });
}
async function select(page,id,start=0,end=12){
  await page.locator(`[data-block="${id}"]`).evaluate((el,{start,end})=>{
    const range=document.createRange();range.setStart(el.firstChild,start);range.setEnd(el.firstChild,end);
    const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  },{start,end});
  await page.locator('#selectionButton').waitFor({state:'visible'});
  await page.locator('#selectionButton').click();
}
async function action(page,id){
  if(!(await page.locator('#'+id).isVisible()))await page.locator('#menuToggle').click();
  await page.locator('#'+id).click();
}
async function suggest(page,body){
  await select(page,'b1',0,38);
  await page.locator('#noteInput').fill(body);await page.locator('#saveNote').click();
  await page.locator('#noteWindow[data-view="read"]').waitFor({state:'visible'});
}
async function waitCount(page,count){await page.waitForFunction(n=>document.getElementById('commitCount').textContent===String(n),count);}
(async()=>{
  await startServer();browser=await chromium.launch({headless:true});
  const a=await browser.newContext({viewport:{width:805,height:827},acceptDownloads:true});
  const r=await browser.newContext({viewport:{width:615,height:724}});
  const s=await browser.newContext({viewport:{width:805,height:827}});
  const author=await a.newPage(),reviewer=await r.newPage(),other=await s.newPage(),errors=[];
  for(const page of [author,reviewer,other])page.on('pageerror',e=>errors.push(e.message));
  await author.goto(origin);await author.locator('.article-title').waitFor();
  await reviewer.goto(origin+'/review');await reviewer.locator('.article-title').waitFor();
  await other.goto(origin+'/review');await other.locator('.article-title').waitFor();
  assert.equal(await author.locator('#documentPanel').isVisible(),false);
  assert.equal(await author.locator('#historyPanel').isVisible(),false);
  assert.equal(await author.locator('svg,.brand-icon').count(),0);
  assert.equal(await author.locator('.appbar').count(),0);
  assert.equal(await author.locator('#appMenu').isVisible(),false);
  assert.equal(await reviewer.locator('#editMode').isVisible(),false);
  assert.equal(await reviewer.locator('#commitWindow,#reviewerName,#commitMessage').count(),0);
  await author.screenshot({path:path.join(root,'previews/simple-reading.png')});
  // A shared link stays read-only even in the author's authenticated browser.
  await action(author,'shareButton');
  assert.equal(await author.locator('#shareUrl').inputValue(),origin+'/review');
  await author.keyboard.press('Escape');
  const shared=await a.newPage();await shared.goto(origin+'/review');await shared.locator('.article-title').waitFor();
  await shared.locator('#menuToggle').click();assert.equal(await shared.locator('#editMode').isVisible(),false);
  assert.equal((await a.request.post(origin+'/review/api/publish',{data:{}})).status(),403);
  assert.equal((await (await a.request.get(origin+'/review/api/state')).json()).isOwner,false);
  await shared.close();
  for(const [button,panel] of [['documentToggle','documentPanel'],['historyToggle','historyPanel']]){
    await action(author,button);assert.equal(await author.locator('#'+panel).isVisible(),true);
    await action(author,button);assert.equal(await author.locator('#'+panel).isVisible(),false);
  }
  await action(author,'editMode');await author.locator('[data-block="title"]').fill('留一点空白');
  await author.locator('[data-block="b1"]').fill('清晨 🌿 把手机留在桌上，出门走一小段路。街角的树换了颜色，面包店刚刚开门。');
  await author.locator('#fontSize').fill('20');await author.locator('#fontSize').press('Enter');
  assert.equal(await author.locator('[data-block="b1"]').evaluate(e=>getComputedStyle(e).fontSize),'20px');
  await author.locator('[data-block="b2"]').click();await author.locator('#blockType').selectOption('p');
  assert.equal(await author.locator('[data-block="b2"]').evaluate(e=>e.tagName),'P');
  await author.locator('#blockType').selectOption('h2');
  assert.equal(await author.locator('[data-block="b2"]').evaluate(e=>e.tagName),'H2');
  const blockCount=await author.locator('[data-block]').count();
  await author.locator('[data-block="b2"]').dispatchEvent('keydown',{key:'Enter',isComposing:true});
  assert.equal(await author.locator('[data-block]').count(),blockCount); // Chinese IME confirmation must not split blocks
  await author.locator('#addBlock').click();
  assert.equal(await author.locator('[data-block]').count(),blockCount+1);
  await author.locator('[contenteditable]:focus').press('Backspace');
  assert.equal(await author.locator('[data-block]').count(),blockCount);
  await author.locator('#publishButton').click();await author.locator('#formatbar').waitFor({state:'hidden'});
  await reviewer.waitForFunction(()=>document.getElementById('versionLabel').textContent==='v2');
  await other.waitForFunction(()=>document.getElementById('versionLabel').textContent==='v2');
  assert.match(await reviewer.locator('[data-block="b1"]').textContent(),/🌿/);
  const unauthorized=await r.request.post(origin+'/api/publish',{data:{}});assert.equal(unauthorized.status(),403);
  await select(reviewer,'b1',0,38);
  assert.equal(await reviewer.locator('#noteTitle').count(),0);
  assert.equal(await reviewer.locator('#saveNote').textContent(),'✓');
  assert.equal(await reviewer.locator('#noteContents blockquote').count(),0);
  assert.ok(await reviewer.locator('.brush-stroke').count()>=2);
  assert.ok((await reviewer.locator('#noteInput').boundingBox()).height<=40);
  const before=await reviewer.locator('#noteWindow').boundingBox();
  const glass=await reviewer.locator('#noteWindow').evaluate(e=>({background:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));
  assert.notEqual(glass.blur,'none');assert.ok(glass.background.includes('0.63'));
  const handle=await reviewer.locator('#noteWindow .window-head').boundingBox();
  await reviewer.mouse.move(handle.x+80,handle.y+20);await reviewer.mouse.down();await reviewer.mouse.move(handle.x+180,handle.y+85,{steps:8});await reviewer.mouse.up();
  const after=await reviewer.locator('#noteWindow').boundingBox();assert.ok(after.x-before.x>80);assert.ok(after.y-before.y>50);
  await reviewer.locator('#noteInput').fill('这里可以补充一句散步时观察到的细节，让开头更具体。');
  assert.ok((await reviewer.locator('#noteWindow').boundingBox()).width>before.width);
  assert.equal(await author.locator('.annotation-dot').count(),0); // typing does not submit
  await reviewer.screenshot({path:path.join(root,'previews/suggestion-input.png')});
  // The server receives the suggestion but the response is lost. A reload and
  // one-click retry must reuse the request identity, not create a duplicate.
  await reviewer.route('**/api/commits',async route=>{await route.fetch();await route.abort();});
  await reviewer.locator('#saveNote').click();await reviewer.locator('#noteError').waitFor({state:'visible'});
  assert.match(await reviewer.locator('#noteInput').inputValue(),/让开头更具体/);
  await reviewer.unroute('**/api/commits');
  await reviewer.reload();await reviewer.locator('#stagingBar').waitFor({state:'visible'});
  await reviewer.locator('#openCommit').click();
  await reviewer.locator('#noteWindow[data-view="read"]').waitFor({state:'visible'});
  await waitCount(author,1);await waitCount(other,1);
  assert.equal(await reviewer.locator('#noteContents .suggestion-status,#noteContents .note-author,#noteContents .meta,#noteContents .review-actions').count(),0);
  assert.match(await reviewer.locator('.review-body').textContent(),/让开头更具体/);
  assert.equal(await reviewer.locator('#stagingBar').isVisible(),false);
  await reviewer.screenshot({path:path.join(root,'previews/suggestion-confirmed.png')});
  await reviewer.keyboard.press('Escape');
  await reviewer.locator('.annotation-dot').click();
  assert.equal(await reviewer.locator('.annotation-dot').getAttribute('aria-expanded'),'true');
  assert.match(await reviewer.locator('.review-body').textContent(),/让开头更具体/);
  assert.equal(await reviewer.locator('#noteContents blockquote').count(),0);
  // Check the superscript marker against the actual end of the wrapped range.
  const alignment=await reviewer.locator('[data-block="b1"]').evaluate(el=>{
    const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,38);
    const last=[...r.getClientRects()].at(-1),dot=el.parentElement.querySelector('.annotation-dot').getBoundingClientRect();
    return{dx:dot.x+dot.width/2-last.right,dy:dot.y+dot.height/2-last.top};
  });
  assert.ok(Math.abs(alignment.dx-5)<2);assert.ok(Math.abs(alignment.dy+3)<2);
  assert.equal(await author.locator('.annotation-dot').count(),1);
  await author.locator('.annotation-dot').click();
  assert.match(await author.locator('.review-body').textContent(),/让开头更具体/);
  assert.equal(await author.locator('#noteContents').innerText(),await author.locator('.review-body').innerText());
  await author.keyboard.press('Escape');await action(author,'historyToggle');
  await author.locator('[data-resolve]').click();
  await reviewer.waitForFunction(()=>document.querySelector('.annotation-dot')?.classList.contains('resolved'));
  await author.keyboard.press('Escape');await reviewer.keyboard.press('Escape');
  await action(author,'editMode');await author.locator('[data-block="b3"]').fill('这是一段尚未发布的修改。');
  await suggest(other,'我也想保留这段。');await waitCount(author,2);
  await waitCount(reviewer,2);
  assert.equal(await reviewer.locator('.annotation-dot').count(),2);
  const markers=await reviewer.locator('.annotation-dot').evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,color:e.style.getPropertyValue('--note-color')})));
  assert.notEqual(markers[0].color,markers[1].color);
  assert.ok(Math.abs(markers[0].x-markers[1].x)>=17||Math.abs(markers[0].y-markers[1].y)>=17);
  await reviewer.locator('.annotation-dot').nth(0).click();
  const firstTone=await reviewer.locator('.brush-stroke').first().evaluate(e=>e.style.getPropertyValue('--note-color'));
  await reviewer.locator('.annotation-dot').nth(1).click();
  const secondTone=await reviewer.locator('.brush-stroke').first().evaluate(e=>e.style.getPropertyValue('--note-color'));
  assert.notEqual(firstTone,secondTone);
  await reviewer.screenshot({path:path.join(root,'previews/artistic-suggestion.png')});
  await reviewer.setViewportSize({width:390,height:844});
  await reviewer.waitForTimeout(100);
  assert.ok(await reviewer.locator('.brush-stroke').count()>=2);
  assert.equal(await reviewer.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await reviewer.setViewportSize({width:615,height:724});await reviewer.keyboard.press('Escape');
  assert.equal(await author.locator('[data-block="b3"]').textContent(),'这是一段尚未发布的修改。'); // SSE must not erase drafts
  await author.screenshot({path:path.join(root,'previews/simple-editing.png')});
  await author.locator('#publishButton').click();await author.locator('#formatbar').waitFor({state:'hidden'});
  await reviewer.waitForFunction(()=>document.getElementById('versionLabel').textContent==='v3');
  assert.equal(await reviewer.locator('.annotation-dot').count(),0); // old anchors stay on v2
  await action(author,'historyToggle');await author.locator('[data-show-note]').first().click();
  assert.equal(await author.locator('#versionLabel').textContent(),'v2');
  await author.keyboard.press('Escape');await author.locator('#latestVersion').click();
  const publicState=await (await a.request.get(origin+'/review/api/state')).json();
  assert.equal(publicState.versions.length,1);assert.equal(publicState.versions[0].version,3);assert.equal(publicState.commits.length,0);
  await reviewer.locator('#menuToggle').click();assert.equal(await reviewer.locator('#documentToggle').isVisible(),false);
  assert.equal(await reviewer.locator('#versionList').textContent(),'');assert.equal(await reviewer.locator('#connection').count(),0);
  await reviewer.keyboard.press('Escape');
  assert.equal(await reviewer.locator('#versionLabel').textContent(),'v3');
  const saved=await (await a.request.get(origin+'/api/state')).json();
  assert.equal(saved.versions.length,3);assert.equal(saved.commits.length,2);
  assert.equal(saved.commits[0].parentId,saved.commits[1].id);
  assert.equal(saved.commits[1].notes[0].resolved,true);
  // A stale article draft is rejected rather than overwriting a newer version.
  const stale=await a.request.post(origin+'/api/publish',{data:{baseVersion:1,...saved.versions[0]}});
  assert.equal(stale.status(),409);
  // Double submission with the same request key returns the existing commit.
  const note={...saved.commits[0].notes[0],version:saved.versions[0].version};
  const payload={requestKey:'test-idempotency',basedOn:saved.commits[0].id,author:'测试',message:'幂等校验',notes:[note]};
  const one=await (await r.request.post(origin+'/api/commits',{data:payload})).json();
  const two=await (await r.request.post(origin+'/api/commits',{data:payload})).json();assert.equal(one.id,two.id);
  await waitCount(author,3);
  await action(author,'editMode');
  await author.locator('[data-block="b4"]').fill('导出时保留的本地草稿。');
  await action(author,'documentToggle');
  const dl=author.waitForEvent('download');await author.locator('#exportButton').click();
  const file=path.join(data,'copy.html');await (await dl).saveAs(file);
  const offline=await a.newPage();offline.on('pageerror',e=>errors.push(e.message));await offline.goto('file://'+file);
  await offline.locator('.article-title').waitFor();assert.equal(await offline.locator('body').getAttribute('data-connection'),'offline');
  assert.equal(await offline.locator('#formatbar').isVisible(),false);
  await action(offline,'editMode');assert.equal(await offline.locator('[data-block="b4"]').textContent(),'导出时保留的本地草稿。');
  await author.setViewportSize({width:390,height:844});await action(author,'readMode');await author.keyboard.press('Escape');
  assert.equal(await author.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await author.screenshot({path:path.join(root,'previews/simple-mobile.png')});
  // Durable data survives a server restart, and clients reconnect.
  await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM');});
  await startServer();await reviewer.waitForFunction(()=>document.body.dataset.connection==='connected');
  const restored=await (await a.request.get(origin+'/api/state')).json();assert.equal(restored.versions.length,3);assert.equal(restored.commits.length,3);
  assert.deepEqual(errors,[]);
  console.log('PASS: compact suggestion composer; no name/message form; confirm-and-expand; lost-response reload retry without duplicates; close/reopen dot; draggable window; SSE across 3 sessions; suggestion resolution; 615/390px layout; editing; version isolation; conflict rejection; offline export; SQLite persistence.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.kill('SIGTERM');});
