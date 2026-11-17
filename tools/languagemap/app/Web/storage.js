'use strict';
// Initial values are supplied by the native host, never a remote origin.
(() => {
  const values = {...window.__initialStorage};
  let revision = 0, saved = 0, timer, queue = Promise.resolve(), failed = false;
  function status() {
    const el = document.querySelector('#save-status');
    if (!el) return;
    const key = failed ? '保存失败，请重试；请勿退出' : saved < revision ? '正在保存…' : '已保存在本机';
    el.textContent = window.AppLocale ? AppLocale.tr(key) : key;
    el.dataset.error = String(failed);
    el.onclick = () => AppStorage.flush().catch(() => {});
  }
  function flush() {
    clearTimeout(timer);
    queue = queue.catch(() => {}).then(async () => {
      if (saved === revision) return;
      const version = revision, snapshot = {...values};
      try {
        if (window.LanguageMapHost) await window.LanguageMapHost.save(snapshot);
        else await window.webkit.messageHandlers.storage.postMessage(snapshot);
        saved = version; failed = false; status();
      } catch (error) {
        failed = true; status(); throw error;
      }
    });
    return queue;
  }
  window.AppStorage = Object.freeze({
    getItem: key => values[key] ?? null,
    setItem(key, value) {
      if (values[key] === String(value)) return;
      values[key] = String(value); revision++; failed = false; status();
      clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), 180);
    },
    flush, status
  });
  document.addEventListener('DOMContentLoaded', status);
})();
