import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, chmod } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import yauzl from 'yauzl';

export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 220 || value.includes('\\') || value.includes('\0') || /[:<>"|?*]/.test(value) || value.startsWith('/')) throw new Error('unsafePackage');
  const parts = value.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('unsafePackage');
  return parts.join('/');
}
export function launchSpec(value) {
  if (!value || !['native', 'html', 'loopback'].includes(value.type)) throw new Error('invalidLaunch');
  const entryPoint = safeRelative(value.entryPoint);
  if (value.type === 'html' && !/\.html?$/i.test(entryPoint)) throw new Error('invalidLaunch');
  const args = value.args ?? [];
  if (!Array.isArray(args) || args.length > 20 || args.some(arg => typeof arg !== 'string' || arg.length > 1024 || arg.includes('\0'))) throw new Error('invalidLaunch');
  if (value.readiness !== undefined && value.readiness !== 'toolbox-v1') throw new Error('invalidLaunch');
  if (value.type === 'loopback' && value.readiness !== 'toolbox-v1') throw new Error('invalidLaunch');
  return { type: value.type, entryPoint, args, ...(value.readiness ? { readiness: value.readiness } : {}) };
}
export async function sha256(file) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
export async function downloadPackage(url, destination, { signal, onProgress = () => {}, maxBytes = 1024 * 1024 * 1024 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('unsafeSource');
  // GitHub releases can redirect only to GitHub's asset CDN. Other sources are
  // used by isolated acceptance fixtures; all redirects remain HTTPS and bounded.
  const github = parsed.hostname === 'github.com';
  let response, current = parsed;
  for (let hop = 0; hop < 6; hop++) {
    response = await fetch(current, { redirect: 'manual', signal });
    if (![301,302,303,307,308].includes(response.status)) break;
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location) throw new Error('downloadFailed');
    current = new URL(location, current);
    if (current.protocol !== 'https:' || current.username || current.password || current.hash ||
        (github && (current.port || !['github.com', 'release-assets.githubusercontent.com'].includes(current.hostname)))) throw new Error('unsafeSource');
  }
  if (!response?.ok || !response.body) throw new Error('downloadFailed');
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > maxBytes) { await response.body.cancel(); throw new Error('packageTooLarge'); }
  let received = 0;
  const limit = new Transform({ transform(chunk, encoding, callback) {
    received += chunk.length;
    if (received > maxBytes) return callback(new Error('packageTooLarge'));
    onProgress(total ? Math.min(99, Math.round(received / total * 100)) : null);
    callback(null, chunk);
  }});
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
}
export async function extractPackage(file, destination, { signal, maxBytes = 2 * 1024 * 1024 * 1024, maxFiles = 20000 } = {}) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (err, archive) => err ? reject(err) : resolve(archive)));
  let files = 0, bytes = 0;
  const names = new Set();
  await mkdir(destination, { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', resolve);
    zip.on('entry', async entry => {
      try {
        signal?.throwIfAborted();
        const relative = safeRelative(entry.fileName);
        const mode = entry.externalFileAttributes >>> 16;
        const kind = mode & 0o170000;
        if ((kind && ![0o100000,0o040000].includes(kind)) || (entry.generalPurposeBitFlag & 1)) throw new Error('unsafePackage');
        if (names.has(relative.toLowerCase())) throw new Error('unsafePackage'); names.add(relative.toLowerCase());
        if (++files > maxFiles || (bytes += entry.uncompressedSize) > maxBytes) throw new Error('packageTooLarge');
        const output = path.join(destination, relative);
        if (entry.fileName.endsWith('/')) await mkdir(output, { recursive: true });
        else {
          await mkdir(path.dirname(output), { recursive: true });
          const stream = await new Promise((res, rej) => zip.openReadStream(entry, (err, source) => err ? rej(err) : res(source)));
          await pipeline(stream, createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal });
          await chmod(output, mode & 0o111 ? 0o700 : 0o600);
        }
        zip.readEntry();
      } catch (error) { fail(error); }
    }); zip.readEntry();
  });
}
