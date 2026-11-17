import { zipDirectory } from './zip-directory.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [id,target] = process.argv.slice(2);
const root = process.cwd(); const cwd = path.join(root,'tools',id || '');
const run = (command,args,folder=cwd) => { const result=spawnSync(command,args,{cwd:folder,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1); };
switch(id) {
 case 'rd': {
  const targets={ 'darwin-arm64':'darwin-arm64','darwin-x64':'darwin-amd64','win32-x64':'windows-amd64','win32-arm64':'windows-arm64' };
  if(target && !targets[target]) throw new Error('Unsupported RD target');
  run('python3',['design/build.py']);
  run('python3',['scripts/package_release.py','--skip-source',...(target?['--platform',targets[target]]:[])]);break;
 }
 case 'designdoc': {
  run(process.execPath,['scripts/build.cjs'],path.join(cwd,'design-canvas'));
  const version=JSON.parse(await readFile(path.join(cwd,'design-canvas/package.json'),'utf8')).version;
  const directory=path.join(root,'dist',`DesignDoc-${version}-standalone`);await mkdir(directory,{recursive:true});
  await copyFile(path.join(cwd,'Forma.html'),path.join(directory,'Forma.html'));
  await copyFile(path.join(cwd,'design-canvas/README.md'),path.join(directory,'README.md'));
  await zipDirectory(directory,path.join(root,'dist',`DesignDoc-${version}-standalone.zip`));
  console.log(`Built standalone DesignDoc ${version}`);break;
 }
 case 'languagemap':
  if(!target || target==='darwin-arm64')run('bash',['scripts/build.sh']);
  else if(['win32-x64','win32-arm64'].includes(target))run('bash',['scripts/build-windows.sh',target.slice(6)]);
  else throw new Error('No LanguageMap Intel Mac package');break;
 case 'linkparsing':
  if(target==='win32-x64') {
   if(process.platform!=='win32' || process.arch!=='x64')throw new Error('Build LinkParse Windows x64 on the native Windows test host; see tools/linkparsing/windows/README.md');
   run('cargo',['build','--locked','--release','--workspace']);
   run(process.env.LINKPARSING_BUILD_PYTHON || 'python',['scripts/package-windows.py',...process.argv.slice(4)]);break;
  }
  if((target && target!=='darwin-arm64') || process.platform!=='darwin' || process.arch!=='arm64')throw new Error('LinkParsing runtime packaging currently verifies macOS arm64 only');
  run('python3',['scripts/build-app.py']);
  run('python3',['scripts/bundle-runtime.py']);break;
 default:throw new Error('Usage: npm run tool:build -- rd|designdoc|languagemap|linkparsing [target]');
}
