import hashlib,json,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
names=['门店卖机话术知识库.docx','05_终端购机政策汇总 - 副本.docx','10_升档促销产品细则.docx','05_终端购机政策汇总.docx','09_通过产品拉动融合升档.docx','06_常见业务办理与售后.docx','08_业务知识考核题库.docx','01_开卡入网开户流程 - 副本.docx','00_知识库最终版说明 - 副本.docx','01_开卡入网开户流程.docx','00_知识库最终版说明.docx','02_融合套餐入网开户流程 - 副本.docx','03_套餐资费与宽带资料 - 副本.docx','02_融合套餐入网开户流程.docx','03_套餐资费与宽带资料.docx','移动业务知识库_卡片08-11合辑.docx','04_校园青春卡资费 - 副本.docx','11_顾客场景问答话术.docx','04_校园青春卡资费.docx']
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def text(el):
    return ''.join((e.text or '') if e.tag==W+'t' else ('\t' if e.tag==W+'tab' else '\n') for e in el.iter() if e.tag in [W+'t',W+'tab',W+'br']).strip()
rows=[]
for name in names:
    p=Path('C:/Users/A/Desktop')/name
    if not p.exists(): rows.append({'name':name,'error':'missing'});continue
    raw=p.read_bytes();blocks=[]
    with zipfile.ZipFile(p) as z:
        root=ET.fromstring(z.read('word/document.xml'));body=root.find(W+'body')
        for index,el in enumerate(body,1):
            if el.tag==W+'p':
                value=text(el)
                if value:
                    st=el.find(W+'pPr/'+W+'pStyle')
                    blocks.append({'id':'p'+str(index),'kind':'paragraph','style':st.get(W+'val') if st is not None else '', 'text':value})
            elif el.tag==W+'tbl':
                table=[[text(cell) for cell in tr.findall(W+'tc')] for tr in el.findall(W+'tr')]
                blocks.append({'id':'t'+str(index),'kind':'table','rows':table,'text':'\n'.join(' | '.join(cells) for cells in table)})
        extras=[]
        for extra in ['word/footnotes.xml','word/endnotes.xml']:
            if extra in z.namelist():
                value=text(ET.fromstring(z.read(extra)))
                if value: extras.append({'id':extra,'kind':'note','text':value})
        blocks.extend(extras)
        images=[info.filename for info in z.infolist() if info.filename.startswith('word/media/')]
    plain='\n'.join(b['text'] for b in blocks)
    rows.append({'name':name,'sha256':hashlib.sha256(raw).hexdigest(),'contentSha256':hashlib.sha256(plain.encode('utf-8')).hexdigest(),'characters':len(plain),'blocks':blocks,'images':images})
out=Path('data/knowledge-imports/mobile-20261009');out.mkdir(parents=True,exist_ok=True)
(out/'extracted.json').write_text(json.dumps({'asOf':'2026-10-09','documents':rows},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{k:r.get(k) for k in ['name','error','characters','sha256','contentSha256','images']} for r in rows],ensure_ascii=False,indent=2))
