(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const productName = 'DocsBridge: Feedback Made Easier';
  const projectURL = 'https://github.com/storyon403-afk/RD';
  const offline = location.protocol === 'file:';
  const reviewerMode = /^\/review\/?$/.test(location.pathname) || new URLSearchParams(location.search).has('review');
  const prefix = `pangzhu-v2:${reviewerMode?'/':location.pathname}:`;
  let storageAvailable = true;
  function load(key, fallback) { try { return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback; } catch { return fallback; } }
  function store(key, value) { try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { storageAvailable = false; } }
  const reviewerId=load('reviewer-id',uid());store('reviewer-id',reviewerId);
  const apiPath=path=>reviewerMode&&!offline?'/review'+path:path;
  let state = null, draft = load('article-draft', null), staged = load('staged', {notes:[], requestKey:uid()});
  const savedWorkspace = load('document-workspace', null);
  let localDocuments = savedWorkspace?.documents || [], activeDocumentId = savedWorkspace?.activeId || null;
  if (savedWorkspace) draft = savedWorkspace.draft;
  if (!staged || !Array.isArray(staged.notes)) staged = {notes:[], requestKey:uid()};
  let mode = 'read', pinnedVersion = null, selectedBlock = 'title', rangeSelection = null;
  let composing = null, viewingNotes = null, refreshRunning = null, refreshAgain = false;
  let renderedSignature = '', toastTimer, saveTimer, eventSource, syncTimer, syncStopped = false, busy = false;
  const watermarkPositions = {'top-left':'左上','top-center':'上中','top-right':'右上','bottom-left':'左下','bottom-center':'下中','bottom-right':'右下'};
  let pdfOptions = load('pdf-options', {watermark:true, text:productName});
  if (!pdfOptions || typeof pdfOptions !== 'object') pdfOptions = {};
  pdfOptions = {position:Object.hasOwn(watermarkPositions,pdfOptions.position) ? pdfOptions.position : 'top-left', watermark:pdfOptions.watermark !== false, text:typeof pdfOptions.text === 'string' ? pdfOptions.text.slice(0,120) : productName};
  let appearance = load('appearance', {paper:'#fdfcf9', accent:'#566851', width:660});
  let pageIndex=0, paginationWidth=0, paginationFrame;
  let notePositionFrame, noteManualPosition = false, noteDocked = false, noteDragging = false;
  const paged=()=>mode==='read'&&appearance.layout==='a4';
  let legacy = null;
  try { legacy = JSON.parse(localStorage.getItem('pangzhu-editable-design:/')); } catch {}
  const isAuthor = () => !!state?.isOwner && !reviewerMode;
  const latest = () => state.versions[0];
  const currentDocument = () => state.versions.find(v => v.version === pinnedVersion) || latest();
  const notes = () => state.commits.flatMap(c => c.notes.map(n => ({...n, author:c.author, reviewerId:c.reviewerId, commitId:c.id})));
  const date = value => new Date(value).toLocaleDateString('zh-CN', {month:'numeric', day:'numeric'});

  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500);
  }
  function connection(text, disconnected = false) {
    document.body.dataset.connection = disconnected ? 'disconnected' : (offline ? 'offline' : 'connected');
  }
  async function request(path, data) {
    if (offline) return offlineRequest(path, data);
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),15000);
    try {
      const options = data === undefined ? {cache:'no-store'} : {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data),
      };
      const response = await fetch(apiPath(path), {...options, signal:controller.signal});
      let result;
      try { result = await response.json(); } catch { throw new Error('服务暂时不可用，内容已保留。'); }
      if (!response.ok) { const error = new Error(result.error || '保存失败'); error.status = response.status; throw error; }
      return result;
    } finally { clearTimeout(timeout); }
  }
  function pollingOnly() {
    return state?.syncMode==='poll' || location.hostname.endsWith('.trycloudflare.com');
  }
  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    if (offline || syncStopped) return;
    syncTimer = setTimeout(async()=>{
      try {
        if (!document.hidden) { await refresh(); connection('已同步'); }
      } catch { connection('重连中',true); }
      if (pollingOnly()) { eventSource?.close(); eventSource=null; }
      scheduleSync(pollingOnly() || !eventSource || eventSource.readyState!==EventSource.OPEN ? 3000 : 15000);
    },delay);
  }
  function startSync() {
    if (offline) return;
    syncStopped=false;
    if (!pollingOnly() && typeof EventSource!=='undefined') {
      eventSource=new EventSource(apiPath('/api/events'));
      eventSource.onopen=()=>connection('已同步');
      eventSource.onmessage=()=>refresh().then(()=>connection('已同步')).catch(()=>connection('未连接',true));
      eventSource.onerror=()=>{connection('重连中',true);scheduleSync(0);};
    }
    scheduleSync(pollingOnly()?3000:15000);
  }

  function offlineRequest(path, data) {
    if (path === '/api/state') return clone(state || load('snapshot', window.__SNAPSHOT__));
    if (path === '/api/publish') {
      if (data.baseVersion !== latest().version) throw new Error('已有新版本，请先查看最新版本。');
      const doc = {...clone(data), version:latest().version + 1, createdAt:new Date().toISOString()};
      state.versions.unshift(doc); store('snapshot', state); return {version:doc.version};
    }
    if (path === '/api/commits') {
      const prior = state.commits.find(c => c.requestKey === data.requestKey);
      if (prior) return {id:prior.id};
      const commit = {id:uid().replace(/-/g,'').slice(0,12), requestKey:data.requestKey,
        parentId:state.commits[0]?.id || null, basedOn:data.basedOn, author:data.author, reviewerId:data.reviewerId,
        message:data.message, createdAt:new Date().toISOString(),
        notes:data.notes.map(n => ({...n, id:uid(), resolved:false}))};
      state.commits.unshift(commit); store('snapshot', state); return {id:commit.id};
    }
    if (path === '/api/resolve') {
      for (const commit of state.commits) { const note = commit.notes.find(n => n.id === data.id); if (note) note.resolved = data.resolved; }
      store('snapshot', state); return {ok:true};
    }
  }
  async function refresh() {
    if (refreshRunning) { refreshAgain = true; return refreshRunning; }
    refreshRunning = (async () => {
      do {
        refreshAgain = false;
        state = await request('/api/state');
        renderShared();
        if (mode === 'read') renderArticle();
        if (viewingNotes && !$('noteWindow').hidden) renderNoteViewer();
      } while (refreshAgain);
    })();
    try { await refreshRunning; } finally { refreshRunning = null; }
  }
  function renderShared() {
    $('editMode').hidden = !isAuthor() || mode==='edit';
    $('documentToggle').hidden = !isAuthor();
    if(!isAuthor()){$('documentPanel').hidden=true;$('versionList').replaceChildren();}
    $('readMode').hidden = mode!=='edit';
    $('commitCount').textContent = notes().length;
    $('commitCount').classList.toggle('has-notes', notes().length > 0);
    $('documentPanel').querySelector('.panel-head h2').textContent = '文稿';
    $('legacyButton').hidden = !legacy?.texts || !isAuthor();
    renderLocalDocuments();
    $('versionList').replaceChildren(...(isAuthor()?state.versions:[]).map(doc => {
      const button = document.createElement('button');
      button.className = 'version-item' + (currentDocument().version === doc.version ? ' active' : '');
      button.innerHTML = `<strong>${escape(doc.title)}</strong><small><span>v${doc.version}</span><span>${date(doc.createdAt)}</span></small>`;
      button.onclick = () => { if (mode === 'edit') setMode('read'); pinnedVersion = doc.version === latest().version ? null : doc.version; renderArticle(); renderShared(); closePanel('documentPanel'); };
      return button;
    }));
    renderHistory(); renderStaging(); updateVersionNotice();
  }
  function updateVersionNotice() {
    const staleDraft = mode === 'edit' && draft && draft.baseVersion !== latest().version;
    const old = mode === 'read' && currentDocument().version !== latest().version;
    $('versionNotice').hidden = !(staleDraft || old);
    $('versionNoticeText').textContent = staleDraft ? `草稿基于 v${draft.baseVersion} · 当前 v${latest().version}` : `正在阅读 v${currentDocument().version}`;
    $('publishButton').disabled = busy || staleDraft;
    $('publishReplacement').hidden = !staleDraft || !isAuthor();
    $('publishReplacement').disabled = busy;
  }
  function renderArticle(force = false) {
    const doc = mode === 'edit' ? draft : currentDocument();
    const signature = mode + JSON.stringify(doc);
    document.body.classList.toggle('a4-reading',paged());
    document.body.classList.toggle('horizontal-reading',paged()&&appearance.direction==='horizontal');
    if (force || signature !== renderedSignature) {
      const article = $('article'); article.replaceChildren();
      const titleRow = document.createElement('div'); titleRow.className = 'block-row'; titleRow.dataset.row = 'title';
      const title = document.createElement('h1'); title.className = 'article-title'; title.dataset.block = 'title';
      title.style.fontSize = doc.titleSize + 'px'; title.style.setProperty('--source-size',doc.titleSize+'px');title.textContent = doc.title;
      titleRow.append(title); article.append(titleRow);
      for (const block of doc.blocks) article.append(makeBlock(block));
      if (mode === 'edit') all('[data-block]', article).forEach(bindEditor);
      if(paged())paginateArticle();
      renderedSignature = signature;
    }
    updatePageControls();
    if (mode === 'read') renderDots();
    $('versionLabel').textContent = mode === 'edit' ? `v${draft.baseVersion} · 草稿` : `v${doc.version}`;
    $('articleStatus').textContent = mode === 'edit' ? '' : (offline ? '本地副本' : '');
    document.title = productName;
  }
  function makeBlock(block) {
    const row = document.createElement('div'); row.className = 'block-row'; row.dataset.row = block.id;
    const element = document.createElement(block.type); element.dataset.block = block.id;
    element.className = 'block' + (block.type === 'h2' ? ' heading' : '');
    element.dataset.font = block.font; element.style.fontSize = block.size + 'px';
    element.style.setProperty('--source-size',block.size+'px');
    element.style.setProperty('--block-size', block.size + 'px'); element.textContent = block.text;
    row.append(element); return row;
  }
  function paginateArticle(){
    const article=$('article'),originals=all(':scope > .block-row',article);
    article.replaceChildren();
    paginationWidth=article.clientWidth;
    article.style.setProperty('--page-height',paginationWidth*297/210+'px');
    article.style.setProperty('--page-padding',paginationWidth*.09+'px');
    article.style.setProperty('--page-side-padding',paginationWidth*(1-.82*appearance.widthPercent/100)/2+'px');
    let page,content;
    const newPage=()=>{
      page=document.createElement('section');page.className='paper-page';
      content=document.createElement('div');content.className='paper-content';page.append(content);article.append(page);
    };
    newPage();
    for(const original of originals){
      const model=original.querySelector('[data-block]'),text=model.textContent;
      let offset=0;
      do {
        const row=original.cloneNode(true),el=row.querySelector('[data-block]');
        el.dataset.start=offset;el.textContent=text.slice(offset);
        if(offset){row.classList.add('continued');}
        const wasEmpty=!content.children.length;
        content.append(row);
        const limit=content.getBoundingClientRect().bottom;
        const fits=()=>el.getBoundingClientRect().bottom<=limit+.5;
        // Keep a section heading with at least two lines of the next paragraph.
        const headingRoom=model.tagName==='H2'&&el.getBoundingClientRect().bottom+72>limit;
        if(!wasEmpty&&headingRoom){row.remove();newPage();continue;}
        if(fits()){offset=text.length;break;}
        const remaining=text.slice(offset);
        const boundaries=[0];
        if(globalThis.Intl?.Segmenter){
          for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(remaining))boundaries.push(part.index+part.segment.length);
        }else{let end=0;for(const char of remaining){end+=char.length;boundaries.push(end);}}
        let low=0,high=boundaries.length-1;
        while(low<high){
          const middle=Math.ceil((low+high)/2);el.textContent=remaining.slice(0,boundaries[middle]);
          if(fits())low=middle;else high=middle-1;
        }
        if(!low&&!wasEmpty){row.remove();newPage();continue;}
        let cut=Math.max(1,low);
        while(cut>1&&(/[，。！？；：、）》」』】…,.!?;:]/.test(remaining[boundaries[cut]]||'')||/[（《「『【(]/.test(remaining[boundaries[cut]-1]||'')))cut--;
        let take=boundaries[cut]||remaining.length;
        if(/[a-z]/i.test(remaining[take-1]||'')&&/[a-z]/i.test(remaining[take]||'')){
          const word=remaining.slice(0,take).match(/[a-z]+$/i);
          if(word&&word.index>0&&word[0].length<30)take=word.index;
        }
        el.textContent=remaining.slice(0,take);offset+=take;
        if(offset<text.length)newPage();
      }while(offset<text.length);
    }
    const pages=all('.paper-page',article);
    pages.forEach((el,i)=>{
      el.dataset.page=i;el.setAttribute('aria-label',`第 ${i+1} 页`);
      const number=document.createElement('span');number.className='paper-number';number.textContent=String(i+1);number.setAttribute('aria-hidden','true');el.append(number);
    });
    pageIndex=Math.min(pageIndex,pages.length-1);
    updatePageControls();
  }
  function updatePageControls(){
    const pages=all('.paper-page',$('article')),horizontal=paged()&&appearance.direction==='horizontal';
    pages.forEach((page,index)=>page.hidden=horizontal&&index!==pageIndex);
    $('pageControls').hidden=!horizontal;
    $('pageCounter').textContent=`${pageIndex+1} / ${pages.length||1}`;
    $('previousPage').disabled=pageIndex<=0;$('nextPage').disabled=pageIndex>=pages.length-1;
  }
  function turnPage(delta){
    const count=all('.paper-page',$('article')).length;
    pageIndex=Math.max(0,Math.min(count-1,pageIndex+delta));
    window.getSelection()?.removeAllRanges();$('selectionButton').hidden=true;
    updatePageControls();renderDots();
    $('article').scrollIntoView({block:'start',behavior:'instant'});
  }
  function revealNote(note){
    if(!paged()||!note)return;
    const range=anchorRanges(note).at(-1),page=range?.endContainer.parentElement.closest('.paper-page');
    if(!page)return;
    if(appearance.direction==='horizontal'){pageIndex=Number(page.dataset.page);updatePageControls();}
    page.scrollIntoView({block:'nearest',behavior:'instant'});
  }
  function schedulePagination(){
    cancelAnimationFrame(paginationFrame);
    paginationFrame=requestAnimationFrame(()=>{
      if(!state||mode!=='read')return;
      if(paged()&&Math.abs($('article').clientWidth-paginationWidth)>.5)renderArticle(true);
      else renderDots();
    });
  }
  function renderDots() {
    all('.annotation-dot', $('article')).forEach(el => el.remove());
    if (mode !== 'read') return;
    const version = currentDocument().version;
    const combined = [...notes(), ...staged.notes.map(n => ({...n, local:true, reviewerId}))].filter(n => n.version === version);
    for (const row of all('.block-row', $('article'))) {
      const group = combined.filter(n => n.blockId === row.dataset.row);
      const occupied=[];
      for(const note of group){
        const range=anchorRanges(note).at(-1);if(!range||range.endContainer.parentElement.closest('.block-row')!==row)continue;
        const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
        const last=rects.at(-1);if(!last)continue;
        const box=row.getBoundingClientRect();
        const base=Math.min(last.right-box.left+5,box.width+5);
        let x=base,y=last.top-box.top-3;
        for(let attempt=0;occupied.some(p=>Math.abs(p.x-x)<18&&Math.abs(p.y-y)<17)&&attempt<200;attempt++){
          x+=18;if(x>box.width+8){x=base;y-=18;}
        }
        occupied.push({x,y});
        const dot = document.createElement('button'); dot.className = 'annotation-dot';
        dot.dataset.noteId=note.id;dot.style.left=(x-9)+'px';dot.style.top=(y-9)+'px';
        dot.style.setProperty('--note-color',toneFor(note));
        dot.classList.toggle('draft',!!note.local);dot.classList.toggle('resolved',!!note.resolved);
        const expanded = !$('noteWindow').hidden && viewingNotes?.noteId===note.id;
        dot.classList.toggle('open',expanded);dot.setAttribute('aria-expanded',String(expanded));
        dot.setAttribute('aria-label',`展开建议：${note.author||'我'} · ${note.body.slice(0,24)}`);
        dot.onclick=()=>openNotes(version,row.dataset.row,note.id);
        row.append(dot);
      }
    }
    paintActiveAnchor(); scheduleNotePosition();
  }
  function anchorRanges(note){
    if(note.version!==currentDocument().version)return [];
    const doc=currentDocument(),source=note.blockId==='title'?doc.title:doc.blocks.find(b=>b.id===note.blockId)?.text;
    if(source?.slice(note.start,note.end)!==note.quote)return [];
    return all('[data-block]',$('article')).filter(el=>el.dataset.block===note.blockId).flatMap(el=>{
      const offset=Number(el.dataset.start||0),start=Math.max(0,note.start-offset),end=Math.min(el.textContent.length,note.end-offset);
      if(start>=end||!el.firstChild)return [];
      const range=document.createRange();range.setStart(el.firstChild,start);range.setEnd(el.firstChild,end);return [range];
    });
  }
  function toneFor(note){
    const palette=['#b68a4f','#7c9768','#9682b0','#6f97a6','#bb8275','#989c5b','#8a98b5','#b88b9d'];
    const key=n=>n.reviewerId||n.author||reviewerId;
    const people=[...new Set([...state.commits].reverse().map(key))];
    if(!people.includes(reviewerId))people.push(reviewerId);
    const index=Math.max(0,people.indexOf(key(note)));
    return palette[index%palette.length];
  }
  function paintActiveAnchor(){
    let layer=$('anchorHighlights');
    if(!layer){layer=document.createElement('div');layer.id='anchorHighlights';layer.className='anchor-highlights';layer.setAttribute('aria-hidden','true');$('article').prepend(layer);}
    layer.replaceChildren();
    if(mode!=='read'||$('noteWindow').hidden)return;
    const note=composing?{...composing,reviewerId}:[...notes(),...staged.notes.map(n=>({...n,reviewerId}))].find(n=>n.id===viewingNotes?.noteId);
    if(!note)return;
    const ranges=anchorRanges(note);if(!ranges.length)return;
    const articleBox=$('article').getBoundingClientRect(),color=toneFor(note);
    $('noteWindow').style.setProperty('--note-color',color);
    for(const [index,rect] of ranges.flatMap(range=>[...range.getClientRects()]).filter(r=>r.width>0&&r.height>0).entries()){
      const stroke=document.createElement('span');stroke.className='brush-stroke';
      stroke.style.left=(rect.left-articleBox.left-2)+'px';stroke.style.top=(rect.top-articleBox.top+rect.height*.12)+'px';
      stroke.style.width=(rect.width+4)+'px';stroke.style.height=(rect.height*.87)+'px';
      stroke.style.setProperty('--note-color',color);stroke.style.setProperty('--tilt',(index%2?'.25deg':'-.3deg'));layer.append(stroke);
    }
  }
  function fitSuggestion(text){
    const panel=$('noteWindow');
    const canvas=fitSuggestion.canvas ||= document.createElement('canvas');const ctx=canvas.getContext('2d');
    ctx.font='14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    const width=Math.max(250,Math.min(460,Math.max(...String(text||'写下建议…').split('\n').map(line=>ctx.measureText(line).width))+90));
    panel.style.width=Math.min(width,innerWidth-32)+'px';
    const input=$('noteInput');if(input){input.style.height='auto';input.style.height=Math.min(Math.max(48,innerHeight-180),240,Math.max(24,input.scrollHeight))+'px';}
    scheduleNotePosition();
  }
  function activeNote() {
    return composing || [...notes(), ...staged.notes].find(n => n.id === viewingNotes?.noteId);
  }
  function noteViewport() {
    const v = window.visualViewport;
    return {left:(v?.offsetLeft||0)+12, top:(v?.offsetTop||0)+12,
      right:(v?.offsetLeft||0)+(v?.width||innerWidth)-12,
      bottom:(v?.offsetTop||0)+(v?.height||innerHeight)-12};
  }
  function scheduleNotePosition() {
    cancelAnimationFrame(notePositionFrame);
    notePositionFrame = requestAnimationFrame(positionNote);
  }
  function releaseNoteDock() {
    if (!noteDocked) return;
    const scroll = $('main').scrollTop;
    noteDocked = false; document.body.classList.remove('note-docked');
    $('main').style.removeProperty('height'); $('main').style.removeProperty('top');
    window.scrollTo({top:scroll, behavior:'instant'});
  }
  function positionNote() {
    const panel = $('noteWindow');
    if (panel.hidden || !state || noteDragging) return;
    const v = noteViewport(), gap = 12;
    panel.style.maxWidth = Math.max(0,v.right-v.left)+'px';
    panel.style.minWidth = Math.min(250,v.right-v.left)+'px';
    panel.style.maxHeight = Math.max(0,v.bottom-v.top)+'px';
    const rects = activeNote() ? anchorRanges(activeNote()).flatMap(r=>[...r.getClientRects()])
      .filter(r=>r.width>0&&r.height>0&&r.bottom>v.top&&r.top<v.bottom) : [];
    const box = panel.getBoundingClientRect(), width=box.width, height=box.height;
    const clampX = x => Math.max(v.left,Math.min(v.right-width,x));
    const clampY = y => Math.max(v.top,Math.min(v.bottom-height,y));
    const safe = (x,y,h=height) => x>=v.left&&x+width<=v.right+.5&&y>=v.top&&y+h<=v.bottom+.5&&
      rects.every(r=>x+width+gap<=r.left||x>=r.right+gap||y+h+gap<=r.top||y>=r.bottom+gap);
    const place = (x,y,side) => {panel.style.left=x+'px';panel.style.top=y+'px';panel.dataset.placement=side;};
    if (!noteDocked) {
      if (noteManualPosition && safe(box.left,box.top)) return;
      noteManualPosition=false;
      if (!rects.length) {place(clampX(box.left),clampY(box.top),'viewport');return;}
      const left=Math.min(...rects.map(r=>r.left)),right=Math.max(...rects.map(r=>r.right));
      const top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));
      const candidates=[
        [clampX(left),bottom+gap,'below'],[clampX(left),top-height-gap,'above'],
        [right+gap,clampY(top),'right'],[left-width-gap,clampY(top),'left'],
      ];
      const candidate=candidates.find(([x,y])=>safe(x,y));
      if(candidate){place(...candidate);return;}
      // Reduce the panel before reserving a separate reading viewport.
      const below=v.bottom-bottom-gap,above=top-v.top-gap;
      const available=Math.max(below,above);
      if(available>=100){
        panel.style.maxHeight=available+'px';
        place(clampX(left),below>=above?bottom+gap:v.top,below>=above?'below':'above');return;
      }
    }
    // A long selection or the software keyboard can leave no floating space.
    // The document gets its own scroll area above the panel, never underneath it.
    panel.style.maxHeight=Math.max(48,Math.min(height,(v.bottom-v.top)*.42))+'px';
    const dockHeight=panel.getBoundingClientRect().height, dockTop=v.bottom-dockHeight;
    const previousScroll=noteDocked?$('main').scrollTop:window.scrollY;
    const entering=!noteDocked;
    noteDocked=true;document.body.classList.add('note-docked');
    $('main').style.top=(v.top-12)+'px';
    $('main').style.height=Math.max(0,dockTop-gap-(v.top-12))+'px';
    if(entering){$('main').scrollTop=previousScroll;
      const anchor=activeNote()&&anchorRanges(activeNote()).at(-1);
      const end=anchor?.getBoundingClientRect();
      if(end){const reader=$('main').getBoundingClientRect();if(end.bottom>reader.bottom)$('main').scrollTop+=end.bottom-reader.bottom+12;}
    }
    place(clampX(box.left),dockTop,'docked');paintActiveAnchor();
  }
  function createDraft() {
    const doc = clone(currentDocument());
    return {baseVersion:doc.version, title:doc.title, titleSize:doc.titleSize, blocks:doc.blocks};
  }
  function setMode(next) {
    if (next === 'edit' && !isAuthor()) return;
    closePanel('noteWindow');
    closePanel('appMenu');
    mode = next;
    if (mode === 'edit' && !draft) { draft = createDraft(); saveDraft(); }
    document.body.classList.toggle('editing', mode === 'edit');
    $('readMode').classList.toggle('selected', mode === 'read'); $('editMode').classList.toggle('selected', mode === 'edit');
    $('readMode').setAttribute('aria-pressed', mode === 'read'); $('editMode').setAttribute('aria-pressed', mode === 'edit');
    $('formatbar').hidden = mode !== 'edit'; $('publishButton').hidden = mode !== 'edit';
    $('selectionButton').hidden = true; rangeSelection = null;
    renderArticle(true); renderShared();
    if (mode === 'edit') { selectedBlock = 'title'; updateFormat(); }
  }
  function saveDraft() {
    if (draft) {
      activeDocumentId ||= uid();
      const index = localDocuments.findIndex(item => item.id === activeDocumentId);
      const baseline = index < 0 ? clone(draft) : localDocuments[index].baseline || clone(localDocuments[index].draft);
      const entry = {id:activeDocumentId, draft:clone(draft), baseline};
      if (index < 0) localDocuments.unshift(entry); else localDocuments[index] = entry;
    }
    persistWorkspace();
    $('draftStatus').textContent = storageAvailable ? '已暂存于此浏览器' : '暂存失败，请保存 .rd';
    clearTimeout(saveTimer);
    renderLocalDocuments();
    renderedSignature = mode + JSON.stringify(draft);
  }
  function persistWorkspace() {
    store('document-workspace', {documents:localDocuments, activeId:activeDocumentId, draft});
    if (!storageAvailable) toast('浏览器暂存失败，请立即保存 .rd 文件，避免关闭页面后丢失。');
  }
  function renderLocalDocuments() {
    $('localDocuments').replaceChildren(...(isAuthor() ? localDocuments : []).map(entry => {
      const button = document.createElement('button');
      button.className = 'version-item' + (mode === 'edit' && entry.id === activeDocumentId ? ' active' : '');
      button.textContent = entry.draft.title || '未命名文稿';
      button.onclick = () => {
        if (busy) return;
        if (draft) saveDraft();
        activeDocumentId = entry.id; draft = clone(entry.draft);
        saveDraft(); setMode('edit'); closePanel('documentPanel');
      };
      return button;
    }));
  }
  function openLocalDocument(doc) {
    if (!isAuthor() || busy) return;
    if (draft) saveDraft();
    activeDocumentId = uid();
    draft = {baseVersion:latest().version, ...doc};
    saveDraft(); setMode('edit'); closePanel('documentPanel'); focusBlock('title');
  }
  function blockById(id) { return draft.blocks.find(b => b.id === id); }
  function bindEditor(element) {
    element.contentEditable = 'plaintext-only'; element.spellcheck = false;
    element.dataset.placeholder = element.dataset.block === 'title' ? '标题' : '正文';
    element.addEventListener('focus', () => { selectedBlock = element.dataset.block; updateFormat(); });
    element.addEventListener('input', () => {
      const id = element.dataset.block;
      if (id === 'title') draft.title = element.innerText.replace(/\n/g,'').slice(0,200);
      else blockById(id).text = element.innerText;
      saveDraft();
    });
    element.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      const id = element.dataset.block;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (id === 'title') { focusBlock(draft.blocks[0].id, 0); return; }
        const selection = window.getSelection(); if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0), prefixRange = range.cloneRange();
        prefixRange.selectNodeContents(element); prefixRange.setEnd(range.startContainer, range.startOffset);
        const start = prefixRange.toString().length, end = start + range.toString().length;
        const block = blockById(id), text = element.innerText;
        block.text = text.slice(0,start);
        const added = {id:uid(), type:'p', size:18, font:block.font, text:text.slice(end)};
        draft.blocks.splice(draft.blocks.indexOf(block)+1, 0, added); saveDraft(); renderArticle(true); focusBlock(added.id,0);
      } else if (event.key === 'Backspace' && id !== 'title' && !element.textContent && draft.blocks.length > 1) {
        event.preventDefault(); const index = draft.blocks.findIndex(b => b.id === id);
        draft.blocks.splice(index,1); saveDraft(); renderArticle(true); focusBlock(draft.blocks[Math.max(0,index-1)].id);
      }
    });
    element.addEventListener('paste', event => {
      event.preventDefault(); const text = event.clipboardData.getData('text/plain');
      const selected = window.getSelection(); if (!selected.rangeCount) return;
      const range = selected.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text);
      range.insertNode(node); range.setStartAfter(node); range.collapse(true); selected.removeAllRanges(); selected.addRange(range);
      element.dispatchEvent(new Event('input'));
    });
  }
  function focusBlock(id, offset) {
    const el = all('[data-block]', $('article')).find(e => e.dataset.block === id); if (!el) return;
    selectedBlock = id; el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    if (typeof offset === 'number' && el.firstChild) range.setStart(el.firstChild, Math.min(offset,el.firstChild.length));
    else range.collapse(false);
    if (typeof offset === 'number') range.collapse(true);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); updateFormat();
  }
  function updateFormat() {
    if (!draft) return;
    const title = selectedBlock === 'title', block = blockById(selectedBlock);
    if (!title && !block) { selectedBlock = 'title'; return updateFormat(); }
    $('blockType').value = title ? 'title' : block.type; $('blockType').disabled = title;
    $('fontFamily').value = title ? 'serif' : block.font; $('fontFamily').disabled = title;
    $('fontSize').value = title ? draft.titleSize : block.size;
    $('fontSize').min = title ? 20 : 12; $('fontSize').max = title ? 64 : 48;
    $('removeBlock').disabled = title || draft.blocks.length < 2;
  }
  function applyFormat() {
    if (mode !== 'edit') return;
    const title = selectedBlock === 'title', size = Number($('fontSize').value);
    const min = title ? 20 : 12, max = title ? 64 : 48;
    if (!Number.isFinite(size) || size < min || size > max) { toast(`字号范围：${min}–${max} px`); updateFormat(); return; }
    if (title) draft.titleSize = Math.round(size);
    else { const block = blockById(selectedBlock); block.type = $('blockType').value === 'h2' ? 'h2' : 'p'; block.font = $('fontFamily').value; block.size = Math.round(size); }
    saveDraft();
    const element = all('[data-block]', $('article')).find(el => el.dataset.block === selectedBlock);
    if (title) element.style.fontSize = draft.titleSize + 'px';
    else {
      const block = blockById(selectedBlock);
      if (element.tagName.toLowerCase() !== block.type) {
        const row = makeBlock(block); element.parentElement.replaceWith(row); bindEditor(row.firstChild);
      } else {
        element.dataset.font = block.font; element.style.fontSize = block.size + 'px';
        element.style.setProperty('--block-size',block.size+'px');
      }
    }
    updateFormat();
  }
  async function publish() {
    if (busy || !draft) return;
    if (!draft.title.trim()) { toast('请填写标题'); focusBlock('title'); return; }
    const submitted = clone(draft); busy = true; $('publishButton').disabled = true; $('publishButton').textContent = '发布中';
    try {
      const result = await request('/api/publish', submitted);
      const unchanged = JSON.stringify(draft) === JSON.stringify(submitted);
      if (unchanged) {
        draft.baseVersion = result.version; saveDraft();
        localDocuments.find(entry => entry.id === activeDocumentId).baseline = clone(draft);
        draft = null; persistWorkspace();
      }
      pinnedVersion = null; await refresh();
      if (unchanged) setMode('read');
      toast(offline ? '新版本已保存到本地副本。' : '新版本已发布。');
    } catch (error) { toast(error.message); if (error.status === 409) await refresh(); }
    finally { busy = false; $('publishButton').textContent = '发布'; updateVersionNotice(); }
  }
  function captureSelection() {
    if (mode !== 'read') return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) { $('selectionButton').hidden = true; return; }
    const range = selected.getRangeAt(0);
    const a = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    const b = range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer;
    const startBlock = a.closest('[data-block]'), endBlock = b.closest('[data-block]');
    if (!startBlock || !endBlock || startBlock.dataset.block !== endBlock.dataset.block || !$('article').contains(startBlock)) { $('selectionButton').hidden = true; return; }
    const before = range.cloneRange(); before.selectNodeContents(startBlock); before.setEnd(range.startContainer, range.startOffset);
    const start = Number(startBlock.dataset.start||0)+before.toString().length;
    const ending=range.cloneRange();ending.selectNodeContents(endBlock);ending.setEnd(range.endContainer,range.endOffset);
    const end=Number(endBlock.dataset.start||0)+ending.toString().length;
    const doc=currentDocument(),source=startBlock.dataset.block==='title'?doc.title:doc.blocks.find(b=>b.id===startBlock.dataset.block)?.text;
    const quote=source?.slice(start,end);
    if(!quote?.trim()||quote.length>4000){$('selectionButton').hidden=true;return;}
    rangeSelection = {version:doc.version, blockId:startBlock.dataset.block, quote, start, end};
    const rect = range.getBoundingClientRect();
    $('selectionButton').style.left = Math.max(12,Math.min(innerWidth-90,rect.left+rect.width/2-30))+'px';
    $('selectionButton').style.top = Math.max(12,Math.min(innerHeight-48,rect.top-43))+'px'; $('selectionButton').hidden = false;
  }
  function openComposer(selection, existingId = null) {
    releaseNoteDock(); noteManualPosition=false;
    composing = {...clone(selection), existingId}; viewingNotes = null;
    $('noteWindow').dataset.view = 'compose';
    $('noteContents').innerHTML = `<div class="suggestion-composer"><textarea class="note-input" id="noteInput" rows="1" maxlength="4000" placeholder="写下建议…" aria-label="建议内容"></textarea><button id="saveNote" class="primary check-button" aria-label="确认建议" title="确认">✓</button></div><p id="noteError" class="form-error" role="alert" hidden></p>`;
    $('noteInput').value = selection.body || '';
    let noteId = existingId || uid();
    function sizeInput() { fitSuggestion($('noteInput')?.value||''); }
    $('noteInput').oninput = sizeInput;
    $('noteInput').onkeydown = event => { if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();$('saveNote').click();} };
    $('saveNote').onclick = async () => {
      if(busy)return;
      const body = $('noteInput').value.trim();
      if (!body) { $('noteError').textContent = '请写下建议'; $('noteError').hidden = false; return; }
      const prior=staged.notes.find(n=>n.id===noteId);
      const note = {...selection, id:noteId, body, requestKey:prior?.body===body&&prior.requestKey?prior.requestKey:uid()};
      delete note.existingId;
      const index = staged.notes.findIndex(n => n.id === noteId);
      if (index < 0) staged.notes.push(note); else staged.notes[index] = note;
      staged.requestKey = uid(); saveStaged();
      await confirmSuggestions([clone(note)],note.requestKey);
    };
    sizeInput();showWindow('noteWindow'); $('selectionButton').hidden = true; sizeInput(); $('noteInput').focus({preventScroll:true});paintActiveAnchor();scheduleNotePosition();
  }
  function openNotes(version, blockId, noteId=null) {
    releaseNoteDock(); noteManualPosition=false;
    const alreadyOpen=!$('noteWindow').hidden;
    const match=notes().find(n=>n.version===version&&n.blockId===blockId)||staged.notes.find(n=>n.version===version&&n.blockId===blockId);
    viewingNotes = {version, blockId,noteId:noteId||match?.id}; composing = null; renderNoteViewer();
    revealNote(match&&noteId?notes().find(n=>n.id===noteId)||match:match);
    if(!alreadyOpen)showWindow('noteWindow');
    renderDots();
  }
  function renderNoteViewer() {
    if (!viewingNotes) return;
    const group = [...notes(), ...staged.notes.map(n => ({...n, local:true, author:'我'}))]
      .filter(n => n.id===viewingNotes.noteId);
    $('noteWindow').dataset.view = 'read';
    $('noteContents').innerHTML = group.map(n => `<section class="review-note"><p class="review-body">${escape(n.body)}</p>${n.local?`<div class="review-actions"><button class="quiet" data-edit-note="${escape(n.id)}" aria-label="修改建议">↺</button><button class="quiet" data-delete-note="${escape(n.id)}" aria-label="删除建议">×</button><button class="quiet" data-confirm-note="${escape(n.id)}" aria-label="确认建议">✓</button></div>`:''}</section>`).join('');
    fitSuggestion(group[0]?.body||'');paintActiveAnchor();
  }
  function saveStaged() { store('staged', staged); renderStaging(); }
  function renderStaging() {
    $('stagingBar').hidden = staged.notes.length === 0 || mode === 'edit';
    $('stagedCount').textContent = staged.notes.length;
  }
  async function confirmSuggestions(selectedNotes,requestKey) {
    if (busy || !selectedNotes.length) return;
    const payload = {requestKey,basedOn:state.commits[0]?.id || null,
      author:load('reviewer-name','') || (isAuthor()?'作者':'读者'),reviewerId,
      message:`建议 ${selectedNotes.length} 条`,notes:selectedNotes};
    busy = true;
    const saveButton=$('saveNote'),input=$('noteInput');
    if(saveButton){saveButton.disabled=true;saveButton.textContent='…';saveButton.setAttribute('aria-busy','true');}
    if(input)input.disabled=true;
    $('openCommit').disabled=true;
    if($('noteError'))$('noteError').hidden=true;
    try {
      const confirmed=await request('/api/commits',payload);
      await refresh();
      const ids = new Set(selectedNotes.map(n => n.id));
      staged.notes = staged.notes.filter(n => !ids.has(n.id)); staged.requestKey = uid();
      saveStaged();
      const last=selectedNotes[selectedNotes.length-1];
      const saved=notes().find(n=>n.commitId===confirmed.id&&n.blockId===last.blockId&&n.quote===last.quote&&n.body===last.body);
      openNotes(last.version,last.blockId,saved?.id);
      $('noteContents').scrollTop=0;
      return true;
    } catch (error) {
      if($('noteError')){$('noteError').textContent='未完成确认，建议已保留。请重试。';$('noteError').hidden=false;}
      else toast('未完成确认，建议已保留。请重试。');
      return false;
    } finally {
      busy = false; $('openCommit').disabled=false;
      if($('saveNote')){$('saveNote').disabled=false;$('saveNote').textContent='✓';$('saveNote').removeAttribute('aria-busy');}
      if($('noteInput'))$('noteInput').disabled=false;
    }
  }
  function renderHistory() {
    const selected = $('authorFilter').value;
    const authors = [...new Set(state.commits.map(c => c.author))];
    $('authorFilter').innerHTML = '<option value="all">所有人</option>' + authors.map(a => `<option value="${escape(a)}">${escape(a)}</option>`).join('');
    $('authorFilter').value = authors.includes(selected) ? selected : 'all';
    const author = $('authorFilter').value, status = $('statusFilter').value;
    const matching = state.commits.filter(c => author === 'all' || c.author === author).map(c => ({...c,
      notes:c.notes.filter(n => status === 'all' || (status === 'resolved') === n.resolved)})).filter(c => c.notes.length);
    $('authorFilter').hidden=authors.length<2;
    $('historyList').innerHTML = matching.flatMap(c => c.notes.map(n => `<div class="history-entry"><button class="history-note" data-show-note="${escape(n.id)}"><span class="note-excerpt">${escape(n.quote)}</span><span class="note-text">${escape(n.body)}</span><span class="history-note-meta">${!['读者','作者'].includes(c.author)?escape(c.author):''}${n.version!==latest().version?` · v${n.version}`:''}${n.resolved?' · 已处理':''}</span></button>${isAuthor()?`<button class="history-resolve" data-resolve="${escape(n.id)}" aria-label="${n.resolved?'重新打开建议':'标记建议已处理'}" aria-pressed="${n.resolved}">✓</button>`:''}</div>`)).join('') || '<p class="empty">暂无建议</p>';
  }
  function closePanel(id) {
    $(id).hidden = true;
    const toggles = {documentPanel:'documentToggle', historyPanel:'historyToggle', appearance:'appearanceToggle',pdfPanel:'pdfButton',appMenu:'menuToggle'};
    if (toggles[id]) $(toggles[id]).setAttribute('aria-expanded','false');
    if (id === 'noteWindow') { releaseNoteDock(); noteManualPosition=false; composing = null; viewingNotes = null; if(state)renderDots(); }
  }
  function togglePanel(id, button) {
    closePanel('appMenu');
    if(id==='documentPanel'&&!isAuthor())return;
    const open = $(id).hidden;
    for (const other of ['documentPanel','historyPanel','appearance','pdfPanel']) if (other !== id) closePanel(other);
    $(id).hidden = !open; $(button).setAttribute('aria-expanded',open);
  }
  function showWindow(id) {
    for (const other of ['noteWindow','shareWindow']) if (other !== id) closePanel(other);
    // Closing a sibling must not clear the newly selected note state.
    const windowEl = $(id); windowEl.hidden = false;
    if (id === 'noteWindow') { positionNote(); return; }
    const rect = windowEl.getBoundingClientRect();
    windowEl.style.left = Math.max(12,(innerWidth-rect.width)/2)+'px';
    windowEl.style.top = Math.max(12,(innerHeight-rect.height)/2)+'px';
  }
  function confirmAction(title, body) {
    $('confirmTitle').textContent = title; $('confirmBody').textContent = body;
    const dialog = $('confirmDialog'); dialog.returnValue = ''; dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close',()=>resolve(dialog.returnValue === 'confirm'),{once:true}));
  }
  function applyAppearance() {
    if (!/^#[a-f0-9]{6}$/i.test(appearance.paper)) appearance.paper = '#fdfcf9';
    if (!/^#[a-f0-9]{6}$/i.test(appearance.accent)) appearance.accent = '#566851';
    appearance.widthPercent = Math.max(60,Math.min(100,Number(appearance.widthPercent)||Math.round((Number(appearance.width)||660)/8)));
    appearance.readingSize = Math.max(12,Math.min(26,Number(appearance.readingSize)||18));
    appearance.lineHeight = Math.max(1.3,Math.min(2.3,Number(appearance.lineHeight)||1.95));
    appearance.paragraphGap = Math.max(8,Math.min(40,Number(appearance.paragraphGap)||22));
    document.documentElement.style.setProperty('--paper',appearance.paper);
    document.documentElement.style.setProperty('--accent',appearance.accent);
    document.documentElement.style.setProperty('--reading-width-ratio',appearance.widthPercent/100);
    document.documentElement.style.setProperty('--font-scale',appearance.readingSize/18);
    document.documentElement.style.setProperty('--reader-line-height',appearance.lineHeight);
    document.documentElement.style.setProperty('--paragraph-gap',appearance.paragraphGap+'px');
    $('paperColor').value = appearance.paper; $('accentColor').value = appearance.accent;
    $('readingWidth').value = appearance.widthPercent; $('widthValue').textContent = appearance.widthPercent+'%';
    $('readingSize').value=appearance.readingSize;$('readingSizeValue').textContent=appearance.readingSize+' px';
    $('readingLineHeight').value=appearance.lineHeight;$('lineHeightValue').textContent=appearance.lineHeight.toFixed(2);
    $('paragraphGap').value=appearance.paragraphGap;$('paragraphGapValue').textContent=appearance.paragraphGap+' px';
    appearance.layout=appearance.layout==='a4'?'a4':'flow';appearance.direction=appearance.direction==='horizontal'?'horizontal':'vertical';
    all('[data-layout]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.layout===appearance.layout)));
    all('[data-direction]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.direction===appearance.direction)));
    $('pageDirection').hidden=appearance.layout!=='a4';
    if(state&&mode==='read')renderArticle(true);
  }
  function download(name, type, content) {
    const url = URL.createObjectURL(new Blob([content],{type})); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  const fileDocument = () => mode === 'edit' ? draft : currentDocument();
  const fileName = doc => (doc.title || '未命名文稿').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0,80) || '未命名文稿';
  function documentContent(doc) {
    return {title:doc.title, titleSize:doc.titleSize, blocks:doc.blocks.map(({id,type,font,size,text}) => ({id,type,font,size,text}))};
  }
  function saveDocument() {
    if (!isAuthor()) return;
    const doc = fileDocument();
    try {
      const text = JSON.stringify({format:'rd', version:1, document:documentContent(doc)}, null, 2)+'\n';
      parseDocument(text);
      if (new Blob([text]).size > 1_000_000) throw new Error('文稿超过 1 MB');
      download(fileName(doc)+'.rd', 'application/json;charset=utf-8', text);
      if (mode === 'edit') {
        const entry = localDocuments.find(item => item.id === activeDocumentId);
        if (entry) { entry.baseline = clone(draft); persistWorkspace(); }
      }
      toast('已下载 .rd 文件，可通过“打开 .rd”继续编辑。');
    } catch (error) { toast(error.message+' 当前内容已保留，可先导出 HTML 副本。'); }
  }
  function parseDocument(text) {
    const invalid = () => { throw new Error('无效的 .rd 文档：请检查格式、字号和内容长度。'); };
    let data;
    try { data = JSON.parse(text.replace(/^\uFEFF/,'')); } catch { invalid(); }
    if (data?.format !== 'rd' || data.version !== 1) throw new Error('不支持此文件格式或版本，请选择 RD 保存的 .rd 文件。');
    const doc = data.document;
    const validText = (value, max) => typeof value === 'string' && Array.from(value).length <= max && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
    const size = (value,min,max) => Number.isInteger(value) && value >= min && value <= max;
    if (!doc || !validText(doc.title,200) || !size(doc.titleSize,20,64) || !Array.isArray(doc.blocks) || !doc.blocks.length || doc.blocks.length > 200) invalid();
    const ids = new Set(['title']);
    for (const b of doc.blocks) {
      if (!b || !validText(b.id,100) || !b.id.trim() || ids.has(b.id) || !['p','h2'].includes(b.type) || !['serif','sans','mono'].includes(b.font) || !size(b.size,12,48) || !validText(b.text,20000)) invalid();
      ids.add(b.id);
    }
    const content = documentContent(doc);
    // Imported identifiers are not trusted CSS selector fragments or source anchors.
    for (const block of content.blocks) block.id = uid();
    return content;
  }
  const printDate = () => new Date().toLocaleDateString('en-CA', {year:'numeric',month:'2-digit',day:'2-digit'});
  function renderPDFOptions() {
    $('pdfWatermark').checked = pdfOptions.watermark;
    if ($('pdfWatermarkText').value !== pdfOptions.text) $('pdfWatermarkText').value = pdfOptions.text;
    $('pdfWatermarkFields').hidden = !pdfOptions.watermark;
    $('pdfPanel').querySelector('.pdf-preview').dataset.position = pdfOptions.position;
    $('pdfPositionLabel').textContent = watermarkPositions[pdfOptions.position];
    all('[data-watermark-position]', $('pdfWatermarkPosition')).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.watermarkPosition === pdfOptions.position)));
    $('pdfWatermarkPreview').textContent = pdfOptions.text;
    $('pdfDatePreview').textContent = printDate();
    $('pdfPanel').classList.toggle('without-watermark', !pdfOptions.watermark);
  }
  function savePDFOptions(event) {
    if (event?.isComposing) return;
    pdfOptions = {position:pdfOptions.position, watermark:$('pdfWatermark').checked, text:$('pdfWatermarkText').value.slice(0,120)};
    store('pdf-options',pdfOptions); renderPDFOptions();
  }
  $('pdfWatermark').onchange = savePDFOptions;
  $('pdfWatermarkText').oninput = savePDFOptions;
  $('pdfWatermarkText').oncompositionend = savePDFOptions;
  all('[data-watermark-position]', $('pdfWatermarkPosition')).forEach(button => { button.onclick = () => {
    pdfOptions.position = button.dataset.watermarkPosition; savePDFOptions();
  }; });
  function preparePrint() {
    if (!state) return;
    $('printDocument')?.remove();
    const doc = fileDocument(), article = document.createElement('article'); article.id = 'printDocument';
    article.setAttribute('aria-hidden','true');
    document.body.append(article);
    let content;
    const newPage = () => {
      const page = document.createElement('section'); page.className = 'print-page';
      page.dataset.watermarkPosition = pdfOptions.position;
      content = document.createElement('div'); content.className = 'print-body'; page.append(content);
      if (pdfOptions.watermark) {
        const header = document.createElement('header'); header.className = 'print-watermark-header';
        const text = document.createElement('span'); text.textContent = pdfOptions.text;
        header.append(text);
        const date = document.createElement('time'); date.className = 'print-watermark-date'; date.textContent = printDate();
        const footer = document.createElement('footer'); footer.className = 'print-watermark-footer';
        const link = document.createElement('a'); link.href = projectURL; link.textContent = projectURL; footer.append(link);
        page.append(header,date,footer);
      }
      article.append(page);
    };
    newPage();
    const source = [{type:'h1',font:'serif',size:doc.titleSize,text:doc.title}, ...doc.blocks];
    for (const block of source) {
      const characters = globalThis.Intl?.Segmenter ? [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(block.text)].map(part=>part.segment) : Array.from(block.text);
      let offset = 0;
      do {
        const el = document.createElement(block.type);
        el.style.fontSize = block.size+'px'; el.style.fontFamily = `var(--${block.font})`;
        el.textContent = characters.slice(offset).join('');
        if (offset) el.classList.add('print-continued');
        const wasEmpty = !content.children.length; content.append(el);
        const limit = content.getBoundingClientRect().bottom;
        const fits = () => el.getBoundingClientRect().bottom <= limit + .25;
        if (!wasEmpty && block.type !== 'p' && el.getBoundingClientRect().bottom + 72 > limit) {
          el.remove(); newPage(); continue;
        }
        if (fits()) break;
        let low = 0, high = characters.length-offset;
        while (low < high) {
          const middle = Math.ceil((low+high)/2); el.textContent = characters.slice(offset,offset+middle).join('');
          if (fits()) low = middle; else high = middle-1;
        }
        if (!low && !wasEmpty) { el.remove(); newPage(); continue; }
        let take = Math.max(1,low);
        // Keep punctuation and ordinary Latin words together when a page splits a block.
        while (take > 1 && (/[，。！？；：、）》」』】…,.!?;:]/.test(characters[offset+take]||'') || /[（《「『【(]/.test(characters[offset+take-1]||''))) take--;
        const fragment = characters.slice(offset,offset+take).join('');
        if (/[a-z]$/i.test(fragment) && /^[a-z]/i.test(characters[offset+take]||'')) {
          const word = fragment.match(/[a-z]+$/i);
          if (word && word.index > 0 && word[0].length < 30) take -= word[0].length;
        }
        el.textContent = characters.slice(offset,offset+take).join(''); offset += take;
        if (offset < characters.length) newPage();
      } while (offset < characters.length);
    }
  }
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', () => $('printDocument')?.remove());
  $('pdfButton').onclick = () => { closePanel('noteWindow'); renderPDFOptions(); togglePanel('pdfPanel','pdfButton'); };
  $('printPDF').onclick = async () => {
    await document.fonts.ready;
    preparePrint(); window.print();
  };
  $('newDocument').onclick = () => openLocalDocument({title:'', titleSize:38, blocks:[{id:uid(),type:'p',font:'serif',size:18,text:''}]});
  $('openDocument').onclick = () => { if (isAuthor() && !busy) $('documentFile').click(); };
  $('documentFile').onchange = async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file || !isAuthor() || busy) return;
    try {
      if (file.size > 1_000_000) throw new Error('文件超过 1 MB，请拆分为较小的文稿。');
      const doc = parseDocument(await file.text());
      openLocalDocument(doc);
      toast('已打开为独立本地文稿；编辑后请保存 .rd。');
    } catch (error) { toast(error.message); }
  };
  $('saveDocument').onclick = saveDocument;
  $('publishReplacement').onclick = async () => {
    if (!isAuthor() || busy || !draft) return;
    const expectedDraft = draft, baseVersion = latest().version;
    if (!await confirmAction('将此文稿发布为最新版本？', `此稿将替换审阅链接当前显示的 v${baseVersion}。旧版本及其建议会保留，建议不会转移到此稿。`)) return;
    if (draft !== expectedDraft || busy) return;
    draft.baseVersion = baseVersion; saveDraft(); await publish();
  };
  async function exportCopy() {
    try {
      const source = document.documentElement.cloneNode(true);
      let css, script;
      if (offline) { css = document.getElementById('offlineStyle').textContent; script = document.getElementById('offlineApp').textContent; }
      else [css, script] = await Promise.all(['/style.css','/app.js'].map(async path => { const r = await fetch(path); if (!r.ok) throw new Error('资源读取失败'); return r.text(); }));
      all('script,link[rel=stylesheet],#offlineStyle',source).forEach(n=>n.remove());
      const style = document.createElement('style'); style.id = 'offlineStyle'; style.textContent = css; source.querySelector('head').append(style);
      const selected = clone(fileDocument()), snapshot = clone(state); snapshot.isOwner = true;
      snapshot.versions = [{...selected, version:1, createdAt:new Date().toISOString()}];
      snapshot.commits = mode === 'edit' ? [] : snapshot.commits.map(c => ({...c, notes:c.notes.filter(n => n.version === selected.version).map(n => ({...n, version:1}))})).filter(c => c.notes.length);
      delete snapshot.reviewUrl;
      const exportedDraft = mode === 'edit' ? {...documentContent(selected), baseVersion:1} : null;
      const bootstrap = document.createElement('script');
      bootstrap.textContent = 'window.__SNAPSHOT__='+JSON.stringify(snapshot).replace(/</g,'\\u003c')+';window.__LOCAL__='+JSON.stringify({draft:exportedDraft,staged:{notes:[],requestKey:uid()},appearance}).replace(/</g,'\\u003c')+';';
      const app = document.createElement('script'); app.id = 'offlineApp'; app.textContent = script;
      source.querySelector('body').append(bootstrap,app);
      for (const id of ['noteWindow','shareWindow','appearance','documentPanel','historyPanel','pdfPanel','appMenu','selectionButton','toast']) source.querySelector('#'+id).hidden = true;
      source.querySelector('#confirmDialog').removeAttribute('open');
      for (const id of ['article','localDocuments','versionList','historyList','noteContents']) source.querySelector('#'+id).replaceChildren();
      source.querySelector('#printDocument')?.remove();
      source.querySelector('body').classList.remove('note-docked');
      source.querySelector('#main').style.removeProperty('height');
      source.querySelector('#main').style.removeProperty('top');
      download(fileName(selected)+'.html','text/html;charset=utf-8','<!doctype html>\n'+source.outerHTML);
      toast('副本已保存；联网协作请继续使用原链接。');
    } catch (error) { toast('保存失败：'+error.message); }
  }

  $('menuToggle').onclick = () => {const open=$('appMenu').hidden;if(open)closePanel('appearance');$('appMenu').hidden=!open;$('menuToggle').setAttribute('aria-expanded',String(open));};
  $('documentToggle').onclick = () => togglePanel('documentPanel','documentToggle');
  $('historyToggle').onclick = () => togglePanel('historyPanel','historyToggle');
  $('appearanceToggle').onclick = () => togglePanel('appearance','appearanceToggle');
  $('readMode').onclick = () => setMode('read'); $('editMode').onclick = () => setMode('edit');
  $('blockType').onchange = () => { if (selectedBlock !== 'title') $('fontSize').value = $('blockType').value === 'h2' ? 25 : 18; applyFormat(); };
  $('fontFamily').onchange = applyFormat; $('fontSize').onchange = applyFormat;
  $('fontSize').onkeydown = event => { if(event.key === 'Enter') { event.preventDefault(); applyFormat(); } };
  $('addBlock').onclick = () => {
    const index = draft.blocks.findIndex(b => b.id === selectedBlock);
    const block = {id:uid(), type:'p', font:'serif', size:18, text:''}; draft.blocks.splice(index+1,0,block);
    saveDraft(); renderArticle(true); focusBlock(block.id,0);
  };
  $('removeBlock').onclick = async () => {
    const block = blockById(selectedBlock); if (!block || draft.blocks.length < 2) return;
    if (block.text.trim() && !(await confirmAction('删除这一段？','此操作只影响本地草稿。'))) return;
    const index = draft.blocks.indexOf(block); draft.blocks.splice(index,1); saveDraft(); renderArticle(true); focusBlock(draft.blocks[Math.max(0,index-1)].id);
  };
  $('discardDraft').onclick = async () => {
    if (busy || !draft) return;
    const expectedDraft = draft;
    if(await confirmAction('还原当前文稿？','还原到此文稿最近保存 .rd、打开、新建或发布时的内容。其他文稿不受影响。') && draft === expectedDraft && !busy) {
      const entry = localDocuments.find(item => item.id === activeDocumentId);
      draft = clone(entry?.baseline || entry?.draft || createDraft());
      saveDraft();renderArticle(true);selectedBlock='title';updateFormat();updateVersionNotice();
    }
  };
  $('publishButton').onclick = publish;
  $('latestVersion').onclick = () => { pinnedVersion=null;if(mode==='edit')setMode('read');renderArticle(true);renderShared(); };
  $('article').addEventListener('mouseup',()=>setTimeout(captureSelection,10));
  $('article').addEventListener('keyup',captureSelection);
  $('article').addEventListener('touchend',()=>setTimeout(captureSelection,100));
  $('selectionButton').onpointerdown = event => event.preventDefault();
  $('selectionButton').onclick = () => { if(rangeSelection)openComposer(rangeSelection); };
  $('openCommit').onclick = async () => {
    for(const saved of clone(staged.notes)){
      const note=staged.notes.find(n=>n.id===saved.id);if(!note)continue;
      note.requestKey ||= uid();store('staged',staged);
      if(!(await confirmSuggestions([clone(note)],note.requestKey)))break;
    }
  };
  $('stagedListButton').onclick = () => { const first=staged.notes[0];if(first)openNotes(first.version,first.blockId); };
  $('authorFilter').onchange = renderHistory; $('statusFilter').onchange = renderHistory;
  $('shareButton').onclick = () => {
    closePanel('appMenu');
    if(offline){toast('这是离线副本。请从原来的服务地址分享。');return;}
    $('shareUrl').value = state.reviewUrl || location.origin + '/review';
    const local = ['localhost','127.0.0.1','[::1]'].includes(new URL($('shareUrl').value).hostname);
    $('shareScope').textContent = local ? '本机链接 · 其他设备需使用服务器地址。' : pollingOnly() ? '临时分享 · 下次启动地址会变化，请保持程序运行。' : '可以留下建议，正文只读。';
    showWindow('shareWindow');
  };
  $('copyShare').onclick = async () => {
    try { await navigator.clipboard.writeText($('shareUrl').value); toast('已复制'); }
    catch { $('shareUrl').select(); toast('请复制已选中的链接'); }
  };
  for(const [id,key] of [['paperColor','paper'],['accentColor','accent'],['readingWidth','widthPercent'],['readingSize','readingSize'],['readingLineHeight','lineHeight'],['paragraphGap','paragraphGap']]) $(id).oninput=e=>{appearance[key]=['paper','accent'].includes(key)?e.target.value:Number(e.target.value);applyAppearance();store('appearance',appearance);};
  all('[data-layout],[data-direction]').forEach(button=>button.onclick=()=>{
    if(button.dataset.layout)appearance.layout=button.dataset.layout;
    if(button.dataset.direction)appearance.direction=button.dataset.direction;
    pageIndex=0;applyAppearance();store('appearance',appearance);
  });
  $('previousPage').onclick=()=>turnPage(-1);$('nextPage').onclick=()=>turnPage(1);
  let swipeStart=null;
  $('article').addEventListener('touchstart',event=>{swipeStart=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
  $('article').addEventListener('touchend',event=>{
    if(!swipeStart||!paged()||appearance.direction!=='horizontal'||!window.getSelection()?.isCollapsed)return;
    const touch=event.changedTouches[0],dx=touch.clientX-swipeStart.x,dy=touch.clientY-swipeStart.y;swipeStart=null;
    if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)turnPage(dx<0?1:-1);
  },{passive:true});
  $('exportButton').onclick = exportCopy;
  $('legacyButton').onclick = async () => {
    if(!(await confirmAction('恢复旧稿？','旧版文案将放入本地草稿，当前已发布文章不变。')))return;
    const t=legacy.texts,blocks=[];
    for(const key of ['heading1','paragraph1','paragraph2','pullquote','heading2','paragraph3','heading3','paragraph4'])if(t[key])blocks.push({id:uid(),type:key.startsWith('heading')?'h2':'p',text:t[key],font:'serif',size:key.startsWith('heading')?25:18});
    openLocalDocument({title:t.docTitle||'未命名',titleSize:38,blocks:blocks.length?blocks:clone(latest().blocks)});
  };
  document.addEventListener('click',async event=>{
    if(!event.target.closest('#appMenu,#menuToggle'))closePanel('appMenu');
    const close=event.target.closest('[data-close]');if(close)closePanel(close.dataset.close);
    const edit=event.target.closest('[data-edit-note]');if(edit){const note=staged.notes.find(n=>n.id===edit.dataset.editNote);if(note)openComposer(note,note.id);}
    const confirm=event.target.closest('[data-confirm-note]');if(confirm&&!busy){const note=staged.notes.find(n=>n.id===confirm.dataset.confirmNote);if(note){note.requestKey ||= uid();store('staged',staged);await confirmSuggestions([clone(note)],note.requestKey);}}
    const remove=event.target.closest('[data-delete-note]');if(remove){staged.notes=staged.notes.filter(n=>n.id!==remove.dataset.deleteNote);staged.requestKey=uid();saveStaged();renderDots();if(viewingNotes)renderNoteViewer();}
    const resolve=event.target.closest('[data-resolve]');if(resolve){const note=notes().find(n=>n.id===resolve.dataset.resolve);if(note){resolve.disabled=true;try{await request('/api/resolve',{id:note.id,resolved:!note.resolved});await refresh();}catch(e){toast(e.message);resolve.disabled=false;}}}
    const show=event.target.closest('[data-show-note]');if(show){const note=notes().find(n=>n.id===show.dataset.showNote);if(note){if(mode==='edit')setMode('read');pinnedVersion=note.version===latest().version?null:note.version;renderArticle();renderShared();closePanel('historyPanel');openNotes(note.version,note.blockId,note.id);}}
    const version=event.target.closest('[data-version]');if(version){if(mode==='edit')setMode('read');pinnedVersion=Number(version.dataset.version);renderArticle();renderShared();closePanel('historyPanel');}
  });
  all('[data-drag-handle]').forEach(handle=>{
    let drag=null;
    handle.addEventListener('pointerdown',event=>{
      if(event.target.closest('button')||event.button!==0)return;
      const panel=handle.closest('.floating-window'),rect=panel.getBoundingClientRect();
      noteDragging=panel===$('noteWindow');
      drag={panel,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag)return;const rect=drag.panel.getBoundingClientRect();
      drag.panel.style.left=Math.max(8,Math.min(innerWidth-rect.width-8,drag.left+event.clientX-drag.x))+'px';
      drag.panel.style.top=Math.max(8,Math.min(innerHeight-rect.height-8,drag.top+event.clientY-drag.y))+'px';
    });
    const endDrag=()=>{if(drag?.panel===$('noteWindow'))noteManualPosition=true;drag=null;noteDragging=false;scheduleNotePosition();};
    handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  });
  document.addEventListener('keydown',event=>{
    if(paged()&&appearance.direction==='horizontal'&&!event.target.closest('input,textarea,select,button,[contenteditable],.floating-window')&&window.getSelection()?.isCollapsed&&['ArrowLeft','ArrowRight'].includes(event.key)){
      event.preventDefault();turnPage(event.key==='ArrowRight'?1:-1);
    }
    if(event.key==='Escape'){for(const id of ['noteWindow','shareWindow','documentPanel','historyPanel','appearance','pdfPanel','appMenu'])closePanel(id);$('selectionButton').hidden=true;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'&&isAuthor()){event.preventDefault();saveDocument();}
  });
  window.addEventListener('scroll',()=>{$('selectionButton').hidden=true;scheduleNotePosition();},{passive:true});
  $('main').addEventListener('scroll',()=>{$('selectionButton').hidden=true;scheduleNotePosition();},{passive:true});
  window.visualViewport?.addEventListener('resize',scheduleNotePosition);
  window.visualViewport?.addEventListener('scroll',scheduleNotePosition);
  new ResizeObserver(scheduleNotePosition).observe($('noteWindow'));
  window.addEventListener('resize',()=>{
    for(const el of all('.floating-window:not([hidden])')){const rect=el.getBoundingClientRect();el.style.left=Math.max(8,Math.min(innerWidth-rect.width-8,rect.left))+'px';el.style.top=Math.max(8,Math.min(innerHeight-rect.height-8,rect.top))+'px';}
    schedulePagination();
    if(!$('noteWindow').hidden)fitSuggestion($('noteInput')?.value||$('noteContents').querySelector('.review-body')?.textContent||'');
  });
  new ResizeObserver(schedulePagination).observe($('article'));
  new ResizeObserver(() => document.documentElement.style.setProperty('--formatbar-height', $('formatbar').getBoundingClientRect().height+'px')).observe($('formatbar'));
  document.fonts?.ready.then(()=>{if(state&&mode==='read'){if(paged())renderArticle(true);else renderDots();}});
  window.addEventListener('online',()=>{if(!offline)refresh().catch(()=>connection('未连接',true));});
  window.addEventListener('offline',()=>connection('未连接',true));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!offline)refresh().catch(()=>{});});
  window.addEventListener('beforeunload',event=>{syncStopped=true;clearTimeout(syncTimer);eventSource?.close();if(!storageAvailable&&draft){event.preventDefault();event.returnValue='';}});
  async function start(){
    try{
      let firstExportOpen = false;
      if(offline){
        document.body.classList.add('offline');state=load('snapshot',window.__SNAPSHOT__);
        if(!state)throw new Error('请通过本地服务打开此页面。');state.isOwner=true;
        if(window.__LOCAL__&&!load('offline-initialized',false)){
          firstExportOpen = true;
          draft=window.__LOCAL__.draft;staged=window.__LOCAL__.staged;appearance=window.__LOCAL__.appearance;
          localDocuments=[];activeDocumentId=null;
          store('staged',staged);store('appearance',appearance);store('offline-initialized',true);
        }
      }
      applyAppearance();await refresh();
      if (isAuthor() && draft) saveDraft();
      setMode(isAuthor() && draft && !firstExportOpen ? 'edit' : 'read');connection(offline?'离线副本':'已同步');
      startSync();
      if(!offline && new URLSearchParams(location.search).has('share') && state.reviewUrl) $('shareButton').click();
    }catch(error){$('article').innerHTML='<p class="error-page">'+escape(error.message)+'</p>';connection('未连接',true);}
  }
  start();
})();
