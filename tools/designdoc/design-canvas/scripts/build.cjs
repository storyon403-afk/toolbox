const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['core.js', 'seed.js', 'ui.js', 'app.js', 'style.css', 'index.html'];
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
for (const name of files) fs.copyFileSync(path.join(root, 'src', name), path.join(root, 'dist', name));
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>' + fs.readFileSync(path.join(root, 'src/style.css'), 'utf8') + '</style>');
for (const name of ['core.js', 'seed.js', 'ui.js', 'app.js']) {
  const script = fs.readFileSync(path.join(root, 'src', name), 'utf8').replace(/<\/script/gi, '<\\/script');
  html = html.replace(`<script src="${name}"></script>`, () => `<script>${script}</script>`);
}
fs.writeFileSync(path.join(root, '../Forma.html'), html);
console.log('Built dist/ and standalone ../Forma.html');
