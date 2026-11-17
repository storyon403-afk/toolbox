import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=process.cwd(); const output=path.join(root,'dist/release');await mkdir(output,{recursive:true});
const artifacts=[];
for(const directory of ['dist','tools/rd/dist','tools/languagemap/dist','tools/linkparsing/dist']){
 for(const name of await readdir(directory).catch(()=>[])) {
  if(!name.endsWith('.zip') || !/^(Toolbox-|DesignDoc-|LanguageMap-|pangzhu-|LinkParsing-)/.test(name))continue;
  const source=path.join(root,directory,name);await copyFile(source,path.join(output,name));
  const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);
  artifacts.push({file:name,sha256:hash.digest('hex')});
 }
}
await writeFile(path.join(output,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
const catalog=JSON.parse(await readFile('catalog/tools.json','utf8'));
// This is a publication draft, never trusted executable metadata. Readiness gates stay unchanged.
await writeFile(path.join(output,'catalog.draft.json'),JSON.stringify(catalog,null,2)+'\n');
await writeFile(path.join(output,'release.json'),JSON.stringify({version:JSON.parse(await readFile('package.json','utf8')).version,repository:null,published:false,artifacts},null,2)+'\n');
console.log(`Staged ${artifacts.length} independent assets in dist/release; nothing uploaded.`);
