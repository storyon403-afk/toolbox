const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const C = require('../src/core.js'); require('../src/seed.js');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.FORMA_BROWSER_PATH ? { executablePath: process.env.FORMA_BROWSER_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = { version: 2, title: '边界验证', tokens: [{ id: 'token', name: '品牌', value: '#aabbcc' }], components: [], boards: [
    { id: 'board-a', name: 'A', x: 0, y: 0, w: 720, h: 510, bg: '#ffffff', elements: [C.make('rect', 100, 100, 100, 100, { id: 'rect-a', name: '矩形 A', fillToken: 'token' }), C.make('rect', 300, 100, 100, 100, { id: 'rect-b', name: '矩形 B', fillToken: 'token' })] },
    { id: 'board-b', name: 'B', x: 850, y: 0, w: 390, h: 844, bg: '#ffffff', elements: [] }
  ] };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('forma-design-canvas-v2')));
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.locator('#jsonInput').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(base)) });
    await page.locator('#boardList .board-item').first().click();
    const rect = await page.locator('#world [data-id="rect-a"]').boundingBox(); const scale = rect.width / 100;
    await page.mouse.move(rect.x - 30 * scale, rect.y - 30 * scale); await page.mouse.down(); await page.mouse.move(rect.x + 330 * scale, rect.y + 130 * scale, { steps: 10 }); await page.mouse.up();
    assert.equal(await page.locator('#world .element.selected').count(), 2); console.log('PASS marquee selects intersecting layers');
    await page.locator('#assetsTab').click(); await page.getByLabel('品牌', { exact: true }).fill('#112233'); await page.getByLabel('品牌', { exact: true }).dispatchEvent('change');
    assert.equal((await saved()).tokens[0].value, '#112233'); assert.equal(await page.locator('#world [data-id="rect-a"]').evaluate(n => n.style.background), 'rgb(17, 34, 51)'); console.log('PASS color variables update all bound layers');
    await page.locator('[data-mode="prototype"]').click(); await page.getByLabel('点击后跳转到').selectOption('board-b');
    assert.ok((await saved()).boards[0].elements.every(e => e.link === 'board-b'));
    await page.locator('#previewBtn').click(); await page.locator('#previewBody .prototype-hotspot').first().click(); assert.equal(await page.locator('#previewTitle').innerText(), 'B'); await page.locator('#preview [data-close]').click(); console.log('PASS user-created prototype links navigate');
    // Import a small image and check the SVG uses actual clipping rather than a decorative radius.
    await page.locator('[data-mode="design"]').click();
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 60; c.height = 60; const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 60, 60); return c.toDataURL().split(',')[1]; });
    await page.locator('#imageInput').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.querySelector('#world .image.selected'));
    await page.getByRole('spinbutton', { name: '圆角', exact: true }).fill('30'); await page.locator('[data-mode="design"]').click();
    const exported = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('forma-design-canvas-v2')); const b = d.boards[0]; return FormaCore.svg({ ...b, elements: [b.elements.at(-1)] }, d); });
    assert.match(exported, /clip-path="url\(#image-clip-0\)"/);
    const pixels = await page.evaluate(async svg => { const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); const i = new Image(); i.src = url; await i.decode(); const c = document.createElement('canvas'); c.width = 720; c.height = 510; const ctx = c.getContext('2d'); ctx.drawImage(i, 0, 0); const corner = [...ctx.getImageData(40, 40, 1, 1).data], center = [...ctx.getImageData(70, 70, 1, 1).data]; URL.revokeObjectURL(url); return { corner, center }; }, exported);
    assert.deepEqual(pixels.corner, [255, 255, 255, 255]); assert.deepEqual(pixels.center, [255, 0, 0, 255]); console.log('PASS image import and rounded SVG pixels');
    const wrap = C.wrapText('Design tools\n你好世界', 7, s => [...s].length); assert.deepEqual(wrap, ['Design ', 'tools', '你好世界']); console.log('PASS explicit and width-based export text wrapping');
    // Legacy v1 documents remain intact when loading on startup.
    const legacy = FormaSeeds.seed(); legacy.version = 1; delete legacy.tokens; delete legacy.components; legacy.boards.forEach(b => b.elements.forEach(e => { delete e.fillToken; delete e.componentId; delete e.groupId; }));
    const old = await browser.newPage(); await old.addInitScript(d => localStorage.setItem('forma-design-canvas-v1', JSON.stringify(d)), legacy); await old.goto('http://127.0.0.1:5173'); assert.equal(await old.locator('.board').count(), 3); await old.locator('#addText').click(); assert.equal(await old.evaluate(() => JSON.parse(localStorage.getItem('forma-design-canvas-v2')).version), 2); assert.equal(await old.evaluate(() => JSON.parse(localStorage.getItem('forma-design-canvas-v1')).version), 1); await old.close(); console.log('PASS legacy startup migration preserves original storage');
    const full = await browser.newPage(); await full.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; }); await full.goto('http://127.0.0.1:5173'); await full.locator('#addRect').click(); assert.match(await full.locator('#saveState').innerText(), /保存失败/); assert.equal(await full.locator('#world .element.selected').count(), 1); await full.close(); console.log('PASS storage failure leaves document editable and shows backup prompt');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.resolve(__dirname, '../test-results/edge-report.json'), JSON.stringify({ passed: 7, runtimeErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
