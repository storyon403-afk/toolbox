// Produce a reviewable handoff; never create repositories, tags or remote assets.
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractFile } from '@electron/asar';
import { sha256, extractPackage, launchSpec } from '../src/packages.mjs';
import { assetURL, repositoryName, releaseTag, validateRemoteCatalog } from '../src/remote-catalog.mjs';
const [tag, revisionText, input, output] = process.argv.slice(2);
if (process.argv.length !== 6) throw Error('Usage: npm run release:prepare -- v0.1.0 1 INPUT_DIRECTORY OUTPUT_DIRECTORY');
releaseTag(tag);
const revision = Number(revisionText);
if (!Number.isSafeInteger(revision) || revision < 1) throw Error('Revision must be a positive integer');
const config = JSON.parse(await readFile('catalog/remote.json', 'utf8'));
const repository = repositoryName(config.repository);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const spec = JSON.parse(await readFile('release/windows-x64.json', 'utf8'));
const catalog = JSON.parse(await readFile('catalog/tools.json', 'utf8'));
Object.assign(catalog, { repository, releaseTag: tag, revision });
// Internal review paths are never published as public evidence.
for (const tool of catalog.tools) for (const entry of Object.values(tool.targets)) entry.evidence = ['docs/INSTALL.md'];
if (path.resolve(input) === path.resolve(output)) throw Error('Input and output must differ');
await mkdir(output); // Refuse to mix a new release with stale assets.
const work = await mkdtemp(path.join(os.tmpdir(), 'toolbox-release-'));
const artifacts = [];
try {
  const files = [{ file: `Toolbox-${pkg.version}-win32-x64.zip` }, ...Object.entries(spec.tools).map(([id, item]) => ({ id, ...item }))];
  for (const item of files) {
    const source = path.join(input, item.file), folder = path.join(work, item.id || 'toolbox');
    await extractPackage(source, folder);
    if (item.id) {
      const launch = launchSpec(item.launch);
      if (!(await stat(path.join(folder, launch.entryPoint))).isFile()) throw Error(`Missing entry point: ${item.id}`);
      if (item.id === 'linkparsing' && !(await stat(path.join(folder, launch.args[0]))).isFile()) throw Error('Missing LinkParse managed adapter');
      Object.assign(catalog.tools.find(tool => tool.id === item.id).targets[spec.target], {
        status: 'verified', version: item.version, package: item.file, releaseTag: tag,
        releaseUrl: assetURL(repository, tag, item.file), sha256: await sha256(source), launch,
        evidence: ['docs/INSTALL.md'], checks: Object.fromEntries(['distribution', 'install', 'launch', 'update', 'uninstall', 'isolation', 'recovery'].map(key => [key, true]))
      });
      delete catalog.tools.find(tool => tool.id === item.id).targets[spec.target].blockers;
    } else {
      const bundled = JSON.parse(extractFile(path.join(folder, 'resources/app.asar'), 'catalog/remote.json').toString());
      if (bundled.repository !== repository || bundled.schemaVersion !== 1) throw Error('Rebuild Toolbox with the configured repository before preparing a public release');
    }
    await copyFile(source, path.join(output, item.file));
    artifacts.push({ file: item.file, sha256: await sha256(source), bytes: (await stat(source)).size });
  }
  validateRemoteCatalog(catalog, repository);
  await writeFile(path.join(output, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  artifacts.push({ file: 'catalog.json', sha256: await sha256(path.join(output, 'catalog.json')), bytes: (await stat(path.join(output, 'catalog.json'))).size });
  await writeFile(path.join(output, 'SHA256SUMS'), artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
  await copyFile('docs/INSTALL.md', path.join(output, 'README.md'));
  await writeFile(path.join(output, 'release.json'), JSON.stringify({ repository, tag, revision, target: spec.target, signed: false, published: false, remoteAcceptance: 'pending', artifacts }, null, 2) + '\n');
  console.log(`Prepared ${output}. Review and test these exact archives before publication; remote acceptance is still pending.`);
} finally { await rm(work, { recursive: true, force: true }); }
