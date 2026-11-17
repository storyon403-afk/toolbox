// Isolated UI acceptance for the requested V02.2 maintenance; no personal browser state.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
(async () => {
  const root = path.resolve(__dirname, '..');
  const folder = path.join(root, 'design/v02');
  const sandbox = { window: {} };
  vm.runInNewContext(await fs.readFile(path.join(folder, 'locales.js'), 'utf8'), sandbox);
  const dictionaries = sandbox.window.ToolboxLocales;
  for (const dict of Object.values(dictionaries)) assert.deepEqual(Object.keys(dict).sort(), Object.keys(dictionaries.en).sort());
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ttf': 'font/ttf' };
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(folder, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(folder + path.sep)) { res.writeHead(403).end(); return; }
    try { const body = await fs.readFile(target); res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  const errors = [];
  const screenshots = [];
  const waitText = (page, selector, value) => page.waitForFunction(([selector, value]) => document.querySelector(selector)?.textContent === value, [selector, value]);
  const checkGuide = async (page, id, locale) => {
    const dict = dictionaries[locale];
    assert.equal(await page.locator('#guide-purpose').textContent(), dict[`${id}Purpose`]);
    assert.deepEqual(await page.locator('#guide-steps li').allTextContents(), [1,2,3].map(n => dict[`${id}Step${n}`]));
    assert.equal(await page.locator('#guide-purpose-title').textContent(), dict.purpose);
    assert.equal(await page.locator('#guide-steps-title').textContent(), dict.howTo);
    const changedLocale = locale === 'en' ? 'ja' : 'en';
    await page.locator('#language').selectOption(changedLocale);
    assert.equal(await page.locator('#guide-purpose').textContent(), dictionaries[changedLocale][`${id}Purpose`]);
    assert.equal(await page.locator('#guide-steps li').nth(2).textContent(), dictionaries[changedLocale][`${id}Step3`]);
    assert.equal(new URL(page.url()).hash, `#tool/${id}`);
    await page.locator('#language').selectOption(locale);
    for (const width of [320,441,1440]) {
      await page.setViewportSize({width,height:900});
      await checkOverflow(page);
      if (id === 'rd' && (locale === 'zh-CN' && width === 1440 || locale === 'ja' && width === 441)) {
        const file = `shots/v02-2-guide-${locale}-${width}.png`;
        await page.screenshot({path:path.join(folder,file),fullPage:true}); screenshots.push(file);
      }
    }
  };
  const checkOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'No horizontal overflow');
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(url);
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    assert.equal(await page.locator('.tool-heading p,.hero__lead,.collection-bar,.app-foot,#detail-about,#detail-description,.settings-retention').count(), 0);
    for (const locale of ['zh-CN', 'ja', 'en']) {
      const dict = dictionaries[locale];
      await page.locator('#language').selectOption(locale);
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator('#search').getAttribute('placeholder'), dict.search);
      await page.reload();
      assert.equal(await page.locator('#language').inputValue(), locale, 'Selection survives reload');
      for (const [width, height] of [[1440,900],[441,762],[320,640]]) {
        await page.setViewportSize({ width, height });
        await checkOverflow(page);
        if (width !== 320) {
          const file = `shots/v02-2-${locale}-${width}.png`;
          await page.screenshot({ path: path.join(folder, file), fullPage: true }); screenshots.push(file);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('#search').fill('zz-no-match');
      assert.equal(await page.locator('#empty h2').textContent(), dict.noResults);
      await page.locator('#clear-search').click();
      await page.locator('#search').fill('文档');
      assert.equal(await page.locator('.tool-card:visible').count(), 1);
      await page.locator('#language').selectOption(locale === 'en' ? 'ja' : 'en');
      assert.equal(await page.locator('#search').inputValue(), '文档');
      assert.equal(await page.locator('.tool-card:visible').count(), 1);
      await page.locator('#language').selectOption(locale);
      await page.locator('#search').fill('');
      await page.locator('[data-route="installed"]').click();
      await waitText(page, '#empty h2', dict.emptyInstalled);
      assert.equal(await page.locator('#empty h2').textContent(), dict.emptyInstalled);
      await page.locator('#clear-search').click();
      await page.locator('#platform').selectOption('windows');
      await page.locator('[data-tool-link="linkparsing"]').click();
      await waitText(page, '#detail-reason', dict.windowsReason);
      assert.equal(await page.locator('#detail-reason').textContent(), dict.windowsReason);
      assert.equal(await page.locator('#detail-status').textContent(), dict.unsupported);
      assert.equal(await page.locator('#install').isDisabled(), true);
      await checkGuide(page, 'linkparsing', locale);
      for (const id of ['rd','designdoc','languagemap']) {
        await page.locator('.back-link').click();
        await page.locator(`[data-tool-link="${id}"]`).click();
        await waitText(page, '#detail-reason', dict[`${id}Reason`]);
        assert.equal(await page.locator('#detail-reason').textContent(), dict[`${id}Reason`]);
        await checkGuide(page, id, locale);
      }
      await page.locator('[data-route="settings"]').click();
      await page.locator('#settings').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#settings-title').textContent(), dict.settings);
      assert.equal(await page.locator('#installs').isDisabled(), true);
      await page.locator('#downloads').click();
      await page.locator('#installs').click();
      await page.locator('#language').selectOption(locale === 'en' ? 'ja' : 'en');
      assert.equal(await page.locator('#installs').getAttribute('aria-checked'), 'true', 'Language change preserves switch state');
      assert.equal(await page.locator('#install-hint').isVisible(), false);
      await page.locator('#language').selectOption(locale);
      await page.locator('#downloads').click();
      assert.equal(await page.locator('#installs').getAttribute('aria-checked'), 'false');
      assert.equal(await page.locator('#installs').isDisabled(), true);
      for (const width of [441,320]) { await page.setViewportSize({ width, height: 762 }); await checkOverflow(page); }
      await page.setViewportSize({ width: 1440, height: 900 });
      if (locale === 'zh-CN') await page.screenshot({ path: path.join(folder, 'shots/v02-2-settings-zh.png'), fullPage: true });
      await page.locator('[data-route="library"]').click();
      await page.locator('#platform').selectOption('mac');
    }
    await context.close();
    for (const [locale, expected] of [['ja-JP','ja'],['en-US','en'],['fr-FR','en'],['zh-TW','zh-CN']]) {
      const ctx = await browser.newContext({ locale }); const p = await ctx.newPage();
      await p.goto(url); assert.equal(await p.locator('#language').inputValue(), expected); await ctx.close();
    }
    const blocked = await browser.newContext({ locale: 'ja-JP' });
    await blocked.addInitScript(() => { Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); }; });
    const fallback = await blocked.newPage(); fallback.on('pageerror', err => errors.push(err.message));
    await fallback.goto(url); await fallback.locator('#language').selectOption('zh-CN');
    assert.equal(await fallback.locator('html').getAttribute('lang'), 'zh-CN'); await blocked.close();
    const local = await browser.newContext({ locale: 'en-US' }); const filePage = await local.newPage();
    filePage.on('pageerror', err => errors.push(err.message));
    await filePage.goto(pathToFileURL(path.join(folder,'index.html')).href);
    await filePage.locator('#language').selectOption('ja'); await filePage.reload();
    assert.equal(await filePage.locator('html').getAttribute('lang'), 'ja');
    await filePage.locator('[data-tool-link="rd"]').click(); await filePage.locator('#detail').waitFor({ state: 'visible' }); assert.equal(await filePage.locator('#detail-name').textContent(),'RD');
    await local.close(); assert.deepEqual(errors, []);
    const evidence = { date: '2026-11-08', revision: 'V02.2', locales: Object.keys(dictionaries), checks: ['dictionary parity','minimal copy','system locale and fallback','persistent selection','storage unavailable','file URL support','search and empty state translations','all tool detail reasons','four tool guides in three languages','guide refresh without route change','detail guide overflow at 320/441/1440','unsupported Windows tool','switch state retained across language changes','download/install dependency','320/441/1440 horizontal overflow'], pageErrors: errors, screenshots, scope: 'Isolated Chromium visual preview; no native desktop or tool installation acceptance.' };
    await fs.writeFile(path.join(root,'documents/evidence/v02-2-check.json'), JSON.stringify(evidence,null,2)+'\n');
    console.log(JSON.stringify(evidence));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(err => { console.error(err); process.exitCode = 1; });
