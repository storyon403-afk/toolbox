const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'pangzhu-pages-'));
let browser;
async function action(page,id){if(!await page.locator('#'+id).isVisible())await page.locator('#menuToggle').click();await page.locator('#'+id).click();}
async function verifyPages(page,source){
  assert.equal(await page.locator('[data-block="b1"]').evaluateAll(els=>els.map(e=>e.textContent).join('')),source);
  const measurements=await page.locator('.paper-page').evaluateAll(pages=>pages.filter(p=>!p.hidden).map(p=>{
    const box=p.getBoundingClientRect(),content=p.querySelector('.paper-content').getBoundingClientRect();
    return {ratio:box.height/box.width,overflow:[...p.querySelectorAll('[data-block]')].some(el=>el.getBoundingClientRect().bottom>content.bottom+1)};
  }));
  assert.ok(measurements.every(m=>Math.abs(m.ratio-297/210)<.01&&!m.overflow),JSON.stringify(measurements));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}
(async()=>{
  fs.copyFileSync(path.join(root,'index.html'),path.join(folder,'index.html'));
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:805,height:827}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(folder,'index.html')).href);await page.locator('.article-title').waitFor();
  await action(page,'editMode');
  const source='清晨 🌿 把手机留在桌上，出门走一小段路。没有目的地，也不急着记录。街角的树换了颜色，阳光落在长椅上。\n'.repeat(35).trimEnd();
  await page.locator('[data-block="b1"]').fill(source);
  await page.locator('#publishButton').click();await page.locator('#formatbar').waitFor({state:'hidden'});
  await action(page,'appearanceToggle');await page.locator('[data-layout="a4"]').click();
  assert.ok(await page.locator('.paper-page').count()>3);
  await page.keyboard.press('Escape');await verifyPages(page,source);
  // A selection crossing a paper boundary retains original UTF-16 offsets.
  const anchor=await page.locator('[data-block="b1"]').evaluateAll(els=>{
    const a=els[0],b=els[1],start=a.textContent.length-8,end=Number(b.dataset.start)+18;
    const range=document.createRange();range.setStart(a.firstChild,start);range.setEnd(b.firstChild,18);
    const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);
    b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return {start,end};
  });
  await page.locator('#selectionButton').click();
  assert.equal(await page.locator('#noteTitle').count(),0);
  await page.locator('#noteInput').fill('这段文字跨页，建议仍跟随原文。');
  await page.locator('#saveNote').click();await page.locator('#noteWindow[data-view="read"]').waitFor();
  const note=await page.evaluate(()=>JSON.parse(localStorage.getItem('pangzhu-v2:'+location.pathname+':snapshot')).commits[0].notes[0]);
  assert.equal(note.start,anchor.start);assert.equal(note.end,anchor.end);assert.equal(note.quote,source.slice(anchor.start,anchor.end));
  assert.equal(await page.locator('.annotation-dot').count(),1);
  await page.keyboard.press('Escape');await action(page,'appearanceToggle');await page.locator('[data-direction="horizontal"]').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('.paper-page:visible').count(),1);
  assert.equal(await page.locator('#previousPage').isEnabled(),false);
  await page.locator('#nextPage').click();assert.match(await page.locator('#pageCounter').textContent(),/^2 \/ /);
  await action(page,'historyToggle');await page.locator('[data-show-note]').first().click();assert.ok(await page.locator('.brush-stroke').count()>0);
  const currentPage=Number((await page.locator('#pageCounter').textContent()).split('/')[0]);
  assert.ok(await page.locator('.annotation-dot').isVisible());
  await verifyPages(page,source);
  await page.screenshot({path:path.join(root,'previews/a4-horizontal.png')});
  await page.keyboard.press('Escape');await page.locator('#nextPage').click();
  assert.equal(Number((await page.locator('#pageCounter').textContent()).split('/')[0]),currentPage+1);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);await verifyPages(page,source);
  await action(page,'appearanceToggle');await page.locator('[data-direction="vertical"]').click();await page.keyboard.press('Escape');
  assert.ok(await page.locator('.paper-page:visible').count()>3);assert.equal(await page.locator('#pageControls').isVisible(),false);
  await verifyPages(page,source);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(root,'previews/a4-mobile.png')});
  await page.reload();await page.locator('.paper-page').first().waitFor();await verifyPages(page,source);
  await action(page,'editMode');assert.equal(await page.locator('.paper-page').count(),0);assert.equal(await page.locator('[data-block="b1"]').textContent(),source);
  assert.deepEqual(errors,[]);
  console.log('PASS: A4 ratio, paragraph splitting without text loss, cross-page anchors, horizontal/vertical modes, resizing, persistence, editing.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();fs.rmSync(folder,{recursive:true,force:true});});
