import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest, assetURL, fetchRemoteCatalog, githubBytes, validateRemoteCatalog } from '../src/remote-catalog.mjs';
import { DesktopService } from '../src/desktop-service.mjs';
const repository = 'owner/toolbox';
function fixture(revision = 1, version = '1.0.0') {
  const catalog = { schemaVersion: 1, repository, releaseTag: `v0.1.${revision}`, revision, tools: [{ id: 'sample', name: 'Sample', description: 'Test tool', targets: { 'win32-x64': {
    status: 'verified', version, package: 'sample.zip', releaseTag: `v0.1.${revision}`, releaseUrl: assetURL(repository, `v0.1.${revision}`, 'sample.zip'), sha256: 'a'.repeat(64), launch: { type: 'html', entryPoint: 'index.html' }, evidence: ['Test fixture'], checks: Object.fromEntries(['distribution', 'install', 'launch', 'update', 'uninstall', 'isolation', 'recovery'].map(key => [key, true]))
  } } }] };
  const bytes = Buffer.from(JSON.stringify(catalog));
  const asset = { name: 'catalog.json', state: 'uploaded', browser_download_url: assetURL(repository, catalog.releaseTag, 'catalog.json'), digest: `sha256:${digest(bytes)}`, size: bytes.length };
  const metadata = { id: revision, tag_name: catalog.releaseTag, draft: false, prerelease: false, assets: [asset] };
  return { catalog, bytes, metadata, asset, fetcher: async url => new Response(url.startsWith('https://api.github.com/') ? JSON.stringify(metadata) : bytes) };
}
test('trusted repository metadata authenticates the catalog and package launch descriptors', async () => {
  const f = fixture(); const remote = await fetchRemoteCatalog({ repository }, null, f);
  assert.equal(remote.catalog.tools[0].targets['win32-x64'].version, '1.0.0');
  assert.equal(remote.sha256, digest(f.bytes));
});
test('reject modified catalog bytes, missing API digest and external catalog assets', async () => {
  for (const mutate of [f => { f.asset.digest = `sha256:${'b'.repeat(64)}`; }, f => { delete f.asset.digest; }, f => { f.asset.browser_download_url = 'https://evil.example/catalog.json'; }, f => { f.metadata.draft = true; }, f => { f.metadata.assets.push(f.asset); }]) {
    const f = fixture(); mutate(f); await assert.rejects(fetchRemoteCatalog({ repository }, null, f));
  }
});
test('reject untrusted packages, unsafe launch paths, rollback and same-version binary replacement', async () => {
  const first = await fetchRemoteCatalog({ repository }, null, fixture(2));
  for (const mutate of [c => { c.repository = 'other/toolbox'; }, c => { c.revision = 1; }, c => { c.tools[0].targets['win32-x64'].releaseUrl = 'https://evil.example/sample.zip'; }, c => { c.tools[0].targets['win32-x64'].launch.entryPoint = '../bad'; }, c => { c.tools[0].targets['win32-x64'].sha256 = 'b'.repeat(64); }, c => { c.tools[0].targets['win32-x64'].version = '0.9.0'; }]) {
    const c = fixture(3).catalog; mutate(c); assert.throws(() => validateRemoteCatalog(c, repository, first));
  }
  const reused = fixture(2); reused.metadata.id = 3;
  const previous = { ...first, sha256: 'c'.repeat(64) };
  await assert.rejects(fetchRemoteCatalog({ repository }, previous, reused), /catalogRevisionReused/);
});
test('HTTPS bounds: reject API redirects, cross-host redirects, oversized bodies and failed requests', async () => {
  await assert.rejects(githubBytes('https://api.github.com/repos/owner/toolbox/releases/latest', { fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://api.github.com/other' } }) }), /unsafeCatalogSource/);
  await assert.rejects(githubBytes(assetURL(repository, 'v1.0.0', 'catalog.json'), { fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/catalog.json' } }) }), /unsafeCatalogSource/);
  await assert.rejects(githubBytes('https://github.com/a', { maxBytes: 2, fetcher: async () => new Response('long') }), /catalogTooLarge/);
  await assert.rejects(githubBytes('https://github.com/a', { fetcher: async () => new Response('rate limit', { status: 403 }) }), /catalogUnavailable/);
  let calls = 0;
  assert.equal((await githubBytes('https://github.com/a', { fetcher: async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/a?token=fixture' } }) : new Response('ok') })).toString(), 'ok');
});
test('desktop refresh persists trusted metadata, survives offline restart and preserves installed tools after failure', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toolbox-remote-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const catalogFile = path.join(root, 'bundled.json'), remoteConfigFile = path.join(root, 'remote.json');
  const bundled = fixture().catalog;
  Object.assign(bundled.tools[0].targets['win32-x64'], { status: 'pending', blockers: ['Not published'] });
  await writeFile(catalogFile, JSON.stringify(bundled)); await writeFile(remoteConfigFile, JSON.stringify({ schemaVersion: 1, repository }));
  let f = fixture(), offline = false;
  const options = { root, target: 'win32-x64', catalogFile, remoteConfigFile, locale: 'en', version: 'test', launch: async () => {}, remoteFetch: (config, previous) => { if (offline) throw Error('offline'); return fetchRemoteCatalog(config, previous, f); } };
  let service = await new DesktopService(options).init();
  assert.equal(service.snapshot().tools[0].installable, false);
  await service.check(); assert.equal(service.snapshot().lastCheck.result, 'upToDate'); assert.equal(service.snapshot().tools[0].installable, true);
  await service.close(); offline = true; service = await new DesktopService(options).init(); t.after(() => service.close());
  assert.equal(service.snapshot().catalogSource, 'remote'); assert.equal(service.snapshot().tools[0].installable, true);
  await service.check(); assert.equal(service.snapshot().lastCheck.result, 'checkFailed'); assert.equal(service.snapshot().tools[0].version, '1.0.0');
  offline = false; f = fixture(2, '1.1.0'); await service.check(); assert.equal(service.snapshot().tools[0].version, '1.1.0');
  f = fixture(); await service.check(); assert.equal(service.snapshot().lastCheck.result, 'checkFailed'); assert.equal(service.snapshot().tools[0].version, '1.1.0');
  assert.equal(JSON.parse(await readFile(path.join(root, 'state.json'))).remoteCatalog.revision, 2);
});
