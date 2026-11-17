'use strict';
const fs = require('node:fs');
const path = require('node:path');
function normalize(value) {
  return {publicDns:value?.publicDns === true,
    workspace:typeof value?.workspace === 'string' && value.workspace.length <= 32768 && path.isAbsolute(value.workspace) ? value.workspace : null};
}
function load(directory) {
  try {
    const file = path.join(directory,'preferences.json');
    if (fs.statSync(file).size > 65536) return normalize(null);
    return normalize(JSON.parse(fs.readFileSync(file,'utf8')));
  } catch { return normalize(null); }
}
function save(directory, value) {
  fs.mkdirSync(directory,{recursive:true});
  const file = path.join(directory,'preferences.json');
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary,JSON.stringify(normalize(value))+'\n',{mode:0o600});
  fs.renameSync(temporary,file);
}
module.exports = {load,save};
