// Real tool payloads, two explicit local package revisions. Never a public release catalog.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipDirectory } from './zip-directory.mjs';
import { sha256 } from '../src/packages.mjs';
const root = process.cwd(), output = path.join(root, 'dist/managed-acceptance');
if (`${process.platform}-${process.arch}` !== 'darwin-arm64') throw new Error('Current acceptance target is darwin-arm64');
const run = (cmd, args, cwd = root) => { const p = spawnSync(cmd, args, { cwd, stdio: 'inherit' }); if (p.status !== 0) throw new Error(`${cmd} failed`); };
const go = process.env.GO || path.join(root, '.build/go/bin/go');
await mkdir(path.join(root, 'tools/rd/bin'), { recursive: true });
run('python3', ['design/build.py'], path.join(root, 'tools/rd'));
run(go, ['build', '-trimpath', '-o', 'bin/pangzhu', './cmd/pangzhu'], path.join(root, 'tools/rd'));
run(process.execPath, ['scripts/build.cjs'], path.join(root, 'tools/designdoc/design-canvas'));
run('bash', ['scripts/build.sh'], path.join(root, 'tools/languagemap'));
run('python3', ['scripts/build-app.py'], path.join(root, 'tools/linkparsing'));
run('python3', ['scripts/bundle-runtime.py'], path.join(root, 'tools/linkparsing'));
const specifications = {
  rd: { source: 'tools/rd/bin/pangzhu', destination: 'pangzhu', toolVersion: '0.2.2', launch: { type: 'loopback', entryPoint: 'pangzhu', readiness: 'toolbox-v1', args: ['--host','127.0.0.1','--port','0','--data-dir','{dataDir}','--updates','off'] } },
  designdoc: { source: 'tools/designdoc/Forma.html', destination: 'Forma.html', toolVersion: '2.1.0', launch: { type: 'html', entryPoint: 'Forma.html' } },
  languagemap: { source: 'tools/languagemap/dist/LanguageMap.app', destination: 'LanguageMap.app', toolVersion: '1.0.0', launch: { type: 'native', readiness: 'toolbox-v1', entryPoint: 'LanguageMap.app/Contents/MacOS/LanguageMap' } },
  linkparsing: { source: 'tools/linkparsing/build/LinkParsing.app', destination: 'LinkParsing.app', toolVersion: '0.3.0', launch: { type: 'native', readiness: 'toolbox-v1', entryPoint: 'LinkParsing.app/Contents/MacOS/LinkParsing' } }
};
await mkdir(output, { recursive: true });
const artifacts = [];
for (const [id, spec] of Object.entries(specifications)) {
  const payload = path.join(output, id);
  await rm(payload, { recursive: true, force: true }); await mkdir(payload);
  await cp(path.join(root, spec.source), path.join(payload, spec.destination), { recursive: true, dereference: true });
  if (id === 'linkparsing') {
    const runtime = JSON.parse(await readFile(path.join(payload, spec.destination, 'Contents/Resources/runtime-manifest.json'), 'utf8'));
    if (runtime.target !== 'darwin-arm64') throw new Error('Portable runtime not prepared');
  }
  for (const revision of ['0.0.1','0.0.2']) {
    await writeFile(path.join(payload,'toolbox-package.json'), JSON.stringify({ id, packageRevision: revision, toolVersion: spec.toolVersion, scope: 'local lifecycle acceptance; same source, distinct package revisions' }) + '\n');
    const file = path.join(output, `${id}-${revision}.zip`);
    await zipDirectory(payload, file);
    artifacts.push({ id, version: revision, toolVersion: spec.toolVersion, file, sha256: await sha256(file), launch: spec.launch });
    console.log(`Packaged ${id} revision ${revision}`);
  }
}
await writeFile(path.join(output, 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n');
