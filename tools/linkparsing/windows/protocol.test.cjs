const {test} = require('node:test');
const assert = require('node:assert/strict');
const {commandFor} = require('./protocol.cjs');
test('renderer cannot replace host-owned export destination or import path', () => {
  assert.equal(commandFor({action:'export', asset_id:1, destination:'evil',request:{}}, 'C:\\用户\\导出').destination,'C:\\用户\\导出');
  assert.equal(commandFor({action:'transcript', asset_id:1, path:'evil'}, 'C:\\chosen.json').path, 'C:\\chosen.json');
});
test('renderer cannot assert review or inject arbitrary commands', () => {
  for (const action of ['review','spawn','shell','ocr']) assert.throws(() => commandFor({action,clean:true}));
});
test('preview always requests a full compatible playback copy', () => {
  assert.deepEqual(commandFor({action:'preview',asset_id:3, playback:false, path:'evil'}),{type:'preview',asset_id:3,playback:true});
});
