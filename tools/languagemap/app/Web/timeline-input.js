(function(root){
 function attach({element,getPosition,setPosition,getStep,onStart=()=>{}}){let drag=null,suppressUntil=0,raf=0,timer=0;
  const cancelAnimation=()=>{cancelAnimationFrame(raf);clearTimeout(timer);};
  function settle(){const from=getPosition(),to=Math.round(from),start=performance.now();cancelAnimation();if(matchMedia('(prefers-reduced-motion: reduce)').matches){setPosition(to);return;}function tick(now){const t=Math.min(1,(now-start)/220);setPosition(from+(to-from)*(1-(1-t)**3));if(t<1)raf=requestAnimationFrame(tick);}raf=requestAnimationFrame(tick);}
  function finish(){if(!drag)return;const d=drag;drag=null;const moved=d.moved;if(element.hasPointerCapture(d.id))element.releasePointerCapture(d.id);element.classList.remove('is-dragging');if(moved){suppressUntil=performance.now()+400;settle();}}
  element.addEventListener('pointerdown',e=>{if(e.button!==0)return;suppressUntil=0;cancelAnimation();drag={id:e.pointerId,x:e.clientX,y:e.clientY,position:getPosition(),moved:false};});
  element.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;if(e.pointerType!=='touch'&&!(e.buttons&1)){finish();return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved){if(Math.abs(dx)<7||Math.abs(dx)<Math.abs(dy))return;drag.moved=true;onStart();element.setPointerCapture(e.pointerId);element.classList.add('is-dragging');}e.preventDefault();setPosition(drag.position-dx/getStep());});
  element.addEventListener('pointerup',finish);element.addEventListener('pointercancel',finish);element.addEventListener('lostpointercapture',finish);window.addEventListener('pointerup',finish);window.addEventListener('blur',finish);
  for(const name of ['click','dblclick'])element.addEventListener(name,e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  element.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)return;const delta=e.deltaX||e.deltaY;if(!delta)return;e.preventDefault();cancelAnimation();onStart();setPosition(getPosition()+delta*(e.deltaMode===1?16:1)/getStep());timer=setTimeout(settle,120);},{passive:false});
  element.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();suppressUntil=0;onStart();setPosition(e.key==='Home'?0:e.key==='End'?Infinity:getPosition()+(e.key==='ArrowRight'?1:-1));});
  return{reset(){finish();cancelAnimation();}};
 }
 root.TimelineInput={attach};
})(globalThis);
