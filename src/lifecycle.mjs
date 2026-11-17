import { EventEmitter } from 'node:events';
import { mkdir, rm, rename, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateCatalog, listAvailability } from './catalog.mjs';
import { downloadPackage, extractPackage, launchSpec, sha256 } from './packages.mjs';

const validID = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
const validVersion = version => typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);
const newer = (a, b) => a.localeCompare(b, undefined, { numeric: true }) > 0;
export class Lifecycle extends EventEmitter {
  constructor({ root, store, catalog, target, download = downloadPackage, extract = extractPackage, launch }) {
    super(); Object.assign(this, { root, store, catalog: validateCatalog(catalog), target, download, extract, launch });
    this.active = new Map(); this.running = new Map(); this.prepared = new Map(); this.errors = new Map();
  }
  toolRoot(id) { if (!validID(id)) throw new Error('invalidTool'); return path.join(this.root, 'tools', id); }
  binary(id, version) { if (!validVersion(version)) throw new Error('invalidVersion'); return path.join(this.toolRoot(id), 'versions', version); }
  record(id) {
    const record = this.store.data.installations[id];
    if (!record) return null;
    if (!validVersion(record.version)) throw new Error('invalidRecord');
    return { ...record, launch: launchSpec(record.launch) };
  }
  release(id) {
    if (!validID(id)) throw new Error('invalidTool');
    const tool = this.catalog.tools.find(tool => tool.id === id);
    const release = tool?.targets[this.target];
    if (!release || release.status !== 'verified') throw new Error('unverifiedPackage');
    return { ...release, launch: launchSpec(release.launch) };
  }
  snapshot() {
    return listAvailability(this.catalog, this.target).map(row => {
      let record; try { record = this.record(row.id); } catch { this.errors.set(row.id, 'invalidRecord'); }
      const active = this.active.get(row.id);
      const update = record && row.installable && newer(row.version, record.version);
      let installable = row.installable; try { if (installable) this.release(row.id); } catch { installable = false; }
      return { ...row, installable, installedVersion: record?.version ?? null, state: active?.state ?? (this.running.has(row.id) ? 'running' : update ? 'updateAvailable' : record ? 'installed' : 'notInstalled'), progress: active?.progress ?? null, prepared: this.prepared.has(row.id), error: this.errors.get(row.id) ?? null };
    });
  }
  changed() { this.emit('change', this.snapshot()); }
  async recover() {
    for (const id of Object.keys(this.store.data.installations)) {
      if (!validID(id)) continue;
      const directory = this.toolRoot(id);
      const entries = await readdir(directory).catch(() => []);
      const removed = entries.filter(name => /^removed-[a-f0-9-]{36}$/.test(name));
      if (!entries.includes('versions') && removed.length === 1) await rename(path.join(directory, removed[0]), path.join(directory, 'versions'));
    }
    for (const tool of this.catalog.tools) {
      if (this.store.data.installations[tool.id]) continue;
      const directory = this.toolRoot(tool.id);
      for (const name of await readdir(directory).catch(() => [])) if (/^removed-[a-f0-9-]{36}$/.test(name)) await rm(path.join(directory, name), { recursive: true, force: true });
    }
    // Only cleanup named owned temporary directories. Committed installations/data survive.
    await mkdir(path.join(this.root, 'staging'), { recursive: true, mode: 0o700 });
    for (const name of await readdir(path.join(this.root, 'staging'))) if (/^[a-f0-9-]{36}$/.test(name)) await rm(path.join(this.root, 'staging', name), { recursive: true, force: true });
    for (const id of Object.keys(this.store.data.installations)) {
      try {
        const record = this.record(id);
        if (!(await stat(path.join(this.binary(id, record.version), record.launch.entryPoint))).isFile()) throw new Error('missingExecutable');
      } catch { this.errors.set(id, 'missingExecutable'); }
    }
  }
  async install(id, { prepare = false } = {}) {
    const release = this.release(id);
    if (this.active.has(id) || (this.running.has(id) && !prepare)) throw new Error('toolBusy');
    const old = this.record(id);
    if (old && !newer(release.version, old.version)) throw new Error('alreadyInstalled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000); timer.unref?.();
    const job = { state: 'downloading', progress: null, controller };
    this.active.set(id, job); this.errors.delete(id); this.changed();
    const staging = path.join(this.root, 'staging', randomUUID());
    try {
      let prepared = this.prepared.get(id);
      if (!prepared || prepared.sha256 !== release.sha256) {
        await mkdir(staging, { recursive: true, mode: 0o700 });
        const archive = path.join(staging, 'package.zip');
        await this.download(release.releaseUrl, archive, { signal: controller.signal, onProgress: progress => { job.progress = progress; this.changed(); } });
        if (await sha256(archive) !== release.sha256) throw new Error('checksumMismatch');
        job.state = 'installing'; job.progress = null; this.changed();
        await this.extract(archive, path.join(staging, 'payload'), { signal: controller.signal });
        const entry = path.join(staging, 'payload', release.launch.entryPoint);
        if (!(await stat(entry)).isFile()) throw new Error('missingExecutable');
        controller.signal.throwIfAborted();
        prepared = { staging, sha256: release.sha256 };
      }
      if (prepare) { this.prepared.set(id, prepared); return; }
      controller.signal.throwIfAborted();
      const destination = this.binary(id, release.version);
      await mkdir(path.dirname(destination), { recursive: true });
      // An unrecorded same-version directory can only be an interrupted staged commit.
      await rm(destination, { recursive: true, force: true });
      await rename(path.join(prepared.staging, 'payload'), destination);
      await mkdir(path.join(this.toolRoot(id), 'data'), { recursive: true, mode: 0o700 });
      // Record is the commit point. A failed write leaves the previous active version intact.
      await this.store.change(state => { state.installations[id] = { version: release.version, launch: release.launch, installedAt: new Date().toISOString() }; });
      this.prepared.delete(id);
      await rm(prepared.staging, { recursive: true, force: true });
    } catch (error) {
      const pending = this.prepared.get(id);
      if (pending) { await rm(pending.staging, { recursive: true, force: true }); this.prepared.delete(id); }
      this.errors.set(id, controller.signal.aborted ? 'cancelled' : error.message);
      throw error;
    } finally {
      clearTimeout(timer);
      if (!prepare || !this.prepared.has(id)) await rm(staging, { recursive: true, force: true });
      this.active.delete(id); this.changed();
    }
  }
  cancel(id) { this.active.get(id)?.controller?.abort(); }
  async open(id) {
    if (this.active.has(id)) throw new Error('toolBusy');
    const existing = this.running.get(id); if (existing) { existing.focus?.(); return; }
    const record = this.record(id); if (!record || this.errors.get(id) === 'missingExecutable') throw new Error('missingExecutable');
    const job = { state: 'opening' }; this.active.set(id, job); this.changed();
    try {
      const handle = await this.launch({ id, ...record, directory: this.binary(id, record.version), dataDir: path.join(this.toolRoot(id), 'data') });
      this.running.set(id, handle); this.errors.delete(id);
      const stopped = () => { if (this.running.get(id) === handle) this.running.delete(id); this.changed(); this.emit('stopped', id); };
      handle.closed.then(stopped, stopped);
    } catch (error) { this.errors.set(id, 'launchFailed'); throw error; }
    finally { this.active.delete(id); this.changed(); }
  }
  async uninstall(id) {
    if (this.running.has(id) || this.active.has(id)) throw new Error('toolBusy');
    if (!this.record(id)) throw new Error('notInstalled');
    this.active.set(id, { state: 'removing' }); this.changed();
    const versions = path.join(this.toolRoot(id), 'versions');
    const trash = path.join(this.toolRoot(id), `removed-${randomUUID()}`);
    try {
      await rename(versions, trash);
      try { await this.store.change(state => { delete state.installations[id]; }); }
      catch (error) { await rename(trash, versions); throw error; }
      await rm(trash, { recursive: true, force: true });
      const prepared = this.prepared.get(id); if (prepared) await rm(prepared.staging, { recursive: true, force: true });
      this.prepared.delete(id); this.errors.delete(id);
    } finally { this.active.delete(id); this.changed(); }
  }
  async close() { for (const job of this.active.values()) job.controller?.abort(); for (const handle of this.running.values()) await handle.stop?.(); }
}
