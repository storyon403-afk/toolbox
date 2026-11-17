import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listAvailability, validateCatalog, TARGETS } from '../src/catalog.mjs';

const catalog = JSON.parse(await readFile(new URL('../catalog/tools.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(catalog);

test('fresh catalog exposes four candidates but downloads or enables none on any target', () => {
  for (const target of TARGETS) {
    const rows = listAvailability(catalog, target);
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => !row.installable && row.reasons.length));
  }
});
test('versions are platform-specific: LanguageMap macOS 1.0.0 and Windows 1.1.0', () => {
  assert.equal(listAvailability(catalog, 'darwin-arm64').find(t => t.id === 'languagemap').version, '1.0.0');
  assert.equal(listAvailability(catalog, 'win32-x64').find(t => t.id === 'languagemap').version, '1.1.0');
});
test('Windows LinkParse candidate stays gated until trusted public distribution exists', () => {
  const row = listAvailability(catalog, 'win32-x64').find(t => t.id === 'linkparsing');
  assert.equal(row.status, 'pending');
  assert.equal(row.version, '0.1.0');
  assert.equal(listAvailability(catalog, 'win32-arm64').find(t => t.id === 'linkparsing').status, 'unsupported');
  assert.equal(row.installable, false);
});
test('a Ready label cannot bypass lifecycle verification', () => {
  const input = copy();
  input.tools[0].targets['darwin-arm64'].status = 'verified';
  assert.throws(() => validateCatalog(input), /Incomplete verification/);
});
test('reject duplicate and filesystem-unsafe IDs', () => {
  for (const id of ['../rd', 'C:\\rd', 'rd/other', 'RD', catalog.tools[1].id]) {
    const input = copy();
    input.tools[0].id = id;
    assert.throws(() => validateCatalog(input), /tool ID/);
  }
});
test('unknown platform and undocumented availability fail closed', () => {
  assert.throws(() => listAvailability(catalog, 'linux-x64'), /Unsupported/);
  const input = copy();
  delete input.tools[0].targets['darwin-arm64'];
  assert.equal(listAvailability(input, 'darwin-arm64')[0].installable, false);
});
test('blocked packages must include an actionable reason', () => {
  const input = copy();
  input.tools[0].targets['darwin-arm64'].blockers = [];
  assert.throws(() => validateCatalog(input), /Missing reason/);
});
test('verified metadata requires all checks and an HTTPS release with a SHA-256', () => {
  const input = copy();
  const entry = input.tools[0].targets['darwin-arm64'];
  Object.assign(entry, {status:'verified', version:'1.0.0', releaseUrl:'https://example.com/tool.zip', sha256:'a'.repeat(64), evidence:['Synthetic fixture only'], checks:Object.fromEntries(['distribution','install','launch','update','uninstall','isolation','recovery'].map(k=>[k,true]))});
  delete entry.blockers;
  assert.equal(listAvailability(input, 'darwin-arm64')[0].installable, true);
  for (const url of ['http://example.com/tool.zip', 'file:///tmp/tool.zip', 'https://user:secret@example.com/tool.zip']) {
    entry.releaseUrl = url;
    assert.throws(() => validateCatalog(input), /release identity/);
  }
});
