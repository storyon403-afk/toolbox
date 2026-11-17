const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.FORMA_BROWSER_PATH ? {executablePath:process.env.FORMA_BROWSER_PATH}: {})});
  const page = await browser.newPage({viewport:{width:442,height:757}}); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const out=path.resolve(__dirname,'../test-results'); await fs.mkdir(out,{recursive:true});
  try {
    await page.goto('http://127.0.0.1:5173');
    assert.equal(await page.locator('#leftPanel').isVisible(),false); assert.equal(await page.locator('#rightPanel').isVisible(),false);
    assert.equal(await page.locator('#viewport').evaluate(n=>n.clientWidth),442);
    assert.ok(parseInt(await page.locator('#zoomLabel').innerText())>=50);
    assert.equal(await page.locator('.brand,.canvas-heading,.inspector-note,.left-footer').count(),0);
    for(const id of ['homeBtn','toggleInspector','zoomIn','zoomOut','focusBtn','selectTool','addRect','addText']) {
      const b=await page.locator('#'+id).boundingBox(); assert.ok(b.x>=0&&b.x+b.width<=442&&b.y+b.height<=757,id+' is visible');
    }
    await page.screenshot({path:path.join(out,'glass-narrow.png')});
    console.log('PASS 442px viewport defaults to full-width canvas with accessible controls');
    await page.locator('#toggleInspector').click(); assert.equal(await page.locator('#rightPanel').isVisible(),true);
    assert.equal(await page.locator('#toggleInspector').getAttribute('aria-expanded'),'true');
    await page.screenshot({path:path.join(out,'glass-inspector.png')});
    await page.locator('#collapseInspector').click(); assert.equal(await page.locator('#rightPanel').isVisible(),false);
    await page.locator('#homeBtn').click(); assert.equal(await page.locator('#leftPanel').isVisible(),true);
    await page.locator('#toggleInspector').click(); assert.equal(await page.locator('#leftPanel').isVisible(),false);
    await page.locator('#collapseInspector').click(); await page.reload(); assert.equal(await page.locator('#rightPanel').isVisible(),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('forma-design-canvas-v2')),null);
    console.log('PASS panel toggles, compact mutual exclusion, preferences persist without touching design');
    await page.locator('#zoomLabel').click(); await page.locator('[data-zoom="1"]').click();
    assert.equal(await page.locator('#zoomLabel').innerText(),'100%');
    let b=await page.locator('.board.selected .board-content').boundingBox(); assert.equal(Math.round(b.width),720); assert.ok(Math.abs(b.x+b.width/2-221)<2);
    await page.locator('#zoomIn').click(); assert.equal(await page.locator('#zoomLabel').innerText(),'125%');
    await page.locator('#zoomOut').click(); assert.equal(await page.locator('#zoomLabel').innerText(),'100%');
    await page.locator('#focusBtn').click(); b=await page.locator('.board.selected .board-content').boundingBox(); assert.ok(b.x>=0&&b.x+b.width<=442);
    await page.locator('#zoomLabel').click(); await page.locator('#fitBtn').click();
    const overview=parseInt(await page.locator('#zoomLabel').innerText()); await page.locator('.board.selected .board-label').dblclick(); assert.ok(parseInt(await page.locator('#zoomLabel').innerText())>overview*1.5);
    console.log('PASS explicit 100%, plus/minus, focus and overview double-click zoom');
    await page.setViewportSize({width:1440,height:960});
    await page.locator('#rightPanel').waitFor({state:'visible'}); await page.locator('#focusBtn').click();
    const before=await page.locator('#viewport').evaluate(n=>n.clientWidth);
    await page.locator('#collapseInspector').click(); const after=await page.locator('#viewport').evaluate(n=>n.clientWidth); assert.ok(after>before+200);
    await page.locator('#toggleInspector').click(); await page.locator('#focusBtn').click();
    assert.notEqual(await page.locator('#rightPanel').evaluate(n=>getComputedStyle(n).backdropFilter),'none');
    await page.screenshot({path:path.join(out,'glass-desktop.png')});
    await page.locator('#homeBtn').click(); await page.locator('#collapseInspector').click(); await page.locator('#focusBtn').click();
    await page.screenshot({path:path.join(out,'glass-focus.png')});
    console.log('PASS desktop docking reclaims canvas space and glass surfaces render');
    assert.deepEqual(errors,[]); await fs.writeFile(path.join(out,'workspace-ui-report.json'),JSON.stringify({passed:4,viewport:[442,757],runtimeErrors:errors},null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
