/* Camera input is independent of word editing and node layout. */
(function(root){
 function zoomAt(view,factor,x,y){const z=Math.max(.2,Math.min(2.5,view.z*factor));return{x:x-(x-view.x)*z/view.z,y:y-(y-view.y)*z/view.z,z};}
 function attach({canvas,host=window,document:doc=window.document,getView,applyView,canStart,onStart=()=>{},onBackgroundClick=()=>{}}){
  const pointers=new Map();let gesture=null;
  const point=e=>({x:e.clientX,y:e.clientY});
  function reset(){const ids=[...pointers.keys()];pointers.clear();gesture=null;canvas.classList.remove('dragging');for(const id of ids)if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
  function rebase(){const p=[...pointers.values()],v={...getView()};if(!p.length){gesture=null;return;}gesture={view:v,start:p[0],moved:false};if(p.length>1){gesture.center={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};gesture.distance=Math.max(1,Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y));gesture.moved=true;}}
  canvas.addEventListener('pointerdown',e=>{if(![0,1].includes(e.button)||!canStart(e))return;if(e.pointerType!=='touch')reset();onStart();pointers.set(e.pointerId,point(e));canvas.setPointerCapture(e.pointerId);rebase();e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{
   if(!pointers.has(e.pointerId)||!gesture)return;
   if(e.pointerType!=='touch'&&(e.buttons&5)===0){reset();return;}
   pointers.set(e.pointerId,point(e));const p=[...pointers.values()];
   if(p.length>1&&gesture.center){const center={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2},distance=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y),r=canvas.getBoundingClientRect(),v=zoomAt(gesture.view,distance/gesture.distance,gesture.center.x-r.left,gesture.center.y-r.top);v.x+=center.x-gesture.center.x;v.y+=center.y-gesture.center.y;applyView(v);}
   else{const dx=e.clientX-gesture.start.x,dy=e.clientY-gesture.start.y;if(!gesture.moved&&Math.hypot(dx,dy)<4)return;gesture.moved=true;applyView({...gesture.view,x:gesture.view.x+dx,y:gesture.view.y+dy});}
   canvas.classList.add('dragging');e.preventDefault();
  });
  function end(e){if(!pointers.has(e.pointerId))return;const click=gesture&&!gesture.moved&&pointers.size===1&&e.button===0;pointers.delete(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(pointers.size)rebase();else{gesture=null;canvas.classList.remove('dragging');}if(click)onBackgroundClick(e);}
  canvas.addEventListener('pointerup',end);host.addEventListener('pointerup',end);
  canvas.addEventListener('pointercancel',reset);canvas.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))reset();});
  host.addEventListener('blur',reset);doc.addEventListener('visibilitychange',()=>{if(doc.hidden)reset();});
  canvas.addEventListener('wheel',e=>{
   if(e.target.closest('.note,button,input,[contenteditable="true"]')||(!e.deltaX&&!e.deltaY))return;
   e.preventDefault();reset();onStart();const v=getView(),r=canvas.getBoundingClientRect(),unit=e.deltaMode===1?16:e.deltaMode===2?r.height:1,dx=e.deltaX*unit,dy=e.deltaY*unit;
   if(e.ctrlKey||e.metaKey){if(dy)applyView(zoomAt(v,Math.exp(-Math.max(-120,Math.min(120,dy))*.008),e.clientX-r.left,e.clientY-r.top));}
   else applyView({...v,x:v.x-(e.shiftKey&&!dx?dy:dx),y:v.y-(e.shiftKey&&!dx?0:dy)});
  },{passive:false});
  return{reset};
 }
 root.CanvasInput={attach,zoomAt};if(typeof module!=='undefined')module.exports=root.CanvasInput;
})(typeof window!=='undefined'?window:globalThis);
