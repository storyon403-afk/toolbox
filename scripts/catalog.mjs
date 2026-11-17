import { readFile } from 'node:fs/promises';
import { listAvailability, TARGETS } from '../src/catalog.mjs';

try {
  const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
  if (process.argv.length > 3 || !TARGETS.includes(target)) throw new Error(`Usage: npm run catalog -- <${TARGETS.join('|')}>`);
  const catalog = JSON.parse(await readFile(new URL('../catalog/tools.json', import.meta.url), 'utf8'));
  console.table(listAvailability(catalog, target).map(({ name, status, version, reasons }) => ({
    tool: name, status, version: version ?? 'Unversioned', reason: reasons.join(' ')
  })));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
