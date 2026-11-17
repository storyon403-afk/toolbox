const test=require('node:test');
const assert=require('node:assert/strict');
const {wordsIn,selectionWord,reconcileBranches}=require('../app/Web/note-links.js');
const fixture=()=>[
 {id:'root',word:'root',en:'A chance and good luck.',parent:null},
 {id:'chance',word:'chance',en:'An accident.',parent:'root',zh:'已有笔记'},
 {id:'accident',word:'accident',en:'',parent:'chance'},
 {id:'luck',word:'luck',en:'',parent:'root'},
 {id:'other',word:'other',en:'',parent:null}
];
test('editing a source removes only its missing branch, preserving downstream notes',()=>{
 const list=fixture(),root=list[0];root.en='Good luck.';
 assert.equal(reconcileBranches(list,root),true);
 assert.deepEqual(list.map(n=>n.id),['root','luck','other']);
 assert.equal(root.detachedBranches[0].nodes[0].zh,'已有笔记');
 assert.deepEqual(root.detachedBranches[0].nodes.map(n=>n.id),['chance','accident']);
});
test('clearing, persisting, and restoring source words recovers the exact branch without duplicates',()=>{
 let list=fixture();list[0].en='';reconcileBranches(list,list[0]);
 assert.deepEqual(list.map(n=>n.id),['root','other']);
 list=JSON.parse(JSON.stringify(list));list[0].en='CHANCE, luck and chance.';
 assert.equal(reconcileBranches(list,list[0]),true);
 assert.equal(reconcileBranches(list,list[0]),false);
 assert.equal(list.length,5);assert.equal(list[0].detachedBranches,undefined);
 assert.equal(list.find(n=>n.id==='accident').parent,'chance');
});
test('whole words, apostrophes and hyphens match, but substrings do not',()=>{
 assert.deepEqual([...wordsIn("Luck, lucky! DON'T don’t well-being.")],['luck','lucky',"don't",'well-being']);
 const list=fixture();list[0].en='Chances and lucky.';reconcileBranches(list,list[0]);
 assert.deepEqual(list.map(n=>n.id),['root','other']);
});
test('selection accepts one whole word and rejects stale/partial/phrase selections',()=>{
 assert.equal(selectionWord('bright','A ',' day.'),'bright');
 assert.equal(selectionWord(' bright ','A','day.'),'bright');
 assert.equal(selectionWord('well-being','', '.'),'well-being');
 for(const args of [['','', ''],['bright day','',''],['right','b',' day'],['bright','','er'],['---','','']])assert.equal(selectionWord(...args),'');
});
test('a nested source edit survives detaching and restoring its ancestor',()=>{
 const list=fixture(),root=list[0],child=list[1];child.en='';reconcileBranches(list,child);
 root.en='';reconcileBranches(list,root);root.en='chance';reconcileBranches(list,root);
 assert.deepEqual(list.map(n=>n.id),['root','other','chance']);
 child.en='accident';reconcileBranches(list,child);
 assert.equal(list.find(n=>n.id==='accident').parent,'chance');
});


test('explicit Japanese and Chinese selections link without whitespace and restore after editing',()=>{
 const N=require('../app/Web/note-links.js');
 assert.equal(N.selectionWord('偶然','美しい','の出会い'),'偶然');
 assert.equal(N.selectionWord('美好','遇见','的事物'),'美好');
 assert.equal(N.selectionWord('école','une ',' proche'),'école');
 assert.equal(N.selectionWord('chance','mis',''),'');
 assert(N.containsWord('美しい偶然の出会い','偶然'));
 const parent={id:'a',en:'美しい偶然の出会い'},child={id:'b',parent:'a',word:'偶然',en:'by chance'},list=[parent,child];
 assert.equal(N.reconcileBranches(list,parent),false);
 parent.en='美しい出会い';assert(N.reconcileBranches(list,parent));assert.equal(list.length,1);
 parent.en='偶然の出会い';assert(N.reconcileBranches(list,parent));assert.equal(list[1],child);
});
