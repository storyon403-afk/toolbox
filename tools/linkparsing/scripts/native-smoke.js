const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let i=0; i<100 && !state.doctor; i++) await pause(50);
if (!state.doctor?.download_ready || !state.doctor.asr || !state.doctor.ocr) throw Error('Packaged runtime is not ready');
const expected = document.getElementById('publicDns').checked;
if (!expected) {
  document.getElementById('publicDns').checked = true;
  await document.getElementById('publicDns').onchange();
}
return expected ? 'managed native preferences restored; all runtimes ready' : 'managed native preferences saved; all runtimes ready';
