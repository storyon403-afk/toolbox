// Verify visible source text and the suggestion never intersect, including docking.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
let browser;
async function action(page,id){if(!await page.locator('#'+id).isVisible())await page.locator('#menuToggle').click();await page.locator('#'+id).click();}
async function select(page,id,start,end){
 // Let resize and programmatic-scroll events settle before creating a fresh selection.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.locator(`[data-block="${id}"]`).first().evaluate((el,{start,end})=>{
  const r=document.createRange();r.setStart(el.firstChild,start);r.setEnd(el.firstChild,end);
  const s=getSelection();s.removeAllRanges();s.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 },{start,end});
 await page.locator('#selectionButton').click();await page.locator('#noteInput').waitFor();
}
async function verify(page){
 await page.waitForTimeout(100);
 const geometry=await page.evaluate(()=>{
  const p=document.getElementById('noteWindow').getBoundingClientRect();
  const main=document.getElementById('main').getBoundingClientRect();
  const dock=document.body.classList.contains('note-docked');
  const v=visualViewport;const top=v.offsetTop,bottom=top+v.height;
  const strokes=[...document.querySelectorAll('.brush-stroke')].map(e=>e.getBoundingClientRect()).map(r=>({left:r.left,right:r.right,top:Math.max(r.top,top,dock?main.top:-Infinity),bottom:Math.min(r.bottom,bottom,dock?main.bottom:Infinity)})).filter(r=>r.bottom>r.top);
  return {placement:document.getElementById('noteWindow').dataset.placement,
   overlaps:strokes.filter(r=>r.left<p.right&&r.right>p.left&&r.top<p.bottom&&r.bottom>p.top).length,
   visible:strokes.length,within:p.left>=v.offsetLeft&&p.right<=v.offsetLeft+v.width+1&&p.top>=top&&p.bottom<=bottom+1,
   overflow:document.documentElement.scrollWidth>innerWidth};
 });
 assert.equal(geometry.overlaps,0,JSON.stringify(geometry));assert.equal(geometry.within,true,JSON.stringify(geometry));assert.equal(geometry.overflow,false);
 return geometry;
}
(async()=>{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1100,height:800}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pangzhu-placement-'));
 const file=path.join(folder,'index.html');fs.copyFileSync(path.join(root,'index.html'),file);
 await page.goto(pathToFileURL(file).href);await page.locator('.article-title').waitFor();
 await select(page,'b1',0,38);await verify(page);
 await page.locator('#noteInput').fill('A suggestion that grows with its content. '.repeat(40));await verify(page);
 await page.screenshot({path:path.join(root,'previews/placement-desktop.png')});
 await page.evaluate(()=>window.scrollBy(0,90));await verify(page);
 for(const size of [{width:390,height:844},{width:320,height:568},{width:390,height:320},{width:844,height:390}]){
  await page.setViewportSize(size);await verify(page);
 }
 await page.setViewportSize({width:390,height:844});await page.keyboard.press('Escape');
 await page.evaluate(()=>window.scrollTo(0,0));await select(page,'b1',0,38);
 await page.locator('#noteInput').fill('Keep the source visible.');await verify(page);
 await page.screenshot({path:path.join(root,'previews/placement-mobile.png')});
 await page.locator('#saveNote').click();await page.locator('#noteWindow[data-view=read]').waitFor();await verify(page);
 await page.keyboard.press('Escape');await page.locator('.annotation-dot').click();await verify(page);
 await page.keyboard.press('Escape');await action(page,'appearanceToggle');
 await page.locator('[data-layout=a4]').click();await page.keyboard.press('Escape');
 await select(page,'b1',0,38);await verify(page);await page.keyboard.press('Escape');
 await action(page,'appearanceToggle');await page.locator('[data-direction=horizontal]').click();await page.keyboard.press('Escape');
 await select(page,'b1',0,38);await verify(page);await page.keyboard.press('Escape');
 await action(page,'appearanceToggle');await page.locator('[data-layout=flow]').click();await page.keyboard.press('Escape');
 await action(page,'editMode');
 await page.locator('[data-block=b1]').fill('A long anchored paragraph with several wrapped lines. '.repeat(70));
 await page.locator('#publishButton').click();await page.locator('#formatbar').waitFor({state:'hidden'});
 await page.locator('[data-block=b1]').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY+100));await select(page,'b1',0,1500);
 await page.locator('#noteInput').fill('The long selection stays in a separate scrollable reader.');
 const dock=await verify(page);assert.equal(dock.placement,'docked');assert.ok(dock.visible>0);
 await page.locator('#toast').waitFor({state:'hidden'});
 await page.screenshot({path:path.join(root,'previews/placement-docked.png')});
 // Invoke HTML export while docking remains active; Ctrl+S now saves a .rd file.
 const download=page.waitForEvent('download');await page.locator('#exportButton').evaluate(button=>button.click());
 const copy=path.join(folder,'docked-export.html');await (await download).saveAs(copy);
 const exported=await context.newPage();await exported.goto(pathToFileURL(copy).href);await exported.locator('.article-title').waitFor();
 assert.equal(await exported.locator('body').evaluate(e=>e.classList.contains('note-docked')),false);
 assert.equal(await exported.locator('#main').evaluate(e=>getComputedStyle(e).position),'static');await exported.close();
 await page.locator('#main').evaluate(el=>el.scrollTop+=80);await verify(page);
 await page.setViewportSize({width:390,height:320});await verify(page);
 await page.keyboard.press('Escape');assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('note-docked')),false);
 assert.deepEqual(errors,[]);console.log('PASS: suggestion non-overlap, growth, scrolling, reopen, desktop/mobile/short viewports, long-selection docking and restoration.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close()});
