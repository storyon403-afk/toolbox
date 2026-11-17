import { createHash } from 'node:crypto';
import { validateCatalog } from './catalog.mjs';
import { launchSpec } from './packages.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function repositoryName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) || value.length > 140) throw Error('invalidRepository');
  return value;
}
export function releaseTag(value) {
  if (typeof value !== 'string' || !/^v\d+\.\d+\.\d+$/.test(value)) throw Error('invalidReleaseTag');
  return value;
}
export function assetURL(repository, tag, name) {
  repositoryName(repository); releaseTag(tag);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw Error('invalidAssetName');
  return `https://github.com/${repository}/releases/download/${tag}/${name}`;
}
// Repository ownership over GitHub HTTPS is the trust root, not a JSON verified flag.
// No bearer token, user-selected URL, system certificate bypass or signing key is used.
export async function githubBytes(url, { fetcher = fetch, signal = AbortSignal.timeout(30000), maxBytes = 2 * 1024 * 1024 } = {}) {
  let current = new URL(url);
  const api = current.hostname === 'api.github.com';
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== 'https:' || current.port || current.username || current.password || current.hash ||
        !(api ? current.hostname === 'api.github.com' : ['github.com', 'release-assets.githubusercontent.com'].includes(current.hostname))) throw Error('unsafeCatalogSource');
    const response = await fetcher(current.href, { redirect: 'manual', signal, headers: { Accept: api ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'Toolbox', ...(api ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}) } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (api || !location) throw Error('unsafeCatalogSource');
      current = new URL(location, current); continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('catalogUnavailable'); }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw Error('catalogTooLarge'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw Error('catalogTooLarge');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('catalogRedirectLimit');
}

export function validateRemoteCatalog(catalog, repository, previous) {
  validateCatalog(catalog); repositoryName(repository);
  if (catalog.repository !== repository || !Number.isSafeInteger(catalog.revision) || catalog.revision < 1) throw Error('invalidCatalogIdentity');
  releaseTag(catalog.releaseTag);
  if (previous?.repository === repository && catalog.revision < previous.revision) throw Error('catalogRollback');
  const previousTools = previous?.catalog?.tools ?? [];
  for (const tool of catalog.tools) for (const [target, entry] of Object.entries(tool.targets)) {
    if (entry.status !== 'verified') continue;
    launchSpec(entry.launch);
    if (entry.releaseUrl !== assetURL(repository, entry.releaseTag, entry.package)) throw Error('untrustedRelease');
    const old = previousTools.find(item => item.id === tool.id)?.targets[target];
    if (old?.status === 'verified') {
      if (entry.version.localeCompare(old.version, undefined, { numeric: true }) < 0) throw Error('catalogRollback');
      if (old.version === entry.version && (old.sha256 !== entry.sha256 || JSON.stringify(old.launch) !== JSON.stringify(entry.launch))) throw Error('versionReused');
    }
  }
  return catalog;
}

export async function fetchRemoteCatalog(config, previous, options = {}) {
  const repository = repositoryName(config.repository);
  const metadata = JSON.parse(await githubBytes(`https://api.github.com/repos/${repository}/releases/latest`, options));
  if (metadata.draft !== false || metadata.prerelease !== false || !Number.isSafeInteger(metadata.id)) throw Error('invalidRelease');
  releaseTag(metadata.tag_name);
  const assets = metadata.assets?.filter(asset => asset.name === 'catalog.json');
  if (assets?.length !== 1) throw Error('missingCatalog');
  const asset = assets[0];
  if (asset.state !== 'uploaded' || asset.browser_download_url !== assetURL(repository, metadata.tag_name, 'catalog.json') || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) throw Error('invalidCatalogAsset');
  const bytes = await githubBytes(asset.browser_download_url, options);
  const hash = digest(bytes);
  if (`sha256:${hash}` !== asset.digest || bytes.length !== asset.size) throw Error('catalogChecksumMismatch');
  const catalog = validateRemoteCatalog(JSON.parse(bytes), repository, previous);
  if (catalog.releaseTag !== metadata.tag_name) throw Error('invalidCatalogIdentity');
  if (previous?.repository === repository && catalog.revision === previous.revision && hash !== previous.sha256) throw Error('catalogRevisionReused');
  return { repository, revision: catalog.revision, sha256: hash, catalog, raw: bytes.toString('utf8') };
}
