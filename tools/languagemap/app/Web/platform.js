'use strict';
// The native hosts load identical UI files. Only keyboard labels vary by platform.
(() => {
  if (window.LanguageMapHost?.platform !== 'windows') return;
  function labels() {
    document.querySelector('#open-search kbd').textContent = 'Ctrl K';
    const footer = document.querySelector('.review-foot span:last-child');
    footer.textContent = AppLocale.tr('拖动平移 · ⌘/Ctrl + 滚轮缩放').replace('⌘/Ctrl', 'Ctrl');
    document.querySelector('.review-foot span:nth-child(2)').textContent = 'LanguageMap · 1.1';
  }
  document.querySelector('#ui-language').addEventListener('change', labels);
  document.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]')) {
      event.preventDefault(); ensureToday(); enterDay(TODAY); openInsert();
    }
  });
  labels();
})();
