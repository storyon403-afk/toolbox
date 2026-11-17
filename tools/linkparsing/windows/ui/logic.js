'use strict';
globalThis.LPLogic = (() => {
  const seconds = value => {
    const raw = String(value).trim();
    if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) throw Error('时间请填写非负秒数，最多三位小数。');
    const ms = Math.round(Number(raw) * 1000);
    if (!Number.isSafeInteger(ms)) throw Error('时间超出范围。');
    return ms;
  };
  function makeRequest(form, asset) {
    if (!asset) throw Error('请先导入素材。');
    const duration = asset.facts.duration_ms;
    const start = form.full ? 0 : seconds(form.start);
    const end = form.full ? duration : seconds(form.end);
    if (start >= end || end > duration) throw Error('片段必须位于素材时长内，且结束时间晚于开始时间。');
    const outputs = [];
    if (form.audio) {
      if (!asset.facts.has_audio) throw Error('当前素材没有音轨。');
      if (!['mp3','wav','m4a'].includes(form.audioFormat)) throw Error('音频格式无效。');
      outputs.push({kind:'audio',format:form.audioFormat});
    }
    if (form.text) {
      if (!asset.has_transcript) throw Error('请先导入已有文字。');
      if (!['txt','markdown','srt'].includes(form.textFormat)) throw Error('文字格式无效。');
      outputs.push({kind:'text',format:form.textFormat});
    }
    if (form.frames || form.original) {
      if (!asset.facts.has_video) throw Error('当前素材没有视频画面。');
      if (asset.watermark !== 'verified_clean') throw Error('请先完成无水印人工审核。');
    }
    if (form.frames) {
      const pieces = form.times.split(/[,，\n]/).map(s=>s.trim());
      if (!pieces.length || pieces.length > 300 || pieces.some(s=>!s)) throw Error('请填写 1–300 个有效抽帧时间。');
      const times = pieces.map(seconds);
      if (new Set(times).size !== times.length || times.some(t=>t < start || t >= end)) throw Error('抽帧时间必须不重复，且位于片段范围内（不含结束点）。');
      if (!['png','jpg'].includes(form.imageFormat)) throw Error('画面格式无效。');
      outputs.push({kind:'frames',format:form.imageFormat,timestamps_ms:times});
    }
    if (form.original) outputs.push({kind:'original'});
    if (!outputs.length) throw Error('请至少选择一种导出内容。');
    return {range:form.full ? null : {start_ms:start,end_ms:end},outputs};
  }
  const formatTime = (ms, precise=false) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total/3600), m = Math.floor(total/60)%60, s = total%60;
    return (h ? String(h).padStart(2,'0')+':' : '') + String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+(precise ? '.'+String(ms%1000).padStart(3,'0') : '');
  };
  return {makeRequest, seconds, formatTime};
})();
