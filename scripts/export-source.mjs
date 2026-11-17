import { execFileSync } from 'node:child_process';
import { mkdir, lstat, copyFile } from 'node:fs/promises';
import path from 'node:path';
const output = process.argv[2];
if (!output || process.argv.length !== 3) throw Error('Usage: npm run source:export -- NEW_DIRECTORY');
const root = process.cwd();
const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { maxBuffer: 16 * 1024 * 1024 }).toString().split('\0').filter(Boolean))];
let ignored = '';
try { ignored = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { input: paths.join('\0') + '\0', maxBuffer: 16 * 1024 * 1024 }).toString(); }
catch (error) { if (error.status !== 1) throw error; }
const excluded = new Set(ignored.split('\0'));
const files = paths.filter(file => !excluded.has(file));
await mkdir(output); // Never overwrite an existing source snapshot.
for (const file of files) {
  if (path.isAbsolute(file) || file.split('/').some(part => ['..', '.git'].includes(part))) throw Error('Unsafe source path');
  const source = path.join(root, file), destination = path.join(output, file);
  if (!(await lstat(source)).isFile()) throw Error(`Only regular source files can be exported: ${file}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
console.log(`Exported ${files.length} public files to ${output}; no Git history copied.`);
