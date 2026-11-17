import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_SETTINGS = Object.freeze({ language: null, daily: true, downloads: false, installs: false, motion: true });
export function settingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalidSettings');
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key) || (key === 'language' ? !['zh-CN', 'ja', 'en'].includes(value) : typeof value !== 'boolean')) throw new Error('invalidSettings');
  }
  const next = { ...current, ...patch };
  if (patch.installs === true && !next.downloads) throw new Error('downloadRequired');
  if (!next.downloads) next.installs = false;
  return next;
}
export async function atomicJSON(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}
export class StateStore {
  constructor(root) { this.root = root; this.file = path.join(root, 'state.json'); this.queue = Promise.resolve(); }
  async init() {
    this.data = { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, installations: {}, lastCheck: null };
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.schemaVersion !== 1 || !saved.installations || typeof saved.installations !== 'object' || Array.isArray(saved.installations)) throw new Error('Invalid state');
      const settings = { ...saved.settings }; if (settings.language === null) delete settings.language;
      saved.settings = settingsPatch(DEFAULT_SETTINGS, settings);
      this.data = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await copyFile(this.file, `${this.file}.corrupt-${randomUUID()}`);
        this.recovered = true;
      }
    }
    await atomicJSON(this.file, this.data);
    return this;
  }
  snapshot() { return structuredClone(this.data); }
  change(update) {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.data);
      await update(next);
      await atomicJSON(this.file, next);
      this.data = next;
      return this.snapshot();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  setSettings(patch) { return this.change(state => { state.settings = settingsPatch(state.settings, patch); }); }
}
