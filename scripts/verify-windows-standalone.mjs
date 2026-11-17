// Exercise the exact standalone native executables with disposable profiles.
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {extractPackage,sha256} from '../src/packages.mjs';
if(process.platform!=='win32')throw Error('Run on the Windows desktop');
const work=await mkdtemp(path.join(os.tmpdir(),'toolbox-standalone-'));
const evidenceDir='documents/evidence/windows-standalone';await mkdir(evidenceDir,{recursive:true});
const report={target:`${process.platform}-${process.arch}`,checks:[],errors:[]};
const run=(exe,args)=>{const result=spawnSync(exe,args,{encoding:'utf8',timeout:90000});assert.equal(result.status,0,result.stderr||String(result.error));return result.stdout;};
try{
 for(const id of ['rd','languagemap'])await extractPackage(`dist/managed-acceptance/${id}-0.0.1.zip`,path.join(work,id));
 const rd=path.join(work,'rd/pangzhu.exe'),lm=path.join(work,'languagemap/app/LanguageMap.exe');
 report.binarySha256={rd:await sha256(rd),languagemap:await sha256(lm)};
 assert.match(run(rd,['--version']),/release repository is not configured/);
 assert.match(run(rd,['--check-update','--install-dir',path.join(work,'rd')]),/release repository is not configured/);
 report.checks.push('RD standalone version and explicit update check fail closed without a repository');
 const data=path.join(work,'library');await mkdir(data);
 for(const name of ['fresh','smoke','reopen','quit','after-quit']){
  await rm(path.join(data,'test-result.json'),{force:true});
  run(lm,['--self-test',data,path.resolve(`tools/languagemap/tests/${name}.js`)]);
  const result=JSON.parse(await readFile(path.join(data,'test-result.json'),'utf8'));assert.equal(result.ok,true,JSON.stringify(result));
  report.checks.push({test:`LanguageMap ${name}`,result:result.result});
 }
 await copyFile(path.join(data,'screenshot.png'),path.join(evidenceDir,'languagemap.png'));
 report.passed=true;
}catch(error){report.errors.push(error.stack);report.passed=false;throw error;}
finally{await writeFile(path.join(evidenceDir,'acceptance.json'),JSON.stringify(report,null,2));if(report.passed)await rm(work,{recursive:true,force:true,maxRetries:20,retryDelay:250});console.log(JSON.stringify(report));}
