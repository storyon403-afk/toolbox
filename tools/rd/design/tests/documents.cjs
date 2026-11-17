// Exercise portable files, independent local drafts, publication boundaries and print output.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rd-documents-'));
const preview=path.join(root,'design/previews');
let browser,server;
async function action(page,id){if(!await page.locator('#'+id).isVisible())await page.locator('#menuToggle').click();await page.locator('#'+id).click();}
async function files(page){await page.keyboard.press('Escape');await action(page,'documentToggle');}
async function importFile(page,data){await files(page);await page.evaluate(()=>document.getElementById('toast').textContent='');await page.locator('#documentFile').setInputFiles({name:'fixture.rd',mimeType:'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});await page.waitForFunction(()=>document.getElementById('toast').textContent.length>0);}
async function save(page,id,destination){const pending=page.waitForEvent('download');await page.locator('#'+id).click();const file=await pending;await file.saveAs(destination);return file.suggestedFilename();}
(async()=>{
 const port=await require('./port.cjs').availablePort();
 server=spawn(process.env.PANGZHU_SERVER||path.join(root,'bin/pangzhu'),['--port',String(port),'--data-dir',temp]);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve()});server.once('error',reject);});
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin=`http://127.0.0.1:${port}`;
 await page.goto(origin);await page.locator('.article-title').waitFor();
 const initialTitle=await page.locator('.article-title').textContent();
 await action(page,'editMode');await page.locator('[data-block=title]').fill('原来的草稿');
 await files(page);await page.locator('#newDocument').click();
 assert.equal(await page.locator('.article-title').textContent(),'');
 await page.locator('[data-block=title]').fill('独立文稿 A');
 await page.locator('.block').fill('第一篇中文 🌿 <script>alert(1)</script>\n第二行。');
 await files(page);const rdPath=path.join(temp,'a.rd');
 assert.equal(await save(page,'saveDocument',rdPath),'独立文稿 A.rd');
 const rd=JSON.parse(fs.readFileSync(rdPath,'utf8'));
 assert.deepEqual(Object.keys(rd).sort(),['document','format','version']);
 assert.equal(rd.document.blocks[0].text,'第一篇中文 🌿 <script>alert(1)</script>\n第二行。');
 const shortcut=page.waitForEvent('download');await page.keyboard.press('Control+s');assert.equal((await shortcut).suggestedFilename(),'独立文稿 A.rd');
 await page.keyboard.press('Escape');
 await page.locator('.block').fill('尚未保存的临时修改');await page.locator('#discardDraft').click();await page.locator('#confirmDialog button[value=confirm]').click();
 await page.waitForFunction(text=>document.querySelector('.block').textContent===text,rd.document.blocks[0].text);
 assert.equal(await page.locator('.block').textContent(),rd.document.blocks[0].text);
 await files(page);await page.locator('#newDocument').click();await page.locator('[data-block=title]').fill('独立文稿 B');await page.locator('.block').fill('第二篇的内容');
 await page.reload();await page.locator('[contenteditable]').first().waitFor();
 assert.equal(await page.locator('.article-title').textContent(),'独立文稿 B');
 await files(page);await page.getByRole('button',{name:'独立文稿 A',exact:true}).click();
 assert.equal(await page.locator('.block').textContent(),rd.document.blocks[0].text);
 await importFile(page,rd);assert.equal(await page.locator('.article-title').textContent(),'独立文稿 A');
 assert.equal(await page.locator('.block').textContent(),rd.document.blocks[0].text);
 assert.equal(await page.locator('#article script').count(),0);
 const baselineCount=await page.locator('#localDocuments button').count();
 for(const invalid of ['bad json',{...rd,version:2},{...rd,document:{...rd.document,blocks:[rd.document.blocks[0],rd.document.blocks[0]]}},{...rd,document:{...rd.document,titleSize:1000}},{...rd,document:{...rd.document,blocks:[{...rd.document.blocks[0],type:'script'}]}},' '.repeat(1_000_001)]){
  await importFile(page,invalid);await page.waitForFunction(()=>/无效|不支持|超过/.test(document.getElementById('toast').textContent));
  assert.equal(await page.locator('#localDocuments button').count(),baselineCount);
  assert.equal(await page.locator('.article-title').textContent(),'独立文稿 A');
 }
 const reviewer=await context.newPage();await reviewer.goto(origin+'/review');await reviewer.locator('.article-title').waitFor();
 assert.equal(await reviewer.locator('.article-title').textContent(),initialTitle);
 assert.equal(await reviewer.locator('#localDocuments button').count(),0);
 assert.equal((await context.request.post(origin+'/review/api/publish',{data:rd.document})).status(),403);
 await files(page);const htmlPath=path.join(temp,'a.html');await save(page,'exportButton',htmlPath);
 const html=fs.readFileSync(htmlPath,'utf8');assert(!html.includes('第二篇的内容'));assert(!html.includes('原来的草稿'));
 const offline=await browser.newContext({offline:true});const copy=await offline.newPage();copy.on('pageerror',e=>errors.push(e.message));
 await copy.goto(pathToFileURL(htmlPath).href);await copy.locator('.article-title').waitFor();
 assert.equal(await copy.locator('.article-title').textContent(),'独立文稿 A');
 assert.equal(await copy.locator('.block').textContent(),rd.document.blocks[0].text);
 await importFile(copy,rd);assert.equal(await copy.locator('.block').textContent(),rd.document.blocks[0].text);
 await files(page);await page.screenshot({path:path.join(preview,'documents-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(preview,'documents-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert(await page.evaluate(()=>document.getElementById('documentPanel').getBoundingClientRect().top>=document.getElementById('formatbar').getBoundingClientRect().bottom));
 assert(await page.locator('#saveDocument').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}));
 await page.keyboard.press('Escape');await page.locator('#publishButton').click();await page.locator('#formatbar').waitFor({state:'hidden'});
 await files(page);await page.getByRole('button',{name:'独立文稿 B',exact:true}).click();
 assert.equal(await page.locator('#publishButton').isDisabled(),true);
 await page.locator('#publishReplacement').click();await page.locator('#confirmDialog button[value=confirm]').click();
 await page.locator('#formatbar').waitFor({state:'hidden'});
 const state=await (await context.request.get(origin+'/api/state')).json();
 assert.deepEqual(state.versions.slice(0,3).map(v=>v.title),['独立文稿 B','独立文稿 A',initialTitle]);
 // A failed publication must leave the active file and its local edits intact.
 await action(page,'editMode');await page.locator('.block').fill('失败后保留的修改');
 await page.route('**/api/publish',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Fixture unavailable"}'}));
 await page.locator('#publishButton').click();await page.waitForFunction(()=>document.getElementById('toast').textContent==='Fixture unavailable');
 await page.reload();await page.locator('[contenteditable]').first().waitFor();assert.equal(await page.locator('.block').textContent(),'失败后保留的修改');
 // Print uses complete source blocks, independent of screen pagination and overlays.
 const long={format:'rd',version:1,document:{title:'RD 中文 PDF 验证',titleSize:38,blocks:Array.from({length:25},(_,i)=>({id:'b'+i,type:i%5===0?'h2':'p',font:i%3===0?'sans':'serif',size:i%5===0?25:18,text:i%5===0?`第 ${i/5+1} 节`:`段落 ${i}：中文排版与分页验证。`+'文档可以独立保存，再次打开后继续编写。'.repeat(12)}))}};
 await importFile(page,long);await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.print=()=>{window.dispatchEvent(new Event('beforeprint'));window.printInvoked=true;}});
 await page.locator('#toast').waitFor({state:'hidden'});
 await action(page,'pdfButton');
 assert.equal(await page.title(),'DocsBridge: Feedback Made Easier');
 assert.equal(await page.locator('#pdfWatermark').isChecked(),true);
 assert.equal(await page.locator('#pdfWatermarkText').inputValue(),'DocsBridge: Feedback Made Easier');
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(preview,'pdf-options-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(preview,'pdf-options-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#printPDF').click();assert.equal(await page.evaluate(()=>window.printInvoked),true);
 const geometry=await page.locator('.print-page').evaluateAll(pages=>pages.map(p=>{
  const body=p.querySelector('.print-body').getBoundingClientRect(),header=p.querySelector('header').getBoundingClientRect(),footer=p.querySelector('footer').getBoundingClientRect();
  return {overlap:header.bottom>body.top||footer.top<body.bottom,overflow:[...p.querySelector('.print-body').children].some(el=>el.getBoundingClientRect().bottom>body.bottom+.5)};
 }));
 assert(geometry.length>1);assert(geometry.every(p=>!p.overlap&&!p.overflow),JSON.stringify(geometry));
 await page.pdf({path:path.join(preview,'documents-print-watermark.pdf'),preferCSSPageSize:true,displayHeaderFooter:true});
 await page.locator('#pdfWatermarkText').fill('中文自定义水印'.repeat(20));
 await page.locator('#printPDF').click();
 assert(await page.locator('.print-page').evaluateAll(pages=>pages.every(p=>p.querySelector('header').getBoundingClientRect().bottom<=p.querySelector('.print-body').getBoundingClientRect().top)));
 // Every placement stays in the reserved page inset, away from text and other marks.
 for (const position of ['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right']) {
  await page.locator(`#pdfWatermarkPosition [data-watermark-position="${position}"]`).click();
  assert.equal(await page.locator('.pdf-preview').getAttribute('data-position'),position);
  await page.locator('#printPDF').click();
  const safe=await page.locator('.print-page').evaluateAll(pages=>pages.every(page=>{
   const body=page.querySelector('.print-body').getBoundingClientRect(),mark=page.querySelector('header').getBoundingClientRect(),date=page.querySelector('time').getBoundingClientRect(),footer=page.querySelector('footer').getBoundingClientRect();
   const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   return !intersects(mark,body)&&!intersects(mark,date)&&!intersects(mark,footer)&&mark.left>=body.left-.5&&mark.right<=body.right+.5;
  }));
  assert(safe,position);
 }
 await page.locator('#pdfPanel').screenshot({path:path.join(preview,'pdf-options-position.png')});
 await page.locator('#pdfWatermarkText').fill('仅供审阅 · Custom <script>mark</script>');
 await page.locator('#printPDF').click();
 assert.equal(await page.locator('.print-watermark-header span').first().textContent(),'仅供审阅 · Custom <script>mark</script>');
 assert.equal(await page.locator('#printDocument script').count(),0);
 await page.pdf({path:path.join(preview,'documents-print-custom.pdf'),preferCSSPageSize:true,displayHeaderFooter:true});
 const expandedHeight=await page.locator('#pdfPanel').evaluate(el=>el.getBoundingClientRect().height);
 await page.locator('#pdfWatermark').uncheck();
 assert.equal(await page.locator('#pdfWatermarkFields').isVisible(),false);
 assert(await page.locator('#pdfPanel').evaluate((el,height)=>el.getBoundingClientRect().height<height,expandedHeight));
 await page.setViewportSize({width:320,height:420});
 assert(await page.locator('#printPDF').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}));
 await page.locator('#pdfPanel').screenshot({path:path.join(preview,'pdf-options-disabled.png')});
 await page.reload();await page.locator('.article-title').waitFor();await action(page,'pdfButton');
 assert.equal(await page.locator('#pdfWatermark').isChecked(),false);
 assert.equal(await page.locator('.pdf-preview').getAttribute('data-position'),'bottom-right');
 assert.equal(await page.locator('#pdfWatermarkText').inputValue(),'仅供审阅 · Custom <script>mark</script>');
 await page.evaluate(()=>{window.print=()=>{window.dispatchEvent(new Event('beforeprint'));window.printInvoked=true;}});
 await page.locator('#printPDF').click();
 await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('#formatbar').isVisible(),false);
 assert.equal(await page.locator('.print-watermark-header,.print-watermark-footer').count(),0);
 assert.equal(await page.locator('.print-body').evaluateAll(elements=>elements.map(e=>e.textContent).join('')),long.document.title+long.document.blocks.map(b=>b.text).join(''));
 await page.pdf({path:path.join(preview,'documents-print.pdf'),preferCSSPageSize:true,displayHeaderFooter:true});
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});
 assert.equal(await page.locator('#printDocument').count(),0);assert.equal(await page.locator('.article-title').textContent(),long.document.title);
 assert.deepEqual(errors,[]);
 console.log('PASS: independent drafts, reload, .rd round trip and rejection, isolated HTML, offline import, reviewer boundaries, conflict replacement, failed publish recovery and A4 PDF.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server){await new Promise(resolve=>{server.once('exit',resolve);server.kill('SIGTERM')})}fs.rmSync(temp,{recursive:true,force:true});});
