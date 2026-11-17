/* Forma document model. Shared by the browser and Node tests. */
(function (root) {
  'use strict';
  const id = () => globalThis.crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const finite = (v, min = -100000, max = 100000) => Number.isFinite(v) && v >= min && v <= max;
  const str = (v, max = 10000) => typeof v === 'string' && v.length <= max;
  const image = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 12000000;
  function make(type, x, y, w, h, extra = {}) {
    return { id: id(), type, name: { text: '文字', rect: '矩形', ellipse: '椭圆', image: '图片' }[type], x, y, w, h, fill: '#d5c3b0', radius: 0, size: 16, weight: 400, text: '', opacity: 1, stroke: '#000000', strokeWidth: 0, hidden: false, locked: false, ...extra };
  }
  function bounds(elements) {
    if (!elements.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.min(...elements.map(e => e.x)), y = Math.min(...elements.map(e => e.y));
    return { x, y, w: Math.max(...elements.map(e => e.x + e.w)) - x, h: Math.max(...elements.map(e => e.y + e.h)) - y };
  }
  function migrate(input) {
    const d = clone(input);
    if (d?.version === 1) {
      d.version = 2; d.tokens = []; d.components = [];
      d.boards?.forEach(b => b.elements?.forEach(e => Object.assign(e, { name: e.type === 'text' ? e.text.slice(0, 24) : e.type === 'image' ? '图片' : '矩形', opacity: 1, stroke: '#000000', strokeWidth: 0, hidden: false, locked: false })));
    }
    return d;
  }
  function validate(d) {
    if (!d || d.version !== 2 || !str(d.title, 200) || !Array.isArray(d.boards) || !d.boards.length || d.boards.length > 100 || !Array.isArray(d.tokens) || d.tokens.length > 200 || !Array.isArray(d.components) || d.components.length > 200) return false;
    const ids = new Set(), groups = new Map();
    const unique = v => str(v, 100) && v.length && !ids.has(v) && (ids.add(v), true);
    for (const t of d.tokens) if (!t || !unique(t.id) || !str(t.name, 100) || !color(t.value)) return false;
    const tokens = new Set(d.tokens.map(t => t.id)), boards = new Set(d.boards.map(b => b?.id)), components = new Set(d.components.map(c => c?.id));
    function validElement(e, owner, template = false) {
      if (!e || !unique(e.id) || !['text', 'rect', 'ellipse', 'image'].includes(e.type) || !str(e.name, 200) || !str(e.text) || ![e.x, e.y].every(v => finite(v)) || ![e.w, e.h].every(v => finite(v, 1, 10000)) || !finite(e.radius, 0, 5000) || !finite(e.size, 1, 1000) || !finite(e.weight, 100, 900) || !finite(e.opacity, 0, 1) || !finite(e.strokeWidth, 0, 100) || !color(e.fill) || !color(e.stroke) || typeof e.hidden !== 'boolean' || typeof e.locked !== 'boolean') return false;
      if (e.type === 'image' && !image(e.src)) return false;
      if (e.fillToken !== undefined && !tokens.has(e.fillToken)) return false;
      if (e.link !== undefined && !boards.has(e.link)) return false;
      if (e.groupId !== undefined) {
        if (!str(e.groupId, 100) || !e.groupId) return false;
        if (groups.has(e.groupId) && groups.get(e.groupId) !== owner) return false;
        groups.set(e.groupId, owner);
      }
      if (e.componentId !== undefined && (!components.has(e.componentId) || !e.groupId || template)) return false;
      return true;
    }
    for (const b of d.boards) {
      if (!b || !unique(b.id) || !str(b.name, 200) || !color(b.bg) || ![b.x, b.y].every(v => finite(v)) || ![b.w, b.h].every(v => finite(v, 1, 10000)) || !Array.isArray(b.elements) || b.elements.length > 2000) return false;
      if (!b.elements.every(e => validElement(e, b.id))) return false;
    }
    for (const c of d.components) {
      if (!c || !unique(c.id) || !str(c.name, 200) || !Array.isArray(c.elements) || !c.elements.length || c.elements.length > 2000 || !c.elements.every(e => validElement(e, c.id, true))) return false;
    }
    return true;
  }
  function parse(input) {
    const d = migrate(typeof input === 'string' ? JSON.parse(input) : input);
    if (!validate(d)) throw new Error('文件结构、图层数据或引用无效');
    return d;
  }
  function duplicate(elements, dx = 24, dy = 24) {
    const groups = new Map();
    return elements.map(source => {
      const e = clone(source); e.id = id(); e.x += dx; e.y += dy;
      if (e.groupId) { if (!groups.has(e.groupId)) groups.set(e.groupId, id()); e.groupId = groups.get(e.groupId); }
      return e;
    });
  }
  function align(elements, axis, b) {
    const box = elements.length === 1 ? { x: 0, y: 0, w: b.w, h: b.h } : bounds(elements);
    for (const e of elements) {
      if (axis === 'left') e.x = box.x;
      if (axis === 'center') e.x = box.x + (box.w - e.w) / 2;
      if (axis === 'right') e.x = box.x + box.w - e.w;
      if (axis === 'top') e.y = box.y;
      if (axis === 'middle') e.y = box.y + (box.h - e.h) / 2;
      if (axis === 'bottom') e.y = box.y + box.h - e.h;
    }
  }
  function arrange(elements, direction, gap) {
    const box = bounds(elements), horizontal = direction === 'horizontal';
    const sorted = [...elements].sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);
    let cursor = horizontal ? box.x : box.y;
    for (const e of sorted) { if (horizontal) { e.x = cursor; e.y = box.y; cursor += e.w + gap; } else { e.y = cursor; e.x = box.x; cursor += e.h + gap; } }
  }
  function resize(originals, box, target) {
    const sx = target.w / box.w, sy = target.h / box.h;
    return originals.map(e => ({ ...e, x: target.x + (e.x - box.x) * sx, y: target.y + (e.y - box.y) * sy, w: Math.max(1, e.w * sx), h: Math.max(1, e.h * sy) }));
  }
  function snap(box, others, b, threshold) {
    const xs = [0, b.w / 2, b.w], ys = [0, b.h / 2, b.h];
    for (const e of others) { xs.push(e.x, e.x + e.w / 2, e.x + e.w); ys.push(e.y, e.y + e.h / 2, e.y + e.h); }
    function nearest(points, targets) {
      let delta = threshold + 1, guide = null;
      for (const p of points) for (const t of targets) if (Math.abs(t - p) < Math.abs(delta)) { delta = t - p; guide = t; }
      return Math.abs(delta) <= threshold ? { delta, guide } : { delta: 0, guide: null };
    }
    return { x: nearest([box.x, box.x + box.w / 2, box.x + box.w], xs), y: nearest([box.y, box.y + box.h / 2, box.y + box.h], ys) };
  }
  function component(d, elements, name) {
    const box = bounds(elements), c = { id: id(), name, elements: duplicate(elements, -box.x, -box.y) }, groupId = id();
    c.elements.forEach(e => { delete e.groupId; delete e.componentId; });
    elements.forEach(e => { e.groupId = groupId; e.componentId = c.id; });
    d.components.push(c); return c;
  }
  function instantiate(c, x = 40, y = 40) {
    const groupId = id();
    return duplicate(c.elements, x, y).map(e => ({ ...e, groupId, componentId: c.id, locked: false }));
  }
  function updateComponent(d, elements) {
    const c = d.components.find(c => c.id === elements[0]?.componentId);
    if (!c || elements.some(e => e.componentId !== c.id || e.groupId !== elements[0].groupId)) return false;
    const box = bounds(elements);
    c.elements = duplicate(elements, -box.x, -box.y).map(e => { delete e.groupId; delete e.componentId; return e; });
    const sourceGroup = elements[0].groupId;
    for (const b of d.boards) {
      const instances = new Map();
      b.elements.forEach(e => { if (e.componentId === c.id && e.groupId !== sourceGroup) { if (!instances.has(e.groupId)) instances.set(e.groupId, []); instances.get(e.groupId).push(e); } });
      for (const [group, old] of instances) {
        const box = bounds(old), index = b.elements.findIndex(e => e.groupId === group), next = instantiate(c, box.x, box.y);
        next.forEach(e => { e.groupId = group; });
        b.elements = b.elements.filter(e => e.groupId !== group); b.elements.splice(index, 0, ...next);
      }
    }
    return true;
  }
  function removeBoard(d, boardId) {
    if (d.boards.length <= 1) return false;
    d.boards = d.boards.filter(b => b.id !== boardId);
    for (const container of [...d.boards, ...d.components]) for (const e of container.elements) if (e.link === boardId) delete e.link;
    return true;
  }
  class History {
    constructor() { this.past = []; this.future = []; }
    push(d) { this.past.push(JSON.stringify(d)); if (this.past.length > 60) this.past.shift(); this.future = []; }
    undo(d) { if (!this.past.length) return d; this.future.push(JSON.stringify(d)); return JSON.parse(this.past.pop()); }
    redo(d) { if (!this.future.length) return d; this.past.push(JSON.stringify(d)); return JSON.parse(this.future.pop()); }
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const fill = (e, d) => d.tokens.find(t => t.id === e.fillToken)?.value || e.fill;
  function wrapText(text, width, measure) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (line && measure(line + char) > width) {
          const split = line.lastIndexOf(' ');
          if (split > 0 && /[a-z0-9]/i.test(char) && /[a-z0-9]$/i.test(line)) {
            lines.push(line.slice(0, split + 1)); line = line.slice(split + 1);
          } else { lines.push(line); line = ''; }
        }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  function svg(b, d, measure) {
    const body = b.elements.filter(e => !e.hidden).map((e, index) => {
      const sw = Math.min(e.strokeWidth, e.w, e.h), x = e.x + sw / 2, y = e.y + sw / 2, w = Math.max(0, e.w - sw), h = Math.max(0, e.h - sw);
      const border = `stroke="${e.stroke}" stroke-width="${sw}"`;
      const frame = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${e.radius}" fill="none" ${border}/>`;
      let shape;
      if (e.type === 'text') {
        const lines = measure ? wrapText(e.text, Math.max(1, e.w - 2 * sw), text => measure(text, e)) : e.text.split('\n');
        shape = (sw ? frame : '') + `<text fill="${fill(e, d)}" font-family="-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif" font-size="${e.size}" font-weight="${e.weight}" xml:space="preserve">${lines.map((line, i) => `<tspan x="${e.x + sw}" y="${e.y + sw + e.size * (1.08 + i * 1.45)}">${escape(line)}</tspan>`).join('')}</text>`;
      } else if (e.type === 'ellipse') shape = `<ellipse cx="${e.x + e.w / 2}" cy="${e.y + e.h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill(e, d)}" ${border}/>`;
      else if (e.type === 'image') {
        const clip = 'image-clip-' + index;
        shape = `<defs><clipPath id="${clip}"><rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="${e.radius}"/></clipPath></defs><image x="${e.x + sw}" y="${e.y + sw}" width="${Math.max(0, e.w - 2 * sw)}" height="${Math.max(0, e.h - 2 * sw)}" href="${escape(e.src)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>${sw ? frame : ''}`;
      } else shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${e.radius}" fill="${fill(e, d)}" ${border}/>`;
      return `<g opacity="${e.opacity}">${shape}</g>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="0 0 ${b.w} ${b.h}"><title>${escape(b.name)}</title><defs><clipPath id="board-clip"><rect width="${b.w}" height="${b.h}"/></clipPath></defs><g clip-path="url(#board-clip)"><rect width="${b.w}" height="${b.h}" fill="${b.bg}"/>${body}</g></svg>`;
  }
  root.FormaCore = { id, clone, make, bounds, migrate, validate, parse, duplicate, align, arrange, resize, snap, component, instantiate, updateComponent, removeBoard, History, escape, fill, wrapText, svg };
  if (typeof module !== 'undefined') module.exports = root.FormaCore;
})(globalThis);
