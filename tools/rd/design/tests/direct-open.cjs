// Regression: a standalone index.html must work without a server or sibling assets.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pangzhu-direct-'));
let browser;
async function action(page, id) {
  if (!await page.locator('#'+id).isVisible()) await page.locator('#menuToggle').click();
  await page.locator('#'+id).click();
}
(async () => {
  const file = path.join(folder, 'index.html');
  fs.copyFileSync(path.join(root, 'index.html'), file);
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({offline:true, acceptDownloads:true, viewport:{width:805,height:827}});
  const page = await context.newPage(), errors = [], failures = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => failures.push(r.url()));
  await page.goto(pathToFileURL(file).href);
  await page.locator('.article-title').waitFor();
  assert.equal(await page.locator('body').getAttribute('data-connection'), 'offline');
  assert.equal(await page.locator('#menuToggle').evaluate(e => getComputedStyle(e).position), 'fixed');
  await action(page, 'editMode');
  await page.locator('[data-block="title"]').fill('直接打开也能编辑');
  await page.locator('#publishButton').click();
  await page.locator('#formatbar').waitFor({state:'hidden'});
  await page.locator('[data-block="b1"]').evaluate(el => {
    const range = document.createRange();range.setStart(el.firstChild,0);range.setEnd(el.firstChild,2);
    const selected = window.getSelection();selected.removeAllRanges();selected.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  });
  await page.locator('#selectionButton').click();
  await page.locator('#noteInput').fill('离线建议也可以确认。');
  await page.locator('#saveNote').click();
  await page.locator('#noteWindow[data-view="read"]').waitFor();
  await page.reload();await page.locator('.article-title').waitFor();
  assert.equal(await page.locator('.article-title').textContent(), '直接打开也能编辑');
  assert.equal(await page.locator('.annotation-dot').count(), 1);
  await page.locator('.annotation-dot').click();
  assert.equal(await page.locator('.review-body').textContent(), '离线建议也可以确认。');
  await page.screenshot({path:path.join(root,'previews/direct-open.png')});
  await page.keyboard.press('Escape');await action(page,'documentToggle');
  const download = page.waitForEvent('download');await page.locator('#exportButton').click();
  const copy = path.join(folder,'export.html');await (await download).saveAs(copy);
  const exported = await context.newPage();exported.on('pageerror', e=>errors.push(e.message));
  await exported.goto(pathToFileURL(copy).href);await exported.locator('.article-title').waitFor();
  assert.equal(await exported.locator('.article-title').textContent(), '直接打开也能编辑');
  assert.equal(await exported.locator('.annotation-dot').count(), 1);
  assert.deepEqual(errors, []);assert.deepEqual(failures, []);
  console.log('PASS: standalone file opens offline, styles load, editing and suggestions persist, exported copy reopens.');
})().catch(error => {console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  fs.rmSync(folder,{recursive:true,force:true});
});
