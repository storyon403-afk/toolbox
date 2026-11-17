const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(postMessage) {
  const status={dataset:{}};
  const context={window:{__initialStorage:{},webkit:{messageHandlers:{storage:{postMessage}}}},document:{querySelector:()=>status,addEventListener(){}},setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../app/Web/storage.js','utf8'),context);
  context.AppStorage=context.window.AppStorage;
  return {storage:context.AppStorage,status};
}
test('failed native save stays dirty and an explicit retry persists it',async()=>{
  let fail=true,calls=[];const {storage,status}=setup(async values=>{calls.push({...values});if(fail)throw Error('disk full');});
  storage.setItem('languagemap-theme','glass');
  await assert.rejects(storage.flush());assert.equal(status.dataset.error,'true');
  assert.equal(storage.getItem('languagemap-theme'),'glass');
  fail=false;await storage.flush();assert.equal(status.dataset.error,'false');assert.equal(calls.length,2);
});
test('queued writes preserve the newest revision while an older save is in flight',async()=>{
  let release,values=[];const {storage}=setup(async value=>{values.push({...value});if(values.length===1)await new Promise(r=>release=r);});
  storage.setItem('languagemap-theme','mono');const first=storage.flush();
  await new Promise(r=>setImmediate(r));storage.setItem('languagemap-theme','glass');const last=storage.flush();
  release();await Promise.all([first,last]);assert.equal(values.at(-1)['languagemap-theme'],'glass');
});
test('Windows bridge resolves only matching acknowledgements and surfaces native rejection',async()=>{
  const messages=[],listeners={};
  const context={window:{},chrome:{webview:{addEventListener:(event,handler)=>listeners[event]=handler,postMessage:message=>messages.push(message)}},setTimeout,clearTimeout};
  context.window.top=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname+'/../windows/LanguageMap.Windows/Bridge.js','utf8'),context);
  const host=context.window.LanguageMapHost;
  assert.equal(host.platform,'windows');
  const first=host.save({'languagemap-theme':'mono'}), second=host.save({'languagemap-theme':'glass'});
  listeners.message({data:{id:'not-requested',result:true}});
  listeners.message({data:{id:messages[1].id,result:true}});
  await second;
  const rejected=assert.rejects(first,/disk full/);
  listeners.message({data:{id:messages[0].id,error:'disk full'}});
  await rejected;
  assert.equal(messages[0].method,'save');
});
