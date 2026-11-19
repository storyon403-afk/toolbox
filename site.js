// Presentation only. Tool interfaces and user data are not loaded by this page.
(() => {
  const copy = {
    'zh-CN': {
      skip: '跳至工具展示', navigation: '页面导航', language: '语言', explore: '看看工具',
      tagline: '一些小工具，说不定对你有用。', heading: '遇到这些小事时。', tools: '工具',
      preview: '界面预览', guide: '使用说明 ↗', start: '需要哪个，就用哪个。',
      independent: '每个工具都可以单独用，Toolbox 把它们放在一起。', readme: '查看使用与源码',
      status: '本地构建可用，公开下载还在准备中。', back: '返回顶部 ↑',
      description: '一些小工具，说不定对你有用。改文档、画界面、记生词，或是把视频里的内容取出来。',
      items: [
        ['文档批注', '修改意见，对得上原文。', '把文档发给别人看，让每条批注留在对应的文字旁边。', 'RD 文档阅读与批注界面'],
        ['界面原型', '有个想法，先画出来。', '画出界面，连成可以点击的原型。动手开发前，先走一遍。', 'DesignDoc 画板、图层与界面设计预览'],
        ['生词记录', '今天学的词，下次找得到。', '自己写下释义，连起相关词语。按日期翻看，也能直接搜索。', 'LanguageMap 生词时间轴与词语连接预览'],
        ['视频提取', '视频里的内容，拿出来用。', '把讲话转成文字，提取画面文字、音频或截图，方便整理和创作。', 'LinkParsing 视频与文字提取界面']
      ]
    },
    en: {
      skip: 'Skip to the tools', navigation: 'Page navigation', language: 'Language', explore: 'Explore the tools',
      tagline: 'A few small tools. Maybe one is useful to you.', heading: 'For these little things.', tools: 'Tools',
      preview: 'Interface preview', guide: 'How to use it ↗', start: 'Pick what you need.',
      independent: 'Each tool works on its own. Toolbox brings them together.', readme: 'Usage & source',
      status: 'Local builds available. Public downloads are on the way.', back: 'Back to top ↑',
      description: 'A few small tools for reviewing documents, sketching interfaces, remembering words and extracting video content.',
      items: [
        ['Document feedback', 'Keep feedback beside the words.', 'Share a document for review. Every comment stays beside the text it refers to.', 'RD document reading and annotation interface'],
        ['Interface sketches', 'Have an idea? Sketch it out.', 'Draw the screens and connect them. Click through your idea before you build it.', 'DesignDoc artboards, layers and interface preview'],
        ['New words', 'Find the words you learned.', 'Add your own definitions, connect related words, and look back by date or search.', 'LanguageMap vocabulary timeline and word connections'],
        ['Video extracts', 'Take useful things out of a video.', 'Turn speech into text. Extract on-screen words, audio or still frames for your next project.', 'LinkParsing media and text extraction interface']
      ]
    },
    ja: {
      skip: 'ツール紹介へ', navigation: 'ページナビゲーション', language: '言語', explore: 'ツールを見る',
      tagline: '小さなツールたち。何かの役に立つかも。', heading: 'こんなときに。', tools: 'ツール',
      preview: '画面プレビュー', guide: '使い方 ↗', start: '必要なものだけ、どうぞ。',
      independent: 'どのツールも単体で使えます。Toolbox は、それらをひとつにまとめます。', readme: '使い方・ソースコード',
      status: 'ローカルビルドを利用できます。一般公開のダウンロードは準備中です。', back: '先頭に戻る ↑',
      description: '文書へのコメント、画面の試作、単語の記録、動画からの素材抽出。何かの役に立つかもしれない、小さなツールたち。',
      items: [
        ['文書にコメント', 'コメントは、該当する文章のそばに。', '文書を共有して読んでもらう。修正の提案が、どの文章へのものかすぐにわかります。', 'RD の文書閲覧とコメント画面'],
        ['画面を試作', 'アイデアを、まず画面に。', '画面を描いて、クリックできる試作品に。開発の前に、操作の流れを確かめられます。', 'DesignDoc のアートボードとレイヤーのプレビュー'],
        ['単語を記録', '覚えた単語を、また見つける。', '自分で意味を書き、関連する単語をつなぐ。日付で振り返ったり、検索したりできます。', 'LanguageMap の単語タイムラインとつながりのプレビュー'],
        ['動画から抽出', '動画の中身を、取り出して使う。', '話し声を文字に。画面の文字、音声、静止画も取り出して、整理や制作に使えます。', 'LinkParsing の動画とテキスト抽出画面']
      ]
    }
  };
  const tools = [
    { id: 'rd', name: 'RD · DocsBridge', guides: { 'zh-CN': 'https://github.com/storyon403-afk/toolbox/blob/main/tools/rd/README.zh-CN.md', en: 'https://github.com/storyon403-afk/toolbox/blob/main/tools/rd/README.md', ja: 'https://github.com/storyon403-afk/toolbox/blob/main/tools/rd/README.ja.md' } },
    { id: 'designdoc', name: 'DesignDoc · Forma', guide: 'https://github.com/storyon403-afk/toolbox/blob/main/tools/designdoc/design-canvas/README.md' },
    { id: 'languagemap', name: 'LanguageMap', guide: 'https://github.com/storyon403-afk/toolbox/blob/main/tools/languagemap/README.md' },
    { id: 'linkparsing', name: 'LinkParsing · LinkParse', guides: { 'zh-CN': 'https://github.com/storyon403-afk/toolbox/blob/main/tools/linkparsing/README.md', en: 'https://github.com/storyon403-afk/toolbox/blob/main/tools/linkparsing/README.en.md', ja: 'https://github.com/storyon403-afk/toolbox/blob/main/tools/linkparsing/README.ja.md' } }
  ];
  const $ = id => document.getElementById(id);
  const tabs = [...document.querySelectorAll('[data-tool]')];
  let language = 'zh-CN';
  let active = 0;
  try {
    const saved = localStorage.getItem('toolbox-website-language');
    if (Object.hasOwn(copy, saved)) language = saved;
  } catch { /* The showcase also works without browser storage. */ }
  const requested = new URLSearchParams(location.search).get('lang');
  if (Object.hasOwn(copy, requested)) language = requested;

  function renderTool() {
    const text = copy[language];
    const tool = tools[active];
    const item = text.items[active];
    tabs.forEach((tab, index) => {
      tab.textContent = text.items[index][0];
      tab.setAttribute('aria-selected', String(index === active));
      tab.tabIndex = index === active ? 0 : -1;
    });
    $('tool-panel').setAttribute('aria-labelledby', `tab-${tool.id}`);
    $('counter').textContent = `${String(active + 1).padStart(2, '0')} / 04`;
    $('tool-name').textContent = tool.name;
    $('tool-title').textContent = item[1];
    $('tool-description').textContent = item[2];
    $('tool-image').src = `media/${tool.id}.webp`;
    $('tool-image').alt = item[3];
    $('tool-guide').href = tool.guides?.[language] ?? tool.guide;
    $('tool-guide').textContent = text.guide;
  }

  function translate() {
    const text = copy[language];
    document.documentElement.lang = language;
    document.title = `Toolbox · ${text.tagline}`;
    document.querySelector('meta[name="description"]').content = text.description;
    document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = text[el.dataset.copy]; });
    document.querySelectorAll('[data-label]').forEach(el => { el.setAttribute('aria-label', text[el.dataset.label]); });
    $('language').value = language;
    $('readme-link').href = language === 'zh-CN' ? 'https://github.com/storyon403-afk/toolbox/blob/main/README.zh-CN.md' : 'https://github.com/storyon403-afk/toolbox/blob/main/README.md';
    renderTool();
  }

  tabs.forEach((tab, index) => tab.addEventListener('click', () => { active = index; renderTool(); }));
  $('tabs').addEventListener('keydown', event => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    if (event.key === 'ArrowRight') active = (index + 1) % tools.length;
    else if (event.key === 'ArrowLeft') active = (index + tools.length - 1) % tools.length;
    else if (event.key === 'Home') active = 0;
    else if (event.key === 'End') active = tools.length - 1;
    else return;
    event.preventDefault();
    renderTool();
    tabs[active].focus();
  });
  $('language').addEventListener('change', event => {
    language = event.target.value;
    try { localStorage.setItem('toolbox-website-language', language); } catch {}
    try {
      const url = new URL(location.href);
      url.searchParams.set('lang', language);
      history.replaceState(null, '', url);
    } catch {}
    translate();
  });
  translate();
})();
