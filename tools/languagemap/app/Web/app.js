'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
FormaUI.mount();
const tr=(key,vars)=>AppLocale.tr(key,vars);
const localDay=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let TODAY=localDay();const DAY=86400000;const dateObj=s=>new Date(s+'T12:00:00Z'),iso=d=>d.toISOString().slice(0,10),pretty=s=>s.replaceAll('-','.');
const dayData=new Map();
function rootFrom(n,list){let a=n,guard=0;while(a?.parent&&guard++<list.length)a=list.find(v=>v.id===a.parent);return a?.id;}
let overrides=JSON.parse(AppStorage.getItem('languagemap-v03-edits')||'{}');
for(const [day,list] of Object.entries(overrides))dayData.set(day,list);
if(!dayData.has(TODAY))dayData.set(TODAY,[]);
let timelineEnd=null;
let firstDate=[...dayData.keys()].sort()[0],currentDay=TODAY,nodes=dayData.get(TODAY),year=Number(TODAY.slice(0,4)),queryMonth=Number(TODAY.slice(5,7)),allYears=false,selected=null,peek=null,focusView=null,view={x:0,y:0,z:1},drawnView={...view},drawn=new Map(),raf=0,animationToken=0,stageScale=1,noteHidden={native:false,foreign:false},selectedText='',mode='select',pendingAnchor=null,activeScene='home',searchIndex=0,searchMatches=[];
const elMap=new Map(),cw=()=>$('#canvas').clientWidth,ch=()=>$('#canvas').clientHeight,mobile=()=>cw()<620;
function persistDay(){overrides[currentDay]=nodes;firstDate=[...dayData.keys()].filter(k=>counts(k)>0||k===TODAY).sort()[0];updateEmptyState();try{AppStorage.setItem('languagemap-v03-edits',JSON.stringify(overrides));}catch{notify(tr('本机存储已满，请保留当前页面'));}}
function notify(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').classList.remove('show'),2400);}
function setTheme(theme){AppStorage.setItem('languagemap-theme',theme==='glass'?'glass':'mono');document.body.dataset.theme=theme==='glass'?'glass':'mono';$$('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===document.body.dataset.theme)));if(!$('#home').hidden)drawCurve();if(!$('#map').hidden)paint();}
$$('[data-theme-choice]').forEach(b=>b.onclick=()=>setTheme(b.dataset.themeChoice));
const counts=key=>(dayData.get(key)||[]).length;
const level=n=>n===0?0:n<=4?1:n<=9?2:n<=14?3:4;
function daysOf(y){const arr=[];for(let t=Date.UTC(y,0,1,12);t<Date.UTC(y+1,0,1,12);t+=DAY)arr.push(iso(new Date(t)));return arr;}
function yearStats(y){const keys=[...dayData.keys()].filter(d=>d.startsWith(y+'-')&&counts(d)>0);return {days:keys.length,words:keys.reduce((s,d)=>s+counts(d),0)};}
function markScene(name){activeScene=name;$$('[data-scene]').forEach(b=>b.classList.toggle('active',b.dataset.scene===(name==='home'||name==='history'||name==='begin'||name==='years'||name==='peek'?'home':'map')));}
function heatCell(key){const b=document.createElement('button'),n=counts(key);b.className='heat-cell l'+level(n)+(key<firstDate?' before':key>TODAY?' future':n?' has-data':'');b.dataset.date=key;b.dataset.design='rect';b.disabled=key<firstDate||key>TODAY;const state=key<firstDate?tr('首次记录之前'):key>TODAY?tr('尚未到来'):tr('{n} 个单词',{n});b.setAttribute('aria-label',pretty(key)+'，'+state);b.title=pretty(key)+' · '+state;b.onclick=e=>openPeek(key,e.currentTarget);b.ondblclick=e=>{e.preventDefault();enterDay(key);};b.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();enterDay(key);}};return b;}
const monthNames=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
function monthDays(y,m){return daysOf(y).filter(k=>Number(k.slice(5,7))===m);}
function renderYear(){
 closePeek();$('#year-heading').textContent=allYears?String(year):AppLocale.month(queryMonth);$('#query-period').textContent=allYears?'':String(year);$('#year-view').hidden=allYears;$('#years-view').hidden=!allYears;
 $('#query-month').setAttribute('aria-pressed',String(!allYears));$('#query-year').setAttribute('aria-pressed',String(allYears));$('#month-select').hidden=allYears;
 $('#prev-year').setAttribute('aria-label',tr(allYears?'上一年':'上一月'));$('#next-year').setAttribute('aria-label',tr(allYears?'下一年':'下一月'));
 const select=$('#year-select');select.replaceChildren();for(let y=Math.min(year,Number(firstDate.slice(0,4))-1);y<=Math.max(year,Number(TODAY.slice(0,4)));y++){const o=document.createElement('option');o.value=y;o.textContent=y;select.append(o);}select.value=year;
 const ms=$('#month-select');ms.replaceChildren();monthNames.forEach((name,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=AppLocale.month(i+1,true);ms.append(o);});ms.value=queryMonth;
 const keys=allYears?daysOf(year):monthDays(year,queryMonth),sum=keys.reduce((v,k)=>v+counts(k),0),active=keys.filter(k=>counts(k)>0).length;$('#year-total').textContent=tr('{words} 个词 · {days} 个记录日',{words:sum.toLocaleString(),days:active});

 if(allYears){renderYears();}else{const host=$('#query-days');host.replaceChildren();keys.forEach(key=>{const b=heatCell(key);b.classList.add('period-cell');b.innerHTML=`<span class="period-number" data-design="text">${key.slice(8)}</span><i class="heat-mark l${level(counts(key))}" data-design="rect"></i>`;host.append(b);});}
 $$('.plot-scroll').forEach(el=>el.scrollLeft=0);requestAnimationFrame(drawCurve);
}
function renderYears(){const host=$('#query-months');host.replaceChildren();const sums=Array.from({length:12},(_,i)=>monthDays(year,i+1).reduce((s,k)=>s+counts(k),0)),max=Math.max(1,...sums);sums.forEach((sum,i)=>{const key=`${year}-${String(i+1).padStart(2,'0')}`,before=key<firstDate.slice(0,7),future=key>TODAY.slice(0,7),b=document.createElement('button');b.className='period-cell month-cell'+(before?' before':'')+(future?' future':'');b.disabled=before||future;b.dataset.month=i+1;b.dataset.total=sum;b.setAttribute('aria-label',year+' '+AppLocale.month(i+1)+' · '+tr('{n} 个单词',{n:sum}));b.innerHTML=`<span class="period-number" data-design="text">${AppLocale.month(i+1,true)}</span><i class="heat-mark l${sum?Math.max(1,Math.ceil(sum/max*4)):0}" data-design="rect"></i><span class="month-total" data-design="text">${future?'—':sum}</span>`;b.onclick=()=>{queryMonth=i+1;allYears=false;renderYear();};host.append(b);});}
function monotonePath(p){if(p.length<2)return '';const d=p.slice(1).map((v,i)=>(v[1]-p[i][1])/(v[0]-p[i][0])),m=p.map((v,i)=>i===0?d[0]:i===p.length-1?d.at(-1):d[i-1]*d[i]<=0?0:2*d[i-1]*d[i]/(d[i-1]+d[i]));let path=`M${p[0][0]} ${p[0][1]}`;for(let i=1;i<p.length;i++){const dx=(p[i][0]-p[i-1][0])/3;path+=` C${p[i-1][0]+dx} ${p[i-1][1]+m[i-1]*dx},${p[i][0]-dx} ${p[i][1]-m[i]*dx},${p[i][0]} ${p[i][1]}`;}return path;}
function drawCurve(){
 const svg=$(allYears?'#monthly-curve':'#daily-curve'),keys=allYears?Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`):monthDays(year,queryMonth),series=keys.map(key=>allYears?daysOf(year).filter(k=>k.startsWith(key)).reduce((sum,k)=>sum+counts(k),0):counts(key));
 const w=svg.clientWidth||960,h=svg.clientHeight||180,base=h-20,max=Math.max(1,...series),step=w/keys.length,points=series.map((v,i)=>[(i+.5)*step,base-v/max*(h-45)]),recorded=points.filter((p,i)=>keys[i]<=(allYears?TODAY.slice(0,7):TODAY)),line=recorded.length>1?monotonePath(recorded):recorded.length?`M${recorded[0][0]} ${recorded[0][1]}`:'',id=allYears?'monthly-fill':'daily-fill';svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 svg.innerHTML=`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="var(--accent)" stop-opacity=".09"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="M0 ${base}H${w}" stroke="var(--line)" fill="none"/>`+points.map(([x,y],i)=>`<path d="M${x} 0V${base}" stroke="var(--line)" stroke-dasharray="2 7" opacity=".5"/><circle cx="${x}" cy="${y}" r="${keys[i]>(allYears?TODAY.slice(0,7):TODAY)?0:2.4}" fill="var(--accent)" opacity=".75"><title>${keys[i]} · ${series[i]} 词</title></circle>`).join('')+`<path d="${line||'M0 0'} L${recorded.at(-1)?.[0]||0} ${base} L${recorded[0]?.[0]||0} ${base}Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>`;
 svg.dataset.series=JSON.stringify(series);svg.dataset.keys=JSON.stringify(keys);svg.dataset.zeroBeforeStart=String(keys.every((k,i)=>k>=(allYears?firstDate.slice(0,7):firstDate)||series[i]===0));
}
new ResizeObserver(()=>{drawCurve();if(!$('#map').hidden)layout(false);}).observe($('#product'));
function movePeriod(delta){if(allYears)year=Math.max(1900,Math.min(2100,year+delta));else{const d=new Date(Date.UTC(year,queryMonth-1+delta,1));year=d.getUTCFullYear();queryMonth=d.getUTCMonth()+1;}renderYear();}
$('#prev-year').onclick=()=>movePeriod(-1);$('#next-year').onclick=()=>movePeriod(1);$('#year-select').onchange=e=>{year=Number(e.target.value);renderYear();};$('#month-select').onchange=e=>{queryMonth=Number(e.target.value);renderYear();};$('#query-month').onclick=()=>{allYears=false;renderYear();};$('#query-year').onclick=()=>{allYears=true;renderYear();};$$('.plot-scroll').forEach(el=>el.addEventListener('scroll',closePeek));
function timelineKeys(){return [...dayData.keys()].filter(k=>counts(k)>0||k===TODAY).sort();}
function timelineCount(){return $('#product').clientWidth<620?3:6;}
function timelineWave(index){return 15*Math.sin(index*Math.PI/3)+5*Math.sin(index*Math.PI/1.5);}
function drawTimeline(start,count,w){
 const svg=$('.timeline-track'),h=220,step=w/count,y=x=>110+timelineWave(start+x/step-.5),pts=Array.from({length:Math.ceil(w/5)+1},(_,i)=>{const x=Math.min(w,i*5);return[x,y(x)];}),path=pts.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.innerHTML=`<path d="M0 110H${w}" stroke="var(--edge)" stroke-width=".5" opacity=".17"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.1" opacity=".45"/><path d="${path}" transform="translate(0 8)" fill="none" stroke="var(--edge)" stroke-width=".6" opacity=".16"/>`;
 for(let i=Math.floor(start*4);i<=(start+count)*4;i++){const x=(i/4-start+.5)*step;if(x<0||x>w)continue;const major=i%4===0,yy=y(x),tick=document.createElementNS('http://www.w3.org/2000/svg','path');tick.setAttribute('d',`M${x} ${yy- (major?8:3)}V${yy+(major?8:3)}`);tick.setAttribute('stroke','var(--edge)');tick.setAttribute('stroke-width','.7');tick.setAttribute('opacity',major?'.45':'.25');svg.append(tick);}
 const arrow=document.createElementNS('http://www.w3.org/2000/svg','path'),end=y(w-3);arrow.setAttribute('d',`M${w-10} ${end-4}L${w-3} ${end}L${w-10} ${end+4}`);arrow.setAttribute('fill','none');arrow.setAttribute('stroke','var(--accent)');arrow.setAttribute('opacity','.6');svg.append(arrow);
}
function renderDates(){
 const keys=timelineKeys(),count=timelineCount(),w=$('.timeline-stage').clientWidth||1000,step=w/count;
 if(timelineEnd===null)timelineEnd=keys.length;timelineEnd=Math.max(Math.min(count,keys.length),Math.min(keys.length,timelineEnd));const start=Math.max(0,timelineEnd-count),host=$('#dates');host.replaceChildren();
 for(let i=Math.max(0,Math.floor(start)-1);i<Math.min(keys.length,Math.ceil(timelineEnd)+1);i++){
  const key=keys[i],b=document.createElement('button'),x=(i-start+.5)*step,y=110+timelineWave(i),isVisible=x>0&&x<w;
  b.className='day'+(key===TODAY?' current':'');b.dataset.date=key;b.dataset.design='rect';b.style.left=x+'px';b.style.top=y+'px';b.tabIndex=isVisible?0:-1;b.setAttribute('aria-hidden',String(!isVisible));b.setAttribute('aria-label',pretty(key)+' · '+tr('单击预览 · 双击进入'));
  b.innerHTML=`<span class="month" data-design="text">${AppLocale.month(Number(key.slice(5,7)),true)}</span><span class="number" data-design="text">${key.slice(8)}</span><span class="day-count" data-design="text">${tr('{n} 词网',{n:dayData.get(key).filter(n=>!n.parent).length})}</span>`;
  b.onclick=e=>openPeek(key,e.currentTarget);b.ondblclick=e=>{e.preventDefault();enterDay(key);};b.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();enterDay(key);}};host.append(b);
 }
 const last=keys[Math.min(keys.length-1,Math.ceil(timelineEnd)-1)]||TODAY;$('#timeline-year').textContent=last.slice(0,4);$('#timeline-month').textContent=AppLocale.month(Number(last.slice(5,7)));$('#timeline-first').textContent=tr('始于 {date}',{date:pretty(firstDate)});$('#timeline-prev').disabled=timelineEnd<=count;$('#timeline-next').disabled=timelineEnd>=keys.length;drawTimeline(start,count,w);
}
function shiftTimeline(delta){timelineInput.reset();closePeek();timelineEnd+=delta;renderDates();}
$('#timeline-prev').onclick=()=>shiftTimeline(-timelineCount());$('#timeline-next').onclick=()=>shiftTimeline(timelineCount());$('#timeline-first').onclick=()=>{timelineInput.reset();closePeek();timelineEnd=timelineCount();renderDates();};$('#timeline-latest').onclick=()=>{timelineInput.reset();closePeek();timelineEnd=null;renderDates();};
const timelineInput=TimelineInput.attach({element:$('.timeline-stage'),getPosition:()=>Math.max(0,(timelineEnd??timelineKeys().length)-timelineCount()),setPosition:p=>{timelineEnd=p+timelineCount();renderDates();},getStep:()=>$('.timeline-stage').clientWidth/timelineCount(),onStart:closePeek});
function openHistory(){ensureToday();timelineInput.reset();cameraInput.reset();closePeek();$('#history-dialog').showModal();renderYear();$('#history-body').scrollTop=0;}
$('#open-history').onclick=openHistory;$('#close-history').onclick=()=>$('#history-dialog').close();$('#history-dialog').addEventListener('close',()=>{closePeek();$('#product').append($('#candidate'));});$('#history-dialog').addEventListener('click',e=>{if(e.target!==$('#history-dialog'))return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();});$('#history-body').addEventListener('scroll',closePeek);window.addEventListener('resize',()=>{clearTimeout(renderDates.timer);renderDates.timer=setTimeout(()=>{if(!$('#home').hidden){closePeek();renderDates();}},180);});
function openPeek(id,target){peek=id;$$('[data-date]').forEach(b=>b.classList.toggle('selected',b.dataset.date===id));const card=$('#candidate'),container=$('#history-dialog').open?$('#history-dialog'):$('#product');container.append(card);card.hidden=false;$('#candidate-date').textContent=pretty(id);const list=dayData.get(id)||[],roots=list.filter(n=>!n.parent);$('#candidate-count').textContent=list.length?tr('{n} 词网',{n:roots.length}):tr('尚无记录');const host=$('#candidate-list');host.replaceChildren();roots.forEach(n=>{const b=document.createElement('button');b.dataset.design='rect';const text=document.createElement('span');text.dataset.design='text';text.textContent=n.word;b.append(text);b.onclick=()=>{enterDay(id);requestAnimationFrame(()=>selectNode(n.id));};host.append(b);});const product=container.getBoundingClientRect(),r=(target||$('#dates .day:last-child')).getBoundingClientRect(),w=card.offsetWidth,h=card.offsetHeight;let x=r.left-product.left+r.width/2-w/2,y=r.bottom-product.top+12;if(y+h>product.height-16)y=r.top-product.top-h-12;card.style.left=Math.max(12,Math.min(product.width-w-12,x))+'px';card.style.top=Math.max(88,y)+'px';markScene('peek');}
function closePeek(){peek=null;$('#candidate').hidden=true;$$('[data-date].selected').forEach(b=>b.classList.remove('selected'));}
$('#close-peek').onclick=closePeek;$('#enter-day').onclick=()=>enterDay(peek||TODAY);$('#home').addEventListener('scroll',closePeek);
function home(){ensureToday();cameraInput.reset();if($('#history-dialog').open)$('#history-dialog').close();saveNotes();selected=null;$('#home').hidden=false;$('#map').hidden=true;$('#back').hidden=true;$('#date-crumb').hidden=true;$('#product').dataset.view='home';closePeek();renderYear();renderDates();markScene('home');}
function enterDay(id){timelineInput.reset();cameraInput.reset();if($('#history-dialog').open)$('#history-dialog').close();saveNotes();closePeek();currentDay=id;if(!dayData.has(id))dayData.set(id,[]);nodes=dayData.get(id);selected=null;focusView=null;noteHidden={native:false,foreign:false};$('#home').hidden=true;$('#map').hidden=false;$('#back').hidden=false;$('#date-crumb').hidden=false;$('#product').dataset.view='map';$('#date-label').textContent=id.slice(5).replace('-','.');$('#weekday').textContent=AppLocale.weekdays(id);drawn.clear();renderNodes();closeInsert();syncNotes();fitMap(false,mobile());markScene('map');updateEmptyState();}
$('#back').onclick=home;$('#brand-home').onclick=home;
function rootOf(n){return rootFrom(n,nodes);}
function visible(n){let a=n,guard=0;while(a.parent&&guard++<nodes.length){a=nodes.find(x=>x.id===a.parent);if(!a)return true;if(a.folded)return false;}return true;}
function descendants(id){const out=[],seen=new Set([id]);const walk=p=>nodes.filter(n=>n.parent===p&&!seen.has(n.id)).forEach(n=>{seen.add(n.id);out.push(n);walk(n.id);});walk(id);return out;}
function renderNodes(){const host=$('#nodes');host.replaceChildren();elMap.clear();nodes.forEach(n=>{const el=document.createElement('div');el.className='word'+(!n.parent?' root':'');el.dataset.id=n.id;el.dataset.design='rect';el.dataset.baseX=n.x;el.dataset.baseY=n.y;el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',tr('查看 {word}',{word:n.word}));el.hidden=!visible(n);const label=document.createElement('span');label.className='word-label';label.dataset.design='text';label.textContent=n.word;if(!n.parent){const dot=document.createElement('span');dot.className='root-mark';dot.dataset.design='rect';el.append(dot);}el.append(label);if(descendants(n.id).length){const f=document.createElement('button');f.className='fold';f.dataset.design='rect';f.setAttribute('aria-label',tr(n.folded?'展开 {word} 的子连接':'隐藏 {word} 的子连接',{word:n.word}));if(n.folded){const t=document.createElement('span');t.dataset.design='text';t.textContent='+'+descendants(n.id).length;f.append(t);}else f.append(FormaUI.icon('minus'));f.onclick=e=>{e.stopPropagation();n.folded=!n.folded;if(selected&&descendants(n.id).some(t=>t.id===selected))closeFocus();renderNodes();layout();persistDay();};el.append(f);}el.onclick=e=>{e.stopPropagation();if(mode==='hand')return;selectNode(n.id);};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(n.id);}};host.append(el);elMap.set(n.id,el);});$('#map-count').textContent=tr('{maps} 词网 · {words} 单词',{maps:nodes.filter(n=>!n.parent).length,words:nodes.length});}
function positions(){const out=new Map(nodes.map(n=>[n.id,{x:n.x,y:n.y}]));if(!selected)return out;const s=nodes.find(n=>n.id===selected),half=mobile()?Math.min(150,cw()/2-18):330,bottom=mobile()?430:290,box={l:s.x-half-20,r:s.x+half+20,t:s.y-62,b:s.y+bottom};nodes.filter(n=>n.id!==selected&&visible(n)).forEach(n=>{const el=elMap.get(n.id),hw=el.offsetWidth/2+24,hh=el.offsetHeight/2+22;if(n.x+hw>box.l&&n.x-hw<box.r&&n.y+hh>box.t&&n.y-hh<box.b){const options=[{x:box.l-hw,y:n.y,d:Math.abs(n.x-box.l+hw)},{x:box.r+hw,y:n.y,d:Math.abs(n.x-box.r-hw)},{x:n.x,y:box.t-hh,d:Math.abs(n.y-box.t+hh)},{x:n.x,y:box.b+hh,d:Math.abs(n.y-box.b-hh)}];options.sort((a,b)=>a.d-b.d);out.set(n.id,options[0]);}});for(let k=0;k<8;k++){const list=nodes.filter(n=>visible(n));for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j];if(a.id===selected||b.id===selected)continue;const pa=out.get(a.id),pb=out.get(b.id),dx=(elMap.get(a.id).offsetWidth+elMap.get(b.id).offsetWidth)/2+24,dy=70;if(Math.abs(pa.x-pb.x)<dx&&Math.abs(pa.y-pb.y)<dy)pb.y+=(pb.y>=pa.y?1:-1)*(dy-Math.abs(pa.y-pb.y));}}return out;}
function layout(animate=true){cancelAnimationFrame(raf);const token=++animationToken,target=positions(),from=new Map();target.forEach((p,id)=>from.set(id,drawn.get(id)||p));const v0={...drawnView},vt={...view},t0=performance.now(),duration=animate&&!matchMedia('(prefers-reduced-motion:reduce)').matches?460:0;const tick=t=>{if(token!==animationToken)return;const p=duration?Math.min(1,(t-t0)/duration):1,k=1-Math.pow(1-p,3);target.forEach((end,id)=>{const start=from.get(id);drawn.set(id,{x:start.x+(end.x-start.x)*k,y:start.y+(end.y-start.y)*k});});drawnView={x:v0.x+(vt.x-v0.x)*k,y:v0.y+(vt.y-v0.y)*k,z:v0.z+(vt.z-v0.z)*k};paint();if(p<1)raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);}
function boundary(p,el,ux,uy){const hw=el.offsetWidth/2,hh=el.offsetHeight/2,t=Math.min(Math.abs(ux)>.001?hw/Math.abs(ux):Infinity,Math.abs(uy)>.001?hh/Math.abs(uy):Infinity);return{x:p.x+ux*t,y:p.y+uy*t};}
function edgePath(a,b,parentEl,childEl,bend){const dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy)),ux=dx/len,uy=dy/len,start=boundary(a,parentEl,ux,uy),end=boundary(b,childEl,-ux,-uy),nx=-uy,ny=ux,curve=Math.min(48,len*.16)*bend;return`M${start.x} ${start.y} C${start.x+dx*.30+nx*curve} ${start.y+dy*.30+ny*curve},${end.x-dx*.28+nx*curve} ${end.y-dy*.28+ny*curve},${end.x} ${end.y}`;}
function paint(){const v=drawnView;$('#world').style.transform=`translate(${v.x}px,${v.y}px) scale(${v.z})`;$('#zoom-value').textContent=Math.round(v.z*100)+'%';const active=nodes.find(n=>n.id===selected);nodes.forEach(n=>{const p=drawn.get(n.id),el=elMap.get(n.id);if(!p||!el)return;el.style.left=p.x+'px';el.style.top=p.y+'px';el.style.opacity=selected&&rootOf(n)!==rootOf(active)?'.28':'1';el.classList.toggle('selected',selected===n.id);});const svg=$('#edges');svg.replaceChildren();nodes.filter(n=>n.parent&&visible(n)).forEach((n,i)=>{const a=drawn.get(n.parent),b=drawn.get(n.id);if(!a||!b)return;const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.dataset.child=n.id;path.setAttribute('d',edgePath(a,b,elMap.get(n.parent),elMap.get(n.id),i%2?1:-1));if(selected&&rootOf(n)!==rootOf(active))path.setAttribute('opacity','.25');svg.append(path);});if(selected){const p=drawn.get(selected),isSmall=mobile(),width=isSmall?Math.min(290,cw()-48):270;['native','foreign'].forEach((key,i)=>{const card=$('#'+key+'-note');card.style.width=width+'px';const x=p.x+(isSmall?-width/2:i?28:-298),y=p.y+(isSmall?74+(i?$('#native-note').offsetHeight+16:0):84);card.style.left=x+'px';card.style.top=y+'px';if(!card.hidden){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class','note-edge');path.setAttribute('d',`M${p.x} ${p.y+25} C${p.x} ${p.y+58},${x+width/2} ${y-30},${x+width/2} ${y}`);svg.append(path);}});}if(pendingAnchor){$('#anchor-preview').style.left=pendingAnchor.x+'px';$('#anchor-preview').style.top=pendingAnchor.y+'px';}}
function saveNotes(){
 if(!selected)return;
 const n=nodes.find(x=>x.id===selected);if(!n)return;
 const zh=$('#native-editor').innerText,en=$('#foreign-editor').innerText;
 if(zh===n.zh&&en===n.en)return;
 const englishChanged=en!==n.en;n.zh=zh;n.en=en;
 if(englishChanged&&NoteLinks.reconcileBranches(nodes,n)){renderNodes();layout(false);}
 persistDay();
}
function clearTextSelection(){selectedText='';$('#link-word').hidden=true;$('#selection-hint').hidden=false;}
function syncNotes(){const n=nodes.find(x=>x.id===selected);$('#native-note').hidden=!n||noteHidden.native;$('#foreign-note').hidden=!n||noteHidden.foreign;$('#close-focus').hidden=!n;clearTextSelection();if(n){$('#native-editor').textContent=n.zh;$('#foreign-editor').textContent=n.en;}$('#map-hint').textContent=tr(n?'从一个词，走向另一个词':'点击单词展开释义');}
function focusCamera(){const n=nodes.find(x=>x.id===selected);if(!n)return;view={x:cw()/2-n.x,y:(mobile()?125:Math.min(235,ch()*.32))-n.y,z:1};}
function selectNode(id){saveNotes();if(selected===id){closeFocus();return;}if(!selected)focusView={...view};selected=id;noteHidden={native:false,foreign:false};focusCamera();closeInsert();syncNotes();layout();markScene('focus');}
function closeFocus(){saveNotes();selected=null;noteHidden={native:false,foreign:false};if(focusView)view={...focusView};focusView=null;syncNotes();layout();markScene('map');}
$('#close-focus').onclick=closeFocus;$$('[data-note-close]').forEach(b=>b.onclick=()=>{saveNotes();noteHidden[b.dataset.noteClose]=true;if(noteHidden.native&&noteHidden.foreign){closeFocus();return;}syncNotes();paint();});
function freeAnchor(x=720,y=440,min=210){for(let ring=0;ring<35;ring++){const steps=ring?Math.max(8,ring*8):1;for(let i=0;i<steps;i++){const a=i/steps*Math.PI*2,p={x:x+Math.cos(a)*ring*90,y:y+Math.sin(a)*ring*90};if(nodes.every(n=>Math.hypot(p.x-n.x,p.y-n.y)>min))return p;}}return{x:Math.max(0,...nodes.map(n=>n.x))+350,y};}
function fitMap(animate=true,closer=false,extra=null){const points=extra?[...nodes,extra]:nodes;if(!points.length){view={x:cw()/2-720,y:ch()/2-400,z:1};layout(animate);return;}const l=Math.min(...points.map(n=>n.x))-130,r=Math.max(...points.map(n=>n.x))+130,t=Math.min(...points.map(n=>n.y))-70,b=Math.max(...points.map(n=>n.y))+100;let z=Math.min(1,(cw()-70)/(r-l),(ch()-170)/(b-t));if(closer){z=.62;const root=nodes.find(n=>!n.parent)||nodes[0];view={x:cw()/2-root.x*z,y:ch()*.42-root.y*z,z};}else view={x:cw()/2-(l+r)/2*z,y:ch()*.52-(t+b)/2*z,z};layout(animate);}
function openInsert(){if(selected)closeFocus();$('#insert-dock').classList.add('open');$('#insert-toggle').hidden=true;$('#insert-form').hidden=false;$('#insert-toggle').setAttribute('aria-expanded','true');pendingAnchor=freeAnchor((cw()/2-view.x)/view.z,(ch()/2-view.y)/view.z);$('#anchor-preview').hidden=false;fitMap(true,false,pendingAnchor);$('#new-word').focus();markScene('insert');}
function closeInsert(){$('#insert-dock').classList.remove('open');$('#insert-toggle').hidden=false;$('#insert-form').hidden=true;$('#insert-toggle').setAttribute('aria-expanded','false');$('#anchor-preview').hidden=true;pendingAnchor=null;}
$('#insert-toggle').onclick=openInsert;$('#close-insert').onclick=closeInsert;
$('#insert-form').onsubmit=e=>{e.preventDefault();const word=$('#new-word').value.trim();if(!word)return;const p=pendingAnchor||freeAnchor();nodes.push({id:'word-'+crypto.randomUUID(),word,x:p.x,y:p.y,parent:null,zh:'',en:'',folded:false});$('#new-word').value='';renderNodes();closeInsert();layout();persistDay();notify(tr('已落在新锚点，原有词网保持原位'));markScene('map');};
function updateTextSelection(){
 const s=getSelection(),editor=$('#foreign-editor');
 if(!selected||$('#foreign-note').hidden||!s?.rangeCount||s.isCollapsed||!editor.contains(s.anchorNode)||!editor.contains(s.focusNode)){clearTextSelection();return;}
 const range=s.getRangeAt(0),before=range.cloneRange(),after=range.cloneRange();
 before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);
 after.selectNodeContents(editor);after.setStart(range.endContainer,range.endOffset);
 selectedText=NoteLinks.selectionWord(s.toString(),before.toString(),after.toString());
 $('#link-word').hidden=!selectedText;$('#selection-hint').hidden=!!selectedText;
 if(selectedText)$('#link-label').textContent=tr('延伸「{word}」',{word:selectedText});
}
// selectionchange also covers touch handles, keyboard selection and newly typed text.
 document.addEventListener('selectionchange',updateTextSelection);
 $('#foreign-editor').addEventListener('pointerup',updateTextSelection);
 $('#foreign-editor').addEventListener('keyup',updateTextSelection);
 for(const key of ['native','foreign']){
  const editor=$('#'+key+'-editor');
  editor.addEventListener('input',e=>{if(e.isComposing)return;saveNotes();updateTextSelection();layout(false);});
  editor.addEventListener('compositionend',()=>{saveNotes();updateTextSelection();layout(false);});
 }
 $('#link-word').onpointerdown=e=>e.preventDefault();
 $('#link-word').onclick=()=>{
  updateTextSelection();if(!selectedText||!selected)return;
  const word=selectedText;saveNotes();
  const parent=nodes.find(n=>n.id===selected);
  if(!parent||!NoteLinks.containsWord(parent.en,word)){clearTextSelection();return;}
  const existing=nodes.find(n=>n.parent===parent.id&&NoteLinks.normalize(n.word)===NoteLinks.normalize(word));
  if(existing){parent.folded=false;renderNodes();selectNode(existing.id);persistDay();return;}
  const angle=(descendants(parent.id).length*2.39996+parent.x*.01)%(Math.PI*2),p=freeAnchor(parent.x+Math.cos(angle)*240,parent.y+Math.sin(angle)*240,145);
  nodes.push({id:'child-'+crypto.randomUUID(),word,x:p.x,y:p.y,parent:parent.id,zh:'',en:'',folded:false});
  parent.folded=false;renderNodes();getSelection()?.removeAllRanges();clearTextSelection();layout();persistDay();notify(tr('已连接 {word}',{word}));
 };
function zoom(f){const old=view.z,next=Math.max(.2,Math.min(2.5,old*f));view={x:cw()/2-(cw()/2-view.x)*next/old,y:ch()/2-(ch()/2-view.y)*next/old,z:next};layout(false);}
$('#zoom-in').onclick=()=>zoom(1.15);$('#zoom-out').onclick=()=>zoom(1/1.15);$('#fit').onclick=()=>{if(selected)closeFocus();fitMap();};
$('#hand-tool').onclick=()=>{mode='hand';$('#hand-tool').classList.add('active');$('#select-tool').classList.remove('active');};$('#select-tool').onclick=()=>{mode='select';$('#select-tool').classList.add('active');$('#hand-tool').classList.remove('active');};
function freezeCamera(){cancelAnimationFrame(raf);animationToken++;view={...drawnView};}
const cameraInput=CanvasInput.attach({canvas:$('#canvas'),getView:()=>view,onStart:freezeCamera,applyView:v=>{view={...v};drawnView={...v};paint();},canStart:e=>!e.target.closest('.note,button,input,[contenteditable="true"]')&&(!e.target.closest('.word')||mode==='hand'||e.button===1),onBackgroundClick:e=>{if(selected&&!e.target.closest('.word'))closeFocus();}});
$('#toggle-review').onclick=()=>{cameraInput.reset();const collapsed=!document.body.classList.contains('review-collapsed');document.body.classList.toggle('review-collapsed',collapsed);$('#appearance-controls').hidden=collapsed;$('#toggle-review').setAttribute('aria-expanded',String(!collapsed));$('#toggle-review').setAttribute('aria-label',tr(collapsed?'展开外观栏':'收起外观栏'));$('#toggle-review').replaceChildren(FormaUI.icon(collapsed?'down':'up'));};
function openSearch(){cameraInput.reset();if($('#history-dialog').open)$('#history-dialog').close();saveNotes();$('#search-dialog').showModal();$('#word-search').value='';renderSearch();$('#word-search').focus();}
function renderSearch(){const q=$('#word-search').value.trim().toLocaleLowerCase();searchMatches=[];for(const day of [...dayData.keys()].sort().reverse()){for(const n of dayData.get(day)){if(!q||q.split(/\s+/).every(part=>(n.word+' '+day+' '+pretty(day)).toLocaleLowerCase().includes(part)))searchMatches.push({day,node:n});}}if(q)searchMatches.sort((a,b)=>(Number(b.node.word.toLowerCase()===q)-Number(a.node.word.toLowerCase()===q))||b.day.localeCompare(a.day));const total=searchMatches.length;if(!q)searchMatches=searchMatches.slice(0,30);searchIndex=0;$('#search-count').textContent=q?tr('{n} 个结果',{n:total}):tr('最近记录');const host=$('#search-results');host.replaceChildren();searchMatches.forEach(({day,node:n},i)=>{const b=document.createElement('button');b.className='search-result'+(!i?' active':'');b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===0));b.dataset.design='rect';b.dataset.searchDay=day;b.dataset.searchId=n.id;const left=document.createElement('span'),word=document.createElement('b'),sub=document.createElement('small'),date=document.createElement('span');word.dataset.design=sub.dataset.design=date.dataset.design='text';word.textContent=n.word;const parent=dayData.get(day).find(t=>t.id===n.parent);sub.textContent=parent?tr('来自 {word}',{word:parent.word}):tr('独立词网');date.textContent=pretty(day)+' ↗';left.append(word,sub);b.append(left,date);b.onclick=()=>locateResult(i);host.append(b);});if(!total){const empty=document.createElement('div');empty.className='empty-search';empty.textContent=tr('还没有这个词');host.append(empty);}}
function locateResult(i){const result=searchMatches[i];if(!result)return;$('#search-dialog').close();enterDay(result.day);let a=result.node,guard=0;while(a.parent&&guard++<nodes.length){a=nodes.find(n=>n.id===a.parent);if(!a)break;a.folded=false;}renderNodes();requestAnimationFrame(()=>{selectNode(result.node.id);elMap.get(result.node.id)?.classList.add('found');setTimeout(()=>elMap.get(result.node.id)?.classList.remove('found'),1500);});}
$('#open-search').onclick=openSearch;$('#close-search').onclick=()=>$('#search-dialog').close();$('#word-search').oninput=renderSearch;$('#word-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();locateResult(searchIndex);}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();searchIndex=Math.max(0,Math.min(searchMatches.length-1,searchIndex+(e.key==='ArrowDown'?1:-1)));$$('.search-result').forEach((b,i)=>{b.classList.toggle('active',i===searchIndex);b.setAttribute('aria-selected',String(i===searchIndex));});$$('.search-result')[searchIndex]?.scrollIntoView({block:'nearest'});}};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!$('#search-dialog').open)openSearch();return;}if(e.key==='Escape'&&!$('#search-dialog').open){if(!$('#insert-form').hidden)closeInsert();else if(selected)closeFocus();else closePeek();}});document.addEventListener('click',e=>{if(peek&&!e.target.closest('.candidate')&&!e.target.closest('[data-date]')&&!e.target.closest('[data-scene]'))closePeek();});
setTheme(AppStorage.getItem('languagemap-theme')||'mono');renderDates();renderYear();

function setInterfaceLanguage(language){
 timelineInput.reset();saveNotes();AppLocale.setLanguage(language);AppLocale.apply();$('#ui-language').value=AppLocale.language;
 $('#toggle-review').setAttribute('aria-label',tr(document.body.classList.contains('review-collapsed')?'展开外观栏':'收起外观栏'));
 renderDates();renderYear();if(!$('#map').hidden){$('#weekday').textContent=AppLocale.weekdays(currentDay);renderNodes();syncNotes();layout(false);}if($('#search-dialog').open)renderSearch();
}
$('#ui-language').onchange=e=>setInterfaceLanguage(e.target.value);setInterfaceLanguage(AppLocale.language);

function updateEmptyState(){
 $('#empty-map').hidden=nodes.length>0;
 $('#empty-home').hidden=[...dayData.values()].some(list=>list.length>0);
}
function ensureToday(){
 const next=localDay();if(next===TODAY)return;
 saveNotes();TODAY=next;if(!dayData.has(TODAY))dayData.set(TODAY,[]);
 firstDate=[...dayData.keys()].filter(k=>counts(k)>0||k===TODAY).sort()[0];
 year=Number(TODAY.slice(0,4));queryMonth=Number(TODAY.slice(5,7));timelineEnd=null;
 renderDates();renderYear();updateEmptyState();
}
window.addEventListener('focus',ensureToday);setInterval(ensureToday,30000);
$('#start-today').onclick=()=>{ensureToday();enterDay(TODAY);openInsert();};
$('#empty-add').onclick=openInsert;
$('#delete-word').onclick=()=>{
 const n=nodes.find(n=>n.id===selected);if(!n)return;
 if(!confirm(tr('删除「{word}」及其子连接？',{word:n.word})))return;
 const ids=new Set([n.id,...descendants(n.id).map(x=>x.id)]);
 closeFocus();for(let i=nodes.length-1;i>=0;i--)if(ids.has(nodes[i].id))nodes.splice(i,1);
 renderNodes();layout(false);persistDay();
};
for(const editor of $$('.note [contenteditable]'))editor.addEventListener('paste',e=>{
 e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));
});
window.addEventListener('pagehide',saveNotes);
updateEmptyState();
