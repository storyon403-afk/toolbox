/* Forma UI — local only, no network calls or accounts. */
(() => {
  'use strict';
  const C = FormaCore, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const KEY = 'forma-design-canvas-v2', OLD_KEY = 'forma-design-canvas-v1';
  const history = new C.History();
  const UI = FormaUI; UI.mount();
  let doc, boardId, selected = new Set(), scale = 1, pan = { x: 40, y: 100 }, tool = 'select', space = false, drag = null;
  let mode = 'design', assets = false, snapping = true, clipboard = null, previewId, previewHistory = [], hotspots = false;
  let commandIndex = 0, commandMatches = [], bootMessage = '';
  const viewport = $('#viewport');
  const compactQuery = matchMedia('(max-width: 900px)');
  let panelPrefs = { wide: { left: true, right: true }, compact: { left: false, right: false } };
  try { const saved = JSON.parse(localStorage.getItem('forma-ui-panels-v1')); for (const view of ['wide', 'compact']) for (const side of ['left', 'right']) if (typeof saved?.[view]?.[side] === 'boolean') panelPrefs[view][side] = saved[view][side]; } catch {}
  function applyPanels() {
    const state = panelPrefs[compactQuery.matches ? 'compact' : 'wide'];
    for (const [side, panel, toggle] of [['left', '#leftPanel', '#homeBtn'], ['right', '#rightPanel', '#toggleInspector']]) {
      $(panel).hidden = !state[side]; document.body.classList.toggle(side + '-hidden', !state[side]);
      $(toggle).setAttribute('aria-expanded', state[side]); $(toggle).classList.toggle('panel-open', state[side]);
    }
  }
  function setPanel(side, open) {
    finishDrag(); const state = panelPrefs[compactQuery.matches ? 'compact' : 'wide'];
    state[side] = open ?? !state[side]; if (compactQuery.matches && state[side]) state[side === 'left' ? 'right' : 'left'] = false;
    applyPanels(); try { localStorage.setItem('forma-ui-panels-v1', JSON.stringify(panelPrefs)); } catch {}
  }
  applyPanels();

  try {
    const saved = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    doc = saved ? C.parse(saved) : FormaSeeds.seed();
  } catch {
    doc = FormaSeeds.seed(); bootMessage = '本地文件暂时无法读取，已打开示例；原存储未覆盖';
  }
  boardId = doc.boards[0].id;
  const board = () => doc.boards.find(b => b.id === boardId);
  const selection = () => board()?.elements.filter(e => selected.has(e.id)) || [];
  const editable = () => selection().filter(e => !e.locked && !e.hidden);
  const nameOf = e => e.name || e.text?.slice(0, 24) || ({ rect: '矩形', ellipse: '椭圆', image: '图片', text: '文字' }[e.type]);
  const iconOf = e => e.componentId ? '◇' : e.groupId ? '▱' : ({ text: 'T', rect: '▢', ellipse: '○', image: '▧' }[e.type]);
  function dom(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
  function button(label, fn, className = '', title = label) {
    const b = dom('button', className, label); b.type = 'button'; b.title = title; if (title) b.setAttribute('aria-label', title); b.onclick = fn;
    const actionIcon = { '复制': 'copy', '置顶 ↑': 'up', '置底 ↓': 'down', '聚焦画板': 'focus', '分组': 'group', '取消分组': 'rect', '◇ 创建组件': 'component', '删除所选图层': 'trash', '删除当前画板': 'trash' }[label];
    if (actionIcon) { b.replaceChildren(UI.icon(actionIcon)); b.classList.add('icon-action'); }
    return b;
  }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3200); }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(doc)); $('#saveState').textContent = '已保存到此浏览器'; $('#saveIndicator').classList.remove('unsaved'); $('#saveIndicator').title = '已保存到此浏览器'; }
    catch { $('#saveState').textContent = '保存失败，请导出 JSON 备份'; $('#saveIndicator').classList.add('unsaved'); $('#saveIndicator').title = '保存失败，请导出 JSON 备份'; toast('本地存储不可用或已满。请导出 JSON，避免丢失改动。'); }
    updateHistory();
  }
  function updateHistory() { $('#undo').disabled = !history.past.length; $('#redo').disabled = !history.future.length; }
  function cleanSelection() { if (!board()) boardId = doc.boards[0].id; selected = new Set(selection().map(e => e.id)); }
  function change(fn, message) {
    const before = C.clone(doc);
    try { fn(); if (!C.validate(doc)) throw Error('改动超出文档支持范围'); }
    catch (err) { doc = before; cleanSelection(); render(); toast(err.message || '修改未完成'); return false; }
    if (JSON.stringify(before) !== JSON.stringify(doc)) { history.push(before); save(); }
    cleanSelection(); render(); if (message) toast(message); return true;
  }
  function undo() { if (!history.past.length) return; doc = history.undo(doc); selected.clear(); cleanSelection(); save(); render(); toast('已撤销'); }
  function redo() { if (!history.future.length) return; doc = history.redo(doc); selected.clear(); cleanSelection(); save(); render(); toast('已重做'); }
  function select(ids, newBoardId = boardId) { boardId = newBoardId; selected = new Set(ids); refreshSelection(); }
  function transform() { $('#world').style.transform = `translate(${pan.x}px,${pan.y}px) scale(${scale})`; $('#world').style.setProperty('--zoom', scale); $('#zoomLabel').textContent = Math.round(scale * 100) + '%'; }
  function frameBounds(b, maxScale = 1.2) {
    const padding = compactQuery.matches ? 36 : 80;
    scale = Math.max(.03, Math.min(maxScale, Math.max(80, viewport.clientWidth - padding) / b.w, Math.max(80, viewport.clientHeight - 180) / b.h));
    pan = { x: (viewport.clientWidth - b.w * scale) / 2 - b.x * scale, y: (viewport.clientHeight - 110 - b.h * scale) / 2 + 5 - b.y * scale }; transform();
  }
  function fit() { frameBounds(C.bounds(doc.boards), 1); }
  function focusBoard(b = board()) { frameBounds(b); }
  function focusCurrent() { if (compactQuery.matches) { setPanel('left', false); setPanel('right', false); } focusBoard(); }
  function zoomToBoard(value) {
    if (compactQuery.matches) { setPanel('left', false); setPanel('right', false); }
    const b = board(); scale = value; pan = { x: viewport.clientWidth / 2 - (b.x + b.w / 2) * scale, y: (viewport.clientHeight - 100) / 2 - (b.y + b.h / 2) * scale }; transform();
  }
  function zoom(f, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) { const next = Math.max(.03, Math.min(5, scale * f)); pan = { x: x - (x - pan.x) * next / scale, y: y - (y - pan.y) * next / scale }; scale = next; transform(); }
  function node(e, interactive = true) {
    const n = dom('div', 'element ' + e.type); n.dataset.id = e.id;
    if (interactive) n.dataset.locked = e.locked;
    Object.assign(n.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px', borderRadius: (e.type === 'ellipse' ? '50%' : e.radius + 'px'), fontSize: e.size + 'px', fontWeight: e.weight, color: C.fill(e, doc), opacity: e.opacity, border: e.strokeWidth ? `${e.strokeWidth}px solid ${e.stroke}` : 'none' });
    if (e.type === 'text') n.textContent = e.text;
    else if (e.type === 'image') { const img = dom('img'); img.src = e.src; img.alt = e.text || nameOf(e); n.append(img); }
    else n.style.background = C.fill(e, doc);
    return n;
  }
  function surface(b, interactive = true) {
    const n = dom('div', 'board-content'); Object.assign(n.style, { width: b.w + 'px', height: b.h + 'px', background: b.bg });
    b.elements.filter(e => !e.hidden).forEach(e => n.append(node(e, interactive))); return n;
  }
  function renderWorld() {
    const world = $('#world'); world.replaceChildren();
    for (const b of doc.boards) {
      const wrap = dom('div', 'board'); wrap.dataset.board = b.id; Object.assign(wrap.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      const label = dom('div', 'board-label'); label.append(dom('span', '', b.name), dom('small', '', `${Math.round(b.w)} × ${Math.round(b.h)}`)); wrap.append(label, surface(b)); world.append(wrap);
    }
    transform();
  }
  function render() { $('#projectTitle').value = doc.title; renderWorld(); refreshSelection(); updateHistory(); }
  function refreshSelection() {
    $$('.board').forEach(n => n.classList.toggle('selected', n.dataset.board === boardId));
    $$('#world .element').forEach(n => n.classList.toggle('selected', selected.has(n.dataset.id)));
    renderBox(); renderBoards(); renderLayers(); renderAssets(); renderInspector();
    $('#selectionStatus').textContent = selected.size ? `${selected.size} 个图层已选中${selection().some(e => e.locked) ? ' · 包含锁定图层' : ''}` : `${doc.boards.length} 张画板 · 所有设计仅保存在本地`;
  }
  function renderBox() {
    $$('.selection-box,.guide').forEach(n => n.remove());
    const list = editable(); if (!list.length) return;
    const box = C.bounds(list), n = dom('div', 'selection-box'); Object.assign(n.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    for (const handle of ['nw', 'ne', 'sw', 'se']) { const h = dom('div', 'resize-handle'); h.dataset.handle = handle; n.append(h); }
    n.append(dom('span', 'selection-size', `${Math.round(box.w)} × ${Math.round(box.h)}`));
    $$('.board').find(n => n.dataset.board === boardId)?.append(n);
  }
  function renderBoards() {
    $('#boardCount').textContent = String(doc.boards.length).padStart(2, '0'); $('#boardList').replaceChildren();
    for (const b of doc.boards) {
      const row = button('', () => { select([], b.id); if (compactQuery.matches) setPanel('left', false); focusBoard(b); }, 'board-item' + (b.id === boardId ? ' active' : ''));
      row.append(UI.icon('frame')); const info = dom('span', 'board-info'); info.append(dom('b', '', b.name), dom('small', '', `${Math.round(b.w)} × ${Math.round(b.h)} · ${b.elements.length} 图层`)); row.append(info); $('#boardList').append(row);
    }
  }
  function groupIds(e, individual = false) { return e.groupId && !individual ? board().elements.filter(n => n.groupId === e.groupId && !n.hidden).map(n => n.id) : [e.id]; }
  function toggleSelection(e, additive, individual = false) {
    const ids = groupIds(e, individual);
    if (!additive) selected = new Set(ids);
    else if (ids.every(id => selected.has(id))) ids.forEach(id => selected.delete(id)); else ids.forEach(id => selected.add(id));
    refreshSelection();
  }
  function renderLayers() {
    const list = $('#layerList'), query = $('#layerSearch').value.trim().toLowerCase(); list.replaceChildren();
    const elements = [...board().elements].reverse().filter(e => nameOf(e).toLowerCase().includes(query) || e.text.toLowerCase().includes(query));
    if (!elements.length) list.append(dom('p', 'empty-note', query ? '没有匹配的图层。' : '画板还是空白的。按 T 添加文字，或按 R 添加矩形。'));
    for (const e of elements) {
      const row = dom('div', 'layer-row' + (selected.has(e.id) ? ' active' : '') + (e.hidden ? ' hidden-layer' : '') + (e.locked ? ' locked-layer' : '')); row.tabIndex = 0; row.dataset.layerId = e.id; row.setAttribute('aria-label', nameOf(e));
      const layerIcon = UI.icon(e.componentId ? 'component' : e.groupId ? 'group' : e.type); layerIcon.classList.add('layer-icon'); row.append(layerIcon, dom('span', 'layer-name', nameOf(e)));
      row.onclick = ev => { if (!ev.target.closest('button')) toggleSelection(e, ev.shiftKey, ev.metaKey || ev.ctrlKey); };
      row.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); toggleSelection(e, ev.shiftKey, true); } };
      const visible = button(e.hidden ? '◌' : '◉', () => change(() => { e.hidden = !e.hidden; }), e.hidden ? 'on' : '', e.hidden ? '显示图层' : '隐藏图层'); visible.setAttribute('aria-label', e.hidden ? '显示图层' : '隐藏图层');
      const lock = button(e.locked ? '▣' : '▫', () => change(() => { e.locked = !e.locked; }), e.locked ? 'on' : '', e.locked ? '解锁图层' : '锁定图层'); lock.setAttribute('aria-label', e.locked ? '解锁图层' : '锁定图层');
      visible.replaceChildren(UI.icon(e.hidden ? 'eyeOff' : 'eye')); lock.replaceChildren(UI.icon(e.locked ? 'lock' : 'unlock')); row.append(visible, lock); list.append(row);
    }
  }
  function showAssets(value) { assets = value; $('#assetsPanel').hidden = !value; $('#layersPanel').hidden = value; for (const [id, on] of [['assetsTab', value], ['layersTab', !value]]) { $('#' + id).classList.toggle('active', on); $('#' + id).setAttribute('aria-selected', on); } }
  function renderAssets() {
    const panel = $('#assetsPanel'); panel.replaceChildren();
    const heading = dom('div', 'asset-heading', '可复用组件'); heading.append(button('＋', createComponent, '', '将选中图层创建为组件')); panel.append(heading);
    for (const c of doc.components) {
      const card = dom('div', 'asset-card'), info = dom('div'); info.append(dom('b', '', c.name), dom('small', '', `${c.elements.length} 个图层 · 关联实例`)); card.append(dom('span', '', '◇'), info, button('＋', () => insertComponent(c), '', `插入 ${c.name}`)); panel.append(card);
    }
    if (!doc.components.length) panel.append(dom('p', 'empty-note', '选中一组图层，点击「创建组件」，让好的设计反复使用。'));
    const tokensHeading = dom('div', 'asset-heading', '颜色变量'); tokensHeading.append(button('＋', addToken, '', '从所选颜色创建变量')); panel.append(tokensHeading);
    for (const t of doc.tokens) {
      const row = dom('div', 'token-row'), input = dom('input'); input.type = 'color'; input.value = t.value; input.setAttribute('aria-label', t.name); input.onchange = () => change(() => { t.value = input.value; }, '颜色变量及绑定图层已更新'); row.append(input, dom('span', '', t.name), dom('code', '', t.value.slice(1).toUpperCase())); panel.append(row);
    }
    panel.append(dom('p', 'empty-note', '在右侧填充中绑定变量。修改这里的颜色，会更新所有绑定图层。'));
  }
  function section(title) { const s = dom('section', 'prop-section'); s.append(dom('h3', '', title)); $('#inspector').append(s); return s; }
  function field(parent, label, value, action, options = {}) {
    const wrap = dom('div', 'field'), lab = dom('label', '', label), input = dom(options.type === 'textarea' ? 'textarea' : 'input'); const inputId = 'field-' + C.id(); lab.htmlFor = inputId; input.id = inputId;
    if (options.type !== 'textarea') input.type = options.type || 'number'; input.value = value ?? ''; input.setAttribute('aria-label', label);
    if (value === undefined) input.placeholder = '混合';
    if (input.type === 'number') { input.min = options.min ?? -100000; input.max = options.max ?? 100000; input.step = 'any'; }
    if (options.maxlength) input.maxLength = options.maxlength;
    input.disabled = !!options.disabled;
    input.onchange = () => { let v = input.value; if (input.type === 'number') { if (!v.trim() || !Number.isFinite(Number(v))) { input.value = value ?? ''; return; } v = Math.min(Number(input.max), Math.max(Number(input.min), Number(v))); } action(v); };
    wrap.append(lab, input); parent.append(wrap); return input;
  }
  function selectField(parent, label, value, entries, action) {
    const wrap = dom('div', 'field single'), lab = dom('label', '', label), input = dom('select'); input.setAttribute('aria-label', label); const inputId = C.id(); input.id = inputId; lab.htmlFor = inputId;
    for (const [v, text] of entries) { const option = dom('option', '', text); option.value = v; input.append(option); }
    input.value = value || ''; input.onchange = () => action(input.value); wrap.append(lab, input); parent.append(wrap); return input;
  }
  function common(list, key) { return list.every(e => e[key] === list[0][key]) ? list[0][key] : undefined; }
  function setProperties(key, value) { change(() => { editable().forEach(e => { e[key] = value; if (key === 'fill') delete e.fillToken; }); }); }
  function geometry(key, value) {
    change(() => {
      const es = editable(); if (!selected.size) { board()[key] = value; return; } if (!es.length) return;
      const box = C.bounds(es); if (key === 'x' || key === 'y') es.forEach(e => { e[key] += value - box[key]; });
      else { const target = { ...box, [key]: value }; const next = C.resize(es, box, target); es.forEach((e, i) => Object.assign(e, next[i])); }
    });
  }
  function colorField(parent, label, value, action) {
    const wrap = dom('div', 'field single'), lab = dom('label', '', label), row = dom('div', 'color-row'), picker = dom('input'), hex = dom('input'); picker.type = 'color'; picker.value = value || '#000000'; picker.setAttribute('aria-label', label); hex.type = 'text'; hex.value = value?.toUpperCase() || ''; hex.placeholder = '混合颜色'; hex.setAttribute('aria-label', label + ' HEX'); hex.maxLength = 7;
    picker.onchange = () => action(picker.value); hex.onchange = () => { const v = hex.value.startsWith('#') ? hex.value : '#' + hex.value; if (/^#[a-f\d]{6}$/i.test(v)) action(v); else { toast('请输入六位 HEX 颜色，如 #EFBDA1'); hex.value = value || ''; } };
    row.append(picker, hex); wrap.append(lab, row); parent.append(wrap);
  }
  function renderInspector() {
    $('#inspector').replaceChildren(); const b = board(), es = selection(), e = es[0], active = editable(), disabled = es.length > 0 && !active.length;
    if (mode === 'prototype') { renderPrototypeInspector(); return; } if (mode === 'code') { renderCodeInspector(); return; }
    const identity = section(es.length ? es.length === 1 ? '图层' : `${es.length} 个图层` : '画板');
    const title = dom('div', 'selection-name'); title.append(UI.icon(es.length ? e.componentId ? 'component' : e.type : 'frame'), dom('span', 'selected-title', es.length ? es.length === 1 ? nameOf(e) : '多选编辑' : b.name)); identity.append(title);
    if (es.length <= 1) field(identity, es.length ? '图层名称' : '画板名称', e?.name || b.name, value => change(() => { (e || b).name = value; }), { type: 'text', maxlength: 200 });
    const geo = section('布局'); const alignment = dom('div', 'alignment');
    for (const [axis, symbol, label] of [['left', '⊢', '左对齐'], ['center', '↔', '水平居中'], ['right', '⊣', '右对齐'], ['top', '⊤', '顶对齐'], ['middle', '↕', '垂直居中'], ['bottom', '⊥', '底对齐']]) { const btn = button(symbol, () => change(() => C.align(editable(), axis, b)), '', label); btn.setAttribute('aria-label', label); btn.replaceChildren(UI.icon(axis)); btn.disabled = !active.length; alignment.append(btn); }
    geo.append(alignment); const grid = dom('div', 'prop-grid'); geo.append(grid); const box = es.length ? C.bounds(active.length ? active : es) : b;
    for (const [label, key] of [['X', 'x'], ['Y', 'y'], ['宽度', 'w'], ['高度', 'h']]) field(grid, label, Math.round(box[key] * 100) / 100, v => geometry(key, v), { min: key === 'w' || key === 'h' ? 1 : -100000, max: key === 'w' || key === 'h' ? 10000 : 100000, disabled });
    if (active.length > 1) {
      const stack = dom('div', 'stack-gap'), gap = dom('input'); gap.type = 'number'; gap.value = 16; gap.min = 0; gap.max = 1000; gap.setAttribute('aria-label', '排列间距'); stack.append(gap);
      for (const [axis, label] of [['horizontal', '横向顺排'], ['vertical', '纵向顺排']]) stack.append(button(label, () => change(() => C.arrange(editable(), axis, Math.max(0, Math.min(1000, Number(gap.value) || 0)))))); geo.append(stack);
    }
    if (es.length && es.every(e => e.type === 'text')) {
      const typography = section('文字'); if (es.length === 1) field(typography, '内容', e.text, v => setProperties('text', v), { type: 'textarea', maxlength: 10000, disabled });
      const g = dom('div', 'prop-grid'); g.style.marginTop = '12px'; typography.append(g); field(g, '字号', common(es, 'size'), v => setProperties('size', v), { min: 1, max: 1000, disabled }); field(g, '字重', common(es, 'weight'), v => setProperties('weight', v), { min: 100, max: 900, disabled });
    }
    const appearance = section('外观');
    colorField(appearance, es.length ? '填充颜色' : '画板背景', es.length ? (es.every(n => C.fill(n, doc) === C.fill(e, doc)) ? C.fill(e, doc) : undefined) : b.bg, v => es.length ? setProperties('fill', v) : change(() => { b.bg = v; }));
    if (es.length) {
      selectField(appearance, '颜色变量', common(es, 'fillToken'), [['', '自定义颜色'], ...doc.tokens.map(t => [t.id, t.name])], v => change(() => active.forEach(e => { if (v) e.fillToken = v; else { e.fill = C.fill(e, doc); delete e.fillToken; } })));
      const g = dom('div', 'prop-grid'); g.style.marginTop = '14px'; appearance.append(g); field(g, '圆角', common(es, 'radius'), v => setProperties('radius', v), { min: 0, max: 5000, disabled }); field(g, '不透明度 %', common(es, 'opacity') === undefined ? undefined : e.opacity * 100, v => setProperties('opacity', v / 100), { min: 0, max: 100, disabled });
      const stroke = section('描边'); const sg = dom('div', 'prop-grid'); stroke.append(sg); field(sg, '描边宽度', common(es, 'strokeWidth'), v => setProperties('strokeWidth', v), { min: 0, max: 100, disabled }); colorField(sg, '描边颜色', common(es, 'stroke'), v => setProperties('stroke', v));
    }
    const actions = section(es.length ? '图层操作' : '画板操作'), row = dom('div', 'action-row');
    row.append(button('复制', duplicateSelection), button(es.length ? '置顶 ↑' : '聚焦画板', es.length ? () => reorder(true) : () => focusBoard())); actions.append(row);
    if (es.length) {
      const r = dom('div', 'action-row'); r.style.marginTop = '8px'; r.append(button('分组', group), button('取消分组', ungroup), button('置底 ↓', () => reorder(false))); actions.append(r);
      actions.append(button('◇ 创建组件', createComponent, 'full-button'));
      if (e.componentId && es.every(n => n.componentId === e.componentId && n.groupId === e.groupId)) {
        actions.append(button('更新组件及全部实例', () => updateComponent(), 'full-button'));
        actions.append(button('解除组件关联', () => change(() => { es.forEach(n => delete n.componentId); }), 'full-button'));
      }
    }
    actions.append(button(es.length ? '删除所选图层' : '删除当前画板', deleteSelection, 'full-button danger'));
  }
  function renderPrototypeInspector() {
    const es = selection(), s = section('点击交互');
    s.append(dom('p', '', '为图层添加跳转。预览时点击它，就能到达另一张画板。'));
    if (!es.length) { s.append(dom('p', '', '先选中一个文字、按钮或其他图层。')); }
    else {
      selectField(s, '点击后跳转到', common(es, 'link'), [['', '无交互'], ...doc.boards.map(b => [b.id, b.name])], value => change(() => es.forEach(e => { if (value) e.link = value; else delete e.link; })));
      s.append(dom('p', '', '触发方式：点击 · 过渡：即时切换')); s.append(button('▷ 从当前画板预览', openPreview, 'full-button'));
    }
    const links = section('当前画板的连接'); const targets = board().elements.filter(e => e.link);
    if (!targets.length) links.append(dom('p', '', '尚未连接页面。可以先在左侧新建另一张画板。'));
    for (const e of targets) links.append(button(`${nameOf(e)} → ${doc.boards.find(b => b.id === e.link)?.name}`, () => select([e.id]), 'full-button'));
    links.append(dom('p', '', '可导出离线 HTML，让别人直接打开原型。预览顶部提供返回按钮。'));
  }
  function cssFor(e) {
    return `position: absolute;\nleft: ${Math.round(e.x)}px;\ntop: ${Math.round(e.y)}px;\nwidth: ${Math.round(e.w)}px;\nheight: ${Math.round(e.h)}px;\n${e.type === 'text' ? 'color' : 'background'}: ${e.fillToken ? `var(--color-${e.fillToken})` : C.fill(e, doc)};\nborder-radius: ${e.type === 'ellipse' ? '50%' : e.radius + 'px'};\nopacity: ${e.opacity};${e.type === 'text' ? `\nfont-size: ${e.size}px;\nfont-weight: ${e.weight};\nline-height: 1.45;` : ''}${e.strokeWidth ? `\nborder: ${e.strokeWidth}px solid ${e.stroke};` : ''}`;
  }
  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); toast('已复制到剪贴板'); }
    catch { const textarea = dom('textarea'); textarea.value = value; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.append(textarea); textarea.select(); const ok = document.execCommand('copy'); textarea.remove(); toast(ok ? '已复制到剪贴板' : '请从代码区域手动选择复制'); }
  }
  function renderCodeInspector() {
    const s = section('交给开发，也交给 GPT'); s.append(dom('p', '', '导出 JSON 包含可编辑结构、组件和交互。把文件交给 GPT/Codex，并描述想修改的地方，修改后可重新导入。'));
    s.append(button('导出完整设计 JSON', () => exportFile('json'), 'full-button'));
    const e = selection()[0]; if (e) { const c = section('所选图层 / CSS'); const css = cssFor(e); c.append(dom('pre', 'code-block', css), button('复制 CSS', () => copyText(css), 'full-button')); }
    const tokens = section('颜色变量 / CSS'); const css = ':root {\n' + doc.tokens.map(t => `  /* ${t.name.replaceAll('*/', '')} */\n  --color-${t.id}: ${t.value};`).join('\n') + '\n}'; tokens.append(dom('pre', 'code-block', css), button('复制颜色变量', () => copyText(css), 'full-button'));
    s.append(dom('p', '', '这里输出设计参数与固定坐标样式；产品中的响应式布局仍需开发适配。'));
  }
  function insert(elements) {
    if (!Array.isArray(elements)) elements = [elements];
    change(() => { board().elements.push(...elements); selected = new Set(elements.map(e => e.id)); }); setTool('select');
  }
  function addShape(type) {
    const b = board(), x = Math.max(0, Math.round((b.w - 200) / 2)), y = Math.max(0, Math.round((b.h - 120) / 2));
    insert(C.make(type, x, y, type === 'text' ? 280 : 200, type === 'text' ? 48 : 120, type === 'text' ? { name: '写下你的想法', text: '写下你的想法', size: 28, fill: '#30382c' } : { radius: type === 'rect' ? 12 : 0, fill: '#d9dfce' }));
  }
  function addBoard(w, h) {
    change(() => { const x = Math.max(...doc.boards.map(b => b.x + b.w)) + 100; const b = { id: C.id(), name: `${String(doc.boards.length + 1).padStart(2, '0')} / ${w < 500 ? '移动界面' : '空白画板'}`, x, y: 0, w, h, bg: '#f7f8f2', elements: [] }; doc.boards.push(b); boardId = b.id; selected.clear(); }); $('#boardDialog').close(); focusBoard();
  }
  function duplicateSelection() {
    change(() => {
      if (selected.size) { const next = C.duplicate(selection()); next.forEach(e => e.locked = false); board().elements.push(...next); selected = new Set(next.map(e => e.id)); }
      else { const source = board(), b = C.clone(source); b.id = C.id(); b.name = (b.name + ' · 副本').slice(0, 200); b.y += b.h + 100; b.elements = C.duplicate(b.elements, 0, 0); b.elements.forEach(e => { if (e.link === source.id) e.link = b.id; }); doc.boards.push(b); boardId = b.id; }
    }, '已创建副本');
    if (!selected.size) focusBoard();
  }
  function deleteSelection() {
    if (!selected.size && doc.boards.length <= 1) { toast('至少保留一个画板'); return; }
    change(() => { if (selected.size) { const ids = new Set(editable().map(e => e.id)); board().elements = board().elements.filter(e => !ids.has(e.id)); selected.clear(); } else { C.removeBoard(doc, boardId); boardId = doc.boards[0].id; } });
  }
  function reorder(front) { change(() => { const list = editable(), ids = new Set(list.map(e => e.id)), rest = board().elements.filter(e => !ids.has(e.id)); board().elements = front ? [...rest, ...list] : [...list, ...rest]; }); }
  function group() {
    if (editable().length < 2) { toast('请先选择至少两个可编辑图层'); return; }
    change(() => { const groupId = C.id(); editable().forEach(e => { e.groupId = groupId; delete e.componentId; }); }, '已分组。⌘/Ctrl 点击可选择组内图层');
  }
  function ungroup() { change(() => editable().forEach(e => { delete e.groupId; delete e.componentId; }), '已取消分组'); }
  function createComponent() {
    if (!editable().length) { toast('请先选中要复用的图层'); return; }
    change(() => C.component(doc, editable(), (selection()[0].name || '组件') + ' / ' + (doc.components.length + 1)), '组件已加入左侧资源库'); showAssets(true);
  }
  function insertComponent(c) { const box = C.bounds(c.elements); insert(C.instantiate(c, Math.max(0, (board().w - box.w) / 2), Math.max(0, (board().h - box.h) / 2))); toast('已插入组件实例'); }
  function updateComponent() {
    const es = selection(), first = es[0];
    if (!first?.groupId || board().elements.filter(e => e.groupId === first.groupId).length !== es.length) { toast('请选中完整组件后更新'); return; }
    change(() => { if (!C.updateComponent(doc, es)) throw Error('请选择同一组件的完整实例'); }, '组件已更新，全部实例已同步');
  }
  function addToken() {
    const e = selection()[0]; change(() => { const t = { id: C.id(), name: `颜色 / ${doc.tokens.length + 1}`, value: e ? C.fill(e, doc) : '#efbda1' }; doc.tokens.push(t); editable().forEach(e => e.fillToken = t.id); }, '已创建颜色变量');
  }
  function addOrbit() {
    change(() => { const bs = FormaSeeds.orbit(), x = Math.max(...doc.boards.map(b => b.x + b.w)) + 120; bs.forEach(b => b.x += x); doc.boards.push(...bs); boardId = bs[0].id; selected.clear(); }, '已加入 3 张可编辑 Orbit 画板，包含搜索 → 指令 → 设置跳转'); focusBoard();
  }
  function setTool(next) { tool = next; viewport.classList.toggle('hand', next === 'hand' || space); $('#selectTool').classList.toggle('active', next === 'select'); $('#handTool').classList.toggle('active', next === 'hand'); }
  function point(ev) { const r = viewport.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function docPoint(ev) { const p = point(ev); return { x: (p.x - pan.x) / scale, y: (p.y - pan.y) / scale }; }
  viewport.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button,.toolbar,.view-controls') || ev.target.isContentEditable || ![0, 1].includes(ev.button)) return;
    ev.preventDefault(); viewport.focus({ preventScroll: true }); const p = point(ev), dp = docPoint(ev), wrap = ev.target.closest('.board'), target = ev.target.closest('.element');
    if (tool === 'hand' || space || ev.button === 1) drag = { type: 'pan', sx: p.x, sy: p.y, pan: { ...pan } };
    else if (ev.target.dataset.handle) { const es = editable(); drag = { type: 'resize', handle: ev.target.dataset.handle, sx: p.x, sy: p.y, originals: C.clone(es), box: C.bounds(es), before: C.clone(doc), moved: false }; }
    else if (wrap && ev.target.closest('.board-label')) { boardId = wrap.dataset.board; selected.clear(); const b = board(); drag = { type: 'board', sx: p.x, sy: p.y, x: b.x, y: b.y, before: C.clone(doc), moved: false }; refreshSelection(); }
    else if (target && wrap) {
      if (boardId !== wrap.dataset.board) { boardId = wrap.dataset.board; selected.clear(); }
      const e = board().elements.find(e => e.id === target.dataset.id);
      if (e.locked) return;
      if (ev.shiftKey || !selected.has(e.id) || ev.ctrlKey || ev.metaKey) toggleSelection(e, ev.shiftKey, ev.ctrlKey || ev.metaKey);
      if (selected.has(e.id)) drag = { type: 'move', sx: p.x, sy: p.y, originals: C.clone(editable()), box: C.bounds(editable()), before: C.clone(doc), moved: false };
    } else {
      if (wrap && boardId !== wrap.dataset.board) { boardId = wrap.dataset.board; selected.clear(); }
      const previous = ev.shiftKey ? [...selected] : []; if (!ev.shiftKey) selected.clear();
      drag = { type: 'marquee', sx: p.x, sy: p.y, dp, previous, moved: false }; refreshSelection();
    }
    if (drag && ['pan', 'marquee', 'resize'].includes(drag.type)) viewport.setPointerCapture(ev.pointerId);
  });
  viewport.addEventListener('pointermove', ev => {
    if (!drag) return; const p = point(ev), dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (drag.type === 'pan') { pan = { x: drag.pan.x + dx, y: drag.pan.y + dy }; transform(); return; }
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!drag.moved) viewport.setPointerCapture(ev.pointerId);
    drag.moved = true;
    if (drag.type === 'marquee') {
      const m = $('#marquee'); m.hidden = false; Object.assign(m.style, { left: Math.min(p.x, drag.sx) + 'px', top: Math.min(p.y, drag.sy) + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
      const q = docPoint(ev), b = board(), x = Math.min(q.x, drag.dp.x) - b.x, y = Math.min(q.y, drag.dp.y) - b.y, w = Math.abs(q.x - drag.dp.x), h = Math.abs(q.y - drag.dp.y), ids = new Set(drag.previous);
      b.elements.filter(e => !e.hidden && !e.locked && e.x < x + w && e.x + e.w > x && e.y < y + h && e.y + e.h > y).forEach(e => groupIds(e).forEach(id => ids.add(id))); selected = ids; renderBox(); return;
    }
    if (drag.type === 'board') { board().x = Math.round(drag.x + dx / scale); board().y = Math.round(drag.y + dy / scale); const n = $$('.board').find(n => n.dataset.board === boardId); n.style.left = board().x + 'px'; n.style.top = board().y + 'px'; return; }
    let next, guides;
    if (drag.type === 'move') {
      let x = dx / scale, y = dy / scale;
      if (ev.shiftKey) { if (Math.abs(x) >= Math.abs(y)) y = 0; else x = 0; }
      if (snapping && !ev.altKey) { guides = C.snap({ ...drag.box, x: drag.box.x + x, y: drag.box.y + y }, board().elements.filter(e => !selected.has(e.id) && !e.hidden), board(), 5 / scale); x += guides.x.delta; y += guides.y.delta; }
      next = drag.originals.map(e => ({ ...e, x: Math.round(e.x + x), y: Math.round(e.y + y) }));
    } else {
      const box = drag.box, west = drag.handle.includes('w'), north = drag.handle.includes('n'); let w = Math.max(1, box.w + (west ? -dx : dx) / scale), h = Math.max(1, box.h + (north ? -dy : dy) / scale);
      if (ev.shiftKey) { const ratio = Math.max(w / box.w, h / box.h); w = box.w * ratio; h = box.h * ratio; }
      w = Math.min(10000, w); h = Math.min(10000, h);
      next = C.resize(drag.originals, box, { x: west ? box.x + box.w - w : box.x, y: north ? box.y + box.h - h : box.y, w, h });
    }
    for (const value of next) {
      const e = board().elements.find(e => e.id === value.id); Object.assign(e, value); const n = $$('#world .element').find(n => n.dataset.id === e.id);
      if (n) Object.assign(n.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px' });
    }
    renderBox(); if (guides) { const b = $$('.board').find(n => n.dataset.board === boardId); for (const axis of ['x', 'y']) if (guides[axis].guide !== null) { const g = dom('div', 'guide ' + axis); g.style[axis === 'x' ? 'left' : 'top'] = guides[axis].guide + 'px'; b.append(g); } }
  });
  function finishDrag(cancel = false) {
    if (!drag) return; const current = drag; drag = null; $('#marquee').hidden = true;
    if (current.before && current.moved) { if (cancel || !C.validate(doc)) { doc = current.before; toast(cancel ? '已取消拖动' : '尺寸超出支持范围，已恢复'); } else { history.push(current.before); save(); } render(); }
    else if (current.type === 'marquee') refreshSelection();
    $$('.guide').forEach(n => n.remove());
  }
  viewport.addEventListener('pointerup', () => finishDrag()); viewport.addEventListener('pointercancel', () => finishDrag(true)); viewport.addEventListener('lostpointercapture', () => finishDrag());
  viewport.addEventListener('dblclick', ev => {
    const wrap = ev.target.closest('.board');
    if (wrap && (ev.target.closest('.board-label') || scale < .45)) { select([], wrap.dataset.board); focusCurrent(); return; }
    const n = ev.target.closest('.element.text'); if (!n || tool === 'hand' || space || n.dataset.locked === 'true') return;
    boardId = n.closest('.board').dataset.board; const e = board().elements.find(e => e.id === n.dataset.id); selected = new Set([e.id]); renderBox(); renderInspector(); n.contentEditable = 'true'; n.focus();
    const range = document.createRange(); range.selectNodeContents(n); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); const old = e.text;
    n.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Escape') { n.textContent = old; n.blur(); } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); n.blur(); } };
    n.onpaste = ev => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); };
    n.onblur = () => { const value = n.innerText; n.contentEditable = 'false'; if (value !== old) change(() => { e.text = value.slice(0, 10000); }); else refreshSelection(); };
  });
  viewport.addEventListener('wheel', ev => { if (ev.target.closest('.toolbar')) return; ev.preventDefault(); if (ev.metaKey || ev.ctrlKey) { const p = point(ev); zoom(Math.exp(-ev.deltaY * .008), p.x, p.y); } else { pan.x -= ev.deltaX; pan.y -= ev.deltaY; transform(); } }, { passive: false });
  async function importImage(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast('请选择 PNG、JPG、WebP 或 GIF 图片'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('图片需小于 8 MB'); return; }
    const targetBoard = boardId;
    try {
      const src = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
      if (!doc.boards.some(b => b.id === targetBoard)) { toast('目标画板已删除，请重新导入图片'); return; }
      const w = Math.min(480, img.naturalWidth), h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
      boardId = targetBoard; insert(C.make('image', 40, 40, w, Math.min(10000, h), { src, name: file.name.slice(0, 200), text: file.name })); toast('图片已添加');
    } catch { toast('图片无法解码，请尝试另一张图片'); }
  }
  function download(name, contents, type) { const url = URL.createObjectURL(contents instanceof Blob ? contents : new Blob([contents], { type })); const a = dom('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  function prototypeSurface(b, callback) {
    const s = surface(b, false);
    for (const e of b.elements.filter(e => e.link && !e.hidden)) {
      const hot = button('', () => callback(e.link), 'prototype-hotspot', `${nameOf(e)} → ${doc.boards.find(b => b.id === e.link)?.name}`); hot.setAttribute('aria-label', hot.title); hot.dataset.target = String(doc.boards.findIndex(b => b.id === e.link)); Object.assign(hot.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px' }); s.append(hot);
    }
    return s;
  }
  function renderPreview() {
    const b = doc.boards.find(b => b.id === previewId); if (!b) return;
    $('#previewTitle').textContent = b.name; $('#previewPosition').textContent = `${doc.boards.indexOf(b) + 1} / ${doc.boards.length}`; $('#previewBack').disabled = !previewHistory.length;
    $('#previewBody').replaceChildren(prototypeSurface(b, target => { previewHistory.push(previewId); previewId = target; renderPreview(); })); $('#previewBody').classList.toggle('show-hotspots', hotspots); fitPreview();
  }
  function fitPreview() {
    if (!$('#preview').open) return; const b = doc.boards.find(b => b.id === previewId), v = $('#previewViewport'), s = Math.min((v.clientWidth - 40) / b.w, (v.clientHeight - 40) / b.h, 1.5);
    $('#previewBody').style.transform = `translate(${(v.clientWidth - b.w * s) / 2}px,${(v.clientHeight - b.h * s) / 2}px) scale(${s})`;
  }
  function openPreview() { previewId = boardId; previewHistory = []; hotspots = false; $('#previewLinks').setAttribute('aria-pressed', 'false'); $('#preview').showModal(); renderPreview(); }
  function exportHTML() {
    const sections = doc.boards.map((b, i) => { const n = dom('section', 'slide'); n.dataset.index = i; n.dataset.width = b.w; n.dataset.height = b.h; n.dataset.name = b.name; n.append(prototypeSurface(b, () => {})); return n.outerHTML; }).join('\n');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${C.escape(doc.title)} · Forma 原型</title><style>
*{box-sizing:border-box}body{margin:0;background:#191b1e;color:#e7e8ea;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}header{height:56px;display:flex;align-items:center;gap:20px;padding:0 20px;background:#24272b}header b{flex:1;font-weight:500}button{font:inherit;cursor:pointer;background:#35383e;color:inherit;border:0;border-radius:5px;padding:8px 12px}button:disabled{opacity:.3}#stage{position:absolute;inset:56px 0 30px;overflow:hidden}.slide{position:absolute;transform-origin:0 0}.board-content{position:relative;overflow:hidden}.element{position:absolute;box-sizing:border-box;white-space:pre-wrap;line-height:1.45;overflow:hidden}.element.text{overflow:visible;overflow-wrap:break-word}.element.image img{width:100%;height:100%;object-fit:cover}.prototype-hotspot{position:absolute;background:transparent;border:0;padding:0;border-radius:0}.hotspots .prototype-hotspot{outline:2px solid #a395db;background:#a395db33}.prototype-hotspot:focus-visible{outline:2px solid #a395db}footer{position:absolute;bottom:0;height:30px;width:100%;text-align:center;color:#939ba5;font-size:11px;padding:8px}[hidden]{display:none!important}</style></head><body><header><button id="back">← 返回</button><b id="title"></b><span id="count"></span><button id="hints">显示热点</button></header><main id="stage">${sections}</main><footer>由 Forma 导出 · 点击热点跳转 · 固定画板交互原型</footer><script>
const slides=[...document.querySelectorAll('.slide')],stack=[];let index=${doc.boards.findIndex(b => b.id === boardId)};
function render(){slides.forEach((s,i)=>s.hidden=i!==index);const s=slides[index],stage=document.getElementById('stage'),w=Number(s.dataset.width),h=Number(s.dataset.height),z=Math.max(.01,Math.min((stage.clientWidth-32)/w,(stage.clientHeight-32)/h,1.5));s.style.transform='translate('+((stage.clientWidth-w*z)/2)+'px,'+((stage.clientHeight-h*z)/2)+'px) scale('+z+')';document.getElementById('title').textContent=s.dataset.name;document.getElementById('count').textContent=(index+1)+' / '+slides.length;document.getElementById('back').disabled=!stack.length;}
document.querySelectorAll('[data-target]').forEach(b=>b.onclick=()=>{stack.push(index);index=Number(b.dataset.target);render()});document.getElementById('back').onclick=()=>{if(stack.length){index=stack.pop();render()}};document.getElementById('hints').onclick=()=>document.body.classList.toggle('hotspots');window.addEventListener('resize',render);render();
<\/script></body></html>`;
  }
  function exportSVG(b) {
    const context = document.createElement('canvas').getContext('2d');
    return C.svg(b, doc, (text, e) => {
      context.font = `${e.weight} ${e.size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
      return context.measureText(text).width;
    });
  }
  async function exportFile(type) {
    const filename = (type === 'json' || type === 'html' ? doc.title : board().name).replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 70) || 'Forma';
    try {
      if (type === 'json') download(filename + '.json', JSON.stringify(doc, null, 2), 'application/json');
      if (type === 'html') download(filename + '.html', exportHTML(), 'text/html;charset=utf-8');
      if (type === 'svg') download(filename + '.svg', exportSVG(board()), 'image/svg+xml');
      if (type === 'png') {
        const b = C.clone(board()), ratio = Math.min(2, 8192 / b.w, 8192 / b.h, Math.sqrt(16000000 / (b.w * b.h))), svg = exportSVG(b), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try { const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; }); const canvas = dom('canvas'); canvas.width = Math.max(1, Math.round(b.w * ratio)); canvas.height = Math.max(1, Math.round(b.h * ratio)); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw Error(); download(filename + '.png', blob, 'image/png'); }
        finally { URL.revokeObjectURL(url); }
      }
      $('#exportDialog').close(); toast('已导出 ' + type.toUpperCase());
    } catch { toast('导出失败，请先导出 JSON 备份，再尝试较小的画板'); }
  }
  const commands = () => [
    { name: '新建画板', hint: '选择桌面、移动或自由画板', icon: '▧', key: '', run: () => $('#boardDialog').showModal() },
    { name: '添加文字', hint: '在当前画板写下想法', icon: 'T', key: 'T', run: () => addShape('text') },
    { name: '添加矩形', hint: '卡片、按钮和容器', icon: '▢', key: 'R', run: () => addShape('rect') },
    { name: '添加椭圆', hint: '圆形图案与头像底板', icon: '○', key: 'O', run: () => addShape('ellipse') },
    { name: '插入图片', hint: 'PNG、JPG、WebP、GIF', icon: '▧', run: () => $('#imageInput').click() },
    { name: '查看全部画板', hint: '回到完整设计空间', icon: '⛶', key: 'F', run: fit },
    { name: '聚焦当前画板', hint: '放大查看细节', icon: '⊙', key: '⇧ 2', run: () => focusBoard() },
    { name: '预览交互原型', hint: '体验页面跳转', icon: '▷', run: openPreview },
    { name: '导出设计', hint: 'JSON / HTML / SVG / PNG', icon: '↗', run: () => $('#exportDialog').showModal() },
    { name: '导入设计 JSON', hint: '支持 Forma v1 和 v2 文件', icon: '↙', run: () => $('#jsonInput').click() },
    { name: '创建组件', hint: '将所选图层加入组件库', icon: '◇', run: createComponent },
    { name: '复制所选图层或画板', hint: '保留可编辑结构', icon: '⧉', key: '⌘ D', run: duplicateSelection },
    { name: '分组', hint: '把所选图层作为整体移动', icon: '▱', key: '⌘ G', run: group },
    { name: '取消分组', hint: '恢复独立图层', icon: '▱', key: '⌘ ⇧ G', run: ungroup },
    { name: '撤销', hint: '恢复上一步设计', icon: '↶', key: '⌘ Z', run: undo },
    { name: '重做', hint: '重新应用撤销的操作', icon: '↷', key: '⌘ ⇧ Z', run: redo },
    { name: '打开 Orbit 设计示例', hint: '导入本地 Figma 参考稿，包含 3 张画板', icon: '✳', run: addOrbit },
    { name: '快捷键与使用说明', hint: '了解工作台的全部能力', icon: '?', run: () => $('#help').showModal() },
    ...doc.boards.map(b => ({ name: b.name, hint: '跳转到画板', icon: '▧', run: () => { select([], b.id); focusBoard(b); } }))
  ];
  function renderCommands() {
    const q = $('#commandSearch').value.toLowerCase(); commandMatches = commands().filter(c => (c.name + c.hint).toLowerCase().includes(q)); commandIndex = Math.max(0, Math.min(commandIndex, commandMatches.length - 1)); $('#commandResults').replaceChildren();
    commandMatches.forEach((c, i) => { const row = button('', () => executeCommand(i), 'command-row' + (i === commandIndex ? ' active' : '')); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', i === commandIndex); const info = dom('div'); info.append(dom('b', '', c.name), dom('small', '', c.hint)); row.append(dom('span', 'cmd-icon', c.icon), info, dom('kbd', '', c.key || '↵')); $('#commandResults').append(row); });
    if (!commandMatches.length) $('#commandResults').append(dom('p', 'empty-note', '没有匹配的操作，试试「画板」「导出」或「组件」。'));
    $('#commandResults .active')?.scrollIntoView({ block: 'nearest' });
  }
  function executeCommand(i) { const c = commandMatches[i]; if (!c) return; $('#commands').close(); c.run(); }
  function openCommands() { $('#commandSearch').value = ''; commandIndex = 0; $('#commands').showModal(); renderCommands(); $('#commandSearch').focus(); }
  $('#commandSearch').oninput = () => { commandIndex = 0; renderCommands(); };
  $('#commandSearch').onkeydown = ev => { if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); commandIndex = (commandIndex + (ev.key === 'ArrowDown' ? 1 : -1) + commandMatches.length) % Math.max(1, commandMatches.length); renderCommands(); } else if (ev.key === 'Enter') { ev.preventDefault(); executeCommand(commandIndex); } };
  $('#projectTitle').onchange = ev => change(() => { doc.title = ev.target.value.trim().slice(0, 200) || '未命名设计'; });
  $('#undo').onclick = undo; $('#redo').onclick = redo; $('#commandBtn').onclick = openCommands;
  $('#homeBtn').onclick = () => setPanel('left'); $('#collapseLayers').onclick = () => { setPanel('left', false); $('#homeBtn').focus(); };
  $('#toggleInspector').onclick = () => setPanel('right'); $('#collapseInspector').onclick = () => { setPanel('right', false); $('#toggleInspector').focus(); };
  function closeZoom() { $('#zoomMenu').hidden = true; $('#zoomLabel').setAttribute('aria-expanded', 'false'); }
  $('#zoomLabel').onclick = () => { $('#zoomMenu').hidden = !$('#zoomMenu').hidden; $('#zoomLabel').setAttribute('aria-expanded', !$('#zoomMenu').hidden); };
  $('#fitBtn').onclick = () => { fit(); closeZoom(); }; $('#focusBtn').onclick = focusCurrent; $('#zoomFocus').onclick = () => { focusCurrent(); closeZoom(); };
  $$('[data-zoom]').forEach(b => b.onclick = () => { zoomToBoard(Number(b.dataset.zoom)); closeZoom(); });
  document.addEventListener('pointerdown', ev => { if (!ev.target.closest('.view-controls')) closeZoom(); });
  $('#zoomIn').onclick = () => zoom(1.25); $('#zoomOut').onclick = () => zoom(.8);
  $('#selectTool').onclick = () => setTool('select'); $('#handTool').onclick = () => setTool('hand');
  $('#addText').onclick = () => addShape('text'); $('#addRect').onclick = () => addShape('rect'); $('#addEllipse').onclick = () => addShape('ellipse');
  $('#addBoard').onclick = () => $('#boardDialog').showModal(); $$('[data-preset]').forEach(b => b.onclick = () => addBoard(...b.dataset.preset.split(',').map(Number)));
  $('#orbitBtn').onclick = addOrbit; $('#layersTab').onclick = () => showAssets(false); $('#assetsTab').onclick = () => showAssets(true); $('#layerSearch').oninput = renderLayers;
  $('#snapBtn').onclick = () => { snapping = !snapping; $('#snapBtn').classList.toggle('snap-active', snapping); $('#snapBtn').setAttribute('aria-pressed', snapping); };
  $$('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; $$('[data-mode]').forEach(n => { n.classList.toggle('active', n === b); n.setAttribute('aria-selected', n === b); }); renderInspector(); });
  $('#helpBtn').onclick = () => $('#help').showModal(); $$('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $('#exportBtn').onclick = () => $('#exportDialog').showModal(); $$('[data-export]').forEach(b => b.onclick = () => exportFile(b.dataset.export));
  $('#previewBtn').onclick = openPreview; $('#previewBack').onclick = () => { if (previewHistory.length) { previewId = previewHistory.pop(); renderPreview(); } }; $('#previewLinks').onclick = () => { hotspots = !hotspots; $('#previewLinks').setAttribute('aria-pressed', hotspots); $('#previewBody').classList.toggle('show-hotspots', hotspots); };
  $('#addImage').onclick = () => $('#imageInput').click(); $('#imageInput').onchange = ev => { importImage(ev.target.files[0]); ev.target.value = ''; };
  viewport.ondragover = ev => { ev.preventDefault(); }; viewport.ondrop = ev => { ev.preventDefault(); importImage(ev.dataTransfer.files[0]); };
  $('#importBtn').onclick = () => $('#jsonInput').click(); $('#jsonInput').onchange = async ev => {
    const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
    try { if (file.size > 20 * 1024 * 1024) throw Error('文件超过 20 MB'); const data = C.parse(await file.text()); change(() => { doc = data; boardId = doc.boards[0].id; selected.clear(); }, '设计已导入，可用撤销恢复原设计'); fit(); }
    catch (err) { toast('导入失败：' + (err.message || '请选择有效的 Forma JSON 文件')); }
  };
  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input,textarea,select,[contenteditable="true"]') || $('dialog[open]')) return;
    const mod = ev.metaKey || ev.ctrlKey, key = ev.key.toLowerCase();
    if (mod) {
      const actions = { z: () => ev.shiftKey ? redo() : undo(), y: redo, k: openCommands, d: duplicateSelection, g: () => ev.shiftKey ? ungroup() : group(), s: () => exportFile('json'), a: () => select(board().elements.filter(e => !e.hidden && !e.locked).map(e => e.id)), c: () => { if (selected.size) { clipboard = C.clone(selection()); toast('图层已复制，可在其他画板粘贴'); } }, v: () => { if (clipboard) insert(C.duplicate(clipboard)); } };
      if (actions[key]) { ev.preventDefault(); actions[key](); } return;
    }
    if (ev.code === 'Space') { ev.preventDefault(); space = true; viewport.classList.add('hand'); return; }
    if (key === 'escape') { closeZoom(); if (drag) finishDrag(true); else select([]); return; }
    if (key === 'delete' || key === 'backspace') { if (selected.size) { ev.preventDefault(); deleteSelection(); } return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); const step = ev.shiftKey ? 10 : 1; change(() => editable().forEach(e => { e.x += ev.key === 'ArrowRight' ? step : ev.key === 'ArrowLeft' ? -step : 0; e.y += ev.key === 'ArrowDown' ? step : ev.key === 'ArrowUp' ? -step : 0; })); return; }
    if (ev.shiftKey && ev.code === 'Digit2') { ev.preventDefault(); focusCurrent(); return; }
    const actions = { v: () => setTool('select'), h: () => setTool('hand'), t: () => addShape('text'), r: () => addShape('rect'), o: () => addShape('ellipse'), f: fit, '?': () => $('#help').showModal() }; if (actions[key]) { ev.preventDefault(); actions[key](); }
  });
  document.addEventListener('keyup', ev => { if (ev.code === 'Space') { space = false; setTool(tool); } });
  window.addEventListener('blur', () => { space = false; finishDrag(); setTool(tool); }); window.addEventListener('resize', () => { fitPreview(); });
  let viewportSize = { w: viewport.clientWidth, h: viewport.clientHeight };
  new ResizeObserver(() => {
    const next = { w: viewport.clientWidth, h: viewport.clientHeight };
    pan.x += (next.w - viewportSize.w) / 2; pan.y += (next.h - viewportSize.h) / 2;
    viewportSize = next; transform();
  }).observe(viewport);
  compactQuery.addEventListener('change', () => { applyPanels(); requestAnimationFrame(() => focusBoard()); });
  render(); focusBoard(); if (bootMessage) toast(bootMessage);
})();
