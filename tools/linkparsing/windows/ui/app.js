'use strict';
const $ = id => document.getElementById(id);
// Shared 24px line icons; paths are trusted constants, never user/media text.
const iconPaths = {
  download:['M12 3v12m-5-5 5 5 5-5','M4 16v4h16v-4'],
  upload:['M12 16V4m-5 5 5-5 5 5','M4 16v4h16v-4'],
  plus:['M12 5v14M5 12h14'], x:['m6 6 12 12M18 6 6 18'],
  'arrow-left':['M20 12H4m7-7-7 7 7 7'], 'arrow-right':['M4 12h16m-7-7 7 7-7 7'],
  'chevron-right':['m9 5 7 7-7 7'], check:['m5 12 4 4L19 6'],
  panels:['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z','M9 4v16M5.5 8h.5m-.5 4h.5'],
  text:['M4 5h16M4 10h16M4 15h10M4 20h7'],
  settings:['M4 7h7m4 0h5M4 17h3m4 0h9','M11 4v6m4-6v6m-8 4v6m4-6v6'],
  activity:['M3 12h4l3-8 4 16 3-8h4'],
  link:['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2','M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
  scan:['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5','M7 9h10M7 13h10M7 17h5'],
  video:['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z','M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4'],
  play:['m9 5 11 7-11 7Z'],
  music:['M10 17V5l10-2v12','M10 17c0 3-6 4-6 1s6-4 6-1Zm10-2c0 3-6 4-6 1s6-4 6-1Z'],
  tv:['m7 2 3 4m7-4-3 4','M4 6h16a1 1 0 0 1 1 1v13H3V7a1 1 0 0 1 1-1Z','M8 11v3m8-3v3'],
  folder:['M3 7V5h6l2 3h10v12H3Z'],
  'folder-plus':['M3 7V5h6l2 3h10v12H3Z','M12 11v6m-3-3h6'],
  'file-plus':['M14 3H5v18h14V8Z','M14 3v5h5M12 11v6m-3-3h6'],
  globe:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z','M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
  shield:['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z'],
  wave:['M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4'],
  image:['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z','m3 16 6-6 6 6 3-3 3 3M15 7h.01'],
  trim:['M6 3v18M18 3v18M3 7h18M3 17h18'],
  key:['M14 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z','m12.5 11.5 8 8m-5-5 2-2m1 5 2-2'],
  sparkles:['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z','M20 2v4m-2-2h4']
};
function icon(name){
  const holder=document.createElement('span');holder.dataset.icon=name;holder.setAttribute('aria-hidden','true');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round',focusable:'false'}))svg.setAttribute(key,value);
  for(const d of iconPaths[name]||[]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}
  holder.append(svg);return holder;
}
document.querySelectorAll('[data-icon]').forEach(el=>{el.setAttribute('aria-hidden','true');el.append(icon(el.dataset.icon).firstChild);});
const state = {asset:null,busy:false,dead:false,doctor:null,route:'import',history:[],tab:'text',textSource:'speech',textSelections:{speech:false,ocr:false},content:null,contentHistory:[],report:null,failedLink:null,exportRequest:null};
const pending = new Map(); let sequence = 0;
function request(action, extra={}) {
  return new Promise((resolve,reject)=>{
    if(state.dead) return reject(Error('后端已退出，请重新打开应用。'));
    const id=++sequence; pending.set(id,{resolve,reject,action});
    try {(window.linkparsing ? window.linkparsing.postMessage : message => window.webkit.messageHandlers.desktop.postMessage(message))({id,action,...extra});}
    catch {pending.delete(id);reject(Error('未连接桌面后端。请通过 LinkParsing 应用启动。'));}
  });
}
window.desktopReply=reply=>{
  const waiting=pending.get(reply.id);if(!waiting)return;
  if(reply.account)paintAccount(reply.account);
  if(reply.event==='progress'){
    const stages={preparing:'提取音轨…',recognizing:'本地转写…',saving:'保存文字…'};
    if(waiting.action==='transcribe'&&stages[reply.data?.stage]){progressLabel=stages[reply.data.stage];paintProgress();}
    if(waiting.action==='preview'&&reply.data?.stage==='preparing_playback'){progressLabel='正在生成完整兼容播放副本，首次打开可能需要一些时间…';paintProgress();}
    if(waiting.action==='ocr'&&reply.data?.stage==='ocr'){progressLabel=`本地 OCR：${reply.data.done} / ${reply.data.total} 帧`;paintProgress();}
    return;
  }
  pending.delete(reply.id);
  if(reply.ok)waiting.resolve(reply.data);
  else{const error=Error(reply.error?.message||'操作失败。');error.code=reply.error?.code;waiting.reject(error);}
};
window.backendExited=()=>{
  state.dead=true;for(const {reject} of pending.values())reject(Error('后端已退出，请重新打开应用。'));pending.clear();
  setBusy(false);notice('后端已退出，请重新打开应用。已下载和导出的文件仍在所选目录中。');
  setHealth('后端离线','error');
};
if(window.linkparsing){
  const setup=$('asrSetup').querySelector('pre');
  if(setup)setup.textContent='安装 whisper.cpp，将 whisper-cli.exe 加入 PATH\npython scripts/setup-asr.py\n重新检查环境';
}
if(window.linkparsing){window.linkparsing.onReply(window.desktopReply);window.linkparsing.onExit(window.backendExited);}
function setHealth(label,status){$('health').textContent=label;$('check').dataset.status=status;$('check').title=`${label} · 重新检查`;$('check').setAttribute('aria-label',`${label}，重新检查环境`);}
function notice(message,success=false){
  $('noticeText').textContent=message;$('notice').classList.toggle('success',success);$('notice').hidden=false;
  $('retryDns').hidden=true;$('retryLogin').hidden=true;$('showResult').hidden=true;
}
function networkLabel(){
  $('networkMode').textContent=$('publicDns').checked?'公网 DNS':'系统 DNS';
}
function controls(){
  document.querySelectorAll('[data-lock]').forEach(el=>el.disabled=state.busy||state.dead);
  // Navigation is always available, including before import and while a task runs.
  $('navImport').disabled=false;$('navAsset').disabled=false;
  $('cancel').disabled=state.dead;
  $('extractEmpty').hidden=!!state.asset;$('assetContent').hidden=!state.asset;
  if(state.asset){
    const a=state.asset,unavailable={audioOn:!a.facts.has_audio,textOn:!hasSelectedText(),
      framesOn:!a.facts.has_video||a.watermark!=='verified_clean',originalOn:!a.facts.has_video||a.watermark!=='verified_clean'};
    for(const [id,blocked]of Object.entries(unavailable)){$(id).disabled=state.busy||state.dead||blocked;if(blocked)$(id).checked=false;}
  }
  $('frameTimes').disabled=state.busy||state.dead||!state.asset?.facts.has_video;
  $('textOutputLabel').textContent=state.textSource==='ocr'?'画面文字':'语音文字';
  $('textHint').hidden=hasSelectedText();
  $('ocr').disabled=state.busy||state.dead||!state.asset?.facts.has_video||!state.doctor?.ocr;
  $('transcribe').disabled=state.busy||state.dead||!state.asset?.facts.has_audio||!state.doctor?.asr;
  $('analysisTranscribe').disabled=$('transcribe').disabled;
  $('review').disabled=state.busy||state.dead||!state.asset?.facts.has_video;
  document.querySelectorAll('[data-action="transcribe"]').forEach(el=>el.disabled=$('transcribe').disabled);
  $('download').disabled=state.busy||state.dead||!state.doctor?.download_ready||!$('share').value.trim();$('resolve').disabled=$('download').disabled;
  $('clearShare').hidden=!$('share').value;
  for(const [toggle,format] of [['audioOn','audioFormat'],['textOn','textFormat'],['framesOn','imageFormat']])$(format).disabled=$(toggle).disabled;
  const count=['audioOn','textOn','framesOn','originalOn'].filter(id=>$(id).checked).length;
  $('outputCount').textContent=String(count);$('export').disabled=state.busy||state.dead||!count;
  $('previousText').disabled=state.busy||!state.content||state.content.offset===0;
  $('nextText').disabled=state.busy||!state.content||state.content.next_offset===null;
  $('confirmExport').disabled=state.busy||state.dead;
}
let progressLabel='',progressStart=0,progressTimer=null;
function paintProgress(){const seconds=Math.floor((Date.now()-progressStart)/1000);$('progressText').textContent=progressLabel+(seconds>=5?` 已用时 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'');}
function setBusy(busy,label='处理中…',cancellable=true){state.busy=busy;$('progress').hidden=!busy;clearInterval(progressTimer);progressLabel=label;progressStart=Date.now();paintProgress();if(busy)progressTimer=setInterval(paintProgress,1000);$('cancel').hidden=!cancellable;controls();}
async function run(action,label,extra={},cancellable=true){
  if(state.busy){notice('当前任务仍在运行。你可以浏览其他页面，等待完成或取消后再执行操作。');return null;}
  const startRoute=state.route;
  $('notice').hidden=true;setBusy(true,label,cancellable);
  try{
    const data=await request(action,extra);if(data.cancelled)return null;
    if(data.account)paintAccount(data.account);
    if(data.workspace)$('workspaceName').textContent=data.workspace;
    if(data.asset)setAsset(data.asset,state.route===startRoute);
    return data;
  }catch(error){
    if(error.code==='cancelled')notice('任务已取消。已完成的导出文件会保留。');
    else if(error.code==='authentication_required'&&['resolve','download'].includes(action)&&/https:\/\/(?:[\w-]+\.)?(?:douyin|iesdouyin)\.com\//i.test(extra.share||'')){
      state.failedLink={action,extra:{...extra}};
      notice('抖音需要登录或验证。完成官方页面登录后，可继续这次下载。');
      $('retryLogin').hidden=false;
    }
    else if(['dns_not_public','network_policy'].includes(error.code)&&['resolve','download'].includes(action)){
      state.failedLink={action,extra:{...extra}};
      if(!extra.public_dns){
        notice('系统 DNS 返回了非公网地址，可能是代理的 FakeIP。可使用公网 DNS 重试；这会向 Cloudflare 查询目标域名，不更改系统网络设置。');
        $('retryDns').hidden=false;
      }else notice('公网 DNS 已启用，但连接仍被网络策略拒绝。请检查代理的 DNS/路由设置；局域网地址与不允许的连接仍会被拦截。');
    }else notice(error.message.replace(/^platform operation failed: /,''));
    return null;
  }finally{setBusy(false);}
}
const routePages={import:'importPage',extract:'assetPage',agent:'agentPage',settings:'settingsPage'};
const routeNames={import:'导入',extract:'提取工作台',agent:'文字',settings:'设置'};
function navigate(route,push=true){
  if(!routePages[route])return;
  if(state.route!==route&&push)state.history.push(state.route);
  state.route=route;
  for(const [key,id]of Object.entries(routePages))$(id).hidden=key!==route;
  document.querySelectorAll('.rail [data-route]').forEach(b=>{const active=b.dataset.route===route;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('routeName').textContent=routeNames[route];$('back').disabled=!state.history.length;
  controls();window.scrollTo(0,0);if(route==='import')sizeShare();
}
$('back').onclick=()=>{const previous=state.history.pop();if(previous)navigate(previous,false);};
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-route]');if(nav){navigate(nav.dataset.route);return;}
  const tab=event.target.closest('[data-tab]');if(tab){selectTab(tab.dataset.tab);return;}
  const target=event.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(action==='import')importLocal();
  if(action==='analysis-import')importForAnalysis();
  if(action==='transcribe')transcribe();
  if(action==='open-export')openExport();
  if(action==='show-content')loadContent(0);
  if(action==='reveal')run('reveal','打开导出结果…',{},false);
});
document.addEventListener('keydown',event=>{if(event.altKey&&event.key==='ArrowLeft'){$('back').click();event.preventDefault();}});
function setAsset(asset,follow=true){
  const fresh=state.asset?.id!==asset.id;state.asset=asset;
  $('assetTitle').textContent=asset.title;$('currentTitle').textContent=asset.title;$('analysisSource').textContent=asset.title;
  $('assetFacts').textContent=[LPLogic.formatTime(asset.facts.duration_ms),asset.facts.has_video?'视频':'音频素材',asset.facts.has_audio?'含音轨':'无音轨'].join(' · ');
  $('sourceIcon').replaceChildren(icon(asset.facts.has_video?'video':'music').firstChild);
  $('reviewStatus').textContent=({unknown:'待审核',verified_clean:'已确认',watermarked:'有水印'})[asset.watermark]||'未通过';
  document.querySelector('.review-card').dataset.status=asset.watermark;
  $('transcriptStatus').textContent=asset.has_transcript?'已就绪':'未生成';$('textHint').hidden=hasSelectedText();
  $('transcribeLabel').textContent=asset.has_transcript?'重新生成':'生成文字';
  $('visualHint').textContent=asset.watermark==='verified_clean'?'画面与原视频可导出':asset.watermark==='watermarked'?'画面与原视频不可导出':'仅影响画面与原视频';$('currentCard').hidden=false;
  if(fresh){
    state.textSource=asset.has_transcript?'speech':asset.has_ocr?'ocr':'speech';
    state.textSelections={speech:!!asset.has_transcript,ocr:!!asset.has_ocr};
    state.tab=state.textSource==='ocr'?'ocr':'text';
    state.content=null;state.contentHistory=[];state.report=null;$('analysisEmpty').hidden=false;$('analysisResult').hidden=true;
    $('fullRange').checked=true;$('rangeInputs').hidden=true;$('rangeStart').value='0';$('rangeEnd').value=String(asset.facts.duration_ms/1000);
    $('audioOn').checked=asset.facts.has_audio;for(const id of ['textOn','framesOn','originalOn'])$(id).checked=false;
    $('textOn').checked=hasSelectedText();
    $('report').hidden=true;$('frameTimes').value='0';if(follow)navigate('extract');
  }
  renderTab();controls();renderContent();
}
$('newSource').onclick=()=>navigate('import');$('continue').onclick=()=>navigate('extract');
$('dismiss').onclick=()=>$('notice').hidden=true;
function sizeShare(){const field=$('share');if(!field.offsetWidth)return;field.style.height='auto';field.style.height=Math.min(140,Math.max(40,field.scrollHeight))+'px';}
$('share').oninput=()=>{$('resolved').hidden=true;state.failedLink=null;$('retryDns').hidden=true;$('retryLogin').hidden=true;sizeShare();controls();};
$('clearShare').onclick=()=>{$('share').value='';$('share').oninput();$('share').focus();};
$('share').addEventListener('keydown',event=>{if(!event.isComposing&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();$('download').click();}});
window.addEventListener('resize',sizeShare);
$('workspace').onclick=async()=>{const d=await run('workspace','选择素材保存目录…',{},false);if(d)$('workspaceName').textContent=d.workspace;};
$('cookies').onclick=async()=>{const d=await run('cookies','选择 Cookie 文件…',{},false);if(d)$('cookieName').textContent=d.cookie_name;};
$('clearCookies').onclick=async()=>{const d=await run('clear_cookies','清除 Cookie 选择…',{},false);if(d)$('cookieName').textContent=d.cookie_name;};
function paintAccount(account){
  $('accountStatus').textContent=({connected:'已连接 · 下载时自动使用',unverified:'已保存 · 下次下载时验证',expired:'需要重新登录或验证',disconnected:'未连接'})[account.state]||'未连接';
  $('loginDouyin').textContent=account.state==='disconnected'?'登录':'重新登录';
  $('removeLogin').hidden=!account.can_remove;
}
async function logIn(retry){
  const d=await run('login','请在官方页面完成登录…',{},false);
  if(!d)return;
  // A manual advanced-file selection must not override the just-completed login.
  $('cookieName').textContent='未选择';
  if(retry)await linkTask(retry.action,retry.extra);
  else notice('登录状态已保存，下次下载抖音链接时会自动验证并使用。',true);
}
$('loginDouyin').onclick=()=>logIn(null);
$('retryLogin').onclick=()=>{if(!state.busy&&state.failedLink)logIn({...state.failedLink,extra:{...state.failedLink.extra}});};
$('removeLogin').onclick=async()=>{const d=await run('remove_login','正在移除本机登录…',{},false);if(d)notice('已移除 LinkParse 中的抖音登录，个人浏览器不受影响。',true);};
$('publicDns').onchange=async()=>{networkLabel();try{await request('preferences',{public_dns:$('publicDns').checked});}catch(error){notice(error.message);}};
function linkArgs(){const share=$('share').value.trim();if(!share){notice('请粘贴一个分享链接。');return null;}return{share,public_dns:$('publicDns').checked};}
async function linkTask(action,args){
  const d=await run(action,action==='resolve'?'解析信息…':'下载素材…',args);
  if(d?.resolved){const v=d.resolved;$('resolvedTitle').textContent=v.title;$('resolvedDetail').textContent=[v.platform,LPLogic.formatTime(v.duration_ms),v.height?`${v.height}p`:''].filter(Boolean).join(' · ');$('resolved').hidden=false;}
  if(d){state.failedLink=null;if(action==='resolve'&&state.route!=='import')notice('链接解析成功。返回导入页可以查看信息并下载。',true);}
  return d;
}
$('resolve').onclick=()=>{const args=linkArgs();if(args)linkTask('resolve',args);};
$('download').onclick=()=>{const args=linkArgs();if(args)linkTask('download',args);};
$('retryDns').onclick=async()=>{
  if(!state.failedLink||state.busy)return;
  const retry=state.failedLink;$('publicDns').checked=true;networkLabel();
  try{await request('preferences',{public_dns:true});}catch(error){notice(error.message);return;}
  await linkTask(retry.action,{...retry.extra,public_dns:true});
};
function importLocal(){return run('import','选择本地素材并建立只读快照…');}
$('importLocal').onclick=importLocal;$('reopen').onclick=()=>run('reopen','正在打开已下载素材并校验完整性…');
const assetArgs=()=>({asset_id:state.asset?.id});
$('preview').onclick=()=>run('preview','校验素材并打开播放器…',assetArgs());
$('review').onclick=()=>run('review','等待人工审核结论…',assetArgs(),false);
async function importTranscript(){
  if(!state.asset){navigate('import');notice('请先导入对应的音视频素材，再导入文字。');return;}
  const d=await run('transcript','导入并校验已有文字…',assetArgs());
  if(d?.asset){state.textSelections.speech=true;state.content=null;state.contentHistory=[];await selectTab('text');}
}
function importForAnalysis(){if(!state.asset){navigate('import');notice('请先导入音视频，再在提取页导入对应文字。');}else importTranscript();}
$('transcript').onclick=$('analysisImport').onclick=importTranscript;
async function transcribe(){
  if(!state.asset){navigate('import');notice('请先下载或导入视频 / 音频。');return;}
  if(!state.doctor?.asr){navigate('settings');notice('本地转写引擎或模型尚未就绪，请按设置页说明安装后重新检查。');return;}
  const d=await run('transcribe','正在准备语音转写…',{...assetArgs(),language:$('asrLanguage').value});
  if(d?.asset){state.textSelections.speech=true;state.content=null;state.contentHistory=[];await selectTab('text');notice('文字已保存',true);}
}
$('transcribe').onclick=$('analysisTranscribe').onclick=transcribe;
$('reveal').onclick=()=>run('reveal','打开导出结果目录…',{},false);
$('revealSource').onclick=()=>run('reveal_source','打开源素材目录…',{},false);
$('fullRange').onchange=()=>$('rangeInputs').hidden=$('fullRange').checked;
for(const id of ['audioOn','originalOn'])$(id).onchange=controls;
$('framesOn').onchange=()=>{controls();if($('framesOn').checked)selectTab('frames');};
$('textOn').onchange=()=>{state.textSelections[state.textSource]=$('textOn').checked;controls();};
$('cancel').onclick=async()=>{$('cancel').disabled=true;progressLabel='正在取消并清理临时文件…';paintProgress();try{await request('cancel');}catch(error){notice(error.message);}};
function form(){return{full:$('fullRange').checked,start:$('rangeStart').value,end:$('rangeEnd').value,
  audio:$('audioOn').checked,audioFormat:$('audioFormat').value,text:$('textOn').checked,textFormat:$('textFormat').value,
  frames:$('framesOn').checked,imageFormat:$('imageFormat').value,times:$('frameTimes').value,original:$('originalOn').checked};}
function hasSelectedText(){return state.textSource==='ocr'?!!state.asset?.has_ocr:!!state.asset?.has_transcript;}
$('ocr').onclick=async()=>{
  try{
    const interval_ms=LPLogic.seconds($('ocrInterval').value);
    const range=$('fullRange').checked?null:{start_ms:LPLogic.seconds($('rangeStart').value),end_ms:LPLogic.seconds($('rangeEnd').value)};
    const d=await run('ocr','正在准备画面识别…',{...assetArgs(),range,interval_ms,language:$('ocrLanguage').value});
    if(d?.asset){state.textSelections.ocr=true;state.content=null;state.contentHistory=[];await selectTab('ocr');notice('画面文字已保存',true);}
  }catch(error){notice(error.message);}
};
const outputNames={audio:'音频',text:'文字',frames:'画面',original:'原视频'};
function openExport(){
  if(!state.asset){navigate('import');notice('请先导入素材，之后可选择导出内容。');return;}
  if(state.busy){notice('请等待当前任务完成或取消后再导出。');return;}
  try{state.exportRequest=LPLogic.makeRequest(form(),{...state.asset,has_transcript:hasSelectedText()});}catch(error){navigate('extract');notice(error.message);return;}
  $('exportSource').textContent=state.asset.title+($('textOn').checked?(state.textSource==='ocr'?' · 画面文字（采样时间轴）':' · 语音文字'):'');$('exportSummary').replaceChildren();
  for(const output of state.exportRequest.outputs){const li=document.createElement('li');const detail=output.kind==='original'?`完整 · ${LPLogic.formatTime(state.asset.facts.duration_ms)}`:output.format?.toUpperCase();li.append(icon(({audio:'music',text:'text',frames:'image',original:'video'})[output.kind]),document.createTextNode(`${outputNames[output.kind]} · ${detail}${output.timestamps_ms?' · '+output.timestamps_ms.length+' 帧':''}`));$('exportSummary').append(li);}
  const range=state.exportRequest.range;$('exportRange').textContent=range?`片段范围：${range.start_ms/1000} — ${range.end_ms/1000} 秒`:'范围：完整时长';
  $('exportDialog').showModal();
}
$('export').onclick=$('openExport').onclick=openExport;
$('closeExport').onclick=()=>$('exportDialog').close();
$('editExport').onclick=()=>{$('exportDialog').close();navigate('extract');};
$('exportDialog').addEventListener('close',()=>{state.exportRequest=null;});
function showReport(report){
  state.report=report;$('report').hidden=false;
  const reasons={watermark_not_verified:'未通过无水印审核',no_audio:'素材没有音轨',no_video:'素材没有画面'};
  $('reportTitle').textContent=({completed:'导出完成',partial:'部分完成',failed:'没有成功导出的内容',cancelled:'导出已取消'})[report.status]||'导出结果';$('reportItems').replaceChildren();
  for(const o of report.outputs){const li=document.createElement('li');li.className=o.status==='completed'?'completed':'failed';
    const result=o.status==='completed'?`完成 · ${o.files.length} 个文件`:o.status==='blocked'?`已阻断 · ${reasons[o.reason]||o.reason}`:o.status==='cancelled'?'已取消':`失败 · ${o.error}`;
    li.textContent=`${outputNames[o.kind]||o.kind}：${result}`;$('reportItems').append(li);}
  $('reveal').hidden=!report.can_reveal;renderContent();
  notice($('reportTitle').textContent,report.status==='completed');$('showResult').hidden=false;
}
$('confirmExport').onclick=async()=>{
  const exportRequest=state.exportRequest;$('exportDialog').close();if(!exportRequest)return;
  $('report').hidden=true;const d=await run('export','正在导出所选内容…',{...assetArgs(),request:exportRequest,text_source:state.textSource});if(d?.report)showReport(d.report);
};
$('showResult').onclick=()=>{navigate('extract');$('report').scrollIntoView({behavior:'smooth',block:'center'});};
function paragraph(text){const p=document.createElement('p');p.textContent=text;return p;}
function actionButton(text,action){const b=document.createElement('button');b.textContent=text;b.dataset.action=action;return b;}
function renderContent(){
  const panel=$('contentPanel');panel.replaceChildren();
  if(state.tab==='frames'){
    const frames=state.report?.outputs.find(o=>o.kind==='frames');
    if(frames?.status==='completed'){panel.append(paragraph(`已成功导出 ${frames.files.length} 张画面。`),actionButton('查看已导出画面','reveal'));}
    else panel.append(paragraph(state.asset?.facts.has_video?'尚无已导出的画面':'素材没有画面'));
    return;
  }
  if(!hasSelectedText()){
    const empty=document.createElement('div');empty.className='content-empty';
    const ocr=state.tab==='ocr',available=ocr?state.asset?.facts.has_video:state.asset?.facts.has_audio;
    const engine=ocr?state.doctor?.ocr:state.doctor?.asr;
    empty.append(icon(ocr?'scan':'wave'),paragraph(available?(ocr?'尚无画面文字':'尚无语音文字'):(ocr?'素材没有画面':'无音轨 · 可导入文字')));
    if(available&&!engine){const button=document.createElement('button');button.textContent='设置识别引擎';button.dataset.route='settings';empty.append(button);}
    panel.append(empty);controls();return;
  }
  if(!state.content){panel.append(actionButton('查看文字','show-content'));return;}
  for(const s of state.content.segments){const row=document.createElement('div');row.className='transcript-row';const time=document.createElement('time');time.textContent=LPLogic.formatTime(s.start_ms,true);row.append(time,paragraph(s.text+(s.truncated?'\n［此段预览已截断，导出保留完整文字］':'')));panel.append(row);}
  const button=document.createElement('button');button.append(document.createTextNode('全部文字'),icon('arrow-right'));button.dataset.route='agent';panel.append(button);
}
function renderTab(){
  document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===state.tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;if(active)$('contentPanel').setAttribute('aria-labelledby',b.id);});
  $('speechTools').hidden=state.tab!=='text';$('ocrTools').hidden=state.tab!=='ocr';$('ocrHint').hidden=state.tab!=='ocr';$('frameSettings').hidden=state.tab!=='frames';
}
async function selectTab(tab){
  if(state.busy||state.dead||!['text','ocr','frames'].includes(tab))return;
  state.tab=tab;
  const source=tab==='ocr'?'ocr':tab==='text'?'speech':state.textSource;
  if(source!==state.textSource){state.textSource=source;state.content=null;state.contentHistory=[];$('analysisEmpty').hidden=false;$('analysisResult').hidden=true;}
  $('textOn').checked=hasSelectedText()&&state.textSelections[source];
  renderTab();controls();renderContent();
  if(tab!=='frames'&&hasSelectedText()&&!state.content)await loadContent(0);
}
document.querySelector('.result-tabs').addEventListener('keydown',event=>{
  const tabs=[...document.querySelectorAll('[data-tab]')],index=tabs.indexOf(document.activeElement);if(index<0)return;
  const next=({ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1})[event.key];
  if(next!==undefined){event.preventDefault();tabs[next].focus();selectTab(tabs[next].dataset.tab);}
});
function renderAnalysis(){
  const content=state.content;if(!content)return;
  $('analysisEmpty').hidden=true;$('analysisResult').hidden=false;$('analysisStats').replaceChildren();
  for(const [number,label]of [[content.total,'文字段落'],[content.characters,'文字字符'],[LPLogic.formatTime(state.asset.facts.duration_ms),'素材时长']]){
    const box=document.createElement('div'),strong=document.createElement('strong');strong.textContent=String(number);box.append(strong,document.createTextNode(label));$('analysisStats').append(box);
  }
  $('analysisItems').replaceChildren();
  for(const s of content.segments){const article=document.createElement('article');if($('analysisMode').value==='timeline'){const time=document.createElement('time');time.textContent=`${LPLogic.formatTime(s.start_ms,true)} — ${LPLogic.formatTime(s.end_ms,true)}`;article.append(time);}article.append(paragraph(s.text+(s.truncated?'\n［长段落仅显示预览，导出时保留全文］':'')));$('analysisItems').append(article);}
  $('textPage').textContent=`${content.offset+1}–${content.offset+content.segments.length} / ${content.total} 段`;controls();
}
async function loadContent(offset=0,remember=true){
  if(!hasSelectedText()){notice('所选来源尚无文字，请先生成或切换文字来源。');return;}
  const source=state.textSource,assetId=state.asset.id;
  const d=await run('content','正在整理已有文字时间轴…',{...assetArgs(),offset,text_source:source});if(d?.content&&state.textSource===source&&state.asset?.id===assetId){if(offset===0)state.contentHistory=[];else if(remember&&state.content)state.contentHistory.push(state.content.offset);state.content=d.content;renderContent();renderAnalysis();}
}
$('runAnalysis').onclick=()=>hasSelectedText()?loadContent(0):transcribe();$('analysisMode').onchange=renderAnalysis;
$('previousText').onclick=()=>loadContent(state.contentHistory.pop()??0,false);$('nextText').onclick=()=>{if(state.content?.next_offset!==null)loadContent(state.content.next_offset);};
async function doctor(){
  const d=await run('doctor','正在检查 FFmpeg 与下载依赖…');if(!d)return;state.doctor=d;
  setHealth(d.download_ready?'后端已连接':'下载依赖不可用',d.download_ready?'ready':'error');
  if(d.preferences){$('publicDns').checked=d.preferences.public_dns;$('workspaceName').textContent=d.preferences.workspace;networkLabel();}
  $('ocrHealth').textContent=d.ocr?'已就绪':(window.linkparsing?'Windows 暂不支持':'未就绪');
  $('asrHealth').textContent=d.asr?'已就绪':'未就绪';$('asrSetup').hidden=d.asr;
  if(!d.download_ready)notice(d.download_error||'下载依赖未就绪，本地导入仍可使用。');controls();
}
$('check').onclick=doctor;navigate('import',false);doctor();
