import pathlib,re
root=pathlib.Path.cwd()
p=root/"web/assistant.html";s=p.read_text(encoding="utf-8")
match=re.search(r'<form id="ask">.*?</form>',s)
if not match: raise ValueError("ask form not found")
old=match.group()
language=re.search(r'<details id="assistant-reply-options".*?</details>',old).group()
s=s[:match.start()]+'<button id="voice" type="button" aria-label="说出问题">🎙 说话</button>'+language+s[match.end():]
needle='<textarea id="question" form="ask" rows="2" maxlength="240" required placeholder="例如：帮我卖某商品一台；查串码后四位1234"></textarea>'
small='<form id="ask" class="compact-send"><button class="primary send-key" type="submit" aria-label="发送给助理" title="发送">↑</button><label class="voice-setting" title="自动语音回答"><input id="auto-voice" type="checkbox" checked aria-label="自动语音回答">自动</label></form>'
if needle not in s:raise ValueError("Question textarea not found")
s=s.replace(needle,needle+small,1)
s=s.replace('<a href="/knowledge-review#answer-feedback" data-owner-only','<a id="answer-feedback-shortcut" href="/knowledge-review#answer-feedback" data-owner-only')
p.write_text(s,encoding="utf-8")
p=root/"web/assistant.js";s=p.read_text(encoding="utf-8").replace("['phrase-panel','dialogue-panel','dialogue-shortcut']","['phrase-panel','dialogue-panel','dialogue-shortcut','answer-feedback-shortcut']")
p.write_text(s,encoding="utf-8")
p=root/"web/assistant.css";s=p.read_text(encoding="utf-8");s+="""
/* Compact sending stays with the question so the answer starts immediately below it. */
.question-row{display:flex!important;flex-wrap:nowrap!important;gap:8px}
.question-row textarea{flex:1 1 0!important;width:0;min-width:0}
#ask.compact-send{flex:0 0 60px;display:flex;flex-direction:column;align-items:center;gap:8px;margin:0}
#ask .send-key{width:52px;min-height:48px;font-size:30px!important;padding:0;margin:0;border-radius:12px;overflow-wrap:normal}
#ask .voice-setting{display:flex;flex-direction:column;gap:3px;margin:0;font-size:18px!important;line-height:1.2}
#ask .voice-setting input{width:22px;height:22px;margin:0}
"""
p.write_text(s,encoding="utf-8")
p=root/"web/knowledge-review.html";s=p.read_text(encoding="utf-8")
s=s.replace("知识资料整理与核对报告","知识审核与回答纠错").replace("<strong>资料核对报告</strong>","<strong>知识审核</strong>").replace("<h1>知识资料核对</h1>","<h1>知识审核</h1>")
section="""<section id="answer-feedback" class="tools" hidden>
<div class="row"><h2>回答纠错 <span id="feedback-pending"></span></h2><button id="feedback-reload" type="button">刷新</button></div>
<label for="feedback-filter">查看状态</label><select id="feedback-filter"><option>待审核</option><option>已生效</option><option>已处理</option><option>不采纳</option><option>全部</option></select>
<p id="feedback-review-status" role="status"></p><div id="feedback-list"></div><button id="feedback-more" type="button" hidden>加载更多</button>
</section><details class="tools"><summary>资料核对报告</summary>"""
s=s.replace('<section class="tools" id="batch-tools"',section+'<section class="tools" id="batch-tools"',1)
s=s.replace('<template id="knowledge-review-help"','</details><template id="knowledge-review-help"',1)
css="""#answer-feedback{scroll-margin-top:100px}.feedback-item{border:1px solid #bad0ea;border-radius:12px;padding:12px;margin:12px 0;background:#f7faff;overflow-wrap:anywhere}.feedback-item summary{line-height:1.5}.feedback-item .original{white-space:pre-wrap;background:#f0f3f8;border-left:4px solid #92a5bc;padding:10px}.feedback-item .suggested{white-space:pre-wrap;background:#ebf7ed;padding:10px}.feedback-item input[type=checkbox]{display:inline-block;width:22px;height:22px;vertical-align:middle;margin-right:6px}.feedback-item form{border-top:1px solid #cbd9eb;margin-top:12px}.feedback-item textarea{background:#fff;min-height:100px}.feedback-item .correct-answer{border-color:#66a47b;background:#f1faf3}.feedback-item .review-message{white-space:pre-wrap}.feedback-item .review-message[data-error=true]{color:#a52b25}#feedback-review-status{color:#225c31}.feedback-item small{display:block;margin:8px 0}@media(max-width:640px){.feedback-item{padding:10px}.feedback-item button{width:100%}}"""
s=s.replace("</style>",css+"</style>",1).replace("knowledge-review.js?v=20261010-clean-layout","knowledge-review.js?v=20261010-answer-feedback")
s=s.replace("<p>原文件和原始数字保留。","<p>回答纠错：员工在助理回答旁提交，老板在此修改并审核。实时销售、库存、金额等问题保留真实数据查询，核对原因后填写处理结果。</p><p>原文件和原始数字保留。",1)
p.write_text(s,encoding="utf-8")
print("Compact send controls and central correction review UI added")
