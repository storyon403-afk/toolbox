import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const stage = path.join(root, 'build/app');
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, 'ui/assets/ui'), { recursive: true });
for (const directory of ['desktop','src','catalog']) await cp(path.join(root, directory), path.join(stage, directory), { recursive: true });
const design = path.join(root, 'design/v02');
for (const file of ['index.html','app.js','locales.js','style.css','fonts.css','favicon.svg','media']) await cp(path.join(design,file),path.join(stage,'ui',file),{recursive:true});
for (const file of ['system.css','system.js','motion','ui/cards.css']) await cp(path.join(design,'assets',file),path.join(stage,'ui/assets',file),{recursive:true});
let html = await readFile(path.join(stage,'ui/index.html'),'utf8');
html = html.replace(/<script>document\.documentElement[\s\S]*?<\/script>/, '<script src="boot.js"></script>')
  .replace('<html lang=', '<html data-desktop="true" lang=')
  .replace('<script src="app.js"></script>', '<script src="desktop-locales.js"></script>\n<script src="app.js"></script>')
  .replace(/<p class="preview-notice"[^>]*>[^<]*<\/p>/, '')
  .replace('<main id="top" tabindex="-1">', '<main id="top" tabindex="-1"><p id="desktop-error" role="status" hidden></p>')
  .replace('<div class="detail-heading"><div>', '<div class="detail-heading"><div>')
  .replace('</button></div>\n      <div class="detail-layout">', '</button><button class="btn btn--secondary" id="uninstall" data-i18n="uninstall" hidden>Uninstall</button></div>\n      <div class="detail-layout">')
  .replace('<div class="settings-group"><h2 data-i18n="updates">', '<div class="settings-group"><div class="update-check"><button id="check-now" class="btn btn--secondary" data-i18n="checkNow">Check for updates</button><p id="check-result" role="status"></p></div><h2 data-i18n="updates">');
await writeFile(path.join(stage,'ui/index.html'),html);
await writeFile(path.join(stage,'ui/boot.js'),"document.documentElement.classList.add('m-enter');setTimeout(()=>document.documentElement.classList.add('m-enter-done'),700);\n");
await cp(path.join(root,'desktop/renderer-locales.js'),path.join(stage,'ui/desktop-locales.js'));
await writeFile(path.join(stage,'ui/style.css'),(await readFile(path.join(stage,'ui/style.css'),'utf8'))+'\n#desktop-error{padding:12px 32px;color:#a12b20;background:#fff4f0;font-size:15px}.update-check{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:28px}.update-check p{font-size:14px;color:#666}.detail-heading>div{margin-right:auto}.detail-heading #uninstall{min-width:0}.platform-picker select:disabled{opacity:1;color:#444;cursor:default}\n');
const pkg = JSON.parse(await readFile('package.json','utf8'));
await writeFile(path.join(stage,'package.json'),JSON.stringify({name:'toolbox',productName:'Toolbox',version:pkg.version,type:'module',main:'desktop/main.mjs',description:pkg.description,author:'storyon',dependencies:pkg.dependencies},null,2)+'\n');
// Include only the production dependency tree. Its exact versions come from the root lockfile.
const copied = new Set();
async function copyDependency(name) {
  if (copied.has(name)) return; copied.add(name);
  const source = path.join(root,'node_modules',name); const metadata = JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
  await cp(source,path.join(stage,'node_modules',name),{recursive:true});
  for (const child of Object.keys(metadata.dependencies || {})) await copyDependency(child);
}
for (const dependency of Object.keys(pkg.dependencies || {})) await copyDependency(dependency);
console.log(`Prepared ${stage}`);
