// Real Windows payloads; controlled revisions are acceptance fixtures, not public versions.
import {cp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {zipDirectory} from './zip-directory.mjs';
import {sha256,extractPackage} from '../src/packages.mjs';
const output='dist/windows-managed-acceptance';
await rm('build/rd-release-test',{recursive:true,force:true});
await extractPackage('tools/rd/dist/pangzhu-0.2.2-windows-amd64.zip','build/rd-release-test');
const specs={
 rd:{source:'build/rd-release-test/pangzhu-0.2.2-windows-amd64/pangzhu.exe',destination:'pangzhu.exe',toolVersion:'0.2.2',launch:{type:'loopback',entryPoint:'pangzhu.exe',readiness:'toolbox-v1',args:['--host','127.0.0.1','--port','0','--data-dir','{dataDir}','--updates','off']}},
 designdoc:{source:'tools/designdoc/Forma.html',destination:'Forma.html',toolVersion:'2.1.0',launch:{type:'html',entryPoint:'Forma.html'}},
 languagemap:{source:'tools/languagemap/.build/windows-x64',destination:'app',toolVersion:'1.1.0',launch:{type:'native',entryPoint:'app/LanguageMap.exe',readiness:'toolbox-v1'}}
};
if (process.argv.includes('--include-linkparse')) specs.linkparsing = {source:'tools/linkparsing/.build/windows-x64',destination:'app',toolVersion:'0.1.0',launch:{type:'native',entryPoint:'app/resources/app/runtime/node.exe',args:['app/resources/app/windows/managed.cjs'],readiness:'toolbox-v1'}};
await mkdir(output,{recursive:true}); const artifacts=[];
for(const [id,spec] of Object.entries(specs)){
 const payload=path.join(output,id);await rm(payload,{recursive:true,force:true});await mkdir(payload);
 await cp(spec.source,path.join(payload,spec.destination),{recursive:true});
 for(const version of ['0.0.1','0.0.2']){
  await writeFile(path.join(payload,'toolbox-package.json'),JSON.stringify({id,packageRevision:version,toolVersion:spec.toolVersion}));
  const file=path.join(output,`${id}-${version}.zip`);await zipDirectory(payload,file);
  artifacts.push({id,version,toolVersion:spec.toolVersion,file:path.basename(file),sha256:await sha256(file),launch:spec.launch});
 }
}
await writeFile(path.join(output,'artifacts.json'),JSON.stringify(artifacts,null,2));
