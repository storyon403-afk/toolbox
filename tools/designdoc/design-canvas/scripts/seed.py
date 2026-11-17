from pathlib import Path
import json, re, xml.etree.ElementTree as ET
root = Path(__file__).resolve().parent.parent
legacy = (root/'assets/folio-source.js').read_text()
start = legacy.index('const el=')
end = len(legacy)
base = legacy[start:end].replace('function seed()', 'function folioSeed()')
boards = []
for i, name in enumerate(['01-quick-search','02-command-menu','03-appearance-settings']):
    svg = ET.fromstring((root.parent/'figma-reference-draft'/f'{name}.svg').read_text())
    elements = []
    for n in svg.iter():
        tag = n.tag.split('}')[-1]; a = n.attrib
        if tag not in ('rect','text','circle','path'): continue
        fill = a.get('fill','#000000'); opacity = 1
        if fill.startswith('url'): fill = '#19283e'
        if len(fill)==9:
            opacity = int(fill[-2:],16)/255; fill=fill[:7]
        x=float(a.get('x',0)); y=float(a.get('y',0))
        e = {'type': 'rect', 'x':x, 'y':y, 'w':float(a.get('width',1)), 'h':float(a.get('height',1)), 'fill':fill, 'opacity':opacity, 'radius':float(a.get('rx',0)), 'stroke':a.get('stroke','#000000'), 'strokeWidth':float(a.get('stroke-width', 1 if 'stroke' in a else 0))}
        if tag=='text':
            size=float(a.get('font-size',16)); s=n.text or ''
            e.update(type='text',y=y-size*1.08, w=min(1440-x,max(size*2,sum(size*(1 if ord(c)>255 else .62) for c in s)+10)), h=size*1.45,size=size,text=s,weight=int(a.get('font-weight',400)),name=s[:24])
        if tag=='circle':
            r=float(a['r']);e.update(type='ellipse',x=float(a['cx'])-r,y=float(a['cy'])-r,w=r*2,h=r*2)
        if tag=='path':
            nums=re.findall(r'[\d.]+',a['d']); x,y,x2=map(float,nums)
            e.update(x=x,y=y,w=x2-x,h=1,fill=a.get('stroke','#303441'),strokeWidth=0)
        elements.append(e)
    boards.append({'name':['Orbit / 快速搜索','Orbit / 指令菜单','Orbit / 外观设置'][i],'x':i*1560,'y':0,'w':1440,'h':1000,'bg':'#10131b','elements':elements})
js = "(function(){\nconst C=FormaCore,uid=C.id;\n"+base+'\nconst orbitData='+json.dumps(boards,ensure_ascii=False,separators=(',',':'))+';\n'
js += '''
function orbit(){
  const bs=orbitData.map(b=>({...C.clone(b),id:C.id(),elements:b.elements.map(e=>C.make(e.type,e.x,e.y,e.w,e.h,e))}));
  const a=bs[0].elements.find(e=>e.text==='搜索应用、文件和指令…');if(a)a.link=bs[1].id;
  for(const e of bs[1].elements)if(['切换深色模式','更改强调色','调整字体大小','切换紧凑布局'].includes(e.text))e.link=bs[2].id;
  const close=bs[2].elements.find(e=>e.text==='×');if(close)close.link=bs[0].id;
  return bs;
}
function seed(){
  const d=C.migrate(folioSeed());d.title='Folio / 个人工作空间';
  d.tokens=[{id:C.id(),name:'品牌 / 鼠尾草',value:'#647b56'},{id:C.id(),name:'背景 / 纸白',value:'#f7f8f2'},{id:C.id(),name:'文字 / 墨绿',value:'#2b3529'},{id:C.id(),name:'Orbit / 紫藤',value:'#a395db'}];
  d.boards.forEach(b=>b.elements.forEach(e=>{const t=d.tokens.find(t=>t.value===e.fill);if(t)e.fillToken=t.id}));
  const m=d.boards[2];m.elements.find(e=>e.text==='开始我的创作  ↗').link=d.boards[0].id;
  const button=m.elements.filter(e=>e.y>=499&&e.y<550);C.component(d,button,'按钮 / 品牌主操作');
  return d;
}
globalThis.FormaSeeds={seed,orbit};
})();
'''
(root/'src/seed.js').write_text(js)
