(function(root){
 const dictionary={
 '从今天遇见的第一个词开始。':['Begin with the first word you meet today.','今日出会った最初の言葉から。'],
 '记录今天的新词 ↗':['Add a word today ↗','今日の言葉を記録 ↗'],
 '一个词，一张慢慢生长的地图。':['One word. A map that grows with you.','ひとつの言葉から、広がる地図。'],
 '添加第一个词 ＋':['Add your first word ＋','最初の言葉を追加 ＋'],
 '删除':['Delete','削除'],'删除当前词网':['Delete this word map','この単語マップを削除'],
 '删除「{word}」及其子连接？':['Delete “{word}” and its branches?','「{word}」とその接続を削除しますか？'],
 '已保存在本机':['Saved locally','このデバイスに保存済み'],
 '正在保存…':['Saving…','保存中…'],
 '保存失败，请重试；请勿退出':['Save failed. Retry before quitting.','保存できません。終了前に再試行してください。'],

 '外观':['Appearance','外観'],'黑白':['Mono','モノクロ'],'半透明':['Glass','半透明'],
 '界面语言':['Interface language','表示言語'],'母语释义':['Native-language definition','母語での意味'],'外语释义':['Foreign-language definition','外国語での意味'],
 '输入母语释义…':['Write a definition in your language…','母語で意味を入力…'],'输入外语释义…':['Write a definition in the other language…','外国語で意味を入力…'],
 '收起母语释义':['Hide native-language definition','母語の意味を閉じる'],'收起外语释义':['Hide foreign-language definition','外国語の意味を閉じる'],
 '收起释义':['Hide definitions','意味を閉じる'],'新词':['New word','単語を追加'],'连接单词':['Link word','単語をつなぐ'],
 '选中一个词，继续延伸':['Select a word to continue','語を選んでつなぐ'],'延伸「{word}」':['Link “{word}”','「{word}」をつなぐ'],
 '记录查询':['History','記録'],'打开记录查询':['Open history','記録を開く'],'关闭记录查询':['Close history','記録を閉じる'],
 '月':['Month','月'],'年':['Year','年'],'上一月':['Previous month','前月'],'下一月':['Next month','翌月'],'上一年':['Previous year','前年'],'下一年':['Next year','翌年'],
 '查看年份':['Choose year','年を選ぶ'],'查看月份':['Choose month','月を選ぶ'],'查询层级':['History period','表示期間'],'横向浏览记录与曲线':['Scroll through records and chart','記録と曲線を横にスクロール'],
 '按月查看每日记录':['Daily records for this month','月ごとの日別記録'],'按年查看每月记录':['Monthly records for this year','年ごとの月別記録'],
 '每日记录词数曲线':['Daily word count','日ごとの単語数'],'每月累计记录词数曲线':['Monthly word count','月ごとの単語数'],
 '{words} 个词 · {days} 个记录日':['{words} words · {days} days','{words} 語 · {days} 日'],
 '始于 {date}':['Since {date}','{date} から'],'首次记录之前':['Before the first record','最初の記録より前'],'尚未到来':['Future date','未来の日付'],'{n} 个单词':['{n} words','{n} 語'],
 '更早的日期':['Earlier dates','前の日付'],'更晚的日期':['Later dates','次の日付'],'回到最近 ↗':['Latest ↗','最新へ ↗'],
 '返回时间轴':['Back to timeline','時間軸に戻る'],'时间轴':['Timeline','時間軸'],'时间箭头':['Time arrow','時間の矢印'],'时间箭头首页':['Timeline home','時間軸ホーム'],
 '拖动浏览日期':['Drag to browse dates','ドラッグして日付を移動'],'单击预览 · 双击进入':['Click to preview · double-click to open','クリックでプレビュー · ダブルクリックで開く'],
 '{n} 词网':['{n} maps','{n} マップ'],'{maps} 词网 · {words} 单词':['{maps} maps · {words} words','{maps} マップ · {words} 語'],
 '尚无记录':['No records yet','記録はありません'],'收起候选':['Close word preview','単語のプレビューを閉じる'],'进入当天画布':['Open this day','この日のキャンバスへ'],
 '搜索单词':['Search words','単語を検索'],'搜索所有日期的单词':['Search across all dates','すべての日付から検索'],'搜索所有单词':['Search all words','すべての単語を検索'],
 '查找已记录单词':['Find saved words','記録した単語を探す'],'一个单词，一段来处。':['Find a word or a date.','単語や日付で検索。'],'关闭搜索':['Close search','検索を閉じる'],
 '所有日期':['All dates','すべての日付'],'单词搜索结果':['Word search results','単語の検索結果'],'最近记录':['Recent words','最近の記録'],'{n} 个结果':['{n} results','{n} 件'],
 '独立词网':['Root word','独立したマップ'],'来自 {word}':['From {word}','「{word}」から'],'还没有这个词':['No matching words','一致する単語がありません'],
 '↑ ↓ 选择':['↑ ↓ Select','↑ ↓ 選択'],'↵ 定位到词网':['↵ Open word map','↵ マップへ移動'],
 '展开新词输入栏':['Add a word','単語を追加'],'新单词':['New word','新しい単語'],'遇见了哪个新词？':['A new word…','新しい単語…'],'插入到空白锚点':['Add at a free position','空いた位置に追加'],'收起输入栏':['Close word input','入力欄を閉じる'],'新词起点':['New word position','新しい単語の位置'],
 '选择模式':['Select','選択'],'拖动画布':['Pan canvas','キャンバスを移動'],'缩小':['Zoom out','縮小'],'放大':['Zoom in','拡大'],'查看全部词网':['Fit all maps','すべてのマップを表示'],
 '可拖动和缩放的无限画布':['Infinite canvas: drag to pan, zoom to explore','ドラッグとズームができる無限キャンバス'],'当天的全部单词网络':['Word maps for this day','この日の単語マップ'],
 '查看 {word}':['Open {word}','「{word}」を開く'],'展开 {word} 的子连接':['Expand links from {word}','「{word}」のリンクを展開'],'隐藏 {word} 的子连接':['Collapse links from {word}','「{word}」のリンクを折りたたむ'],
 '点击单词展开释义':['Select a word for definitions','単語を選ぶと意味を表示'],'从一个词，走向另一个词':['Follow a word to the next','単語から次の単語へ'],
 '收起外观栏':['Hide appearance controls','外観設定を閉じる'],'展开外观栏':['Show appearance controls','外観設定を開く'],'视觉款式':['Appearance style','表示スタイル'],
 '示例数据 · 未连接账号':['Demo · local only','デモ · ローカル保存'],'拖动平移 · ⌘/Ctrl + 滚轮缩放':['Drag to pan · ⌘/Ctrl + scroll to zoom','ドラッグで移動 · ⌘/Ctrl + スクロールでズーム'],
 '导出两款 DesignDoc':['Export both designs','両デザインを出力'],'本机存储已满，请保留当前页面':['Local storage is full. Keep this page open.','保存領域が不足しています。このページを開いたままにしてください。'],
 '已落在新锚点，原有词网保持原位':['Word added at a free position','空いた位置に単語を追加しました'],'已连接 {word}':['Linked {word}','「{word}」をつなぎました'],
 '生成中…':['Exporting…','出力中…'],'两款共 16 张画板已生成':['Exported 16 artboards','16 枚のアートボードを出力しました'],'保存失败':['Save failed','保存できませんでした'],'DesignDoc 文档校验失败':['Design validation failed','デザインの検証に失敗しました'],
 '语言学习交互原型':['Language learning prototype','言語学習プロトタイプ']
 };
 let lang='zh';try{lang=AppStorage.getItem('languagemap-ui-language')||'zh';}catch{}if(!['zh','en','ja'].includes(lang))lang='zh';
 function tr(key,vars={}){const text=lang==='zh'?key:dictionary[key]?.[lang==='en'?0:1]||key;const result=text.replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'');return lang==='en'?result.replace(/\b1 maps\b/g,'1 map').replace(/\b1 words\b/g,'1 word').replace(/\b1 days\b/g,'1 day').replace(/\b1 results\b/g,'1 result'):result;}
 const month=(n,short=false)=>new Intl.DateTimeFormat({zh:'zh-CN',en:'en-US',ja:'ja-JP'}[lang],{month:short?'short':'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,n-1,1)));
 const weekdays=day=>new Intl.DateTimeFormat({zh:'zh-CN',en:'en-US',ja:'ja-JP'}[lang],{weekday:'short',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
 const textKeys=new WeakMap(),attrKeys=new WeakMap();
 function apply(scope=document){
  document.documentElement.lang=lang==='zh'?'zh-CN':lang;
  const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);let n;
  while(n=walker.nextNode()){
   if(n.parentElement?.closest('script,style,option,[contenteditable],.word-label,#candidate-list,#search-results,.day,.period-strip,#year-heading,#timeline-month,#toast'))continue;
   const key=textKeys.get(n)||n.textContent.trim();if(!dictionary[key])continue;textKeys.set(n,key);n.textContent=tr(key);
  }
  for(const el of scope.querySelectorAll('[aria-label],[placeholder],[title]')){
   if(el.matches('#toggle-review,#prev-year,#next-year')||el.closest('.day,.word,.period-strip,#search-results'))continue;
   const keys=attrKeys.get(el)||{};for(const attr of ['aria-label','placeholder','title']){const key=keys[attr]||el.getAttribute(attr);if(dictionary[key]){keys[attr]=key;el.setAttribute(attr,tr(key));}}attrKeys.set(el,keys);
  }
  document.querySelector('#native-editor').dataset.placeholder=tr('输入母语释义…');document.querySelector('#foreign-editor').dataset.placeholder=tr('输入外语释义…');
 }
 const api={tr,month,weekdays,apply,get language(){return lang},setLanguage(v){lang=['zh','en','ja'].includes(v)?v:'zh';try{AppStorage.setItem('languagemap-ui-language',lang);}catch{}}};root.AppLocale=api;
})(globalThis);
