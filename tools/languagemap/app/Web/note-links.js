'use strict';
// Shared by the browser and the local regression tests.
(function(root){
 const tokenPattern=/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;
 const normalize=word=>word.normalize('NFC').replaceAll('’',"'").toLowerCase();
 const unspaced=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
 function containsWord(text,word){const w=normalize(String(word||''));return !!w&&(unspaced.test(w)?normalize(String(text||'')).includes(w):wordsIn(text).has(w));}
 const wordsIn=text=>new Set((String(text||'').match(tokenPattern)||[]).map(normalize));
 function selectionWord(text,before='',after=''){
  const word=text.trim();
  if(word.length>60||!new RegExp('^'+tokenPattern.source+'$','u').test(word))return '';
  // Unspaced scripts use the user's explicit selection; Latin-style word fragments remain invalid.
  if(unspaced.test(word))return word;
  if(!/^\s/u.test(text)&&/[\p{L}\p{M}'’\-]$/u.test(before))return '';
  if(!/\s$/u.test(text)&&/^[\p{L}\p{M}'’\-]/u.test(after))return '';
  return word;
 }
 function reconcileBranches(list,parent){
  const removed=new Set();
  const missing=list.filter(n=>n.parent===parent.id&&!containsWord(parent.en,n.word));
  for(const child of missing){
   const branchIds=new Set([child.id]);
   let size;
   do{size=branchIds.size;for(const n of list)if(branchIds.has(n.parent))branchIds.add(n.id);}while(size!==branchIds.size);
   const branch=list.filter(n=>branchIds.has(n.id));
   (parent.detachedBranches??=[]).push({word:child.word,nodes:branch});
   branchIds.forEach(id=>removed.add(id));
  }
  // Keep the array identity: dayData and the current canvas share this list.
  for(let i=list.length-1;i>=0;i--)if(removed.has(list[i].id))list.splice(i,1);
  let restored=false;
  parent.detachedBranches=(parent.detachedBranches||[]).filter(branch=>{
   if(!containsWord(parent.en,branch.word))return true;
   const ids=new Set(list.map(n=>n.id));
   for(const n of branch.nodes)if(!ids.has(n.id)){list.push(n);ids.add(n.id);}
   restored=true;return false;
  });
  if(!parent.detachedBranches.length)delete parent.detachedBranches;
  return removed.size>0||restored;
 }
 const api={normalize,wordsIn,containsWord,selectionWord,reconcileBranches};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.NoteLinks=api;
})(globalThis);
