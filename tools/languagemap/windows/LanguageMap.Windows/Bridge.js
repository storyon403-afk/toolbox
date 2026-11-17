'use strict';
// Injected by the Windows host before any bundled UI code. No file or shell APIs.
(() => {
  if (window.top !== window) return;
  let next = 0;
  const pending = new Map();
  chrome.webview.addEventListener('message', event => {
    const message = event.data, request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(Error(message.error)) : request.resolve(message.result);
  });
  window.LanguageMapHost = Object.freeze({
    platform: 'windows',
    save(values) {
      return new Promise((resolve, reject) => {
        const id = 'save-' + (++next);
        const timer = setTimeout(() => {
          pending.delete(id); reject(Error('保存超时，请重试'));
        }, 30000);
        pending.set(id, {resolve, reject, timer});
        chrome.webview.postMessage({id, method: 'save', values});
      });
    }
  });
})();
