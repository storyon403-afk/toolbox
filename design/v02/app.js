(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const dictionaries = window.ToolboxLocales;
  const preferenceKey = 'toolbox.ui.language';
  const normalize = value => /^zh(?:-|$)/i.test(value) ? 'zh-CN' : /^ja(?:-|$)/i.test(value) ? 'ja' : /^en(?:-|$)/i.test(value) ? 'en' : null;
  let saved;
  try { saved = localStorage.getItem(preferenceKey); } catch { /* Storage can be unavailable in file previews. */ }
  let language = Object.hasOwn(dictionaries, saved) ? saved : (navigator.languages || [navigator.language]).map(normalize).find(Boolean) || 'en';
  const t = (key, values = {}) => (dictionaries[language][key] ?? dictionaries.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  const tools = {
    rd: { name: 'RD', version: { mac: '0.2.2', windows: '0.2.2' }, platforms: 'macOS / Windows', keywords: 'document review writing 文档 写作 文書 執筆' },
    designdoc: { name: 'DesignDoc', versionKey: 'unversioned', platformKey: 'browser', keywords: 'forma design canvas prototype 设计 画布 デザイン キャンバス' },
    languagemap: { name: 'LanguageMap', version: { mac: '1.0.0', windows: '1.1.0' }, platforms: 'macOS / Windows', keywords: 'language vocabulary words 语言 单词 語学 単語' },
    linkparsing: { name: 'LinkParsing', versionKey: 'development', platforms: 'macOS', keywords: 'media video audio extraction 媒体 视频 音频 動画 音声 メディア' }
  };
  let platform = 'mac';
  let desktopState = null;
  const bridge = window.toolboxDesktop;
  const views = ['library', 'detail', 'settings'];

  function filter() {
    const installed = location.hash === '#installed';
    const query = $('#search').value.trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('.tool-card').forEach(card => {
      const item = tools[card.querySelector('[data-tool-link]').dataset.toolLink];
      const show = (!installed || !!desktopState?.tools.find(tool => tool.id === card.querySelector('[data-tool-link]').dataset.toolLink)?.installedVersion) && `${item.name} ${item.keywords}`.toLowerCase().includes(query);
      card.hidden = !show;
      if (show) count++;
    });
    $('#tool-grid').hidden = !count;
    $('#empty').hidden = !!count;
    $('#empty h2').textContent = t(installed ? 'emptyInstalled' : 'noResults');
    $('#clear-search').textContent = t(installed ? 'all' : 'clear');
  }

  function route(focus = false) {
    const hash = location.hash.slice(1) || 'library';
    const id = hash.startsWith('tool/') ? hash.slice(5) : null;
    const item = id && Object.hasOwn(tools, id) ? tools[id] : null;
    const view = item ? 'detail' : hash === 'settings' ? 'settings' : 'library';
    views.forEach(name => { $(`#${name}`).hidden = name !== view; });
    document.querySelectorAll('[data-route]').forEach(link => {
      const selected = link.dataset.route === (hash === 'installed' ? 'installed' : view === 'settings' ? 'settings' : 'library');
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    $('#library-title').textContent = t(hash === 'installed' ? 'installed' : 'library');
    $('#linkparsing-status span').textContent = t(platform === 'mac' ? 'notInstalled' : 'macOnly');
    if (item) {
      const unsupported = platform === 'windows' && id === 'linkparsing';
      $('#detail-name').textContent = item.name;
      $('#guide-purpose').textContent = t(`${id}Purpose`);
      document.querySelectorAll('#guide-steps li').forEach((step, index) => { step.textContent = t(`${id}Step${index + 1}`); });
      $('#detail-image').src = `media/${id}.webp`;
      $('#detail-image').alt = t('previewAlt', { name: item.name });
      $('#detail-platform').textContent = item.platformKey ? t(item.platformKey) : item.platforms;
      $('#detail-version').textContent = unsupported ? t('notAvailable') : item.version ? item.version[platform] : t(item.versionKey);
      $('#detail-status').textContent = t(unsupported ? 'unsupported' : 'notInstalled');
      $('#detail-readiness').textContent = t(unsupported ? 'macOnly' : 'pending');
      $('#detail-reason').textContent = t(unsupported ? 'windowsReason' : `${id}Reason`);
    }
    renderDesktop(id);
    filter();
    if (focus) { window.scrollTo(0, 0); $('#top').focus({ preventScroll: true }); }
  }

  function translate() {
    document.documentElement.lang = language;
    document.title = t('title');
    $('#language').value = language;
    for (const [attribute, target] of [['data-i18n', null], ['data-i18n-aria', 'aria-label'], ['data-i18n-placeholder', 'placeholder']]) {
      document.querySelectorAll(`[${attribute}]`).forEach(element => {
        const value = t(element.getAttribute(attribute));
        if (target) element.setAttribute(target, value); else element.textContent = value;
      });
    }
    document.querySelectorAll('[data-tool-link]').forEach(link => link.setAttribute('aria-label', t('viewName', { name: tools[link.dataset.toolLink].name })));
    document.querySelectorAll('[data-tool-preview]').forEach(img => { img.alt = t('previewAlt', { name: tools[img.dataset.toolPreview].name }); });
    route();
  }

  $('#language').addEventListener('change', event => {
    if (!Object.hasOwn(dictionaries, event.target.value)) return;
    language = event.target.value;
    try { localStorage.setItem(preferenceKey, language); } catch { /* Keep the selection for this session. */ }
    translate();
    if (bridge) saveSettings({ language });
  });
  $('#search').addEventListener('input', filter);
  $('#clear-search').addEventListener('click', () => {
    $('#search').value = '';
    if (location.hash === '#installed') location.hash = 'library'; else filter();
  });
  $('#platform').addEventListener('change', event => { platform = event.target.value; route(); });
  document.querySelectorAll('.m-switch').forEach(control => {
    control.addEventListener('click', event => {
      event.preventDefault(); // The preview owns state; the kit supplies motion styles.
      const enabled = control.getAttribute('aria-checked') !== 'true';
      control.setAttribute('aria-checked', String(enabled));
      if (control.id === 'downloads') {
        $('#installs').disabled = !enabled;
        if (!enabled) $('#installs').setAttribute('aria-checked', 'false');
        $('#install-hint').hidden = enabled;
      }
      if (control.id === 'motion') document.documentElement.dataset.motion = enabled ? '' : 'off';
      if (bridge) saveSettings({ [control.id]: enabled });
    });
  });
  addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      if ($('#library').hidden) { location.hash = 'library'; route(); }
      $('#search').focus();
    }
    if (event.key === 'Escape' && location.hash.startsWith('#tool/')) location.hash = 'library';
  });
  addEventListener('hashchange', () => route(true));
  function showError(code) {
    const box = $('#desktop-error');
    if (box) { box.textContent = t(Object.hasOwn(dictionaries[language], code) ? code : 'operationFailed'); box.hidden = false; }
  }
  function applyState(state) {
    desktopState = state;
    language = state.settings.language || normalize(state.locale) || 'en';
    platform = state.target.startsWith('darwin-') ? 'mac' : 'windows';
    $('#platform').value = platform; $('#platform').disabled = true;
    $('#language').disabled = false;
    for (const id of ['daily','downloads','installs','motion']) $(`#${id}`).setAttribute('aria-checked', String(state.settings[id]));
    $('#installs').disabled = !state.settings.downloads;
    $('#install-hint').hidden = state.settings.downloads;
    document.documentElement.dataset.motion = state.settings.motion ? '' : 'off';
    translate();
  }
  async function saveSettings(patch) {
    try {
      const result = await bridge.settings(patch);
      if (!result.ok) { if (desktopState) applyState(desktopState); showError(result.error); }
      else applyState(result.value);
    } catch { if (desktopState) applyState(desktopState); showError('invalidSettings'); }
  }
  function renderDesktop(id) {
    if (!desktopState) return;
    for (const card of document.querySelectorAll('.tool-card')) {
      const row = desktopState.tools.find(tool => tool.id === card.querySelector('[data-tool-link]').dataset.toolLink);
      const key = row.state === 'installed' ? 'installedLabel' : row.state === 'notInstalled' ? row.status === 'unsupported' ? 'unsupported' : 'notInstalled' : row.state;
      card.querySelector('.status span').textContent = t(key);
    }
    if (id) {
      const row = desktopState.tools.find(tool => tool.id === id);
      if (!row) return;
      const busy = ['downloading','installing','opening','removing'].includes(row.state);
      $('#detail-platform').textContent = desktopState.target.replace('darwin','macOS').replace('win32','Windows').replace('-', ' · ');
      $('#detail-version').textContent = row.installedVersion || row.version || t('unversioned');
      $('#detail-status').textContent = t(row.state === 'installed' ? 'installedLabel' : row.state === 'notInstalled' ? row.status === 'unsupported' ? 'unsupported' : 'notInstalled' : row.state);
      const action = ['downloading','installing'].includes(row.state) ? 'cancel' : row.state === 'updateAvailable' ? 'update' : row.installedVersion ? 'open' : row.installable ? 'install' : 'unavailable';
      $('#install').textContent = t(action) + (row.progress !== null ? ` ${row.progress}%` : '');
      $('#install').disabled = action === 'unavailable' || (busy && action !== 'cancel');
      $('#install').dataset.action = action === 'update' ? 'install' : action;
      $('#uninstall').hidden = !row.installedVersion;
      $('#uninstall').disabled = busy || row.state === 'running';
      $('#detail-readiness').textContent = t(row.prepared ? 'prepared' : row.installable ? 'installedLabel' : row.status === 'unsupported' ? 'unsupported' : 'pending');
      $('#detail-reason').textContent = row.error ? t(Object.hasOwn(dictionaries[language],row.error) ? row.error : 'operationFailed') : row.installable ? '' : row.status === 'unsupported' ? t(id === 'languagemap' ? 'noIntel' : 'windowsReason') : t(`${id}Reason`);
      $('.readiness').hidden = row.installable && !row.error && !row.prepared;
    }
    const check = desktopState.lastCheck;
    $('#check-result').textContent = t(check?.result || 'bundledOnly') + (check ? ` · ${new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short'}).format(new Date(check.at))}` : '');
  }
  async function perform(action) {
    const id = location.hash.slice(6);
    try { const result = await bridge.action(id, action); if (!result.ok) showError(result.error); else applyState(result.value); }
    catch { showError('operationFailed'); }
  }
  if (bridge) {
    $('#platform').disabled = true; $('#language').disabled = true;
    $('#install').addEventListener('click', () => perform($('#install').dataset.action));
    $('#uninstall').addEventListener('click', () => perform('uninstall'));
    $('#check-now').addEventListener('click', async () => {
      $('#check-now').disabled = true;
      try { const result = await bridge.check(); if (!result.ok) showError(result.error); else applyState(result.value); }
      catch { showError('checkFailed'); }
      finally { $('#check-now').disabled = false; }
    });
    bridge.subscribe(applyState);
    bridge.snapshot().then(result => { if (result.ok) { applyState(result.value); if (result.value.recovered) showError('recovered'); } else showError('appError'); }).catch(() => showError('appError'));
  } else if (document.documentElement.dataset.desktop) showError('appError');
  translate();
})();
