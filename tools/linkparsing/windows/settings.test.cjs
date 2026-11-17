const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('./settings.cjs');
test('preferences survive a new read; credentials are never persisted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'lp-settings-'));
  try {
    const workspace = path.join(directory,'中文 workspace');
    settings.save(directory,{workspace,publicDns:true,cookies:'must-not-persist'});
    assert.deepEqual(settings.load(directory),{workspace,publicDns:true});
    assert.equal(fs.readFileSync(path.join(directory,'preferences.json'),'utf8').includes('must-not-persist'),false);
    settings.save(directory,{workspace,publicDns:false});
    assert.equal(settings.load(directory).publicDns,false);
    fs.writeFileSync(path.join(directory,'preferences.json'),'{broken');
    assert.deepEqual(settings.load(directory),{workspace:null,publicDns:false});
    settings.save(directory,{workspace:'relative',publicDns:'true'});
    assert.deepEqual(settings.load(directory),{workspace:null,publicDns:false});
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
