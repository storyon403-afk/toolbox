'use strict';
// Explicit allowlist: renderer values never become native file paths or shell commands.
function commandFor(body, selectedPath) {
  const base = {type:body.action, asset_id:body.asset_id};
  switch (body.action) {
    case 'preview': return {...base, playback:true};
    case 'transcribe': return {...base, language:body.language};
    case 'content': return {...base, offset:body.offset, text_source:body.text_source === 'ocr' ? 'ocr' : 'speech'};
    case 'export': return {...base, request:body.request, text_source:body.text_source === 'ocr' ? 'ocr' : 'speech', destination:selectedPath};
    case 'transcript': return {...base, path:selectedPath};
    case 'ocr': throw Error('Windows 版暂未接入 OCR；Apple Vision 仅适用于 macOS。');
    default: throw Error('不支持的操作。');
  }
}
module.exports = {commandFor};
