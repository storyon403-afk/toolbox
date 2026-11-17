import { readFile, writeFile, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { extractFile, listPackage } from '@electron/asar';
const metadata=JSON.parse(await readFile('dist/artifacts.json','utf8'));
const evidence={version:metadata.version,electron:metadata.electron,artifacts:[],scope:'Artifact integrity, architecture, packaged-source/dependency checks. Native execution is recorded separately.'};
for(const artifact of metadata.artifacts){
 const hash=createHash('sha256');for await(const chunk of createReadStream(path.join('dist',artifact.file)))hash.update(chunk);assert.equal(hash.digest('hex'),artifact.sha256);
 const [platform,arch]=artifact.target.split('-');const directory=path.join('dist',`Toolbox-${artifact.target}`);
 const binary=platform==='darwin'?path.join(directory,'Toolbox.app/Contents/MacOS/Toolbox'):path.join(directory,'Toolbox.exe');
 const handle=await open(binary,'r');const header=Buffer.alloc(64);await handle.read(header,0,64,0);
 if(platform==='darwin')assert.equal(header.readUInt32LE(4),arch==='arm64'?0x0100000c:0x01000007);
 else{const pe=Buffer.alloc(6);await handle.read(pe,0,6,header.readUInt32LE(0x3c));assert.equal(pe.readUInt32LE(0),0x4550);assert.equal(pe.readUInt16LE(4),arch==='arm64'?0xaa64:0x8664);}await handle.close();
 const archive=platform==='darwin'?path.join(directory,'Toolbox.app/Contents/Resources/app.asar'):path.join(directory,'resources/app.asar');
 for(const file of ['desktop/main.mjs','desktop/tool-launcher.mjs','desktop/preload.cjs','src/lifecycle.mjs','src/desktop-service.mjs','src/packages.mjs','catalog/tools.json'])assert.equal(extractFile(archive,file).toString(),await readFile(file,'utf8'),`Current source in ${artifact.target}/${file}`);
 assert.equal(JSON.parse(extractFile(archive,'package.json')).version,metadata.version);
 const entries=listPackage(archive);assert.ok(!entries.some(entry=>/^\/node_modules\/(electron|playwright|@electron\/packager)(\/|$)/.test(entry)));assert.ok(!entries.some(entry=>/^\/(tools|documents|test|\.git)(\/|$)/.test(entry)));
 evidence.artifacts.push({...artifact,checksum:true,architecture:true,currentSource:true,productionDependenciesOnly:true});
}
await writeFile('documents/evidence/package-check.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
