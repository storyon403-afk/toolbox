const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');
require('../src/seed.js');
const seed = () => FormaSeeds.seed();

test('both editable reference sets validate and have valid prototype targets', () => {
  const d = seed(); d.boards.push(...FormaSeeds.orbit());
  assert.equal(C.validate(d), true);
  assert.equal(d.boards.length, 6);
  assert.ok(d.boards[3].elements.some(e => e.link === d.boards[4].id));
});
test('v1 migration preserves geometry and text', () => {
  const d = seed(); d.version = 1; delete d.tokens; delete d.components;
  d.boards.forEach(b => b.elements.forEach(e => { delete e.fillToken; delete e.componentId; }));
  const migrated = C.parse(d);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.boards[0].elements[1].text, 'folio.');
  assert.equal(migrated.boards[0].elements[1].x, 23);
});
test('reject duplicate ids, non-finite geometry, unsafe images and broken references', () => {
  for (const mutate of [
    d => { d.boards[0].elements[0].id = d.boards[0].id; },
    d => { d.boards[0].elements[0].x = Infinity; },
    d => { d.boards[0].elements[0].w = -1; },
    d => { d.boards[0].elements[0].link = 'missing'; },
    d => { d.boards[0].elements[0].fillToken = 'missing'; },
    d => { const e = d.boards[0].elements[0]; e.type = 'image'; e.src = 'javascript:alert(1)'; },
    d => { const e = d.boards[0].elements[0]; e.type = 'image'; e.src = 'https://example.com/tracker.png'; },
  ]) { const d = seed(); mutate(d); assert.equal(C.validate(d), false); }
});
test('multi-selection resizing preserves relative positions and dimensions', () => {
  const es = [C.make('rect', 10, 20, 40, 30), C.make('rect', 70, 60, 20, 10)];
  const resized = C.resize(es, C.bounds(es), { x: 100, y: 200, w: 160, h: 100 });
  assert.deepEqual(resized.map(e => [e.x, e.y, e.w, e.h]), [[100, 200, 80, 60], [220, 280, 40, 20]]);
});
test('single selection aligns to board, multiple selections align to their bounds', () => {
  const a = C.make('rect', 40, 80, 20, 30), b = C.make('rect', 100, 10, 40, 40);
  C.align([a], 'center', { w: 100, h: 100 }); assert.equal(a.x, 40);
  C.align([a, b], 'bottom', { w: 100, h: 100 }); assert.equal(a.y + a.h, b.y + b.h);
  C.arrange([a, b], 'horizontal', 16); assert.equal(b.x, a.x + a.w + 16);
});
test('snapping uses board and layer edges within threshold only', () => {
  const result = C.snap({ x: 3, y: 41, w: 20, h: 20 }, [], { w: 100, h: 100 }, 5);
  assert.equal(result.x.delta, -3); assert.equal(result.x.guide, 0);
  assert.equal(result.y.delta, -1); assert.equal(result.y.guide, 50);
});
test('component update preserves instance placement and refreshes child content', () => {
  const d = seed(), b = d.boards[0]; const originals = [C.make('rect', 10, 10, 100, 40), C.make('text', 20, 20, 80, 20, { text: 'Start' })];
  b.elements.push(...originals); const c = C.component(d, originals, 'Button');
  const instance = C.instantiate(c, 300, 400); b.elements.push(...instance); originals[1].text = 'Finish';
  assert.equal(C.updateComponent(d, originals), true);
  const copy = b.elements.filter(e => e.groupId === instance[0].groupId);
  assert.equal(copy[0].x, 300); assert.equal(copy[0].y, 400); assert.equal(copy[1].text, 'Finish'); assert.equal(C.validate(d), true);
});
test('deleting a board clears links from documents and templates', () => {
  const d = seed(), id = d.boards[0].id; assert.equal(C.removeBoard(d, id), true);
  assert.equal(C.validate(d), true); assert.ok(d.components.every(c => c.elements.every(e => e.link !== id)));
});
test('duplicate groups get new identities, undo/redo restore exact documents', () => {
  const d = seed(), c = d.components[0], first = C.instantiate(c), copy = C.duplicate(first);
  assert.notEqual(copy[0].groupId, first[0].groupId); assert.equal(copy[0].groupId, copy[1].groupId);
  const h = new C.History(), before = JSON.stringify(d); h.push(d); d.title = 'Changed';
  const restored = h.undo(d); assert.equal(JSON.stringify(restored), before); assert.equal(h.redo(restored).title, 'Changed');
});
test('SVG escapes user text and excludes hidden elements', () => {
  const d = seed(), b = d.boards[0]; b.elements = [C.make('text', 0, 0, 100, 30, { text: '<script>alert("x")</script>&' }), C.make('rect', 0, 0, 10, 10, { fill: '#abcdef', hidden: true })];
  const svg = C.svg(b, d); assert.ok(svg.includes('&lt;script&gt;')); assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('#abcdef'));
});
