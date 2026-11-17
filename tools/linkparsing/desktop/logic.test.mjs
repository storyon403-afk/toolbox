import test from 'node:test';
import assert from 'node:assert/strict';
import './logic.js';
const {makeRequest,seconds}=globalThis.LPLogic;
const asset={facts:{duration_ms:2000,has_audio:true,has_video:true},watermark:'unknown',has_transcript:false};
const form={full:false,start:'0.5',end:'1.5',audio:true,audioFormat:'wav'};
test('timestamps are exact milliseconds and reject ambiguous notation',()=>{
  assert.equal(seconds('1.001'),1001);
  for(const v of ['', '-1','1e2','0.0001','Infinity','1:20']) assert.throws(()=>seconds(v));
});
test('audio works independently and UI cannot assert a clean source',()=>{
  assert.deepEqual(makeRequest(form,asset),{range:{start_ms:500,end_ms:1500},outputs:[{kind:'audio',format:'wav'}]});
  assert.throws(()=>makeRequest({...form,original:true},asset),/审核/);
  assert.throws(()=>makeRequest({...form,text:true,textFormat:'srt'},asset),/文字/);
});
test('frames enforce half-open range and unique timestamps',()=>{
  const clean={...asset,watermark:'verified_clean'};
  const frames={...form,frames:true,imageFormat:'png',times:'0.5, 1.499',original:true};
  assert.deepEqual(makeRequest(frames,clean).outputs.slice(1),[{kind:'frames',format:'png',timestamps_ms:[500,1499]},{kind:'original'}]);
  for(const times of ['0.4','1.5','0.5,0.500','0.5,','NaN']) assert.throws(()=>makeRequest({...frames,times},clean));
  assert.throws(()=>makeRequest({...form,start:'1.5',end:'1.5'},asset));
  assert.throws(()=>makeRequest({...form,end:'2.001'},asset));
});
