const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const output = path.resolve(__dirname, '../test-results');
const executablePath = process.env.FORMA_BROWSER_PATH;
const results = [];
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', req => requests.push(req.url()));
  const run = async (name, fn) => { await fn(); results.push(name); console.log('PASS', name); };
  const data = () => page.evaluate(() => JSON.parse(localStorage.getItem('forma-design-canvas-v2')));
  const selected = () => page.locator('#world .element.selected').evaluateAll(ns => ns.map(n => n.dataset.id));
  const getElement = async () => { const ids = await selected(), d = await data(); return d.boards.flatMap(b => b.elements).find(e => e.id === ids[0]); };
  const blur = () => page.locator('[data-mode="design"]').click();
  const exportAs = async type => {
    await page.locator('#exportBtn').click(); const promise = page.waitForEvent('download'); await page.locator(`[data-export="${type}"]`).click(); const download = await promise; const file = path.join(output, `export.${type}`); await download.saveAs(file); return file;
  };
  try {
    await page.goto('http://127.0.0.1:5173');
    await run('Initial workbench renders with no network dependencies', async () => { assert.equal(await page.locator('.board').count(), 3); assert.equal(await page.locator('.layer-row').count(), 34); assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:5173'))); await page.screenshot({ path: path.join(output, 'workbench.png') }); });
    await run('Insert, edit, undo and redo', async () => {
      await page.locator('#addRect').click(); assert.equal((await data()).boards[0].elements.length, 35);
      await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('260'); await blur(); assert.equal((await getElement()).w, 260);
      await page.locator('#undo').click(); assert.equal((await data()).boards[0].elements.at(-1).w, 200);
      await page.locator('#redo').click(); assert.equal((await data()).boards[0].elements.at(-1).w, 260);
    });
    await run('Pointer movement and resize are persisted and undoable', async () => {
      const d = await data(), id = d.boards[0].elements.at(-1).id; await page.locator(`[data-layer-id="${id}"]`).click();
      const target = page.locator(`#world [data-id="${id}"]`), box = await target.boundingBox(); const before = await getElement();
      await page.mouse.move(box.x + 12, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 42, { steps: 6 }); await page.mouse.up(); assert.notEqual((await getElement()).x, before.x);
      const handle = await page.locator('[data-handle="se"]').boundingBox(), moved = await getElement();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + 45, handle.y + 30, { steps: 5 }); await page.mouse.up(); assert.ok((await getElement()).w > moved.w);
      await page.locator('#undo').click(); assert.equal((await data()).boards[0].elements.at(-1).w, moved.w);
    });
    await run('Multi-select, align, group and duplicate preserve structure', async () => {
      await page.locator('#addEllipse').click(); let d = await data(); const es = d.boards[0].elements.slice(-2);
      await page.locator(`[data-layer-id="${es[0].id}"]`).click(); await page.locator(`[data-layer-id="${es[1].id}"]`).click({ modifiers: ['Shift'] }); assert.equal((await selected()).length, 2);
      await page.getByRole('button', { name: '左对齐', exact: true }).click(); d = await data(); assert.equal(d.boards[0].elements.at(-1).x, d.boards[0].elements.at(-2).x);
      await page.getByRole('button', { name: '分组', exact: true }).click(); d = await data(); assert.equal(d.boards[0].elements.at(-1).groupId, d.boards[0].elements.at(-2).groupId);
      await page.getByRole('button', { name: '复制', exact: true }).click(); d = await data(); assert.equal(d.boards[0].elements.length, 38); assert.notEqual(d.boards[0].elements.at(-1).groupId, es[0].groupId);
    });
    await run('Components insert and propagate updates to another instance', async () => {
      await page.getByRole('button', { name: '◇ 创建组件', exact: true }).click(); let d = await data(); const c = d.components.at(-1);
      await page.getByRole('button', { name: `插入 ${c.name}`, exact: true }).click();
      await page.getByRole('textbox', { name: '填充颜色 HEX', exact: true }).fill('#123456'); await blur();
      await page.getByRole('button', { name: '更新组件及全部实例', exact: true }).click();
      d = await data(); assert.ok(d.boards[0].elements.filter(e => e.componentId === c.id).every(e => e.fill === '#123456'));
    });
    await run('Text double-click edits actual document, Escape cancels', async () => {
      await page.locator('#addText').click(); const id = (await selected())[0], n = page.locator(`#world [data-id="${id}"]`);
      await n.dblclick(); await page.keyboard.insertText('真实编辑，随时保存'); await page.keyboard.press('Control+Enter'); assert.equal((await getElement()).text, '真实编辑，随时保存');
      await n.dblclick(); await page.keyboard.insertText('不要保存'); await page.keyboard.press('Escape'); assert.equal((await getElement()).text, '真实编辑，随时保存');
    });
    await run('Lock and visibility operate from layers; locked geometry does not move', async () => {
      await page.locator('#layersTab').click(); const id = (await selected())[0], row = page.locator(`[data-layer-id="${id}"]`); const before = await getElement();
      await row.getByRole('button', { name: '锁定图层', exact: true }).click(); await page.keyboard.press('ArrowRight'); assert.equal((await getElement()).x, before.x);
      await row.getByRole('button', { name: '隐藏图层', exact: true }).click(); assert.equal(await page.locator(`#world [data-id="${id}"]`).count(), 0);
      await row.getByRole('button', { name: '显示图层', exact: true }).click(); await row.getByRole('button', { name: '解锁图层', exact: true }).click();
    });
    await run('Command palette searches and executes keyboard selection', async () => {
      await page.locator('#commandBtn').click(); await page.locator('#commandSearch').fill('新建画板'); await page.keyboard.press('Enter'); assert.equal(await page.locator('#boardDialog').evaluate(n => n.open), true);
      await page.locator('[data-preset="390,844"]').click(); assert.equal((await data()).boards.length, 4); assert.equal((await data()).boards.at(-1).w, 390);
    });
    await run('Orbit import, live prototype navigation and Back work', async () => {
      await page.locator('#orbitBtn').click(); const d = await data(); assert.equal(d.boards.length, 7); assert.equal(d.boards.at(-3).elements.length > 50, true);
      await page.locator('#previewBtn').click(); await page.locator('#previewBody .prototype-hotspot').first().click(); assert.match(await page.locator('#previewTitle').innerText(), /指令菜单/);
      await page.locator('#previewBody .prototype-hotspot').first().click(); assert.match(await page.locator('#previewTitle').innerText(), /外观设置/); await page.screenshot({ path: path.join(output, 'orbit-prototype.png') });
      await page.locator('#previewBack').click(); assert.match(await page.locator('#previewTitle').innerText(), /指令菜单/); await page.locator('#preview [data-close]').click();
    });
    await run('JSON, SVG and PNG exports produce real files', async () => {
      const json = await exportAs('json'); const exported = JSON.parse(await fs.readFile(json, 'utf8')); assert.equal(exported.boards.length, 7);
      const svg = await exportAs('svg'); assert.match(await fs.readFile(svg, 'utf8'), /^<svg/);
      const png = await exportAs('png'); const bytes = await fs.readFile(png); assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.ok(bytes.length > 10000);
    });
    await run('Exported HTML runs offline and preserves prototype navigation', async () => {
      const file = await exportAs('html'), preview = await context.newPage(); const issues = []; preview.on('pageerror', e => issues.push(e.message));
      await preview.goto(pathToFileURL(file).href); await preview.locator('.slide:not([hidden]) .prototype-hotspot').first().click(); assert.match(await preview.locator('#title').innerText(), /指令菜单/);
      await preview.locator('#back').click(); assert.match(await preview.locator('#title').innerText(), /快速搜索/); assert.deepEqual(issues, []); await preview.close();
    });
    await run('Reload restores persisted changes and import rejects invalid documents', async () => {
      const before = await data(); await page.reload(); assert.deepEqual(await data(), before);
      await page.locator('#jsonInput').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"boards":[]}') }); await page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('导入失败')); assert.deepEqual(await data(), before);
      await page.locator('#jsonInput').setInputFiles(path.join(output, 'export.json')); await page.waitForFunction(() => document.querySelector('#toast').textContent.startsWith('设计已导入')); assert.deepEqual(await data(), before);
    });
    await run('Standalone HTML works offline; tablet-size desktop layout renders', async () => {
      const local = await context.newPage(); const issues = []; local.on('pageerror', e => issues.push(e.message)); await local.goto(pathToFileURL(path.resolve(__dirname, '../../Forma.html')).href);
      assert.equal(await local.locator('.board').count(), 3); await local.locator('#addText').click(); assert.equal(await local.locator('#world .element.selected').count(), 1); assert.deepEqual(issues, []); await local.close();
      await page.setViewportSize({ width: 1024, height: 768 }); await page.locator('#boardList .board-item').first().click(); await page.screenshot({ path: path.join(output, 'compact.png') });
      assert.ok(await page.locator('#viewport').evaluate(n => n.clientWidth > 500));
    });
    assert.deepEqual(errors, []); console.log('PASS no browser runtime exceptions');
    await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ passed: results, runtimeErrors: errors }, null, 2));
  } catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.error(error); process.exitCode = 1; }
  finally { await browser.close(); }
})();
