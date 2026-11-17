import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, rename, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StateStore } from '../src/state.mjs';
import { Lifecycle } from '../src/lifecycle.mjs';
import { safeRelative, extractPackage, downloadPackage } from '../src/packages.mjs';
import { DesktopService } from '../src/desktop-service.mjs';

function zip(name, content = 'fixture', mode = 0o100700) {
  const file = Buffer.from(name), body = Buffer.from(content); let crc = 0xffffffff;
  for (const value of body) { crc ^= value; for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(file.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(file.length,28);central.writeUInt32LE((mode << 16) >>> 0,38);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+file.length,12);end.writeUInt32LE(30+file.length+body.length,16);
  return Buffer.concat([local,file,body,central,file,end]);
}
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
async function fixture(t, downloadOverride) {
  const root = await mkdtemp(path.join(os.tmpdir(),'toolbox-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const archive = zip('index.html','<h1>Fixture</h1>');
  const release = {status:'verified',version:'1.0.0',releaseUrl:'https://example.invalid/tool.zip',sha256:digest(archive),evidence:['Synthetic fixture'],checks:Object.fromEntries(['distribution','install','launch','update','uninstall','isolation','recovery'].map(key=>[key,true])),launch:{type:'html',entryPoint:'index.html'}};
  const catalog = {schemaVersion:1,tools:['first','second'].map(id=>({id,name:id,description:'Fixture',targets:{'darwin-arm64':structuredClone(release)}}))};
  const store=await new StateStore(root).init(); let stopped;
  const engine=new Lifecycle({root,store,catalog,target:'darwin-arm64',download:downloadOverride || (async (_url,dest)=>writeFile(dest,archive)),launch:async ()=>({closed:new Promise(resolve=>{stopped=resolve;}),stop:()=>stopped()})});
  await engine.recover(); return {root,store,engine,catalog,archive,stop:()=>stopped()};
}
test('preferences persist, serialize concurrent saves and enforce install/download dependency',async t=>{
 const {root,store}=await fixture(t);
 await Promise.all([store.setSettings({language:'ja'}),store.setSettings({motion:false}),store.setSettings({downloads:true})]);
 await store.setSettings({installs:true});await store.setSettings({downloads:false});
 const restored=await new StateStore(root).init();assert.equal(restored.data.settings.language,'ja');assert.equal(restored.data.settings.motion,false);assert.equal(restored.data.settings.installs,false);
 await assert.rejects(store.setSettings({installs:true}),/downloadRequired/);await assert.rejects(store.setSettings({language:'xx'}),/invalidSettings/);await assert.rejects(store.setSettings({unknown:true}),/invalidSettings/);
});
test('corrupted state is backed up before recovery',async t=>{const {root,store}=await fixture(t);await writeFile(store.file,'broken');const restored=await new StateStore(root).init();assert.equal(restored.recovered,true);assert.ok((await readdir(root)).some(name=>name.includes('.corrupt-')));});
test('fresh desktop reads only metadata, catches up daily and respects disabled daily checks',async t=>{
 const {root,catalog}=await fixture(t);const file=path.join(root,'catalog.json');await writeFile(file,JSON.stringify(catalog));
 const service=await new DesktopService({root,target:'darwin-arm64',catalogFile:file,locale:'zh-CN',version:'test',launch:async()=>{}}).init();t.after(()=>service.close());
 assert.ok(service.snapshot().tools.every(row=>!row.installedVersion));await service.tick();assert.equal(service.store.data.lastCheck.result,'bundledOnly');const at=service.store.data.lastCheck.at;await service.tick();assert.equal(service.store.data.lastCheck.at,at);await service.settings({daily:false});await service.tick(Date.now()+90000000);assert.equal(service.store.data.lastCheck.at,at);
});
test('install, open, update and uninstall preserve data and another tool',async t=>{
 const {engine,store,root,catalog,stop}=await fixture(t);await engine.install('first');await engine.install('second');
 const data=path.join(root,'tools/first/data/notes.txt');await writeFile(data,'keep');await engine.open('first');assert.equal(engine.snapshot()[0].state,'running');await assert.rejects(engine.uninstall('first'),/toolBusy/);stop();await new Promise(r=>setImmediate(r));
 catalog.tools[0].targets['darwin-arm64'].version='1.1.0';await engine.open('first');await engine.install('first',{prepare:true});assert.equal(store.data.installations.first.version,'1.0.0');assert.equal(engine.snapshot()[0].prepared,true);await assert.rejects(engine.install('first'),/toolBusy/);stop();await new Promise(r=>setImmediate(r));await engine.install('first');assert.equal(store.data.installations.first.version,'1.1.0');await engine.uninstall('first');assert.equal(await readFile(data,'utf8'),'keep');assert.equal(store.data.installations.second.version,'1.0.0');assert.ok(await readFile(path.join(root,'tools/second/versions/1.0.0/index.html')));
});
test('checksum failure retains the last usable installation',async t=>{
 const {engine,store,catalog}=await fixture(t);await engine.install('first');Object.assign(catalog.tools[0].targets['darwin-arm64'],{version:'2.0.0',sha256:'a'.repeat(64)});await assert.rejects(engine.install('first'),/checksumMismatch/);assert.equal(store.data.installations.first.version,'1.0.0');
});
test('failed record commit leaves old version and can retry',async t=>{
 const {engine,store,catalog}=await fixture(t);await engine.install('first');catalog.tools[0].targets['darwin-arm64'].version='2.0.0';const original=store.change.bind(store);store.change=async()=>{throw new Error('disk full');};await assert.rejects(engine.install('first'),/disk full/);assert.equal(store.data.installations.first.version,'1.0.0');store.change=original;await engine.install('first');assert.equal(store.data.installations.first.version,'2.0.0');
});
test('interrupted uninstall restores recorded binaries; staging recovery preserves data',async t=>{
 const {engine,root}=await fixture(t);await engine.install('first');await rename(path.join(root,'tools/first/versions'),path.join(root,'tools/first/removed-11111111-1111-1111-1111-111111111111'));await mkdir(path.join(root,'staging/22222222-2222-2222-2222-222222222222'));await engine.recover();assert.equal((await readdir(path.join(root,'staging'))).length,0);assert.ok(await readFile(path.join(root,'tools/first/versions/1.0.0/index.html')));
});
test('unverified packages, traversal, symlinks and archive size limits fail closed',async t=>{
 const {root,engine,catalog}=await fixture(t);catalog.tools[0].targets['darwin-arm64'].status='pending';await assert.rejects(engine.install('first'),/unverifiedPackage/);
 for(const value of ['../bad','/tmp/bad','C:/bad','a\\b','a/../../b','CON.exe','file:stream','a./b'])assert.throws(()=>safeRelative(value));
 for(const [index,archive]of [zip('../escape'),zip('link','target',0o120777),zip('huge','abcd')].entries()){
  const file=path.join(root,`bad${index}.zip`);await writeFile(file,archive);await assert.rejects(extractPackage(file,path.join(root,`out${index}`),{maxBytes:3}));
 }
 await assert.rejects(downloadPackage('http://example.invalid/a.zip',path.join(root,'download')),/unsafeSource/);
});
test('cancellation removes owned staging and never commits an installation',async t=>{
 const {root,engine,store}=await fixture(t,async(_url,_dest,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})));
 const pending=engine.install('first');await new Promise(r=>setTimeout(r,20));await assert.rejects(engine.install('first'),/toolBusy/);engine.cancel('first');await assert.rejects(pending);assert.equal(store.data.installations.first,undefined);assert.equal((await readdir(path.join(root,'staging'))).length,0);
});
