const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {loginURL, remoteResource, douyinShare, cookieText} = require('./auth-utils.cjs');
const {DouyinLogin} = require('./auth.cjs');
const cookie = {domain:'.douyin.com', path:'/', name:'sessionid', value:'synthetic-secret', httpOnly:true, secure:true, expirationDate:2000000000};

test('official navigation and share detection reject lookalikes and local targets', () => {
  for (const url of ['https://www.douyin.com/','https://v.douyin.com/test/','https://www.iesdouyin.com/share/video/1']) assert.ok(loginURL(url));
  for (const url of ['http://www.douyin.com/','https://douyin.com.evil.example/','https://evil-douyin.com/','https://user@douyin.com/','file:///tmp/cookies','https://127.0.0.1/','https://douyin.com:8443/','javascript:alert(1)']) assert.equal(loginURL(url),false,url);
  assert.ok(douyinShare('分享文案 https://v.douyin.com/abc/ 复制链接'));
  assert.equal(douyinShare('https://v.douyin.com/a/ https://youtube.com/'),false);
  for (const url of ['file:///private','http://localhost/','https://localhost./','https://127.0.0.1/','https://127.0.0.1./','https://[::1]/','https://server.local/','https://server.internal/']) assert.equal(remoteResource(url),false,url);
});

test('cookie adapter isolates domains and preserves HttpOnly/session semantics', () => {
  const text = cookieText([cookie,{...cookie,domain:'.iesdouyin.com',expirationDate:undefined},
    {...cookie,domain:'.douyin.com.evil.example'}, {...cookie,name:'expired',expirationDate:1},
    {...cookie,name:'inject\nentry'}, {...cookie,name:'value',value:'x\ty'},
    {...cookie,name:'partitioned',partitionKey:{topLevelSite:'https://elsewhere.example'}}],1900000000);
  assert.equal(text.split('\n').length,4);
  assert.ok(text.includes('#HttpOnly_.douyin.com\tTRUE\t/\tTRUE\t2000000000\tsessionid\t'));
  assert.ok(text.includes('#HttpOnly_.iesdouyin.com\tTRUE\t/\tTRUE\t0\tsessionid\t'));
  assert.equal(cookieText([{...cookie,expirationDate:1}],2),null);
  assert.throws(()=>cookieText([{...cookie,value:'x'.repeat(1024*1024)}],1));
});

test('temporary credentials are isolated, released, and absent from status metadata', async () => {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lp-auth-'));let values=[cookie];
  const fakeSession={setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){},webRequest:{onBeforeRequest(){}},
    cookies:{get:async({domain})=>!domain||domain==='douyin.com'?values:[],flushStore:async()=>{},remove:async()=>{values=[];}},
    closeAllConnections:async()=>{},clearStorageData:async()=>{values=[];},clearCache:async()=>{}};
  try {
    const login=new DouyinLogin({dataDir,electron:{session:{fromPath:()=>fakeSession}}});
    for (const text of ['null','{broken','"value"',JSON.stringify({savedAt:'not a timestamp'}),' '.repeat(4097)]) {
      fs.writeFileSync(login.stateFile,text);
      assert.equal((await login.status()).state,'disconnected');
    }
    assert.equal((await login.status()).state,'disconnected');
    assert.equal(await login.lease(),null,'visiting a page does not activate a login');
    fs.writeFileSync(login.stateFile,JSON.stringify({savedAt:Date.now()}));
    assert.equal((await login.status()).state,'unverified');
    const lease=await login.lease();assert.ok(fs.existsSync(lease.file));
    if(process.platform!=='win32')assert.equal(fs.statSync(lease.file).mode&0o777,0o600);
    login.mark(true);assert.equal((await login.status()).state,'connected');
    assert.equal(fs.readFileSync(login.stateFile,'utf8').includes(cookie.value),false);
    login.mark(false,'network_unavailable');assert.equal((await login.status()).state,'connected');
    login.mark(false,'authentication_required');assert.equal((await login.status()).state,'expired');
    lease.release();lease.release();assert.equal(fs.existsSync(lease.file),false);
    const another=await login.lease();await login.remove();assert.equal(fs.existsSync(another.file),false);
    assert.deepEqual(await login.status(),{state:'disconnected',can_remove:false});
    assert.equal(await login.lease(),null);
  } finally { fs.rmSync(dataDir,{recursive:true,force:true}); }
});
