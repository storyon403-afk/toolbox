import { readFile, mkdir, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fetchRemoteCatalog } from '../src/remote-catalog.mjs';
import { downloadPackage, extractPackage, launchSpec, sha256 } from '../src/packages.mjs';
const config = JSON.parse(await readFile('catalog/remote.json', 'utf8'));
const remote = await fetchRemoteCatalog(config);
const work = await mkdtemp(path.join(os.tmpdir(), 'toolbox-public-release-'));
const report = { repository: config.repository, tag: remote.catalog.releaseTag, revision: remote.revision, artifacts: [], passed: false, scope: 'Public catalog and package transport, digest, extraction and entry points; no native execution or update acceptance' };
try {
  for (const tool of remote.catalog.tools) for (const [target, release] of Object.entries(tool.targets)) {
    if (release.status !== 'verified') continue;
    const file = path.join(work, `${tool.id}-${target}.zip`), folder = path.join(work, `${tool.id}-${target}`);
    await downloadPackage(release.releaseUrl, file, { signal: AbortSignal.timeout(300000) });
    if (await sha256(file) !== release.sha256) throw Error(`Checksum mismatch: ${tool.id}/${target}`);
    await extractPackage(file, folder);
    const launch = launchSpec(release.launch);
    if (!(await stat(path.join(folder, launch.entryPoint))).isFile()) throw Error(`Missing entry point: ${tool.id}/${target}`);
    report.artifacts.push({ id: tool.id, target, version: release.version, sha256: release.sha256, passed: true });
  }
  if (!report.artifacts.length) throw Error('No enabled public packages');
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/public-release.json', JSON.stringify(report, null, 2) + '\n');
  await rm(work, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
