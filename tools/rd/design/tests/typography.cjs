const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'pangzhu-type-'));
let browser;
async function action(page,id){if(!await page.locator('#'+id).isVisible())await page.locator('#menuToggle').click();await page.locator('#'+id).click();}
async function slider(page,id,value){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).dispatchEvent('input');}
(async()=>{
  const file=path.join(folder,'index.html');fs.copyFileSync(path.join(root,'index.html'),file);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:615,height:724}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(file).href);await page.locator('.article-title').waitFor();
  const text=await page.locator('[data-block="b1"]').textContent();
  await action(page,'appearanceToggle');
  for(const width of [615,390]){
    await page.setViewportSize({width,height:724});
    const measures=[];
    for(const value of [60,80,100]){await slider(page,'readingWidth',value);measures.push((await page.locator('#article').boundingBox()).width);}
    assert.ok(measures[1]-measures[0]>60&&measures[2]-measures[1]>60,JSON.stringify(measures));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.setViewportSize({width:615,height:724});
  await slider(page,'readingSize',14);
  assert.equal(await page.locator('[data-block="b1"]').evaluate(e=>getComputedStyle(e).fontSize),'14px');
  await slider(page,'readingLineHeight',1.5);await slider(page,'paragraphGap',12);
  const style=await page.locator('[data-block="b1"]').evaluate(e=>({line:getComputedStyle(e).lineHeight,gap:getComputedStyle(e).marginBottom}));
  assert.equal(style.line,'21px');assert.equal(style.gap,'12px');
  await slider(page,'readingSize',22);
  assert.equal(await page.locator('[data-block="b1"]').evaluate(e=>getComputedStyle(e).fontSize),'22px');
  await slider(page,'readingSize',16);await slider(page,'readingWidth',90);
  await page.screenshot({path:path.join(root,'previews/typography-controls.png')});
  await page.locator('[data-layout="a4"]').click();
  const contentWidths=[];
  for(const value of [60,100]){await slider(page,'readingWidth',value);contentWidths.push((await page.locator('.paper-content').first().boundingBox()).width);}
  assert.ok(contentWidths[1]-contentWidths[0]>100);
  await slider(page,'readingSize',12);const small=await page.locator('.paper-page').count();
  await slider(page,'readingSize',26);assert.ok(await page.locator('.paper-page').count()>small);
  assert.equal(await page.locator('[data-block="b1"]').evaluateAll(els=>els.map(e=>e.textContent).join('')),text);
  await slider(page,'readingSize',16);await page.reload();await page.locator('.paper-page').first().waitFor();
  assert.equal(await page.locator('[data-block="b1"]').first().evaluate(e=>getComputedStyle(e).fontSize),'16px');
  await action(page,'editMode');
  assert.equal(await page.locator('[data-block="b1"]').evaluate(e=>getComputedStyle(e).fontSize),'18px');
  await page.setViewportSize({width:390,height:724});await page.locator('[data-block="b1"]').click();await page.locator('#fontSize').fill('24');await page.locator('#fontSize').press('Enter');
  assert.equal(await page.locator('[data-block="b1"]').evaluate(e=>getComputedStyle(e).fontSize),'24px');
  assert.deepEqual(errors,[]);
  console.log('PASS: width visibly changes at 615/390px, font size/spacing update, A4 repaginates, preferences persist, source typography stays editable.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();fs.rmSync(folder,{recursive:true,force:true});});
