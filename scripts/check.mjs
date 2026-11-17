import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['design/v02/app.js','design/v02/locales.js'];
for (const folder of ['src','desktop','scripts']) for (const file of await readdir(folder)) if (/\.(mjs|cjs|js)$/.test(file)) files.push(`${folder}/${file}`);
for (const file of files) { const result = spawnSync(process.execPath,['--check',file],{stdio:'inherit'}); if (result.status) process.exit(result.status); }
console.log(`Syntax checked ${files.length} files`);
