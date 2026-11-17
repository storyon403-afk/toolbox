import { writeFile } from 'node:fs/promises';
import { repositoryName } from '../src/remote-catalog.mjs';
const repository = repositoryName(process.argv[2]);
if (process.argv.length !== 3) throw Error('Usage: npm run release:configure -- OWNER/REPO');
await writeFile('catalog/remote.json', JSON.stringify({ schemaVersion: 1, repository }, null, 2) + '\n');
console.log(`Configured GitHub repository ${repository}. Rebuild Toolbox before staging a release. No remote write performed.`);
