import { zipDirectory } from './zip-directory.mjs';
import { packager } from '@electron/packager';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=process.cwd();
const run=(command,args,options={})=>{const result=spawnSync(command,args,{stdio:'inherit',...options});if(result.status!==0)throw new Error(`${command} failed`);};
run(process.execPath,['scripts/prepare-desktop.mjs']);
const pkg=JSON.parse(await readFile('package.json','utf8'));
const targets=process.argv.slice(2);if(!targets.length)targets.push(...(process.platform === 'darwin' ? ['darwin-arm64','darwin-x64','win32-x64','win32-arm64'] : ['win32-x64','win32-arm64']));
const allowed=['darwin-arm64','darwin-x64','win32-x64','win32-arm64'];
if(targets.some(target=>!allowed.includes(target)))throw new Error('Unsupported target');
await mkdir('dist',{recursive:true});
const artifacts=[];
for(const target of targets){
 const [platform,arch]=target.split('-');
 if(platform==='darwin' && process.platform!=='darwin')throw new Error('Build macOS artifacts on macOS');
 const output=await packager({dir:path.join(root,'build/app'),name:'Toolbox',appBundleId:'com.storyon.toolbox',appVersion:pkg.version,platform,arch,electronVersion:pkg.devDependencies.electron,out:path.join(root,'dist'),overwrite:true,asar:true,prune:false,icon:path.join(root,'desktop/icons/toolbox'),osxSign:undefined});
 const bundle=output[0];const name=`Toolbox-${pkg.version}-${target}.zip`;const destination=path.join(root,'dist',name);
 if(platform==='darwin') {
  run('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements,requirements,flags',path.join(bundle,'Toolbox.app')]);
  run('/usr/bin/codesign',['--verify','--deep','--strict',path.join(bundle,'Toolbox.app')]);
  run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',path.join(bundle,'Toolbox.app'),destination]);
 } else await zipDirectory(bundle,destination);
 const hash=createHash('sha256');for await(const chunk of createReadStream(destination))hash.update(chunk);
 artifacts.push({file:name,target,sha256:hash.digest('hex'),signed:platform==='darwin'?'ad-hoc':'unsigned'});console.log(`Built ${name}`);
}
await writeFile('dist/artifacts.json',JSON.stringify({version:pkg.version,electron:pkg.devDependencies.electron,artifacts},null,2)+'\n');
await writeFile('dist/SHA256SUMS',artifacts.map(item=>`${item.sha256}  ${item.file}`).join('\n')+'\n');
