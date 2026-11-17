import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { StateStore } from './state.mjs';
import { Lifecycle } from './lifecycle.mjs';
import { validateCatalog } from './catalog.mjs';
import { digest, fetchRemoteCatalog, repositoryName, validateRemoteCatalog } from './remote-catalog.mjs';
const DAY = 86400000;
export class DesktopService extends EventEmitter {
  constructor({ root, target, catalogFile, remoteConfigFile, remoteFetch = fetchRemoteCatalog, locale, version, launch, notify = () => {} }) {
    super(); Object.assign(this, { root, target, catalogFile, remoteConfigFile, remoteFetch, locale, version, launch, notify });
  }
  async init() {
    this.store = await new StateStore(this.root).init();
    this.catalog = validateCatalog(JSON.parse(await readFile(this.catalogFile, 'utf8')));
    this.catalogSource = 'bundled';
    this.remoteConfig = this.remoteConfigFile ? JSON.parse(await readFile(this.remoteConfigFile, 'utf8')) : { schemaVersion: 1, repository: null };
    if (this.remoteConfig.schemaVersion !== 1) throw Error('invalidRemoteConfiguration');
    if (this.remoteConfig.repository !== null) repositoryName(this.remoteConfig.repository);
    const cached = this.store.data.remoteCatalog;
    if (this.remoteConfig.repository && cached?.repository === this.remoteConfig.repository) {
      try {
        if (typeof cached.raw !== 'string' || digest(cached.raw) !== cached.sha256) throw Error('invalidCatalogCache');
        const catalog = validateRemoteCatalog(JSON.parse(cached.raw), this.remoteConfig.repository);
        if (catalog.revision !== cached.revision) throw Error('invalidCatalogCache');
        this.catalog = catalog; this.remoteCatalog = { ...cached, catalog }; this.catalogSource = 'remote';
      } catch { /* Keep bundled metadata if the local cache is damaged. */ }
    }
    this.lifecycle = new Lifecycle({ root: this.root, store: this.store, catalog: this.catalog, target: this.target, launch: this.launch });
    await this.lifecycle.recover();
    this.lifecycle.on('change', () => this.emit('change', this.snapshot()));
    this.lifecycle.on('stopped', id => {
      if (this.store.data.settings.installs && this.lifecycle.prepared.has(id)) this.lifecycle.install(id).catch(() => {});
    });
    this.timer = setInterval(() => this.tick().catch(() => {}), 60000); this.timer.unref();
    return this;
  }
  snapshot() {
    return { version: this.version, target: this.target, locale: this.locale, settings: this.store.snapshot().settings, tools: this.lifecycle.snapshot(), lastCheck: this.store.data.lastCheck, catalogSource: this.catalogSource, recovered: !!this.store.recovered };
  }
  async settings(patch) { await this.store.setSettings(patch); this.emit('change', this.snapshot()); return this.snapshot(); }
  async tick(now = Date.now()) {
    const previous = Date.parse(this.store.data.lastCheck?.at ?? '') || 0;
    if (this.store.data.settings.daily && (now - previous >= DAY || previous > now)) await this.check();
  }
  async check() {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      let result = 'bundledOnly';
      try {
        let catalog;
        if (this.remoteConfig.repository) {
          const remote = await this.remoteFetch(this.remoteConfig, this.remoteCatalog);
          const { catalog: verified, ...cache } = remote;
          await this.store.change(state => { state.remoteCatalog = cache; });
          this.remoteCatalog = remote; catalog = verified; this.catalogSource = 'remote'; result = 'upToDate';
        } else catalog = validateCatalog(JSON.parse(await readFile(this.catalogFile, 'utf8')));
        this.catalog = catalog; this.lifecycle.catalog = catalog;
        const updates = this.lifecycle.snapshot().filter(tool => tool.state === 'updateAvailable');
        if (updates.length) this.notify(updates.length, this.store.data.settings.language || this.locale);
        for (const tool of updates) if (this.store.data.settings.downloads) {
          await this.lifecycle.install(tool.id, { prepare: !this.store.data.settings.installs || this.lifecycle.running.has(tool.id) }).catch(() => {});
          if (this.store.data.settings.installs && this.lifecycle.prepared.has(tool.id) && !this.lifecycle.running.has(tool.id)) await this.lifecycle.install(tool.id).catch(() => {});
        }
      } catch { result = 'checkFailed'; }
      await this.store.change(state => { state.lastCheck = { at: new Date().toISOString(), result }; });
      this.emit('change', this.snapshot()); return this.snapshot();
    })();
    try { return await this.checking; } finally { this.checking = null; }
  }
  async close() { clearInterval(this.timer); await this.checking?.catch(() => {}); await this.lifecycle.close(); await this.store.queue; }
}
