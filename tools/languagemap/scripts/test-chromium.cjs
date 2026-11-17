// This checks the Windows web UI and actual bridge code in Chromium on macOS.
// The native channel is simulated; this is not a Windows/WebView2 system test.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true});
  let records = {};
  try {
    for (const name of ['fresh.js','smoke.js','reopen.js']) {
      const context = await browser.newContext({viewport:{width:1180,height:780},deviceScaleFactor:1});
      const page = await context.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='https://languagemap.invalid')return route.abort();
        const filename=path.basename(url.pathname);
        const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
        await route.fulfill({body:await fs.readFile(path.join(root,'app/Web',filename)),contentType:types[path.extname(filename)]});
      });
      await page.exposeFunction('__nativeSaveForTest',async message=>{
        if(message.method!=='save')throw Error('Invalid method');
        if(Object.keys(message.values).some(k=>!['languagemap-v03-edits','languagemap-theme','languagemap-ui-language'].includes(k)))return {id:message.id,error:'Unknown data field'};
        records={...message.values};return {id:message.id,result:true};
      });
      const bridge=await fs.readFile(path.join(root,'windows/LanguageMap.Windows/Bridge.js'),'utf8');
      const storage=await fs.readFile(path.join(root,'app/Web/storage.js'),'utf8');
      await page.addInitScript({content:`window.__initialStorage=${JSON.stringify(records)};
        window.__testErrors=[];addEventListener('error',e=>__testErrors.push(e.message));
        window.chrome ??= {}; let receive;
        chrome.webview={addEventListener:(type,fn)=>receive=fn,postMessage:async message=>receive({data:await window.__nativeSaveForTest(message)})};
        ${bridge}\n${storage}`});
      await page.goto('https://languagemap.invalid/index.html');
      const body=await fs.readFile(path.join(root,'tests',name),'utf8');
      // Evaluate through the automation world; no eval is enabled in the page CSP.
      const result=await page.evaluate(`(async()=>{${body}})()`);
      assert.deepEqual(errors,[]);
      assert.equal(await page.locator('#open-search kbd').innerText(),'Ctrl K');
      if(name!=='fresh.js') {
        assert.match(await page.locator('.review-foot span:last-child').innerText(),/Drag to pan/);
        assert.equal(await page.locator('#save-status').innerText(),'Saved locally');
      }
      await page.screenshot({path:path.join(root,'.build',`chromium-${name}.png`)});
      console.log('PASS (Chromium, simulated native channel):',result);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
